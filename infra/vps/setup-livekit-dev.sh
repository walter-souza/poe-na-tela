#!/bin/sh
# Sobe um LiveKit dedicado ao backend de dev (poe-livekit-dev), isolado do LiveKit de produção,
# e aponta o backend-dev para ele. O LiveKit e o backend de produção não são tocados.
# Gera as chaves na própria VPS (nunca são impressas), faz backup de tudo que altera e pode ser
# rodado de novo sem duplicar nada.
#
#   cd ~/poe-na-tela-dev && git pull --ff-only origin develop && sh infra/vps/setup-livekit-dev.sh
set -eu
REPO=$(cd "$(dirname "$0")/../.." && pwd)
STACK=/root/poe-na-tela-dev/app-stack
DEV_ENV=/root/poe-na-tela-dev/server/.env
CADDY=/etc/caddy/Caddyfile
HOST=livekit-dev.194.61.238.98.sslip.io
TS=$(date +%Y%m%d%H%M%S)
cd "$STACK"

cp docker-compose.yml "docker-compose.yml.bak-$TS"
cp .env ".env.bak-$TS"
cp "$DEV_ENV" "$DEV_ENV.bak-$TS"
cp "$CADDY" "$CADDY.bak-$TS"
echo "backups: *.bak-$TS"

# 1) Chaves exclusivas do dev
if ! grep -q '^LIVEKIT_DEV_KEYS=' .env; then
  KEY="APIdev$(openssl rand -hex 6)"
  SECRET="$(openssl rand -hex 32)"
  printf 'LIVEKIT_DEV_KEYS="%s: %s"\n' "$KEY" "$SECRET" >> .env
  echo "chaves do dev: geradas"
else
  V=$(grep '^LIVEKIT_DEV_KEYS=' .env | tail -1 | cut -d= -f2- | tr -d '"')
  KEY=${V%%:*}
  SECRET=${V#*: }
  echo "chaves do dev: já existiam"
fi

# 2) Config e serviço no compose
cp "$REPO/infra/vps/livekit-dev.yaml" livekit-dev.yaml
if ! grep -q '^  livekit-dev:' docker-compose.yml; then
  cat >> docker-compose.yml <<'EOF'

  # LiveKit dedicado ao backend de dev: salas, chaves e bot de clipe separados da produção.
  livekit-dev:
    image: livekit/livekit-server:v1.13.9
    container_name: poe-livekit-dev
    restart: unless-stopped
    command: --config /etc/livekit.yaml
    network_mode: host
    environment:
      LIVEKIT_KEYS: ${LIVEKIT_DEV_KEYS:?defina LIVEKIT_DEV_KEYS no .env}
    volumes:
      - ./livekit-dev.yaml:/etc/livekit.yaml:ro
EOF
fi
docker compose config -q
docker compose up -d livekit-dev

i=0
until curl -fs http://127.0.0.1:7980 >/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then
    echo "livekit-dev não respondeu:"
    docker logs --tail 20 poe-livekit-dev
    exit 1
  fi
  sleep 1
done
echo "livekit-dev: respondendo em 127.0.0.1:7980"

# 3) Caddy: TLS da sinalização (restaura o backup se a config ficar inválida)
if ! grep -q "^$HOST" "$CADDY"; then
  printf '\n%s {\n    reverse_proxy localhost:7980\n}\n' "$HOST" >> "$CADDY"
fi
if caddy validate --config "$CADDY" --adapter caddyfile >/dev/null 2>&1; then
  systemctl reload caddy
  echo "caddy: recarregado"
else
  cp "$CADDY.bak-$TS" "$CADDY"
  echo "caddy: config inválida, backup restaurado"
  exit 1
fi

# 4) Firewall: mídia do dev
ufw allow 7981/tcp >/dev/null
ufw allow 7982/udp >/dev/null
echo "ufw: 7981/tcp e 7982/udp liberadas"

# 5) Backend de dev passa a usar o LiveKit novo
set_env() {
  if grep -q "^$1=" "$DEV_ENV"; then sed -i "s|^$1=.*|$1=$2|" "$DEV_ENV"; else echo "$1=$2" >> "$DEV_ENV"; fi
}
set_env LIVEKIT_URL "wss://$HOST"
set_env LIVEKIT_INTERNAL_URL "http://127.0.0.1:7980"
set_env LIVEKIT_API_KEY "$KEY"
set_env LIVEKIT_API_SECRET "$SECRET"
pm2 restart backend-dev --update-env >/dev/null
echo "backend-dev: reiniciado apontando para $HOST"
