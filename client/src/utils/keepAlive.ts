/**
 * Background Keep-Alive & Anti-Throttling Suite
 * Prevents Chromium from throttling event loops, WebRTC encoder pipelines,
 * and timer resolution when the browser window loses focus (e.g. background tab or full-screen gaming).
 */

let keepAliveWorker: Worker | null = null;
let silentAudioCtx: AudioContext | null = null;
let silentOscillator: OscillatorNode | null = null;
let wakeLockSentinel: any = null;

/**
 * 1. Web Worker Keep-Alive
 * Fires a constant heartbeat from an isolated thread that is immune to DOM throttling.
 */
function startWorkerHeartbeat(): void {
  if (keepAliveWorker) return;
  try {
    const workerCode = `
      let timer = null;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (!timer) {
            timer = setInterval(function() {
              postMessage('heartbeat');
            }, 1000);
          }
        } else if (e.data === 'stop') {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    keepAliveWorker = new Worker(workerUrl);
    keepAliveWorker.postMessage('start');
  } catch (err) {
    console.warn('Keep-alive worker could not be initialized:', err);
  }
}

/**
 * 2. Silent Audio Anchor
 * Playing continuous silent audio prevents Chromium from putting the renderer
 * or audio/video pipelines into power-saver/throttled state.
 */
function startSilentAudioAnchor(): void {
  if (silentAudioCtx) return;
  try {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) return;

    silentAudioCtx = new AudioCtxClass();
    const osc = silentAudioCtx.createOscillator();
    const gainNode = silentAudioCtx.createGain();

    // Gain virtually zero (inaudible) but actively processed by audio thread
    gainNode.gain.setValueAtTime(0.00001, silentAudioCtx.currentTime);
    osc.connect(gainNode);
    gainNode.connect(silentAudioCtx.destination);
    osc.start();
    silentOscillator = osc;

    if (silentAudioCtx.state === 'suspended') {
      silentAudioCtx.resume().catch(() => {});
    }
  } catch (e) {
    console.warn('Silent audio keep-alive could not be started:', e);
  }
}

/**
 * 3. Screen Wake Lock API
 * Requests system screen wake lock so OS power managers don't throttle GPU/CPU.
 */
async function requestScreenWakeLock(): Promise<void> {
  if (wakeLockSentinel) return;
  try {
    if ('wakeLock' in navigator && (navigator as any).wakeLock?.request) {
      wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      wakeLockSentinel.addEventListener?.('release', () => {
        wakeLockSentinel = null;
      });
    }
  } catch {
    // Wake Lock may fail on some battery saver modes or headless tabs
  }
}

export function startKeepAlive(): void {
  if (typeof window === 'undefined') return;

  startWorkerHeartbeat();
  startSilentAudioAnchor();
  requestScreenWakeLock().catch(() => {});
}

export function stopKeepAlive(): void {
  // Stop Worker
  if (keepAliveWorker) {
    try {
      keepAliveWorker.postMessage('stop');
      keepAliveWorker.terminate();
    } catch {}
    keepAliveWorker = null;
  }

  // Stop Silent Audio Anchor
  if (silentOscillator) {
    try {
      silentOscillator.stop();
      silentOscillator.disconnect();
    } catch {}
    silentOscillator = null;
  }
  if (silentAudioCtx) {
    try {
      silentAudioCtx.close().catch(() => {});
    } catch {}
    silentAudioCtx = null;
  }

  // Release Wake Lock
  if (wakeLockSentinel) {
    try {
      wakeLockSentinel.release?.().catch?.(() => {});
    } catch {}
    wakeLockSentinel = null;
  }
}
