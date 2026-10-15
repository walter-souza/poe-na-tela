// Baixa o ffmpeg (build LGPL, com NVENC/QSV/AMF/SRT/Opus) e o instala como sidecar do Tauri.
// Uso: npm run fetch:ffmpeg   (ou --from <caminho do ffmpeg.exe> para copiar um já instalado)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src-tauri', 'binaries', 'ffmpeg-x86_64-pc-windows-msvc.exe');
const URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip';

mkdirSync(dirname(target), { recursive: true });
const fromIdx = process.argv.indexOf('--from');
if (fromIdx !== -1) {
  copyFileSync(process.argv[fromIdx + 1], target);
  console.log(`ffmpeg copiado para ${target}`);
  process.exit(0);
}
if (existsSync(target)) {
  console.log('ffmpeg já presente, nada a fazer.');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'ffmpeg-'));
try {
  const zip = join(tmp, 'ffmpeg.zip');
  console.log(`Baixando ${URL}`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xf', zip, '-C', tmp, '--strip-components=2', '*/bin/ffmpeg.exe']);
  copyFileSync(join(tmp, 'ffmpeg.exe'), target);
  console.log(`ffmpeg instalado em ${target}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
