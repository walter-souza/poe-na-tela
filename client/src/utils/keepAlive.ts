/**
 * Background Keep-Alive Worker
 * Prevents Chromium from throttling event loops and WebRTC encoder pipelines
 * when the browser window loses focus (e.g., during active full-screen gaming).
 */

let keepAliveWorker: Worker | null = null;

export function startKeepAlive(): void {
  if (typeof window === 'undefined' || keepAliveWorker) return;

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

    keepAliveWorker.onmessage = () => {
      // Background heartbeat keeps JS thread priority active
    };

    keepAliveWorker.postMessage('start');
  } catch (err) {
    console.warn('Keep-alive worker could not be initialized:', err);
  }
}

export function stopKeepAlive(): void {
  if (keepAliveWorker) {
    try {
      keepAliveWorker.postMessage('stop');
      keepAliveWorker.terminate();
    } catch {}
    keepAliveWorker = null;
  }
}
