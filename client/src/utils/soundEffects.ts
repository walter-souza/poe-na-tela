/**
 * Sound effects utility for room events (user join, user leave)
 * Synthesized in real-time via Web Audio API (0 KB external assets, zero latency)
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch (err) {
    console.warn('Web Audio API not supported or blocked:', err);
    return null;
  }
}

/**
 * Play sound when a user joins the room:
 * Entrada Médio-Grave: Sol4 (392Hz) -> Dó5 (523.25Hz)
 */
export function playJoinSound(volume = 0.35): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const clampedVol = Math.max(0, Math.min(1, volume));

    // Note 1: G4 (392.00 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(392.00, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(clampedVol * 0.45, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Note 2: C5 (523.25 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(523.25, now + 0.09);
    gain2.gain.setValueAtTime(0, now + 0.09);
    gain2.gain.linearRampToValueAtTime(clampedVol * 0.5, now + 0.11);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.6);
  } catch (err) {
    console.warn('Failed to play join sound:', err);
  }
}

/**
 * Play sound when a user leaves the room:
 * Saída Grave (3 notas descendentes): Sol4 (392Hz) -> Mi4 (329.63Hz) -> Dó4 (261.63Hz)
 */
export function playLeaveSound(volume = 0.35): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const clampedVol = Math.max(0, Math.min(1, volume));

    const notes = [
      { freq: 392.00, time: now, dur: 0.24, vol: 0.45 },
      { freq: 329.63, time: now + 0.09, dur: 0.28, vol: 0.42 },
      { freq: 261.63, time: now + 0.18, dur: 0.55, vol: 0.40 },
    ];

    notes.forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, n.time);
      gain.gain.setValueAtTime(0, n.time);
      gain.gain.linearRampToValueAtTime(clampedVol * n.vol, n.time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, n.time + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(n.time);
      osc.stop(n.time + n.dur + 0.05);
    });
  } catch (err) {
    console.warn('Failed to play leave sound:', err);
  }
}
