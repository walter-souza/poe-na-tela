/**
 * Resolves API endpoints dynamically for Web and Desktop (Electron file://) environments.
 */
export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && (window.location.protocol === 'file:' || window.desktopAPI?.isDesktop)) {
    return 'http://127.0.0.1:3001';
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

