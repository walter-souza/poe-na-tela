import { MEDIAMTX_API_URL, OBS_ENABLED, STREAM_BASE_URL } from '../config';
import { sanitizeRoomName } from '../sanitize';
import { isSupabaseConfigured, supabase } from '../supabase';

/**
 * Helper: Obter lista de streams ativos do MediaMTX para uma sala
 */
export async function getActiveRoomStreams(roomName: string): Promise<Array<{
  id: string;
  name: string;
  path: string;
  whepUrl: string;
}>> {
  const streams: Array<{
    id: string;
    name: string;
    path: string;
    whepUrl: string;
  }> = [];

  if (!OBS_ENABLED) return streams;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const mtxRes = await fetch(`${MEDIAMTX_API_URL}/v3/paths/list`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (mtxRes.ok) {
      const data: any = await mtxRes.json();
      const items = Array.isArray(data.items) ? data.items : [];

      for (const item of items) {
        if (!item || !item.name || !item.ready) continue;
        const itemPath = String(item.name).trim();

        const lowerPath = itemPath.toLowerCase();
        const lowerRoom = roomName.toLowerCase();

        // Helper to format clean WHEP URL with unencoded slashes: /teste/aaa/whep
        const cleanWhepUrl = `${STREAM_BASE_URL}/${itemPath.split('/').map(encodeURIComponent).join('/')}/whep`;

        // 1. Single / default stream (e.g. "jogatina" ou "teste")
        if (lowerPath === lowerRoom) {
          streams.push({
            id: 'main',
            name: 'Principal',
            path: itemPath,
            whepUrl: cleanWhepUrl,
          });
        }
        // 2. Sub-path multi-stream (e.g. "jogatina/pedro" ou "jogatina-pedro")
        else if (lowerPath.startsWith(`${lowerRoom}/`) || lowerPath.startsWith(`${lowerRoom}-`)) {
          const rawId = itemPath.slice(roomName.length + 1);

          if (rawId) {
            const formattedName = decodeURIComponent(rawId)
              .replace(/[-_]/g, ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase());

            streams.push({
              id: rawId.toLowerCase(),
              name: formattedName || rawId,
              path: itemPath,
              whepUrl: cleanWhepUrl,
            });
          }
        }
      }
    }
  } catch {
    // MediaMTX API offline or unreachable, return empty array gracefully
  }

  return streams;
}

/**
 * Notifica os clientes da sala sobre a lista atual de streams OBS via Supabase Realtime.
 * Usa envio REST (httpSend) e remove o canal depois, para não acumular canais no cliente Realtime.
 */
export async function broadcastRoomStreams(roomSlug: string): Promise<void> {
  if (!isSupabaseConfigured() || !supabase) return;
  const streams = await getActiveRoomStreams(roomSlug);
  const chan = supabase.channel(`room-streams:${roomSlug}`);
  try {
    await chan.httpSend('streams_updated', { streams });
  } catch {
    // Realtime indisponível: o cliente reconcilia no próximo refresh.
  } finally {
    supabase.removeChannel(chan).catch(() => {});
  }
}

export function roomSlugFromStreamPath(path: unknown): string {
  return sanitizeRoomName(String(path ?? '').split(/[\/-]/)[0]);
}

// Reconciliação de segurança: o webhook é o caminho principal; este monitor só cobre eventos perdidos.
// Notifica apenas as salas cujos streams mudaram desde a última verificação (sem consultar o banco).
const MTX_RECONCILE_INTERVAL_MS = Number(process.env.MEDIAMTX_RECONCILE_MS) || 15_000;
let lastReadyPaths: Set<string> | null = null;
export function startStreamsMonitor(): void {
  if (!OBS_ENABLED) return;
  setInterval(async () => {
  if (!isSupabaseConfigured() || !supabase) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const mtxRes = await fetch(`${MEDIAMTX_API_URL}/v3/paths/list`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!mtxRes.ok) return;
    const data: any = await mtxRes.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const current = new Set<string>(
      items.filter((i: any) => i && i.name && i.ready).map((i: any) => String(i.name))
    );

    // Primeira leitura só registra o estado inicial.
    if (lastReadyPaths) {
      const affectedRooms = new Set<string>();
      for (const name of current) if (!lastReadyPaths.has(name)) affectedRooms.add(roomSlugFromStreamPath(name));
      for (const name of lastReadyPaths) if (!current.has(name)) affectedRooms.add(roomSlugFromStreamPath(name));
      affectedRooms.delete('');
      for (const slug of affectedRooms) await broadcastRoomStreams(slug);
    }
    lastReadyPaths = current;
  } catch (err) {
    if (process.env.DEBUG_MEDIAMTX) console.warn('[MediaMTX] Monitor falhou:', err);
  }
  }, MTX_RECONCILE_INTERVAL_MS);
}
