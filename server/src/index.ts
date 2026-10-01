import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// In-memory room store for passcodes and custom room settings
interface RoomConfig {
  name: string;
  passcode?: string;
  hostIdentity?: string;
  createdAt: number;
}
const roomStore = new Map<string, RoomConfig>();

const roomService = new RoomServiceClient(LIVEKIT_URL.replace('ws://', 'http://').replace('wss://', 'https://'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

/**
 * Unicode-safe sanitization for room names.
 * Preserves accented characters (é, ã, ç, etc.), international alphabets, and spaces,
 * while stripping unsafe URL/control characters and normalizing whitespace.
 */
function sanitizeRoomName(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFC')
    .trim()
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
 * Health check endpoint
 */
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    livekitUrl: LIVEKIT_URL,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

/**
 * Generate a secure JWT AccessToken to join a LiveKit room
 */
app.post('/api/token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomName, participantName, isPublisher, passcode } = req.body;

    const sanitizedRoom = sanitizeRoomName(roomName as string);
    const sanitizedParticipant = sanitizeUserName(participantName as string);

    if (!sanitizedRoom || !sanitizedParticipant) {
      res.status(400).json({ error: 'Nome da sala e nome do participante são obrigatórios e válidos.' });
      return;
    }

    const cleanPasscode = typeof passcode === 'string' && passcode.trim() ? passcode.trim() : undefined;

    // 1. Check if room is currently active in LiveKit
    let isActiveInLiveKit = false;
    try {
      const existingLiveRooms = await roomService.listRooms([sanitizedRoom]);
      if (existingLiveRooms && existingLiveRooms.length > 0 && existingLiveRooms[0].numParticipants > 0) {
        isActiveInLiveKit = true;
      }
    } catch {
      // If LiveKit is momentarily unreachable, fallback to roomStore state
    }

    const existingConfig = roomStore.get(sanitizedRoom);

    if (isActiveInLiveKit && existingConfig) {
      // Room is actively in session
      if (existingConfig.passcode) {
        // Room has a passcode
        if (!cleanPasscode) {
          res.status(403).json({
            error: 'Esta sala é protegida por senha. Por favor, insira a senha para entrar.',
            requiresPasscode: true,
          });
          return;
        }
        if (existingConfig.passcode !== cleanPasscode) {
          res.status(403).json({ error: 'Senha incorreta para esta sala.' });
          return;
        }
      } else {
        // Room is public (no passcode)
        if (cleanPasscode) {
          res.status(403).json({
            error: 'Esta sala já está ativa e é pública (não possui senha). Deixe o campo de senha em branco para entrar.',
          });
          return;
        }
      }
    } else {
      // Room is brand new (or previous session ended and is being recreated)
      roomStore.set(sanitizedRoom, {
        name: sanitizedRoom,
        passcode: cleanPasscode,
        hostIdentity: sanitizedParticipant,
        createdAt: Date.now(),
      });
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
    });
  } catch (err: any) {
    console.error('Error generating token:', err);
    res.status(500).json({ error: 'Falha ao gerar token de acesso', details: err.message });
  }
});

/**
 * List active rooms with live participant counts and passcode flags
 */
app.get('/api/rooms', async (req: Request, res: Response) => {
  try {
    const rooms = await roomService.listRooms();
    const activeLiveRooms = rooms.filter(r => r.numParticipants > 0);
    const activeNames = new Set(activeLiveRooms.map(r => r.name));

    // Clean up dead rooms from memory store
    for (const [name] of roomStore.entries()) {
      if (!activeNames.has(name)) {
        roomStore.delete(name);
      }
    }

    const result = activeLiveRooms.map(r => ({
      name: r.name,
      numParticipants: r.numParticipants,
      creationTime: Number(r.creationTime),
      hasPasscode: roomStore.has(r.name) && Boolean(roomStore.get(r.name)?.passcode)
    }));
    res.json({ rooms: result });
  } catch (err: any) {
    res.json({ rooms: [], warning: 'LiveKit server might not be running yet' });
  }
});

/**
 * Check if a room exists, requires a password, or has active viewers
 */
app.get('/api/room/:roomName/info', async (req: Request, res: Response) => {
  const roomName = sanitizeRoomName(req.params.roomName);
  let numParticipants = 0;
  let isActive = false;

  try {
    const rooms = await roomService.listRooms([roomName]);
    if (rooms && rooms.length > 0 && rooms[0].numParticipants > 0) {
      isActive = true;
      numParticipants = rooms[0].numParticipants;
    } else {
      roomStore.delete(roomName);
    }
  } catch {}

  const config = roomStore.get(roomName);

  res.json({
    roomName,
    hasPasscode: isActive && Boolean(config?.passcode),
    isActive,
    numParticipants,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Põe na Tela — Servidor rodando em http://localhost:${PORT}`);
  console.log(`📡 Conectado ao LiveKit em: ${LIVEKIT_URL}`);
});
