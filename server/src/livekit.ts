import { RoomServiceClient } from 'livekit-server-sdk';
import { createRoomAuth } from './auth.js';
import { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_INTERNAL_URL } from './config.js';
import { sanitizeRoomName } from './room.js';

export const roomService = new RoomServiceClient(LIVEKIT_INTERNAL_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

export const roomAuth = createRoomAuth({
  roomService,
  apiKey: LIVEKIT_API_KEY,
  apiSecret: LIVEKIT_API_SECRET,
  sanitizeRoomName,
});

const LIVEKIT_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LiveKit timeout (2s)')), LIVEKIT_TIMEOUT_MS),
  );
  return Promise.race([promise, timeout]);
}

export function listRoomsWithTimeout(names?: string[]) {
  return withTimeout(roomService.listRooms(names));
}

export function listParticipantsWithTimeout(roomName: string) {
  return withTimeout(roomService.listParticipants(roomName));
}
