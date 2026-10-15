import { useCallback, useEffect, useState } from 'react';
import {
  invoke,
  listen,
  type NativeCaptureConfig,
  type NativeCaptureState,
  type NativeCaptureStats,
} from '../utils/desktop';

interface CaptureStateEvent {
  state: 'starting' | 'live' | 'reconnecting' | 'stopped' | 'error';
  message: string | null;
}

/** Estado da transmissão nativa (captura + encode por GPU + SRT) controlada pelo app desktop. */
export function useNativeStream() {
  const [state, setState] = useState<NativeCaptureState>('idle');
  const [stats, setStats] = useState<NativeCaptureStats | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const offState = listen<CaptureStateEvent>('capture-state', ({ state: next, message: msg }) => {
      setState(next === 'stopped' ? 'idle' : next);
      setMessage(msg);
      if (next === 'stopped' || next === 'error') setStats(null);
    });
    const offStats = listen<NativeCaptureStats>('capture-stats', setStats);
    return () => {
      offState();
      offStats();
    };
  }, []);

  const start = useCallback(async (config: NativeCaptureConfig) => {
    setState('starting');
    setMessage(null);
    try {
      await invoke('start_capture', { config });
    } catch (err) {
      setState('error');
      setMessage(String(err));
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await invoke('stop_capture');
    } finally {
      setState('idle');
      setStats(null);
      setMessage(null);
    }
  }, []);

  return { state, stats, message, isStreaming: state === 'starting' || state === 'live' || state === 'reconnecting', start, stop };
}
