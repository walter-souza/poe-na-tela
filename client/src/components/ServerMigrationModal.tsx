import React from 'react';
import { Server, AlertTriangle, ArrowRight, RefreshCw, X } from 'lucide-react';

interface ServerMigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
  currentServerName?: string;
  reason?: 'limit_reached' | 'manual';
}

export const ServerMigrationModal: React.FC<ServerMigrationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  currentServerName = 'Servidor Atual',
  reason = 'limit_reached',
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-[#11131c] border border-white/15 rounded-3xl w-full max-w-md p-6 shadow-2xl relative text-white animate-scale-up">
        {/* Close button */}
        <button
          onClick={onClose}
          disabled={isLoading}
          className="absolute top-4 right-4 p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Icon */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-lg shadow-amber-500/10">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">
              {reason === 'limit_reached' ? 'Limite do Servidor Atingido' : 'Trocar Servidor da Sala'}
            </h3>
            <p className="text-xs text-gray-400">
              {reason === 'limit_reached'
                ? 'Capacidade máxima de transmissão atingida'
                : 'Migrar transmissão para servidor reserva'}
            </p>
          </div>
        </div>

        {/* Explanation Box */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-5 text-xs text-gray-300 space-y-2">
          <div className="flex items-center justify-between text-gray-400 font-medium pb-2 border-b border-white/10">
            <span>Servidor Atual:</span>
            <span className="text-amber-300 font-bold flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5" />
              {currentServerName}
            </span>
          </div>

          <p className="leading-relaxed">
            {reason === 'limit_reached'
              ? 'O servidor atual atingiu a cota de participantes ou de transmissões simultâneas. Você pode transferir esta sala para o próximo servidor do pool automaticamente.'
              : 'Deseja migrar todos os participantes desta sala para o próximo servidor de menor carga?'}
          </p>

          <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[11px] flex items-center gap-2">
            <span className="font-bold">✓ Sem fechar a sala:</span>
            <span>Todos os espectadores serão sincronizados automaticamente.</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 py-3 px-4 rounded-xl font-medium text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 py-3 px-4 rounded-xl font-bold text-xs bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-lg shadow-orange-600/30 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Migrando Sala...</span>
              </>
            ) : (
              <>
                <span>Migrar para Próximo</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
