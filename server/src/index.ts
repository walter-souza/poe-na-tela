import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { LiveKitPoolManager } from './pool';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const pool = new LiveKitPoolManager();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

/**
 * Unicode-safe sanitization for room names.
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
 * Health check endpoint - lists loaded projects (without secrets)
 */
app.get('/api/health', (_req: Request, res: Response) => {
  const projects = pool.getProjects().map(p => ({
    id: p.id,
    name: p.name,
    url: p.url,
    priority: p.priority,
    maxParticipants: p.maxParticipants,
    isActive: p.isActive,
  }));

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    totalProjects: projects.length,
    projects,
  });
});

/**
 * List available projects in the pool for display
 */
app.get('/api/projects', (_req: Request, res: Response) => {
  const projects = pool.getSortedActiveProjects().map(p => ({
    id: p.id,
    name: p.name,
    priority: p.priority,
  }));
  res.json({ projects });
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

    // 1. Get the project assigned to this room (or route to available project)
    const project = await pool.getProjectForRoom(sanitizedRoom);

    // 2. Check if room is active on the assigned project
    let isActiveInLiveKit = false;
    try {
      const client = pool.getRoomServiceClient(project);
      const existingLiveRooms = await client.listRooms([sanitizedRoom]);
      if (existingLiveRooms && existingLiveRooms.length > 0 && existingLiveRooms[0].numParticipants > 0) {
        isActiveInLiveKit = true;
      }
    } catch {
      // Fallback to in-memory metadata
    }

    const existingMeta = pool.getRoomMetadata(sanitizedRoom);

    if (isActiveInLiveKit && existingMeta) {
      // Room has existing session
      if (existingMeta.passcode) {
        if (!cleanPasscode) {
          res.status(403).json({
            error: 'Esta sala é protegida por senha. Por favor, insira a senha para entrar.',
            requiresPasscode: true,
          });
          return;
        }
        if (existingMeta.passcode !== cleanPasscode) {
          res.status(403).json({ error: 'Senha incorreta para esta sala.' });
          return;
        }
      } else {
        if (cleanPasscode) {
          res.status(403).json({
            error: 'Esta sala já está ativa e é pública (não possui senha). Deixe o campo de senha em branco para entrar.',
          });
          return;
        }
      }
    } else {
      // Create fresh room metadata
      pool.setRoomMetadata(sanitizedRoom, {
        name: sanitizedRoom,
        passcode: cleanPasscode,
        hostIdentity: sanitizedParticipant,
        projectId: project.id,
        createdAt: Date.now(),
      });
    }

    // 3. Generate token using project credentials
    const token = await pool.createAccessToken(
      project,
      sanitizedRoom,
      sanitizedParticipant,
      Boolean(isPublisher)
    );

    res.json({
      token,
      livekitUrl: project.url,
      projectId: project.id,
      projectName: project.name,
      roomName: sanitizedRoom,
      identity: sanitizedParticipant,
      isPublisher: Boolean(isPublisher),
    });
  } catch (err: any) {
    console.error('Error generating token:', err);
    res.status(500).json({ error: 'Falha ao gerar token de acesso', details: err.message });
  }
});

const handleMigrateRoom = async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomName, targetProjectId, currentProjectId, passcode } = req.body;
    const sanitizedRoom = sanitizeRoomName(roomName as string);

    if (!sanitizedRoom) {
      res.status(400).json({ error: 'Nome da sala inválido' });
      return;
    }

    // Verify passcode if room is protected
    const existingMeta = pool.getRoomMetadata(sanitizedRoom);
    if (existingMeta && existingMeta.passcode) {
      const cleanPasscode = typeof passcode === 'string' ? passcode.trim() : undefined;
      if (existingMeta.passcode !== cleanPasscode) {
        res.status(403).json({ error: 'Senha incorreta para migrar esta sala' });
        return;
      }
    }

    const nextProject = await pool.migrateRoom(sanitizedRoom, targetProjectId, currentProjectId);

    res.json({
      success: true,
      roomName: sanitizedRoom,
      targetProjectId: nextProject.id,
      targetProjectName: nextProject.name,
      targetWsUrl: nextProject.url,
    });
  } catch (err: any) {
    console.error('Error migrating room:', err);
    res.status(500).json({ error: 'Falha ao migrar sala', details: err.message });
  }
};

app.post('/api/room/migrate', handleMigrateRoom);
app.post('/api/migrate-room', handleMigrateRoom);

/**
 * List active rooms across all LiveKit projects in the pool
 */
app.get('/api/rooms', async (_req: Request, res: Response) => {
  try {
    const rooms = await pool.listAllActiveRooms();
    res.json({ rooms });
  } catch (err: any) {
    res.json({ rooms: [], warning: 'Erro ao consultar projetos LiveKit', details: err.message });
  }
});

/**
 * Check if a room exists, requires a password, or has active viewers
 */
app.get('/api/room/:roomName/info', async (req: Request, res: Response) => {
  const roomName = sanitizeRoomName(req.params.roomName);
  let numParticipants = 0;
  let isActive = false;
  let currentProjectName = '';

  try {
    const project = await pool.getProjectForRoom(roomName);
    currentProjectName = project.name;
    const client = pool.getRoomServiceClient(project);
    const rooms = await client.listRooms([roomName]);
    if (rooms && rooms.length > 0 && rooms[0].numParticipants > 0) {
      isActive = true;
      numParticipants = rooms[0].numParticipants;
    } else {
      pool.deleteRoomMetadata(roomName);
    }
  } catch {}

  const meta = pool.getRoomMetadata(roomName);

  res.json({
    roomName,
    hasPasscode: isActive && Boolean(meta?.passcode),
    isActive,
    numParticipants,
    projectName: currentProjectName,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Põe na Tela — Servidor rodando em http://localhost:${PORT}`);
});
