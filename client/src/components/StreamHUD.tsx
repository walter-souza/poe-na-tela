import React from 'react';
import { Activity, Wifi, ShieldAlert, Cpu, Film, Gauge, Clock } from 'lucide-react';
import type { StreamStats } from '../types';

interface StreamHUDProps {
  stats: StreamStats | null;
  isOpen: boolean;
  onClose: () => void;
  playoutBufferMs?: number;
}

export const StreamHUD: React.FC<StreamHUDProps> = ({
  stats,
  isOpen,
  onClose,
  playoutBufferMs,
}) => {
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
  const isSender = stats.limitationReason !== undefined || stats.encoderImplementation !== undefined;

  const limitation = (() => {
    switch (stats.limitationReason) {
      case 'none':
        return { label: 'Sem limitação', color: 'text-emerald-400', hint: 'O codificador entrega o que foi pedido.' };
      case 'cpu':
        return { label: 'CPU / codificador', color: 'text-rose-400', hint: 'O codificador não acompanha. Reduza a resolução ou use codificação por hardware.' };
      case 'bandwidth':
        return { label: 'Banda de upload', color: 'text-amber-400', hint: 'A rede de envio está limitando o bitrate. Reduza o bitrate ou a resolução.' };
      case 'other':
        return { label: 'Outro', color: 'text-amber-400', hint: 'Limitação por outro motivo (ex.: resolução imposta pela captura).' };
      default:
        return null;
    }
  })();

  const encoderIsSoftware = /openh264|libvpx|libaom|software|ffmpeg/i.test(stats.encoderImplementation ?? '');
  const currentBuffer = stats.bufferDelayMs ?? stats.playoutBufferMs ?? playoutBufferMs ?? 800;

  return (
    <div data-theme="dark" className="absolute top-2 left-2 sm:top-4 sm:left-4 z-40 bg-black/90 backdrop-blur-md border border-white/10 rounded-2xl p-3 sm:p-4 text-xs font-mono text-gray-200 shadow-2xl w-[calc(100vw-1rem)] max-w-sm sm:w-auto sm:min-w-[300px] transition-all">
      <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-3">
        <div className="flex items-center gap-2 font-semibold text-indigo-400">
          <Gauge className="w-4 h-4" />
          <span>Stream Diagnostics HUD</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white px-1.5 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 transition"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-white/5 p-2 rounded-xl border border-white/5">
          <div className="flex items-center gap-1.5 text-gray-400 mb-1">
            <Wifi className="w-3.5 h-3.5" />
            <span>Latência (RTT)</span>
          </div>
          <div className={`text-base font-bold ${getLatencyColor(stats.rttMs)}`}>
            {stats.rttMs} ms
          </div>
        </div>

        <div className="bg-white/5 p-2 rounded-xl border border-white/5">
          <div className="flex items-center gap-1.5 text-gray-400 mb-1">
            <Activity className="w-3.5 h-3.5" />
            <span>Taxa de Quadros</span>
          </div>
          <div className="text-base font-bold text-white flex items-center gap-1.5">
            <span>{stats.fps > 0 ? `${stats.fps} FPS` : '— FPS'}</span>
            {stats.fps >= 55 && (
              <span className="text-[9px] bg-purple-500/20 text-purple-300 font-bold px-1.5 py-0.2 rounded border border-purple-500/30">
                60 FPS
              </span>
            )}
          </div>
        </div>

        <div className="bg-white/5 p-2 rounded-xl border border-white/5">
          <div className="flex items-center gap-1.5 text-gray-400 mb-1">
            <Cpu className="w-3.5 h-3.5" />
            <span>Bitrate Atual</span>
          </div>
          <div className="text-base font-bold text-indigo-300">
            {bitrateMbps} Mbps
          </div>
        </div>

        <div className="bg-white/5 p-2 rounded-xl border border-white/5">
          <div className="flex items-center gap-1.5 text-gray-400 mb-1">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Perda de Pacotes</span>
          </div>
          <div className={`text-base font-bold ${getLossColor(stats.packetLossPercent)}`}>
            {stats.packetLossPercent}%
          </div>
        </div>
      </div>

      {/* Playout Buffer Metric (Padronizado e Estabilizado para 60 FPS) */}
      <div className="mt-2.5 bg-white/5 p-2 rounded-xl border border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-gray-400">
          <Clock className="w-3.5 h-3.5 text-emerald-400" />
          <span>Buffer Playout</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-1.5 py-0.5 rounded border border-emerald-500/30">
            Estabilizado (~{currentBuffer}ms)
          </span>
          {stats.jitterMs > 0 && (
            <span className="text-[10px] text-gray-500 font-normal">
              ±{stats.jitterMs}ms
            </span>
          )}
        </div>
      </div>

      {isSender && (
        <div className="mt-2.5 bg-white/5 p-2 rounded-xl border border-white/5 space-y-1.5">
          <div className="text-gray-400 font-semibold">Diagnóstico do emissor</div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Limitação</span>
            <span className={`font-bold ${limitation?.color ?? 'text-gray-300'}`}>{limitation?.label ?? '—'}</span>
          </div>
          {limitation && stats.limitationReason !== 'none' && (
            <div className="text-[10px] text-gray-500 leading-snug">{limitation.hint}</div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Codificador</span>
            <span className={`font-bold ${encoderIsSoftware ? 'text-rose-400' : 'text-emerald-400'}`}>
              {stats.encoderImplementation || '—'}{encoderIsSoftware ? ' (software)' : ''}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Captura → envio</span>
            <span className="font-bold text-white">
              {stats.captureFps ?? '—'} → {stats.fps > 0 ? stats.fps : '—'} FPS
            </span>
          </div>
          {stats.captureWidth !== undefined && (
            <div className="flex items-center justify-between">
              <span className="text-gray-400">
                Captura de {stats.displaySurface === 'browser' ? 'aba' : stats.displaySurface === 'window' ? 'janela' : stats.displaySurface === 'monitor' ? 'tela' : 'origem'}
              </span>
              <span className="font-bold text-white">{stats.captureWidth}x{stats.captureHeight}</span>
            </div>
          )}
          {stats.availableOutgoingKbps !== undefined && (
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Upload disponível</span>
              <span className="font-bold text-white">{(stats.availableOutgoingKbps / 1000).toFixed(1)} Mbps</span>
            </div>
          )}
          {stats.targetBitrateKbps !== undefined && (
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Bitrate-alvo</span>
              <span className="font-bold text-indigo-300">{(stats.targetBitrateKbps / 1000).toFixed(1)} Mbps</span>
            </div>
          )}
        </div>
      )}

      {!isSender && stats.framesDropped !== undefined && (
        <div className="mt-2.5 bg-white/5 p-2 rounded-xl border border-white/5 flex items-center justify-between">
          <span className="text-gray-400">Quadros descartados</span>
          <span className={`font-bold ${stats.framesDropped > 30 ? 'text-amber-400' : 'text-emerald-400'}`}>{stats.framesDropped}</span>
        </div>
      )}

      <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between text-gray-400">
        <div className="flex items-center gap-1">
          <Film className="w-3.5 h-3.5 text-purple-400" />
          <span>{stats.width > 0 ? `${stats.width}x${stats.height}` : '—'}</span>
        </div>
        <span className="px-2 py-0.5 rounded-md bg-indigo-950/60 border border-indigo-500/30 text-indigo-300 uppercase font-semibold">
          {stats.codec}
        </span>
      </div>
    </div>
  );
};
