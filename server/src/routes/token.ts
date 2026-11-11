import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AccessToken } from 'livekit-server-sdk';
import { hashPasscode, streamKeyFor, verifyPasscode } from '../auth.js';
import { CLIP_BOT_IDENTITY } from '../clipBuffer.js';
import {
  getMaintenanceMessage,
  isMaintenanceMode,
  isValidBypass,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  LIVEKIT_URL,
} from '../config.js';
import { listParticipantsWithTimeout, listRoomsWithTimeout, roomService } from '../livekit.js';
import { parseRoomMeta, sanitizeRoomName, sanitizeUserName, type RoomMeta } from '../room.js';

export const tokenRouter = Router();

/**
 * O criador recebe o token antes de conectar, e o LiveKit leva alguns segundos para mostrá-lo na sala.
 * Nessa janela a sessão já é dele: quem chega depois precisa da senha que ele definiu.
 */
const CLAIM_GRACE_MS = 60_000;

// Força bruta da senha da sala e enxurrada de tokens.
const tokenLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde um minuto e tente de novo.' },
});

// Tentativas que falharam (senha errada, nome em uso...) por sala, venham de onde vierem.
const tokenRoomLimiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 30,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `room:${sanitizeRoomName(String(req.body?.roomName ?? ''))}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas nesta sala. Aguarde alguns minutos e tente de novo.' },
});

/** Gera o token LiveKit para entrar na sala (cria a sessão e define a senha, se for o primeiro). */
tokenRouter.post(['/api/token', '/token'], tokenLimiter, tokenRoomLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomName, participantName, isPublisher, passcode, bypassToken } = req.body;

    if (isMaintenanceMode() && !isValidBypass(bypassToken)) {
      res.status(503).json({
        error: getMaintenanceMessage(),
        maintenance: true,
      });
      return;
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
