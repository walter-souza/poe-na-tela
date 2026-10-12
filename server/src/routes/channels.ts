import { Router, Request, Response } from 'express';
import { getAuthUser } from '../middleware/auth';
import { sanitizeRoomName } from '../sanitize';
import { isSupabaseConfigured, supabase } from '../supabase';

const router = Router();

/**
 * Listar canais de uma sala (Texto e Voz)
 */
router.get([
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
router.post([
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
router.delete([
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
 * Buscar histórico de mensagens de um canal
 */
router.get([
  '/api/channels/:channelId/messages',
  '/channels/:channelId/messages'
], async (req: Request, res: Response): Promise<void> => {
  try {
    const channelId = req.params.channelId;
    if (!channelId) {
      res.status(400).json({ error: 'channelId é obrigatório.' });
      return;
    }

    if (!isSupabaseConfigured() || !supabase) {
      res.json({ messages: [] });
      return;
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 200);

    const { data, error } = await supabase
      .from('messages')
      .select('id, user_id, author_name, ciphertext, iv, created_at')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.warn('Erro ao buscar mensagens do canal no Supabase:', error);
      res.status(500).json({ error: 'Erro ao buscar mensagens do canal.' });
      return;
    }

    res.json({ messages: data || [] });
  } catch (err: any) {
    console.error('Erro ao listar mensagens do canal:', err?.message || err);
    res.status(500).json({ error: 'Falha ao buscar mensagens do canal.' });
  }
});

/**
 * Enviar mensagem para um canal (armazenada com cifragem AES-GCM ponta a ponta)
 */
router.post([
  '/api/channels/:channelId/messages',
  '/channels/:channelId/messages'
], async (req: Request, res: Response): Promise<void> => {
  try {
    const channelId = req.params.channelId;
    const { authorName, ciphertext, iv } = req.body || {};

    if (!channelId) {
      res.status(400).json({ error: 'channelId é obrigatório.' });
      return;
    }

    const sanitizedAuthor = typeof authorName === 'string' ? authorName.trim().slice(0, 32) : 'Convidado';
    if (!ciphertext || typeof ciphertext !== 'string' || ciphertext.length > 65536) {
      res.status(400).json({ error: 'ciphertext inválido ou excede o limite permitido (64KB).' });
      return;
    }

    if (!iv || typeof iv !== 'string' || iv.length > 128) {
      res.status(400).json({ error: 'iv inválido.' });
      return;
    }

    if (!isSupabaseConfigured() || !supabase) {
      res.status(503).json({ error: 'Banco de dados não configurado.' });
      return;
    }

    const authUser = await getAuthUser(req);
    const userId = authUser?.id || null;

    const { data, error } = await supabase
      .from('messages')
      .insert({
        channel_id: channelId,
        user_id: userId,
        author_name: sanitizedAuthor,
        ciphertext,
        iv,
      })
      .select('id, user_id, author_name, ciphertext, iv, created_at')
      .single();

    if (error) {
      console.warn('Erro ao inserir mensagem no Supabase:', error);
      res.status(500).json({ error: 'Erro ao salvar mensagem.' });
      return;
    }

    res.json({ success: true, message: data });
  } catch (err: any) {
    console.error('Erro ao salvar mensagem:', err?.message || err);
    res.status(500).json({ error: 'Falha interna ao salvar mensagem.' });
  }
});

export default router;
