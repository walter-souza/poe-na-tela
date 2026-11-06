import { AccessToken, type RoomServiceClient } from 'livekit-server-sdk';

/**
 * Buffer de vozes para clipes. Regras de privacidade:
 *  - o clipe é uma configuração da SALA (metadado `clip`), ligada pelo anfitrião: ligado vale para todos;
 *  - com a sala desligada o bot nem entra; ao desligar, o áudio guardado é descartado na hora e o bot sai;
 *  - tudo fica apenas em RAM, numa janela móvel de WINDOW_MS; nada é gravado em disco aqui;
 *  - quem sai da sala tem o áudio descartado.
 */

const loadRtc = () => import('@livekit/rtc-node');
type RtcModule = Awaited<ReturnType<typeof loadRtc>>;
// Tipos derivados do import dinâmico (CJS): misturar com `import type` (ESM) gera tipos incompatíveis.
type RtcRoom = InstanceType<RtcModule['Room']>;
type RemoteParticipant = InstanceType<RtcModule['RemoteParticipant']>;
type RemoteAudioTrack = InstanceType<RtcModule['RemoteAudioTrack']>;

export const CLIP_BOT_IDENTITY = '__clipbot__';

/** O clipe está ligado nos metadados da sala? (JSON `{"clip":true}`) */
export function isClipEnabled(metadata: string | undefined): boolean {
  if (!metadata) return false;
  try {
    return JSON.parse(metadata)?.clip === true;
  } catch {
    return false;
  }
}

export function withClipFlag(metadata: string | undefined, enabled: boolean): string {
  let base: Record<string, unknown> = {};
  try {
    const parsed = metadata ? JSON.parse(metadata) : {};
    if (parsed && typeof parsed === 'object') base = parsed;
  } catch {
    // metadado antigo ilegível: recomeça
  }
  return JSON.stringify({ ...base, clip: enabled });
}
const SAMPLE_RATE = 48000;
export const WINDOW_MS = 60_000;
const POLL_MS = 5_000;
/** Silêncio maior que isso entre frames reancora a linha do tempo da faixa. */
const GAP_MS = 120;
const MAX_SOURCES_PER_ROOM = 16;

interface Chunk {
  startMs: number;
  samples: Int16Array;
}

/** Áudio contínuo de uma faixa, posicionado em tempo de relógio. */
class SourceBuffer {
  private chunks: Chunk[] = [];
  private anchorMs = 0;
  private played = 0;

  push(samples: Int16Array, nowMs: number) {
    const arrivalStart = nowMs - (samples.length * 1000) / SAMPLE_RATE;
    let start = this.anchorMs + (this.played * 1000) / SAMPLE_RATE;
    if (this.chunks.length === 0 || arrivalStart - start > GAP_MS) {
      this.anchorMs = arrivalStart;
      this.played = 0;
      start = arrivalStart;
    }
    this.chunks.push({ startMs: start, samples });
    this.played += samples.length;

    const cutoff = nowMs - WINDOW_MS;
    while (this.chunks.length > 0) {
      const first = this.chunks[0];
      if (first.startMs + (first.samples.length * 1000) / SAMPLE_RATE >= cutoff) break;
      this.chunks.shift();
    }
  }

  /** Soma as amostras que caem em [windowStartMs, windowStartMs + out.length) em `out`. */
  mixInto(out: Int32Array, windowStartMs: number) {
    for (const chunk of this.chunks) {
      const offset = Math.round(((chunk.startMs - windowStartMs) * SAMPLE_RATE) / 1000);
      const from = Math.max(0, -offset);
      const to = Math.min(chunk.samples.length, out.length - offset);
      for (let i = from; i < to; i++) out[offset + i] += chunk.samples[i];
    }
  }
}

interface Source {
  identity: string;
  buffer: SourceBuffer;
  stop: () => void;
}

class RoomRecorder {
  private sources = new Map<string, Source>();

  /**
   * @param onDisabled chamado quando o anfitrião desliga o clipe: o gerente descarta tudo e sai da sala.
   */
  constructor(
    readonly name: string,
    private readonly room: RtcRoom,
    private readonly rtc: RtcModule,
    onDisabled: () => void,
  ) {
    const { RoomEvent } = rtc;
    room.on(RoomEvent.RoomMetadataChanged, (metadata) => {
      if (!isClipEnabled(metadata)) onDisabled();
    });
    room.on(RoomEvent.TrackPublished, (_pub, p) => this.subscribeAudio(p));
    room.on(RoomEvent.ParticipantConnected, (p) => this.subscribeAudio(p));
    room.on(RoomEvent.TrackSubscribed, (track, pub, p) => {
      if (track instanceof rtc.RemoteAudioTrack) this.startReading(track, pub.sid ?? track.sid ?? '', p.identity);
    });
    room.on(RoomEvent.TrackUnsubscribed, (_track, pub) => this.drop(pub.sid ?? ''));
    room.on(RoomEvent.ParticipantDisconnected, (p) => this.purgeIdentity(p.identity));
    room.remoteParticipants.forEach((p) => this.subscribeAudio(p));
  }

  get connected() {
    return this.room.isConnected;
  }

  /**
   * Com o clipe ligado na sala, os microfones de todos entram no buffer. O áudio de compartilhamento de tela
   * fica de fora: já vem junto do vídeo que o cliente grava, e somar os dois o duplicaria.
   */
  private subscribeAudio(p: RemoteParticipant) {
    for (const pub of p.trackPublications.values()) {
      if (pub.kind !== this.rtc.TrackKind.KIND_AUDIO || pub.source !== this.rtc.TrackSource.SOURCE_MICROPHONE) continue;
      if (this.sources.size >= MAX_SOURCES_PER_ROOM && !this.sources.has(pub.sid ?? '')) continue;
      try {
        pub.setSubscribed(true);
      } catch {
        // publicação já removida
      }
    }
  }

  private startReading(track: RemoteAudioTrack, sid: string, identity: string) {
    if (!sid || this.sources.has(sid)) return;
    const stream = new this.rtc.AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: 1 });
    const reader = stream.getReader();
    const buffer = new SourceBuffer();
    let stopped = false;
    this.sources.set(sid, {
      identity,
      buffer,
      stop: () => {
        stopped = true;
        void reader.cancel().catch(() => {});
      },
    });
    void (async () => {
      try {
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done || stopped) break;
          buffer.push(new Int16Array(value.data), Date.now());
        }
      } catch {
        // faixa encerrada
      }
    })();
  }

  private drop(sid: string) {
    const source = this.sources.get(sid);
    if (!source) return;
    source.stop();
    this.sources.delete(sid);
  }

  private purgeIdentity(identity: string) {
    for (const [sid, s] of this.sources) if (s.identity === identity) this.drop(sid);
  }

  /** Mistura mono dos últimos `seconds` segundos (terminando em `endMs`). */
  mix(seconds: number, endMs = Date.now()): Int16Array {
    const length = Math.round(seconds * SAMPLE_RATE);
    const acc = new Int32Array(length);
    const windowStart = endMs - seconds * 1000;
    for (const s of this.sources.values()) s.buffer.mixInto(acc, windowStart);
    const out = new Int16Array(length);
    for (let i = 0; i < length; i++) out[i] = Math.max(-32768, Math.min(32767, acc[i]));
    return out;
  }

  status() {
    return {
      room: this.name,
      connected: this.connected,
      sources: [...this.sources.values()].map((s) => s.identity),
    };
  }

  async close() {
    for (const sid of [...this.sources.keys()]) this.drop(sid);
    await this.room.disconnect().catch(() => {});
  }
}

export function encodeWav(samples: Int16Array): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export interface ClipBufferOptions {
  roomService: RoomServiceClient;
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
}

export class ClipBufferManager {
  private rtc: RtcModule | null = null;
  private recorders = new Map<string, RoomRecorder>();
  private joining = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: ClipBufferOptions) {}

  /** Carrega o módulo nativo sob demanda: se faltar o binário da plataforma, só o clipe fica indisponível. */
  async start() {
    try {
      this.rtc = await loadRtc();
    } catch (err: any) {
      console.warn('🎬 Buffer de clipes desativado (@livekit/rtc-node indisponível):', err?.message || err);
      return;
    }
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    console.log('🎬 Buffer de vozes para clipes ativo (só RAM, só em salas com o clipe ligado).');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return Promise.all([...this.recorders.values()].map((r) => r.close())).then(() => this.recorders.clear());
  }

  get(roomName: string) {
    return this.recorders.get(roomName);
  }

  status() {
    return [...this.recorders.values()].map((r) => r.status());
  }

  private async poll() {
    try {
      const rooms = await this.opts.roomService.listRooms();
      const live = new Set<string>();
      for (const room of rooms) {
        if (!isClipEnabled(room.metadata)) continue;
        // O bot (oculto) conta como participante: sem humanos ele sai, senão a sala nunca fecharia.
        const participants = await this.opts.roomService.listParticipants(room.name);
        if (!participants.some((p) => p.identity !== CLIP_BOT_IDENTITY)) continue;
        live.add(room.name);
        await this.ensureJoined(room.name);
      }
      for (const [name, rec] of this.recorders) {
        if (!live.has(name) || !rec.connected) {
          this.recorders.delete(name);
          void rec.close();
        }
      }
    } catch (err: any) {
      console.warn('🎬 Falha ao verificar salas para clipes:', err?.message || err);
    }
  }

  private async ensureJoined(roomName: string) {
    const existing = this.recorders.get(roomName);
    if (existing?.connected || this.joining.has(roomName) || !this.rtc) return;
    this.joining.add(roomName);
    try {
      const at = new AccessToken(this.opts.apiKey, this.opts.apiSecret, { identity: CLIP_BOT_IDENTITY, ttl: '6h' });
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: false,
        canPublishData: false,
        canSubscribe: true,
        hidden: true,
      });
      const room = new this.rtc.Room();
      await room.connect(this.opts.livekitUrl, await at.toJwt(), { autoSubscribe: false, dynacast: false });
      if (!isClipEnabled(room.metadata)) {
        // Desligado entre a verificação e a entrada: sai sem guardar nada.
        await room.disconnect().catch(() => {});
        return;
      }
      this.recorders.set(
        roomName,
        new RoomRecorder(roomName, room, this.rtc, () => {
          const rec = this.recorders.get(roomName);
          this.recorders.delete(roomName);
          void rec?.close();
        }),
      );
    } catch (err: any) {
      console.warn(`🎬 Bot não conseguiu entrar em "${roomName}":`, err?.message || err);
    } finally {
      this.joining.delete(roomName);
    }
  }
}
