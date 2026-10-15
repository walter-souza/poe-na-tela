import React, { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import { acceleratorFromEvent, formatAccelerator } from '../hooks/useMicHotkey';

interface HotkeyModalProps {
  isOpen: boolean;
  hotkey: string;
  error: string | null;
  onSave: (accelerator: string) => Promise<boolean>;
  onClose: () => void;
}

/** Captura a próxima combinação digitada e a registra como atalho global do microfone. */
export const HotkeyModal: React.FC<HotkeyModalProps> = ({ isOpen, hotkey, error, onSave, onClose }) => {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!isOpen || !recording) return;
    const onKeyDown = async (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === 'Escape') {
        setRecording(false);
        return;
      }
      const accelerator = acceleratorFromEvent(e);
      if (!accelerator) return;
      setRecording(false);
      await onSave(accelerator);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, recording, onSave]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#13151f] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden text-gray-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Atalho do Microfone</h3>
              <p className="text-[11px] text-gray-400">Funciona mesmo com o jogo em foco</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <div
            className={`flex items-center justify-center h-16 rounded-xl border font-mono text-lg ${
              recording
                ? 'border-indigo-500 bg-indigo-950/30 text-indigo-200 animate-pulse'
                : 'border-white/10 bg-white/5 text-white'
            }`}
          >
            {recording ? 'Pressione a tecla…' : hotkey ? formatAccelerator(hotkey) : 'Nenhum atalho'}
          </div>
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <p className="text-[11px] text-gray-500">
            Pode ser uma tecla solta (ex.: F8) ou uma combinação (ex.: Ctrl + Shift + M). Esc cancela a gravação.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10 bg-white/5">
          <button
            onClick={() => void onSave('')}
            disabled={!hotkey}
            className="px-3 py-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 text-xs font-medium transition"
          >
            Remover atalho
          </button>
          <button
            onClick={() => setRecording(true)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition"
          >
            {hotkey ? 'Alterar atalho' : 'Definir atalho'}
          </button>
        </div>
      </div>
    </div>
  );
};
