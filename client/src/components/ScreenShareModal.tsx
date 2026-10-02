import React, { useState } from 'react';
import { Monitor, Zap, X, ShieldCheck, Info } from 'lucide-react';
import type { StreamQualityConfig, VideoResolution } from '../types';

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
  const [isolateRoomAudio, setIsolateRoomAudio] = useState<boolean>(true);
  const [contentHint] = useState<'motion' | 'detail'>('motion');

  if (!isOpen) return null;

  const handleStart = () => {
    onConfirm({
      resolution,
      frameRate: 30,
      bitrateKbps: resolution === '4k' ? 14000 : resolution === '1440p' ? 9000 : resolution === '720p' ? 3500 : 6000,
      codec: 'vp9',
      includeAudio: true,
      contentHint,
      isolateRoomAudio,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#13151f] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Configurações de Transmissão</h3>
              <p className="text-xs text-gray-400">Qualidade de vídeo e isolamento de som para seus amigos</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-sm">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block font-medium text-xs text-gray-400 uppercase tracking-wider">
                Resolução de Saída
              </label>
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 font-semibold px-2 py-0.5 rounded-md border border-indigo-500/30">
                30 FPS Padrão
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['720p', '1080p', '1440p', '4k'] as VideoResolution[]).map((res) => (
                <button
                  key={res}
                  type="button"
                  onClick={() => setResolution(res)}
                  className={`py-2 px-3 rounded-xl font-semibold border text-center transition ${
                    resolution === res
                      ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-md'
                      : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {res.toUpperCase()}
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

          {/* User tips banner */}
          <div className="p-3 bg-white/5 border border-white/5 rounded-xl flex items-start gap-2.5 text-xs text-gray-400">
            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold text-gray-300">Áudio do Jogo / Filme: </span>
              Na janela seguinte do navegador, certifique-se de marcar a opção <span className="text-white font-medium">"Compartilhar áudio"</span> para transmitir o som em alta fidelidade estéreo (192 kbps).
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 font-medium transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleStart}
            className="px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center gap-2"
          >
            <Zap className="w-4 h-4" />
            <span>Iniciar Transmissão</span>
          </button>
        </div>
      </div>
    </div>
  );
};
