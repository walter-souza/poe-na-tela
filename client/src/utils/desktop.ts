/**
 * Ponte com o app desktop (Tauri). Fora dele (navegador comum) `isDesktop` é falso e nada daqui é usado.
 * O Tauri injeta `window.__TAURI__` (withGlobalTauri), então não há dependência extra no client.
 */
interface TauriGlobal {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
  event: {
    listen: <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;
  };
}

const tauri = (): TauriGlobal | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;

export const isDesktop = tauri() !== undefined;

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = tauri();
  if (!t) return Promise.reject(new Error('Disponível apenas no app desktop'));
  return t.core.invoke<T>(cmd, args);
}

/** Retorna a função que cancela a escuta, mesmo se o componente desmontar antes do `listen` resolver. */
export function listen<T>(event: string, handler: (payload: T) => void): () => void {
  const t = tauri();
  if (!t) return () => {};
  let cancelled = false;
  let unlisten: (() => void) | undefined;
  void t.event.listen<T>(event, (e) => handler(e.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export type CaptureSource = { kind: 'monitor'; index: number } | { kind: 'window'; hwnd: number };

export interface MonitorSource {
  index: number;
  name: string;
  width: number;
  height: number;
}

export interface WindowSource {
  hwnd: number;
  title: string;
}

export interface CaptureSources {
  monitors: MonitorSource[];
  windows: WindowSource[];
}

export interface NativeCaptureConfig {
  source: CaptureSource;
  encoder: string;
  fps: number;
  width: number;
  height: number;
  bitrateKbps: number;
  srtUrl: string;
  systemAudio: boolean;
}

export type NativeCaptureState = 'idle' | 'starting' | 'live' | 'reconnecting' | 'error';

export interface NativeCaptureStats {
  fps: number;
  bitrateKbps: number;
  droppedFrames: number;
  speed: number;
}

export const listSources = () => invoke<CaptureSources>('list_sources');
export const detectEncoders = () => invoke<string[]>('detect_encoders');
