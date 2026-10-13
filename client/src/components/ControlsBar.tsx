import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Check,
  Headphones,
  HeadphoneOff,
  MessageSquare,
  Mic,
  MicOff,
  MoreHorizontal,
  PhoneOff,
  ScreenShare,
  SlidersHorizontal,
  StopCircle,
  Tv,
  Wand2,
} from 'lucide-react';
import { OBS_ENABLED, getObsSrtUrl } from '../utils/api';

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
  /** Mostrado no layout Palco, onde não há a lateral com o botão de sair da voz. */
  onLeaveVoice?: () => void;
}

const iconButton =
  'w-10 h-10 rounded-xl flex items-center justify-center transition cursor-pointer border border-transparent';
const neutral = 'bg-surface-2 text-gray-100 hover:border-line';
const muted = 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25';

/** Barra flutuante da chamada: voz, transmissão, mais opções e chat. */
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
  onLeaveVoice,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [copiedObs, setCopiedObs] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isMenuOpen]);

  const handleCopyObsLink = () => {
    navigator.clipboard.writeText(getObsSrtUrl(roomName, userName));
    setCopiedObs(true);
    setTimeout(() => setCopiedObs(false), 2000);
  };

  const menuItem = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left hover:bg-white/5 transition cursor-pointer';

  return (
    <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-surface border border-line shadow-xl select-none">
      <button
        type="button"
        onClick={onToggleMic}
        title={isMicEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
        aria-label={isMicEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
        aria-pressed={!isMicEnabled}
        className={`${iconButton} ${isMicEnabled ? neutral : muted}`}
      >
        {isMicEnabled ? <Mic className="w-[18px] h-[18px]" /> : <MicOff className="w-[18px] h-[18px]" />}
      </button>

      <button
        type="button"
        onClick={onToggleDeafen}
        title={isDeafened ? 'Voltar a ouvir' : 'Parar de ouvir'}
        aria-label={isDeafened ? 'Voltar a ouvir' : 'Parar de ouvir'}
        aria-pressed={isDeafened}
        className={`${iconButton} ${isDeafened ? muted : neutral}`}
      >
        {isDeafened ? <HeadphoneOff className="w-[18px] h-[18px]" /> : <Headphones className="w-[18px] h-[18px]" />}
      </button>

      <button
        type="button"
        onClick={isScreenSharing ? onToggleScreenShare : onOpenScreenShareConfig}
        title={isScreenSharing ? 'Parar transmissão' : 'Transmitir tela'}
        className={`h-10 px-3.5 rounded-xl flex items-center gap-2 text-sm font-semibold transition cursor-pointer ${
          isScreenSharing ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-accent text-on-accent hover:brightness-105'
        }`}
      >
        {isScreenSharing ? <StopCircle className="w-[18px] h-[18px]" /> : <ScreenShare className="w-[18px] h-[18px]" />}
        <span className="hidden sm:inline">{isScreenSharing ? 'Parar' : 'Transmitir'}</span>
      </button>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          title="Mais opções"
          aria-label="Mais opções"
          aria-expanded={isMenuOpen}
          className={`${iconButton} ${neutral}`}
        >
          <MoreHorizontal className="w-[18px] h-[18px]" />
        </button>
        {isMenuOpen && (
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-60 p-1.5 rounded-xl bg-surface border border-line shadow-2xl text-gray-100">
            {onToggleNoiseSuppression && (
              <button type="button" onClick={onToggleNoiseSuppression} className={menuItem}>
                <Wand2 className="w-4 h-4 text-gray-400" />
                <span className="flex-1">Supressão de ruído</span>
                <span className={`text-xs ${isNoiseSuppressionEnabled ? 'text-accent-text' : 'text-gray-500'}`}>
                  {isNoiseSuppressionEnabled ? 'Ligada' : 'Desligada'}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onToggleHUD();
                setIsMenuOpen(false);
              }}
              className={menuItem}
            >
              <Activity className="w-4 h-4 text-gray-400" />
              <span className="flex-1">Estatísticas da transmissão</span>
              {isHUDOpen && <Check className="w-4 h-4 text-accent-text" />}
            </button>
            {!isScreenSharing && (
              <button
                type="button"
                onClick={() => {
                  onOpenScreenShareConfig();
                  setIsMenuOpen(false);
                }}
                className={menuItem}
              >
                <SlidersHorizontal className="w-4 h-4 text-gray-400" />
                <span className="flex-1">Qualidade da transmissão</span>
              </button>
            )}
            {OBS_ENABLED && (
              <button type="button" onClick={handleCopyObsLink} className={menuItem}>
                {copiedObs ? <Check className="w-4 h-4 text-emerald-400" /> : <Tv className="w-4 h-4 text-gray-400" />}
                <span className="flex-1">{copiedObs ? 'Link copiado' : 'Copiar link do OBS'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <span className="w-px h-6 bg-line mx-0.5" aria-hidden="true" />

      <button
        type="button"
        onClick={onToggleChat}
        title={isChatOpen ? 'Fechar chat' : 'Abrir chat'}
        aria-label={isChatOpen ? 'Fechar chat' : 'Abrir chat'}
        aria-pressed={isChatOpen}
        className={`${iconButton} relative ${isChatOpen ? 'bg-accent/15 text-accent-text' : neutral}`}
      >
        <MessageSquare className="w-[18px] h-[18px]" />
        {!isChatOpen && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-on-accent text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {onLeaveVoice && (
        <button
          type="button"
          onClick={onLeaveVoice}
          title="Sair da voz"
          aria-label="Sair da voz"
          className={`${iconButton} bg-rose-500/15 text-rose-400 hover:bg-rose-500 hover:text-white`}
        >
          <PhoneOff className="w-[18px] h-[18px]" />
        </button>
      )}
    </div>
  );
};
