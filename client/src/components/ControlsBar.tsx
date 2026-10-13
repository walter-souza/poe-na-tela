import React, { useState } from 'react';
import {
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  ScreenShare,
  StopCircle,
  MessageSquare,
  Sliders,
  Layers,
  Wand2,
  Tv,
  Check,
} from 'lucide-react';
import { OBS_ENABLED, getObsSrtUrl } from '../utils/api';
import { ThemeToggle } from './ThemeToggle';

interface ControlsBarProps {
  isMicEnabled: boolean;
  isDeafened: boolean;
  isNoiseSuppressionEnabled?: boolean;
  isScreenSharing: boolean;
  isChatOpen: boolean;
  isHUDOpen: boolean;
  roomName: string;
  userName?: string;
  unreadCount?: number;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onToggleNoiseSuppression?: () => void;
  onToggleScreenShare: () => void;
  onOpenScreenShareConfig: () => void;
  onToggleChat: () => void;
  onToggleHUD: () => void;
}

export const ControlsBar: React.FC<ControlsBarProps> = ({
  isMicEnabled,
  isDeafened,
  isNoiseSuppressionEnabled,
  isScreenSharing,
  isChatOpen,
  isHUDOpen,
  roomName,
  userName,
  unreadCount = 0,
  onToggleMic,
  onToggleDeafen,
  onToggleNoiseSuppression,
  onToggleScreenShare,
  onOpenScreenShareConfig,
  onToggleChat,
  onToggleHUD,
}) => {
  const [copiedObs, setCopiedObs] = useState(false);

  const handleCopyObsLink = () => {
    const obsUrl = getObsSrtUrl(roomName, userName);
    navigator.clipboard.writeText(obsUrl);
    setCopiedObs(true);
    setTimeout(() => setCopiedObs(false), 2000);
  };

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-2xl bg-surface/90 border border-white/15 text-white shadow-2xl backdrop-blur-xl select-none">
      {/* Microfone */}
      <button
        onClick={onToggleMic}
        title={isMicEnabled ? 'Microfone Ativo (Silenciar)' : 'Microfone Mudo (Ativar)'}
        className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl font-medium text-xs transition cursor-pointer ${
          isMicEnabled
            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/30'
            : 'bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300'
        }`}
      >
        {isMicEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        <span className="hidden md:inline">{isMicEnabled ? 'Mic' : 'Mudo'}</span>
      </button>

      {/* Ensordecer (Áudio) */}
      <button
        onClick={onToggleDeafen}
        title={isDeafened ? 'Áudio Desativado (Ensordecido)' : 'Áudio Ativo'}
        className={`p-2 rounded-xl border transition cursor-pointer ${
          isDeafened
            ? 'bg-rose-600/20 border-rose-500/30 text-rose-300'
            : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 hover:text-white'
        }`}
      >
        {isDeafened ? <HeadphoneOff className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
      </button>

      {/* Supressão de Ruído por IA */}
      {onToggleNoiseSuppression && (
        <button
          onClick={onToggleNoiseSuppression}
          title={
            isNoiseSuppressionEnabled
              ? 'Supressão de Ruído por IA Ativa'
              : 'Supressão de Ruído Desativada'
          }
          className={`flex items-center gap-1.5 p-2 sm:px-2.5 sm:py-2 rounded-xl border transition cursor-pointer ${
            isNoiseSuppressionEnabled
              ? 'bg-violet-600/30 border-violet-500/50 text-violet-300 hover:bg-violet-600/40'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-400 hover:text-gray-200'
          }`}
        >
          <Wand2 className="w-4 h-4" />
          <span className="hidden lg:inline text-[11px] font-medium">
            {isNoiseSuppressionEnabled ? 'IA Ruído' : 'Sem IA'}
          </span>
        </button>
      )}

      {/* Divisor */}
      <div className="h-5 w-[1px] bg-white/10 mx-0.5 hidden xs:block" />

      {/* Compartilhar / Parar Tela */}
      <div className="flex items-center bg-indigo-600/20 border border-indigo-500/30 rounded-xl p-0.5">
        <button
          onClick={isScreenSharing ? onToggleScreenShare : onOpenScreenShareConfig}
          title={isScreenSharing ? 'Parar Transmissão' : 'Transmitir Tela'}
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg font-semibold text-xs transition cursor-pointer ${
            isScreenSharing
              ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm shadow-rose-600/30'
              : 'bg-indigo-600 hover:bg-indigo-500 text-on-accent shadow-sm shadow-indigo-600/30'
          }`}
        >
          {isScreenSharing ? <StopCircle className="w-4 h-4" /> : <ScreenShare className="w-4 h-4" />}
          <span className="hidden sm:inline">
            {isScreenSharing ? 'Parar Tela' : 'Transmitir Tela'}
          </span>
        </button>

        {!isScreenSharing && (
          <button
            onClick={onOpenScreenShareConfig}
            title="Configurar Qualidade (FPS, Bitrate, Resolução)"
            className="p-1.5 hover:bg-white/10 rounded-lg text-indigo-300 hover:text-white transition cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Link OBS Studio (SRT) — desligado por padrão (VITE_ENABLE_OBS) */}
      {OBS_ENABLED && (
        <button
          onClick={handleCopyObsLink}
          title="Copiar Link de Transmissão para OBS Studio (SRT 60 FPS)"
          className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-semibold transition cursor-pointer ${
            copiedObs
              ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 hover:text-white'
          }`}
        >
          {copiedObs ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Tv className="w-4 h-4 text-purple-400" />
          )}
          <span className="hidden md:inline">
            {copiedObs ? 'Link Copiado!' : 'Link OBS'}
          </span>
        </button>
      )}

      {/* Divisor */}
      <div className="h-5 w-[1px] bg-white/10 mx-0.5" />

      <ThemeToggle />

      {/* Toggle HUD Estatísticas */}
      <button
        onClick={onToggleHUD}
        title="Painel de Estatísticas Técnicas"
        className={`p-2 rounded-xl border transition cursor-pointer ${
          isHUDOpen
            ? 'bg-indigo-600 border-indigo-500 text-on-accent'
            : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 hover:text-white'
        }`}
      >
        <Layers className="w-4 h-4" />
      </button>

      {/* Toggle Chat */}
      <button
        onClick={onToggleChat}
        title={isChatOpen ? 'Ocultar Chat' : 'Exibir Chat'}
        className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl border text-xs font-semibold transition cursor-pointer relative ${
          isChatOpen
            ? 'bg-indigo-600 border-indigo-500 text-on-accent shadow-sm shadow-indigo-600/30'
            : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 hover:text-white'
        }`}
      >
        <MessageSquare className="w-4 h-4" />
        <span className="hidden sm:inline">{isChatOpen ? 'Ocultar Chat' : 'Chat'}</span>
        {!isChatOpen && unreadCount > 0 && (
          <span className="bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full">
            {unreadCount}
          </span>
        )}
      </button>
    </div>
  );
};
