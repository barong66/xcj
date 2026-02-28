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
RUN pip install --no-cache-dir -e ".[dev]" 2>/dev/null || pip install --no-cache-dir -e .

# Copy source code
COPY . .

# Install the package in editable mode
RUN pip install --no-cache-dir -e .

ENTRYPOINT ["python", "-m", "parser"]
