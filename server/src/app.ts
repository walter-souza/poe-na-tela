import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import healthRouter from './routes/health';
import tokenRouter from './routes/token';
import roomsRouter from './routes/rooms';
import userRouter from './routes/user';
import guestRouter from './routes/guest';
import channelsRouter from './routes/channels';
import voiceRouter from './routes/voice';
import webhooksRouter from './routes/webhooks';

export const app = express();

// Atrás do Caddy: usa o IP repassado em X-Forwarded-For (1 salto de proxy).
app.set('trust proxy', 1);

// Origens permitidas para chamadas do navegador. Adicione outras em ALLOWED_ORIGINS (separadas por vírgula).
const ALLOWED_ORIGINS = new Set([
  'https://poe-na-tela.vercel.app',
  'https://poe-na-tela-dev.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  ...(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
]);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, callback) {
    // Sem Origin (curl, proxy da Vercel, server-to-server) e 'null' (Electron file://) seguem permitidos.
    if (!origin || origin === 'null' || ALLOWED_ORIGINS.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-room-passcode'],
}));
app.use(express.json({ limit: '100kb' }));

// Limite geral por IP (folgado: o IP visto pode ser o da Vercel quando passa pelo rewrite /api).
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Tente novamente em instantes.' },
  })
);

app.use(healthRouter);
app.use(tokenRouter);
app.use(roomsRouter);
app.use(userRouter);
app.use(guestRouter);
app.use(channelsRouter);
app.use(voiceRouter);
app.use(webhooksRouter);
