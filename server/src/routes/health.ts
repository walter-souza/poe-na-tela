import { Router, Request, Response } from 'express';
import { LIVEKIT_URL, getMaintenanceMessage, isMaintenanceMode } from '../config';

const router = Router();

/**
 * Health check & status endpoint (reports maintenance status)
 */
router.get(['/api/health', '/api/status', '/health', '/status'], (_req: Request, res: Response) => {
  const maintenance = isMaintenanceMode();
  res.json({
    status: maintenance ? 'maintenance' : 'ok',
    maintenance,
    message: maintenance ? getMaintenanceMessage() : undefined,
    livekitUrl: LIVEKIT_URL,
    timestamp: new Date().toISOString(),
    version: '1.6.0',
  });
});

export default router;
