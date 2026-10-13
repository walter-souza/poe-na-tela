import type { TrackProcessor, AudioProcessorOptions } from 'livekit-client';
import { Track } from 'livekit-client';
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

// Assets do RNNoise vêm do próprio pacote (?url): o Vite os emite com hash, na mesma versão da biblioteca.
let wasmBinaryCache: Promise<ArrayBuffer> | null = null;
const registeredAudioContexts = new WeakSet<AudioContext>();

export function isNoiseSuppressionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window.AudioContext || (window as any).webkitAudioContext) &&
    typeof window.AudioWorkletNode !== 'undefined' &&
    typeof WebAssembly !== 'undefined'
  );
}

export class NoiseSuppressionProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'rnnoise-suppressor';
  processedTrack?: MediaStreamTrack;

  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private rnnoiseNode?: RnnoiseWorkletNode;
  private destNode?: MediaStreamAudioDestinationNode;

  async init(opts: AudioProcessorOptions): Promise<void> {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!opts.audioContext || opts.audioContext.state === 'closed' || opts.audioContext.sampleRate !== 48000) {
      // RNNoise processa quadros de 10 ms (480 amostras) a 48 kHz mono; 'interactive' minimiza a latência.
      this.audioContext = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' });
    } else {
      this.audioContext = opts.audioContext;
    }

    // Resume audio context if suspended
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (err) {
        console.warn('AudioContext resume failed:', err);
      }
    }

    if (!registeredAudioContexts.has(this.audioContext)) {
      try {
        await this.audioContext.audioWorklet.addModule(rnnoiseWorkletUrl);
        registeredAudioContexts.add(this.audioContext);
      } catch (err: any) {
        // Ignore if already registered
        if (err?.message?.includes?.('already') || err?.name === 'InvalidStateError') {
          registeredAudioContexts.add(this.audioContext);
        } else {
          console.error('Failed to load rnnoise worklet module:', err);
          throw err;
        }
      }
    }

    if (!wasmBinaryCache) {
      // loadRnnoise escolhe o binário com SIMD quando o navegador suporta.
      wasmBinaryCache = loadRnnoise({
        url: rnnoiseWasmUrl,
        simdUrl: rnnoiseSimdWasmUrl,
      }).catch((err) => {
        wasmBinaryCache = null; // permite nova tentativa se o download falhar
        throw err;
      });
    }

    const wasmBinary = await wasmBinaryCache;

    // Create single-channel Worklet node for voice microphone
    this.rnnoiseNode = new RnnoiseWorkletNode(this.audioContext, {
      maxChannels: 1,
      wasmBinary,
    });

    const stream = new MediaStream([opts.track]);
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.destNode = this.audioContext.createMediaStreamDestination();

    this.sourceNode.connect(this.rnnoiseNode);
    this.rnnoiseNode.connect(this.destNode);

    const tracks = this.destNode.stream.getAudioTracks();
    if (!tracks || tracks.length === 0) {
      throw new Error('Failed to get processed audio track from MediaStreamDestination');
    }
    this.processedTrack = tracks[0];
    // Dica ao codec/navegador: o conteúdo é voz.
    this.processedTrack.contentHint = 'speech';
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    try {
      this.sourceNode?.disconnect();
    } catch {}
    try {
      this.rnnoiseNode?.disconnect();
      this.rnnoiseNode?.destroy();
    } catch {}
    try {
      this.destNode?.disconnect();
    } catch {}

    if (this.processedTrack) {
      try {
        this.processedTrack.stop();
      } catch {}
      this.processedTrack = undefined;
    }

    this.sourceNode = undefined;
    this.rnnoiseNode = undefined;
    this.destNode = undefined;
  }
}
