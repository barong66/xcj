#!/usr/bin/env bash
# ============================================
# Traforama — Initial Server Setup
# Run as root on a fresh Ubuntu 24.04 VPS
# Usage: bash setup-server.sh
# ============================================
set -euo pipefail

echo "=== Traforama Server Setup ==="

# ── 1. System update ──────────────────────────────────────
echo "[1/7] Updating system..."
apt-get update && apt-get upgrade -y
apt-get install -y \
    curl wget git unzip \
    ufw fail2ban \
    nginx \
    python3 python3-pip python3-venv \
    htop

# ── 2. Install Docker ────────────────────────────────────
echo "[2/7] Installing Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    echo "Docker already installed, skipping."
fi

# ── 3. Create traforama user ─────────────────────────────
echo "[3/7] Creating traforama user..."
if ! id "traforama" &>/dev/null; then
    useradd -m -s /bin/bash traforama
    usermod -aG docker traforama
    echo "User 'traforama' created and added to docker group."
else
    echo "User 'traforama' already exists, skipping."
fi

# ── 4. Create directories ────────────────────────────────
echo "[4/7] Creating directories..."
mkdir -p /opt/traforama
mkdir -p /var/log/traforama
chown -R traforama:traforama /opt/traforama
chown -R traforama:traforama /var/log/traforama

# ── 5. Firewall ──────────────────────────────────────────
echo "[5/7] Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable
echo "UFW enabled: SSH(22), HTTP(80), HTTPS(443)"

# ── 6. fail2ban ──────────────────────────────────────────
echo "[6/7] Configuring fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

# ── 7. Nginx ─────────────────────────────────────────────
echo "[7/7] Configuring nginx..."
systemctl enable nginx

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Switch to traforama user:  su - traforama"
echo "  2. Clone the repo:            git clone <REPO_URL> /opt/traforama/xcj"
echo "  3. Copy .env:                 cp /opt/traforama/xcj/.env.production.example /opt/traforama/xcj/.env"
echo "  4. Edit .env:                 nano /opt/traforama/xcj/.env"
echo "  5. Start services:            cd /opt/traforama/xcj && docker compose -f deploy/docker/docker-compose.yml up -d"
echo "  6. Copy nginx config:         sudo cp /opt/traforama/xcj/deploy/nginx/nginx.conf /etc/nginx/nginx.conf"
echo "  7. Test & reload nginx:       sudo nginx -t && sudo systemctl reload nginx"
echo "  8. Init ClickHouse:           docker exec traforama-clickhouse clickhouse-client < /opt/traforama/xcj/scripts/migrations/002_clickhouse.sql"
echo "  9. Check health:              curl http://localhost/health"
