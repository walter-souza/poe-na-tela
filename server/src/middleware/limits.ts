import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { sanitizeRoomName } from '../sanitize';

/**
 * Anti brute force de senha de sala: só tentativas com senha ERRADA contam.
 * Pedir a senha pela primeira vez (403 requiresPasscode) ou nome duplicado (409) não consomem o limite.
 */
export function markWrongPasscode(res: Response, provided: unknown): void {
  if (typeof provided === 'string' && provided) res.locals.wrongPasscode = true;
}

export function passcodeRoomSlug(req: Request): string {
  const raw = (req.params.roomName ?? req.body?.roomName ?? '') as string;
  return sanitizeRoomName(typeof raw === 'string' ? raw : '');
}

export const passcodeLimiterBase = {
  windowMs: 15 * 60_000,
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req: Request, res: Response) => !res.locals.wrongPasscode,
  message: { error: 'Muitas tentativas de senha incorreta. Aguarde alguns minutos e tente novamente.' },
};

// Por IP + sala: 10 erros / 15 min.
export const passcodeIpLimiter = rateLimit({
  ...passcodeLimiterBase,
  limit: 10,
  keyGenerator: (req) => `${req.ip}|${passcodeRoomSlug(req)}`,
});

// Por sala (qualquer IP): 60 erros / 15 min, contra ataque distribuído.
export const passcodeRoomLimiter = rateLimit({
  ...passcodeLimiterBase,
  limit: 60,
  keyGenerator: (req) => `room|${passcodeRoomSlug(req)}`,
});

export const passcodeGuards = [passcodeIpLimiter, passcodeRoomLimiter];

export const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em instantes.' },
});
