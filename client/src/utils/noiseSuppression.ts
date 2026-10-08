import type { TrackProcessor, AudioProcessorOptions } from 'livekit-client';
import { Track } from 'livekit-client';
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';

let wasmBinaryCache: Promise<ArrayBuffer> | null = null;
const registeredAudioContexts = new WeakSet<AudioContext>();

function getAssetUrl(path: string): string {
  try {
    const base = import.meta.env.BASE_URL || '/';
    const cleanBase = base.endsWith('/') ? base : `${base}/`;
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return new URL(`${cleanBase}${cleanPath}`, window.location.href).href;
  } catch {
    return path;
  }
}

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
    if (!opts.audioContext || opts.audioContext.sampleRate !== 48000) {
      this.audioContext = new AudioCtx({ sampleRate: 48000 });
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

    const workletUrl = getAssetUrl('rnnoise/rnnoiseWorklet.js');
    if (!registeredAudioContexts.has(this.audioContext)) {
      try {
        await this.audioContext.audioWorklet.addModule(workletUrl);
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
      const wasmUrl = getAssetUrl('rnnoise/rnnoise.wasm');
      const wasmSimdUrl = getAssetUrl('rnnoise/rnnoise_simd.wasm');
      wasmBinaryCache = loadRnnoise({
        url: wasmUrl,
        simdUrl: wasmSimdUrl,
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
