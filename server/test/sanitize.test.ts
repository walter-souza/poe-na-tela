import { describe, expect, it } from 'vitest';
import { sanitizeRoomName, sanitizeUserName } from '../src/sanitize';

describe('sanitizeRoomName', () => {
  it('normaliza caixa, espaços e remove caracteres de rota', () => {
    expect(sanitizeRoomName('  Minha   Sala  ')).toBe('minha sala');
    expect(sanitizeRoomName('a/b?c\d#e%f<g>"h\'i`')).toBe('abcdefghi');
  });

  it('remove quebras de linha e nulos', () => {
    expect(sanitizeRoomName('sa\r\nla\0')).toBe('sala');
  });

  it('preserva acentos (Unicode NFC) e limita a 64 caracteres', () => {
    expect(sanitizeRoomName('Café São João')).toBe('café são joão');
    expect(sanitizeRoomName('x'.repeat(100))).toHaveLength(64);
  });

  it('retorna vazio para entrada vazia', () => {
    expect(sanitizeRoomName('')).toBe('');
    expect(sanitizeRoomName(undefined as unknown as string)).toBe('');
  });
});

describe('sanitizeUserName', () => {
  it('mantém a caixa, colapsa espaços e limita a 32 caracteres', () => {
    expect(sanitizeUserName('  Ana   Maria ')).toBe('Ana Maria');
    expect(sanitizeUserName('y'.repeat(50))).toHaveLength(32);
  });
});
