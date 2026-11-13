import { describe, expect, it } from 'vitest';
import { hashPasscode, safeEqual, streamKeyFor, verifyPasscode } from '../src/auth.js';
import { encodeWav, isClipEnabled, withClipFlag } from '../src/clipBuffer.js';
import { parseRoomMeta, sanitizeRoomName, sanitizeUserName } from '../src/room.js';

describe('sanitizeRoomName', () => {
  it('normaliza para minúsculas, sem espaços extras', () => {
    expect(sanitizeRoomName('  Jogatina   da  NOITE ')).toBe('jogatina da noite');
  });

  it('remove separadores de caminho e caracteres de injeção', () => {
    expect(sanitizeRoomName('sala/../outra?x=1#a%20<b>"\'`\\')).toBe('sala..outrax=1a20b');
  });

  it('preserva Unicode (acentos) e limita a 64 caracteres', () => {
    expect(sanitizeRoomName('Ação')).toBe('ação');
    expect(sanitizeRoomName('a'.repeat(100))).toHaveLength(64);
  });

  it('trata vazio', () => {
    expect(sanitizeRoomName('')).toBe('');
  });
});

describe('sanitizeUserName', () => {
  it('mantém maiúsculas e barras, remove quebras de linha e limita a 32', () => {
    expect(sanitizeUserName('  Ana\n\tSouza ')).toBe('Ana Souza');
    expect(sanitizeUserName('x'.repeat(50))).toHaveLength(32);
  });
});

describe('parseRoomMeta', () => {
  it('lê o JSON dos metadados', () => {
    expect(parseRoomMeta('{"pass":"a:b","clip":true}')).toEqual({ pass: 'a:b', clip: true });
  });

  it('devolve objeto vazio para metadado ausente ou ilegível', () => {
    expect(parseRoomMeta(undefined)).toEqual({});
    expect(parseRoomMeta('não é json')).toEqual({});
    expect(parseRoomMeta('null')).toEqual({});
  });
});

describe('senha da sala', () => {
  it('confere a senha certa e recusa a errada', async () => {
    const stored = await hashPasscode('segredo');
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(await verifyPasscode('segredo', stored)).toBe(true);
    expect(await verifyPasscode('Segredo', stored)).toBe(false);
  });

  it('usa sal diferente a cada hash', async () => {
    expect(await hashPasscode('x')).not.toBe(await hashPasscode('x'));
  });

  it('recusa hash malformado', async () => {
    expect(await verifyPasscode('x', 'sem-separador')).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compara strings, inclusive de tamanhos diferentes', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('streamKeyFor', () => {
  it('é determinística por segredo e caminho', () => {
    const key = streamKeyFor('s1', 'sala/ana');
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(streamKeyFor('s1', 'sala/ana')).toBe(key);
    expect(streamKeyFor('s1', 'sala/bia')).not.toBe(key);
    expect(streamKeyFor('s2', 'sala/ana')).not.toBe(key);
  });
});

describe('flag de clipe nos metadados', () => {
  it('liga e desliga preservando o resto dos metadados', () => {
    const meta = withClipFlag('{"pass":"h"}', true);
    expect(JSON.parse(meta)).toEqual({ pass: 'h', clip: true });
    expect(isClipEnabled(meta)).toBe(true);
    expect(isClipEnabled(withClipFlag(meta, false))).toBe(false);
  });

  it('recomeça de metadado ilegível', () => {
    expect(JSON.parse(withClipFlag('{quebrado', true))).toEqual({ clip: true });
    expect(isClipEnabled('{quebrado')).toBe(false);
  });
});

describe('encodeWav', () => {
  it('gera cabeçalho RIFF/WAVE com o tamanho dos dados', () => {
    const wav = encodeWav(new Int16Array([0, 1, -1, 32767]));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(40)).toBe(8);
    expect(wav.length).toBe(44 + 8);
  });
});
