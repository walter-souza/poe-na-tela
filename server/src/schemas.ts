import { z } from 'zod';

/**
 * Schemas de entrada das rotas. São intencionalmente tolerantes (campos opcionais aceitam null):
 * validam tipo e tamanho; regras de negócio e mensagens específicas continuam nos handlers.
 */
const optionalString = (max: number) => z.string().max(max).nullish();

export const tokenBody = z.object({
  roomName: z.string().max(500),
  participantName: z.string().max(500),
  isPublisher: z.boolean().nullish(),
  passcode: optionalString(256),
  bypassToken: optionalString(256),
  voiceChannelId: optionalString(128),
  avatarUrl: optionalString(2048),
});

export const createRoomBody = z.object({
  name: optionalString(500),
  slug: optionalString(500),
  passcode: optionalString(256),
});

export const joinRoomBody = z.object({
  passcode: optionalString(256),
});

export const createChannelBody = z.object({
  name: optionalString(500),
  type: optionalString(20),
});

export const updateProfileBody = z.object({
  username: optionalString(500),
  avatar_url: optionalString(2048),
});

export const guestSyncBody = z.object({
  recoveryCode: optionalString(64),
  nickname: optionalString(500),
  avatarUrl: optionalString(2048),
  rooms: z.array(z.object({}).passthrough()).max(200).nullish(),
});

export const migrateGuestBody = z.object({
  recoveryCode: optionalString(64),
  guestRooms: z.array(z.any()).max(200).nullish(),
});

export const voiceDisconnectBody = z.object({
  identity: z.string().min(1).max(500),
});
