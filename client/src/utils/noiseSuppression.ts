import type { TrackProcessor, AudioProcessorOptions } from 'livekit-client';
import { Track } from 'livekit-client';
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import type { DenoiseEngine } from 'denoise-voice-clarity';

let wasmBinaryCache: Promise<ArrayBuffer> | null = null;
const registeredAudioContexts = new WeakSet<AudioContext>();

export type NoiseIntensity = 'leve' | 'padrao' | 'forte';

export interface NoiseSettings {
  intensity: NoiseIntensity;
  /** User's own voice level (dBFS) measured by calibration; null until calibrated. */
  voiceLevelDb: number | null;
}

// attenuationLimitDb: how far DeepFilterNet3 may pull noise down (100 = unlimited).
// voiceMarginDb: the gate opens only within this many dB of the calibrated voice, so quieter
// background voices stay out. Smaller = stricter.
export const NOISE_INTENSITIES: Record<NoiseIntensity, { label: string; attenuationLimitDb: number; voiceMarginDb: number }> = {
  leve: { label: 'Leve', attenuationLimitDb: 25, voiceMarginDb: 30 },
  padrao: { label: 'Padrão', attenuationLimitDb: 60, voiceMarginDb: 14 },
  forte: { label: 'Forte', attenuationLimitDb: 100, voiceMarginDb: 8 },
};

const SETTINGS_STORAGE_KEY = 'poe-na-tela-noise-settings';
const DEFAULT_SETTINGS: NoiseSettings = { intensity: 'padrao', voiceLevelDb: null };

export function loadNoiseSettings(): NoiseSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
    if (saved && saved.intensity in NOISE_INTENSITIES) {
      return { intensity: saved.intensity, voiceLevelDb: typeof saved.voiceLevelDb === 'number' ? saved.voiceLevelDb : null };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveNoiseSettings(settings: NoiseSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

// Levels measured on the denoiser output (dBFS) with browser AGC on: speech sits above -45, while
// loud noise (a fan near the mic) leaves a residual up to about -53 that must stay gated.
const VOICE_GATE_OPTIONS = {
  minOpenDb: -50,
  floorMarginDb: 10,
  sustainMs: 30,
  holdMs: 250,
  attackMs: 3,
  releaseMs: 80,
  lookaheadMs: 30,
};

export function getAssetUrl(path: string): string {
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

/**
 * Mic chain: DeepFilterNet3 (falls back to RNNoise) → voice gate → leveler → limiter.
 * Run it with the browser's noiseSuppression off (stacking suppressors attenuates the voice twice)
 * but autoGainControl on: DeepFilterNet3 erases speech that arrives below ~-40 dBFS as if it were
 * noise, so quiet mics must be normalized before it. The noise AGC raises, the denoiser removes.
 */
export class NoiseSuppressionProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'noise-suppressor';
  processedTrack?: MediaStreamTrack;
  engine?: 'deepfilternet3' | 'rnnoise';

  private settings: NoiseSettings;
  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private dfnEngine?: DenoiseEngine;
  private dfnOutputNode?: MediaStreamAudioSourceNode;
  private rnnoiseNode?: RnnoiseWorkletNode;
  private gateNode?: AudioWorkletNode;
  private levelerNode?: AudioWorkletNode;
  private limiterNode?: AudioWorkletNode;
  private destNode?: MediaStreamAudioDestinationNode;

  constructor(settings: NoiseSettings = loadNoiseSettings()) {
    this.settings = settings;
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!opts.audioContext || opts.audioContext.state === 'closed' || opts.audioContext.sampleRate !== 48000) {
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

    if (!registeredAudioContexts.has(this.audioContext)) {
      try {
        await Promise.all([
          this.audioContext.audioWorklet.addModule(getAssetUrl('rnnoise/voiceGateWorklet.js')),
          this.audioContext.audioWorklet.addModule(getAssetUrl('rnnoise/voiceBoostWorklet.js')),
        ]);
        registeredAudioContexts.add(this.audioContext);
      } catch (err: any) {
        // Ignore if already registered
        if (err?.message?.includes?.('already') || err?.name === 'InvalidStateError') {
          registeredAudioContexts.add(this.audioContext);
        } else {
          console.error('Failed to load noise suppression worklet modules:', err);
          throw err;
        }
      }
    }

    const intensity = NOISE_INTENSITIES[this.settings.intensity];

    this.gateNode = new AudioWorkletNode(this.audioContext, 'voice-gate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        ...VOICE_GATE_OPTIONS,
        voiceLevelDb: this.settings.voiceLevelDb,
        voiceMarginDb: intensity.voiceMarginDb,
      },
    });

    // The denoiser also attenuates the voice itself (weak syllables, quiet speakers). The leveler
    // brings quiet voices back up (it never boosts during silence), the limiter keeps peaks clean.
    this.levelerNode = new AudioWorkletNode(this.audioContext, 'voice-leveler', {
      processorOptions: { maxGainDb: 12 },
    });
    this.limiterNode = new AudioWorkletNode(this.audioContext, 'voice-limiter', {
      processorOptions: { ceilingDb: -1 },
    });
    this.destNode = this.audioContext.createMediaStreamDestination();

    const denoisedOutput = await this.createDenoiser(opts.track, intensity.attenuationLimitDb);
    denoisedOutput.connect(this.gateNode);
    this.gateNode.connect(this.levelerNode);
    this.levelerNode.connect(this.limiterNode);
    this.limiterNode.connect(this.destNode);

    const tracks = this.destNode.stream.getAudioTracks();
    if (!tracks || tracks.length === 0) {
      throw new Error('Failed to get processed audio track from MediaStreamDestination');
    }
    this.processedTrack = tracks[0];
  }

  // DeepFilterNet3 handles keyboard, fan and distant voices far better than RNNoise; RNNoise
  // stays as the fallback when its WASM cannot load (old browser, network, wrong MIME type).
  private async createDenoiser(track: MediaStreamTrack, attenuationLimitDb: number): Promise<AudioNode> {
    const ctx = this.audioContext!;
    try {
      const { DenoiseEngine, isVoiceClaritySupported } = await import('denoise-voice-clarity');
      if (!isVoiceClaritySupported()) throw new Error('DeepFilterNet3 not supported');
      const engine = new DenoiseEngine({ attenuationLimitDb });
      this.dfnEngine = engine;
      await engine.init(track, ctx);
      if (!engine.processedTrack) throw new Error('DeepFilterNet3 produced no track');
      this.dfnOutputNode = ctx.createMediaStreamSource(new MediaStream([engine.processedTrack]));
      this.engine = 'deepfilternet3';
      return this.dfnOutputNode;
    } catch (err) {
      console.warn('DeepFilterNet3 unavailable, falling back to RNNoise:', err);
      await this.dfnEngine?.destroy().catch(() => {});
      this.dfnEngine = undefined;
    }

    if (!wasmBinaryCache) {
      wasmBinaryCache = loadRnnoise({
        url: getAssetUrl('rnnoise/rnnoise.wasm'),
        simdUrl: getAssetUrl('rnnoise/rnnoise_simd.wasm'),
      });
    }
    const [wasmBinary] = await Promise.all([
      wasmBinaryCache,
      ctx.audioWorklet.addModule(getAssetUrl('rnnoise/rnnoiseWorklet.js')).catch((err: any) => {
        if (!(err?.message?.includes?.('already') || err?.name === 'InvalidStateError')) throw err;
      }),
    ]);
    this.rnnoiseNode = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
    this.sourceNode = ctx.createMediaStreamSource(new MediaStream([track]));
    this.sourceNode.connect(this.rnnoiseNode);
    this.engine = 'rnnoise';
    return this.rnnoiseNode;
  }

  /** Measures the user's speaking level for `durationMs`; resolves null if too little voice was heard. */
  calibrateVoice(durationMs = 3000): Promise<number | null> {
    const gate = this.gateNode;
    if (!gate) return Promise.resolve(null);
    return new Promise((resolve) => {
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type !== 'calibrated') return;
        gate.port.removeEventListener('message', onMessage);
        resolve(event.data.levelDb);
      };
      gate.port.addEventListener('message', onMessage);
      gate.port.start();
      gate.port.postMessage({ type: 'calibrate', durationMs });
    });
  }

  /** Applies a new calibrated voice level live; intensity changes need a new processor. */
  setVoiceLevel(voiceLevelDb: number | null): void {
    this.settings = { ...this.settings, voiceLevelDb };
    this.gateNode?.port.postMessage({ type: 'config', voiceLevelDb });
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    try {
      this.sourceNode?.disconnect();
      this.dfnOutputNode?.disconnect();
    } catch {}
    await this.dfnEngine?.destroy().catch(() => {});
    try {
      this.rnnoiseNode?.disconnect();
      this.rnnoiseNode?.destroy();
    } catch {}
    try {
      this.gateNode?.disconnect();
      this.levelerNode?.disconnect();
      this.limiterNode?.disconnect();
      this.destNode?.disconnect();
    } catch {}

    if (this.processedTrack) {
      try {
        this.processedTrack.stop();
      } catch {}
      this.processedTrack = undefined;
    }

    this.sourceNode = undefined;
    this.dfnEngine = undefined;
    this.dfnOutputNode = undefined;
    this.rnnoiseNode = undefined;
    this.gateNode = undefined;
    this.levelerNode = undefined;
    this.limiterNode = undefined;
    this.destNode = undefined;
    this.engine = undefined;
  }
}
