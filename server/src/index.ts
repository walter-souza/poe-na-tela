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
    const { roomName, participantName, isPublisher, passcode, createIfMissing } = req.body;

    if (!roomName || !participantName) {
      res.status(400).json({ error: 'roomName and participantName are required' });
      return;
    }

    const sanitizedRoom = (roomName as string).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const sanitizedParticipant = (participantName as string).trim();

    // Check passcode protection if room exists
    const existingConfig = roomStore.get(sanitizedRoom);
    if (existingConfig && existingConfig.passcode) {
      if (existingConfig.passcode !== passcode) {
        res.status(403).json({ error: 'Senha incorreta para esta sala.' });
        return;
      }
    } else if (createIfMissing && passcode) {
      roomStore.set(sanitizedRoom, {
        name: sanitizedRoom,
        passcode,
        hostIdentity: sanitizedParticipant,
        createdAt: Date.now()
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
    res.status(500).json({ error: 'Failed to generate token', details: err.message });
  }
});

/**
 * List active rooms
 */
app.get('/api/rooms', async (req: Request, res: Response) => {
  try {
    const rooms = await roomService.listRooms();
    const result = rooms.map(r => ({
      name: r.name,
      numParticipants: r.numParticipants,
      creationTime: Number(r.creationTime),
      hasPasscode: roomStore.has(r.name) && Boolean(roomStore.get(r.name)?.passcode)
    }));
    res.json({ rooms: result });
  } catch (err: any) {
    // If livekit isn't reachable yet, return empty list gracefully
    res.json({ rooms: [], warning: 'LiveKit server might not be running yet' });
  }
});

/**
 * Check if a room requires a password
 */
app.get('/api/room/:roomName/info', (req: Request, res: Response) => {
  const roomName = req.params.roomName.trim().toLowerCase();
  const config = roomStore.get(roomName);
  res.json({
    roomName,
    hasPasscode: Boolean(config?.passcode),
    isConfigured: Boolean(config)
  });
});

app.listen(PORT, () => {
  console.log(`🚀 StreamPulse Server running on http://localhost:${PORT}`);
  console.log(`📡 Connected to LiveKit at: ${LIVEKIT_URL}`);
});
