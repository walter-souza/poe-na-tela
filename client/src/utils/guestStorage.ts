import type { UserRoom } from '../types';

export const GUEST_ROOMS_STORAGE_KEY = 'poe_na_tela_guest_rooms';

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
