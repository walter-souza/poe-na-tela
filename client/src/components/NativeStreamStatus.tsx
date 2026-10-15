import React from 'react';
import { Radio, RefreshCw, AlertTriangle } from 'lucide-react';
import type { NativeCaptureState, NativeCaptureStats } from '../utils/desktop';

interface NativeStreamStatusProps {
  state: NativeCaptureState;
  stats: NativeCaptureStats | null;
  message: string | null;
}

/** Indicador flutuante da transmissão nativa: ao vivo, reconectando ou com erro. */
export const NativeStreamStatus: React.FC<NativeStreamStatusProps> = ({ state, stats, message }) => {
  if (state === 'idle') return null;

  const tone =
    state === 'live'
      ? 'border-emerald-500/40 text-emerald-200'
      : state === 'error'
        ? 'border-rose-500/40 text-rose-200'
        : 'border-amber-500/40 text-amber-200';
  const Icon = state === 'live' ? Radio : state === 'error' ? AlertTriangle : RefreshCw;
  const title =
    state === 'live'
      ? 'AO VIVO'
      : state === 'error'
        ? 'Falha na transmissão'
        : state === 'starting'
          ? 'Iniciando…'
          : 'Reconectando…';

  return (
    <div
      className={`absolute bottom-3 left-3 z-30 max-w-sm px-3 py-2 rounded-xl bg-[#11131c]/90 border backdrop-blur-md text-xs shadow-2xl ${tone}`}
    >
      <div className="flex items-center gap-2 font-semibold">
        <Icon className={`w-3.5 h-3.5 ${state === 'live' ? 'animate-pulse' : ''}`} />
        <span>{title}</span>
        {state === 'live' && stats && (
          <span className="font-mono text-[11px] text-gray-300">
            {stats.fps.toFixed(0)} fps · {(stats.bitrateKbps / 1000).toFixed(1)} Mbps
            {stats.droppedFrames > 0 ? ` · ${stats.droppedFrames} perdidos` : ''}
          </span>
        )}
      </div>
      {message && state !== 'live' && <p className="mt-1 text-[11px] text-gray-400 break-words">{message}</p>}
    </div>
  );
};
