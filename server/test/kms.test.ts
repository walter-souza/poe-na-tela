import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertMasterKeyConfigured, decryptRoomKey, encryptRoomKey, generateRoomKey } from '../src/kms';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('kms', () => {
  it('cifra e decifra a chave da sala (round-trip)', () => {
    vi.stubEnv('MASTER_KEY', 'a'.repeat(64));
    const key = generateRoomKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const encrypted = encryptRoomKey(key);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(decryptRoomKey(encrypted)).toBe(key);
  });

  it('não decifra com outra MASTER_KEY', () => {
    vi.stubEnv('MASTER_KEY', 'chave-um');
    const encrypted = encryptRoomKey(generateRoomKey());
    vi.stubEnv('MASTER_KEY', 'chave-dois');
    expect(() => decryptRoomKey(encrypted)).toThrow();
  });

  it('rejeita payload em formato inválido', () => {
    vi.stubEnv('MASTER_KEY', 'x');
    expect(() => decryptRoomKey('abc')).toThrow(/inválido/);
  });

  it('exige MASTER_KEY quando há Supabase ou NODE_ENV=production', () => {
    vi.stubEnv('MASTER_KEY', '');
    vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co');
    expect(() => assertMasterKeyConfigured()).toThrow(/MASTER_KEY/);
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertMasterKeyConfigured()).toThrow(/MASTER_KEY/);
  });

  it('permite o fallback apenas em dev local sem banco', () => {
    vi.stubEnv('MASTER_KEY', '');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertMasterKeyConfigured()).not.toThrow();
    expect(decryptRoomKey(encryptRoomKey('abc'))).toBe('abc');
  });
});
