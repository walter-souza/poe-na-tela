import React, { useEffect, useState } from 'react';
import { ChevronDown, Monitor, RefreshCw, ScreenShare } from 'lucide-react';
import { Button, Modal, Segmented, Switch } from './ui';
import { getRecommendedQuality, getTargetBitrateKbps } from '../utils/streamPresets';
import type { StreamQualityConfig, VideoResolution, VideoFrameRate, QualityMode, DesktopSource } from '../types';

interface ScreenShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (config: StreamQualityConfig) => void;
}

const RESOLUTIONS: { value: VideoResolution; label: string }[] = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
];
const FRAME_RATES: { value: '30' | '60'; label: string }[] = [
  { value: '30', label: '30 FPS' },
  { value: '60', label: '60 FPS' },
];

/** Transmitir tela: qualidade sugerida para o computador, prioridade e áudio; opções avançadas recolhidas. */
export const ScreenShareModal: React.FC<ScreenShareModalProps> = ({ isOpen, onClose, onConfirm }) => {
  const isDesktopApp = typeof window !== 'undefined' && !!window.desktopAPI?.isDesktop;

  const recommended = React.useMemo(() => getRecommendedQuality(), []);
  const [resolution, setResolution] = useState<VideoResolution>(recommended.resolution);
  const [frameRate, setFrameRate] = useState<VideoFrameRate>(recommended.frameRate);
  const [qualityMode, setQualityMode] = useState<QualityMode>('stable');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [isolateRoomAudio, setIsolateRoomAudio] = useState(true);
  const [simulcast, setSimulcast] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // App desktop: escolha nativa de janela ou tela
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<'windows' | 'screens'>('windows');
  const [isLoadingSources, setIsLoadingSources] = useState(false);

  const fetchDesktopSources = async () => {
    if (!window.desktopAPI?.getSources) return;
    setIsLoadingSources(true);
    try {
      const available = await window.desktopAPI.getSources();
      setSources(available);
      if (available.length > 0 && !selectedSourceId) {
        const firstWindow = available.find((s) => s.id.startsWith('window:'));
        setSelectedSourceId(firstWindow ? firstWindow.id : available[0].id);
      }
    } catch (e) {
      console.error('Falha ao listar janelas e telas:', e);
    } finally {
      setIsLoadingSources(false);
    }
  };

  useEffect(() => {
    if (isOpen && isDesktopApp) fetchDesktopSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isDesktopApp]);

  const handleStart = () => {
    onConfirm({
      resolution,
      frameRate,
      bitrateKbps: getTargetBitrateKbps(resolution, frameRate, qualityMode),
      codec: 'h264',
      includeAudio,
      contentHint: 'motion',
      isolateRoomAudio,
      sourceId: selectedSourceId || undefined,
      qualityMode,
      simulcast: simulcast && resolution === '1080p',
    });
    onClose();
  };

  const displayedSources = sources.filter((s) => s.id.startsWith(sourceKind === 'screens' ? 'screen:' : 'window:'));
  const modeOptions: { value: QualityMode; label: string }[] = [
    { value: 'stable', label: `Estável · ${(getTargetBitrateKbps(resolution, frameRate, 'stable') / 1000).toFixed(1)} Mbps` },
    { value: 'high', label: `Alta qualidade · ${(getTargetBitrateKbps(resolution, frameRate, 'high') / 1000).toFixed(1)} Mbps` },
  ];

  return (
    <Modal open={isOpen} onClose={onClose} title="Transmitir tela" className="max-w-lg">
      <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
        {isDesktopApp && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Segmented
                ariaLabel="O que transmitir"
                options={[
                  { value: 'windows', label: 'Janelas' },
                  { value: 'screens', label: 'Telas' },
                ]}
                value={sourceKind}
                onChange={setSourceKind}
              />
              <Button variant="ghost" onClick={fetchDesktopSources} disabled={isLoadingSources}>
                <RefreshCw className={`w-4 h-4 ${isLoadingSources ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {displayedSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => setSelectedSourceId(source.id)}
                  aria-pressed={selectedSourceId === source.id}
                  className={`p-2 rounded-xl border text-left transition cursor-pointer ${
                    selectedSourceId === source.id ? 'border-accent-text bg-accent/10' : 'border-line hover:border-gray-600'
                  }`}
                >
                  <div className="h-20 rounded-lg bg-black overflow-hidden flex items-center justify-center">
                    {source.thumbnail ? (
                      <img src={source.thumbnail} alt="" className="w-full h-full object-contain" />
                    ) : (
                      <Monitor className="w-7 h-7 text-gray-600" />
                    )}
                  </div>
                  <span className="mt-1.5 flex items-center gap-1.5 text-xs truncate">
                    {source.appIcon && <img src={source.appIcon} alt="" className="w-4 h-4 rounded shrink-0" />}
                    <span className="truncate">{source.name || 'Janela'}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-400">Qualidade</p>
          <div className="flex flex-wrap gap-2">
            <Segmented ariaLabel="Resolução" options={RESOLUTIONS} value={resolution} onChange={setResolution} />
            <Segmented
              ariaLabel="Quadros por segundo"
              options={FRAME_RATES}
              value={String(frameRate) as '30' | '60'}
              onChange={(v) => setFrameRate(Number(v) as VideoFrameRate)}
            />
          </div>
          <p className="text-xs text-gray-500">
            Sugerido para seu computador: {recommended.resolution} a {recommended.frameRate} FPS ({recommended.reason}).
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-400">Prioridade</p>
          <Segmented ariaLabel="Prioridade" options={modeOptions} value={qualityMode} onChange={setQualityMode} />
          <p className="text-xs text-gray-500">
            {qualityMode === 'stable'
              ? 'Menos banda: melhor para internet instável ou muitos espectadores.'
              : 'Mais nitidez. Exige upload estável.'}
          </p>
        </div>

        <div className="border-t border-line pt-1">
          <Switch
            checked={includeAudio}
            onChange={setIncludeAudio}
            label="Incluir o som da tela"
            description="Som do jogo ou do vídeo."
          />
          <Switch
            checked={isolateRoomAudio}
            onChange={setIsolateRoomAudio}
            disabled={!includeAudio}
            label="Isolar a voz da sala"
            description="Evita que seus amigos ouçam a própria voz na transmissão."
          />
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="flex items-center gap-1 text-xs text-accent-text hover:underline cursor-pointer"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            Avançado
          </button>
          {showAdvanced && (
            <Switch
              checked={simulcast && resolution === '1080p'}
              onChange={setSimulcast}
              disabled={resolution !== '1080p'}
              label="Camada leve para internet fraca"
              description={
                resolution === '1080p'
                  ? 'Envia também 720p a 30 FPS para quem tem banda baixa. Usa mais processador e upload.'
                  : 'Disponível só em 1080p.'
              }
            />
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-1 border-t border-line">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleStart} disabled={isDesktopApp && !selectedSourceId}>
          <ScreenShare className="w-4 h-4" />
          {isDesktopApp ? 'Transmitir' : 'Escolher tela'}
        </Button>
      </div>
    </Modal>
  );
};
