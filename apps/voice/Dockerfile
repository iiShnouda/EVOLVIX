# Evolvix voice (see server.py): Piper text to speech, on the company's own server.
FROM python:3.12-slim
# The user is "evolvix": Debian already has a group called "voice".
RUN pip install --no-cache-dir --root-user-action=ignore piper-tts==1.3.0 \
 && useradd --system --user-group --home-dir /data evolvix \
 && mkdir -p /data/voices && chown -R evolvix:evolvix /data
WORKDIR /app
COPY server.py .
USER evolvix
ENV VOICE_DIR=/data/voices PYTHONUNBUFFERED=1
EXPOSE 5000
CMD ["python", "server.py"]
