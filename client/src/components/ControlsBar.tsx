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
  Sparkles,
  Share2,
  Check,
  Wand2,
} from 'lucide-react';

interface ControlsBarProps {
  isMicEnabled: boolean;
  isDeafened: boolean;
  isNoiseSuppressionEnabled?: boolean;
  isScreenSharing: boolean;
  isChatOpen: boolean;
  isHUDOpen: boolean;
  roomName: string;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onToggleNoiseSuppression?: () => void;
  onToggleScreenShare: () => void;
  onOpenScreenShareConfig: () => void;
  onToggleChat: () => void;
  onToggleHUD: () => void;
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
  onToggleMic,
  onToggleDeafen,
  onToggleNoiseSuppression,
  onToggleScreenShare,
  onOpenScreenShareConfig,
  onToggleChat,
  onToggleHUD,
  onLeave,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyInvite = () => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomName)}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="h-16 md:h-20 bg-[#0d0f17] border-t border-white/10 px-2 sm:px-4 md:px-6 flex items-center justify-between shadow-2xl select-none safe-area-bottom">
      {/* Left Info / App branding (Visible on tablet/desktop) */}
      <div className="hidden md:flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <div className="font-bold text-sm text-white flex items-center gap-1.5">
            <span>Põe na Tela</span>
            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 font-semibold px-2 py-0.5 rounded-md border border-indigo-500/30">
              Ultra-Baixa Latência
            </span>
          </div>
          <div className="text-[11px] text-gray-400">Streaming em tempo real com amigos</div>
        </div>
      </div>

      {/* Center Main Stream Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3">
        {/* Microfone */}
        <button
          onClick={onToggleMic}
          title={isMicEnabled ? 'Microfone Ativo' : 'Microfone Mudo'}
          className={`flex items-center gap-2 p-2.5 sm:px-4 sm:py-2.5 rounded-2xl font-medium text-xs transition shadow-lg ${
            isMicEnabled
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
              : 'bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300'
          }`}
        >
          {isMicEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          <span className="hidden md:inline">{isMicEnabled ? 'Microfone Ativo' : 'Microfone Mudo'}</span>
        </button>

        {/* Supressão de Ruído (IA RNNoise) */}
        {onToggleNoiseSuppression && (
          <button
            onClick={onToggleNoiseSuppression}
            title={
              isNoiseSuppressionEnabled
                ? 'Supressão de Ruído por IA Ativa (Elimina teclas mecânicas e cliques)'
                : 'Supressão de Ruído Desativada'
            }
            className={`flex items-center gap-1.5 p-2.5 sm:px-3 sm:py-2.5 rounded-2xl border transition shadow-lg ${
              isNoiseSuppressionEnabled
                ? 'bg-violet-600/30 border-violet-500/50 text-violet-300 hover:bg-violet-600/40 shadow-violet-600/20'
                : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Wand2 className="w-4 h-4" />
            <span className="hidden xl:inline text-xs font-medium">
              {isNoiseSuppressionEnabled ? 'IA Ruído' : 'Sem IA'}
            </span>
          </button>
        )}

        {/* Deafen (Áudio) */}
        <button
          onClick={onToggleDeafen}
          className={`p-2.5 rounded-2xl border transition ${
            isDeafened
              ? 'bg-rose-600/20 border-rose-500/30 text-rose-300'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 hover:text-white'
          }`}
          title={isDeafened ? 'Áudio Desativado (Ensordecer)' : 'Áudio Ativo'}
        >
          {isDeafened ? <HeadphoneOff className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
        </button>

        {/* Compartilhar / Parar Tela */}
        <div className="flex items-center bg-indigo-600/20 border border-indigo-500/30 rounded-2xl p-0.5">
          <button
            onClick={isScreenSharing ? onToggleScreenShare : onOpenScreenShareConfig}
            title={isScreenSharing ? 'Parar Transmissão' : 'Transmitir Tela'}
            className={`flex items-center gap-1.5 sm:gap-2 p-2 sm:px-4 sm:py-2 rounded-xl font-semibold text-xs transition ${
              isScreenSharing
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30'
            }`}
          >
            {isScreenSharing ? <StopCircle className="w-4 h-4" /> : <ScreenShare className="w-4 h-4" />}
            <span className="hidden md:inline">{isScreenSharing ? 'Parar Transmissão' : 'Transmitir Tela'}</span>
          </button>

          {!isScreenSharing && (
            <button
              onClick={onOpenScreenShareConfig}
              title="Configurar Qualidade (FPS, Bitrate, Resolução)"
              className="p-1.5 sm:p-2 hover:bg-white/10 rounded-xl text-indigo-300 hover:text-white transition"
            >
              <Sliders className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Convidar Amigos */}
        <button
          onClick={handleCopyInvite}
          title="Copiar Link de Convite da Sala"
          className="flex items-center gap-1.5 p-2 sm:px-3 sm:py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 hover:text-white transition"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4 text-indigo-400" />}
          <span className="hidden sm:inline font-medium">{copied ? 'Copiado!' : 'Convidar'}</span>
        </button>

        {/* Toggle HUD */}
        <button
          onClick={onToggleHUD}
          title="Painel de Estatísticas Técnicas"
          className={`p-2 sm:p-2.5 rounded-2xl border transition ${
            isHUDOpen
              ? 'bg-indigo-600 border-indigo-500 text-white'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 hover:text-white'
          }`}
        >
          <Layers className="w-4 h-4" />
        </button>

        {/* Toggle Chat */}
        <button
          onClick={onToggleChat}
          title={isChatOpen ? 'Ocultar Chat' : 'Exibir Chat'}
          className={`flex items-center gap-1.5 sm:gap-2 p-2 sm:px-3.5 sm:py-2.5 rounded-2xl border text-xs font-semibold transition ${
            isChatOpen
              ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 hover:text-white'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span className="hidden md:inline">{isChatOpen ? 'Ocultar Chat' : 'Exibir Chat'}</span>
        </button>

        {/* Leave Room */}
        <button
          onClick={onLeave}
          title="Sair da Sala"
          className="flex items-center gap-1.5 sm:gap-2 p-2 sm:px-3.5 sm:py-2.5 rounded-2xl bg-rose-600/10 hover:bg-rose-600 border border-rose-500/20 hover:border-rose-500 text-rose-300 hover:text-white font-semibold text-xs transition"
        >
          <PhoneOff className="w-4 h-4" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </div>
    </div>
  );
};
