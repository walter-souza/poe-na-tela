import React, { useEffect, useRef, useState } from 'react';
import { Headphones, Keyboard, Mic, X } from 'lucide-react';
import { acceleratorFromEvent, formatAccelerator, isStandaloneModifier, type HotkeyAction } from '../hooks/useHotkeys';

interface HotkeyModalProps {
  isOpen: boolean;
  hotkeys: Record<HotkeyAction, string>;
  errors: Record<HotkeyAction, string | null>;
  onSave: (action: HotkeyAction, accelerator: string) => Promise<boolean>;
  onClose: () => void;
}

const ROWS: { action: HotkeyAction; label: string; hint: string; Icon: typeof Mic }[] = [
  { action: 'mic', label: 'Microfone', hint: 'Ativar / desativar o microfone', Icon: Mic },
  { action: 'deafen', label: 'Áudio geral', hint: 'Ativar / desativar o som da sala (ensurdecer)', Icon: Headphones },
];

/** Captura a próxima combinação digitada e a registra como atalho global da ação escolhida. */
export const HotkeyModal: React.FC<HotkeyModalProps> = ({ isOpen, hotkeys, errors, onSave, onClose }) => {
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  // Modificadores pressionados agora. Um único, solto sem outra tecla, vira o atalho.
  const heldModifiers = useRef(new Set<string>());
  const pendingModifier = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen || !recording) return;
    pendingModifier.current = null;
    heldModifiers.current.clear();
    const finish = async (accelerator: string) => {
      pendingModifier.current = null;
      setRecording(null);
      await onSave(recording, accelerator);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === 'Escape') {
        setRecording(null);
        return;
      }
      if (isStandaloneModifier(e.code)) {
        if (e.repeat) return;
        heldModifiers.current.add(e.code);
        // Com dois modificadores juntos é uma combinação, não um modificador sozinho.
        pendingModifier.current = heldModifiers.current.size === 1 ? e.code : null;
        return;
      }
      const accelerator = acceleratorFromEvent(e);
      if (accelerator) void finish(accelerator);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      heldModifiers.current.delete(e.code);
      if (pendingModifier.current === e.code) void finish(e.code);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
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
              <h3 className="font-bold text-white text-sm">Atalhos Globais</h3>
              <p className="text-[11px] text-gray-400">Funcionam mesmo com o jogo em foco</p>
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
          {ROWS.map(({ action, label, hint, Icon }) => {
            const isRecording = recording === action;
            const hotkey = hotkeys[action];
            return (
              <div key={action} className="space-y-2">
                <div className="flex items-center gap-2 text-white font-medium">
                  <Icon className="w-4 h-4 text-indigo-400" />
                  {label}
                  <span className="text-[11px] text-gray-500 font-normal">{hint}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`flex-1 flex items-center justify-center h-11 rounded-xl border font-mono ${
                      isRecording
                        ? 'border-indigo-500 bg-indigo-950/30 text-indigo-200 animate-pulse'
                        : 'border-white/10 bg-white/5 text-white'
                    }`}
                  >
                    {isRecording ? 'Pressione a tecla…' : hotkey ? formatAccelerator(hotkey) : 'Nenhum atalho'}
                  </div>
                  <button
                    onClick={() => setRecording(action)}
                    className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition"
                  >
                    {hotkey ? 'Alterar' : 'Definir'}
                  </button>
                  <button
                    onClick={() => void onSave(action, '')}
                    disabled={!hotkey}
                    className="px-2.5 py-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 text-xs font-medium transition"
                  >
                    Remover
                  </button>
                </div>
                {errors[action] && <p className="text-xs text-rose-300">{errors[action]}</p>}
              </div>
            );
          })}
          <p className="text-[11px] text-gray-500">
            Atalhos de Shift/Ctrl/Alt sozinhos disparam ao soltar a tecla, e só se nada mais for apertado junto.
          </p>
          <p className="text-[11px] text-gray-500">
            Pode ser uma tecla (ex.: F8), uma combinação (ex.: Ctrl + Shift + M) ou um Shift/Ctrl/Alt sozinho, esquerdo ou direito: toque e solte a tecla ao gravar. Esc cancela.
          </p>
        </div>
      </div>
    </div>
  );
};
