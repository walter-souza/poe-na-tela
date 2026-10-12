import dotenv from 'dotenv';
import crypto from 'node:crypto';
dotenv.config();

export const PORT = process.env.PORT || 3001;

export const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
export const LIVEKIT_INTERNAL_URL =
  process.env.LIVEKIT_INTERNAL_URL ||
  LIVEKIT_URL.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
export const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
export const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
// Integração com OBS/MediaMTX: desligada por padrão (ENABLE_OBS=true para ligar).
export const OBS_ENABLED = process.env.ENABLE_OBS === 'true';
export const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997';
export const STREAM_BASE_URL = (process.env.STREAM_URL || process.env.VITE_STREAM_URL || 'https://stream.194.61.238.98.sslip.io').replace(/\/$/, '');

// Environment namespace isolation for LiveKit rooms
export const ROOM_PREFIX = process.env.ROOM_PREFIX ?? (String(PORT) === '3002' ? 'dev_' : '');

export function toLiveKitRoomName(slug: string): string {
  return `${ROOM_PREFIX}${slug}`;
}

export function fromLiveKitRoomName(liveKitName: string): string | null {
  if (ROOM_PREFIX) {
    if (liveKitName.startsWith(ROOM_PREFIX)) {
      return liveKitName.slice(ROOM_PREFIX.length);
    }
    return null;
  }
  if (liveKitName.startsWith('dev_')) {
    return null;
  }
  return liveKitName;
}

/**
 * Extrai o slug base da sala a partir do nome da sala no LiveKit.
 * No ambiente de PRODUÇÃO, canais de voz isolados possuem o sufixo `_v_{channelId}`.
 * Em DEV, preserva o comportamento original sem alterações conforme solicitado.
 */
export function extractBaseRoomSlug(liveKitName: string): string | null {
  const unprefixed = fromLiveKitRoomName(liveKitName);
  if (!unprefixed) return null;

  const isDev = ROOM_PREFIX === 'dev_' || String(PORT) === '3002';
  if (isDev) {
    // Não altera o comportamento em ambiente de DEV
    return unprefixed;
  }

  // Em produção: extrai o slug base da sala removendo o sufixo do canal de voz
  const vIndex = unprefixed.indexOf('_v_');
  if (vIndex !== -1) {
    return unprefixed.slice(0, vIndex);
  }
  return unprefixed;
}

// Maintenance Mode Helper
export const isMaintenanceMode = () =>
  process.env.MAINTENANCE_MODE === 'true' || process.env.MAINTENANCE_MODE === '1';
export const getMaintenanceMessage = () =>
  process.env.MAINTENANCE_MESSAGE ||
  'Estamos realizando melhorias e otimizações de infraestrutura. O Põe na Tela voltará em breve!';
// Sem ADMIN_BYPASS_TOKEN definido, o bypass de manutenção fica desativado.
export const ADMIN_BYPASS_TOKEN = process.env.ADMIN_BYPASS_TOKEN || '';

export function isValidBypassToken(provided: unknown): boolean {
  if (!ADMIN_BYPASS_TOKEN || typeof provided !== 'string' || !provided) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(ADMIN_BYPASS_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}
