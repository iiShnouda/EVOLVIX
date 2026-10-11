import { api } from './api';

/**
 * Talking with the assistant by voice (owner, 2026-10-11: "voice to voice, like talking with a
 * person"): the microphone with a level for telling speech from silence, and the answer read aloud
 * by the server's own voice (or the device's when the server has none). Recordings and audio live
 * in memory only while they are used.
 */

/** The microphone for one conversation: a level to listen to, and one recording at a time. */
export interface VoiceInput {
  /** How loud it is now, 0..1 (speech is well above the room's own level). */
  level(): number;
  /** The quietest a spoken word is on this kind of microphone. */
  readonly minSpeech: number;
  start(): Promise<void>;
  /** The recording since start (null when there was nothing). */
  stop(): Promise<Blob | null>;
  close(): void;
}

export class MicDeniedError extends Error {}
export class MicUnavailableError extends Error {}

/** The Android app's own recorder (pages over plain http can't use the browser's microphone). */
interface NativeMic {
  micStart(): string;
  micLevel(): number;
  micStop(): string;
  micCancel(): void;
}

function nativeMic(): NativeMic | null {
  const app = (window as unknown as { SKBApp?: Partial<NativeMic> }).SKBApp;
  return app && typeof app.micStart === 'function' ? (app as NativeMic) : null;
}

export function canTalk(): boolean {
  if (typeof window === 'undefined') return false;
  const browser =
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';
  return browser || !!nativeMic();
}

/** Open the microphone; call it from the tap that starts the conversation. */
export async function openVoiceInput(): Promise<VoiceInput> {
  const browser =
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';
  if (browser) return browserInput();
  const native = nativeMic();
  if (native) return nativeInput(native);
  throw new MicUnavailableError();
}

async function browserInput(): Promise<VoiceInput> {
  // Made before anything is awaited, so it starts within the tap (phones keep it silent otherwise).
  const ctx = new AudioContext();
  void ctx.resume().catch(() => undefined);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    void ctx.close().catch(() => undefined);
    throw new MicDeniedError();
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  return {
    minSpeech: 0.02,
    level() {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      return Math.sqrt(sum / samples.length);
    },
    async start() {
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start();
    },
    stop() {
      const r = recorder;
      recorder = null;
      if (!r || r.state === 'inactive') return Promise.resolve(null);
      return new Promise((resolve) => {
        r.onstop = () =>
          resolve(chunks.length ? new Blob(chunks, { type: r.mimeType || 'audio/webm' }) : null);
        r.stop();
      });
    },
    close() {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      recorder = null;
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
    },
  };
}

async function nativeInput(mic: NativeMic): Promise<VoiceInput> {
  // The first time, the phone asks the person to allow the microphone.
  let state = mic.micStart();
  for (let i = 0; state === 'asking' && i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    state = mic.micStart();
  }
  if (state === 'denied' || state === 'asking') throw new MicDeniedError();
  if (state !== 'ok') throw new MicUnavailableError();
  mic.micCancel();
  return {
    minSpeech: 0.08,
    level: () => mic.micLevel(),
    async start() {
      if (mic.micStart() !== 'ok') throw new MicUnavailableError();
    },
    async stop() {
      const base64 = mic.micStop();
      if (!base64) return null;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      return new Blob([bytes], { type: 'audio/mp4' });
    },
    close: () => mic.micCancel(),
  };
}

/**
 * Wait for the person to say something and stop: a moment to learn the room's level, then speech
 * is a level well above it, and it ends after a pause. `stopNow` ends it at once (the person tapped);
 * resolves false when nothing was said for `giveUpAfter` ms or the conversation ended.
 */
export function utterance(
  input: VoiceInput,
  opts: {
    signal: AbortSignal;
    stopNow: { current: boolean };
    onLevel: (level: number, speaking: boolean) => void;
    pauseMs?: number;
    maxMs?: number;
    giveUpAfter?: number;
  },
): Promise<boolean> {
  const { pauseMs = 1100, maxMs = 30_000, giveUpAfter = 45_000 } = opts;
  return new Promise((resolve) => {
    const started = Date.now();
    let floor = -1;
    let loud = 0;
    let spokeAt = 0;
    let lastLoud = 0;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const done = (said: boolean) => {
        window.clearInterval(timer);
        opts.onLevel(0, false);
        resolve(said);
      };
      if (opts.signal.aborted) return done(false);
      if (opts.stopNow.current) {
        opts.stopNow.current = false;
        return done(spokeAt > 0 || now - started > 600);
      }
      const level = input.level();
      if (now - started < 300) {
        floor = floor < 0 ? level : (floor + level) / 2;
        opts.onLevel(level, false);
        return;
      }
      const threshold = Math.max(input.minSpeech, floor * 3);
      if (level > threshold) {
        loud++;
        lastLoud = now;
        if (!spokeAt && loud >= 3) spokeAt = now;
      } else {
        loud = 0;
        // The room's own level follows slow changes (a fan, the street) while nobody speaks.
        if (!spokeAt) floor = floor * 0.97 + level * 0.03;
      }
      opts.onLevel(level, spokeAt > 0);
      if (spokeAt && now - lastLoud > pauseMs) return done(true);
      if (spokeAt && now - spokeAt > maxMs) return done(true);
      if (!spokeAt && now - started > giveUpAfter) return done(false);
    }, 50);
  });
}

// ---------------------------------------------------------------- speaking

/** Sentences of a sensible length to read one after another (the next is fetched while one plays). */
export function sentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?؟…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
  const out: string[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.length + p.length < 120) out[out.length - 1] = `${last} ${p}`;
    else out.push(p);
  }
  return out;
}

/** A moment of silence, played when a conversation starts so later answers may play on phones. */
function silence(): string {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/**
 * Reads answers aloud: the server's voice when it speaks the language (the same voice on every
 * device, Arabic included), else the device's own. One at a time; `stop` cuts it short.
 */
export class Speaker {
  private audio = new Audio();
  private stopped = false;
  private wake: (() => void) | null = null;

  /** Call from a tap: phones only let a page play sound it started from one. */
  unlock(): void {
    const url = silence();
    this.audio.src = url;
    void this.audio
      .play()
      .catch(() => undefined)
      .finally(() => setTimeout(() => URL.revokeObjectURL(url), 1000));
  }

  stop(): void {
    this.stopped = true;
    this.audio.pause();
    window.speechSynthesis?.cancel();
    this.wake?.();
  }

  async say(text: string, language: 'ar' | 'en', serverVoice: boolean): Promise<void> {
    this.stopped = false;
    const parts = sentences(text);
    let useServer = serverVoice;
    const fetchPart = (s: string) =>
      api.download('/assistant/speak', { text: s, language }).then(
        (r) => new Blob([r.bytes as BlobPart], { type: r.type || 'audio/wav' }),
        () => null,
      );
    let next: Promise<Blob | null> | null = useServer && parts.length ? fetchPart(parts[0]!) : null;
    for (let i = 0; i < parts.length && !this.stopped; i++) {
      if (useServer) {
        const blob = await next;
        next = i + 1 < parts.length ? fetchPart(parts[i + 1]!) : null;
        if (blob) {
          await this.play(blob);
          continue;
        }
        useServer = false; // the server's voice stopped answering: the device reads the rest
      }
      await this.deviceSay(parts[i]!, language);
    }
  }

  private play(blob: Blob): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const url = URL.createObjectURL(blob);
    return new Promise<void>((resolve) => {
      const end = () => {
        this.wake = null;
        this.audio.onended = null;
        this.audio.onerror = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      this.wake = end;
      this.audio.onended = end;
      this.audio.onerror = end;
      this.audio.src = url;
      void this.audio.play().catch(end);
    });
  }

  private deviceSay(text: string, language: 'ar' | 'en'): Promise<void> {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    const voice = synth?.getVoices().find((v) => v.lang.toLowerCase().startsWith(language));
    // No voice for this language on the device: better silent than read in the wrong one.
    if (!synth || !voice || this.stopped) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const say = new SpeechSynthesisUtterance(text);
      say.lang = voice.lang;
      say.voice = voice;
      const end = () => {
        this.wake = null;
        resolve();
      };
      this.wake = end;
      say.onend = end;
      say.onerror = end;
      synth.speak(say);
    });
  }
}
