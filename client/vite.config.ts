import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const APP_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;
// Unique per deploy: Vercel provides the commit; local builds fall back to the build time.
const APP_BUILD = `${APP_VERSION}+${(process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 12)}`;

// Emits version.json next to the app; open tabs poll it to notice a new deploy (useAppUpdate).
function versionManifest(): Plugin {
  return {
    name: 'version-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: APP_VERSION, build: APP_BUILD }),
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), versionManifest()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
    'import.meta.env.VITE_APP_BUILD': JSON.stringify(APP_BUILD),
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
