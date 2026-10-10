/**
 * CryptoService — Põe na Tela
 *
 * Implementa Criptografia Simétrica no Cliente via Web Crypto API (AES-GCM 256 bits).
 * As mensagens são cifradas no navegador antes de serem enviadas ao Supabase,
 * garantindo que o banco de dados armazene apenas ciphertext e IV ininteligíveis.
 */

// Converte string hexadecimal para Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Converte Uint8Array para Base64
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Converte Base64 para Uint8Array
function base64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Importa uma chave hexadecimal de 256 bits para um CryptoKey da Web Crypto API
 */
export async function importRoomKey(rawKeyHex: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(rawKeyHex);
  return window.crypto.subtle.importKey(
    'raw',
    keyBytes as any,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedPayload {
  ciphertext: string; // Base64
  iv: string; // Base64
}

/**
 * Cifra um texto com a chave da sala usando AES-GCM (IV aleatório de 12 bytes / 96 bits)
 */
export async function encryptText(text: string, key: CryptoKey): Promise<EncryptedPayload> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encodedText = encoder.encode(text);

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encodedText
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
    iv: bytesToBase64(iv),
  };
}

/**
 * Decifra um texto cifrado em Base64 usando a chave da sala e o IV
 */
export async function decryptText(
  ciphertextBase64: string,
  ivBase64: string,
  key: CryptoKey
): Promise<string> {
  try {
    const ciphertextBytes = base64ToBytes(ciphertextBase64);
    const ivBytes = base64ToBytes(ivBase64);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes as any,
      },
      key,
      ciphertextBytes as any
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (err) {
    console.warn('Falha ao decifrar mensagem com a chave fornecida:', err);
    return '🔒 [Mensagem protegida - não foi possível decifrar]';
  }
}
