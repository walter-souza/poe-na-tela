import { describe, expect, it } from 'vitest';
import { createChannelBody, createRoomBody, guestSyncBody, tokenBody, voiceDisconnectBody } from '../src/schemas';

describe('schemas de entrada', () => {
  it('token: aceita o corpo real do cliente (campos extras e null)', () => {
    const parsed = tokenBody.parse({
      roomName: 'sala',
      participantName: 'ana',
      isPublisher: false,
      passcode: undefined,
      bypassToken: null,
      avatarUrl: null,
      createIfMissing: true,
    });
    expect(parsed).not.toHaveProperty('createIfMissing');
  });

  it('token: rejeita tipos errados e tamanhos absurdos', () => {
    expect(tokenBody.safeParse({ roomName: 123, participantName: 'a' }).success).toBe(false);
    expect(tokenBody.safeParse({ roomName: 'a', participantName: 'a'.repeat(501) }).success).toBe(false);
    expect(tokenBody.safeParse({ roomName: 'a', participantName: 'a', passcode: 'x'.repeat(257) }).success).toBe(false);
    expect(tokenBody.safeParse({ participantName: 'a' }).success).toBe(false);
  });

  it('sala e canal: campos opcionais podem faltar, mas não ter tipo errado', () => {
    expect(createRoomBody.safeParse({}).success).toBe(true);
    expect(createRoomBody.safeParse({ name: 5 }).success).toBe(false);
    expect(createChannelBody.safeParse({ name: 'geral', type: 'voice' }).success).toBe(true);
    expect(createChannelBody.safeParse({ type: ['x'] }).success).toBe(false);
  });

  it('guest sync: limita a quantidade de salas', () => {
    const rooms = Array.from({ length: 201 }, () => ({ slug: 'a' }));
    expect(guestSyncBody.safeParse({ recoveryCode: 'ABCDEF', rooms }).success).toBe(false);
    expect(guestSyncBody.safeParse({ recoveryCode: 'ABCDEF', rooms: [{ slug: 'a', name: 'A' }] }).success).toBe(true);
  });

  it('voice-disconnect: identity é obrigatório', () => {
    expect(voiceDisconnectBody.safeParse({}).success).toBe(false);
    expect(voiceDisconnectBody.safeParse({ identity: '' }).success).toBe(false);
    expect(voiceDisconnectBody.safeParse({ identity: 'ana' }).success).toBe(true);
  });
});
