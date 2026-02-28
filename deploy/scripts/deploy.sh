#!/usr/bin/env bash
# ============================================
# Traforama — Deploy Script
# Run as traforama user from project root
# Usage: bash deploy/scripts/deploy.sh
# ============================================
set -euo pipefail

PROJECT_DIR="/opt/traforama/xcj"
COMPOSE_FILE="deploy/docker/docker-compose.yml"

cd "$PROJECT_DIR"

echo "=== Traforama Deploy ==="

# ── 1. Pull latest code ──────────────────────────────────
echo "[1/4] Pulling latest code..."
git pull --ff-only

# ── 2. Build containers ──────────────────────────────────
echo "[2/4] Building containers..."
docker compose -f "$COMPOSE_FILE" build

# ── 3. Restart services ─────────────────────────────────
echo "[3/4] Restarting services..."
docker compose -f "$COMPOSE_FILE" up -d

# ── 4. Health check ──────────────────────────────────────
echo "[4/4] Waiting for services..."
sleep 5

# Check API health
if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
    echo "API: OK"
else
    echo "API: FAILED — check logs: docker compose -f $COMPOSE_FILE logs api"
fi

# Check web
if curl -sf http://localhost:3000 > /dev/null 2>&1; then
    echo "Web: OK"
else
    echo "Web: FAILED — check logs: docker compose -f $COMPOSE_FILE logs web"
fi

echo ""
echo "=== Deploy complete ==="
echo "Logs:  docker compose -f $COMPOSE_FILE logs -f"
echo "Stop:  docker compose -f $COMPOSE_FILE down"
