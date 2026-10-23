import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isDesktop, listen } from '../utils/desktop';

export type HotkeyAction = 'mic' | 'deafen';

const ACTIONS: HotkeyAction[] = ['mic', 'deafen'];
const STORAGE_KEYS: Record<HotkeyAction, string> = {
  mic: 'poe:micHotkey',
  deafen: 'poe:deafenHotkey',
};

function readSaved(action: HotkeyAction): string {
  try {
    return localStorage.getItem(STORAGE_KEYS[action]) ?? '';
  } catch {
    return '';
  }
}

const noErrors = (): Record<HotkeyAction, string | null> => ({ mic: null, deafen: null });

/**
 * Atalhos globais (funcionam com outra janela em foco): microfone e áudio geral (ensurdecer).
 * Só existem no app desktop; no navegador o hook não faz nada.
 */
/** Janela em que um segundo disparo da mesma ação é ignorado (gancho do sistema e DOM podem avisar o mesmo toque). */
const DEDUPE_MS = 250;

export function useHotkeys(handlers: Record<HotkeyAction, () => void>, options: { paused?: boolean } = {}) {
  const [hotkeys, setHotkeys] = useState<Record<HotkeyAction, string>>(() => ({
    mic: readSaved('mic'),
    deafen: readSaved('deafen'),
  }));
  const [errors, setErrors] = useState(noErrors);
  const handlersRef = useRef(handlers);
  const pausedRef = useRef(false);
  const lastFiredRef = useRef<Partial<Record<HotkeyAction, number>>>({});

  useEffect(() => {
    handlersRef.current = handlers;
    pausedRef.current = options.paused ?? false;
  });

  const fire = useCallback((action: HotkeyAction) => {
    // Pausado enquanto o modal grava um novo atalho: tocar a tecla escolhida não pode acioná-la.
    if (pausedRef.current) return;
    const now = performance.now();
    if (now - (lastFiredRef.current[action] ?? -Infinity) < DEDUPE_MS) return;
    lastFiredRef.current[action] = now;
    handlersRef.current[action]?.();
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    const off = listen<{ action: HotkeyAction }>('hotkey-pressed', ({ action }) => fire(action));
    for (const action of ACTIONS) {
      invoke('set_hotkey', { action, accelerator: readSaved(action) }).catch((e) =>
        setErrors((prev) => ({ ...prev, [action]: String(e) })),
      );
    }
    return () => {
      off();
      // Os atalhos só valem dentro da sala; ao sair, libera as teclas para outros apps.
      for (const action of ACTIONS) invoke('set_hotkey', { action, accelerator: '' }).catch(() => {});
    };
  }, [fire]);

  // Com a janela do app em foco o Windows não entrega as teclas ao gancho do sistema: o toque de
  // Shift/Ctrl/Alt sozinho também é detectado aqui, pelo DOM (mesma regra do gancho em modkeys.rs).
  useEffect(() => {
    if (!isDesktop) return;
    const bound = new Map<string, HotkeyAction>();
    for (const action of ACTIONS) if (isStandaloneModifier(hotkeys[action])) bound.set(hotkeys[action], action);
    if (bound.size === 0) return;

    const held = new Set<string>();
    let armed: string | null = null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || armed === e.code) return;
      const alone = held.size === 0;
      held.add(e.code);
      armed = bound.has(e.code) && alone ? e.code : null;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      held.delete(e.code);
      if (armed !== e.code) return;
      armed = null;
      const action = bound.get(e.code);
      if (action) fire(action);
    };
    const reset = () => {
      held.clear();
      armed = null;
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', reset);
    };
  }, [hotkeys, fire]);

  const setHotkey = useCallback(async (action: HotkeyAction, accelerator: string) => {
    setErrors((prev) => ({ ...prev, [action]: null }));
    try {
      await invoke('set_hotkey', { action, accelerator });
      try {
        localStorage.setItem(STORAGE_KEYS[action], accelerator);
      } catch {
        // Sem localStorage o atalho vale só nesta sessão.
      }
      setHotkeys((prev) => ({ ...prev, [action]: accelerator }));
      return true;
    } catch (e) {
      setErrors((prev) => ({ ...prev, [action]: String(e) }));
      return false;
    }
  }, []);

  return { hotkeys, errors, setHotkey };
}

/** Modificadores que podem ser o atalho sozinhos (esquerdo e direito são teclas distintas). */
const STANDALONE_MODIFIERS = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'];
const IGNORED_MODIFIERS = ['MetaLeft', 'MetaRight'];

export const isStandaloneModifier = (code: string) => STANDALONE_MODIFIERS.includes(code);

/**
 * Converte um KeyboardEvent no formato aceito pelo app desktop (ex.: "Ctrl+Shift+KeyM", "F8").
 * Devolve null para modificadores: eles só viram atalho se forem tocados sozinhos (ver isStandaloneModifier).
 */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (isStandaloneModifier(e.code) || IGNORED_MODIFIERS.includes(e.code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  parts.push(e.code);
  return parts.join('+');
}

const MODIFIER_LABELS: Record<string, string> = {
  ShiftLeft: 'Shift Esq',
  ShiftRight: 'Shift Dir',
  ControlLeft: 'Ctrl Esq',
  ControlRight: 'Ctrl Dir',
  AltLeft: 'Alt Esq',
  AltRight: 'Alt Dir',
};

export function formatAccelerator(accelerator: string): string {
  return MODIFIER_LABELS[accelerator] ?? accelerator
    .split('+')
    .map((p) => p.replace(/^Key/, '').replace(/^Digit/, ''))
    .join(' + ');
}
