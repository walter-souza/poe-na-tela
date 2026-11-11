/**
 * Estado da sessão guardado nos metadados da sala no LiveKit (sobrevive a reinícios do backend e some
 * junto com a sala): `pass` é o hash da senha, `claimedAt` marca quem acabou de criar a sessão.
 */
export interface RoomMeta {
  clip?: boolean;
  pass?: string;
  claimedAt?: number;
}

export function parseRoomMeta(metadata: string | undefined): RoomMeta {
  try {
    const parsed = metadata ? JSON.parse(metadata) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Nome de sala seguro para LiveKit e MediaMTX (Unicode preservado, minúsculo, sem separadores de caminho). */
export function sanitizeRoomName(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[\/\?\\#%<>"'`\r\n\t\0]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 64);
}

export function sanitizeUserName(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFC')
    .trim()
    .replace(/[\r\n\t\0]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 32);
}
