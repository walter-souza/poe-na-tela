import { raw, Router, type NextFunction, type Request, type Response } from 'express';
import type { RoomServiceClient } from 'livekit-server-sdk';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RoomAuth } from './auth.js';
import { encodeWav, isClipEnabled, withClipFlag, type ClipBufferManager } from './clipBuffer.js';

/**
 * Clipes prontos para preview/download.
 *
 * O cliente envia o vídeo que guardou localmente (stream + áudio da stream); o servidor mistura as vozes
 * do buffer de memória da sala (ver clipBuffer.ts) sem reencodar o vídeo, guarda o resultado por pouco
 * tempo em disco temporário e serve para o preview. Clipes expiram sozinhos (CLIP_TTL_MIN).
 */

const CLIP_DIR = process.env.CLIP_DIR || join(tmpdir(), 'poe-clips');
const TTL_MS = (Number(process.env.CLIP_TTL_MIN) || 30) * 60_000;
const MAX_UPLOAD = '120mb';
const MAX_PER_USER = 3;
const MAX_TOTAL = 12;
/** Cada envio fica inteiro na RAM até terminar: poucos ao mesmo tempo para não derrubar o processo. */
const MAX_CONCURRENT_UPLOADS = 2;
const MAX_SECONDS = 60;
const FFMPEG_TIMEOUT_MS = 120_000;
/**
 * As vozes chegam ao servidor antes de chegarem ao espectador (latência de descida); esse atraso, em ms,
 * desloca a janela de voz para trás para alinhar com o vídeo gravado no cliente. Calibrar na prática.
 */
const VOICE_DELAY_MS = Number(process.env.CLIP_VOICE_DELAY_MS) || 0;

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
const ID_PATTERN = /^[a-f0-9]{32}$/;

interface ClipRecord {
  id: string;
  room: string;
  creator: string;
  createdAt: number;
  /** Instante (relógio do servidor) em que termina o vídeo enviado. */
  endMs: number;
  file?: string;
  size?: number;
  seconds?: number;
}

interface FfmpegResult {
  code: number | null;
  stderr: string;
}

// Só um ffmpeg por vez: a VPS tem poucos núcleos e o LiveKit precisa deles.
let queue: Promise<unknown> = Promise.resolve();
function runFfmpeg(args: string[]): Promise<FfmpegResult> {
  const job = queue.then(
    () =>
      new Promise<FfmpegResult>((resolve, reject) => {
        const child = spawn(FFMPEG, ['-hide_banner', '-nostdin', ...args], { windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (d) => {
          stderr = (stderr + d).slice(-20_000);
        });
        const timer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_TIMEOUT_MS);
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code, stderr });
        });
      }),
  );
  queue = job.catch(() => {});
  return job;
}

function parseProbe(stderr: string) {
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return {
    seconds: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
    hasVideo: /Stream #\S+.*: Video:/.test(stderr),
    hasAudio: /Stream #\S+.*: Audio:/.test(stderr),
  };
}

export interface ClipRouterDeps {
  roomService: RoomServiceClient;
  clipBuffers: ClipBufferManager;
  roomAuth: RoomAuth;
}

export function createClipRouter(deps: ClipRouterDeps): Router {
  const router = Router();
  const clips = new Map<string, ClipRecord>();
  const authenticate = deps.roomAuth.requireMember;
  let uploadsInFlight = 0;

  const dirOf = (id: string) => join(CLIP_DIR, id);

  async function remove(id: string) {
    clips.delete(id);
    await rm(dirOf(id), { recursive: true, force: true }).catch(() => {});
  }

  // Começa limpo (restos de uma execução anterior) e expira clipes antigos.
  void rm(CLIP_DIR, { recursive: true, force: true })
    .then(() => mkdir(CLIP_DIR, { recursive: true }))
    .catch(() => {});
  setInterval(() => {
    const cutoff = Date.now() - TTL_MS;
    for (const rec of clips.values()) if (rec.createdAt < cutoff) void remove(rec.id);
  }, 60_000).unref();

  /**
   * Liga/desliga o clipe da sala. Vale para todos: ligado, as vozes de todos entram no buffer de memória
   * do servidor. Qualquer participante presente pode mudar.
   */
  router.post(['/api/rooms/:roomName/clip', '/rooms/:roomName/clip'], authenticate, async (req: Request, res: Response) => {
    const { roomName } = res.locals as { roomName: string };
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Requisição inválida.' });
      return;
    }
    try {
      const [room] = await deps.roomService.listRooms([roomName]);
      if (!room) {
        res.status(404).json({ error: 'Sala não encontrada.' });
        return;
      }
      await deps.roomService.updateRoomMetadata(roomName, withClipFlag(room.metadata, enabled));
      res.json({ clipEnabled: enabled });
    } catch (err: any) {
      console.error('Falha ao alterar o clipe da sala:', err?.message || err);
      res.status(500).json({ error: 'Não foi possível alterar o clipe da sala.' });
    }
  });

  // 1) Registra o instante do clique; o vídeo é enviado em seguida.
  router.post('/api/rooms/:roomName/clips', authenticate, async (req: Request, res: Response) => {
    const { identity, roomName } = res.locals as { identity: string; roomName: string };
    const [room] = await deps.roomService.listRooms([roomName]).catch(() => []);
    if (!room || !isClipEnabled(room.metadata)) {
      res.status(409).json({ error: 'O clipe está desligado nesta sala.' });
      return;
    }
    const mine = [...clips.values()].filter((c) => c.creator === identity && c.room === roomName).length;
    if (mine >= MAX_PER_USER || clips.size >= MAX_TOTAL) {
      res.status(429).json({ error: 'Muitos clipes abertos. Descarte algum e tente de novo.' });
      return;
    }
    // O vídeo termina um pouco antes do clique (o último pedaço só fecha no próximo quadro-chave).
    const lagMs = Math.min(30_000, Math.max(0, Number(req.body?.lagMs) || 0));
    const id = randomBytes(16).toString('hex');
    clips.set(id, { id, room: roomName, creator: identity, createdAt: Date.now(), endMs: Date.now() - lagMs });
    res.json({ id });
  });

  // 2) Recebe o vídeo (qualquer Content-Type: o do MediaRecorder traz codecs com vírgula, que o parser recusa), mistura as vozes e deixa o clipe pronto.
  router.put(
    '/api/rooms/:roomName/clips/:id',
    authenticate,
    (_req: Request, res: Response, next: NextFunction) => {
      if (uploadsInFlight >= MAX_CONCURRENT_UPLOADS) {
        res.status(429).json({ error: 'Servidor ocupado montando outros clipes. Tente de novo em instantes.' });
        return;
      }
      uploadsInFlight++;
      res.once('close', () => uploadsInFlight--);
      next();
    },
    raw({ type: () => true, limit: MAX_UPLOAD }),
    async (req: Request, res: Response) => {
      const { identity, roomName } = res.locals as { identity: string; roomName: string };
      const rec = ID_PATTERN.test(req.params.id) ? clips.get(req.params.id) : undefined;
      if (!rec || rec.room !== roomName || rec.creator !== identity) {
        res.status(404).json({ error: 'Clipe não encontrado.' });
        return;
      }
      if (rec.file) {
        res.status(409).json({ error: 'Este clipe já foi enviado.' });
        return;
      }
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body) || body.length < 1024) {
        res.status(400).json({ error: 'Vídeo do clipe ausente ou vazio.' });
        return;
      }

      try {
        await build(rec, body);
        res.json({ id: rec.id, seconds: rec.seconds, size: rec.size });
      } catch (err: any) {
        console.error('🎬 Falha ao montar o clipe:', err?.message || err);
        await remove(rec.id);
        res.status(500).json({ error: 'Não foi possível montar o clipe.' });
      }
    },
  );

  async function build(rec: ClipRecord, video: Buffer) {
    const dir = dirOf(rec.id);
    await mkdir(dir, { recursive: true });
    const inFile = join(dir, 'in.webm');
    const voiceFile = join(dir, 'voices.wav');
    const outFile = join(dir, 'clip.webm');
    await writeFile(inFile, video);

    // O arquivo vem do usuário: força o demuxer WebM/Matroska e só o protocolo file. Sem isso o ffmpeg
    // escolhe o formato pelo conteúdo, e uma "playlist" HLS/concat o faria ler arquivos locais ou URLs.
    const untrustedInput = ['-f', 'matroska', '-protocol_whitelist', 'file', '-i', inFile];
    const probe = parseProbe((await runFfmpeg(untrustedInput)).stderr);
    if (!probe.hasVideo && !probe.hasAudio) throw new Error('arquivo de vídeo inválido');
    const seconds = Math.min(MAX_SECONDS, Math.max(1, probe.seconds ?? 30));

    const recorder = deps.clipBuffers.get(rec.room);
    const voices = recorder ? recorder.mix(seconds, rec.endMs - VOICE_DELAY_MS) : new Int16Array(Math.round(seconds * 48000));
    await writeFile(voiceFile, encodeWav(voices));

    const args = ['-y', ...untrustedInput, '-i', voiceFile];
    if (probe.hasAudio) {
      // Áudio da stream + vozes. Sem normalização: cada fonte mantém o volume com que foi capturada.
      args.push('-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]', '-map', '[a]');
    } else {
      args.push('-map', '1:a:0');
    }
    if (probe.hasVideo) args.push('-map', '0:v:0', '-c:v', 'copy');
    args.push('-c:a', 'libopus', '-b:a', '128k', '-t', String(seconds), '-f', 'webm', outFile);

    const result = await runFfmpeg(args);
    if (result.code !== 0) throw new Error(`ffmpeg saiu com ${result.code}: ${result.stderr.slice(-400)}`);

    await Promise.all([rm(inFile, { force: true }), rm(voiceFile, { force: true })]);
    rec.file = outFile;
    rec.seconds = Math.round(seconds * 10) / 10;
    rec.size = (await stat(outFile)).size;
  }

  // 3) Preview/download. O id (128 bits aleatórios) é a credencial: <video src> não envia cabeçalhos.
  router.get('/api/clips/:id/video', (req: Request, res: Response) => {
    const rec = ID_PATTERN.test(req.params.id) ? clips.get(req.params.id) : undefined;
    if (!rec?.file) {
      res.status(404).json({ error: 'Clipe não encontrado ou expirado.' });
      return;
    }
    if (req.query.download === '1') {
      const stamp = new Date(rec.createdAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeRoom = rec.room.replace(/[^\w-]+/g, '_').slice(0, 40) || 'sala';
      res.attachment(`clipe-${safeRoom}-${stamp}.webm`);
    }
    res.sendFile(rec.file, { dotfiles: 'allow', headers: { 'Content-Type': 'video/webm', 'Cache-Control': 'private, no-store' } });
  });

  router.delete('/api/clips/:id', async (req: Request, res: Response) => {
    if (ID_PATTERN.test(req.params.id)) await remove(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
