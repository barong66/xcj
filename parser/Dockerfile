# ── Python parser with ffmpeg for media processing ───────────
FROM python:3.11-slim

# Install system dependencies: ffmpeg for video processing, curl for healthchecks
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (cache layer)
COPY pyproject.toml ./
RUN mkdir -p parser && touch parser/__init__.py && \
    pip install --no-cache-dir -e .

# Copy source code
COPY . .

# Reinstall with actual source
RUN pip install --no-cache-dir -e .

ENTRYPOINT ["python", "-m", "parser"]
