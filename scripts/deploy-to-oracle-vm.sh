#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_USER="${REMOTE_USER:-ubuntu}"
REMOTE_HOST="${REMOTE_HOST:-140.245.104.25}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/sg-mahjong}"
REMOTE_WEB_ROOT="${REMOTE_WEB_ROOT:-/var/www/sg-mahjong}"
SSH_KEY="${SSH_KEY:-$HOME/Downloads/ssh-key-2026-07-09.key}"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "SSH key not found: $SSH_KEY" >&2
  exit 1
fi

echo "Building local client..."
cd "$ROOT_DIR"
npm run build

echo "Syncing repo to $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR ..."
rsync -az --delete \
  -e "ssh -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
  --exclude '.git/' \
  --exclude '.codex/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.DS_Store' \
  "$ROOT_DIR/" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"

echo "Building and publishing on the VM..."
ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$REMOTE_HOST" 'bash -s' <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
npm ci
npm run build
sudo rsync -a --delete dist/ "$REMOTE_WEB_ROOT/"
sudo systemctl restart sg-mahjong-ws
sudo systemctl reload nginx
EOF

echo "Deploy complete."
