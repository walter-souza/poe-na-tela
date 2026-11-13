import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: {
      // Nunca carregar o server/.env local (aponta para LiveKit real) durante os testes.
      DOTENV_CONFIG_PATH: join(tmpdir(), 'poe-tests-no-dotenv'),
      LIVEKIT_URL: 'ws://livekit.test',
      LIVEKIT_API_KEY: 'test-key',
      LIVEKIT_API_SECRET: 'test-secret-with-at-least-32-characters',
      MEDIAMTX_API_URL: 'http://mediamtx.test',
      STREAM_URL: 'https://stream.test',
      ADMIN_BYPASS_TOKEN: 'bypass-token-for-tests-123',
      CLIP_BUFFER: '0',
      CLIP_DIR: join(tmpdir(), 'poe-clips-tests'),
    },
  },
});
