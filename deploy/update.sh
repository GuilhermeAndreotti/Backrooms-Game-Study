#!/usr/bin/env bash
#
# Reaplica o codigo atual de /opt/backrooms e reinicia o servico.
#   sudo bash /opt/backrooms/deploy/update.sh

set -euo pipefail

APP_DIR="/opt/backrooms"
APP_USER="backrooms"

[ "$(id -u)" -eq 0 ] || { echo "Rode com sudo."; exit 1; }

cd "$APP_DIR"

# Se o diretorio for um clone git, puxa a versao nova primeiro.
if [ -d .git ]; then
  sudo -u "$APP_USER" git pull --ff-only
fi

sudo -u "$APP_USER" npm ci
sudo -u "$APP_USER" npm run build
sudo -u "$APP_USER" npm ci --omit=dev

systemctl restart backrooms
sleep 2
systemctl is-active --quiet backrooms && echo "Atualizado e no ar." || {
  echo "Falhou. Logs:"; journalctl -u backrooms -n 30 --no-pager; exit 1;
}
