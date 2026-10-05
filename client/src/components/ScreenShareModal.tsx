import React, { useState, useEffect } from 'react';
import { Monitor, Zap, X, ShieldCheck, Info, Sparkles, RefreshCw, Layers } from 'lucide-react';
import type { StreamQualityConfig, VideoResolution, VideoFrameRate, DesktopSource } from '../types';

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
  const isDesktopApp = typeof window !== 'undefined' && !!window.desktopAPI?.isDesktop;

  const [resolution, setResolution] = useState<VideoResolution>('1080p');
  const frameRate: VideoFrameRate = 30;
  const [isolateRoomAudio, setIsolateRoomAudio] = useState<boolean>(true);
  const [contentHint] = useState<'motion' | 'detail'>('motion');

  // Desktop native source selection
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'screens' | 'windows'>('windows');
  const [isLoadingSources, setIsLoadingSources] = useState<boolean>(false);

  const fetchDesktopSources = async () => {
    if (!window.desktopAPI?.getSources) return;
    setIsLoadingSources(true);
    try {
      const available = await window.desktopAPI.getSources();
      setSources(available);
      if (available.length > 0 && !selectedSourceId) {
        // Prefer first game/window or first screen
        const firstWindow = available.find((s) => s.id.startsWith('window:'));
        setSelectedSourceId(firstWindow ? firstWindow.id : available[0].id);
      }
    } catch (e) {
      console.error('Failed to load desktop sources:', e);
    } finally {
      setIsLoadingSources(false);
    }
  };

  useEffect(() => {
    if (isOpen && isDesktopApp) {
      fetchDesktopSources();
    }
  }, [isOpen, isDesktopApp]);

  if (!isOpen) return null;

  const handleStart = () => {
    const finalBitrate =
      resolution === '4k'
        ? 8000
        : resolution === '1440p'
        ? 5500
        : resolution === '1080p'
        ? 3600
        : 2200;

    onConfirm({
      resolution,
      frameRate,
      bitrateKbps: finalBitrate,
      codec: 'h264',
      includeAudio: true,
      contentHint,
      isolateRoomAudio,
      sourceId: selectedSourceId || undefined,
    });
    onClose();
  };

  const screenSources = sources.filter((s) => s.id.startsWith('screen:'));
  const windowSources = sources.filter((s) => s.id.startsWith('window:'));
  const displayedSources = activeTab === 'screens' ? screenSources : windowSources;

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
                {isDesktopApp && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> APP DESKTOP (30 FPS)
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-gray-400">
                {isDesktopApp
                  ? 'Captura nativa de jogos com aceleração por GPU e taxa fluida'
                  : 'Qualidade de vídeo e isolamento de som para seus amigos'}
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
          {/* Desktop Source Picker (Screens / Windows) */}
          {isDesktopApp && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block font-medium text-xs text-gray-400 uppercase tracking-wider">
                  Selecione o que transmitir
                </label>
                <button
                  onClick={fetchDesktopSources}
                  disabled={isLoadingSources}
                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSources ? 'animate-spin' : ''}`} />
                  Atualizar Janelas
                </button>
              </div>

              {/* Tabs: Janelas / Telas */}
              <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={() => setActiveTab('windows')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                    activeTab === 'windows'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Janelas de Jogos ({windowSources.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('screens')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                    activeTab === 'screens'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Telas Inteiras ({screenSources.length})
                </button>
              </div>

              {/* Source Grid */}
              <div className="grid grid-cols-2 gap-3 max-h-48 overflow-y-auto p-1 bg-black/30 rounded-xl border border-white/5">
                {displayedSources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setSelectedSourceId(source.id)}
                    className={`p-2 rounded-xl border text-left transition flex flex-col gap-1.5 relative overflow-hidden group ${
                      selectedSourceId === source.id
                        ? 'bg-indigo-600/20 border-indigo-500 shadow-md ring-1 ring-indigo-500'
                        : 'bg-white/5 border-white/5 hover:bg-white/10 text-gray-300'
                    }`}
                  >
                    <div className="w-full h-24 rounded-lg bg-black/60 overflow-hidden flex items-center justify-center border border-white/5">
                      {source.thumbnail ? (
                        <img
                          src={source.thumbnail}
                          alt={source.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <Monitor className="w-8 h-8 text-gray-600" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 truncate w-full">
                      {source.appIcon && (
                        <img src={source.appIcon} alt="" className="w-4 h-4 rounded shrink-0" />
                      )}
                      <span className="text-xs font-medium truncate text-white">
                        {source.name || 'Janela'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Frame Rate Indicator (Fixed 30 FPS) */}
          <div>
            <label className="block font-medium text-xs text-gray-400 uppercase tracking-wider mb-2">
              Taxa de Quadros (FPS)
            </label>
            <div className="py-2.5 px-3.5 rounded-xl border border-indigo-500/40 bg-indigo-600/20 text-white flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm text-white flex items-center gap-2">
                  30 FPS
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                    Otimizado
                  </span>
                </div>
                <div className="text-[11px] text-gray-400">Taxa de quadros estável com máxima fluidez e menor consumo de banda</div>
              </div>
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

          {/* Tips */}
          {!isDesktopApp && (
            <div className="p-3.5 bg-indigo-950/20 border border-indigo-500/20 rounded-xl space-y-2 text-xs text-gray-300">
              <div className="flex items-start gap-2.5">
                <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-semibold text-white">Dica para fluidez em jogos no navegador: </span>
                  Configure o jogo em <span className="text-indigo-300 font-medium">"Janela sem Bordas"</span> e selecione a aba <span className="text-indigo-300 font-medium">"Janela"</span> na próxima tela.
                </div>
              </div>
            </div>
          )}
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
