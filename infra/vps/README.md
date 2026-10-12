# Infra da VPS

Configuração versionada do que roda na VPS ao lado dos backends (PM2): **LiveKit** (chamadas e compartilhamento de tela
no navegador) e **MediaMTX** (transmissão pelo **OBS** via SRT, assistida por WebRTC/WHEP). O Caddy faz o HTTPS.

| Arquivo | Destino na VPS | Função |
|---|---|---|
| `docker-compose.yml` | `~/app-stack/` | LiveKit e MediaMTX, com versões fixas |
| `livekit.yaml` | `~/app-stack/` | Config do LiveKit (UDP em porta única 7882) |
| `mediamtx.yml` | `~/app-stack/` (IP preenchido pelo script) | SRT :8890, WHEP :8889, API :9997 e hooks de webhook |
| `apply.sh` | — | Aplica tudo de forma idempotente |

Segredos **não** ficam no Git: `~/app-stack/.env` (chmod 600) guarda `LIVEKIT_KEYS` e `WEBHOOK_SECRET`.

> **OBS desligado por enquanto.** O `apply.sh` só sobe o MediaMTX com `ENABLE_OBS=1` e fecha as portas 8890/8189 caso contrário. No app, a flag `VITE_ENABLE_OBS=true` (cliente) e `ENABLE_OBS=true` (backend) religam o botão/lista e a integração.

## Aplicar
O LiveKit é recriado: chamadas em andamento caem por alguns segundos. Faça com a sala vazia.

```bash
cd ~/poe-na-tela-dev && git fetch origin develop && git reset --hard origin/develop
bash infra/vps/apply.sh
```

Para ligar o OBS depois: `ENABLE_OBS=1 bash infra/vps/apply.sh`.

O script: faz backup de `~/app-stack`, cria o `.env` (reaproveita a chave atual do LiveKit e gera o segredo do webhook),
grava `MEDIAMTX_WEBHOOK_SECRET` nos `.env` dos dois backends e os reinicia, publica `stream.<IP>.sslip.io` no Caddy,
libera no `ufw` as portas 7882/udp, 8890/udp e 8189/udp+tcp, aumenta os buffers UDP, sobe os containers e instala
`pm2-logrotate` (10 MB, 7 arquivos, compactado) com `pm2 save`.

Depois de validar chamadas e OBS, remova a regra antiga do LiveKit: `ufw delete allow 50000:50100/udp`.

## Portas
| Porta | Uso |
|---|---|
| 22/tcp | SSH (só chave) |
| 80, 443 (tcp), 443/udp | Caddy (APIs, LiveKit e `stream.`) |
| 7880, 7881/tcp | LiveKit (sinalização e TCP de fallback) |
| 7882/udp | LiveKit, mídia (multiplexada) |
| 8890/udp | SRT do OBS → MediaMTX |
| 8189/udp+tcp | WebRTC do MediaMTX (espectadores do OBS) |
| 9997, 8889 | **Só localhost** (API do MediaMTX e WHEP atrás do Caddy) |

## Usar o OBS
No app, **Link OBS** gera a URL `srt://<IP>:8890?streamid=publish:<sala>[/<usuario>]`. No OBS: Configurações → Transmissão →
Serviço **Personalizado**, servidor = essa URL, chave vazia. Codificador x264 ou NVENC, **keyframe a cada 1 s**, perfil
`baseline`/`main` (compatível com navegadores) e bitrate de 4–8 Mbps para 1080p60.

## Atenção
- **Quem souber o endereço SRT publica na sala:** não há autenticação de publicação (igual ao comportamento anterior).
  Próximo passo recomendado: autenticar o ingest com uma chave por sala/usuário validada pelo backend (`authMethod: http`).
- Dev e produção **compartilham** o MediaMTX: os mesmos caminhos `<sala>/<usuario>` aparecem nos dois ambientes.
- Atualizar versões: altere a tag em `docker-compose.yml`, faça commit e rode `apply.sh` de novo.
- Reverter: restaure o backup `~/app-stack.bak-*` e rode `docker compose up -d` dentro dele.
