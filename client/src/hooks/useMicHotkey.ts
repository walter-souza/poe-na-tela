import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isDesktop, listen } from '../utils/desktop';

const STORAGE_KEY = 'poe:micHotkey';

function readSaved(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Atalho global (funciona com outra janela em foco) que alterna o microfone.
 * Só existe no app desktop; no navegador o hook não faz nada.
 */
export function useMicHotkey(onToggle: () => void) {
  const [hotkey, setHotkeyState] = useState(readSaved);
  const [error, setError] = useState<string | null>(null);
  const onToggleRef = useRef(onToggle);

  useEffect(() => {
    onToggleRef.current = onToggle;
  });

  useEffect(() => {
    if (!isDesktop) return;
    const off = listen<null>('toggle-mic', () => onToggleRef.current());
    invoke('set_hotkey', { accelerator: readSaved() }).catch((e) => setError(String(e)));
    return () => {
      off();
      // O atalho só vale dentro da sala; ao sair, libera a tecla para outros apps.
      invoke('set_hotkey', { accelerator: '' }).catch(() => {});
    };
  }, []);

  const setHotkey = useCallback(async (accelerator: string) => {
    setError(null);
    try {
      await invoke('set_hotkey', { accelerator });
      try {
        localStorage.setItem(STORAGE_KEY, accelerator);
      } catch {
        // Sem localStorage o atalho vale só nesta sessão.
      }
      setHotkeyState(accelerator);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, []);

  return { hotkey, error, setHotkey };
}

/** Converte um KeyboardEvent no formato aceito pelo plugin (ex.: "Ctrl+Shift+KeyM", "F8"). */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) {
    return null;
  }
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  parts.push(e.code);
  return parts.join('+');
}

export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((p) => p.replace(/^Key/, '').replace(/^Digit/, ''))
    .join(' + ');
}
