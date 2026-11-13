import React, { useEffect } from 'react';
import { Clapperboard, Download, Trash2 } from 'lucide-react';
import type { ClipPreview } from '../hooks/useClip';

interface ClipPreviewModalProps {
  clip: ClipPreview;
  onDiscard: () => void;
}

/** Preview do clipe montado no servidor: a pessoa vê e decide entre baixar e descartar. */
export const ClipPreviewModal: React.FC<ClipPreviewModalProps> = ({ clip, onDiscard }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDiscard();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDiscard]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Pré-visualização do clipe"
    >
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#13120f] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Clapperboard className="h-4 w-4 text-rose-400" />
          <h2 className="text-sm font-bold text-white">Seu clipe</h2>
          {clip.seconds !== undefined && <span className="text-xs text-gray-400">{clip.seconds.toFixed(0)}s</span>}
        </div>

        <video src={clip.videoUrl} controls autoPlay playsInline className="aspect-video w-full bg-black" />

        <div className="flex flex-col-reverse gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500">O clipe fica disponível por pouco tempo e some ao descartar.</p>
          <div className="flex gap-2">
            <button
              onClick={onDiscard}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 transition hover:bg-white/10 hover:text-white sm:flex-none"
            >
              <Trash2 className="h-4 w-4" />
              Descartar
            </button>
            <a
              href={clip.downloadUrl}
              download
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-500 sm:flex-none"
            >
              <Download className="h-4 w-4" />
              Baixar
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
