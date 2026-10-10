import React from 'react';
import { Sparkles, Plus } from 'lucide-react';
import type { UserRoom } from '../types';

interface GuildBarProps {
  userRooms: UserRoom[];
  activeRoomSlug: string | null;
  onSelectRoom: (slug: string) => void;
  onSelectHome: () => void;
  onOpenCreateRoom: () => void;
}

export const GuildBar: React.FC<GuildBarProps> = ({
  userRooms,
  activeRoomSlug,
  onSelectRoom,
  onSelectHome,
  onOpenCreateRoom,
}) => {
  return (
    <nav
      aria-label="Servidores"
      className="w-16 sm:w-[72px] bg-[#07080d] border-r border-white/10 flex flex-col items-center py-3 space-y-2 select-none shrink-0 z-30"
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
              ? 'rounded-[16px] bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-lg shadow-indigo-500/25'
              : 'rounded-[24px] hover:rounded-[16px] bg-[#131520] hover:bg-gradient-to-tr hover:from-indigo-600 hover:to-violet-500 text-indigo-300 hover:text-white'
          }`}
        >
          <Sparkles className="w-6 h-6" />
        </button>

        {/* Discord Tooltip */}
        <div className="absolute left-[80px] z-50 hidden group-hover:flex items-center px-3 py-1.5 rounded-md bg-[#11131c] text-white text-xs font-semibold shadow-xl border border-white/10 whitespace-nowrap pointer-events-none">
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
                title={room.name}
                className={`w-12 h-12 flex items-center justify-center font-bold text-sm transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'rounded-[16px] bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                    : 'rounded-[24px] hover:rounded-[16px] bg-[#131520] hover:bg-indigo-600 text-gray-300 hover:text-white'
                }`}
              >
                {initials}
              </button>

              {/* Discord Tooltip */}
              <div className="absolute left-[80px] z-50 hidden group-hover:flex items-center px-3 py-1.5 rounded-md bg-[#11131c] text-white text-xs font-semibold shadow-xl border border-white/10 whitespace-nowrap pointer-events-none">
                {room.name}
                {room.hasPasscode && <span className="ml-1.5 text-amber-400 text-[10px]">🔒</span>}
              </div>
            </div>
          );
        })}

        {/* Add Room Button */}
        <div className="relative group flex items-center justify-center w-full pt-1">
          <button
            onClick={onOpenCreateRoom}
            title="Criar Sala"
            className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-[#131520] hover:bg-emerald-600 text-emerald-400 hover:text-white flex items-center justify-center transition-all duration-200 cursor-pointer shadow-sm"
          >
            <Plus className="w-5 h-5" />
          </button>

          {/* Discord Tooltip */}
          <div className="absolute left-[80px] z-50 hidden group-hover:flex items-center px-3 py-1.5 rounded-md bg-[#11131c] text-white text-xs font-semibold shadow-xl border border-white/10 whitespace-nowrap pointer-events-none">
            Adicionar uma Sala
          </div>
        </div>
      </div>
    </nav>
  );
};
