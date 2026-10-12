# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projeto

"Põe na Tela!" (package `poe-na-tela`, também chamado StreamPulse no backend): streaming de tela/jogos de baixa latência estilo Discord Go Live, com servidores/canais de texto e voz, chat persistente e salas protegidas. A documentação do repositório (README, VERSIONING, commits) está em português.

Monorepo com dois pacotes independentes (cada um com seu `package-lock.json`) mais infra:
- `client/` — React 19 + Vite + Tailwind 4 + `livekit-client` (TypeScript, ESM)
- `server/` — Express 4 + `livekit-server-sdk` + Supabase (TypeScript, tudo em `src/index.ts`)
- `supabase/schema.sql` — schema do banco (profiles, rooms, room_members, channels, messages, guest_accounts)
- `livekit.yaml` / `docker-compose.yml` — SFU LiveKit + api + client para rodar local

## Comandos

Na raiz (instale com `npm install` na raiz, em `client/` e em `server/`):
```bash
npm run dev            # server (tsx watch, :3001) + client (vite) via concurrently
npm run dev:server     # só backend
npm run dev:client     # só frontend
npm run build          # tsc do server + (tsc -b && vite build) do client
npm run docker:up      # LiveKit + API + frontend (client em :3000)
```
Lint (só no client, oxlint): `cd client && npm run lint`. Não há testes automatizados no repositório; a verificação é `build` (type-check) + lint.

Dev local precisa de um LiveKit rodando em `ws://127.0.0.1:7880` (chaves `devkey`/`secret`, ver `.env.example` na raiz) — suba com `docker compose up -d livekit`. Em dev o Vite faz proxy de `/api` para o backend (`client/vite.config.ts`).

## Arquitetura

**Fluxo geral:** o cliente pede um JWT do LiveKit ao backend (`POST /api/token`), conecta direto ao SFU LiveKit via WebRTC e usa o backend também para salas, perfis, chat e convidados. Streams de OBS (SRT) passam por MediaMTX (`MEDIAMTX_API_URL`, webhook `/api/webhooks/mediamtx`) e são reproduzidos no cliente via WHEP (`WhepPlayer`/`WhepTile`).

**Backend (`server/src/index.ts`, ~1800 linhas, arquivo único):**
- Toda rota é registrada com dois caminhos (`['/api/x', '/x']`) — mantenha o par ao criar rotas.
- Todo acesso ao Supabase passa pelo backend com service-role (`server/src/supabase.ts`); o cliente **não** deve ler/gravar tabelas direto (commit "migrar operações de banco do Supabase para o backend"). Autenticação: `Authorization: Bearer <jwt supabase>` validado com `supabase.auth.getUser`. Sem Supabase configurado, o servidor opera em modo de memória (`roomStore` Map).
- **Isolamento de ambientes:** `ROOM_PREFIX` (padrão `dev_` quando `PORT=3002`) prefixa os nomes de sala no LiveKit; use `toLiveKitRoomName` / `fromLiveKitRoomName` / `extractBaseRoomSlug` ao converter slug ↔ nome LiveKit. Em produção, canais de voz usam salas LiveKit separadas com sufixo `_v_{channelId}`.
- `server/src/kms.ts`: envelope encryption (AES-256-GCM) — `MASTER_KEY` (só no backend) cifra a chave simétrica de cada sala. Sem `MASTER_KEY` cai numa chave de dev determinística.
- Modo de manutenção via `MAINTENANCE_MODE` / `ADMIN_BYPASS_TOKEN`.
- Contas guest (`/api/guest/*`, `/api/user/migrate-guest`) migram para conta Google automaticamente no login.

**Frontend (`client/src`):**
- `hooks/useLiveKit.ts` (~1700 linhas) concentra conexão, publicação/assinatura de tracks, screen share, HUD de stats e DataChannels; `hooks/useVoicePresence.ts` e `hooks/usePersistentChat.ts` cuidam de presença de voz e chat persistente. `App.tsx` orquestra tudo.
- `utils/api.ts` resolve a base da API (`VITE_API_URL`; em Electron/`file://` usa `http://127.0.0.1:3001`) — construa URLs por aí, não hardcode.
- `utils/cryptoService.ts`: mensagens são cifradas no navegador (AES-GCM) antes de ir ao banco, com a chave da sala vinda do KMS do backend.
- `context/AuthContext.tsx` + `utils/supabase.ts`: login Google (Supabase Auth / Google Identity Services); `utils/guestStorage.ts` guarda a identidade guest.
- Ruído: RNNoise WASM em `client/public/rnnoise/` + `utils/noiseSuppression.ts`.

## Deploy e branches

- `main` = produção; `develop` = staging. Push em `main`/`develop` dispara GitHub Actions (`.github/workflows/deploy-backend*.yml`) que faz SSH na VPS, `git pull`, `npm run build` e reinicia o PM2 (`backend` na :3001, `backend-dev` na :3002). Só muda se houver alteração em `server/**`.
- Frontend vai para a Vercel (preview em `develop`). `vercel.json` (raiz e `client/`) faz rewrite de `/api/*` para a API na VPS — hoje aponta para o ambiente **dev** (`api-dev...`); confira ao mexer em produção.
- Versão fica em `package.json` da raiz; tags `vX.Y.Z` são pontos de restauração (ver `VERSIONING.md`). Commits seguem Conventional Commits em português (`feat(chat): ...`).
