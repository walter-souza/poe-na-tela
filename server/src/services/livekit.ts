import { RoomServiceClient } from 'livekit-server-sdk';
import { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_INTERNAL_URL } from '../config';

export const roomService = new RoomServiceClient(
  LIVEKIT_INTERNAL_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

/**
 * Helper to fetch rooms with a strict 2-second timeout
 */
export async function listRoomsWithTimeout(names?: string[]): Promise<any[]> {
  const timeoutPromise = new Promise<any[]>((_, reject) =>
    setTimeout(() => reject(new Error('LiveKit timeout (2s)')), 2000)
  );
  return Promise.race([roomService.listRooms(names), timeoutPromise]);
}

/**
 * Helper to fetch participants in a room with a strict 2-second timeout
 */
export async function listParticipantsWithTimeout(roomName: string): Promise<any[]> {
  const timeoutPromise = new Promise<any[]>((_, reject) =>
    setTimeout(() => reject(new Error('LiveKit timeout (2s)')), 2000)
  );
  return Promise.race([roomService.listParticipants(roomName), timeoutPromise]);
}
