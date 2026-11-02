import { useEffect, useState } from 'react';
import { isDesktop } from '../utils/desktop';

const CHECK_INTERVAL_MS = 2 * 60 * 1000;
const TARGET_KEY = 'poe-na-tela-update-target';

function readTarget(): string | null {
  try {
    return sessionStorage.getItem(TARGET_KEY);
  } catch {
    return null;
  }
}

function writeTarget(build: string): void {
  try {
    sessionStorage.setItem(TARGET_KEY, build);
  } catch {}
}

/**
 * Turns true once a newer deploy is live: polls the version.json emitted by the build and compares
 * it with the build this tab is running. Off in dev and in the desktop app, whose UI ships bundled
 * with the installer (reloading would load the same build).
 */
export function useAppUpdate(): boolean {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV || isDesktop) return;

    let found = false;
    const check = async () => {
      if (found) return;
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = await res.json();
        if (typeof build !== 'string' || build === import.meta.env.VITE_APP_BUILD) return;
        found = true;
        // Already reloaded once for this build and still got the old one (stale cache): don't loop.
        if (readTarget() === build) return;
        writeTarget(build);
        setUpdateAvailable(true);
      } catch {
        // Offline or mid-deploy: try again on the next tick.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    };
  }, []);

  return updateAvailable;
}
