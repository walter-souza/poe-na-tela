import React, { useState, useEffect } from 'react';
import { Sparkles, Plus, Share2, LogOut, Check, Settings } from 'lucide-react';
import type { UserRoom } from '../types';

interface GuildBarProps {
  userRooms: UserRoom[];
  activeRoomSlug: string | null;
  onSelectRoom: (slug: string) => void;
  onSelectHome: () => void;
  onOpenCreateRoom: () => void;
  onOpenSettings: () => void;
  onRemoveRoom?: (slug: string) => void;
}

export const GuildBar: React.FC<GuildBarProps> = ({
  userRooms,
  activeRoomSlug,
  onSelectRoom,
  onSelectHome,
  onOpenCreateRoom,
  onOpenSettings,
  onRemoveRoom,
}) => {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    room: UserRoom;
  } | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // Fechar menu de contexto ao clicar fora ou rolar
  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener('click', handleClose);
      window.addEventListener('contextmenu', handleClose);
      window.addEventListener('scroll', handleClose, true);
    }
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('contextmenu', handleClose);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, room: UserRoom) => {
    e.preventDefault();
    e.stopPropagation();

    // Ajustar para não vazar das bordas da tela
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 150);

    setContextMenu({ x, y, room });
  };

  const handleCopyInvite = (e: React.MouseEvent, slug: string) => {
    e.stopPropagation();
    const inviteUrl = `${window.location.origin}?server=${encodeURIComponent(slug)}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopiedSlug(slug);
      setTimeout(() => {
        setCopiedSlug(null);
        setContextMenu(null);
      }, 1000);
    });
  };

  const handleRemove = (e: React.MouseEvent, slug: string) => {
    e.stopPropagation();
    setContextMenu(null);
    onRemoveRoom?.(slug);
  };

  return (
    <nav
      aria-label="Servidores"
      className="w-16 sm:w-[72px] bg-app border-r border-white/10 flex flex-col items-center py-3 space-y-2 select-none shrink-0 z-30 relative"
    >
      {/* Home / Lobby Icon */}
      <div className="relative group flex items-center justify-center w-full">
        {/* Active Pill Indicator */}
        <div
          className={`absolute left-0 w-1 bg-white rounded-r transition-all duration-200 ${
            activeRoomSlug === null
              ? 'h-10'
              : 'h-0 group-hover:h-5'
          }`}
        />

        <button
          onClick={onSelectHome}
          title="Início / Explorar Salas"
          className={`w-12 h-12 flex items-center justify-center transition-all duration-200 cursor-pointer ${
            activeRoomSlug === null
              ? 'rounded-[16px] bg-gradient-to-tr from-indigo-600 to-violet-500 text-on-accent shadow-lg shadow-indigo-500/25'
              : 'rounded-[24px] hover:rounded-[16px] bg-surface hover:bg-gradient-to-tr hover:from-indigo-600 hover:to-violet-500 text-indigo-300 hover:text-white'
          }`}
        >
          <Sparkles className="w-6 h-6" />
        </button>

        {/* Discord Tooltip */}
        <div className="absolute left-[80px] z-50 hidden group-hover:flex items-center px-3 py-1.5 rounded-md bg-surface text-white text-xs font-semibold shadow-xl border border-white/10 whitespace-nowrap pointer-events-none">
          Início / Explorar
        </div>
      </div>

      {/* Separator */}
      <div className="w-8 h-[2px] bg-white/10 rounded-full my-1" />

      {/* Room Icons List */}
      <div className="flex-1 w-full overflow-y-auto overflow-x-hidden space-y-2 scrollbar-none flex flex-col items-center">
        {userRooms.map((room) => {
          const isActive = activeRoomSlug === room.slug;
          const initials = room.name
            .split(' ')
            .slice(0, 2)
            .map((word) => word.charAt(0).toUpperCase())
            .join('') || room.slug.slice(0, 2).toUpperCase();

          return (
            <div key={room.id} className="relative group flex items-center justify-center w-full">
              {/* Active Pill Indicator */}
              <div
                className={`absolute left-0 w-1 bg-white rounded-r transition-all duration-200 ${
                  isActive
                    ? 'h-10'
                    : 'h-0 group-hover:h-5'
                }`}
              />

              <button
                onClick={() => onSelectRoom(room.slug)}
                onContextMenu={(e) => handleContextMenu(e, room)}
                title={room.name}
                className={`w-12 h-12 flex items-center justify-center font-bold text-sm transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'rounded-[16px] bg-indigo-600 text-on-accent shadow-lg shadow-indigo-600/30'
                    : 'rounded-[24px] hover:rounded-[16px] bg-surface hover:bg-indigo-600 text-gray-300 hover:text-white'
                }`}
              >
                {initials}
              </button>

              {/* Discord Tooltip */}
              <div className="absolute left-[80px] z-50 hidden group-hover:flex flex-col items-start px-3 py-1.5 rounded-md bg-surface text-white text-xs font-semibold shadow-xl border border-white/10 whitespace-nowrap pointer-events-none">
                <div className="flex items-center gap-1.5">
                  <span>{room.name}</span>
                  {room.hasPasscode && <span className="text-amber-400 text-[10px]">🔒</span>}
                </div>
                <span className="text-[10px] text-gray-400 font-normal">Botão direito para opções</span>
              </div>
            </div>
          );
        })}

        {/* Add Room Button */}
        <div className="relative group flex items-center justify-center w-full pt-1">
          <button
            onClick={onOpenCreateRoom}
            title="Criar Sala"
            className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-surface hover:bg-emerald-600 text-emerald-400 hover:text-white flex items-center justify-center transition-all duration-200 cursor-pointer shadow-sm"
          >
            <Plus className="w-5 h-5" />
          </button>

          {/* Discord Tooltip */}
          <div className="absolute left-[80px] z-50 hidden group-hover:flex items-center px-3 py-1.5 rounded-md bg-surface text-white text-xs font-semibold shadow-xl border border-white/10 whitespace-nowrap pointer-events-none">
            Adicionar uma Sala
          </div>
        </div>
      </div>

      {/* Ajustes (microfone, ruído, tema e conta) */}
      <div className="flex justify-center pb-3 pt-2 border-t border-line">
        <button
          type="button"
          onClick={onOpenSettings}
          title="Ajustes"
          aria-label="Ajustes"
          className="w-11 h-11 rounded-2xl bg-surface hover:bg-surface-2 text-gray-400 hover:text-gray-100 flex items-center justify-center transition cursor-pointer"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Menu de Contexto Flutuante (Botão Direito no Servidor) */}
      {contextMenu && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 bg-surface border border-white/10 rounded-xl p-1.5 shadow-2xl backdrop-blur-md min-w-[190px] animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 font-bold text-xs text-gray-200 border-b border-white/10 truncate max-w-[220px]">
            {contextMenu.room.name}
          </div>

          <div className="py-1 space-y-0.5">
            <button
              onClick={(e) => handleCopyInvite(e, contextMenu.room.slug)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-indigo-600/30 rounded-lg transition text-left cursor-pointer"
            >
              {copiedSlug === contextMenu.room.slug ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Link Copiado!</span>
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Copiar Link de Convite</span>
                </>
              )}
            </button>

            {onRemoveRoom && (
              <button
                onClick={(e) => handleRemove(e, contextMenu.room.slug)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 rounded-lg transition text-left cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Remover da Barra</span>
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};
