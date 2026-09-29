import React from 'react';
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
} from 'lucide-react';

interface ControlsBarProps {
  isMicEnabled: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  isChatOpen: boolean;
  isHUDOpen: boolean;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onOpenScreenShareConfig: () => void;
  onToggleChat: () => void;
  onToggleHUD: () => void;
  onLeave: () => void;
}

export const ControlsBar: React.FC<ControlsBarProps> = ({
  isMicEnabled,
  isDeafened,
  isScreenSharing,
  isChatOpen,
  isHUDOpen,
  onToggleMic,
  onToggleDeafen,
  onToggleScreenShare,
  onOpenScreenShareConfig,
  onToggleChat,
  onToggleHUD,
  onLeave,
}) => {
  return (
    <div className="h-20 bg-[#0d0f17] border-t border-white/10 px-6 flex items-center justify-between shadow-2xl select-none">
      {/* Left Info / App branding */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <div className="font-bold text-sm text-white flex items-center gap-1.5">
            <span>StreamPulse</span>
            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 font-semibold px-1.5 py-0.2 rounded border border-indigo-500/30">
              60 FPS
            </span>
          </div>
          <div className="text-[11px] text-gray-400">WebRTC Ultra-Low Latency</div>
        </div>
      </div>

      {/* Center Main Stream Actions */}
      <div className="flex items-center gap-3">
        {/* Microfone */}
        <button
          onClick={onToggleMic}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-medium text-xs transition shadow-lg ${
            isMicEnabled
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
              : 'bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300'
          }`}
        >
          {isMicEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          <span>{isMicEnabled ? 'Microfone Ativo' : 'Microfone Mudo'}</span>
        </button>

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
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-xs transition ${
              isScreenSharing
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30'
            }`}
          >
            {isScreenSharing ? <StopCircle className="w-4 h-4" /> : <ScreenShare className="w-4 h-4" />}
            <span>{isScreenSharing ? 'Parar Transmissão' : 'Transmitir Tela'}</span>
          </button>

          {!isScreenSharing && (
            <button
              onClick={onOpenScreenShareConfig}
              title="Configurar Qualidade (FPS, Bitrate, Resolução)"
              className="p-2 hover:bg-white/10 rounded-xl text-indigo-300 hover:text-white transition"
            >
              <Sliders className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2">
        {/* Toggle HUD */}
        <button
          onClick={onToggleHUD}
          title="Painel de Estatísticas Técnicas"
          className={`p-2.5 rounded-2xl border transition ${
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
          title="Alternar Chat / Participantes"
          className={`p-2.5 rounded-2xl border transition ${
            isChatOpen
              ? 'bg-indigo-600 border-indigo-500 text-white'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 hover:text-white'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
        </button>

        {/* Leave Room */}
        <button
          onClick={onLeave}
          title="Sair da Sala"
          className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-rose-600/10 hover:bg-rose-600 border border-rose-500/20 hover:border-rose-500 text-rose-300 hover:text-white font-semibold text-xs transition"
        >
          <PhoneOff className="w-4 h-4" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </div>
    </div>
  );
};
