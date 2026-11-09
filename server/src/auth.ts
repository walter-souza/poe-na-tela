import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { TokenVerifier, type RoomServiceClient } from 'livekit-server-sdk';

/** Comparação de segredos em tempo constante (strings de tamanhos diferentes nunca batem). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function scryptHex(passcode: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) =>
    scrypt(passcode, salt, 32, (err, key) => (err ? reject(err) : resolve(key.toString('hex')))),
  );
}

/** Hash da senha da sala no formato `salt:hash` (vai para os metadados da sala no LiveKit). */
export async function hashPasscode(passcode: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${await scryptHex(passcode, salt)}`;
}

export async function verifyPasscode(passcode: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return safeEqual(await scryptHex(passcode, salt), hash);
}

/** Chave de publicação SRT de um caminho do MediaMTX (`sala/usuario`), derivada do segredo do LiveKit. */
export function streamKeyFor(secret: string, path: string): string {
  return createHmac('sha256', secret).update(`publish:${path}`).digest('hex').slice(0, 32);
}

export function bearerToken(req: Request): string | undefined {
  return /^Bearer (.+)$/.exec(req.header('authorization') || '')?.[1];
}

export interface RoomAuthDeps {
  roomService: RoomServiceClient;
  apiKey: string;
  apiSecret: string;
  sanitizeRoomName: (name: string) => string;
}

export type RoomAuth = ReturnType<typeof createRoomAuth>;

/**
 * Autenticação de quem está NA sala agora: token LiveKit válido para a sala E participante conectado.
 * Só o token não basta: ele vale horas e continuaria servindo a quem já saiu.
 */
export function createRoomAuth(deps: RoomAuthDeps) {
  const verifier = new TokenVerifier(deps.apiKey, deps.apiSecret);

  /** Identidade de um token LiveKit válido para a sala (sem exigir presença). */
  async function tokenIdentity(token: string | undefined, roomName: string): Promise<string | null> {
    if (!token || !roomName) return null;
    try {
      const claims = await verifier.verify(token);
      return claims.video?.room === roomName && claims.sub ? claims.sub : null;
    } catch {
      return null;
    }
  }

  async function memberIdentity(token: string | undefined, roomName: string): Promise<string | null> {
    const identity = await tokenIdentity(token, roomName);
    if (!identity) return null;
    try {
      const participants = await deps.roomService.listParticipants(roomName);
      return participants.some((p) => p.identity === identity) ? identity : null;
    } catch {
      return null;
    }
  }

  /** Middleware: exige `Authorization: Bearer <token>` de um participante presente em `:roomName`. */
  async function requireMember(req: Request, res: Response, next: NextFunction) {
    const roomName = deps.sanitizeRoomName(req.params.roomName);
    const identity = await memberIdentity(bearerToken(req), roomName);
    if (!identity) {
      res.status(401).json({ error: 'Sessão inválida para esta sala.' });
      return;
    }
    res.locals.identity = identity;
    res.locals.roomName = roomName;
    next();
  }

  return { tokenIdentity, memberIdentity, requireMember };
}
