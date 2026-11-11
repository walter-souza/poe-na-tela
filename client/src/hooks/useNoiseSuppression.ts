import { useCallback, useRef, useState, type RefObject } from 'react';
import { Track, type LocalAudioTrack, type Room } from 'livekit-client';
import { isNoiseSuppressionSupported, NoiseSuppressionProcessor } from '../utils/noiseSuppression';

// Opt-in (desativado por padrão para voz 100% natural).
const NOISE_SUPPRESSION_KEY = 'poe-na-tela-noise-suppression';

/** Noise suppression on the local microphone (see utils/noiseSuppression for the engines). */
export function useNoiseSuppression(roomRef: RefObject<Room | null>) {
  const [isEnabled, setIsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NOISE_SUPPRESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const isEnabledRef = useRef<boolean>(false);
  isEnabledRef.current = isEnabled;
  const activeProcessorRef = useRef<NoiseSuppressionProcessor | null>(null);

  const apply = useCallback(async (track: LocalAudioTrack, enable: boolean) => {
    try {
      if (enable) {
        if (!isNoiseSuppressionSupported()) {
          console.warn('Noise suppression is not supported in this browser environment');
          return;
        }

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const currentCtx = (track as any).audioContext;
          if (!currentCtx || currentCtx.state === 'closed') {
            const newCtx = new AudioCtx({ sampleRate: 48000 });
            if (newCtx.state === 'suspended') {
              await newCtx.resume().catch(() => {});
            }
            track.setAudioContext(newCtx);
          } else if (currentCtx.state === 'suspended') {
            await currentCtx.resume().catch(() => {});
          }
        }

        // Stacking the browser suppressor before ours attenuates the voice twice.
        await track.mediaStreamTrack.applyConstraints({ noiseSuppression: false }).catch(() => {});

        const processor = new NoiseSuppressionProcessor();
        activeProcessorRef.current = processor;
        await track.setProcessor(processor);
        console.info(`Noise suppression active (${processor.engine})`);
      } else {
        if (activeProcessorRef.current || (track as any).processor) {
          await track.stopProcessor();
          activeProcessorRef.current = null;
        }
        await track.mediaStreamTrack.applyConstraints({ noiseSuppression: true }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to apply noise suppression to track:', err);
      activeProcessorRef.current = null;
    }
  }, []);

  const toggle = useCallback(async () => {
    const next = !isEnabled;
    setIsEnabled(next);
    isEnabledRef.current = next;
    try {
      localStorage.setItem(NOISE_SUPPRESSION_KEY, String(next));
    } catch {}

    const room = roomRef.current;
    if (!room) return;

    const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const micTrack = micPub?.track as LocalAudioTrack | undefined;
    if (micTrack) {
      await apply(micTrack, next);
    }
  }, [roomRef, isEnabled, apply]);

  /** Frees the active processor (leaving the room). */
  const destroy = useCallback(() => {
    if (activeProcessorRef.current) {
      activeProcessorRef.current.destroy().catch(() => {});
      activeProcessorRef.current = null;
    }
  }, []);

  return { isEnabled, isEnabledRef, apply, toggle, destroy };
}
