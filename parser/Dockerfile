# ── Python parser with ffmpeg for media processing ───────────
FROM python:3.11-slim

# Install system dependencies:
#   ffmpeg          — video processing
#   curl            — healthchecks
#   chromium        — headless browser for HTML banner rendering
#   fonts-*         — fonts for banner text (DejaVu + Google Noto)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
        ca-certificates \
        chromium \
        fonts-dejavu-core \
        fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

# Tell html2image / Chromium where the browser is
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMIUM_FLAGS="--no-sandbox --disable-gpu"

WORKDIR /app

# Copy source code and install
COPY . .
RUN pip install --no-cache-dir .

ENTRYPOINT ["python", "-m", "parser"]
