import React from 'react';
import { AlertTriangle, ArrowRight, Server } from 'lucide-react';

interface BandwidthWarningBannerProps {
  serverName?: string;
  onMigrate: () => void;
  isMigrating?: boolean;
}

export const BandwidthWarningBanner: React.FC<BandwidthWarningBannerProps> = ({
  serverName = 'Servidor Atual',
  onMigrate,
  isMigrating = false,
}) => {
  return (
    <div className="w-full bg-gradient-to-r from-amber-600/90 via-orange-600/90 to-amber-700/90 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 shadow-lg border-b border-amber-400/30 text-xs font-medium backdrop-blur-md z-30 select-none animate-slide-down">
      <div className="flex items-center gap-2">
        <div className="p-1 rounded-lg bg-black/20 text-amber-200">
          <AlertTriangle className="w-4 h-4 animate-pulse" />
        </div>
        <div>
          <span className="font-bold">Limite de banda atingido no {serverName}:</span>
          <span className="text-amber-100 ml-1.5 hidden sm:inline">
            A conexão está ativa, mas transmissões de vídeo podem sofrer oscilações ou cortes.
          </span>
        </div>
      </div>

      <button
        onClick={onMigrate}
        disabled={isMigrating}
        className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-black/30 hover:bg-black/50 border border-white/20 text-white font-bold text-xs shadow transition active:scale-95 cursor-pointer disabled:opacity-50"
      >
        <Server className="w-3.5 h-3.5 text-amber-300" />
        <span>{isMigrating ? 'Migrando...' : 'Migrar para Servidor Reserva'}</span>
        <ArrowRight className="w-3.5 h-3.5 text-amber-300" />
      </button>
    </div>
  );
};
