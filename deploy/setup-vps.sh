#!/usr/bin/env bash
#
# Instalador do Backrooms Level 0 numa VPS Ubuntu/Debian limpa.
#
# Uso (como root, ou com sudo):
#   sudo bash deploy/setup-vps.sh
#
# O que ele faz:
#   1. instala Node.js 22, nginx e o firewall
#   2. cria o usuario de servico "backrooms"
#   3. copia o projeto para /opt/backrooms e faz o build
#   4. registra o servico systemd e o proxy nginx
#
# Nao instala HTTPS: rode o certbot depois (as instrucoes aparecem no fim).

set -euo pipefail

APP_DIR="/opt/backrooms"
APP_USER="backrooms"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Rode como root: sudo bash deploy/setup-vps.sh"

log "1/6 Instalando dependencias do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg nginx ufw

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  log "Instalando Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

log "2/6 Criando usuario de servico"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

log "3/6 Copiando o projeto para $APP_DIR"
mkdir -p "$APP_DIR"
# Exclui o que sera regerado no destino.
tar -C "$SOURCE_DIR" \
    --exclude=node_modules --exclude=dist --exclude=.git \
    -cf - . | tar -C "$APP_DIR" -xf -
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "4/6 Instalando dependencias e compilando (pode levar 1-2 minutos)"
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci
sudo -u "$APP_USER" npm run build
# So as dependencias de producao ficam no disco.
sudo -u "$APP_USER" npm ci --omit=dev

if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
fi

log "5/6 Registrando o servico systemd"
cp "$APP_DIR/deploy/backrooms.service" /etc/systemd/system/backrooms.service
systemctl daemon-reload
systemctl enable --now backrooms
sleep 2
systemctl is-active --quiet backrooms || die "O servico nao subiu. Veja: journalctl -u backrooms -n 50"

log "6/6 Configurando nginx e firewall"
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/backrooms
ln -sf /etc/nginx/sites-available/backrooms /etc/nginx/sites-enabled/backrooms
rm -f /etc/nginx/sites-enabled/default

# Sem dominio configurado, aceita qualquer host (util para acessar pelo IP).
sed -i 's/server_name SEU_DOMINIO;/server_name _;/' /etc/nginx/sites-available/backrooms

nginx -t
systemctl reload nginx

ufw allow OpenSSH   >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

cat <<EOF

============================================================
  PRONTO! O jogo esta no ar.

  Acesse:  http://$IP

  Comandos uteis:
    systemctl status backrooms       # ver estado
    journalctl -u backrooms -f       # ver logs ao vivo
    systemctl restart backrooms      # reiniciar
    bash $APP_DIR/deploy/update.sh   # atualizar depois de mudar o codigo

  Para ligar HTTPS (precisa de um dominio apontando para $IP):
    sudo apt install -y certbot python3-certbot-nginx
    sudo nano /etc/nginx/sites-available/backrooms   # troque "_" pelo dominio
    sudo certbot --nginx -d SEU_DOMINIO
============================================================

EOF
