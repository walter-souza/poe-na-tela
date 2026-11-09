#!/bin/sh
# Adiciona o snippet poe_security aos sites do Põe na Tela no Caddy da VPS (backup + validação).
#   cd ~/poe-na-tela && git pull --ff-only origin main && sh infra/vps/setup-caddy-headers.sh
# Só os sites do Põe na Tela recebem o snippet; turn e tanamesa ficam como estão. Rodar de novo não duplica.
set -eu
C=/etc/caddy/Caddyfile
if grep -q poe_security "$C"; then echo "ja aplicado"; exit 0; fi
B="$C.bak-$(date +%Y%m%d%H%M%S)"
cp "$C" "$B"
{
cat <<'EOF'
# Headers de segurança dos domínios do Põe na Tela (API, mídia e sinalização).
(poe_security) {
    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "no-referrer"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }
}

EOF
sed -E 's#^( +)reverse_proxy (localhost:(3001|3002|7880|8889|7980))$#\1import poe_security\n\1reverse_proxy \2#' "$B"
} > /tmp/Caddyfile.new
test -s /tmp/Caddyfile.new
if caddy validate --config /tmp/Caddyfile.new --adapter caddyfile >/dev/null 2>&1; then
  cp /tmp/Caddyfile.new "$C"
  systemctl reload caddy
  echo "caddy recarregado (backup $B)"
else
  echo "invalido, nada alterado:"
  caddy validate --config /tmp/Caddyfile.new --adapter caddyfile 2>&1 | tail -3
  exit 1
fi
echo "sites com headers: $(grep -c 'import poe_security' "$C")"
