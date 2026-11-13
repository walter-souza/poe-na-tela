import React from 'react';

/** Marca: uma tela com a luz de tally no canto. */
export const LogoMark: React.FC<{ className?: string }> = ({ className = 'w-6 h-5' }) => (
  <svg viewBox="0 0 24 20" className={className} aria-hidden="true">
    <rect x="1" y="3.5" width="19" height="14.5" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="20" cy="4" r="3.4" fill="#ff5a36" stroke="#100f0d" strokeWidth="1.5" />
  </svg>
);

export const Logo: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`inline-flex items-center gap-2.5 font-display font-semibold tracking-tight text-lg text-gray-100 ${className}`}>
    <LogoMark />
    Põe na Tela
  </span>
);
