import { Router, type Request, type Response } from 'express';
import { safeEqual, streamKeyFor } from '../auth.js';
import { LIVEKIT_API_SECRET, MEDIAMTX_API_URL, STREAM_BASE_URL } from '../config.js';
import { roomAuth } from '../livekit.js';
import { sanitizeRoomName } from '../room.js';

/** Streams SRT (OBS e app desktop) que o MediaMTX recebe, e a autorização que ele delega ao backend. */
export const streamsRouter = Router();

// MediaMTX only reports a running byte counter per path; the bitrate is the delta between two polls.
const pathByteSamples = new Map<string, { bytes: number; at: number }>();

function measureBitrateKbps(pathName: string, item: any): number | undefined {
  const bytes = Number(item.inboundBytes ?? item.bytesReceived);
  if (!Number.isFinite(bytes)) return undefined;
  const now = Date.now();
  const prev = pathByteSamples.get(pathName);
  pathByteSamples.set(pathName, { bytes, at: now });
  if (!prev || now <= prev.at || bytes < prev.bytes) return undefined;
  return Math.round(((bytes - prev.bytes) * 8) / (now - prev.at));
}

/** Streams ativos de uma sala: o principal (`sala`) e um por participante (`sala/usuario`). */
streamsRouter.get(['/api/rooms/:roomName/streams', '/rooms/:roomName/streams', '/api/room/:roomName/streams', '/room/:roomName/streams'], roomAuth.requireMember, async (_req: Request, res: Response): Promise<void> => {
  const { roomName } = res.locals as { roomName: string };

  const streams: Array<{
    id: string;
    name: string;
    path: string;
    whepUrl: string;
    bitrateKbps?: number;
  }> = [];

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

        // WHEP URL with unencoded slashes: /teste/aaa/whep
        const cleanWhepUrl = `${STREAM_BASE_URL}/${itemPath.split('/').map(encodeURIComponent).join('/')}/whep`;

        // 1. Single / default stream (e.g. "jogatina" ou "teste")
        if (lowerPath === lowerRoom) {
          streams.push({
            id: 'main',
            name: 'Principal',
            path: itemPath,
            whepUrl: cleanWhepUrl,
            bitrateKbps: measureBitrateKbps(itemPath, item),
          });
        }
        // 2. Sub-path multi-stream (e.g. "jogatina/pedro"). Só "/": com "-", a sala "jogo" listaria a sala "jogo-secreto".
        else if (lowerPath.startsWith(`${lowerRoom}/`)) {
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
              bitrateKbps: measureBitrateKbps(itemPath, item),
            });
          }
        }
      }
      // Forget paths that went offline so a restarted stream does not diff against stale bytes.
      const readyPaths = new Set(items.filter((i: any) => i?.ready).map((i: any) => String(i.name).trim()));
      for (const key of pathByteSamples.keys()) if (!readyPaths.has(key)) pathByteSamples.delete(key);
    }
  } catch {
    // MediaMTX API offline or unreachable, return empty array gracefully
  }

  res.json({
    roomName,
    streams,
    count: streams.length,
  });
});

/**
 * Autorização do MediaMTX (authMethod: http). Só o MediaMTX local chama esta rota.
 *  - publish: só no caminho `sala/nome`, com a chave SRT entregue a esse participante em /api/token;
 *  - read (WHEP): token LiveKit de quem está na sala agora (Authorization: Bearer no navegador).
 * Qualquer resposta diferente de 200 nega o acesso.
 */
streamsRouter.post('/api/mediamtx/auth', async (req: Request, res: Response): Promise<void> => {
  const remote = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) || req.header('x-forwarded-for')) {
    res.sendStatus(403);
    return;
  }
  const { action, path, password, token } = req.body ?? {};
  const segments = typeof path === 'string' ? path.split('/') : [];
  const room = segments[0] ?? '';

  if (action === 'publish') {
    const ok = segments.length === 2 && typeof password === 'string' && safeEqual(password, streamKeyFor(LIVEKIT_API_SECRET, path));
    res.sendStatus(ok ? 200 : 401);
    return;
  }
  if (action === 'read') {
    const ok = Boolean(room) && room === sanitizeRoomName(room) && Boolean(await roomAuth.memberIdentity(token, room));
    res.sendStatus(ok ? 200 : 401);
    return;
  }
  res.sendStatus(401);
});
