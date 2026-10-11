"""
Evolvix voice: reads the assistant's answers aloud, on the company's own server (owner, 2026-10-11:
"talk with me like a person"). Piper (piper-tts, GPL-3.0, run as its own service) with one Arabic and
one English voice, downloaded once on first start and kept in /data/voices; after that no internet is
needed and nothing said leaves the server.

Only the app reaches it, over the private Docker network (no port is published):
  GET  /health                      -> {"ar": true, "en": true, "memoryBytes": ...}
  POST /speak {"text", "language"}  -> audio/wav
It runs nothing else and keeps nothing: the text is spoken and forgotten.
"""

import io
import json
import logging
import os
import shutil
import threading
import time
import urllib.request
import wave
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from piper import PiperVoice, SynthesisConfig
from piper.download_voices import URL_FORMAT, VOICE_PATTERN

VOICE_DIR = Path(os.environ.get("VOICE_DIR", "/data/voices"))
VOICES = {
    "ar": os.environ.get("VOICE_AR", "ar_JO-kareem-medium").strip(),
    "en": os.environ.get("VOICE_EN", "en_US-hfc_female-medium").strip(),
}
# Below 1 speaks faster, above 1 slower (unset: the voice's own pace).
LENGTH_SCALE = float(os.environ["VOICE_LENGTH_SCALE"]) if os.environ.get("VOICE_LENGTH_SCALE") else None
SENTENCE_PAUSE = 0.25
MAX_TEXT = 1500
MAX_BODY = 16 * 1024
PORT = int(os.environ.get("PORT", "5000"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("voice")

loaded: dict[str, PiperVoice] = {}
# One answer at a time: the voices use every core, and a small server shouldn't run two at once.
speaking = threading.Lock()


def download(name: str) -> Path:
    """The voice's model in VOICE_DIR, fetched once from the Piper voices collection."""
    m = VOICE_PATTERN.match(name)
    if not m:
        raise ValueError(f"Not a voice name: {name}")
    family, region = m.group("lang_family"), m.group("lang_region")
    args = {
        "lang_family": family,
        "lang_code": f"{family}_{region}",
        "voice_name": m.group("voice_name"),
        "voice_quality": m.group("voice_quality"),
    }
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    model = VOICE_DIR / f"{name}.onnx"
    for target, ext in ((Path(f"{model}.json"), ".onnx.json"), (model, ".onnx")):
        if target.exists() and target.stat().st_size > 0:
            continue
        log.info("Downloading %s%s", name, ext)
        part = target.with_name(target.name + ".part")
        with urllib.request.urlopen(URL_FORMAT.format(extension=ext, **args), timeout=60) as res, open(part, "wb") as out:
            shutil.copyfileobj(res, out)
        part.replace(target)  # a cut download never looks finished
    return model


def prepare() -> None:
    """Fetch and load both voices, trying again every few minutes while the internet isn't there."""
    while len(loaded) < len(VOICES):
        for lang, name in VOICES.items():
            if lang in loaded:
                continue
            try:
                voice = PiperVoice.load(download(name))
                # The first sentence warms the model (and Arabic's diacritizer) up.
                list(voice.synthesize("مرحبا" if lang == "ar" else "Hello"))
                loaded[lang] = voice
                log.info("Voice ready: %s (%s)", lang, name)
            except Exception as e:  # noqa: BLE001 - kept running, tried again later
                log.warning("Voice %s not ready: %s", name, e)
        if len(loaded) < len(VOICES):
            time.sleep(300)


def speak(lang: str, text: str) -> bytes:
    voice = loaded[lang]
    config = SynthesisConfig(length_scale=LENGTH_SCALE)
    buf = io.BytesIO()
    with speaking, wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(voice.config.sample_rate)
        pause = b"\x00\x00" * int(voice.config.sample_rate * SENTENCE_PAUSE)
        for i, chunk in enumerate(voice.synthesize(text, syn_config=config)):
            if i:
                wav.writeframes(pause)
            wav.writeframes(chunk.audio_int16_bytes)
    return buf.getvalue()


def memory_bytes() -> int:
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except OSError:
        pass
    return 0


def disk_bytes() -> int:
    """How much the downloaded voices take on disk."""
    total = 0
    try:
        for f in VOICE_DIR.glob("*"):
            if f.is_file():
                total += f.stat().st_size
    except OSError:
        pass
    return total


class Handler(BaseHTTPRequestHandler):
    server_version = "EvolvixVoice"
    sys_version = ""

    def log_message(self, fmt, *args):  # no request lines (they would only say "POST /speak")
        pass

    def reply(self, status: int, body: bytes, kind: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def error(self, status: int, code: str) -> None:
        self.reply(status, json.dumps({"code": code}).encode(), "application/json")

    def do_GET(self):
        if self.path != "/health":
            return self.error(HTTPStatus.NOT_FOUND, "not_found")
        body = {lang: lang in loaded for lang in VOICES}
        body["memoryBytes"] = memory_bytes()
        body["diskBytes"] = disk_bytes()
        self.reply(HTTPStatus.OK, json.dumps(body).encode(), "application/json")

    def do_POST(self):
        if self.path != "/speak":
            return self.error(HTTPStatus.NOT_FOUND, "not_found")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY:
            return self.error(HTTPStatus.BAD_REQUEST, "bad_request")
        try:
            req = json.loads(self.rfile.read(length))
            lang = str(req.get("language", ""))
            text = " ".join(str(req.get("text", "")).split())[:MAX_TEXT]
        except (ValueError, AttributeError):
            return self.error(HTTPStatus.BAD_REQUEST, "bad_request")
        if lang not in VOICES or not text:
            return self.error(HTTPStatus.BAD_REQUEST, "bad_request")
        if lang not in loaded:
            return self.error(HTTPStatus.SERVICE_UNAVAILABLE, "voice_not_ready")
        try:
            audio = speak(lang, text)
        except Exception:  # noqa: BLE001
            log.exception("Speaking failed")
            return self.error(HTTPStatus.INTERNAL_SERVER_ERROR, "failed")
        self.reply(HTTPStatus.OK, audio, "audio/wav")


if __name__ == "__main__":
    threading.Thread(target=prepare, daemon=True).start()
    log.info("Listening on %s", PORT)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
