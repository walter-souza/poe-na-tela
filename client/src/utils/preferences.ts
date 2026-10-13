import { useSyncExternalStore } from 'react';

/**
 * Preferência do usuário salva no navegador e compartilhada entre componentes: quem lê com
 * usePreference() re-renderiza quando outra parte do app (ex.: Ajustes) muda o valor.
 */
export interface Preference<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
  readonly fallback: T;
}

export function createPreference<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | undefined,
  serialize: (value: T) => string = String
): Preference<T> {
  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed = parse(raw);
        if (parsed !== undefined) return parsed;
      }
    } catch {
      // Armazenamento indisponível (modo privado): usa o padrão.
    }
    return fallback;
  };

  let value = typeof window === 'undefined' ? fallback : read();
  const listeners = new Set<() => void>();

  return {
    fallback,
    get: () => value,
    set: (next) => {
      value = next;
      try {
        localStorage.setItem(key, serialize(next));
      } catch {
        // Sem persistência: vale só nesta sessão.
      }
      listeners.forEach((notify) => notify());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function usePreference<T>(preference: Preference<T>): T {
  return useSyncExternalStore(preference.subscribe, preference.get, () => preference.fallback);
}

/** Supressão de ruído por IA (RNNoise) no microfone. Desligada por padrão para voz natural. */
export const noiseSuppressionPref = createPreference<boolean>('poe-na-tela-noise-suppression', false, (raw) => raw === 'true');

/** Microfone escolhido em Ajustes ('' = padrão do sistema). */
export const micDevicePref = createPreference<string>('poe-na-tela-mic-device', '', (raw) => raw);

/** Apelido de quem não tem conta (com conta, vale o nome do perfil). */
export const userNamePref = createPreference<string>('poe-na-tela-username', '', (raw) => raw.trim() || undefined);

export type RoomLayout = 'palco' | 'classico';

/** Layout da sala: Palco (vídeo em destaque, canais no seletor do topo) ou Clássico (lateral de canais). */
export const roomLayoutPref = createPreference<RoomLayout>('poe-na-tela-room-layout', 'classico', (raw) =>
  raw === 'palco' || raw === 'classico' ? raw : undefined
);
