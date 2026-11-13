import React, { useEffect, useRef } from 'react';

const GAP = 26;
const RADIUS = 190;

/**
 * Fundo do lobby: grade de pontos que crescem e esquentam perto do cursor e três
 * brilhos que se movem com ele. Sem ponteiro (celular, mouse parado fora da tela)
 * o cursor virtual passeia sozinho. Com "reduzir movimento" fica parado.
 * Ocupa o elemento pai, que precisa ser `relative overflow-hidden`.
 */
export const PointerBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const g1 = useRef<HTMLDivElement>(null);
  const g2 = useRef<HTMLDivElement>(null);
  const g3 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let tx = 0.5;
    let ty = 0.35;
    let mx = tx;
    let my = ty;
    let active = false;
    let raf = 0;

    const resize = () => {
      const r = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width;
      ty = (e.clientY - r.top) / r.height;
      active = true;
    };
    const onLeave = () => {
      active = false;
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (!active && !still) {
        tx = 0.5 + Math.cos(t / 4200) * 0.22;
        ty = 0.35 + Math.sin(t / 5300) * 0.18;
      }
      mx += (tx - mx) * 0.07;
      my += (ty - my) * 0.07;
      const px = mx * w;
      const py = my * h;
      if (g1.current) g1.current.style.transform = `translate3d(${(mx - 0.5) * -140}px,${(my - 0.5) * -90}px,0)`;
      if (g2.current) g2.current.style.transform = `translate3d(${(mx - 0.5) * 160}px,${(my - 0.5) * 110}px,0)`;
      if (g3.current) g3.current.style.transform = `translate3d(${px - 260}px,${py - 260}px,0)`;

      ctx.clearRect(0, 0, w, h);
      for (let y = GAP / 2; y < h; y += GAP) {
        for (let x = GAP / 2; x < w; x += GAP) {
          const dx = x - px;
          const dy = y - py;
          const d = Math.hypot(dx, dy);
          const k = Math.max(0, 1 - d / RADIUS);
          const e = k * k;
          const ox = d > 0 ? (dx / d) * e * 7 : 0;
          const oy = d > 0 ? (dy / d) * e * 7 : 0;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, 1.1 + e * 2.4, 0, Math.PI * 2);
          ctx.fillStyle =
            e > 0.02
              ? `rgba(${Math.round(63 + e * 192)},${Math.round(208 - e * 118)},${Math.round(192 - e * 138)},${0.25 + e * 0.75})`
              : 'rgba(120,114,100,0.28)';
          ctx.fill();
        }
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
      <div
        ref={g1}
        className="absolute -right-40 -top-56 w-[760px] h-[620px] will-change-transform"
        style={{ background: 'radial-gradient(closest-side, rgba(255,90,54,0.26), transparent)' }}
      />
      <div
        ref={g2}
        className="absolute -left-56 -bottom-52 w-[720px] h-[620px] will-change-transform"
        style={{ background: 'radial-gradient(closest-side, rgba(63,208,192,0.2), transparent)' }}
      />
      <div
        ref={g3}
        className="absolute left-0 top-0 w-[520px] h-[520px] will-change-transform"
        style={{ background: 'radial-gradient(closest-side, rgba(245,184,61,0.13), transparent)' }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
};
