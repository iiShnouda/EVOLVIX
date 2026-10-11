import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantAnswer } from '@skb/shared';
import { Button, Spinner } from './ui';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { transcribe } from '../lib/queries';
import { MicDeniedError, Speaker, utterance, type VoiceInput } from '../lib/voice';

type Phase = 'starting' | 'listening' | 'reading' | 'thinking' | 'speaking' | 'paused' | 'failed';

/**
 * A spoken conversation with the assistant (owner, 2026-10-11: "voice to voice, like talking with a
 * person"): it listens, notices when the person stops talking, the server reads what was said, the
 * assistant answers briefly in the app's language and its voice says the answer, then it listens
 * again. A tap sends at once while listening, cuts the answer short while speaking, and carries on
 * after a pause. The questions and answers are kept in the conversation like typed ones.
 *
 * `speaker` and `input` are made in the tap that opened it: phones only allow sound and the
 * microphone's level to start from a tap.
 */
export function VoiceCall({
  conversationId,
  serverVoice,
  speaker,
  input,
  onConversation,
  onClose,
}: {
  conversationId: string | null;
  serverVoice: boolean;
  speaker: Speaker;
  input: Promise<VoiceInput>;
  onConversation: (id: string) => void;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>('starting');
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('');
  const [said, setSaid] = useState('');
  const [error, setError] = useState<string | null>(null);
  const conversation = useRef(conversationId);
  const stopNow = useRef(false);
  const resume = useRef<(() => void) | null>(null);
  const life = useRef<{ end: () => void; timer?: number } | null>(null);

  useEffect(() => {
    // Ending waits a moment: React mounts a window twice in development, and the second mount
    // carries on the same conversation (the microphone was opened in the tap and can't reopen).
    const later = () => {
      const l = life.current;
      if (l) l.timer = window.setTimeout(l.end, 0);
    };
    if (life.current) {
      window.clearTimeout(life.current.timer);
      return later;
    }
    const ctl = new AbortController();
    const { signal } = ctl;
    life.current = {
      end: () => {
        ctl.abort();
        speaker.stop();
        resume.current?.();
        void input.then((m) => m.close()).catch(() => undefined);
      },
    };
    void (async () => {
      let mic: VoiceInput;
      try {
        mic = await input;
      } catch (e) {
        setError(
          t(e instanceof MicDeniedError ? 'assistant.micDenied' : 'assistant.micUnavailable'),
        );
        setPhase('failed');
        return;
      }
      while (!signal.aborted) {
        setPhase('listening');
        try {
          await mic.start();
        } catch {
          setError(t('assistant.micUnavailable'));
          setPhase('failed');
          return;
        }
        const spoke = await utterance(mic, { signal, stopNow, onLevel: (l) => setLevel(l) });
        const audio = await mic.stop();
        if (signal.aborted) break;
        if (!spoke) {
          // Nobody spoke for a while: wait for a tap rather than listen on and on.
          setPhase('paused');
          await new Promise<void>((r) => (resume.current = r));
          resume.current = null;
          continue;
        }
        if (!audio || audio.size < 800) continue;
        setPhase('reading');
        let text: string;
        try {
          text = (await transcribe(audio, locale)).trim();
        } catch (e) {
          setError(errorText(t, e));
          continue;
        }
        if (signal.aborted) break;
        if (!text) continue;
        setError(null);
        setHeard(text);
        setSaid('');
        setPhase('thinking');
        let answer: AssistantAnswer;
        try {
          answer = await api.post<AssistantAnswer>('/assistant/ask', {
            text,
            conversationId: conversation.current ?? undefined,
            language: locale,
            spoken: true,
          });
        } catch (e) {
          setError(errorText(t, e));
          continue;
        }
        if (signal.aborted) break;
        if (!conversation.current) {
          conversation.current = answer.conversationId;
          onConversation(answer.conversationId);
        }
        void qc.invalidateQueries({ queryKey: ['assistant'] });
        setSaid(answer.answer.content);
        setPhase('speaking');
        await speaker.say(answer.answer.content, locale, serverVoice);
      }
    })();
    return later;
    // The conversation lives as long as this window: nothing it reads changes it once started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function tap() {
    if (phase === 'listening') stopNow.current = true;
    else if (phase === 'speaking') speaker.stop();
    else if (phase === 'paused') resume.current?.();
  }

  const status: Record<Phase, string> = {
    starting: t('assistant.talkListening'),
    listening: t('assistant.talkListening'),
    reading: t('assistant.talkReading'),
    thinking: t('assistant.thinking'),
    speaking: t('assistant.talkSpeaking'),
    paused: t('assistant.talkPaused'),
    failed: '',
  };
  const action: Partial<Record<Phase, string>> = {
    listening: t('assistant.talkSendNow'),
    speaking: t('assistant.talkInterrupt'),
    paused: t('assistant.talkResume'),
  };
  const grow = phase === 'listening' ? 1 + Math.min(level * 5, 0.35) : 1;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('assistant.talk')}
        className="flex max-h-full w-full max-w-sm flex-col items-center gap-5 overflow-y-auto rounded-2xl bg-surface p-6 text-center shadow-2xl"
      >
        <h2 className="text-base font-semibold">{t('assistant.talk')}</h2>

        <button
          type="button"
          onClick={tap}
          disabled={!action[phase]}
          aria-label={action[phase] ?? status[phase]}
          title={action[phase]}
          className="relative grid h-40 w-40 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-brand/40"
        >
          {phase === 'speaking' && (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-brand/20 [animation-duration:1.6s]" />
              <span className="absolute -inset-3 animate-pulse rounded-full bg-brand/10" />
            </>
          )}
          <span
            className={`absolute inset-0 rounded-full transition-transform duration-75 ${
              phase === 'failed'
                ? 'bg-destructive-soft'
                : phase === 'paused'
                  ? 'bg-surface-2'
                  : 'bg-brand shadow-lg shadow-brand/30'
            }`}
            style={{ transform: `scale(${grow})` }}
          />
          <span
            className={`relative ${phase === 'paused' ? 'text-muted' : phase === 'failed' ? 'text-destructive' : 'text-brand-fg'}`}
          >
            {phase === 'reading' || phase === 'thinking' || phase === 'starting' ? (
              <Spinner size={40} />
            ) : (
              <Icon
                name={
                  phase === 'speaking'
                    ? 'speaker'
                    : phase === 'paused'
                      ? 'play'
                      : phase === 'failed'
                        ? 'alert'
                        : 'mic'
                }
                size={48}
                strokeWidth={1.5}
              />
            )}
          </span>
        </button>

        <div className="min-h-6 w-full space-y-1">
          {status[phase] && <p className="text-sm font-semibold text-brand">{status[phase]}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {(heard || said) && (
          <div className="w-full space-y-2 text-start text-sm">
            {heard && (
              <p className="rounded-xl bg-surface-2 px-3 py-2">
                <span className="block text-[11px] font-semibold text-muted">
                  {t('assistant.you')}
                </span>
                <span className="line-clamp-3 break-words">{heard}</span>
              </p>
            )}
            {said && (
              <p className="rounded-xl bg-brand-soft/60 px-3 py-2">
                <span className="block text-[11px] font-semibold text-brand">
                  {t('nav.assistant')}
                </span>
                <span className="line-clamp-6 whitespace-pre-wrap break-words">{said}</span>
              </p>
            )}
          </div>
        )}

        <Button variant="danger" icon="close" className="w-full" onClick={onClose}>
          {t('assistant.talkEnd')}
        </Button>
      </div>
    </div>
  );
}
