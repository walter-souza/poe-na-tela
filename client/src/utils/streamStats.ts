import type { Room } from 'livekit-client';
import type { StreamStats } from '../types';

/** One sample of the room's WebRTC stats, without the playout buffer (owned by usePlayoutBuffer). */
export type StreamStatsSample = Omit<StreamStats, 'playoutBufferMs'>;

/**
 * Reads publisher + subscriber stats (host and viewer) and turns cumulative counters into
 * per-window values, so each instance keeps the previous sample.
 */
export class StreamStatsCollector {
  private prevStats: { bytes: number; frames: number; timestamp: number; freezes: number; dropped: number } | null = null;
  private prevCounters: { nack: number; pli: number } = { nack: 0, pli: 0 };
  private prevBuffer: { delay: number; count: number } | null = null;

  /** null when there is nothing to report (no peer connection yet, or a renegotiation in progress). */
  async collect(room: Room): Promise<StreamStatsSample | null> {
    try {
      const pubPromise = (room.engine as any)?.pcManager?.publisher?.getStats?.();
      const subPromise = (room.engine as any)?.pcManager?.subscriber?.getStats?.();

      const [pubResult, subResult] = await Promise.allSettled([pubPromise, subPromise]);
      const reports: RTCStatsReport[] = [];
      if (pubResult.status === 'fulfilled' && pubResult.value) reports.push(pubResult.value);
      if (subResult.status === 'fulfilled' && subResult.value) reports.push(subResult.value);

      if (reports.length === 0) return null;

      let rtt = 0;
      let packetLoss = 0;
      let fps = 0;
      let width = 0;
      let height = 0;
      let codec = '';
      let totalBytes = 0;
      let outboundBytes = 0; // sum across simulcast layers
      let totalFrames = 0;
      let jitter = 0;
      let measuredBufferDelay: number | undefined;
      let bufferDelaySum = 0;
      let bufferEmittedCount = 0;
      let qualityLimitationReason: string | undefined;
      let encodeTimeMs: number | undefined;
      let captureFps: number | undefined;
      let captureSize: string | undefined;
      const layerList: string[] = [];
      let targetBitrateKbps: number | undefined;
      let totalNack = 0;
      let totalPli = 0;
      let totalFreezes = 0;
      let totalDropped = 0;
      const now = Date.now();

      reports.forEach((rtcReport) => {
        rtcReport.forEach((report: any) => {
          // 1. Connection RTT (Latência)
          if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
            if (report.currentRoundTripTime !== undefined) {
              rtt = Math.round(report.currentRoundTripTime * 1000);
            }
          }

          // 2. Remote Inbound (Packet Loss and RTT from remote feedback)
          if (report.type === 'remote-inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            if (report.roundTripTime !== undefined && rtt === 0) {
              rtt = Math.round(report.roundTripTime * 1000);
            }
            if (report.fractionLost !== undefined && report.fractionLost > 0) {
              packetLoss = Math.max(packetLoss, (report.fractionLost / 256) * 100);
            }
            if (report.packetsLost !== undefined && report.packetsReceived) {
              const total = report.packetsLost + report.packetsReceived;
              if (total > 0) {
                packetLoss = Math.max(packetLoss, (report.packetsLost / total) * 100);
              }
            }
          }

          // 3. Inbound RTP (Viewer receiving video)
          if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            if (report.framesPerSecond) fps = Math.max(fps, Math.round(report.framesPerSecond));
            if (report.frameWidth) width = Math.max(width, report.frameWidth);
            if (report.frameHeight) height = Math.max(height, report.frameHeight);
            if (report.framesDecoded || report.framesReceived) {
              totalFrames = Math.max(totalFrames, report.framesDecoded || report.framesReceived);
            }
            if (report.bytesReceived) {
              totalBytes = Math.max(totalBytes, report.bytesReceived);
            }
            if (report.jitter !== undefined) {
              jitter = Math.round(report.jitter * 1000);
            }
            if (report.nackCount) totalNack += report.nackCount;
            if (report.pliCount) totalPli += report.pliCount;
            if (report.freezeCount) totalFreezes += report.freezeCount;
            if (report.framesDropped) totalDropped += report.framesDropped;
            if (report.jitterBufferDelay !== undefined && report.jitterBufferEmittedCount) {
              // Cumulative counters: the per-window delta below gives the *current* delay.
              bufferDelaySum += report.jitterBufferDelay;
              bufferEmittedCount += report.jitterBufferEmittedCount;
              measuredBufferDelay = Math.round(
                (report.jitterBufferDelay / report.jitterBufferEmittedCount) * 1000
              );
            }
            if (report.packetsLost !== undefined && report.packetsReceived) {
              const total = report.packetsLost + report.packetsReceived;
              if (total > 0) {
                packetLoss = Math.max(packetLoss, (report.packetsLost / total) * 100);
              }
            }
            if (report.codecId) {
              const codecReport = rtcReport.get(report.codecId);
              if (codecReport && codecReport.mimeType) {
                codec = codecReport.mimeType.replace('video/', '').toUpperCase();
              }
            }
          }

          // 3b. Capture source (Host): real frame rate coming out of getDisplayMedia
          if (report.type === 'media-source' && report.kind === 'video') {
            if (report.framesPerSecond) captureFps = Math.round(report.framesPerSecond);
            if (report.width && report.height) captureSize = `${report.width}x${report.height}`;
          }

          // 4. Outbound RTP (Host sending video)
          if (report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            if (report.framesPerSecond) fps = Math.max(fps, Math.round(report.framesPerSecond));
            if (report.frameWidth) width = Math.max(width, report.frameWidth);
            if (report.frameHeight) height = Math.max(height, report.frameHeight);
            if (report.framesSent || report.framesEncoded) {
              totalFrames = Math.max(totalFrames, report.framesSent || report.framesEncoded);
            }
            if (report.bytesSent) {
              outboundBytes += report.bytesSent;
            }
            layerList.push(
              `${report.rid ?? 'f'}:${report.frameWidth ?? 0}x${report.frameHeight ?? 0}@${Math.round(report.framesPerSecond ?? 0)}${report.active === false ? ' pausada' : ''}`
            );
            if (report.targetBitrate) {
              targetBitrateKbps = Math.round(report.targetBitrate / 1000);
            }
            if (report.nackCount) totalNack += report.nackCount;
            if (report.pliCount) totalPli += report.pliCount;
            if (report.qualityLimitationReason) {
              qualityLimitationReason = report.qualityLimitationReason;
            }
            if (report.totalEncodeTime && report.framesEncoded) {
              encodeTimeMs = Math.round((report.totalEncodeTime / report.framesEncoded) * 1000 * 10) / 10;
            }
            if (report.codecId) {
              const codecReport = rtcReport.get(report.codecId);
              if (codecReport && codecReport.mimeType) {
                codec = codecReport.mimeType.replace('video/', '').toUpperCase();
              }
            }
          }
        });
      });

      totalBytes = Math.max(totalBytes, outboundBytes);

      // Calculate Bitrate and FPS from deltas if not directly reported
      let bitrate = 0;
      if (this.prevStats && totalBytes > 0) {
        const timeDiffSec = (now - this.prevStats.timestamp) / 1000;
        const bytesDiff = totalBytes - this.prevStats.bytes;
        const framesDiff = totalFrames - this.prevStats.frames;

        if (timeDiffSec > 0.4 && bytesDiff >= 0) {
          bitrate = Math.round((bytesDiff * 8) / timeDiffSec / 1000);
        }

        if (fps === 0 && timeDiffSec > 0.4 && framesDiff > 0) {
          fps = Math.round(framesDiff / timeDiffSec);
        }
      }

      const freezeDelta = this.prevStats ? Math.max(0, totalFreezes - this.prevStats.freezes) : 0;
      const droppedDelta = this.prevStats ? Math.max(0, totalDropped - this.prevStats.dropped) : 0;
      const nackDelta = Math.max(0, totalNack - this.prevCounters.nack);
      const pliDelta = Math.max(0, totalPli - this.prevCounters.pli);
      this.prevCounters = { nack: totalNack, pli: totalPli };
      this.prevStats = {
        bytes: totalBytes,
        frames: totalFrames,
        timestamp: now,
        freezes: totalFreezes,
        dropped: totalDropped,
      };

      // Current jitter-buffer delay: average over the last sampling window, not since stream start.
      if (measuredBufferDelay !== undefined) {
        const prev = this.prevBuffer;
        if (prev && bufferEmittedCount > prev.count) {
          measuredBufferDelay = Math.round(
            ((bufferDelaySum - prev.delay) / (bufferEmittedCount - prev.count)) * 1000
          );
        }
        this.prevBuffer = { delay: bufferDelaySum, count: bufferEmittedCount };
      }

      return {
        bitrateKbps: bitrate,
        rttMs: rtt,
        packetLossPercent: parseFloat(packetLoss.toFixed(1)),
        fps,
        width,
        height,
        codec: codec || '—',
        jitterMs: jitter,
        bufferDelayMs: measuredBufferDelay,
        bytesReceivedOrSent: totalBytes,
        qualityLimitationReason,
        captureFps,
        captureSize,
        layers: layerList.length ? layerList.join(' | ') : undefined,
        targetBitrateKbps,
        nackCount: nackDelta,
        pliCount: pliDelta,
        encodeTimeMs,
        freezeCount: freezeDelta,
        framesDropped: droppedDelta,
      };
    } catch {
      // Ignore stats collection error during renegotiations
      return null;
    }
  }
}
