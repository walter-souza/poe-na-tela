import type { UserRoom } from '../types';
import { getApiBaseUrl } from './api';

export const GUEST_ROOMS_STORAGE_KEY = 'poe_na_tela_guest_rooms';
export const GUEST_RECOVERY_KEY = 'poe_na_tela_guest_recovery_code';

/**
 * Retorna as salas salvas localmente para o convidado
 */
export function getGuestRooms(): UserRoom[] {
  try {
    const raw = localStorage.getItem(GUEST_ROOMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((r) => r && typeof r.slug === 'string' && r.slug.trim());
    }
  } catch (err) {
    console.warn('Erro ao carregar salas salvas de convidado:', err);
  }
  return [];
}

/**
 * Salva ou atualiza uma sala visitada pelo convidado no localStorage
 */
export function saveGuestRoom(room: {
  name: string;
  slug: string;
  hasPasscode?: boolean;
}): UserRoom[] {
  if (!room.slug || !room.slug.trim()) return getGuestRooms();

  const cleanSlug = room.slug.trim().toLowerCase();
  const cleanName = room.name?.trim() || cleanSlug;
  const current = getGuestRooms();

  const existingIndex = current.findIndex((r) => r.slug.toLowerCase() === cleanSlug);
  const updatedItem: UserRoom = {
    id: `guest_room_${cleanSlug}`,
    name: cleanName,
    slug: cleanSlug,
    hasPasscode: Boolean(room.hasPasscode),
    isOwner: false,
    role: 'guest',
    createdAt: existingIndex >= 0 && current[existingIndex].createdAt 
      ? current[existingIndex].createdAt 
      : new Date().toISOString(),
  };

  let nextRooms: UserRoom[];
  if (existingIndex >= 0) {
    nextRooms = [...current];
    nextRooms[existingIndex] = { ...nextRooms[existingIndex], ...updatedItem };
  } else {
    nextRooms = [...current, updatedItem];
  }

  try {
    localStorage.setItem(GUEST_ROOMS_STORAGE_KEY, JSON.stringify(nextRooms));
  } catch (err) {
    console.warn('Erro ao persistir sala de convidado no localStorage:', err);
  }

  return nextRooms;
}

/**
 * Remove uma sala específica do histórico local do convidado
 */
export function removeGuestRoom(slug: string): UserRoom[] {
  if (!slug) return getGuestRooms();
  const cleanSlug = slug.trim().toLowerCase();
  const current = getGuestRooms();
  const nextRooms = current.filter((r) => r.slug.toLowerCase() !== cleanSlug);

  try {
    localStorage.setItem(GUEST_ROOMS_STORAGE_KEY, JSON.stringify(nextRooms));
  } catch (err) {
    console.warn('Erro ao remover sala do localStorage:', err);
  }

  return nextRooms;
}

/**
 * Limpa todo o histórico de salas do convidado
 */
export function clearGuestRooms(): void {
  try {
    localStorage.removeItem(GUEST_ROOMS_STORAGE_KEY);
  } catch {}
}

/**
 * Gera um código de recuperação amigável no formato PNT-XXXX-YYYY
 */
export function generateGuestRecoveryCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const randPart = (len: number) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `PNT-${randPart(4)}-${randPart(4)}`;
}

/**
 * Obtém ou inicializa o código de recuperação exclusivo deste convidado
 */
export function getOrCreateGuestRecoveryCode(): string {
  try {
    const saved = localStorage.getItem(GUEST_RECOVERY_KEY);
    if (saved && saved.trim()) return saved.trim().toUpperCase();
    const newCode = generateGuestRecoveryCode();
    localStorage.setItem(GUEST_RECOVERY_KEY, newCode);
    return newCode;
  } catch {
    return generateGuestRecoveryCode();
  }
}

/**
 * Define o código de recuperação manualmente (usado ao restaurar)
 */
export function setGuestRecoveryCode(code: string): void {
  try {
    localStorage.setItem(GUEST_RECOVERY_KEY, code.trim().toUpperCase());
  } catch {}
}

/**
 * Sincroniza a conta do convidado (apelido, avatar e salas) com a nuvem
 */
export async function syncGuestAccount(nickname: string, avatarUrl?: string | null): Promise<boolean> {
  const recoveryCode = getOrCreateGuestRecoveryCode();
  const rooms = getGuestRooms();

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/guest/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recoveryCode,
        nickname: nickname || 'Convidado',
        avatarUrl,
        rooms,
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn('Falha ao sincronizar conta de convidado com servidor:', err);
    return false;
  }
}

/**
 * Recupera os dados de convidado a partir de um código de recuperação
 */
export async function recoverGuestAccount(code: string): Promise<{
  success: boolean;
  recoveryCode?: string;
  nickname?: string;
  avatarUrl?: string | null;
  rooms?: UserRoom[];
  error?: string;
}> {
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode || cleanCode.length < 6) {
    return { success: false, error: 'Por favor, insira um código de recuperação válido.' };
  }

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/guest/${encodeURIComponent(cleanCode)}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success || !data.account) {
      return { success: false, error: data.error || 'Código de convidado não encontrado.' };
    }

    const account = data.account;
    const finalCode = account.recoveryCode || cleanCode;
    setGuestRecoveryCode(finalCode);

    if (Array.isArray(account.rooms)) {
      localStorage.setItem(GUEST_ROOMS_STORAGE_KEY, JSON.stringify(account.rooms));
    }

    if (account.nickname) {
      localStorage.setItem('poe-na-tela-username', account.nickname);
    }

    return {
      success: true,
      recoveryCode: finalCode,
      nickname: account.nickname,
      avatarUrl: account.avatarUrl,
      rooms: account.rooms || [],
    };
  } catch (err: any) {
    return { success: false, error: 'Erro de conexão ao recuperar conta de convidado.' };
  }
}

/**
 * Migra os servidores e histórico salvos localmente/nuvem do convidado para a conta Google permanente
 */
export async function migrateGuestToAccount(accessToken: string): Promise<{
  success: boolean;
  migratedCount: number;
  error?: string;
}> {
  if (!accessToken) return { success: false, migratedCount: 0 };

  const guestRooms = getGuestRooms();
  const recoveryCode = getOrCreateGuestRecoveryCode();

  if (guestRooms.length === 0 && !recoveryCode) {
    return { success: true, migratedCount: 0 };
  }

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/user/migrate-guest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recoveryCode,
        guestRooms,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      const migratedCount = data.migratedCount || 0;
      // Limpa os registros locais de convidado já migrados
      clearGuestRooms();
      return { success: true, migratedCount };
    }

    return {
      success: false,
      migratedCount: 0,
      error: data.error || 'Falha ao migrar servidores do convidado.',
    };
  } catch (err: any) {
    console.warn('Erro ao chamar migração de convidado:', err);
    return { success: false, migratedCount: 0, error: err?.message };
  }
}
