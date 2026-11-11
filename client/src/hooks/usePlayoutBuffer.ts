import { useCallback, useRef, useState, type RefObject } from 'react';
import { Track, type Room } from 'livekit-client';

// WebRTC Playout / Jitter Buffer: começa baixo (latência) e sobe só quando as stats mostram freezes/jitter.
const DEFAULT_STREAM_BUFFER_MS = 200;
const MIN_STREAM_BUFFER_MS = 100;
const MAX_STREAM_BUFFER_MS = 500;
const MAX_VOICE_BUFFER_MS = 150;

/** Receiver playout delay for screen shares (adaptive) and voice (kept low for conversation). */
export function usePlayoutBuffer(roomRef: RefObject<Room | null>) {
  const [playoutBufferMs, setPlayoutBufferMsState] = useState<number>(DEFAULT_STREAM_BUFFER_MS);
  const playoutBufferMsRef = useRef<number>(DEFAULT_STREAM_BUFFER_MS);
  const calmSamplesRef = useRef<number>(0);
  const badSamplesRef = useRef<number>(0);

  // Applies WebRTC playoutDelayHint & jitterBufferTarget to an individual track's receiver.
  const applyToTrack = useCallback((track: Track, bufferMs: number = playoutBufferMsRef.current) => {
    try {
      const isScreen =
        track.source === Track.Source.ScreenShare ||
        track.source === Track.Source.ScreenShareAudio;

      // Screen share video & game audio get the adaptive stream buffer.
      // Voice chat (microphone) stays at low latency (<= 150ms) to preserve natural conversation.
      const targetMs = isScreen ? bufferMs : Math.min(bufferMs, MAX_VOICE_BUFFER_MS);
      const targetSec = targetMs / 1000;

      const receiver = (track as any).receiver as RTCRtpReceiver | undefined;
      if (receiver) {
        if ('playoutDelayHint' in receiver) {
          receiver.playoutDelayHint = targetSec;
        }
        if ('jitterBufferTarget' in receiver) {
          (receiver as any).jitterBufferTarget = targetMs;
        }
      }
    } catch (err) {
      console.warn('Failed to apply receiver buffer delay hint:', err);
    }
  }, []);

  // Updates all active receivers across the Room & PeerConnection.
  const applyToAll = useCallback((bufferMs: number = playoutBufferMsRef.current) => {
    const room = roomRef.current;
    if (!room) return;

    // 1. Through PeerConnection subscriber receivers
    try {
      const subPC =
        (room.engine as any)?.pcManager?.subscriber?.pc ||
        (room.engine as any)?.pcManager?.subscriber ||
        (room.engine as any)?.subscriber?.pc;

      if (subPC && typeof subPC.getReceivers === 'function') {
        const receivers = subPC.getReceivers() as RTCRtpReceiver[];
        const bufferSec = bufferMs / 1000;
        receivers.forEach((receiver) => {
          if (receiver.track?.kind === 'audio') return; // mic/screen audio handled per track below
          if ('playoutDelayHint' in receiver) {
            receiver.playoutDelayHint = bufferSec;
          }
          if ('jitterBufferTarget' in receiver) {
            (receiver as any).jitterBufferTarget = bufferMs;
          }
        });
      }
    } catch (e) {
      console.warn('Failed to update pc receivers buffer:', e);
    }

    // 2. Through remote participants published tracks
    room.remoteParticipants.forEach((p) => {
      p.trackPublications.forEach((pub) => {
        if (pub.track) {
          applyToTrack(pub.track, bufferMs);
        }
      });
    });
  }, [roomRef, applyToTrack]);

  const setPlayoutBufferMs = useCallback((bufferMs: number) => {
    const clamped = Math.max(MIN_STREAM_BUFFER_MS, Math.min(MAX_STREAM_BUFFER_MS, bufferMs));
    playoutBufferMsRef.current = clamped;
    setPlayoutBufferMsState(clamped);
    applyToAll(clamped);
  }, [applyToAll]);

  /**
   * Adaptive playout buffer (viewer only). Latency is the priority: grow slowly, only on a
   * sustained problem (2 consecutive bad windows), cap low, and shrink back quickly.
   */
  const adapt = useCallback((nackDelta: number, jitter: number) => {
    const current = playoutBufferMsRef.current;
    // Not freezeCount: screen capture is event-driven, so a static screen looks like a freeze.
    const bad = nackDelta > 10 || jitter > Math.max(60, current * 0.5);
    if (bad) {
      calmSamplesRef.current = 0;
      badSamplesRef.current += 1;
      if (badSamplesRef.current >= 2 && current < MAX_STREAM_BUFFER_MS) {
        console.debug(`[buffer] +50ms -> ${current + 50}ms (nack=${nackDelta} jitter=${jitter}ms)`);
        setPlayoutBufferMs(current + 50);
      }
    } else {
      badSamplesRef.current = 0;
      if (++calmSamplesRef.current >= 5 && current > DEFAULT_STREAM_BUFFER_MS) {
        calmSamplesRef.current = 0;
        console.debug(`[buffer] -50ms -> ${current - 50}ms`);
        setPlayoutBufferMs(current - 50);
      }
    }
  }, [setPlayoutBufferMs]);

  return { playoutBufferMs, playoutBufferMsRef, setPlayoutBufferMs, applyToTrack, applyToAll, adapt };
}
