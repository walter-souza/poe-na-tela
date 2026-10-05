import React from 'react';
import { Activity, Wifi, ShieldAlert, Cpu, Film, Gauge } from 'lucide-react';
import type { StreamStats } from '../types';

interface StreamHUDProps {
  stats: StreamStats | null;
  isOpen: boolean;
  onClose: () => void;
}

export const StreamHUD: React.FC<StreamHUDProps> = ({ stats, isOpen, onClose }) => {
  if (!isOpen || !stats) return null;

  const getLatencyColor = (rtt: number) => {
    if (rtt < 80) return 'text-emerald-400';
    if (rtt < 180) return 'text-amber-400';
    return 'text-rose-400';
  };

  const getLossColor = (loss: number) => {
    if (loss <= 0.5) return 'text-emerald-400';
    if (loss < 3.0) return 'text-amber-400';
    return 'text-rose-400';
  };

  const bitrateMbps = (stats.bitrateKbps / 1000).toFixed(2);

  return (
    <div className="absolute top-2 left-2 sm:top-4 sm:left-4 z-40 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl p-3 sm:p-4 text-xs font-mono text-gray-200 shadow-2xl w-[calc(100vw-1rem)] max-w-sm sm:w-auto sm:min-w-[280px] transition-all">
      <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-3">
        <div className="flex items-center gap-2 font-semibold text-indigo-400">
          <Gauge className="w-4 h-4" />
          <span>Stream Diagnostics HUD</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 transition"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/5 p-2 rounded-lg border border-white/5">
          <div className="flex items-center gap-1.5 text-gray-400 mb-1">
            <Wifi className="w-3.5 h-3.5" />
            <span>Latência (RTT)</span>
          </div>
          <div className={`text-base font-bold ${getLatencyColor(stats.rttMs)}`}>
            {stats.rttMs} ms
          </div>
        </div>

        <div className="bg-white/5 p-2 rounded-lg border border-white/5">
          <div className="flex items-center gap-1.5 text-gray-400 mb-1">
            <Activity className="w-3.5 h-3.5" />
            <span>Taxa de Quadros</span>
          </div>
          <div className="text-base font-bold text-white">
            {stats.fps} FPS
          </div>
        </div>

        <div className="bg-white/5 p-2 rounded-lg border border-white/5">
          <div className="flex items-center gap-1.5 text-gray-400 mb-1">
            <Cpu className="w-3.5 h-3.5" />
            <span>Bitrate Atual</span>
          </div>
          <div className="text-base font-bold text-indigo-300">
            {bitrateMbps} Mbps
          </div>
        </div>

        <div className="bg-white/5 p-2 rounded-lg border border-white/5">
          <div className="flex items-center gap-1.5 text-gray-400 mb-1">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Perda de Pacotes</span>
          </div>
          <div className={`text-base font-bold ${getLossColor(stats.packetLossPercent)}`}>
            {stats.packetLossPercent}%
          </div>
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-gray-400">
        <div className="flex items-center gap-1">
          <Film className="w-3.5 h-3.5 text-purple-400" />
          <span>{stats.width}x{stats.height}</span>
        </div>
        <span className="px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-500/30 text-indigo-300 uppercase font-semibold">
          {stats.codec}
        </span>
      </div>
    </div>
  );
};
