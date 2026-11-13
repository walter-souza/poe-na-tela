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
  PhoneOff,
  Layers,
  Share2,
  Check,
  Wand2,
  Tv,
  HelpCircle,
  Keyboard,
  Clapperboard,
} from 'lucide-react';
import type { ClipStatus } from '../hooks/useClip';
import { getObsSrtUrl } from '../utils/api';
import { ObsGuideModal } from './ObsGuideModal';
import { Logo } from './Logo';

interface ControlsBarProps {
  isMicEnabled: boolean;
  isDeafened: boolean;
  isNoiseSuppressionEnabled?: boolean;
  isScreenSharing: boolean;
  isChatOpen: boolean;
  isHUDOpen: boolean;
  roomName: string;
  userName?: string;
  /** Senha SRT do participante, embutida no link do OBS. */
  streamKey: string;
  onToggleMic: () => void;
  /** Só existe no app desktop (atalho global de microfone). */
  onOpenHotkeySettings?: () => void;
  onToggleDeafen: () => void;
  onToggleNoiseSuppression?: () => void;
  onToggleScreenShare: () => void;
  onOpenScreenShareConfig: () => void;
  onToggleChat: () => void;
  onToggleHUD: () => void;
  onClip: () => void;
  clipStatus: ClipStatus;
  /** Configuração da sala: ligada vale para todos os participantes. */
  clipEnabled: boolean;
  onToggleClip: () => void;
  /** Aviso temporário sobre a configuração do clipe (mudança ou erro). */
  clipNotice: string | null;
  onLeave: () => void;
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
  streamKey,
  onToggleMic,
  onOpenHotkeySettings,
  onToggleDeafen,
  onToggleNoiseSuppression,
  onToggleScreenShare,
  onOpenScreenShareConfig,
  onToggleChat,
  onToggleHUD,
  onClip,
  clipStatus,
  clipEnabled,
  onToggleClip,
  clipNotice,
  onLeave,
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedObs, setCopiedObs] = useState(false);
  const [isObsGuideOpen, setIsObsGuideOpen] = useState(false);

  const handleCopyInvite = () => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomName)}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyObsLink = () => {
    const obsUrl = getObsSrtUrl(roomName, userName, streamKey);
    navigator.clipboard.writeText(obsUrl);
    setCopiedObs(true);
    setTimeout(() => setCopiedObs(false), 2000);
  };
  const iconBtn =
    'grid place-items-center w-10 h-10 shrink-0 rounded-full text-gray-200 transition duration-200 hover:bg-white/10 hover:-translate-y-0.5 active:scale-95 disabled:cursor-wait';
  const on = 'bg-indigo-400 text-[#05201c] hover:bg-indigo-300';
  const alert = 'bg-live/15 text-live hover:bg-live/25';
  const sep = <span className="w-px h-5 bg-[#413e36] mx-1 shrink-0" aria-hidden="true" />;

  return (
    <div className="relative bg-[#100f0d] border-t border-[#2c2a25] px-2 sm:px-4 md:px-6 py-2.5 flex items-center justify-between gap-3 select-none safe-area-bottom">
      {clipNotice && (
        <div
          role="status"
          className="absolute bottom-full right-2 sm:right-4 mb-2 max-w-sm rounded-xl border border-rose-500/40 bg-[#1a0d12]/95 px-3 py-2 text-xs text-rose-100 shadow-xl"
        >
          {clipNotice}
        </div>
      )}

      {/* Marca (tablet/desktop) */}
      <div className="hidden lg:flex flex-1 items-center min-w-0">
        <Logo className="!text-base" />
      </div>

      {/* Barra de controles */}
      <div className="flex items-center gap-0.5 p-1.5 rounded-full bg-[#171613] border border-[#2c2a25] overflow-x-auto max-w-full no-scrollbar">
        <button
          onClick={onToggleMic}
          title={isMicEnabled ? 'Microfone ativo' : 'Microfone mudo'}
          aria-pressed={isMicEnabled}
          aria-label={isMicEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
          className={`${iconBtn} ${isMicEnabled ? on : alert}`}
        >
          {isMicEnabled ? <Mic className="w-[18px] h-[18px]" /> : <MicOff className="w-[18px] h-[18px]" />}
        </button>

        <button
          onClick={onToggleDeafen}
          title={isDeafened ? 'Áudio desativado (ensurdecido)' : 'Áudio ativo'}
          aria-pressed={isDeafened}
          aria-label={isDeafened ? 'Reativar áudio' : 'Desativar áudio'}
          className={`${iconBtn} ${isDeafened ? alert : ''}`}
        >
          {isDeafened ? <HeadphoneOff className="w-[18px] h-[18px]" /> : <Headphones className="w-[18px] h-[18px]" />}
        </button>

        {onToggleNoiseSuppression && (
          <button
            onClick={onToggleNoiseSuppression}
            title={
              isNoiseSuppressionEnabled
                ? 'Supressão de ruído por IA ativa (elimina teclas mecânicas e cliques)'
                : 'Supressão de ruído desativada'
            }
            aria-pressed={Boolean(isNoiseSuppressionEnabled)}
            aria-label="Supressão de ruído"
            className={`${iconBtn} ${isNoiseSuppressionEnabled ? on : ''}`}
          >
            <Wand2 className="w-[18px] h-[18px]" />
          </button>
        )}

        {onOpenHotkeySettings && (
          <button
            onClick={onOpenHotkeySettings}
            title="Atalhos globais de microfone e áudio (funcionam com o jogo em foco)"
            aria-label="Atalhos globais"
            className={`${iconBtn} text-gray-400 hover:text-gray-100`}
          >
            <Keyboard className="w-[18px] h-[18px]" />
          </button>
        )}

        {sep}

        {/* Transmitir / parar tela */}
        <button
          onClick={isScreenSharing ? onToggleScreenShare : onOpenScreenShareConfig}
          title={isScreenSharing ? 'Parar transmissão' : 'Transmitir tela'}
          className={`inline-flex items-center gap-2 h-10 shrink-0 rounded-full px-3 md:px-4 text-sm font-semibold transition duration-200 hover:-translate-y-0.5 active:scale-95 ${
            isScreenSharing ? 'bg-live text-[#1c0903] hover:bg-[#ff7050]' : 'bg-sand text-[#17130a] hover:bg-[#f0e5c6]'
          }`}
        >
          {isScreenSharing ? <StopCircle className="w-[18px] h-[18px]" /> : <ScreenShare className="w-[18px] h-[18px]" />}
          <span className="hidden md:inline">{isScreenSharing ? 'Parar' : 'Transmitir'}</span>
        </button>

        {!isScreenSharing && (
          <button
            onClick={onOpenScreenShareConfig}
            title="Configurar qualidade (FPS, bitrate, resolução)"
            aria-label="Configurar qualidade da transmissão"
            className={`${iconBtn} text-gray-400 hover:text-gray-100`}
          >
            <Sliders className="w-[18px] h-[18px]" />
          </button>
        )}

        <button
          onClick={handleCopyObsLink}
          title="Copiar link de transmissão para o OBS Studio (SRT 60 FPS com sala e usuário configurados)"
          aria-label="Copiar link do OBS"
          className={`${iconBtn} ${copiedObs ? on : ''}`}
        >
          {copiedObs ? <Check className="w-[18px] h-[18px]" /> : <Tv className="w-[18px] h-[18px]" />}
        </button>

        <button
          onClick={() => setIsObsGuideOpen(true)}
          title="Guia: como transmitir com o OBS em 60 FPS"
          aria-label="Guia do OBS"
          className={`${iconBtn} text-gray-400 hover:text-gray-100`}
        >
          <HelpCircle className="w-[18px] h-[18px]" />
        </button>

        {sep}

        {/* Clipe: configuração da sala (vale para todos). Qualquer participante liga/desliga. */}
        <button
          onClick={onToggleClip}
          aria-pressed={clipEnabled}
          aria-label={clipEnabled ? 'Desligar clipe' : 'Ligar clipe'}
          title={
            clipEnabled
              ? `Clipe LIGADO na sala: as vozes de todos ficam num buffer de memória de 60s no servidor (nada vai para disco) e o vídeo da stream fica só em cada dispositivo. Clique para desligar (o buffer é descartado).`
              : `Clipe desligado: nada é gravado. Clique para ligar para todos na sala.`
          }
          className={`${iconBtn} relative ${clipEnabled ? 'text-gray-100' : 'text-gray-500 hover:text-gray-200'}`}
        >
          <Clapperboard className="w-[18px] h-[18px]" />
          <span
            className={`absolute right-2 top-2 w-1.5 h-1.5 rounded-full ${clipEnabled ? 'bg-emerald-400' : 'bg-gray-600'}`}
          />
        </button>

        {clipEnabled && (
          <button
            onClick={onClip}
            disabled={clipStatus === 'processing'}
            title="Clipar os últimos 30s (stream em destaque + vozes da sala) e ver antes de baixar"
            className={`inline-flex items-center gap-2 h-10 shrink-0 rounded-full px-3 text-sm font-medium transition duration-200 hover:-translate-y-0.5 disabled:cursor-wait ${
              clipStatus === 'local'
                ? 'bg-emerald-400/20 text-emerald-300'
                : clipStatus === 'empty'
                  ? 'bg-amber-400/15 text-amber-300'
                  : 'text-gray-200 hover:bg-white/10'
            }`}
          >
            {clipStatus === 'local' ? (
              <Check className="w-[18px] h-[18px]" />
            ) : (
              <Clapperboard className={`w-[18px] h-[18px] ${clipStatus === 'processing' ? 'animate-pulse' : ''}`} />
            )}
            <span className="hidden xl:inline">
              {clipStatus === 'processing'
                ? 'Montando…'
                : clipStatus === 'local'
                  ? 'Salvo sem vozes'
                  : clipStatus === 'empty'
                    ? 'Nada para clipar'
                    : 'Clipar'}
            </span>
          </button>
        )}

        {sep}

        <button
          onClick={handleCopyInvite}
          title="Copiar link de convite da sala"
          aria-label="Copiar link de convite"
          className={`${iconBtn} lg:hidden ${copied ? on : ''}`}
        >
          {copied ? <Check className="w-[18px] h-[18px]" /> : <Share2 className="w-[18px] h-[18px]" />}
        </button>

        <button
          onClick={onToggleHUD}
          title="Painel de estatísticas técnicas"
          aria-pressed={isHUDOpen}
          aria-label="Estatísticas técnicas"
          className={`${iconBtn} ${isHUDOpen ? on : ''}`}
        >
          <Layers className="w-[18px] h-[18px]" />
        </button>

        <button
          onClick={onToggleChat}
          title={isChatOpen ? 'Ocultar chat' : 'Exibir chat'}
          aria-pressed={isChatOpen}
          aria-label={isChatOpen ? 'Ocultar chat' : 'Exibir chat'}
          className={`${iconBtn} ${isChatOpen ? on : ''}`}
        >
          <MessageSquare className="w-[18px] h-[18px]" />
        </button>

        <button
          onClick={onLeave}
          title="Sair da sala"
          className="ml-1 inline-flex items-center gap-2 h-10 shrink-0 rounded-full px-3 md:px-4 text-sm font-semibold bg-live text-[#1c0903] hover:bg-[#ff7050] transition duration-200 hover:-translate-y-0.5 active:scale-95"
        >
          <PhoneOff className="w-[18px] h-[18px]" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </div>

      {/* Convidar */}
      <div className="hidden lg:flex flex-1 justify-end">
        <button
          onClick={handleCopyInvite}
          title="Copiar link de convite da sala"
          className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full border border-[#2c2a25] bg-[#171613] text-sm text-gray-300 hover:text-gray-100 hover:border-[#413e36] transition hover:-translate-y-0.5"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
          {copied ? 'Copiado!' : 'Convidar'}
        </button>
      </div>

      <ObsGuideModal
        isOpen={isObsGuideOpen}
        onClose={() => setIsObsGuideOpen(false)}
        obsUrl={getObsSrtUrl(roomName, userName, streamKey)}
      />
    </div>
  );
};
