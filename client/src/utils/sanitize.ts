/**
 * Unicode-safe sanitization for room names.
 * Preserves accented characters (é, ã, ç, etc.), international alphabets, and spaces,
 * while stripping unsafe URL/control characters and normalizing whitespace.
 */
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

const INVITE_PARAMS = ['server', 's', 'invite', 'room', 'r'];

/**
 * Aceita um link de convite (?room=, ?invite=, ?server=...) ou só o nome/código do servidor
 * e devolve o nome do servidor já sanitizado ('' se não houver).
 */
export function parseRoomInput(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(raw);
  if (!looksLikeUrl) return sanitizeRoomName(raw);
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    for (const key of INVITE_PARAMS) {
      const value = url.searchParams.get(key);
      if (value) return sanitizeRoomName(value);
    }
    const lastSegment = url.pathname.split('/').filter(Boolean).pop();
    return lastSegment ? sanitizeRoomName(decodeURIComponent(lastSegment)) : '';
  } catch {
    return '';
  }
}
