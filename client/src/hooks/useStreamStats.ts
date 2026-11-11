import { useCallback, useRef, useState, type RefObject } from 'react';
import { ConnectionState, type Room } from 'livekit-client';
import type { StreamStats } from '../types';
import { StreamStatsCollector } from '../utils/streamStats';
import type { usePlayoutBuffer } from './usePlayoutBuffer';

type PlayoutBuffer = ReturnType<typeof usePlayoutBuffer>;

/** Samples WebRTC stats once a second while connected and drives the adaptive playout buffer. */
export function useStreamStats(roomRef: RefObject<Room | null>, playout: PlayoutBuffer) {
  const [stats, setStats] = useState<StreamStats | null>(null);
  const collectorRef = useRef(new StreamStatsCollector());
  const intervalRef = useRef<number | null>(null);
  const { adapt, playoutBufferMsRef } = playout;

  const collect = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;

    const sample = await collectorRef.current.collect(room);
    if (!sample) return;

    // Only a viewer has a jitter buffer to measure.
    if (sample.bufferDelayMs !== undefined) adapt(sample.nackCount ?? 0, sample.jitterMs);
    setStats({ ...sample, playoutBufferMs: playoutBufferMsRef.current });
  }, [roomRef, adapt, playoutBufferMsRef]);

  const start = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(collect, 1000);
  }, [collect]);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  return { stats, start, stop };
}
