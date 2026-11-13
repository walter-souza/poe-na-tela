// config.js primeiro: carrega o .env antes dos módulos que leem process.env ao serem carregados.
import { CLIP_BUFFER_ENABLED, HOST, LIVEKIT_URL, PORT, getMaintenanceMessage, isMaintenanceMode } from './config.js';
import { webcrypto } from 'node:crypto';
import { app, clipBuffers } from './app.js';

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
  // @ts-ignore
  globalThis.crypto = webcrypto;
}

// Buffer de vozes para clipes (só RAM, só em salas com o clipe ligado). CLIP_BUFFER=0 desliga.
if (CLIP_BUFFER_ENABLED) void clipBuffers.start();

app.listen(PORT, HOST, () => {
  console.log(`🚀 Põe na Tela — Servidor rodando em http://localhost:${PORT}`);
  console.log(`📡 Conectado ao LiveKit em: ${LIVEKIT_URL}`);
  if (isMaintenanceMode()) {
    console.log(`⚠️ MODO DE MANUTENÇÃO ATIVADO! (${getMaintenanceMessage()})`);
  }
});
