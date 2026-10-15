import { isDesktop } from './desktop';

/**
 * Resolves API endpoints dynamically for Web and Desktop (Electron file://) environments.
 */
export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && (window.location.protocol === 'file:')) {
    return 'http://127.0.0.1:3001';
  }
  // No app desktop (Tauri) não há proxy '/api': usa o backend de produção quando VITE_API_URL não foi definida.
  if (isDesktop && !import.meta.env.DEV) {
    return 'https://api.194.61.238.98.sslip.io';
  }
  return '/api';
}

export function getRoomsUrl(): string {
  const base = getApiBaseUrl();
  return base.endsWith('/api') ? `${base}/rooms` : `${base}/api/rooms`;
}

export function getTokenUrl(): string {
  const base = getApiBaseUrl();
  return base.endsWith('/api') ? `${base}/token` : `${base}/api/token`;
}

export function getHealthUrl(): string {
  const base = getApiBaseUrl();
  return base.endsWith('/api') ? `${base}/health` : `${base}/api/health`;
}

export function getRoomInfoUrl(roomName: string): string {
  const base = getApiBaseUrl();
  const endpoint = base.endsWith('/api') ? `${base}/room-info` : `${base}/api/room-info`;
  return `${endpoint}/${encodeURIComponent(roomName)}`;
}

export function getWhepUrl(roomName: string): string {
  const envUrl = import.meta.env.VITE_STREAM_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return `${envUrl.replace(/\/$/, '')}/${encodeURIComponent(roomName)}/whep`;
  }
  // Fallback padrão seguro (HTTPS) apontando para o proxy reverso do MediaMTX
  return `https://stream.194.61.238.98.sslip.io/${encodeURIComponent(roomName)}/whep`;
}

export const OBS_SRT_LATENCY_US = 250000;

/**
 * Returns the ready-to-use SRT streaming URL for OBS Studio.
 * When userName is provided, builds a squad multi-stream streamid (e.g. srt://host:8890?streamid=publish:sala/usuario).
 */
export function getObsSrtUrl(roomName: string, userName?: string): string {
  const srtHost = import.meta.env.VITE_SRT_HOST || '194.61.238.98:8890';
  const cleanRoom = roomName.trim();
  const cleanUser = userName ? userName.trim() : '';
  const path = cleanUser ? `${cleanRoom}/${cleanUser}` : cleanRoom;
  // Latency (µs): 250 ms absorbs the ~2-3% loss seen on home uplinks; MediaMTX's 120 ms default drops late packets.
  return `srt://${srtHost}?streamid=publish:${path}&latency=${OBS_SRT_LATENCY_US}`;
}

export interface ObsStreamItem {
  id: string;
  name: string;
  path: string;
  whepUrl: string;
}

export function getRoomStreamsUrl(roomName: string): string {
  const base = getApiBaseUrl();
  const endpoint = base.endsWith('/api') ? `${base}/rooms` : `${base}/api/rooms`;
  return `${endpoint}/${encodeURIComponent(roomName)}/streams`;
}

export async function fetchRoomStreams(roomName: string): Promise<ObsStreamItem[]> {
  try {
    const res = await fetch(getRoomStreamsUrl(roomName));
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.streams)) {
        return data.streams;
      }
    }
  } catch {}
  return [];
}

