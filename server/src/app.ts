// config.js primeiro: carrega o .env antes dos módulos que leem process.env ao serem carregados.
import { ALLOWED_ORIGINS, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } from './config.js';
import express from 'express';
import cors from 'cors';
import { ClipBufferManager } from './clipBuffer.js';
import { createClipRouter } from './clips.js';
import { roomAuth, roomService } from './livekit.js';
import { healthRouter } from './routes/health.js';
import { roomsRouter } from './routes/rooms.js';
import { streamsRouter } from './routes/streams.js';
import { tokenRouter } from './routes/token.js';

export const app = express();
// Cliente -> Vercel (rewrite de /api) -> Caddy -> backend: o IP real é o que a Vercel registrou no
// X-Forwarded-For, dois saltos antes. Quem chamar a API direto consegue forjar esse valor, por isso a
// força bruta de senha também é limitada por sala (tokenRoomLimiter), que não depende do IP.
app.set('trust proxy', 2);

app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

app.use(healthRouter);
app.use(tokenRouter);
app.use(roomsRouter);
app.use(streamsRouter);

// Buffer de vozes para clipes (só RAM, só em salas com o clipe ligado). Criado aqui e iniciado pelo
// index.ts, para que os testes montem o app sem conectar o bot de clipe ao LiveKit.
export const clipBuffers = new ClipBufferManager({
  roomService,
  livekitUrl: LIVEKIT_URL,
  apiKey: LIVEKIT_API_KEY,
  apiSecret: LIVEKIT_API_SECRET,
});

// Clipes prontos (vídeo do cliente + vozes do buffer) para preview e download.
app.use(createClipRouter({ roomService, clipBuffers, roomAuth }));
