import { Router, Request, Response } from 'express';
import { isSupabaseConfigured, supabase } from '../supabase';

import { guestSyncBody } from '../schemas';
import { validateBody } from '../middleware/validate';

const router = Router();

interface GuestAccountData {
  recoveryCode: string;
  nickname: string;
  avatarUrl?: string | null;
  rooms: Array<{ slug: string; name: string; hasPasscode?: boolean }>;
  updatedAt: string;
}

const guestAccountsMemory = new Map<string, GuestAccountData>();

/**
 * Sincronizar dados de Convidado (Apelido, Avatar, Lista de Salas salvas)
 */
router.post(['/api/guest/sync', '/guest/sync'], validateBody(guestSyncBody), async (req: Request, res: Response): Promise<void> => {
  try {
    const { recoveryCode, nickname, avatarUrl, rooms } = req.body || {};
    const cleanCode = typeof recoveryCode === 'string' ? recoveryCode.trim().toUpperCase() : '';

    if (!cleanCode || cleanCode.length < 6) {
      res.status(400).json({ error: 'Código de recuperação inválido.' });
      return;
    }

    const cleanNick = typeof nickname === 'string' && nickname.trim() ? nickname.trim().slice(0, 32) : 'Convidado';
    const cleanAvatar = typeof avatarUrl === 'string' ? avatarUrl.trim() : null;
    const cleanRooms = Array.isArray(rooms)
      ? rooms.map((r) => ({
          slug: String(r.slug || '').trim().toLowerCase(),
          name: String(r.name || r.slug || '').trim(),
          hasPasscode: Boolean(r.hasPasscode),
        })).filter((r) => r.slug)
      : [];

    const now = new Date().toISOString();

    // Cache em memória
    guestAccountsMemory.set(cleanCode, {
      recoveryCode: cleanCode,
      nickname: cleanNick,
      avatarUrl: cleanAvatar,
      rooms: cleanRooms,
      updatedAt: now,
    });

    // Persistência durável no Supabase
    if (isSupabaseConfigured() && supabase) {
      try {
        await supabase.from('guest_accounts').upsert({
          recovery_code: cleanCode,
          nickname: cleanNick,
          avatar_url: cleanAvatar,
          rooms: cleanRooms,
          updated_at: now,
        });
      } catch (dbErr: any) {
        console.warn('Falha ao persistir guest_account no Supabase (usando fallback em memória):', dbErr?.message);
      }
    }

    res.json({ success: true, recoveryCode: cleanCode });
  } catch (err: any) {
    console.error('Erro ao sincronizar conta de convidado:', err?.message || err);
    res.status(500).json({ error: 'Falha ao sincronizar conta de convidado.' });
  }
});

/**
 * Recuperar dados de Convidado pelo Código de Recuperação
 */
router.get(['/api/guest/:code', '/guest/:code'], async (req: Request, res: Response): Promise<void> => {
  try {
    const rawCode = req.params.code;
    const cleanCode = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';

    if (!cleanCode) {
      res.status(400).json({ error: 'Código de recuperação não fornecido.' });
      return;
    }

    // 1. Tentar buscar no Supabase
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('guest_accounts')
          .select('*')
          .eq('recovery_code', cleanCode)
          .maybeSingle();

        if (data && !error) {
          res.json({
            success: true,
            account: {
              recoveryCode: data.recovery_code,
              nickname: data.nickname,
              avatarUrl: data.avatar_url,
              rooms: data.rooms || [],
              updatedAt: data.updated_at,
            },
          });
          return;
        }
      } catch (dbErr: any) {
        console.warn('Erro ao consultar guest_account no Supabase:', dbErr?.message);
      }
    }

    // 2. Fallback para cache em memória
    const memData = guestAccountsMemory.get(cleanCode);
    if (memData) {
      res.json({
        success: true,
        account: memData,
      });
      return;
    }

    res.status(404).json({ error: 'Código de convidado não encontrado ou expirado.' });
  } catch (err: any) {
    console.error('Erro ao recuperar conta de convidado:', err?.message || err);
    res.status(500).json({ error: 'Falha ao recuperar dados do convidado.' });
  }
});

export default router;
