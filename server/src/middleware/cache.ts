import { Request, Response, NextFunction } from 'express';

/**
 * Criar sala persistente (Discord-like)
 * Apenas usuários autenticados (não convidados)
 */
/**
 * Cache em memória de respostas JSON públicas (iguais para todos os usuários) por `ttlMs`.
 * Evita refazer listRooms no LiveKit e a consulta de salas no Supabase a cada polling do Lobby.
 */
export function cacheJson(ttlMs: number) {
  const cache = new Map<string, { expires: number; status: number; body: unknown }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.path;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      res.setHeader('X-Cache', 'HIT');
      res.status(hit.status).json(hit.body);
      return;
    }
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode === 200) {
        cache.set(key, { expires: Date.now() + ttlMs, status: 200, body });
      }
      return originalJson(body);
    };
    next();
  };
}
