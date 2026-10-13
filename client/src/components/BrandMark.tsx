import React from 'react';

/** Marca do Põe na Tela (mesmo desenho do favicon: tela com "play" sobre o coral). */
export const BrandMark: React.FC<{ size?: number; className?: string }> = ({ size = 28, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={`shrink-0 ${className}`}>
    <rect width="64" height="64" rx="16" fill="var(--accent)" />
    <rect x="12" y="15" width="40" height="27" rx="5" fill="none" stroke="var(--on-accent)" strokeWidth="4.5" />
    <path d="M28 22.5v12l10-6z" fill="var(--on-accent)" stroke="var(--on-accent)" strokeWidth="2" strokeLinejoin="round" />
    <path d="M24 50h16" stroke="var(--on-accent)" strokeWidth="4.5" strokeLinecap="round" />
  </svg>
);
