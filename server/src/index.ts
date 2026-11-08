import { webcrypto } from 'node:crypto';
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
  // @ts-ignore
  globalThis.crypto = webcrypto;
}

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { rateLimit } from 'express-rate-limit';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { createRoomAuth, hashPasscode, safeEqual, streamKeyFor, verifyPasscode } from './auth.js';
import { createClipRouter } from './clips.js';
import { CLIP_BOT_IDENTITY, ClipBufferManager, encodeWav, isClipEnabled, WINDOW_MS } from './clipBuffer.js';

dotenv.config();

/** Sem fallback: com um segredo padrão, qualquer um assinaria tokens válidos. */
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`❌ Variável de ambiente obrigatória ausente: ${name} (veja server/.env.example).`);
    process.exit(1);
  }
  return value;
}

const app = express();
const PORT = process.env.PORT || 3001;
// Atrás do Caddy (mesma máquina): o IP real do cliente vem do X-Forwarded-For do proxy local.
app.set('trust proxy', 'loopback');

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
const LIVEKIT_INTERNAL_URL =
  process.env.LIVEKIT_INTERNAL_URL ||
  LIVEKIT_URL.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
const LIVEKIT_API_KEY = requiredEnv('LIVEKIT_API_KEY');
const LIVEKIT_API_SECRET = requiredEnv('LIVEKIT_API_SECRET');
const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997';
const STREAM_BASE_URL = (process.env.STREAM_URL || process.env.VITE_STREAM_URL || 'https://stream.194.61.238.98.sslip.io').replace(/\/$/, '');

// Maintenance Mode Helper
const isMaintenanceMode = () =>
  process.env.MAINTENANCE_MODE === 'true' || process.env.MAINTENANCE_MODE === '1';
const getMaintenanceMessage = () =>
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
const isValidBypass = (candidate: unknown) =>
  Boolean(ADMIN_BYPASS_TOKEN) && typeof candidate === 'string' && safeEqual(candidate, ADMIN_BYPASS_TOKEN);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

const roomService = new RoomServiceClient(
  LIVEKIT_INTERNAL_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

/**
 * Estado da sessão guardado nos metadados da sala no LiveKit (sobrevive a reinícios do backend e some
 * junto com a sala): `pass` é o hash da senha, `claimedAt` marca quem acabou de criar a sessão.
 */
interface RoomMeta {
  clip?: boolean;
  pass?: string;
  claimedAt?: number;
}

function parseRoomMeta(metadata: string | undefined): RoomMeta {
  try {
    const parsed = metadata ? JSON.parse(metadata) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * O criador recebe o token antes de conectar, e o LiveKit leva alguns segundos para mostrá-lo na sala.
 * Nessa janela a sessão já é dele: quem chega depois precisa da senha que ele definiu.
 */
const CLAIM_GRACE_MS = 60_000;

const roomAuth = createRoomAuth({
  roomService,
  apiKey: LIVEKIT_API_KEY,
  apiSecret: LIVEKIT_API_SECRET,
  sanitizeRoomName,
});

// Força bruta da senha da sala e enxurrada de tokens.
const tokenLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde um minuto e tente de novo.' },
});

/**
 * Unicode-safe sanitization for room names.
 */
function sanitizeRoomName(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[\/\?\\#%<>"'`\r\n\t\0]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 64);
}

function sanitizeUserName(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFC')
    .trim()
    .replace(/[\r\n\t\0]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 32);
}

/**
 * Health check & status endpoint (reports maintenance status)
 */
app.get(['/api/health', '/api/status', '/health', '/status'], (_req: Request, res: Response) => {
  const maintenance = isMaintenanceMode();
  res.json({
    status: maintenance ? 'maintenance' : 'ok',
    maintenance,
    message: maintenance ? getMaintenanceMessage() : undefined,
    livekitUrl: LIVEKIT_URL,
    timestamp: new Date().toISOString(),
    version: '1.6.0',
  });
});

/**
 * Generate a secure JWT AccessToken to join a LiveKit room
 */
app.post(['/api/token', '/token'], tokenLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomName, participantName, isPublisher, passcode, bypassToken } = req.body;

    // Check maintenance mode
    if (isMaintenanceMode()) {
      if (!isValidBypass(bypassToken)) {
        res.status(503).json({
          error: getMaintenanceMessage(),
          maintenance: true,
        });
        return;
      }
    }

    const sanitizedRoom = sanitizeRoomName(roomName as string);
    const sanitizedParticipant = sanitizeUserName(participantName as string);

    if (!sanitizedRoom || !sanitizedParticipant || sanitizedParticipant === CLIP_BOT_IDENTITY) {
      res.status(400).json({ error: 'Nome da sala e nome do participante são obrigatórios e válidos.' });
      return;
    }

    const cleanPasscode = typeof passcode === 'string' && passcode.trim() ? passcode.trim().slice(0, 128) : undefined;

    // Falha fechada: sem confirmar o estado da sala no LiveKit não dá para saber se há senha nem quem está nela.
    let liveRoom: any;
    let participants: any[] = [];
    try {
      [liveRoom] = await listRoomsWithTimeout([sanitizedRoom]);
      // numParticipants demora segundos para refletir quem entrou; listParticipants é imediato.
      if (liveRoom) participants = await listParticipantsWithTimeout(sanitizedRoom);
    } catch (err: any) {
      console.warn('Não foi possível verificar a sala no LiveKit:', err?.message || err);
      res.status(503).json({ error: 'Servidor de chamadas indisponível. Tente de novo em instantes.' });
      return;
    }

    const meta = parseRoomMeta(liveRoom?.metadata);
    const humans = participants.filter((p) => p.identity !== CLIP_BOT_IDENTITY);
    const inSession = humans.length > 0 || (typeof meta.claimedAt === 'number' && Date.now() - meta.claimedAt < CLAIM_GRACE_MS);

    if (inSession) {
      const nameLower = sanitizedParticipant.toLowerCase();
      if (humans.some((p) => p.identity?.toLowerCase() === nameLower || p.name?.toLowerCase() === nameLower)) {
        res.status(409).json({
          error: `O nome "${sanitizedParticipant}" já está em uso nesta sala. Por favor, escolha outro nome para entrar.`,
        });
        return;
      }
      if (meta.pass) {
        if (!cleanPasscode) {
          res.status(403).json({
            error: 'Esta sala é protegida por senha. Por favor, insira a senha para entrar.',
            requiresPasscode: true,
          });
          return;
        }
        if (!(await verifyPasscode(cleanPasscode, meta.pass))) {
          res.status(403).json({ error: 'Senha incorreta para esta sala.' });
          return;
        }
      } else if (cleanPasscode) {
        res.status(403).json({
          error: 'Esta sala já está ativa e é pública (não possui senha). Deixe o campo de senha em branco para entrar.',
        });
        return;
      }
    } else {
      // Sessão nova: quem chega define a senha. A sala vazia pode sobreviver um tempo no LiveKit, então
      // o estado da sessão anterior (senha, clipe) é descartado por inteiro.
      const nextMeta: RoomMeta = {
        clip: false,
        claimedAt: Date.now(),
        ...(cleanPasscode ? { pass: await hashPasscode(cleanPasscode) } : {}),
      };
      try {
        if (!liveRoom) await roomService.createRoom({ name: sanitizedRoom });
        await roomService.updateRoomMetadata(sanitizedRoom, JSON.stringify(nextMeta));
      } catch (err: any) {
        console.warn('Não foi possível registrar a sala no LiveKit:', err?.message || err);
        res.status(503).json({ error: 'Servidor de chamadas indisponível. Tente de novo em instantes.' });
        return;
      }
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: sanitizedParticipant,
      name: sanitizedParticipant,
      ttl: '6h',
    });

    at.addGrant({
      roomJoin: true,
      room: sanitizedRoom,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    res.json({
      token,
      livekitUrl: LIVEKIT_URL,
      roomName: sanitizedRoom,
      identity: sanitizedParticipant,
      isPublisher: Boolean(isPublisher),
      // Senha SRT do OBS/app desktop: só publica no caminho do próprio participante (sala/nome).
      streamKey: streamKeyFor(LIVEKIT_API_SECRET, `${sanitizedRoom}/${sanitizedParticipant}`),
    });
  } catch (err: any) {
    console.error('Error generating token:', err);
    res.status(500).json({ error: 'Falha ao gerar token de acesso' });
  }
});

/**
 * Helper to fetch rooms with a strict 2-second timeout
 */
async function listRoomsWithTimeout(names?: string[]): Promise<any[]> {
  const timeoutPromise = new Promise<any[]>((_, reject) =>
    setTimeout(() => reject(new Error('LiveKit timeout (2s)')), 2000)
  );
  return Promise.race([roomService.listRooms(names), timeoutPromise]);
}

/**
 * Helper to fetch participants in a room with a strict 2-second timeout
 */
async function listParticipantsWithTimeout(roomName: string): Promise<any[]> {
  const timeoutPromise = new Promise<any[]>((_, reject) =>
    setTimeout(() => reject(new Error('LiveKit timeout (2s)')), 2000)
  );
  return Promise.race([roomService.listParticipants(roomName), timeoutPromise]);
}

/**
 * List active rooms with live participant counts and passcode flags
 */
app.get(['/api/rooms', '/rooms'], async (_req: Request, res: Response) => {
  if (isMaintenanceMode()) {
    res.json({ rooms: [], maintenance: true });
    return;
  }

  try {
    const rooms = await listRoomsWithTimeout();
    const activeLiveRooms = Array.isArray(rooms) ? rooms.filter(r => r.numParticipants > 0) : [];

    const result = activeLiveRooms.map(r => ({
      name: r.name,
      numParticipants: r.numParticipants,
      creationTime: Number(r.creationTime),
      hasPasscode: Boolean(parseRoomMeta(r.metadata).pass),
      clipEnabled: isClipEnabled(r.metadata),
    }));
    res.json({ rooms: result });
  } catch (err: any) {
    console.error('Failed to list rooms from LiveKit:', err?.message || err);
    res.json({ rooms: [], warning: 'LiveKit server might not be running yet' });
  }
});

/**
 * Check if a room exists, requires a password, or has active viewers
 */
app.get([
  '/api/room/:roomName/info',
  '/room/:roomName/info',
  '/api/room-info/:roomName',
  '/room-info/:roomName'
], async (req: Request, res: Response) => {
  const roomName = sanitizeRoomName(req.params.roomName);
  let numParticipants = 0;
  let isActive = false;
  let clipEnabled = false;
  let hasPasscode = false;

  try {
    const rooms = await listRoomsWithTimeout([roomName]);
    if (rooms && rooms.length > 0 && rooms[0].numParticipants > 0) {
      isActive = true;
      numParticipants = rooms[0].numParticipants;
      clipEnabled = isClipEnabled(rooms[0].metadata);
      hasPasscode = Boolean(parseRoomMeta(rooms[0].metadata).pass);
    }
  } catch {}

  res.json({
    roomName,
    hasPasscode,
    isActive,
    numParticipants,
    clipEnabled,
  });
});

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

/**
 * List active OBS (SRT / MediaMTX) streams for a specific room (multi-stream squad support)
 */
app.get(['/api/rooms/:roomName/streams', '/rooms/:roomName/streams', '/api/room/:roomName/streams', '/room/:roomName/streams'], roomAuth.requireMember, async (_req: Request, res: Response): Promise<void> => {
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

        // Helper to format clean WHEP URL with unencoded slashes: /teste/aaa/whep
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
app.post('/api/mediamtx/auth', async (req: Request, res: Response): Promise<void> => {
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

// Buffer de vozes para clipes (só RAM, só em salas com o clipe ligado). CLIP_BUFFER=0 desliga.
const clipBuffers = new ClipBufferManager({
  roomService,
  livekitUrl: LIVEKIT_URL,
  apiKey: LIVEKIT_API_KEY,
  apiSecret: LIVEKIT_API_SECRET,
});
if (process.env.CLIP_BUFFER !== '0') void clipBuffers.start();

// Clipes prontos (vídeo do cliente + vozes do buffer) para preview e download.
app.use(
  createClipRouter({ roomService, clipBuffers, roomAuth }),
);

// Rotas de depuração do buffer: expõem áudio da sala sem autenticação, então só existem com CLIP_DEBUG=1.
if (process.env.CLIP_DEBUG === '1') {
  app.get('/api/debug/clip-buffers', (_req: Request, res: Response) => {
    res.json(clipBuffers.status());
  });
  app.get('/api/debug/rooms/:roomName/voices.wav', (req: Request, res: Response) => {
    const rec = clipBuffers.get(sanitizeRoomName(req.params.roomName));
    if (!rec) {
      res.status(404).json({ error: 'Sem buffer ativo para esta sala (ninguém ativou o clipe).' });
      return;
    }
    const seconds = Math.max(1, Math.min(WINDOW_MS / 1000, Number(req.query.seconds) || 30));
    res.type('audio/wav').send(encodeWav(rec.mix(seconds)));
  });
}

// Só escuta na máquina local (o Caddy faz o TLS); HOST=0.0.0.0 para expor direto (ex.: Docker).
app.listen(Number(PORT), process.env.HOST || '127.0.0.1', () => {
  console.log(`🚀 Põe na Tela — Servidor rodando em http://localhost:${PORT}`);
  console.log(`📡 Conectado ao LiveKit em: ${LIVEKIT_URL}`);
  if (isMaintenanceMode()) {
    console.log(`⚠️ MODO DE MANUTENÇÃO ATIVADO! (${getMaintenanceMessage()})`);
  }
});
