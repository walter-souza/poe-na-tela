import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'poe-na-tela-theme';
const META_COLORS = { dark: '#0d0e10', light: '#fbf6f2' } as const;
const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Armazenamento indisponível (modo privado): segue o tema do sistema.
  }
  return 'system';
}

// Referência no módulo: o navegador pode descartar o ouvinte de um MediaQueryList que ninguém referencia.
const lightQuery: MediaQueryList | undefined =
  typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: light)') : undefined;

function systemPrefersLight(): boolean {
  return lightQuery?.matches === true;
}

/** Aplica a preferência ao <html>: 'system' remove o atributo e deixa o CSS seguir o sistema. */
function applyPreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);

  const resolved = preference === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : preference;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLORS[resolved]);
}

let current: ThemePreference = typeof window === 'undefined' ? 'system' : readPreference();
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  applyPreference(current);
  // No modo "sistema", acompanha mudanças do sistema operacional (cor da barra do navegador).
  lightQuery?.addEventListener('change', () => {
    if (current === 'system') applyPreference('system');
  });
}

function setPreference(next: ThemePreference): void {
  current = next;
  try {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Sem persistência: vale só nesta sessão.
  }
  applyPreference(next);
  listeners.forEach((notify) => notify());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Preferência de tema compartilhada por todos os componentes (Sistema, Claro ou Escuro). */
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, () => current, () => 'system' as ThemePreference);
  const cycle = () => setPreference(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);
  return { preference, setPreference, cycle };
}
