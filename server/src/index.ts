import dotenv from 'dotenv';
dotenv.config();

import { webcrypto } from 'node:crypto';
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
  // @ts-ignore
  globalThis.crypto = webcrypto;
}

import express, { Request, Response } from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { supabase, isSupabaseConfigured } from './supabase';
import { generateRoomKey, encryptRoomKey, decryptRoomKey } from './kms';

const app = express();
const PORT = process.env.PORT || 3001;

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
const LIVEKIT_INTERNAL_URL =
  process.env.LIVEKIT_INTERNAL_URL ||
  LIVEKIT_URL.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997';
const STREAM_BASE_URL = (process.env.STREAM_URL || process.env.VITE_STREAM_URL || 'https://stream.194.61.238.98.sslip.io').replace(/\/$/, '');

// Environment namespace isolation for LiveKit rooms
const ROOM_PREFIX = process.env.ROOM_PREFIX ?? (String(PORT) === '3002' ? 'dev_' : '');

export function toLiveKitRoomName(slug: string): string {
  return `${ROOM_PREFIX}${slug}`;
}

export function fromLiveKitRoomName(liveKitName: string): string | null {
  if (ROOM_PREFIX) {
    if (liveKitName.startsWith(ROOM_PREFIX)) {
      return liveKitName.slice(ROOM_PREFIX.length);
    }
    return null;
  }
  if (liveKitName.startsWith('dev_')) {
    return null;
  }
  return liveKitName;
}

// Maintenance Mode Helper
const isMaintenanceMode = () =>
  process.env.MAINTENANCE_MODE === 'true' || process.env.MAINTENANCE_MODE === '1';
const getMaintenanceMessage = () =>
  process.env.MAINTENANCE_MESSAGE ||
  'Estamos realizando melhorias e otimizações de infraestrutura. O Põe na Tela voltará em breve!';
const ADMIN_BYPASS_TOKEN = process.env.ADMIN_BYPASS_TOKEN || 'admin_preview';

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

const roomService = new RoomServiceClient(
  LIVEKIT_INTERNAL_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

/**
 * Unicode-safe sanitization for room names.
 */
function sanitizeRoomName(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFC')
    .trim()
    .toLowerCase()
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
 * Health check & status endpoint (reports maintenance status)
 */
app.get(['/api/health', '/api/status', '/health', '/status'], (_req: Request, res: Response) => {
  const maintenance = isMaintenanceMode();
  res.json({
    status: maintenance ? 'maintenance' : 'ok',
    maintenance,
    message: maintenance ? getMaintenanceMessage() : undefined,
    livekitUrl: LIVEKIT_URL,
    timestamp: new Date().toISOString(),
    version: '1.6.0',
  });
});

/**
 * Generate a secure JWT AccessToken to join a LiveKit room
 */
app.post(['/api/token', '/token'], async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomName, participantName, isPublisher, passcode, bypassToken, voiceChannelId } = req.body;

    // Check maintenance mode
    if (isMaintenanceMode()) {
      const isBypassValid =
        bypassToken &&
        (bypassToken === ADMIN_BYPASS_TOKEN || bypassToken === 'admin_preview');
      if (!isBypassValid) {
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
          .select('passcode_hash')
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
          if (dbRoom.passcode_hash !== cleanPasscode) {
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
        if (existingConfig.passcode !== cleanPasscode) {
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
        passcode: cleanPasscode,
        hostIdentity: sanitizedParticipant,
        createdAt: Date.now(),
      });
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: sanitizedParticipant,
      name: sanitizedParticipant,
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

/**
 * Helper to fetch rooms with a strict 2-second timeout
 */
async function listRoomsWithTimeout(names?: string[]): Promise<any[]> {
  const timeoutPromise = new Promise<any[]>((_, reject) =>
    setTimeout(() => reject(new Error('LiveKit timeout (2s)')), 2000)
  );
  return Promise.race([roomService.listRooms(names), timeoutPromise]);
}

/**
 * Helper to fetch participants in a room with a strict 2-second timeout
 */
async function listParticipantsWithTimeout(roomName: string): Promise<any[]> {
  const timeoutPromise = new Promise<any[]>((_, reject) =>
    setTimeout(() => reject(new Error('LiveKit timeout (2s)')), 2000)
  );
  return Promise.race([roomService.listParticipants(roomName), timeoutPromise]);
}

/**
 * Helper to get authenticated user from Supabase JWT
 */
async function getAuthUser(req: Request) {
  if (!supabase) return null;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

/**
 * Criar sala persistente (Discord-like)
 * Apenas usuários autenticados (não convidados)
 */
app.post(['/api/rooms', '/rooms'], async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, slug, passcode } = req.body;
    const sanitizedName = (name || '').trim().slice(0, 64);
    const sanitizedSlug = sanitizeRoomName(slug || name);

    if (!sanitizedName || !sanitizedSlug) {
      res.status(400).json({ error: 'Nome e slug da sala são obrigatórios.' });
      return;
    }

    const cleanPasscode = typeof passcode === 'string' && passcode.trim() ? passcode.trim() : null;

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
          passcode_hash: cleanPasscode, // TODO: bcrypt hash em produção
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
      passcode: cleanPasscode || undefined,
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
 * Listar todas as salas das quais o usuário autenticado faz parte (como dono ou membro)
 */
app.get(['/api/user/rooms', '/user/rooms'], async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isSupabaseConfigured() || !supabase) {
      res.json({ rooms: [] });
      return;
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Autenticação necessária.' });
      return;
    }

    const { data: memberRows, error: memberError } = await supabase
      .from('room_members')
      .select('room_id, role, rooms(id, name, slug, passcode_hash, owner_id, created_at)')
      .eq('user_id', authUser.id);

    if (memberError) {
      throw memberError;
    }

    const rooms = (memberRows || [])
      .map((row: any) => {
        const r = row.rooms;
        if (!r) return null;
        return {
          id: r.id,
          name: r.name,
          slug: r.slug,
          hasPasscode: Boolean(r.passcode_hash),
          isOwner: r.owner_id === authUser.id,
          role: row.role,
          createdAt: r.created_at,
        };
      })
      .filter(Boolean);

    res.json({ rooms });
  } catch (err: any) {
    console.error('Erro ao listar salas do usuário:', err?.message || err);
    res.status(500).json({ error: 'Falha ao buscar salas do usuário.', details: err?.message });
  }
});

/**
 * Ingressar como membro da sala (Discord-like)
 */
app.post(['/api/rooms/:roomName/join', '/rooms/:roomName/join'], async (req: Request, res: Response): Promise<void> => {
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
      if (!cleanPasscode || cleanPasscode !== room.passcode_hash) {
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
app.get([
  '/api/rooms/:roomName/key',
  '/rooms/:roomName/key',
  '/api/room/:roomName/key',
  '/room/:roomName/key'
], async (req: Request, res: Response): Promise<void> => {
  try {
    const roomSlug = sanitizeRoomName(req.params.roomName);
    const providedPasscode = (req.query.passcode as string) || (req.headers['x-room-passcode'] as string);

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
          if (memConfig.passcode && memConfig.passcode !== providedPasscode) {
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
        if (!providedPasscode || providedPasscode !== room.passcode_hash) {
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
    if (memConfig?.passcode && memConfig.passcode !== providedPasscode) {
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
 * Listar canais de uma sala (Texto e Voz)
 */
app.get([
  '/api/rooms/:roomName/channels',
  '/rooms/:roomName/channels',
  '/api/room/:roomName/channels',
  '/room/:roomName/channels'
], async (req: Request, res: Response): Promise<void> => {
  try {
    const roomSlug = sanitizeRoomName(req.params.roomName);

    if (isSupabaseConfigured() && supabase) {
      const { data: room } = await supabase
        .from('rooms')
        .select('id, name, owner_id')
        .eq('slug', roomSlug)
        .maybeSingle();

      if (room) {
        const { data: channels, error } = await supabase
          .from('channels')
          .select('*')
          .eq('room_id', room.id)
          .order('position', { ascending: true })
          .order('created_at', { ascending: true });

        if (!error && channels) {
          res.json({
            channels,
            isOwner: false, // O frontend confere com o user id do perfil
            ownerId: room.owner_id,
          });
          return;
        }
      }
    }

    // Fallback: canais padrões virtuais para salas em memória
    res.json({
      channels: [
        { id: `text-general-${roomSlug}`, name: 'geral', type: 'text', position: 0 },
        { id: `voice-main-${roomSlug}`, name: 'Voz Principal', type: 'voice', position: 1 },
      ],
      isOwner: true,
      ownerId: null,
    });
  } catch (err: any) {
    console.error('Erro ao listar canais:', err?.message || err);
    res.status(500).json({ error: 'Falha ao listar canais.' });
  }
});

/**
 * Criar novo canal em uma sala (Apenas dono da sala)
 */
app.post([
  '/api/rooms/:roomName/channels',
  '/rooms/:roomName/channels',
  '/api/room/:roomName/channels',
  '/room/:roomName/channels'
], async (req: Request, res: Response): Promise<void> => {
  try {
    const roomSlug = sanitizeRoomName(req.params.roomName);
    const { name, type } = req.body;

    const channelType = type === 'voice' ? 'voice' : 'text';
    const channelName = (name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32);

    if (!channelName) {
      res.status(400).json({ error: 'Nome do canal inválido.' });
      return;
    }

    if (!isSupabaseConfigured() || !supabase) {
      res.status(400).json({ error: 'Criação de múltiplos canais requer o Supabase ativo.' });
      return;
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Autenticação necessária para gerenciar canais.' });
      return;
    }

    // Verificar se o usuário é o dono da sala
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, owner_id')
      .eq('slug', roomSlug)
      .single();

    if (roomError || !room) {
      res.status(404).json({ error: 'Sala não encontrada.' });
      return;
    }

    if (room.owner_id !== authUser.id) {
      res.status(403).json({ error: 'Apenas o criador da sala pode adicionar canais.' });
      return;
    }

    // Inserir canal
    const { data: newChannel, error: insertError } = await supabase
      .from('channels')
      .insert({
        room_id: room.id,
        name: channelName,
        type: channelType,
        position: 10,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    res.status(201).json({ channel: newChannel });
  } catch (err: any) {
    console.error('Erro ao criar canal:', err?.message || err);
    res.status(500).json({ error: 'Falha ao criar canal.', details: err?.message });
  }
});

/**
 * Excluir canal de uma sala (Apenas dono da sala)
 */
app.delete([
  '/api/rooms/:roomName/channels/:channelId',
  '/rooms/:roomName/channels/:channelId',
  '/api/room/:roomName/channels/:channelId',
  '/room/:roomName/channels/:channelId'
], async (req: Request, res: Response): Promise<void> => {
  try {
    const roomSlug = sanitizeRoomName(req.params.roomName);
    const channelId = req.params.channelId;

    if (!isSupabaseConfigured() || !supabase) {
      res.status(400).json({ error: 'Operação não suportada sem Supabase.' });
      return;
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Autenticação necessária.' });
      return;
    }

    // Verificar se o usuário é o dono da sala
    const { data: room } = await supabase
      .from('rooms')
      .select('id, owner_id')
      .eq('slug', roomSlug)
      .single();

    if (!room || room.owner_id !== authUser.id) {
      res.status(403).json({ error: 'Apenas o dono da sala pode excluir canais.' });
      return;
    }

    // Deletar o canal
    const { error: delError } = await supabase
      .from('channels')
      .delete()
      .eq('id', channelId)
      .eq('room_id', room.id);

    if (delError) {
      throw delError;
    }

    res.json({ success: true, message: 'Canal excluído com sucesso.' });
  } catch (err: any) {
    console.error('Erro ao excluir canal:', err?.message || err);
    res.status(500).json({ error: 'Falha ao excluir canal.' });
  }
});

/**
 * List active rooms with live participant counts and passcode flags
 */
app.get(['/api/rooms', '/rooms'], async (_req: Request, res: Response) => {
  if (isMaintenanceMode()) {
    res.json({ rooms: [], maintenance: true });
    return;
  }

  try {
    const liveRooms = await listRoomsWithTimeout();
    const activeLiveRooms = Array.isArray(liveRooms) ? liveRooms.filter(r => r.numParticipants > 0) : [];
    const liveParticipantsMap = new Map<string, number>();
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
  } catch (err: any) {
    console.error('Failed to list rooms from LiveKit:', err?.message || err);
    res.json({ rooms: [], warning: 'LiveKit server might not be running yet' });
  }
});

/**
 * Check if a room exists, requires a password, or has active viewers
 */
app.get([
  '/api/room/:roomName/info',
  '/room/:roomName/info',
  '/api/room-info/:roomName',
  '/room-info/:roomName'
], async (req: Request, res: Response) => {
  const roomName = sanitizeRoomName(req.params.roomName);
  let numParticipants = 0;
  let isActive = false;

  try {
    const rooms = await listRoomsWithTimeout([toLiveKitRoomName(roomName)]);
    if (rooms && rooms.length > 0 && rooms[0].numParticipants > 0) {
      isActive = true;
      numParticipants = rooms[0].numParticipants;
    } else {
      roomStore.delete(roomName);
    }
  } catch {}

  let hasPasscode = false;
  let isPersistent = false;
  let displayName = roomName;
  let channels: any[] = [];

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
    channels,
  });
});

/**
 * List active OBS (SRT / MediaMTX) streams for a specific room (multi-stream squad support)
 */
app.get(['/api/rooms/:roomName/streams', '/rooms/:roomName/streams', '/api/room/:roomName/streams', '/room/:roomName/streams'], async (req: Request, res: Response): Promise<void> => {
  const roomName = sanitizeRoomName(req.params.roomName);
  if (!roomName) {
    res.status(400).json({ error: 'Nome de sala inválido.', streams: [] });
    return;
  }

  const streams: Array<{
    id: string;
    name: string;
    path: string;
    whepUrl: string;
  }> = [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const mtxRes = await fetch(`${MEDIAMTX_API_URL}/v3/paths/list`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (mtxRes.ok) {
      const data: any = await mtxRes.json();
      const items = Array.isArray(data.items) ? data.items : [];

      for (const item of items) {
        if (!item || !item.name || !item.ready) continue;
        const itemPath = String(item.name).trim();

        const lowerPath = itemPath.toLowerCase();
        const lowerRoom = roomName.toLowerCase();

        // Helper to format clean WHEP URL with unencoded slashes: /teste/aaa/whep
        const cleanWhepUrl = `${STREAM_BASE_URL}/${itemPath.split('/').map(encodeURIComponent).join('/')}/whep`;

        // 1. Single / default stream (e.g. "jogatina" ou "teste")
        if (lowerPath === lowerRoom) {
          streams.push({
            id: 'main',
            name: 'Principal',
            path: itemPath,
            whepUrl: cleanWhepUrl,
          });
        }
        // 2. Sub-path multi-stream (e.g. "jogatina/pedro" ou "jogatina-pedro")
        else if (lowerPath.startsWith(`${lowerRoom}/`) || lowerPath.startsWith(`${lowerRoom}-`)) {
          const rawId = itemPath.slice(roomName.length + 1);

          if (rawId) {
            const formattedName = decodeURIComponent(rawId)
              .replace(/[-_]/g, ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase());

            streams.push({
              id: rawId.toLowerCase(),
              name: formattedName || rawId,
              path: itemPath,
              whepUrl: cleanWhepUrl,
            });
          }
        }
      }
    }
  } catch {
    // MediaMTX API offline or unreachable, return empty array gracefully
  }

  res.json({
    roomName,
    streams,
    count: streams.length,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Põe na Tela — Servidor rodando em http://localhost:${PORT}`);
  console.log(`📡 Conectado ao LiveKit em: ${LIVEKIT_URL}`);
  if (isMaintenanceMode()) {
    console.log(`⚠️ MODO DE MANUTENÇÃO ATIVADO! (${getMaintenanceMessage()})`);
  }
});
