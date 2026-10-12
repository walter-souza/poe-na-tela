import { Router, Request, Response } from 'express';
import { PORT, ROOM_PREFIX, extractBaseRoomSlug, fromLiveKitRoomName, isMaintenanceMode, toLiveKitRoomName } from '../config';
import { decryptRoomKey, encryptRoomKey, generateRoomKey } from '../kms';
import { getAuthUser } from '../middleware/auth';
import { cacheJson } from '../middleware/cache';
import { markWrongPasscode, passcodeGuards, writeLimiter } from '../middleware/limits';
import { checkPasscode, hashPasscode } from '../passcode';
import { sanitizeRoomName } from '../sanitize';
import { listRoomsWithTimeout } from '../services/livekit';
import { getActiveRoomStreams } from '../services/streams';
import { roomStore } from '../state';
import { isSupabaseConfigured, supabase } from '../supabase';

const router = Router();

router.post(['/api/rooms', '/rooms'], writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, slug, passcode } = req.body;
    const sanitizedName = (name || '').trim().slice(0, 64);
    const sanitizedSlug = sanitizeRoomName(slug || name);

    if (!sanitizedName || !sanitizedSlug) {
      res.status(400).json({ error: 'Nome e slug da sala são obrigatórios.' });
      return;
    }

    const cleanPasscode = typeof passcode === 'string' && passcode.trim() ? passcode.trim() : null;
    const passcodeHash = cleanPasscode ? await hashPasscode(cleanPasscode) : null;

    // Se Supabase estiver disponível, faz a persistência completa
    if (isSupabaseConfigured() && supabase) {
      const authUser = await getAuthUser(req);
      if (!authUser) {
        res.status(401).json({ error: 'Apenas usuários autenticados podem criar salas persistentes.' });
        return;
      }

      // 1. Gerar e cifrar a Room Key com o KMS
      const rawRoomKey = generateRoomKey();
      const encryptedRoomKey = encryptRoomKey(rawRoomKey);

      // 2. Inserir sala
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .insert({
          slug: sanitizedSlug,
          name: sanitizedName,
          encrypted_room_key: encryptedRoomKey,
          passcode_hash: passcodeHash,
          owner_id: authUser.id,
        })
        .select()
        .single();

      if (roomError) {
        if (roomError.code === '23505') {
          res.status(409).json({ error: 'Já existe uma sala com este nome/link. Escolha outro.' });
          return;
        }
        throw roomError;
      }

      // 3. Criar canais padrão: #geral (texto) e Voz Principal (voz)
      await supabase.from('channels').insert([
        { room_id: roomData.id, name: 'geral', type: 'text', position: 0 },
        { room_id: roomData.id, name: 'Voz Principal', type: 'voice', position: 1 },
      ]);

      // 4. Adicionar criador como membro owner
      await supabase.from('room_members').insert({
        room_id: roomData.id,
        user_id: authUser.id,
        role: 'owner',
      });

      res.status(201).json({
        room: {
          id: roomData.id,
          name: roomData.name,
          slug: roomData.slug,
          hasPasscode: Boolean(cleanPasscode),
          isPersistent: true,
        },
        roomKey: rawRoomKey,
      });
      return;
    }

    // Fallback: modo em memória se Supabase não estiver configurado
    roomStore.set(sanitizedSlug, {
      name: sanitizedName,
      passcode: passcodeHash || undefined,
      createdAt: Date.now(),
    });

    const localKey = generateRoomKey();
    res.status(201).json({
      room: {
        id: sanitizedSlug,
        name: sanitizedName,
        slug: sanitizedSlug,
        hasPasscode: Boolean(cleanPasscode),
        isPersistent: false,
      },
      roomKey: localKey,
    });
  } catch (err: any) {
    console.error('Erro ao criar sala:', err?.message || err);
    res.status(500).json({ error: 'Falha ao criar sala.', details: err?.message });
  }
});

/**
 * Ingressar como membro da sala (Discord-like)
 */
router.post(['/api/rooms/:roomName/join', '/rooms/:roomName/join'], passcodeGuards, async (req: Request, res: Response): Promise<void> => {
  try {
    const roomSlug = sanitizeRoomName(req.params.roomName);
    const { passcode } = req.body;
    const cleanPasscode = typeof passcode === 'string' && passcode.trim() ? passcode.trim() : null;

    if (!isSupabaseConfigured() || !supabase) {
      res.json({ success: true, isPersistent: false });
      return;
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Autenticação necessária.' });
      return;
    }

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, name, slug, passcode_hash, owner_id')
      .eq('slug', roomSlug)
      .maybeSingle();

    if (roomError || !room) {
      res.status(404).json({ error: 'Sala não encontrada.' });
      return;
    }

    if (room.passcode_hash && room.owner_id !== authUser.id) {
      const passcodeOk = await checkPasscode(room.passcode_hash, cleanPasscode, (h) =>
        supabase!.from('rooms').update({ passcode_hash: h }).eq('id', room.id)
      );
      if (!passcodeOk) {
        markWrongPasscode(res, cleanPasscode);
        res.status(403).json({ error: 'Senha incorreta para esta sala.', requiresPasscode: true });
        return;
      }
    }

    // Verificar se já é membro
    const { data: existingMember } = await supabase
      .from('room_members')
      .select('id, role')
      .eq('room_id', room.id)
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (!existingMember) {
      await supabase.from('room_members').insert({
        room_id: room.id,
        user_id: authUser.id,
        role: room.owner_id === authUser.id ? 'owner' : 'member',
      });
    }

    res.json({
      success: true,
      room: {
        id: room.id,
        name: room.name,
        slug: room.slug,
        hasPasscode: Boolean(room.passcode_hash),
        isOwner: room.owner_id === authUser.id,
      },
    });
  } catch (err: any) {
    console.error('Erro ao ingressar na sala:', err?.message || err);
    res.status(500).json({ error: 'Falha ao ingressar na sala.' });
  }
});

/**
 * Obter Chave de Criptografia da Sala (KMS)
 * Entrega a Room Key decifrada para participantes autorizados
 */
router.get([
  '/api/rooms/:roomName/key',
  '/rooms/:roomName/key',
  '/api/room/:roomName/key',
  '/room/:roomName/key'
], passcodeGuards, async (req: Request, res: Response): Promise<void> => {
  try {
    const roomSlug = sanitizeRoomName(req.params.roomName);
    // A senha vai apenas por header: query string vaza em logs de proxy e no histórico.
    const headerPasscode = req.headers['x-room-passcode'];
    const providedPasscode = typeof headerPasscode === 'string' ? headerPasscode : '';

    if (isSupabaseConfigured() && supabase) {
      const { data: room, error } = await supabase
        .from('rooms')
        .select('id, slug, encrypted_room_key, passcode_hash')
        .eq('slug', roomSlug)
        .maybeSingle();

      if (error || !room) {
        // Fallback para roomStore se a sala foi criada em memória
        const memConfig = roomStore.get(roomSlug);
        if (memConfig) {
          if (memConfig.passcode && !(await checkPasscode(memConfig.passcode, providedPasscode))) {
            markWrongPasscode(res, providedPasscode);
            res.status(403).json({ error: 'Senha incorreta para acessar esta sala.', requiresPasscode: true });
            return;
          }
          res.json({ roomKey: generateRoomKey(), slug: roomSlug });
          return;
        }
        res.status(404).json({ error: 'Sala não encontrada.' });
        return;
      }

      // Validar senha caso a sala possua
      if (room.passcode_hash) {
        const passcodeOk = await checkPasscode(room.passcode_hash, providedPasscode, (h) =>
          supabase!.from('rooms').update({ passcode_hash: h }).eq('id', room.id)
        );
        if (!passcodeOk) {
          markWrongPasscode(res, providedPasscode);
          res.status(403).json({ error: 'Senha incorreta para acessar esta sala.', requiresPasscode: true });
          return;
        }
      }

      // Decifrar a chave com a Master Key do backend
      const rawRoomKey = decryptRoomKey(room.encrypted_room_key);
      res.json({ roomKey: rawRoomKey, slug: room.slug });
      return;
    }

    // Modo memória
    const memConfig = roomStore.get(roomSlug);
    if (memConfig?.passcode && !(await checkPasscode(memConfig.passcode, providedPasscode))) {
      markWrongPasscode(res, providedPasscode);
      res.status(403).json({ error: 'Senha incorreta.', requiresPasscode: true });
      return;
    }

    res.json({ roomKey: generateRoomKey(), slug: roomSlug });
  } catch (err: any) {
    console.error('Erro ao recuperar chave da sala:', err?.message || err);
    res.status(500).json({ error: 'Falha ao recuperar chave de criptografia.' });
  }
});

/**
 * List active rooms with live participant counts and passcode flags
 */
router.get(['/api/rooms', '/rooms'], cacheJson(4000), async (_req: Request, res: Response) => {
  if (isMaintenanceMode()) {
    res.json({ rooms: [], maintenance: true });
    return;
  }

  try {
    const liveRooms = await listRoomsWithTimeout();
    const activeLiveRooms = Array.isArray(liveRooms) ? liveRooms.filter(r => r.numParticipants > 0) : [];
    const isDev = ROOM_PREFIX === 'dev_' || String(PORT) === '3002';
    const liveParticipantsMap = new Map<string, number>();

    if (isDev) {
      // DEV: Mantém comportamento original 100% inalterado
      for (const r of activeLiveRooms) {
        const appSlug = fromLiveKitRoomName(r.name);
        if (appSlug) {
          liveParticipantsMap.set(appSlug.toLowerCase(), r.numParticipants);
        }
      }

      // Clean up dead rooms from memory store
      for (const [name] of roomStore.entries()) {
        if (!liveParticipantsMap.has(name.toLowerCase())) {
          roomStore.delete(name);
        }
      }

      const resultMap = new Map<string, any>();

      // 1. Carregar salas persistentes do Supabase se disponível
      if (isSupabaseConfigured() && supabase) {
        try {
          const { data: dbRooms } = await supabase
            .from('rooms')
            .select('id, slug, name, passcode_hash, created_at')
            .order('created_at', { ascending: false });

          if (Array.isArray(dbRooms)) {
            for (const room of dbRooms) {
              const count = liveParticipantsMap.get(room.slug.toLowerCase()) || 0;
              resultMap.set(room.slug.toLowerCase(), {
                id: room.id,
                name: room.name,
                slug: room.slug,
                numParticipants: count,
                creationTime: new Date(room.created_at).getTime(),
                hasPasscode: Boolean(room.passcode_hash),
                isPersistent: true,
              });
            }
          }
        } catch (dbErr) {
          console.warn('Erro ao carregar salas do Supabase:', dbErr);
        }
      }

      // 2. Adicionar salas ativas em memória (ou temporárias) filtradas pelo ambiente
      for (const r of activeLiveRooms) {
        const appSlug = fromLiveKitRoomName(r.name);
        if (!appSlug) continue;

        const lower = appSlug.toLowerCase();
        if (!resultMap.has(lower)) {
          resultMap.set(lower, {
            name: appSlug,
            slug: appSlug,
            numParticipants: r.numParticipants,
            creationTime: Number(r.creationTime),
            hasPasscode: roomStore.has(appSlug) && Boolean(roomStore.get(appSlug)?.passcode),
            isPersistent: false,
          });
        }
      }

      res.json({ rooms: Array.from(resultMap.values()) });
      return;
    }

    // --- PRODUÇÃO ---
    // Agrega participantes de todos os canais de voz da sala ({roomName}_v_{channelId})
    for (const r of activeLiveRooms) {
      const baseSlug = extractBaseRoomSlug(r.name);
      if (baseSlug) {
        const lower = baseSlug.toLowerCase();
        const currentCount = liveParticipantsMap.get(lower) || 0;
        liveParticipantsMap.set(lower, currentCount + r.numParticipants);
      }
    }

    // Clean up dead rooms from memory store
    for (const [name] of roomStore.entries()) {
      if (!liveParticipantsMap.has(name.toLowerCase())) {
        roomStore.delete(name);
      }
    }

    const resultMap = new Map<string, any>();

    // 1. Carregar salas persistentes do Supabase se disponível
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: dbRooms } = await supabase
          .from('rooms')
          .select('id, slug, name, passcode_hash, created_at')
          .order('created_at', { ascending: false });

        if (Array.isArray(dbRooms)) {
          for (const room of dbRooms) {
            const count = liveParticipantsMap.get(room.slug.toLowerCase()) || 0;
            resultMap.set(room.slug.toLowerCase(), {
              id: room.id,
              name: room.name,
              slug: room.slug,
              numParticipants: count,
              creationTime: new Date(room.created_at).getTime(),
              hasPasscode: Boolean(room.passcode_hash),
              isPersistent: true,
            });
          }
        }
      } catch (dbErr) {
        console.warn('Erro ao carregar salas do Supabase:', dbErr);
      }
    }

    // 2. Adicionar salas ativas em memória (ou temporárias) filtradas pelo ambiente
    for (const r of activeLiveRooms) {
      const baseSlug = extractBaseRoomSlug(r.name);
      if (!baseSlug) continue;

      const lower = baseSlug.toLowerCase();
      if (!resultMap.has(lower)) {
        resultMap.set(lower, {
          name: baseSlug,
          slug: baseSlug,
          numParticipants: liveParticipantsMap.get(lower) || r.numParticipants,
          creationTime: Number(r.creationTime),
          hasPasscode: roomStore.has(baseSlug) && Boolean(roomStore.get(baseSlug)?.passcode),
          isPersistent: false,
        });
      }
    }

    res.json({ rooms: Array.from(resultMap.values()) });
  } catch (err: any) {
    console.error('Failed to list rooms from LiveKit:', err?.message || err);
    res.json({ rooms: [], warning: 'LiveKit server might not be running yet' });
  }
});

/**
 * Check if a room exists, requires a password, or has active viewers
 */
router.get([
  '/api/room/:roomName/info',
  '/room/:roomName/info',
  '/api/room-info/:roomName',
  '/room-info/:roomName'
], async (req: Request, res: Response) => {
  const roomName = sanitizeRoomName(req.params.roomName);
  let numParticipants = 0;
  let isActive = false;

  const isDev = ROOM_PREFIX === 'dev_' || String(PORT) === '3002';

  try {
    if (isDev) {
      // DEV: Mantém verificação original 100% inalterada
      const rooms = await listRoomsWithTimeout([toLiveKitRoomName(roomName)]);
      if (rooms && rooms.length > 0 && rooms[0].numParticipants > 0) {
        isActive = true;
        numParticipants = rooms[0].numParticipants;
      } else {
        roomStore.delete(roomName);
      }
    } else {
      // PRODUÇÃO: contabiliza participantes do canal exato ou de canais de voz {roomName}_v_
      const prefix = toLiveKitRoomName(`${roomName}_v_`);
      const exactName = toLiveKitRoomName(roomName);
      const allRooms = await listRoomsWithTimeout();
      const matchingRooms = Array.isArray(allRooms)
        ? allRooms.filter(r => r.name === exactName || (typeof r.name === 'string' && r.name.startsWith(prefix)))
        : [];
      const totalParticipants = matchingRooms.reduce((acc, r) => acc + (r.numParticipants || 0), 0);
      if (totalParticipants > 0) {
        isActive = true;
        numParticipants = totalParticipants;
      } else {
        roomStore.delete(roomName);
      }
    }
  } catch {}

  let hasPasscode = false;
  let isPersistent = false;
  let displayName = roomName;
  let channels: any[] = [];
  let memberCount = 1;

  // Checar no Supabase se configurado
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data: dbRoom } = await supabase
        .from('rooms')
        .select('id, name, slug, passcode_hash, channels(*)')
        .eq('slug', roomName)
        .maybeSingle();

      if (dbRoom) {
        isPersistent = true;
        hasPasscode = Boolean(dbRoom.passcode_hash);
        displayName = dbRoom.name;
        channels = dbRoom.channels || [];

        const { count } = await supabase
          .from('room_members')
          .select('id', { count: 'exact', head: true })
          .eq('room_id', dbRoom.id);

        if (typeof count === 'number') {
          memberCount = count;
        }
      }
    } catch {}
  }

  if (!isPersistent) {
    const config = roomStore.get(roomName);
    hasPasscode = isActive && Boolean(config?.passcode);
  }

  res.json({
    roomName,
    displayName,
    hasPasscode,
    isActive,
    isPersistent,
    numParticipants,
    memberCount,
    channels,
  });
});

/**
 * List active OBS (SRT / MediaMTX) streams for a specific room (multi-stream squad support)
 */
router.get(['/api/rooms/:roomName/streams', '/rooms/:roomName/streams', '/api/room/:roomName/streams', '/room/:roomName/streams'], async (req: Request, res: Response): Promise<void> => {
  const roomName = sanitizeRoomName(req.params.roomName);
  if (!roomName) {
    res.status(400).json({ error: 'Nome de sala inválido.', streams: [] });
    return;
  }

  const streams = await getActiveRoomStreams(roomName);

  res.json({
    roomName,
    streams,
    count: streams.length,
  });
});

export default router;
