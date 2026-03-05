# ── Python parser with ffmpeg for media processing ───────────
FROM python:3.11-slim

# Install system dependencies: ffmpeg for video processing, curl for healthchecks,
# fonts-dejavu-core for banner text overlay
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
        ca-certificates \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy source code and install
COPY . .
RUN pip install --no-cache-dir .

ENTRYPOINT ["python", "-m", "parser"]
