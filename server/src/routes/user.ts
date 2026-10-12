import { Router, Request, Response } from 'express';
import { getAuthUser } from '../middleware/auth';
import { sanitizeRoomName } from '../sanitize';
import { isSupabaseConfigured, supabase } from '../supabase';

const router = Router();

/**
 * Listar todas as salas das quais o usuário autenticado faz parte (como dono ou membro)
 */
router.get(['/api/user/rooms', '/user/rooms'], async (req: Request, res: Response): Promise<void> => {
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
 * Obter perfil do usuário autenticado
 */
router.get(['/api/user/profile', '/user/profile'], async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isSupabaseConfigured() || !supabase) {
      res.status(503).json({ error: 'Banco de dados não configurado.' });
      return;
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Autenticação necessária.' });
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (error) {
      console.warn('Erro ao buscar perfil no Supabase:', error);
      res.status(500).json({ error: 'Erro ao buscar perfil.' });
      return;
    }

    if (!data) {
      // Auto-provisionar perfil se ainda não existir
      const isAnon = authUser.is_anonymous || authUser.app_metadata?.provider === 'anonymous';
      const name =
        authUser.user_metadata?.name ||
        authUser.user_metadata?.user_name ||
        authUser.user_metadata?.nickname ||
        authUser.email?.split('@')[0] ||
        (isAnon ? 'Convidado' : 'Usuário');

      const avatar =
        authUser.user_metadata?.avatar_url ||
        authUser.user_metadata?.picture ||
        null;

      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: authUser.id,
          username: name,
          avatar_url: avatar,
          is_guest: isAnon,
        })
        .select()
        .maybeSingle();

      if (insertError) {
        console.warn('Erro ao auto-provisionar perfil no Supabase:', insertError);
      }

      res.json({
        profile: newProfile || {
          id: authUser.id,
          username: name,
          avatar_url: avatar,
          is_guest: isAnon,
        },
      });
      return;
    }

    res.json({ profile: data });
  } catch (err: any) {
    console.error('Erro ao buscar perfil do usuário:', err?.message || err);
    res.status(500).json({ error: 'Falha ao buscar perfil do usuário.' });
  }
});

/**
 * Atualizar perfil do usuário autenticado (username, avatar_url)
 */
router.put(['/api/user/profile', '/user/profile'], async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isSupabaseConfigured() || !supabase) {
      res.status(503).json({ error: 'Banco de dados não configurado.' });
      return;
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Autenticação necessária.' });
      return;
    }

    const { username, avatar_url } = req.body || {};
    const updates: Record<string, any> = {};

    if (typeof username === 'string' && username.trim()) {
      updates.username = username.trim().slice(0, 32);
    }
    if (typeof avatar_url === 'string') {
      updates.avatar_url = avatar_url.trim();
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'Nenhum campo para atualizar.' });
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', authUser.id)
      .select()
      .single();

    if (error) {
      console.warn('Erro ao atualizar perfil no Supabase:', error);
      res.status(500).json({ error: 'Erro ao atualizar perfil.' });
      return;
    }

    res.json({ profile: data });
  } catch (err: any) {
    console.error('Erro ao atualizar perfil do usuário:', err?.message || err);
    res.status(500).json({ error: 'Falha ao atualizar perfil do usuário.' });
  }
});

/**
 * Migrar dados de convidado (salas) para a conta autenticada do usuário (Google)
 */
router.post(['/api/user/migrate-guest', '/user/migrate-guest'], async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isSupabaseConfigured() || !supabase) {
      res.json({ success: true, migratedCount: 0 });
      return;
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ error: 'Autenticação necessária para migrar dados.' });
      return;
    }

    const { recoveryCode, guestRooms } = req.body || {};
    const roomSlugs = new Set<string>();

    // 1. Coletar slugs enviados diretamente pelo cliente
    if (Array.isArray(guestRooms)) {
      guestRooms.forEach((r: any) => {
        if (r && typeof r.slug === 'string' && r.slug.trim()) {
          roomSlugs.add(sanitizeRoomName(r.slug));
        }
      });
    }

    // 2. Se houver código de recuperação, mesclar também os servidores salvos na nuvem
    const cleanCode = typeof recoveryCode === 'string' ? recoveryCode.trim().toUpperCase() : '';
    if (cleanCode) {
      const { data: guestAccount } = await supabase
        .from('guest_accounts')
        .select('rooms')
        .eq('recovery_code', cleanCode)
        .maybeSingle();

      if (guestAccount && Array.isArray(guestAccount.rooms)) {
        guestAccount.rooms.forEach((r: any) => {
          if (r && typeof r.slug === 'string' && r.slug.trim()) {
            roomSlugs.add(sanitizeRoomName(r.slug));
          }
        });
      }
    }

    if (roomSlugs.size === 0) {
      res.json({ success: true, migratedCount: 0 });
      return;
    }

    // 3. Buscar salas existentes no banco
    const { data: dbRooms, error: roomsError } = await supabase
      .from('rooms')
      .select('id, slug, owner_id')
      .in('slug', Array.from(roomSlugs));

    if (roomsError) throw roomsError;

    let migratedCount = 0;
    if (dbRooms && dbRooms.length > 0) {
      const membershipsToInsert = dbRooms.map((r: any) => ({
        room_id: r.id,
        user_id: authUser.id,
        role: r.owner_id === authUser.id ? 'owner' : 'member',
      }));

      const { error: insertError } = await supabase
        .from('room_members')
        .upsert(membershipsToInsert, { onConflict: 'room_id, user_id' });

      if (insertError) {
        console.warn('Erro ao inserir membros na migração:', insertError.message);
      } else {
        migratedCount = membershipsToInsert.length;
      }
    }

    res.json({
      success: true,
      migratedCount,
      totalRequested: roomSlugs.size,
    });
  } catch (err: any) {
    console.error('Erro na migração de convidado para conta permanente:', err?.message || err);
    res.status(500).json({ error: 'Falha ao migrar servidores do convidado.', details: err?.message });
  }
});

export default router;
