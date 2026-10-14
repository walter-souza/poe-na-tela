# Infra da VPS (produção)

Espelho da configuração que roda na VPS (`~/app-stack` e `/etc/caddy/Caddyfile`).
**Sem segredos**: `LIVEKIT_KEYS` e `WEBHOOK_SECRET` ficam em `~/app-stack/.env` (chmod 600, fora do Git).

| Arquivo | Destino na VPS |
|---|---|
| `docker-compose.yml`, `livekit.yaml`, `mediamtx.yml` | `~/app-stack/` |
| `Caddyfile` | `/etc/caddy/Caddyfile` |

O `docker-compose.yml` e o `livekit.yaml` da raiz do repositório são só para desenvolvimento local.

Firewall (ufw): 22/tcp, 80/tcp, 443/tcp+udp, 7880/tcp, 7881/tcp, 7882/udp, 3478/udp e 5349/tcp (TURN), 8890/udp (SRT do OBS) e 8189/udp+tcp (WebRTC do MediaMTX).

Aplicar mudanças: copiar os arquivos, `ufw allow` das portas novas e `docker compose up -d` em `~/app-stack`. O MediaMTX é opcional: `docker compose --profile obs up -d mediamtx`.
Atualizar o LiveKit derruba as salas ativas; faça fora de horário de uso. Backups ficam em `~/backups/`.
