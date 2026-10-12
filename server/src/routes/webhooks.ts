import crypto from 'node:crypto';
import { Router, Request, Response } from 'express';
import { broadcastRoomStreams, roomSlugFromStreamPath } from '../services/streams';

const router = Router();

/**
 * Webhook do MediaMTX (runOnReady / runOnNotReady) — caminho principal de atualização.
 * Se MEDIAMTX_WEBHOOK_SECRET estiver definido, exige o header x-webhook-secret ou ?secret=.
 */
router.post(['/api/webhooks/mediamtx', '/webhooks/mediamtx'], async (req: Request, res: Response): Promise<void> => {
  const expectedSecret = process.env.MEDIAMTX_WEBHOOK_SECRET;
  if (expectedSecret) {
    const given = req.headers['x-webhook-secret'] ?? req.query.secret;
    const a = crypto.createHash('sha256').update(typeof given === 'string' ? given : '').digest();
    const b = crypto.createHash('sha256').update(expectedSecret).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ error: 'Não autorizado.' });
      return;
    }
  }

  try {
    const { path } = req.body || {};
    const roomSlug = roomSlugFromStreamPath(path);
    if (roomSlug) await broadcastRoomStreams(roomSlug);
  } catch (err) {
    console.warn('[MediaMTX Webhook] Erro ao processar evento:', err);
  }
  res.json({ ok: true });
});

export default router;
