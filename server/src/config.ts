// Primeiro import do index.ts: carrega o .env antes de qualquer módulo ler process.env no topo
// (clips.ts lê CLIP_DIR, CLIP_TTL_MIN, CLIP_VOICE_DELAY_MS e FFMPEG_PATH ao ser carregado).
import 'dotenv/config';
import { safeEqual } from './auth.js';

/** Sem fallback: com um segredo padrão, qualquer um assinaria tokens válidos. */
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`❌ Variável de ambiente obrigatória ausente: ${name} (veja server/.env.example).`);
    process.exit(1);
  }
  return value;
}

export const PORT = Number(process.env.PORT || 3001);
// Só escuta na máquina local (o Caddy faz o TLS); HOST=0.0.0.0 para expor direto (ex.: Docker).
export const HOST = process.env.HOST || '127.0.0.1';

export const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
export const LIVEKIT_INTERNAL_URL =
  process.env.LIVEKIT_INTERNAL_URL ||
  LIVEKIT_URL.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
export const LIVEKIT_API_KEY = requiredEnv('LIVEKIT_API_KEY');
export const LIVEKIT_API_SECRET = requiredEnv('LIVEKIT_API_SECRET');

export const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997';
export const STREAM_BASE_URL = (process.env.STREAM_URL || process.env.VITE_STREAM_URL || 'https://stream.194.61.238.98.sslip.io').replace(/\/$/, '');

export const CLIP_BUFFER_ENABLED = process.env.CLIP_BUFFER !== '0';
/** Rotas de depuração do buffer de clipes: expõem áudio da sala sem autenticação. */
export const CLIP_DEBUG = process.env.CLIP_DEBUG === '1';

// Lidos a cada chamada: o modo de manutenção pode mudar com `pm2 restart --update-env`.
export const isMaintenanceMode = () =>
  process.env.MAINTENANCE_MODE === 'true' || process.env.MAINTENANCE_MODE === '1';
export const getMaintenanceMessage = () =>
  process.env.MAINTENANCE_MESSAGE ||
  'Estamos realizando melhorias e otimizações de infraestrutura. O Põe na Tela voltará em breve!';

/** Token de acesso durante a manutenção. Ausente ou curto demais (adivinhável), o acesso fica desligado. */
const MIN_BYPASS_LENGTH = 16;
const ADMIN_BYPASS_TOKEN = (() => {
  const token = process.env.ADMIN_BYPASS_TOKEN?.trim() || '';
  if (token && token.length < MIN_BYPASS_LENGTH) {
    console.warn(`⚠️ ADMIN_BYPASS_TOKEN com menos de ${MIN_BYPASS_LENGTH} caracteres: acesso de manutenção desligado.`);
    return '';
  }
  return token;
})();
export const isValidBypass = (candidate: unknown) =>
  Boolean(ADMIN_BYPASS_TOKEN) && typeof candidate === 'string' && safeEqual(candidate, ADMIN_BYPASS_TOKEN);

/**
 * Só o próprio app chama a API: o site na Vercel (produção e previews, via rewrite de /api), o app
 * desktop (Tauri) e o Vite local. Requisições sem Origin (MediaMTX, curl) não dependem de CORS.
 */
export const ALLOWED_ORIGINS: (string | RegExp)[] = [
  'https://poe-na-tela.vercel.app',
  /^https:\/\/poe-na-tela-[a-z0-9-]+-walter-souzas-projects\.vercel\.app$/,
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  /^http:\/\/(localhost|127\.0\.0\.1):\d+$/,
];
