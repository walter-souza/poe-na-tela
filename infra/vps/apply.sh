#!/usr/bin/env bash
# Aplica a infra da VPS (LiveKit + MediaMTX + Caddy + firewall + PM2). Idempotente; rode como root:
#   cd ~/poe-na-tela-dev && git fetch origin develop && git reset --hard origin/develop
#   bash infra/vps/apply.sh
# O LiveKit é recriado ao final: chamadas em andamento caem por alguns segundos. Rode com a sala vazia.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$HOME/app-stack"
PUBLIC_IP="${PUBLIC_IP:-$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "src") print $(i + 1)}')}"
STREAM_HOST="stream.${PUBLIC_IP}.sslip.io"
# OBS (MediaMTX) fica desligado por padrão. Para ligar: ENABLE_OBS=1 bash infra/vps/apply.sh
ENABLE_OBS="${ENABLE_OBS:-0}"
BACKEND_ENVS=("$HOME/poe-na-tela/server/.env" "$HOME/poe-na-tela-dev/server/.env")

[ "$(id -u)" -eq 0 ] || { echo "Rode como root."; exit 1; }
[ -n "$PUBLIC_IP" ] || { echo "Não foi possível detectar o IP público. Rode com PUBLIC_IP=x.x.x.x"; exit 1; }
[ -f "$STACK/livekit.yaml" ] || { echo "Falta $STACK/livekit.yaml (stack atual do LiveKit)."; exit 1; }

echo "== IP público: $PUBLIC_IP | stream: $STREAM_HOST"

echo "== 1/7 Backup do stack atual"
BACKUP="$STACK.bak-$(date +%Y%m%d%H%M%S)"
cp -a "$STACK" "$BACKUP"
echo "   backup em $BACKUP"

echo "== 2/7 Segredos em $STACK/.env (fora do Git)"
touch "$STACK/.env"
chmod 600 "$STACK/.env"
if ! grep -q '^LIVEKIT_KEYS=' "$STACK/.env"; then
  # Reaproveita o par chave:segredo que já está no livekit.yaml atual.
  KEYLINE="$(sed -n '/^keys:/{n;s/^[[:space:]]*//;p;}' "$STACK/livekit.yaml")"
  [ -n "$KEYLINE" ] || { echo "Não achei 'keys:' no livekit.yaml atual."; exit 1; }
  echo "LIVEKIT_KEYS=\"$KEYLINE\"" >> "$STACK/.env"
fi
if ! grep -q '^WEBHOOK_SECRET=' "$STACK/.env"; then
  echo "WEBHOOK_SECRET=$(openssl rand -hex 24)" >> "$STACK/.env"
fi
WEBHOOK_SECRET="$(grep '^WEBHOOK_SECRET=' "$STACK/.env" | cut -d= -f2-)"

echo "== 3/7 Arquivos do stack"
install -m 644 "$SRC/docker-compose.yml" "$STACK/docker-compose.yml"
install -m 644 "$SRC/livekit.yaml" "$STACK/livekit.yaml"
sed "s/__PUBLIC_IP__/${PUBLIC_IP}/g" "$SRC/mediamtx.yml" > "$STACK/mediamtx.yml"
chmod 644 "$STACK/mediamtx.yml"

echo "== 4/7 Segredo do webhook nos backends"
for envfile in "${BACKEND_ENVS[@]}"; do
  [ -f "$envfile" ] || { echo "   (ignorado, não existe: $envfile)"; continue; }
  if grep -q '^MEDIAMTX_WEBHOOK_SECRET=' "$envfile"; then
    sed -i "s|^MEDIAMTX_WEBHOOK_SECRET=.*|MEDIAMTX_WEBHOOK_SECRET=${WEBHOOK_SECRET}|" "$envfile"
  else
    printf '\nMEDIAMTX_WEBHOOK_SECRET=%s\n' "$WEBHOOK_SECRET" >> "$envfile"
  fi
done
export PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH"
pm2 restart backend backend-dev --update-env >/dev/null 2>&1 || echo "   (pm2 restart falhou; reinicie os backends manualmente)"

echo "== 5/7 Caddy, firewall e buffers UDP"
if [ "$ENABLE_OBS" = "1" ] && ! grep -q "^${STREAM_HOST} {" /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%Y%m%d%H%M%S)"
  printf '\n%s {\n    reverse_proxy localhost:8889\n}\n' "$STREAM_HOST" >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy

ufw allow 7882/udp  >/dev/null   # LiveKit (UDP multiplexado)
if [ "$ENABLE_OBS" = "1" ]; then
  ufw allow 8890/udp >/dev/null   # SRT do OBS
  ufw allow 8189/udp >/dev/null   # WebRTC do MediaMTX
  ufw allow 8189/tcp >/dev/null
else
  # OBS desligado: fecha as portas do MediaMTX (ignora se a regra não existir)
  ufw delete allow 8890/udp >/dev/null 2>&1 || true
  ufw delete allow 8189/udp >/dev/null 2>&1 || true
  ufw delete allow 8189/tcp >/dev/null 2>&1 || true
fi

cat > /etc/sysctl.d/99-poe-na-tela.conf <<'EOF'
# Buffers UDP maiores: evita descarte de pacotes em picos de vídeo (WebRTC/SRT).
net.core.rmem_max = 4194304
net.core.wmem_max = 4194304
EOF
sysctl --system >/dev/null

echo "== 6/7 Containers (LiveKit é recriado)"
cd "$STACK"
if [ "$ENABLE_OBS" = "1" ]; then
  docker compose --profile obs pull
  docker compose --profile obs up -d --remove-orphans
else
  docker compose pull livekit
  docker compose up -d --remove-orphans
  docker compose rm -sf mediamtx >/dev/null 2>&1 || true   # garante o MediaMTX parado
fi

echo "== 7/7 PM2: rotação de logs e persistência"
pm2 describe pm2-logrotate >/dev/null 2>&1 || pm2 install pm2-logrotate >/dev/null
pm2 set pm2-logrotate:max_size 10M >/dev/null
pm2 set pm2-logrotate:retain 7 >/dev/null
pm2 set pm2-logrotate:compress true >/dev/null
pm2 save >/dev/null

echo
echo "== Verificação"
sleep 5
docker ps --format '   {{.Names}}  {{.Image}}  {{.Status}}'
ss -ulnp | grep -E ':(7882|8890|8189)\b' | awk '{print "   UDP escutando:", $5}'
if [ "$ENABLE_OBS" = "1" ]; then
  printf '   API MediaMTX:   '; curl -s -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9997/v3/paths/list || echo falhou
  printf '   WHEP (HTTPS):   '; curl -s -m 8 -o /dev/null -w '%{http_code}\n' "https://${STREAM_HOST}/teste/whep" || echo falhou
  echo '   (WHEP sem stream responde 404; 200/404 = Caddy e MediaMTX no ar)'
  echo '   Últimas linhas do MediaMTX:'
  docker logs --tail 12 poe-mediamtx 2>&1 | sed 's/^/   /'
else
  echo '   OBS (MediaMTX) desligado. Para ligar: ENABLE_OBS=1 bash infra/vps/apply.sh'
fi
echo
echo "Depois de confirmar que chamadas e OBS funcionam, remova a regra antiga do LiveKit:"
echo "   ufw delete allow 50000:50100/udp"
