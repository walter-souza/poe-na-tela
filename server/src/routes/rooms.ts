import { Router, type Request, type Response } from 'express';
import { isClipEnabled } from '../clipBuffer.js';
import { isMaintenanceMode } from '../config.js';
import { listRoomsWithTimeout } from '../livekit.js';
import { parseRoomMeta, sanitizeRoomName } from '../room.js';

export const roomsRouter = Router();

/** Salas ativas com contagem de participantes e indicação de senha/clipe. */
roomsRouter.get(['/api/rooms', '/rooms'], async (_req: Request, res: Response) => {
  if (isMaintenanceMode()) {
    res.json({ rooms: [], maintenance: true });
    return;
  }

  try {
    const rooms = await listRoomsWithTimeout();
    const activeLiveRooms = Array.isArray(rooms) ? rooms.filter((r) => r.numParticipants > 0) : [];

    const result = activeLiveRooms.map((r) => ({
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

/** Se a sala existe, pede senha ou tem gente nela. */
roomsRouter.get([
  '/api/room/:roomName/info',
  '/room/:roomName/info',
  '/api/room-info/:roomName',
  '/room-info/:roomName',
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
