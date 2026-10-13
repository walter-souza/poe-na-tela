import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Peças visuais compartilhadas (tema Grafite/Pêssego e coral). Usam só tokens do tema
 * (bg-app, bg-surface, border-line, bg-accent, text-accent-text...), então funcionam nos dois temas.
 */

export const inputClass =
  'w-full bg-app border border-line rounded-xl px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent-text transition';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-105',
  secondary: 'bg-surface-2 border border-line text-gray-100 hover:border-gray-600',
  ghost: 'text-gray-400 hover:text-gray-100 hover:bg-white/5',
  danger: 'bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20',
};

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; block?: boolean }
> = ({ variant = 'secondary', block = false, className = '', type = 'button', ...props }) => (
  <button
    type={type}
    className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
      block ? 'w-full' : ''
    } ${VARIANTS[variant]} ${className}`}
    {...props}
  />
);

export const Field: React.FC<{
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ label, hint, htmlFor, children }) => (
  <div className="space-y-1.5">
    <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-400">
      {label}
    </label>
    {children}
    {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
  </div>
);

export const ErrorText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p role="alert" className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
    {children}
  </p>
);

/** Janela modal com fundo escurecido; fecha com Esc ou no X. */
export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ open, onClose, title, children, className = 'max-w-md' }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${className} bg-surface border border-line rounded-2xl text-gray-100 shadow-2xl`}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between gap-3 px-5 pt-5">
            <h2 className="text-base font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="p-1.5 -mr-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-white/5 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};

/** Interruptor liga/desliga com rótulo e descrição. */
export const Switch: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, description, disabled }) => (
  <label className={`flex items-center gap-3 py-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
    <span className="flex-1 min-w-0">
      <span className="block text-sm">{label}</span>
      {description && <span className="block text-xs text-gray-400">{description}</span>}
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full border transition cursor-pointer disabled:cursor-not-allowed ${
        checked ? 'bg-accent border-accent' : 'bg-surface-2 border-line'
      }`}
    >
      <span
        className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${
          checked ? 'left-[18px] bg-on-accent' : 'left-0.5 bg-gray-400'
        }`}
      />
    </button>
  </label>
);

/** Grupo de opções exclusivas (ex.: Sistema / Claro / Escuro). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex bg-app border border-line rounded-xl p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={`px-3 py-1.5 rounded-[10px] text-sm transition cursor-pointer ${
            option.value === value ? 'bg-surface-2 text-gray-100 shadow-sm' : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
