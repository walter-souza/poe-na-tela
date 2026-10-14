import React from 'react';
import type { StreamStats } from '../types';

interface StreamHUDProps {
  stats: StreamStats | null;
  isOpen: boolean;
  /** Absolute-position classes supplied by the tile that hosts the panel. */
  className?: string;
  playoutBufferMs?: number;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-gray-400">{label}</span>
    <span>{children}</span>
  </div>
);

// Same compact look as the WHEP (OBS) panel in WhepTile.
export const StreamHUD: React.FC<StreamHUDProps> = ({ stats, isOpen, className = '', playoutBufferMs }) => {
  if (!isOpen || !stats) return null;

  const targetBuffer = stats.playoutBufferMs ?? playoutBufferMs ?? 200;
  const fpsColor = stats.fps >= 55 ? 'text-emerald-400' : stats.fps >= 30 ? 'text-amber-400' : 'text-rose-400';
  const limitLabel =
    stats.qualityLimitationReason === 'cpu' ? 'CPU' : stats.qualityLimitationReason === 'bandwidth' ? 'banda' : 'nenhum';
  const hasRetransmits = !!stats.nackCount || !!stats.pliCount;

  return (
    <div className={`pointer-events-none bg-black/80 backdrop-blur-md border border-white/10 rounded-xl px-2.5 py-2 text-[11px] font-mono text-gray-200 space-y-0.5 shadow-xl ${className}`}>
      <Row label="Quadros">
        <span className={`font-bold ${fpsColor}`}>{stats.fps} FPS</span>
      </Row>
      <Row label="Resolução">
        {stats.width}x{stats.height} {stats.codec}
      </Row>
      <Row label="Bitrate">{(stats.bitrateKbps / 1000).toFixed(2)} Mbps</Row>
      <Row label="Perda">
        <span className={stats.packetLossPercent > 1 ? 'text-amber-400' : ''}>{stats.packetLossPercent.toFixed(1)}%</span>
      </Row>
      {stats.bufferDelayMs !== undefined && (
        <Row label="Buffer atual">
          {stats.bufferDelayMs} ms <span className="text-gray-500">(alvo {targetBuffer})</span>
        </Row>
      )}
      <Row label="RTT">{stats.rttMs} ms</Row>

      {stats.qualityLimitationReason !== undefined && (
        <Row label="Limite">
          <span className={stats.qualityLimitationReason === 'none' ? 'text-emerald-400' : 'text-rose-400'}>
            {limitLabel}
          </span>
          {stats.encodeTimeMs !== undefined && <span className="text-gray-500"> · encode {stats.encodeTimeMs} ms</span>}
        </Row>
      )}
      {stats.captureFps !== undefined && (
        <Row label="Captura">
          {stats.captureFps} fps{stats.captureSize ? <span className="text-gray-500"> {stats.captureSize}</span> : null}
        </Row>
      )}
      {stats.targetBitrateKbps !== undefined && (
        <Row label="Alvo">{(stats.targetBitrateKbps / 1000).toFixed(1)} Mbps</Row>
      )}
      {hasRetransmits && (
        <Row label="NACK / PLI">
          {stats.nackCount ?? 0} / {stats.pliCount ?? 0}
        </Row>
      )}
      {stats.layers && (
        <div className="pt-0.5 text-gray-300 break-all max-w-[240px]">
          <span className="text-gray-400">Camadas: </span>
          {stats.layers}
        </div>
      )}
      {(!!stats.freezeCount || !!stats.framesDropped) && (
        <div className="text-amber-400">
          {stats.freezeCount ? `${stats.freezeCount} freeze ` : ''}
          {stats.framesDropped ? `${stats.framesDropped} quadros perdidos` : ''}
        </div>
      )}
    </div>
  );
};
