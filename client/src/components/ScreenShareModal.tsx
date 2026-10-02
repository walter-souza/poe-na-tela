import React, { useState } from 'react';
import { Monitor, Volume2, Gauge, Zap, Check, X, ShieldCheck, Info } from 'lucide-react';
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
  const [bitrateKbps, setBitrateKbps] = useState<number>(8000); // 8 Mbps
  const [includeAudio, setIncludeAudio] = useState<boolean>(true);
  const [isolateRoomAudio, setIsolateRoomAudio] = useState<boolean>(true);
  const [contentHint] = useState<'motion' | 'detail'>('motion');

  if (!isOpen) return null;

  const handleStart = () => {
    onConfirm({
      resolution,
      frameRate,
      bitrateKbps,
      codec: 'vp9',
      includeAudio,
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
              <p className="text-xs text-gray-400">Otimize a qualidade e a taxa de quadros para seus amigos</p>
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
            <label className="block font-medium text-xs text-gray-400 uppercase tracking-wider mb-2">
              Resolução de Saída
            </label>
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

          <div>
            <label className="block font-medium text-xs text-gray-400 uppercase tracking-wider mb-2">
              Taxa de Quadros (FPS)
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { fps: 60 as VideoFrameRate, label: '60 FPS (Super Suave - Jogos / Filmes)' },
                { fps: 30 as VideoFrameRate, label: '30 FPS (Econômico - Trabalho / Texto)' },
              ].map((opt) => (
                <button
                  key={opt.fps}
                  type="button"
                  onClick={() => setFrameRate(opt.fps)}
                  className={`py-2.5 px-3.5 rounded-xl border text-left transition flex items-center justify-between ${
                    frameRate === opt.fps
                      ? 'bg-indigo-600/30 border-indigo-500 text-white'
                      : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="font-semibold">{opt.fps} FPS</span>
                  {frameRate === opt.fps && <Check className="w-4 h-4 text-indigo-400" />}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-xs text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Gauge className="w-4 h-4 text-indigo-400" />
                Bitrate Alvo (Qualidade de Imagem)
              </span>
              <span className="font-bold text-indigo-300">{(bitrateKbps / 1000).toFixed(0)} Mbps</span>
            </div>
            <input
              type="range"
              min="2000"
              max="20000"
              step="1000"
              value={bitrateKbps}
              onChange={(e) => setBitrateKbps(parseInt(e.target.value))}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <div className="flex justify-between text-[11px] text-gray-500">
              <span>2 Mbps (Low)</span>
              <span>8 Mbps (Recomendado 1080p60)</span>
              <span>20 Mbps (Ultra / 4K)</span>
            </div>
          </div>

          {/* Audio capture controls */}
          <div className="space-y-2">
            <div
              onClick={() => setIncludeAudio(!includeAudio)}
              className="flex items-center justify-between p-3.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl cursor-pointer transition select-none"
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${includeAudio ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white/5 text-gray-500'}`}>
                  <Volume2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-medium text-white flex items-center gap-2">
                    <span>Transmitir Áudio do Sistema / Jogo / Filme</span>
                    {includeAudio && (
                      <span className="text-[10px] bg-indigo-500/20 text-indigo-300 font-semibold px-1.5 py-0.2 rounded border border-indigo-500/30">
                        Estéreo 192 kbps
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">
                    Alta fidelidade pura (sem cortes de graves ou supressão de ruído)
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={includeAudio}
                onChange={() => {}}
                className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
              />
            </div>

            {/* Anti-Echo / Isolate Room Voice chat toggle */}
            {includeAudio && (
              <div
                onClick={() => setIsolateRoomAudio(!isolateRoomAudio)}
                className="flex items-center justify-between p-3 pl-4 bg-indigo-950/20 hover:bg-indigo-950/30 border border-indigo-500/20 rounded-xl cursor-pointer transition select-none animate-fadeIn"
              >
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <span>Anti-Eco: Isolar Voz dos Amigos da Stream</span>
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-300 font-bold px-1.5 py-0.2 rounded">
                        RECOMENDADO
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-400">
                      Filtra o áudio do chat de voz para que seus amigos não ouçam o próprio retorno
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
            )}
          </div>

          {/* User tips banner */}
          <div className="p-3 bg-white/5 border border-white/5 rounded-xl flex items-start gap-2.5 text-xs text-gray-400">
            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold text-gray-300">Dica para melhor isolamento: </span>
              Ao clicar em Iniciar, selecione a aba <span className="text-white font-medium">"Janela"</span> ou <span className="text-white font-medium">"Guia"</span> do seu jogo ou filme para transmitir exclusivamente o áudio dele.
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
