import { Router, type Request, type Response } from 'express';
import { getMaintenanceMessage, isMaintenanceMode, LIVEKIT_URL } from '../config.js';

export const healthRouter = Router();

/** Health check e status (informa o modo de manutenção). */
healthRouter.get(['/api/health', '/api/status', '/health', '/status'], (_req: Request, res: Response) => {
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
