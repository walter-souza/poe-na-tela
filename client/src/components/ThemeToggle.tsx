import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '../hooks/useTheme';

const LABELS: Record<ThemePreference, string> = {
  system: 'Sistema',
  light: 'Claro',
  dark: 'Escuro',
};
const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };

/** Alterna Sistema, Claro e Escuro. A escolha fica salva neste navegador. */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { preference, cycle } = useTheme();
  const Icon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;
  const label = `Tema: ${LABELS[preference]}. Alternar para ${LABELS[NEXT[preference]]}`;

  return (
    <button
      type="button"
      onClick={cycle}
      title={label}
      aria-label={label}
      className={`p-2 rounded-xl border bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 hover:text-white transition cursor-pointer ${className}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
};
