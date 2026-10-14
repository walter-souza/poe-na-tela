import { useEffect, useRef, useState, type RefObject } from 'react';

export interface WhepStats {
  fps: number;
  width: number;
  height: number;
  bitrateKbps: number;
  packetLossPercent: number;
  rttMs: number | null;
  /** Average jitter-buffer delay over the last sampling window (ms). */
  bufferDelayMs: number | null;
  freezeCount: number;
  framesDropped: number;
  codec: string;
}

interface Counters {
  bytes: number;
  received: number;
  lost: number;
  delay: number;
  emitted: number;
  freezes: number;
  dropped: number;
  at: number;
}

/** Samples the WHEP PeerConnection once a second while `enabled`. */
export function useWhepStats(pcRef: RefObject<RTCPeerConnection | null>, enabled: boolean): WhepStats | null {
  const [stats, setStats] = useState<WhepStats | null>(null);
  const prevRef = useRef<Counters | null>(null);

  useEffect(() => {
    if (!enabled) {
      prevRef.current = null;
      setStats(null);
      return;
    }

    const sample = async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const report = await pc.getStats();
        let inbound: any;
        let rtt: number | null = null;
        let codec = '';
        report.forEach((r: any) => {
          if (r.type === 'inbound-rtp' && (r.kind === 'video' || r.mediaType === 'video')) inbound = r;
          if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime !== undefined) {
            rtt = Math.round(r.currentRoundTripTime * 1000);
          }
        });
        if (!inbound) return;
        if (inbound.codecId) {
          const c: any = report.get(inbound.codecId);
          if (c?.mimeType) codec = String(c.mimeType).replace('video/', '').toUpperCase();
        }

        const now = performance.now();
        const cur: Counters = {
          bytes: inbound.bytesReceived ?? 0,
          received: inbound.packetsReceived ?? 0,
          lost: inbound.packetsLost ?? 0,
          delay: inbound.jitterBufferDelay ?? 0,
          emitted: inbound.jitterBufferEmittedCount ?? 0,
          freezes: inbound.freezeCount ?? 0,
          dropped: inbound.framesDropped ?? 0,
          at: now,
        };
        const prev = prevRef.current;
        prevRef.current = cur;
        if (!prev) return;

        const seconds = (cur.at - prev.at) / 1000;
        const packets = cur.received - prev.received + Math.max(0, cur.lost - prev.lost);
        setStats({
          fps: Math.round(inbound.framesPerSecond ?? 0),
          width: inbound.frameWidth ?? 0,
          height: inbound.frameHeight ?? 0,
          bitrateKbps: seconds > 0 ? Math.round(((cur.bytes - prev.bytes) * 8) / seconds / 1000) : 0,
          packetLossPercent: packets > 0 ? Math.max(0, cur.lost - prev.lost) / packets * 100 : 0,
          rttMs: rtt,
          bufferDelayMs:
            cur.emitted > prev.emitted ? Math.round(((cur.delay - prev.delay) / (cur.emitted - prev.emitted)) * 1000) : null,
          freezeCount: Math.max(0, cur.freezes - prev.freezes),
          framesDropped: Math.max(0, cur.dropped - prev.dropped),
          codec,
        });
      } catch {
        // PeerConnection closing/renegotiating
      }
    };

    const id = window.setInterval(sample, 1000);
    return () => {
      window.clearInterval(id);
      prevRef.current = null;
    };
  }, [enabled, pcRef]);

  return stats;
}
