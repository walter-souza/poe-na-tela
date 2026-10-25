import React from 'react';
import { Play, EyeOff, Radio, AlertTriangle, X } from 'lucide-react';
import type { UnifiedStreamItem } from './VideoPlayer';

// Past this the stream is expensive to receive; the card warns before the viewer opts in.
const HEAVY_BITRATE_KBPS = 12000;
const HEAVY_HEIGHT = 1440;
const METER_MAX_KBPS = 40000;

export const isHeavyStream = (item: UnifiedStreamItem): boolean => {
  if ((item.bitrateKbps ?? 0) >= HEAVY_BITRATE_KBPS) return true;
  if (item.resolution === '4K') return true;
  const height = Number(item.resolution?.match(/^(\d+)p$/)?.[1] ?? 0);
  return height >= HEAVY_HEIGHT;
};

const formatMbps = (kbps: number) => `${(kbps / 1000).toFixed(kbps >= 10000 ? 0 : 1)} Mbps`;

const sourceLabel = (item: UnifiedStreamItem) => (item.type === 'obs' ? 'OBS' : 'WebRTC');

const Avatar: React.FC<{ name: string; className?: string }> = ({ name, className = 'w-8 h-8 text-xs' }) => (
  <div
    className={`rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-white shrink-0 ${className}`}
  >
    {name.trim().charAt(0).toUpperCase() || '?'}
  </div>
);

const MetaChips: React.FC<{ item: UnifiedStreamItem }> = ({ item }) => (
  <div className="flex flex-wrap gap-1.5">
    <span className="text-[11px] text-gray-400 bg-white/5 px-2 py-0.5 rounded-lg">{sourceLabel(item)}</span>
    {item.resolution && (
      <span className="text-[11px] text-gray-400 bg-white/5 px-2 py-0.5 rounded-lg">{item.resolution}</span>
    )}
    {item.bitrateKbps !== undefined && (
      <span
        className={`text-[11px] px-2 py-0.5 rounded-lg flex items-center gap-1 ${
          isHeavyStream(item) ? 'text-amber-300 bg-amber-400/10' : 'text-gray-400 bg-white/5'
        }`}
      >
        {isHeavyStream(item) && <AlertTriangle className="w-3 h-3" />}~{formatMbps(item.bitrateKbps)}
      </span>
    )}
    {item.bitrateKbps === undefined && isHeavyStream(item) && (
      <span className="text-[11px] px-2 py-0.5 rounded-lg flex items-center gap-1 text-amber-300 bg-amber-400/10">
        <AlertTriangle className="w-3 h-3" />
        Alta qualidade
      </span>
    )}
  </div>
);

interface PickerProps {
  items: UnifiedStreamItem[];
  onWatch: (item: UnifiedStreamItem) => void;
}

/** Shown while streams are live but the viewer has not picked any: nothing is received yet. */
export const StreamPicker: React.FC<PickerProps> = ({ items, onWatch }) => (
  <div className="flex-1 overflow-auto px-3 sm:px-5 pb-5 pt-2 custom-scrollbar">
    <h2 className="text-lg sm:text-xl font-bold text-white">Escolha o que assistir</h2>
    <p className="text-xs sm:text-sm text-gray-400 mt-1 mb-4 max-w-xl">
      Nenhuma transmissão é aberta automaticamente. Assim você só gasta internet com o que realmente quer ver.
    </p>
    <div className="grid gap-3 sm:gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
      {items.map((item) => (
        <div
          key={item.id}
          className="bg-[#11131c] border border-white/10 hover:border-indigo-400/50 rounded-2xl overflow-hidden flex flex-col transition"
        >
          <div className="relative aspect-video bg-gradient-to-br from-indigo-950 via-[#14162a] to-violet-950 flex items-center justify-center">
            <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-red-600/90 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Ao vivo
            </div>
            {item.resolution && (
              <span
                className={`absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[11px] font-semibold ${
                  isHeavyStream(item) ? 'bg-amber-400 text-black' : 'bg-black/60 text-gray-200 border border-white/15'
                }`}
              >
                {item.resolution}
              </span>
            )}
            <div className="flex flex-col items-center gap-1 text-[11px] text-gray-300 bg-black/40 px-3 py-2 rounded-xl">
              <EyeOff className="w-5 h-5" />
              <span>Prévia desligada · sem consumo de banda</span>
            </div>
          </div>
          <div className="p-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar name={item.name} />
              <div className="min-w-0">
                <div className="font-semibold text-sm text-white truncate">{item.name}</div>
                <div className="text-[11px] text-gray-400">transmitindo agora</div>
              </div>
            </div>
            <MetaChips item={item} />
            <button
              onClick={() => onWatch(item)}
              className="flex items-center justify-center gap-2 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-semibold transition cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Assistir
            </button>
          </div>
        </div>
      ))}
    </div>
  </div>
);

/** Live streams the viewer is not receiving, kept one click away while others are playing. */
export const AvailableStrip: React.FC<PickerProps> = ({ items, onWatch }) => (
  <div className="bg-[#11131c]/85 border border-white/10 rounded-2xl px-3 py-2.5 shrink-0">
    <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-gray-400 mb-2">
      <span>Disponíveis · não assistindo</span>
      <span>{items.length}</span>
    </div>
    <div className="flex gap-2.5 overflow-x-auto custom-scrollbar">
      {items.map((item) => (
        <div
          key={item.id}
          className="shrink-0 min-w-[250px] flex items-center gap-2.5 bg-[#181a26] border border-white/10 rounded-xl px-2.5 py-2"
        >
          <Avatar name={item.name} className="w-7 h-7 text-xs" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">{item.name}</div>
            <div className="text-[11px] text-gray-400 truncate">
              {[
                sourceLabel(item),
                item.resolution,
                item.bitrateKbps !== undefined ? `~${formatMbps(item.bitrateKbps)}` : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
              {isHeavyStream(item) && <span className="text-amber-300"> ⚠</span>}
            </div>
          </div>
          <button
            onClick={() => onWatch(item)}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition cursor-pointer"
          >
            Assistir
          </button>
        </div>
      ))}
    </div>
  </div>
);

interface PanelProps {
  items: UnifiedStreamItem[];
  currentKbps: number;
  onToggle: (item: UnifiedStreamItem, watching: boolean) => void;
  onStopAll: () => void;
}

/** Per-stream switches plus how much the viewer is receiving right now. */
export const StreamPanel: React.FC<PanelProps> = ({ items, currentKbps, onToggle, onStopAll }) => {
  const watchable = items.filter((i) => !i.isLocal);
  const anyWatching = watchable.some((i) => i.isWatching);
  const pct = Math.min(100, (currentKbps / METER_MAX_KBPS) * 100);

  return (
    <div className="absolute top-12 sm:top-14 right-2 sm:right-3 z-40 w-[320px] max-w-[calc(100%-1rem)] bg-[#11131c] border border-white/10 rounded-2xl shadow-2xl p-3">
      <h3 className="text-sm font-bold text-white">Transmissões ao vivo</h3>
      <p className="text-[11px] text-gray-400 mb-2">Você só recebe vídeo das que estiverem ligadas.</p>
      <div className="flex flex-col">
        {watchable.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/5">
            <Avatar name={item.name} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">{item.name}</div>
              <div className="text-[11px] text-gray-400 truncate">
                {[
                  sourceLabel(item),
                  item.resolution,
                  item.bitrateKbps !== undefined ? `~${formatMbps(item.bitrateKbps)}` : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {isHeavyStream(item) && <span className="text-amber-300"> ⚠</span>}
              </div>
            </div>
            <button
              role="switch"
              aria-checked={item.isWatching}
              aria-label={`Assistir ${item.name}`}
              onClick={() => onToggle(item, !item.isWatching)}
              className={`relative w-9 h-5 rounded-full transition shrink-0 cursor-pointer ${
                item.isWatching ? 'bg-indigo-500' : 'bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  item.isWatching ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-white/10">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-gray-300">Consumo atual</span>
          <b className="text-white">{formatMbps(currentKbps)}</b>
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {anyWatching && (
          <button
            onClick={onStopAll}
            className="mt-2.5 w-full py-1.5 rounded-xl bg-[#181a26] hover:text-rose-300 hover:border-rose-400/40 border border-white/10 text-xs text-gray-200 transition cursor-pointer"
          >
            Parar todas
          </button>
        )}
      </div>
    </div>
  );
};

interface ToastProps {
  item: UnifiedStreamItem;
  onWatch: () => void;
  onClose: () => void;
}

export const NewStreamToast: React.FC<ToastProps> = ({ item, onWatch, onClose }) => (
  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-[#11131c] border border-indigo-400/50 rounded-2xl pl-3.5 pr-2 py-2.5 shadow-2xl animate-fadeIn max-w-[calc(100%-1rem)]">
    <Radio className="w-4 h-4 text-indigo-400 shrink-0" />
    <div className="min-w-0 text-sm">
      <b className="text-white">{item.name}</b> <span className="text-gray-300">começou a transmitir</span>
      {(item.resolution || item.bitrateKbps !== undefined) && (
        <div className="text-[11px] text-gray-400">
          {[item.resolution, item.bitrateKbps !== undefined ? `~${formatMbps(item.bitrateKbps)}` : undefined]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}
    </div>
    <button
      onClick={onWatch}
      className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition cursor-pointer"
    >
      Assistir
    </button>
    <button onClick={onClose} aria-label="Dispensar" className="p-1 text-gray-400 hover:text-white cursor-pointer">
      <X className="w-4 h-4" />
    </button>
  </div>
);
