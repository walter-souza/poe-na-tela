import React, { useState } from 'react';
import { Monitor, Zap, X, ShieldCheck, Sparkles } from 'lucide-react';
import type { StreamQualityConfig, VideoResolution, VideoFrameRate } from '../types';

interface ScreenShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (config: StreamQualityConfig) => void;
}

export const ScreenShareModal: React.FC<ScreenShareModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [resolution, setResolution] = useState<VideoResolution>('1080p');
  const [frameRate, setFrameRate] = useState<VideoFrameRate>(60);
  const [isolateRoomAudio, setIsolateRoomAudio] = useState<boolean>(true);

  if (!isOpen) return null;

  const handleStart = () => {
    onConfirm({
      resolution,
      frameRate,
      includeAudio: true,
      contentHint: 'motion',
      isolateRoomAudio,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#13151f] border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden text-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl shrink-0">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-sm sm:text-base">Configurações de Transmissão</h3>
              </div>
              <p className="text-[11px] sm:text-xs text-gray-400">
                Qualidade de vídeo e isolamento de som para seus amigos
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 text-sm max-h-[80vh] sm:max-h-[75vh] overflow-y-auto">
          {/* Frame Rate Selection (Unlocked 60 FPS / 30 FPS) */}
          <div>
            <label className="block font-medium text-xs text-gray-400 uppercase tracking-wider mb-2">
              Taxa de Quadros (FPS)
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  fps: 60 as VideoFrameRate,
                  label: '60 FPS',
                  desc: 'Máxima fluidez para jogos e movimento rápido',
                  badge: 'Destravado',
                },
                {
                  fps: 30 as VideoFrameRate,
                  label: '30 FPS',
                  desc: 'Menor consumo de banda e CPU',
                  badge: 'Econômico',
                },
              ].map(({ fps, label, desc, badge }) => (
                <button
                  key={fps}
                  type="button"
                  onClick={() => setFrameRate(fps)}
                  className={`py-2.5 px-3 rounded-xl border text-left transition flex flex-col justify-between ${
                    frameRate === fps
                      ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-md'
                      : 'bg-white/5 border-white/5 hover:bg-white/10 text-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm text-white">{label}</span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                        fps === 60
                          ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      }`}
                    >
                      {badge}
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-400 leading-tight">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Resolution Selection */}
          <div>
            <label className="block font-medium text-xs text-gray-400 uppercase tracking-wider mb-2">
              Resolução de Saída
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { res: '720p' as VideoResolution, label: '720p (HD)' },
                { res: '1080p' as VideoResolution, label: '1080p (Full HD)' },
              ].map(({ res, label }) => (
                <button
                  key={res}
                  type="button"
                  onClick={() => setResolution(res)}
                  className={`py-2.5 px-3 rounded-xl font-semibold border text-center transition ${
                    resolution === res
                      ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-md'
                      : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Anti-Echo / Isolate Room Voice chat toggle */}
          <div
            onClick={() => setIsolateRoomAudio(!isolateRoomAudio)}
            className={`flex items-center justify-between p-3.5 border rounded-xl cursor-pointer transition select-none ${
              isolateRoomAudio
                ? 'bg-emerald-950/20 hover:bg-emerald-950/30 border-emerald-500/30 shadow-sm'
                : 'bg-white/5 hover:bg-white/10 border-white/5'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${
                  isolateRoomAudio ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-500'
                }`}
              >
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="font-medium text-white flex items-center gap-2">
                  <span>Anti-Eco: Isolar Voz dos Amigos da Transmissão</span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-1.5 py-0.2 rounded border border-emerald-500/30">
                    RECOMENDADO
                  </span>
                </div>
                <div className="text-xs text-gray-400">
                  Filtra o áudio do chat de voz para que seus amigos não ouçam o próprio retorno na transmissão
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={isolateRoomAudio}
              onChange={() => {}}
              className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
            />
          </div>

          {/* Unified Quality Indicator */}
          <div className="p-3.5 bg-indigo-950/20 border border-indigo-500/20 rounded-xl space-y-1.5 text-xs text-gray-300">
            <div className="flex items-center gap-2 text-indigo-300 font-semibold">
              <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>Qualidade Unificada Inteligente</span>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Taxa de quadros fluida ({frameRate} FPS) para jogos e filmes combinada com nitidez cristalina automática para textos, abas e janelas, sem necessidade de alternar modos.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-white/10 bg-white/5">
          <button
            onClick={onClose}
            className="px-3 sm:px-4 py-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 font-medium text-xs sm:text-sm transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleStart}
            className="px-4 sm:px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs sm:text-sm shadow-lg shadow-indigo-600/30 transition flex items-center gap-1.5 sm:gap-2"
          >
            <Zap className="w-4 h-4" />
            <span>Iniciar Transmissão ({frameRate} FPS)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
