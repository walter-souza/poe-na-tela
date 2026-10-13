import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Hash, Home, Plus, Volume2 } from 'lucide-react';
import type { Channel, VoiceParticipant } from '../types';

interface RoomSwitcherProps {
  roomName: string;
  channels: Channel[];
  activeView: 'chat' | 'stage';
  activeTextChannelId: string;
  activeVoiceChannelId: string;
  isVoiceConnected: boolean;
  voiceParticipants: VoiceParticipant[];
  isOwner: boolean;
  onSelectTextChannel: (channel: Channel) => void;
  onSelectVoiceChannel: (channel: Channel) => void;
  onOpenCreateChannel: () => void;
  onLeaveRoom: () => void;
}

/**
 * Layout Palco: no lugar da lateral de canais, uma pílula no topo ("servidor / canal") que abre
 * a lista de canais de texto e voz, com quem está em cada canal de voz.
 */
export const RoomSwitcher: React.FC<RoomSwitcherProps> = ({
  roomName,
  channels,
  activeView,
  activeTextChannelId,
  activeVoiceChannelId,
  isVoiceConnected,
  voiceParticipants,
  isOwner,
  onSelectTextChannel,
  onSelectVoiceChannel,
  onOpenCreateChannel,
  onLeaveRoom,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');
  const current =
    activeView === 'chat'
      ? channels.find((c) => c.id === activeTextChannelId)
      : channels.find((c) => c.id === activeVoiceChannelId);
  const currentLabel = current ? `${current.type === 'text' ? '#' : ''}${current.name}` : 'Escolha um canal';

  const pick = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  const item = (active: boolean) =>
    `w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-left transition cursor-pointer ${
      active ? 'bg-accent/15 text-accent-text' : 'text-gray-300 hover:bg-white/5 hover:text-gray-100'
    }`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 max-w-[70vw] bg-surface border border-line rounded-full pl-3.5 pr-2.5 py-1.5 text-sm shadow-lg hover:border-gray-600 transition cursor-pointer"
      >
        <span className="font-semibold truncate">{roomName}</span>
        <span className="text-gray-500">/</span>
        <span className="text-gray-400 truncate">{currentLabel}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute top-11 left-0 w-72 max-h-[70vh] overflow-y-auto p-2 rounded-xl bg-surface border border-line shadow-2xl text-gray-100 z-40"
        >
          <p className="px-2.5 pt-1 pb-1.5 text-xs font-medium text-gray-500">Texto</p>
          {textChannels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              role="menuitem"
              onClick={() => pick(() => onSelectTextChannel(channel))}
              className={item(activeView === 'chat' && channel.id === activeTextChannelId)}
            >
              <Hash className="w-4 h-4 shrink-0" />
              <span className="truncate">{channel.name}</span>
            </button>
          ))}

          <p className="px-2.5 pt-3 pb-1.5 text-xs font-medium text-gray-500">Voz</p>
          {voiceChannels.map((channel) => {
            const people = voiceParticipants.filter((p) => p.voiceChannelId === channel.id);
            const isHere = isVoiceConnected && channel.id === activeVoiceChannelId;
            return (
              <div key={channel.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => pick(() => onSelectVoiceChannel(channel))}
                  className={item(isHere)}
                >
                  <Volume2 className="w-4 h-4 shrink-0" />
                  <span className="truncate flex-1">{channel.name}</span>
                  {people.length > 0 && <span className="text-xs text-gray-500">{people.length}</span>}
                </button>
                {people.length > 0 && (
                  <ul className="pl-8 pr-2 pb-1">
                    {people.map((p) => (
                      <li key={p.identity} className="flex items-center gap-2 py-0.5 text-xs text-gray-400">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${p.isSpeaking ? 'bg-emerald-500' : 'bg-gray-600'}`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{p.name || p.identity}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          <div className="border-t border-line mt-2 pt-2 space-y-0.5">
            {isOwner && (
              <button type="button" role="menuitem" onClick={() => pick(onOpenCreateChannel)} className={item(false)}>
                <Plus className="w-4 h-4" />
                Criar canal
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => pick(onLeaveRoom)}
              className={item(false)}
            >
              <Home className="w-4 h-4" />
              Voltar ao início
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
