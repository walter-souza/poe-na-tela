import crypto from 'node:crypto';

/**
 * Key Management Service (KMS) — Põe na Tela
 *
 * Responsável pela Criptografia Segregada (Envelope Encryption).
 * A MASTER_KEY fica exclusivamente no backend (.env) e cifra/decifra
 * as chaves simétricas de cada sala (Room Keys).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recomendado para GCM

/**
 * A chave de fallback é pública (está no repositório). Só é aceita sem banco real:
 * com Supabase configurado ou NODE_ENV=production, a ausência da MASTER_KEY é fatal.
 */
export function assertMasterKeyConfigured(): void {
  if (process.env.MASTER_KEY) return;
  if (process.env.NODE_ENV === 'production' || process.env.SUPABASE_URL) {
    throw new Error(
      '[KMS] MASTER_KEY não definida. Recusando iniciar com a chave de fallback pública em ambiente com banco de dados.'
    );
  }
}

function getMasterKey(): Buffer {
  const envKey = process.env.MASTER_KEY;
  if (!envKey) {
    assertMasterKeyConfigured();
    console.warn('⚠️ [KMS] MASTER_KEY não definida. Usando chave de fallback apenas para desenvolvimento local sem banco.');
    return crypto.createHash('sha256').update('poe-na-tela-dev-master-key-seed').digest();
  }

  // Se a chave for fornecida em hexadecimal de 64 caracteres (32 bytes)
  if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
    return Buffer.from(envKey, 'hex');
  }

  // Caso contrário, faz hash SHA-256 para garantir exatamente 32 bytes
  return crypto.createHash('sha256').update(envKey).digest();
}

/**
 * Gera uma nova Room Key de 256 bits (32 bytes) em formato Hexadecimal.
 */
export function generateRoomKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Cifra uma Room Key com a Master Key do sistema.
 * Retorna string no formato: iv:authTag:ciphertext (tudo em hex)
 */
export function encryptRoomKey(roomKeyHex: string): string {
  const masterKey = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(roomKeyHex, 'utf8')),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decifra uma Room Key cifrada com a Master Key do sistema.
 */
export function decryptRoomKey(encryptedPayload: string): string {
  const masterKey = getMasterKey();
  const parts = encryptedPayload.split(':');

  if (parts.length !== 3) {
    throw new Error('Formato de payload cifrado inválido para Room Key.');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
