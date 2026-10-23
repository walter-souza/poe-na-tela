import React, { useEffect, useState } from 'react';
import { AppWindow, Check, Monitor } from 'lucide-react';
import { captureThumbnail, windowIcon, type CaptureSource, type CaptureSources, type SourceChoice } from '../utils/desktop';

interface SourcePickerProps {
  sources: CaptureSources | null;
  value: SourceChoice;
  onChange: (choice: SourceChoice) => void;
}

type Tab = 'monitor' | 'window';
type Thumb = string | 'failed';

// JPEG 320x180 totalmente preto pesa ~1 KB: abaixo disso a captura veio vazia (conteúdo protegido, janela fantasma).
const BLANK_THUMBNAIL_CHARS = 1600;

const MAX_PARALLEL_THUMBNAILS = 3;

/** Grade de telas e janelas com miniatura ao vivo (um quadro de cada), como no Discord. */
export const SourcePicker: React.FC<SourcePickerProps> = ({ sources, value, onChange }) => {
  const [tab, setTab] = useState<Tab>(value.startsWith('window') ? 'window' : 'monitor');
  const [thumbs, setThumbs] = useState<Record<string, Thumb>>({});
  const [icons, setIcons] = useState<Record<string, string>>({});

  // Miniaturas só da aba visível, em fila curta; cada atualização da lista refaz os quadros.
  useEffect(() => {
    if (!sources) return;
    const queue: { key: SourceChoice; source: CaptureSource; minimized: boolean }[] =
      tab === 'monitor'
        ? sources.monitors.map((m) => ({ key: `monitor:${m.index}` as const, source: { kind: 'monitor', index: m.index }, minimized: false }))
        : sources.windows.map((w) => ({ key: `window:${w.hwnd}` as const, source: { kind: 'window', hwnd: w.hwnd }, minimized: w.minimized }));
    let cancelled = false;

    const worker = async () => {
      for (let item = queue.shift(); item && !cancelled; item = queue.shift()) {
        const { key, source, minimized } = item;
        let result: Thumb = 'failed';
        // Janela minimizada não entrega quadros: nem tenta (evita esperar o timeout).
        if (!minimized) {
          try {
            const data = await captureThumbnail(source);
            if (data.length >= BLANK_THUMBNAIL_CHARS) result = data;
          } catch {
            // segue como 'failed'
          }
        }
        if (cancelled) return;
        setThumbs((prev) => ({ ...prev, [key]: result }));
        if (result === 'failed' && source.kind === 'window') {
          try {
            const icon = await windowIcon(source.hwnd);
            if (!cancelled) setIcons((prev) => ({ ...prev, [key]: icon }));
          } catch {
            // sem ícone: fica o marcador genérico
          }
        }
      }
    };
    for (let i = 0; i < MAX_PARALLEL_THUMBNAILS; i++) void worker();
    return () => {
      cancelled = true;
    };
  }, [sources, tab]);

  const tabButton = (id: Tab, label: string, Icon: typeof Monitor, count: number) => (
    <button
      onClick={() => setTab(id)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
        tab === id ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label} ({count})
    </button>
  );

  const card = (key: SourceChoice, title: string, subtitle?: string, minimized = false) => {
    const selected = value === key;
    const thumb = thumbs[key];
    const icon = icons[key];
    const FallbackIcon = key.startsWith('monitor') ? Monitor : AppWindow;
    return (
      <button
        key={key}
        onClick={() => onChange(key)}
        title={title}
        className={`relative text-left rounded-xl border overflow-hidden transition ${
          selected
            ? 'border-indigo-500 ring-2 ring-indigo-500/40 bg-indigo-950/30'
            : 'border-white/10 bg-white/5 hover:border-white/30'
        }`}
      >
        <div className="aspect-video bg-black/50 flex items-center justify-center">
          {thumb && thumb !== 'failed' ? (
            <img src={thumb} alt="" className="w-full h-full object-contain" draggable={false} />
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              {icon ? (
                <img src={icon} alt="" className="w-10 h-10 object-contain" draggable={false} />
              ) : (
                <FallbackIcon className={`w-8 h-8 text-gray-500 ${thumb ? '' : 'animate-pulse'}`} />
              )}
              {thumb === 'failed' && (
                <span className="text-[10px] text-gray-500">{minimized ? 'Minimizada' : 'Sem prévia'}</span>
              )}
            </div>
          )}
        </div>
        <div className="px-2.5 py-1.5">
          <div className="text-xs font-medium text-white truncate">{title}</div>
          {subtitle && <div className="text-[10px] text-gray-500 truncate">{subtitle}</div>}
        </div>
        {selected && (
          <span className="absolute top-1.5 right-1.5 p-0.5 rounded-full bg-indigo-600 text-white">
            <Check className="w-3 h-3" />
          </span>
        )}
      </button>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-1 mb-3">
        {tabButton('monitor', 'Telas', Monitor, sources?.monitors.length ?? 0)}
        {tabButton('window', 'Janelas', AppWindow, sources?.windows.length ?? 0)}
      </div>
      {!sources ? (
        <p className="text-xs text-gray-500">Carregando fontes…</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
          {tab === 'monitor'
            ? sources.monitors.map((m, i) =>
                card(`monitor:${m.index}`, `Tela ${i + 1}`, `${m.width}x${m.height}`),
              )
            : sources.windows.length === 0
              ? <p className="col-span-full text-xs text-gray-500">Nenhuma janela encontrada.</p>
              : sources.windows.map((w) => card(`window:${w.hwnd}`, w.title, undefined, w.minimized))}
        </div>
      )}
    </div>
  );
};
