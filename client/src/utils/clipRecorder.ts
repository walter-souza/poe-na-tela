/**
 * Clipes locais: grava continuamente o que este cliente está vendo e ouvindo (a stream em destaque
 * e as vozes da sala) e guarda só os últimos segundos. "Clipar" salva esse trecho como WebM.
 *
 * O MediaRecorder só escreve o cabeçalho WebM no primeiro pedaço, então não dá para simplesmente
 * descartar pedaços antigos. Em vez disso o fluxo é separado em Clusters (o Chrome abre um novo a cada
 * quadro-chave de vídeo) e o clipe é: cabeçalho + os Clusters mais recentes.
 */

/** Duração máxima guardada (o clipe começa no primeiro quadro-chave dentro dessa janela). */
export const CLIP_SECONDS = 30;
const SLICE_MS = 1000;
const SYNC_MS = 1000;
const VIDEO_BPS = 6_000_000;
const AUDIO_BPS = 128_000;

// EBML: Cluster ID (1F 43 B6 75), seguido do tamanho e do elemento Timecode (E7).
const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];

interface Cluster {
  data: Uint8Array;
  /** performance.now() de quando o Cluster foi concluído. */
  endedAt: number;
}

export interface ClipSources {
  video: MediaStreamTrack | null;
  audio: MediaStreamTrack[];
}

function pickMimeType(withVideo: boolean): string | null {
  const candidates = withVideo
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Procura o início de um Cluster a partir de `from`. Além do ID de 4 bytes exige um tamanho EBML
 * válido e o Timecode (0xE7) logo depois, para que a mesma sequência dentro de um quadro codificado
 * não seja confundida com um Cluster.
 */
function findCluster(buf: Uint8Array, from: number): number {
  for (let i = from; i <= buf.length - 6; i++) {
    if (buf[i] !== CLUSTER_ID[0] || buf[i + 1] !== CLUSTER_ID[1] || buf[i + 2] !== CLUSTER_ID[2] || buf[i + 3] !== CLUSTER_ID[3]) {
      continue;
    }
    const first = buf[i + 4];
    if (first === 0) continue;
    const sizeLength = Math.clz32(first) - 23; // bytes de tamanho: posição do primeiro bit 1
    if (sizeLength < 1 || sizeLength > 8 || i + 4 + sizeLength >= buf.length) continue;
    if (buf[i + 4 + sizeLength] === 0xe7) return i;
  }
  return -1;
}

export class ClipRecorder {
  private readonly getSources: () => ClipSources;
  private ctx: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private audioNodes = new Map<string, MediaStreamAudioSourceNode>();
  private recorder: MediaRecorder | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private mimeType = '';
  private syncTimer: number | null = null;
  private disposed = false;

  private header: Uint8Array | null = null;
  private clusters: Cluster[] = [];
  /** Bytes recebidos ainda não separados em Clusters completos. */
  private pending: Uint8Array = new Uint8Array(0);
  private headerDone = false;

  constructor(getSources: () => ClipSources) {
    this.getSources = getSources;
  }

  start() {
    if (typeof MediaRecorder === 'undefined') return;
    this.sync();
    this.syncTimer = window.setInterval(() => this.sync(), SYNC_MS);
  }

  stop() {
    this.disposed = true;
    if (this.syncTimer !== null) window.clearInterval(this.syncTimer);
    this.stopRecorder();
    this.audioNodes.forEach((n) => n.disconnect());
    this.audioNodes.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.destination = null;
    this.clusters = [];
  }

  /** Segundos de gravação disponíveis agora (0 se ainda não há nada para salvar). */
  get bufferedSeconds(): number {
    if (!this.header || this.clusters.length === 0) return 0;
    const now = performance.now();
    return Math.min(CLIP_SECONDS, (now - this.clusters[0].endedAt) / 1000);
  }

  /** Monta o clipe com o que está no buffer; null se ainda não há um Cluster completo. */
  buildClip(): Blob | null {
    if (!this.header || this.clusters.length === 0) return null;
    return new Blob([this.header as BlobPart, ...this.clusters.map((c) => c.data as BlobPart)], { type: this.mimeType });
  }

  /** Mantém a gravação alinhada com o que está na tela: troca de vídeo reinicia, áudio é mixado ao vivo. */
  private sync() {
    if (this.disposed) return;
    const { video, audio } = this.getSources();

    this.syncAudio(audio);

    const hasMedia = video !== null || audio.length > 0;
    if (!hasMedia) {
      this.stopRecorder();
      this.resetBuffer();
      return;
    }
    const videoChanged = this.videoTrack?.id !== video?.id;
    if (!this.recorder || this.recorder.state === 'inactive' || videoChanged) {
      this.startRecorder(video);
    }
  }

  private syncAudio(tracks: MediaStreamTrack[]) {
    if (tracks.length === 0 && this.audioNodes.size === 0) return;
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext({ sampleRate: 48000 });
      this.destination = this.ctx.createMediaStreamDestination();
      this.audioNodes.clear();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});

    const wanted = new Map(tracks.filter((t) => t.readyState === 'live').map((t) => [t.id, t]));
    for (const [id, node] of this.audioNodes) {
      if (!wanted.has(id)) {
        node.disconnect();
        this.audioNodes.delete(id);
      }
    }
    for (const [id, track] of wanted) {
      if (this.audioNodes.has(id)) continue;
      const node = this.ctx.createMediaStreamSource(new MediaStream([track]));
      node.connect(this.destination!);
      this.audioNodes.set(id, node);
    }
  }

  private startRecorder(video: MediaStreamTrack | null) {
    this.stopRecorder();
    this.resetBuffer();
    const mimeType = pickMimeType(video !== null);
    if (!mimeType) return;

    const tracks: MediaStreamTrack[] = [];
    if (video) tracks.push(video);
    const audioTrack = this.destination?.stream.getAudioTracks()[0];
    if (audioTrack) tracks.push(audioTrack);
    if (tracks.length === 0) return;

    try {
      const recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType,
        videoBitsPerSecond: VIDEO_BPS,
        audioBitsPerSecond: AUDIO_BPS,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size === 0 || this.recorder !== recorder) return;
        void e.data.arrayBuffer().then((ab) => {
          if (this.recorder === recorder) this.ingest(new Uint8Array(ab));
        });
      };
      recorder.start(SLICE_MS);
      this.recorder = recorder;
      this.videoTrack = video;
      this.mimeType = mimeType;
    } catch (err) {
      console.warn('[Clip] Falha ao iniciar a gravação:', err);
      this.recorder = null;
    }
  }

  private stopRecorder() {
    const recorder = this.recorder;
    this.recorder = null;
    this.videoTrack = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {}
    }
  }

  private resetBuffer() {
    this.header = null;
    this.clusters = [];
    this.pending = new Uint8Array(0);
    this.headerDone = false;
  }

  /** Separa o fluxo em cabeçalho + Clusters completos; o último Cluster fica pendente até o próximo abrir. */
  private ingest(chunk: Uint8Array) {
    this.pending = this.pending.length ? concat([this.pending, chunk]) : chunk;

    let start = this.headerDone ? 0 : findCluster(this.pending, 0);
    if (!this.headerDone) {
      if (start < 0) return;
      this.header = this.pending.slice(0, start);
      this.headerDone = true;
    }
    // `start` aponta para o primeiro Cluster; procura onde o seguinte começa.
    for (;;) {
      const next = findCluster(this.pending, start + 4);
      if (next < 0) break;
      this.clusters.push({ data: this.pending.slice(start, next), endedAt: performance.now() });
      start = next;
    }
    this.pending = this.pending.slice(start);

    const cutoff = performance.now() - CLIP_SECONDS * 1000;
    while (this.clusters.length > 1 && this.clusters[1].endedAt < cutoff) this.clusters.shift();
  }
}

/** Escolhe o que gravar a partir do que está na tela: o vídeo maior e todas as vozes e áudios de stream. */
export function collectClipSources(extraAudio: Array<MediaStreamTrack | null | undefined> = []): ClipSources {
  let bestVideo: MediaStreamTrack | null = null;
  let bestVideoElement: HTMLVideoElement | null = null;
  let bestArea = 0;
  document.querySelectorAll('video').forEach((el) => {
    const stream = el.srcObject;
    if (!(stream instanceof MediaStream)) return;
    const track = stream.getVideoTracks().find((t) => t.readyState === 'live');
    if (!track) return;
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      bestVideo = track;
      bestVideoElement = el;
    }
  });

  const audio = new Map<string, MediaStreamTrack>();
  const add = (t: MediaStreamTrack | null | undefined) => {
    if (t && t.readyState === 'live') audio.set(t.id, t);
  };
  document.querySelectorAll('audio[data-participant]').forEach((el) => {
    const stream = (el as HTMLAudioElement).srcObject;
    if (stream instanceof MediaStream) stream.getAudioTracks().forEach(add);
  });
  // Streams que chegam com o áudio no mesmo MediaStream do vídeo (OBS/WHEP).
  const featured = bestVideoElement as HTMLVideoElement | null;
  if (featured?.srcObject instanceof MediaStream) featured.srcObject.getAudioTracks().forEach(add);
  extraAudio.forEach(add);

  return { video: bestVideo, audio: [...audio.values()] };
}

export function downloadClip(blob: Blob, roomName: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeRoom = roomName.replace(/[^\w-]+/g, '_').slice(0, 40) || 'sala';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `clipe-${safeRoom}-${stamp}.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
