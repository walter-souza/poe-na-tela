import { describe, expect, it } from 'vitest';
import { hashPasscode, isHashedPasscode, verifyPasscode } from '../src/passcode';

describe('passcode', () => {
  it('gera hash scrypt com salt aleatório', async () => {
    const a = await hashPasscode('segredo');
    const b = await hashPasscode('segredo');
    expect(isHashedPasscode(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain('segredo');
  });

  it('valida senha correta e rejeita a errada', async () => {
    const hash = await hashPasscode('segredo');
    expect((await verifyPasscode(hash, 'segredo')).ok).toBe(true);
    expect((await verifyPasscode(hash, 'Segredo')).ok).toBe(false);
    expect((await verifyPasscode(hash, '')).ok).toBe(false);
  });

  it('aceita senha legada em texto puro e pede upgrade', async () => {
    expect(await verifyPasscode('legado', 'legado')).toEqual({ ok: true, needsUpgrade: true });
    expect(await verifyPasscode('legado', 'outra')).toEqual({ ok: false, needsUpgrade: false });
  });

  it('rejeita hash malformado sem lançar erro', async () => {
    expect((await verifyPasscode('scrypt$zzzz', 'x')).ok).toBe(false);
  });
});
