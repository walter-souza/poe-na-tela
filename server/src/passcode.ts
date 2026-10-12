import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const PREFIX = 'scrypt$';
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * Hash de senha de sala no formato `scrypt$<salt hex>$<hash hex>`.
 */
export async function hashPasscode(passcode: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(passcode, salt, KEY_LENGTH);
  return `${PREFIX}${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function isHashedPasscode(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface PasscodeCheck {
  ok: boolean;
  /** Senha antiga em texto puro validada: o chamador deve regravar como hash. */
  needsUpgrade: boolean;
}

/**
 * Compara a senha informada com o valor armazenado em tempo constante.
 * Aceita o formato legado (texto puro) para migrar as salas existentes.
 */
export async function verifyPasscode(stored: string, provided: string): Promise<PasscodeCheck> {
  if (!isHashedPasscode(stored)) {
    const ok = safeEqual(
      crypto.createHash('sha256').update(stored).digest(),
      crypto.createHash('sha256').update(provided).digest()
    );
    return { ok, needsUpgrade: ok };
  }

  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return { ok: false, needsUpgrade: false };

  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(provided, Buffer.from(saltHex, 'hex'), expected.length);
  return { ok: safeEqual(derived, expected), needsUpgrade: false };
}

/**
 * Valida a senha informada contra o valor armazenado (hash scrypt ou legado em texto puro).
 * Se o valor era legado e a senha confere, chama `onUpgrade` com o novo hash para regravar.
 */
export async function checkPasscode(
  stored: string,
  provided: string | null | undefined,
  onUpgrade?: (newHash: string) => PromiseLike<unknown>
): Promise<boolean> {
  if (!provided) return false;
  const result = await verifyPasscode(stored, provided);
  if (result.ok && result.needsUpgrade && onUpgrade) {
    try {
      await onUpgrade(await hashPasscode(provided));
    } catch (err) {
      console.warn('Falha ao migrar senha de sala para hash:', err);
    }
  }
  return result.ok;
}
