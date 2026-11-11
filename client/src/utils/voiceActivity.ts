import { ConnectionState, Track, type Room } from 'livekit-client';

interface VadNode {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Uint8Array<ArrayBuffer>;
  track: MediaStreamTrack;
}

const TICK_MS = 40;
/** Hold time after the last loud sample, so the indicator does not flicker between words. */
const HOLD_MS = 350;

/**
 * Client-side voice activity detection via Web Audio (< 20ms response), independent of LiveKit's
 * slower server-side speaker detection. Analysers are never connected to the output (no echo).
 * `onChange` fires only when someone starts or stops speaking.
 */
export class VoiceActivityDetector {
  private ctx: AudioContext | null = null;
  private nodes = new Map<string, VadNode>();
  private speaking = new Map<string, boolean>();
  private lastSpokeAt = new Map<string, number>();
  private interval: number | null = null;
  private onChange: (room: Room) => void;

  constructor(onChange: (room: Room) => void) {
    this.onChange = onChange;
  }

  /** undefined when the participant has no analysed track (callers fall back to LiveKit's flag). */
  isSpeaking(identity: string): boolean | undefined {
    return this.speaking.get(identity);
  }

  private getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: 48000 });
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  register(identity: string, mediaTrack: MediaStreamTrack): void {
    if (!identity || !mediaTrack || mediaTrack.readyState === 'ended') return;

    const existing = this.nodes.get(identity);
    if (existing && existing.track === mediaTrack) return;

    this.unregister(identity);

    try {
      const ctx = this.getContext();
      const source = ctx.createMediaStreamSource(new MediaStream([mediaTrack]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64; // 32 frequency bins for minimal compute overhead
      analyser.smoothingTimeConstant = 0.2; // fast attack response
      analyser.minDecibels = -70;
      analyser.maxDecibels = -10;
      source.connect(analyser); // NOT connected to destination to avoid loopback/echo

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      this.nodes.set(identity, { source, analyser, buffer, track: mediaTrack });
    } catch (err) {
      console.warn(`[VAD] Failed to register track for ${identity}:`, err);
    }
  }

  unregister(identity?: string): void {
    if (!identity) return;
    const node = this.nodes.get(identity);
    if (node) {
      try {
        node.source.disconnect();
        node.analyser.disconnect();
      } catch {}
      this.nodes.delete(identity);
    }
    this.speaking.delete(identity);
    this.lastSpokeAt.delete(identity);
  }

  /** Analyses everyone already in the room and starts polling. */
  start(room: Room): void {
    try {
      this.getContext();
      room.remoteParticipants.forEach((p) => {
        const micPub = p.getTrackPublication(Track.Source.Microphone);
        if (micPub?.track?.mediaStreamTrack) {
          this.register(p.identity, micPub.track.mediaStreamTrack);
        }
      });
      if (this.interval) clearInterval(this.interval);
      this.interval = window.setInterval(() => this.tick(room), TICK_MS);
    } catch (vadErr) {
      console.warn('Failed to start VAD on connect:', vadErr);
    }
  }

  /** Stops polling and drops every analyser; the audio context is kept for a reconnect. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.nodes.forEach((node) => {
      try {
        node.source.disconnect();
        node.analyser.disconnect();
      } catch {}
    });
    this.nodes.clear();
    this.speaking.clear();
    this.lastSpokeAt.clear();
  }

  dispose(): void {
    this.stop();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }
  }

  private tick(room: Room): void {
    if (room.state !== ConnectionState.Connected) return;

    const now = Date.now();
    let stateChanged = false;

    // The local mic's mediaStreamTrack switches to the processed (suppressed) track whenever a
    // processor is set/restarted, so the indicator must follow it instead of the raw capture.
    const local = room.localParticipant;
    const localMicTrack = local?.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    if (local?.isMicrophoneEnabled && localMicTrack) {
      this.register(local.identity, localMicTrack);
    }

    this.nodes.forEach((node, identity) => {
      if (node.track.readyState === 'ended') {
        this.unregister(identity);
        stateChanged = true;
        return;
      }

      // If local participant and mic is disabled, force not speaking
      if (identity === local?.identity && !local.isMicrophoneEnabled) {
        if (this.speaking.get(identity)) {
          this.speaking.set(identity, false);
          stateChanged = true;
        }
        return;
      }

      node.analyser.getByteFrequencyData(node.buffer);
      let sum = 0;
      let max = 0;
      for (let i = 0; i < node.buffer.length; i++) {
        const val = node.buffer[i];
        sum += val;
        if (val > max) max = val;
      }
      const avg = sum / node.buffer.length;

      // Sensitivity: avg > 8 or peak frequency > 35 indicates speech
      if (avg > 8 || max > 35) {
        this.lastSpokeAt.set(identity, now);
      }

      const shouldBeSpeaking = now - (this.lastSpokeAt.get(identity) || 0) < HOLD_MS;
      if (shouldBeSpeaking !== (this.speaking.get(identity) || false)) {
        this.speaking.set(identity, shouldBeSpeaking);
        stateChanged = true;
      }
    });

    if (stateChanged) this.onChange(room);
  }
}
