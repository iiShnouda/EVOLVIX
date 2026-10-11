# Evolvix voice (see server.py): Piper text to speech, on the company's own server.
FROM python:3.12-slim
RUN pip install --no-cache-dir piper-tts==1.3.0 \
 && useradd --system --home-dir /data voice \
 && mkdir -p /data/voices && chown -R voice /data
WORKDIR /app
COPY server.py .
USER voice
ENV VOICE_DIR=/data/voices PYTHONUNBUFFERED=1
EXPOSE 5000
CMD ["python", "server.py"]
