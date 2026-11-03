import type { TrackProcessor, AudioProcessorOptions } from 'livekit-client';
import { Track } from 'livekit-client';
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';

let rnnoiseWasmCache: Promise<ArrayBuffer> | null = null;
let dfnModuleCache: Promise<WebAssembly.Module> | null = null;
const registeredAudioContexts = new WeakSet<AudioContext>();

// The chain below was calibrated offline on real recordings (keyboard, fan, knocks, low male voice)
// by running these same worklets sample for sample. Levels are dBFS on the denoiser output.
const DFN_OPTIONS = {
  enabled: true,
  attenuationLimitDb: 100,
  // The library's default +4 dB presence boost sharpens transients into audible pops.
  presenceGainDb: 0,
};

// DeepFilterNet3 worklet latency in samples (480-sample frames behind a 4-frame prime, run in
// 128-sample render quanta at 48 kHz); the steadier compares its output with the raw mic delayed
// by exactly this much.
const DFN_LATENCY_SAMPLES = 3205;

const VOICE_GATE_OPTIONS = {
  minOpenDb: -56,
  floorMarginDb: 10,
  sustainMs: 30,
  holdMs: 250,
  attackMs: 3,
  releaseMs: 80,
  lookaheadMs: 30,
};

// Gate used after RNNoise (fallback): its residual noise sits well below -60, speech above -45.
const RNNOISE_GATE_OPTIONS = { ...VOICE_GATE_OPTIONS, minOpenDb: -50 };

const WORKLET_MODULES = [
  'rnnoise/voiceGateWorklet.js',
  'rnnoise/voiceBoostWorklet.js',
  'rnnoise/voiceSteadyWorklet.js',
  'rnnoise/voiceDeclickWorklet.js',
  'rnnoise/voiceOnsetWorklet.js',
];

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

const isAlreadyRegistered = (err: any) => err?.message?.includes?.('already') || err?.name === 'InvalidStateError';

async function addModules(ctx: AudioContext, paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((path) =>
      ctx.audioWorklet.addModule(getAssetUrl(path)).catch((err: any) => {
        if (!isAlreadyRegistered(err)) throw err;
      })
    )
  );
}

// 18 MB: fetched and compiled once per page, then shared by every processor.
function loadDeepFilterNet(): Promise<WebAssembly.Module> {
  if (!dfnModuleCache) {
    dfnModuleCache = (async () => {
      const response = await fetch(getAssetUrl('rnnoise/deepfilternet3.wasm'));
      if (!response.ok) throw new Error(`DeepFilterNet3 WASM: HTTP ${response.status}`);
      try {
        return await WebAssembly.compileStreaming(response.clone());
      } catch {
        // compileStreaming needs the application/wasm MIME type
        return WebAssembly.compile(await response.arrayBuffer());
      }
    })();
    dfnModuleCache.catch(() => {
      dfnModuleCache = null;
    });
  }
  return dfnModuleCache;
}

/**
 * Mic chain, with DeepFilterNet3:
 *   mic ─┬─> DeepFilterNet3 ─> steadier ─> declicker ─> highpass ─> gate ─> onset softener ─> leveler ─> limiter
 *        └──────── raw ─────────┘
 * - DeepFilterNet3 removes keyboard, fan, knocks and distant voices.
 * - The steadier fixes what it does to the voice: level jumps between its processing states, short
 *   holes and whole voiced stretches it mistakes for noise (it needs the raw mic for that).
 * - The declicker removes isolated mouth clicks and denoiser artefacts; the highpass (after the
 *   denoiser: before it, it would cut a low voice's fundamental and make the denoiser chop it)
 *   removes rumble; the gate silences what is left between phrases; the onset softener stops a
 *   phrase starting from silence with a pop; leveler and limiter even out the level.
 * Falls back to RNNoise ─> gate ─> leveler ─> limiter when DeepFilterNet3 cannot load.
 * Run it with the browser's noiseSuppression off (stacking suppressors attenuates the voice twice).
 */
export class NoiseSuppressionProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'noise-suppressor';
  processedTrack?: MediaStreamTrack;
  engine?: 'deepfilternet3' | 'rnnoise';

  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private nodes: AudioNode[] = [];
  private rnnoiseNode?: RnnoiseWorkletNode;
  private destNode?: MediaStreamAudioDestinationNode;

  async init(opts: AudioProcessorOptions): Promise<void> {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!opts.audioContext || opts.audioContext.state === 'closed' || opts.audioContext.sampleRate !== 48000) {
      this.audioContext = new AudioCtx({ sampleRate: 48000 });
    } else {
      this.audioContext = opts.audioContext;
    }
    const ctx = this.audioContext;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn('AudioContext resume failed:', err);
      }
    }

    if (!registeredAudioContexts.has(ctx)) {
      try {
        await addModules(ctx, WORKLET_MODULES);
        registeredAudioContexts.add(ctx);
      } catch (err) {
        console.error('Failed to load noise suppression worklet modules:', err);
        throw err;
      }
    }

    this.sourceNode = ctx.createMediaStreamSource(new MediaStream([opts.track]));
    this.destNode = ctx.createMediaStreamDestination();

    let chain: AudioNode[];
    try {
      chain = await this.createDeepFilterNetChain();
      this.engine = 'deepfilternet3';
    } catch (err) {
      console.warn('DeepFilterNet3 unavailable, falling back to RNNoise:', err);
      this.disconnectNodes();
      chain = await this.createRnnoiseChain();
      this.engine = 'rnnoise';
    }

    chain.push(
      new AudioWorkletNode(ctx, 'voice-leveler', { processorOptions: { maxGainDb: 12 } }),
      new AudioWorkletNode(ctx, 'voice-limiter', { processorOptions: { ceilingDb: -1 } })
    );
    this.nodes.push(...chain);
    for (let i = 1; i < chain.length; i++) chain[i - 1].connect(chain[i]);
    chain[chain.length - 1].connect(this.destNode);

    const tracks = this.destNode.stream.getAudioTracks();
    if (!tracks || tracks.length === 0) {
      throw new Error('Failed to get processed audio track from MediaStreamDestination');
    }
    this.processedTrack = tracks[0];
  }

  /** Nodes from the denoiser to the onset softener, already connected to the mic. */
  private async createDeepFilterNetChain(): Promise<AudioNode[]> {
    const ctx = this.audioContext!;
    const [wasmModule] = await Promise.all([
      loadDeepFilterNet(),
      addModules(ctx, ['rnnoise/deepFilterNetWorklet.js']),
    ]);

    const denoiser = new AudioWorkletNode(ctx, 'voice-clarity-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { wasmModule, ...DFN_OPTIONS },
    });
    const steadier = new AudioWorkletNode(ctx, 'voice-steady', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { dryDelaySamples: DFN_LATENCY_SAMPLES },
    });
    const declicker = new AudioWorkletNode(ctx, 'voice-declick', {
      outputChannelCount: [1],
      processorOptions: { minDb: -75 },
    });
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 70;
    highpass.Q.value = 0.707;
    const gate = new AudioWorkletNode(ctx, 'voice-gate', {
      outputChannelCount: [1],
      processorOptions: VOICE_GATE_OPTIONS,
    });
    const onset = new AudioWorkletNode(ctx, 'voice-onset', {
      outputChannelCount: [1],
      processorOptions: { riseMs: 30, ratioDb: 6 },
    });

    this.nodes.push(denoiser, steadier);
    this.sourceNode!.connect(denoiser);
    denoiser.connect(steadier, 0, 0);
    this.sourceNode!.connect(steadier, 0, 1);
    return [steadier, declicker, highpass, gate, onset];
  }

  private async createRnnoiseChain(): Promise<AudioNode[]> {
    const ctx = this.audioContext!;
    if (!rnnoiseWasmCache) {
      rnnoiseWasmCache = loadRnnoise({
        url: getAssetUrl('rnnoise/rnnoise.wasm'),
        simdUrl: getAssetUrl('rnnoise/rnnoise_simd.wasm'),
      });
    }
    const [wasmBinary] = await Promise.all([rnnoiseWasmCache, addModules(ctx, ['rnnoise/rnnoiseWorklet.js'])]);
    this.rnnoiseNode = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
    this.sourceNode!.connect(this.rnnoiseNode);
    const gate = new AudioWorkletNode(ctx, 'voice-gate', {
      outputChannelCount: [1],
      processorOptions: RNNOISE_GATE_OPTIONS,
    });
    return [this.rnnoiseNode, gate];
  }

  private disconnectNodes(): void {
    try {
      this.sourceNode?.disconnect();
    } catch {}
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {}
      if (node instanceof AudioWorkletNode && node !== this.rnnoiseNode) node.port.postMessage({ type: 'destroy' });
    }
    try {
      this.rnnoiseNode?.disconnect();
      this.rnnoiseNode?.destroy();
    } catch {}
    this.nodes = [];
    this.rnnoiseNode = undefined;
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    this.disconnectNodes();
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
    this.destNode = undefined;
    this.engine = undefined;
  }
}
