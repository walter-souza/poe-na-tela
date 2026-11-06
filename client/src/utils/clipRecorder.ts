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
  /** Vídeos na tela; o primeiro é o destaque (o que "Clipar" salva). */
  videos: MediaStreamTrack[];
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


const INFO_ID = [0x15, 0x49, 0xa9, 0x66];

/** Lê um tamanho EBML em `buf[at]`: { length: bytes do campo, value }. */
function readSize(buf: Uint8Array, at: number): { length: number; value: number } {
  const length = Math.clz32(buf[at]) - 23;
  let value = buf[at] & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + buf[at + i];
  return { length, value };
}

/** Campo de tamanho EBML de 8 bytes (aceita qualquer valor; evita mudar o comprimento ao reescrever). */
function size8(value: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let i = 7; i >= 1; i--) {
    out[i] = value % 256;
    value = Math.floor(value / 256);
  }
  return out;
}

/** Timecode (em ms) do Cluster que começa em `buf[0]`, e onde seus bytes estão. */
function clusterTimecode(buf: Uint8Array): { at: number; length: number; value: number } | null {
  const size = readSize(buf, 4);
  const at = 4 + size.length; // E7 <tamanho> <valor>
  if (buf[at] !== 0xe7) return null;
  const len = readSize(buf, at + 1);
  const dataAt = at + 1 + len.length;
  let value = 0;
  for (let i = 0; i < len.value; i++) value = value * 256 + buf[dataAt + i];
  return { at: dataAt, length: len.value, value };
}

/**
 * O MediaRecorder grava os tempos desde o início da gravação e não escreve a duração. Para o clipe
 * começar em 0:00 e os players mostrarem a duração: desloca o Timecode de cada Cluster (mantendo o
 * mesmo comprimento em bytes, só com zeros à esquerda) e acrescenta Duration ao Info do cabeçalho.
 */
function fixWebm(header: Uint8Array, clusters: Uint8Array[]): Uint8Array[] {
  const copies = clusters.map((c) => c.slice());
  const tcs = copies.map(clusterTimecode);
  if (tcs.some((t) => t === null)) return [header, ...clusters];
  const base = tcs[0]!.value;
  tcs.forEach((t, i) => {
    let v = Math.max(0, t!.value - base);
    for (let b = t!.length - 1; b >= 0; b--) {
      copies[i][t!.at + b] = v % 256;
      v = Math.floor(v / 256);
    }
  });
  const last = tcs[tcs.length - 1]!.value - base;
  const prev = tcs.length > 1 ? tcs[tcs.length - 2]!.value - base : 0;
  const durationMs = last + (tcs.length > 1 ? last - prev : 1000);

  // Info: [ID 4][tamanho][corpo]; só mexe nele se o corpo estiver inteiro no cabeçalho.
  let infoAt = -1;
  for (let i = 0; i <= header.length - 5; i++) {
    if (INFO_ID.every((b, k) => header[i + k] === b)) {
      infoAt = i;
      break;
    }
  }
  if (infoAt < 0) return [header, ...copies];
  const size = readSize(header, infoAt + 4);
  const bodyAt = infoAt + 4 + size.length;
  const bodyEnd = bodyAt + size.value;
  if (bodyEnd > header.length) return [header, ...copies];
  const duration = new Uint8Array(11); // 44 89 88 <float64>
  duration.set([0x44, 0x89, 0x88]);
  new DataView(duration.buffer).setFloat64(3, durationMs);
  const newHeader = concat([
    header.slice(0, infoAt + 4),
    size8(size.value + duration.length),
    header.slice(bodyAt, bodyEnd),
    duration,
    header.slice(bodyEnd),
  ]);
  return [newHeader, ...copies];
}

/** Quantos vídeos são gravados ao mesmo tempo (os maiores na tela); vale também para o áudio das streams. */
const MAX_VIDEOS = 3;
/** Chave da gravação só de áudio, usada quando não há nenhum vídeo na tela. */
const AUDIO_ONLY = 'audio';

/**
 * Buffer de uma gravação: um MediaRecorder dedicado a um vídeo (ou só áudio) e os últimos Clusters dele.
 * Cada vídeo tem o seu para que trocar o destaque não perca o que já foi gravado dele.
 */
class TrackBuffer {
  private recorder: MediaRecorder | null = null;
  private mimeType = '';
  private header: Uint8Array | null = null;
  private clusters: Cluster[] = [];
  /** Bytes recebidos ainda não separados em Clusters completos. */
  private pending: Uint8Array = new Uint8Array(0);
  private headerDone = false;
  /** Se a gravação inclui a mixagem de áudio (só entra quando o AudioContext está rodando). */
  withAudio = false;

  get running(): boolean {
    return this.recorder !== null && this.recorder.state !== 'inactive';
  }

  /** Há quanto tempo (ms) termina o vídeo guardado: o último Cluster só fecha no quadro-chave seguinte. */
  get lagMs(): number {
    const last = this.clusters[this.clusters.length - 1];
    return last ? Math.max(0, performance.now() - last.endedAt) : 0;
  }

  start(video: MediaStreamTrack | null, audio: MediaStreamTrack | undefined) {
    const mimeType = pickMimeType(video !== null);
    const tracks = [video, audio].filter((t): t is MediaStreamTrack => !!t);
    if (!mimeType || tracks.length === 0) return;
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
      this.mimeType = mimeType;
      this.withAudio = !!audio;
    } catch (err) {
      console.warn('[Clip] Falha ao iniciar a gravação:', err);
      this.recorder = null;
    }
  }

  stop() {
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {}
    }
    this.header = null;
    this.clusters = [];
    this.pending = new Uint8Array(0);
    this.headerDone = false;
  }

  /** Monta o clipe com o que está no buffer; null se ainda não há um Cluster completo. */
  build(): Blob | null {
    if (!this.header || this.clusters.length === 0) return null;
    const parts = fixWebm(this.header, this.clusters.map((c) => c.data));
    return new Blob(parts as BlobPart[], { type: this.mimeType });
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

export class ClipRecorder {
  /** Recebe a chave do destaque atual, para a escolha ficar estável entre uma sincronização e outra. */
  private readonly getSources: (featuredKey: string | null) => ClipSources;
  private ctx: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private audioNodes = new Map<string, MediaStreamAudioSourceNode>();
  private buffers = new Map<string, TrackBuffer>();
  /** Gravação que "Clipar" salva: o vídeo em destaque. */
  private featuredKey: string | null = null;
  private syncTimer: number | null = null;
  private disposed = false;

  constructor(getSources: (featuredKey: string | null) => ClipSources) {
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
    this.buffers.forEach((b) => b.stop());
    this.buffers.clear();
    this.featuredKey = null;
    this.audioNodes.forEach((n) => n.disconnect());
    this.audioNodes.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.destination = null;
  }

  private get featured(): TrackBuffer | undefined {
    return this.featuredKey ? this.buffers.get(this.featuredKey) : undefined;
  }

  /** Há quanto tempo (ms) termina o vídeo guardado do destaque. */
  get lagMs(): number {
    return this.featured?.lagMs ?? 0;
  }

  /** Monta o clipe do vídeo em destaque; null se ainda não há um Cluster completo dele. */
  buildClip(): Blob | null {
    return this.featured?.build() ?? null;
  }

  /**
   * Mantém uma gravação por vídeo na tela (os maiores): o que já foi gravado de cada um sobrevive à troca
   * de destaque. O áudio é mixado ao vivo e entra em todas.
   */
  private sync() {
    if (this.disposed) return;
    const { videos, audio } = this.getSources(this.featuredKey);

    this.syncAudio(audio);

    const wanted = new Map<string, MediaStreamTrack | null>(videos.map((v) => [v.id, v]));
    if (wanted.size === 0 && audio.length > 0) wanted.set(AUDIO_ONLY, null);

    for (const [key, buffer] of this.buffers) {
      if (!wanted.has(key) || !buffer.running) {
        buffer.stop();
        this.buffers.delete(key);
      }
    }
    // Com o AudioContext suspenso a trilha de áudio fica muda e o MediaRecorder não escreve nada: grava só
    // o vídeo até o contexto rodar e então recomeça com o áudio.
    const audioTrack = this.ctx?.state === 'running' ? this.destination?.stream.getAudioTracks()[0] : undefined;
    for (const [key, video] of wanted) {
      const current = this.buffers.get(key);
      if (current && (current.withAudio || !audioTrack)) continue;
      current?.stop();
      const buffer = new TrackBuffer();
      buffer.start(video, audioTrack);
      this.buffers.set(key, buffer);
    }
    this.featuredKey = wanted.keys().next().value ?? null;
  }

  private syncAudio(tracks: MediaStreamTrack[]) {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext({ sampleRate: 48000 });
      this.destination = this.ctx.createMediaStreamDestination();
      // Sem nenhuma entrada o destino não emite amostras e o MediaRecorder não escreve nada: uma fonte muda o mantém ativo.
      const silence = this.ctx.createConstantSource();
      silence.offset.value = 0;
      silence.connect(this.destination);
      silence.start();
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
}

/**
 * Escolhe o que gravar: os maiores vídeos visíveis na tela (o primeiro é o destaque) mais as faixas de
 * áudio passadas (vozes e áudio das streams; os <audio> do LiveKit não ficam no DOM, então vêm da sala).
 * Streams WHEP trazem o áudio junto do vídeo. O destaque anterior é mantido enquanto for quase tão
 * grande quanto o maior, para empates e pequenas variações de layout não trocarem a escolha.
 */
export function collectClipSources(
  extraAudio: Array<MediaStreamTrack | null | undefined> = [],
  featuredKey: string | null = null,
): ClipSources {
  const seen = new Set<string>();
  const found: Array<{ track: MediaStreamTrack; stream: MediaStream; area: number }> = [];
  document.querySelectorAll('video').forEach((el) => {
    const stream = el.srcObject;
    if (!(stream instanceof MediaStream)) return;
    const track = stream.getVideoTracks().find((t) => t.readyState === 'live');
    if (!track || seen.has(track.id)) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
    const height = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    if (width <= 0 || height <= 0) return; // fora da tela: nada para ver, nada para clipar
    seen.add(track.id);
    found.push({ track, stream, area: width * height });
  });
  found.sort((a, b) => b.area - a.area);
  const kept = found.findIndex((f) => f.track.id === featuredKey);
  if (kept > 0 && found[kept].area >= found[0].area * 0.8) found.unshift(...found.splice(kept, 1));
  const top = found.slice(0, MAX_VIDEOS);

  const audio = new Map<string, MediaStreamTrack>();
  const add = (t: MediaStreamTrack | null | undefined) => {
    if (t && t.readyState === 'live') audio.set(t.id, t);
  };
  top.forEach((f) => f.stream.getAudioTracks().forEach(add));
  extraAudio.forEach(add);

  return { videos: top.map((f) => f.track), audio: [...audio.values()] };
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
