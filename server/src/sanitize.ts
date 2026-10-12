/**
 * Unicode-safe sanitization for room names.
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
