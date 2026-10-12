import { PORT, LIVEKIT_URL, isMaintenanceMode, getMaintenanceMessage } from './config';
import { webcrypto } from 'node:crypto';
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
  // @ts-ignore
  globalThis.crypto = webcrypto;
}

import { assertMasterKeyConfigured } from './kms';
import { app } from './app';
import { startStreamsMonitor } from './services/streams';

// Falha cedo se a MASTER_KEY estiver ausente em ambiente com banco real.
assertMasterKeyConfigured();

startStreamsMonitor();

app.listen(PORT, () => {
  console.log(`🚀 Põe na Tela — Servidor rodando em http://localhost:${PORT}`);
  console.log(`📡 Conectado ao LiveKit em: ${LIVEKIT_URL}`);
  if (isMaintenanceMode()) {
    console.log(`⚠️ MODO DE MANUTENÇÃO ATIVADO! (${getMaintenanceMessage()})`);
  }
});
