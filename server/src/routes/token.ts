import { AccessToken } from 'livekit-server-sdk';
import { Router, Request, Response } from 'express';
import { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL, getMaintenanceMessage, isMaintenanceMode, isValidBypassToken, toLiveKitRoomName } from '../config';
import { markWrongPasscode, passcodeGuards } from '../middleware/limits';
import { checkPasscode, hashPasscode } from '../passcode';
import { sanitizeRoomName, sanitizeUserName } from '../sanitize';
import { listParticipantsWithTimeout, roomService } from '../services/livekit';
import { roomStore } from '../state';
import { isSupabaseConfigured, supabase } from '../supabase';

import { tokenBody } from '../schemas';
import { validateBody } from '../middleware/validate';

const router = Router();

/**
 * Generate a secure JWT AccessToken to join a LiveKit room
 */
router.post(['/api/token', '/token'], passcodeGuards, validateBody(tokenBody), async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomName, participantName, isPublisher, passcode, bypassToken, voiceChannelId, avatarUrl } = req.body;

    // Check maintenance mode
    if (isMaintenanceMode()) {
      if (!isValidBypassToken(bypassToken)) {
        res.status(503).json({
          error: getMaintenanceMessage(),
          maintenance: true,
        });
        return;
      }
    }

    const sanitizedRoom = sanitizeRoomName(roomName as string);
    const sanitizedParticipant = sanitizeUserName(participantName as string);

    if (!sanitizedRoom || !sanitizedParticipant) {
      res.status(400).json({ error: 'Nome da sala e nome do participante são obrigatórios e válidos.' });
      return;
    }

    const cleanPasscode = typeof passcode === 'string' && passcode.trim() ? passcode.trim() : undefined;

    // Resolve voice channel: if not supplied, look up first voice channel in Supabase for this room
    let resolvedVoiceChannelId = typeof voiceChannelId === 'string' && voiceChannelId.trim()
      ? voiceChannelId.trim()
      : '';

    if (!resolvedVoiceChannelId && isSupabaseConfigured() && supabase) {
      try {
        const { data: dbRoom } = await supabase
          .from('rooms')
          .select('id')
          .eq('slug', sanitizedRoom)
          .maybeSingle();

        if (dbRoom) {
          const { data: dbChannels } = await supabase
            .from('channels')
            .select('id')
            .eq('room_id', dbRoom.id)
            .eq('type', 'voice')
            .order('position', { ascending: true })
            .order('created_at', { ascending: true })
            .limit(1);

          if (dbChannels && dbChannels.length > 0) {
            resolvedVoiceChannelId = dbChannels[0].id;
          }
        }
      } catch (err) {
        console.warn('Could not auto-resolve default voice channel from Supabase:', err);
      }
    }

    if (!resolvedVoiceChannelId) {
      resolvedVoiceChannelId = 'default';
    }

    // Isolate LiveKit room per voice channel: {roomName}_v_{voiceChannelId}
    const physicalRoomName = `${sanitizedRoom}_v_${sanitizeRoomName(resolvedVoiceChannelId)}`;
    const lkRoomName = toLiveKitRoomName(physicalRoomName);

    // Passcode validation (Supabase persistent room)
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: dbRoom } = await supabase
          .from('rooms')
          .select('id, passcode_hash')
          .eq('slug', sanitizedRoom)
          .maybeSingle();

        if (dbRoom && dbRoom.passcode_hash) {
          if (!cleanPasscode) {
            res.status(403).json({
              error: 'Esta sala é protegida por senha. Por favor, insira a senha para entrar.',
              requiresPasscode: true,
            });
            return;
          }
          const passcodeOk = await checkPasscode(dbRoom.passcode_hash, cleanPasscode, (h) =>
            supabase!.from('rooms').update({ passcode_hash: h }).eq('id', dbRoom.id)
          );
          if (!passcodeOk) {
            markWrongPasscode(res, cleanPasscode);
            res.status(403).json({ error: 'Senha incorreta para esta sala.' });
            return;
          }
        }
      } catch (err) {
        console.warn('Could not verify Supabase room passcode:', err);
      }
    }

    // 1. Check if this voice channel room is currently active in LiveKit
    let isActiveInLiveKit = false;
    try {
      const existingLiveRooms = await roomService.listRooms([lkRoomName]);
      if (existingLiveRooms && existingLiveRooms.length > 0 && existingLiveRooms[0].numParticipants > 0) {
        isActiveInLiveKit = true;
      }
    } catch {
      // Fallback to roomStore
    }

    // 2. Check if a participant with this name is already in this voice channel room
    if (isActiveInLiveKit) {
      try {
        const participants = await listParticipantsWithTimeout(lkRoomName);
        const nameLower = sanitizedParticipant.toLowerCase();
        const isNameTaken = participants.some(
          (p) => (p.identity && p.identity.toLowerCase() === nameLower) || (p.name && p.name.toLowerCase() === nameLower)
        );

        if (isNameTaken) {
          res.status(409).json({
            error: `O nome "${sanitizedParticipant}" já está em uso neste canal de voz. Por favor, escolha outro nome para entrar.`,
          });
          return;
        }
      } catch (err: any) {
        console.warn('Could not verify existing participants in room:', err?.message || err);
      }
    }

    // Passcode validation (In-memory fallback roomStore)
    const existingConfig = roomStore.get(sanitizedRoom);
    if (isActiveInLiveKit && existingConfig) {
      if (existingConfig.passcode) {
        if (!cleanPasscode) {
          res.status(403).json({
            error: 'Esta sala é protegida por senha. Por favor, insira a senha para entrar.',
            requiresPasscode: true,
          });
          return;
        }
        if (!(await checkPasscode(existingConfig.passcode, cleanPasscode))) {
          markWrongPasscode(res, cleanPasscode);
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
    } else if (!existingConfig) {
      roomStore.set(sanitizedRoom, {
        name: sanitizedRoom,
        passcode: cleanPasscode ? await hashPasscode(cleanPasscode) : undefined,
        hostIdentity: sanitizedParticipant,
        createdAt: Date.now(),
      });
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: sanitizedParticipant,
      name: sanitizedParticipant,
      metadata: typeof avatarUrl === 'string' && avatarUrl ? JSON.stringify({ avatarUrl }) : undefined,
      ttl: '6h',
    });

    at.addGrant({
      roomJoin: true,
      room: lkRoomName,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    // Remover participante de outros canais de voz desta sala para evitar sobreposição
    try {
      const roomPrefix = toLiveKitRoomName(`${sanitizedRoom}_v_`);
      const allActiveRooms = await roomService.listRooms();
      for (const r of allActiveRooms) {
        if (r.name.startsWith(roomPrefix) && r.name !== lkRoomName && r.numParticipants > 0) {
          roomService.removeParticipant(r.name, sanitizedParticipant).catch(() => {});
        }
      }
    } catch {}

    // Notificar clientes da sala que houve alteração de presença
    if (supabase) {
      supabase.channel(`room-voice-presence:${sanitizedRoom}`).send({
        type: 'broadcast',
        event: 'voice_presence_changed',
        payload: { roomName: sanitizedRoom, identity: sanitizedParticipant, voiceChannelId: resolvedVoiceChannelId },
      }).catch(() => {});
    }

    res.json({
      token,
      livekitUrl: LIVEKIT_URL,
      roomName: sanitizedRoom,
      voiceChannelId: resolvedVoiceChannelId,
      identity: sanitizedParticipant,
      isPublisher: Boolean(isPublisher),
    });
  } catch (err: any) {
    console.error('Error generating token:', err);
    res.status(500).json({ error: 'Falha ao gerar token de acesso', details: err.message });
  }
});

export default router;
