import React, { useState } from 'react';
import {
  Hash,
  Volume2,
  Plus,
  Trash2,
  LogOut,
  PhoneOff,
  ShieldCheck,
  ChevronDown,
  UserPlus,
  Check,
  Loader2,
} from 'lucide-react';
import type { Channel, VoiceParticipant } from '../types';
import { useAuth } from '../context/AuthContext';

interface ChannelSidebarProps {
  roomName: string;
  channels: Channel[];
  activeTextChannelId: string;
  activeVoiceChannelId: string;
  isVoiceConnected: boolean;
  connectingVoiceChannelId?: string | null;
  isOwner: boolean;
  voiceParticipants?: VoiceParticipant[];
  onSelectTextChannel: (channel: Channel) => void;
  onSelectVoiceChannel: (channel: Channel) => void;
  onDisconnectVoice: () => void;
  onOpenCreateChannel: () => void;
  onDeleteChannel: (channelId: string) => void;
  onLeaveRoom: () => void;
}

export const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  roomName,
  channels,
  activeTextChannelId,
  activeVoiceChannelId,
  isVoiceConnected,
  connectingVoiceChannelId = null,
  isOwner,
  voiceParticipants = [],
  onSelectTextChannel,
  onSelectVoiceChannel,
  onDisconnectVoice,
  onOpenCreateChannel,
  onDeleteChannel,
  onLeaveRoom,
}) => {
  const { profile } = useAuth();
  const [copiedInvite, setCopiedInvite] = useState(false);

  const handleCopyInvite = () => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?server=${encodeURIComponent(roomName)}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  };

  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  return (
    <aside className="w-56 sm:w-64 bg-[#0d0e15] border-r border-white/10 flex flex-col h-full select-none shrink-0 z-20">
      {/* Room Header */}
      <div className="h-14 border-b border-white/10 px-3 sm:px-4 flex items-center justify-between bg-[#11131c]/60 backdrop-blur-md">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-xs shrink-0">
            {roomName.charAt(0).toUpperCase()}
          </div>
          <span className="font-bold text-sm text-white truncate max-w-[100px] sm:max-w-[130px]">
            {roomName}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopyInvite}
            title={copiedInvite ? 'Link do Servidor Copiado!' : 'Convidar Pessoas para o Servidor'}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              copiedInvite
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
            }`}
          >
            {copiedInvite ? <Check className="w-4 h-4 text-emerald-400" /> : <UserPlus className="w-4 h-4" />}
          </button>

          {isOwner && (
            <button
              onClick={onOpenCreateChannel}
              title="Adicionar Canal"
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Channels List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4 scrollbar-thin scrollbar-thumb-gray-800">
        {/* Text Channels */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <ChevronDown className="w-3 h-3 text-gray-500" /> Canais de Texto
            </span>
            {isOwner && (
              <button
                onClick={onOpenCreateChannel}
                title="Novo Canal de Texto"
                className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-white/5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="space-y-0.5">
            {textChannels.map((channel) => {
              const isActive = channel.id === activeTextChannelId;
              return (
                <div
                  key={channel.id}
                  className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600/20 text-white font-semibold'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}
                  onClick={() => onSelectTextChannel(channel)}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Hash className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-indigo-400' : 'text-gray-500'}`} />
                    <span className="truncate">{channel.name}</span>
                  </div>

                  {isOwner && textChannels.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Deseja excluir o canal #${channel.name}?`)) {
                          onDeleteChannel(channel.id);
                        }
                      }}
                      title="Excluir Canal"
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Voice Channels */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <ChevronDown className="w-3 h-3 text-gray-500" /> Canais de Voz
            </span>
            {isOwner && (
              <button
                onClick={onOpenCreateChannel}
                title="Novo Canal de Voz"
                className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-white/5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="space-y-1">
            {voiceChannels.map((channel) => {
              const isCurrentVoice = channel.id === activeVoiceChannelId;
              const isConnecting = channel.id === connectingVoiceChannelId;
              return (
                <div key={channel.id} className="space-y-1">
                  <div
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                      isCurrentVoice && isVoiceConnected
                        ? 'bg-emerald-600/15 text-emerald-300 font-semibold'
                        : isConnecting
                        ? 'bg-amber-500/10 text-amber-300'
                        : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                    }`}
                    onClick={() => {
                      if (!isConnecting) {
                        onSelectVoiceChannel(channel);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {isConnecting ? (
                        <Loader2 className="w-3.5 h-3.5 shrink-0 text-amber-400 animate-spin" />
                      ) : (
                        <Volume2
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isCurrentVoice && isVoiceConnected ? 'text-emerald-400' : 'text-gray-500'
                          }`}
                        />
                      )}
                      <span className="truncate">{channel.name}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      {isConnecting && (
                        <span className="text-[10px] text-amber-400 font-normal">Conectando...</span>
                      )}
                      {isCurrentVoice && isVoiceConnected && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      )}

                      {isOwner && voiceChannels.length > 1 && !isConnecting && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Deseja excluir o canal 🔊 ${channel.name}?`)) {
                              onDeleteChannel(channel.id);
                            }
                          }}
                          title="Excluir Canal de Voz"
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Participantes conectados neste canal de voz específico */}
                  {(() => {
                    const channelUsers = voiceParticipants
                      .filter((p) => p.voiceChannelId === channel.id)
                      .sort((a, b) => {
                        const nameA = a.name || a.identity || '';
                        const nameB = b.name || b.identity || '';
                        const cmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
                        if (cmp !== 0) return cmp;
                        return (a.identity || '').localeCompare(b.identity || '');
                      });
                    if (channelUsers.length === 0) return null;

                    return (
                      <div className="pl-6 pr-2 space-y-1">
                        {channelUsers.map((p) => {
                          const isConnecting = Boolean(p.isConnecting);
                          return (
                            <div
                              key={p.identity}
                              className={`flex items-center gap-2 py-0.5 text-[11px] transition-all duration-300 ${
                                isConnecting ? 'opacity-60 text-gray-400' : 'opacity-100 text-gray-300'
                              }`}
                            >
                              <div
                                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                                  isConnecting
                                    ? 'bg-amber-400 animate-pulse'
                                    : p.isSpeaking
                                    ? 'bg-emerald-400 ring-2 ring-emerald-400/50'
                                    : 'bg-gray-600'
                                }`}
                              />
                              <span className="truncate">{p.name || p.identity}</span>
                              {isConnecting && (
                                <span className="text-[10px] text-amber-400/80 ml-auto italic">
                                  (conectando...)
                                </span>
                              )}
                              {!isConnecting && p.isMuted && (
                                <span className="text-[10px] text-rose-400 ml-auto">(mudo)</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Voice Status Card (se conectado na voz) */}
      {isVoiceConnected && (
        <div className="p-2.5 bg-emerald-500/10 border-t border-emerald-500/20 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                Voz Conectada
              </span>
              <span className="text-[11px] text-gray-300 truncate">
                {voiceChannels.find((c) => c.id === activeVoiceChannelId)?.name || 'Voz'}
              </span>
            </div>
          </div>

          <button
            onClick={onDisconnectVoice}
            title="Desconectar do canal de voz"
            className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition cursor-pointer shrink-0"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* User Footer Panel */}
      <div className="h-14 border-t border-white/10 px-3 bg-[#11131c] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.username}
              className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-indigo-600/30 text-indigo-300 font-bold text-xs flex items-center justify-center shrink-0">
              {profile?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
          )}
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold text-white truncate max-w-[100px]">
              {profile?.username || 'Convidado'}
            </span>
            <span className="text-[10px] text-gray-500 flex items-center gap-1">
              {isOwner ? (
                <span className="text-amber-400 font-medium flex items-center gap-0.5">
                  <ShieldCheck className="w-2.5 h-2.5" /> Dono
                </span>
              ) : (
                'Membro'
              )}
            </span>
          </div>
        </div>

        <button
          onClick={onLeaveRoom}
          title="Sair da Sala"
          className="p-1.5 text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
