import { Router, Request, Response } from 'express';
import { toLiveKitRoomName } from '../config';
import { sanitizeRoomName } from '../sanitize';
import { listParticipantsWithTimeout, roomService } from '../services/livekit';
import { supabase } from '../supabase';

const router = Router();

/**
 * Consulta autoritativa de membros conectados aos canais de voz da sala via LiveKit
 */
router.get([
  '/api/rooms/:roomName/voice-presence',
  '/rooms/:roomName/voice-presence',
], async (req: Request, res: Response): Promise<void> => {
  try {
    const rawRoom = req.params.roomName;
    const sanitizedRoom = sanitizeRoomName(rawRoom);
    if (!sanitizedRoom) {
      res.status(400).json({ error: 'Nome da sala inválido.' });
      return;
    }

    const prefix = toLiveKitRoomName(`${sanitizedRoom}_v_`);
    let allRooms: any[] = [];
    try {
      allRooms = await roomService.listRooms();
    } catch (err) {
      console.warn('Erro ao listar salas do LiveKit:', err);
    }

    const matchingRooms = allRooms.filter(
      (r) => r.name.startsWith(prefix) && r.numParticipants > 0
    );

    const voiceParticipants: any[] = [];

    await Promise.all(
      matchingRooms.map(async (r) => {
        const rawChanId = r.name.slice(prefix.length);
        try {
          const participants = await listParticipantsWithTimeout(r.name);
          for (const p of participants) {
            let avatarUrl: string | undefined;
            if (p.metadata) {
              try {
                const meta = JSON.parse(p.metadata);
                avatarUrl = meta.avatarUrl;
              } catch {}
            }
            voiceParticipants.push({
              identity: p.identity,
              name: p.name || p.identity,
              voiceChannelId: rawChanId,
              isSpeaking: false,
              isMuted: p.tracks?.some((t: any) => t.type === 0 && t.muted) ?? false,
              avatarUrl,
            });
          }
        } catch (err) {
          console.warn(`Erro ao listar participantes para sala ${r.name}:`, err);
        }
      })
    );

    res.json({
      roomName: sanitizedRoom,
      participants: voiceParticipants,
    });
  } catch (err: any) {
    console.error('Erro ao consultar presença no LiveKit:', err);
    res.status(500).json({ error: 'Erro ao consultar presença de voz no LiveKit' });
  }
});

/**
 * Desconectar explicitamente participante de qualquer canal de voz da sala no LiveKit
 */
router.post([
  '/api/rooms/:roomName/voice-disconnect',
  '/rooms/:roomName/voice-disconnect',
], async (req: Request, res: Response): Promise<void> => {
  try {
    const rawRoom = req.params.roomName;
    const sanitizedRoom = sanitizeRoomName(rawRoom);
    const { identity } = req.body;
    if (!sanitizedRoom || !identity) {
      res.status(400).json({ error: 'Dados inválidos' });
      return;
    }

    const prefix = toLiveKitRoomName(`${sanitizedRoom}_v_`);
    const allRooms = await roomService.listRooms().catch(() => []);
    const matchingRooms = allRooms.filter((r) => r.name.startsWith(prefix));

    await Promise.all(
      matchingRooms.map(async (r) => {
        try {
          await roomService.removeParticipant(r.name, identity);
        } catch {}
      })
    );

    if (supabase) {
      supabase.channel(`room-voice-presence:${sanitizedRoom}`).send({
        type: 'broadcast',
        event: 'voice_presence_changed',
        payload: { roomName: sanitizedRoom, identity, action: 'disconnect' },
      }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao desconectar' });
  }
});

export default router;
