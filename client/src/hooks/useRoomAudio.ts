import { useCallback, useRef, useState, type RefObject } from 'react';
import { Track, type Room } from 'livekit-client';
import { getAssetUrl } from '../utils/noiseSuppression';

const USER_VOLUMES_STORAGE_KEY = 'poe-na-tela-user-volumes';

interface AudioBooster {
  source: MediaStreamAudioSourceNode;
  leveler: AudioWorkletNode;
  gain: GainNode;
  limiter: AudioWorkletNode;
  stream: MediaStream;
}

function loadUserVolumes(): Record<string, number> {
  try {
    const saved = localStorage.getItem(USER_VOLUMES_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        const sanitized: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
          const num = Number(v);
          if (!isNaN(num) && isFinite(num)) {
            sanitized[k] = Math.max(0, Math.min(2, num));
          }
        }
        return sanitized;
      }
    }
  } catch {}
  return {};
}

const micElements = (identity: string) =>
  document.querySelectorAll(
    `audio[data-participant="${identity}"][data-source="microphone"]`
  ) as NodeListOf<HTMLAudioElement>;

/**
 * What the local user hears: per-voice volume (0-200%, boosted above 100% through Web Audio),
 * per-stream volume, global volume and deafen. Remote audio is played through <audio> elements
 * tagged with data-participant / data-source so these settings can find them.
 */
export function useRoomAudio(roomRef: RefObject<Room | null>, initialDeafened: boolean) {
  const [isDeafened, setIsDeafenedState] = useState<boolean>(initialDeafened);
  const isDeafenedRef = useRef<boolean>(initialDeafened);

  const [streamVolumes, setStreamVolumes] = useState<Record<string, number>>({});
  const streamVolumesRef = useRef<Record<string, number>>({});
  streamVolumesRef.current = streamVolumes;

  const [userVolumes, setUserVolumes] = useState<Record<string, number>>(loadUserVolumes);
  const userVolumesRef = useRef<Record<string, number>>({});
  userVolumesRef.current = userVolumes;

  const currentVolumeRef = useRef<number>(1);

  // Dedicated Web Audio Boost Context for 101% - 200% voice amplification
  const boostAudioContextRef = useRef<AudioContext | null>(null);
  const audioBoostersRef = useRef<Map<string, AudioBooster>>(new Map());
  // Boosters waiting for the worklet module: identity -> latest requested volume.
  const pendingBoostersRef = useRef<Map<string, number>>(new Map());
  const boostWorkletRef = useRef<{ ctx: AudioContext; ready: Promise<void> } | null>(null);

  const disposeBooster = useCallback((participantIdentity: string) => {
    pendingBoostersRef.current.delete(participantIdentity);
    const booster = audioBoostersRef.current.get(participantIdentity);
    if (!booster) return;
    try {
      booster.source.disconnect();
      booster.leveler.disconnect();
      booster.gain.disconnect();
      booster.limiter.disconnect();
    } catch {}
    audioBoostersRef.current.delete(participantIdentity);
  }, []);

  /** Releases every booster and the boost context (leaving the room). */
  const disposeAll = useCallback(() => {
    audioBoostersRef.current.forEach((_, participantId) => disposeBooster(participantId));
    if (boostAudioContextRef.current && boostAudioContextRef.current.state !== 'closed') {
      boostAudioContextRef.current.close().catch(() => {});
      boostAudioContextRef.current = null;
    }
  }, [disposeBooster]);

  const getBoostAudioContext = useCallback((): AudioContext => {
    if (!boostAudioContextRef.current || boostAudioContextRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      boostAudioContextRef.current = new AudioCtx({ sampleRate: 48000 });
      boostWorkletRef.current = null;
    }
    if (boostAudioContextRef.current.state === 'suspended') {
      boostAudioContextRef.current.resume().catch(() => {});
    }
    return boostAudioContextRef.current;
  }, []);

  // Applies a voice volume: native 0-100% and the Web Audio boost for 101-200%.
  const applyParticipantVolume = useCallback(
    (participantIdentity: string, volume: number, track?: Track) => {
      const clamped = Math.max(0, Math.min(2, volume));
      const nativeVol = Math.min(1, clamped);
      const room = roomRef.current;

      // 1. LiveKit track & participant native volume (ALWAYS clamped to <= 1.0 to prevent IndexSizeError)
      if (track && 'setVolume' in track) {
        try {
          (track as any).setVolume(nativeVol);
        } catch {}
      }

      if (room) {
        const participant = room.remoteParticipants.get(participantIdentity);
        if (participant) {
          try {
            participant.setVolume(nativeVol, Track.Source.Microphone);
          } catch {}
          participant.audioTrackPublications.forEach((pub) => {
            if (pub.source === Track.Source.Microphone && pub.track && 'setVolume' in pub.track) {
              try {
                (pub.track as any).setVolume(nativeVol);
              } catch {}
            }
          });
        }
      }

      // 2. Audio elements & Web Audio booster
      const audioElements = micElements(participantIdentity);

      if (clamped > 1.0 && !isDeafenedRef.current) {
        const muteNativeElements = () =>
          audioElements.forEach((el) => {
            try {
              el.volume = 0;
              el.muted = true;
            } catch {}
          });
        // Level and gain follow the slider: the auto-leveler fades in over 100% -> 200%.
        const applyBoost = (booster: AudioBooster, ctx: AudioContext, vol: number) => {
          booster.gain.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
          booster.leveler.parameters.get('amount')?.setTargetAtTime(vol - 1, ctx.currentTime, 0.05);
        };

        try {
          const ctx = getBoostAudioContext();
          const existing = audioBoostersRef.current.get(participantIdentity);
          if (existing) {
            // Boosted (>100%): mute the native element so there is no echo/double audio
            muteNativeElements();
            applyBoost(existing, ctx, clamped);
            return;
          }

          // Find media track for booster
          let mediaTrack = (track as any)?.mediaStreamTrack;
          if (!mediaTrack && room) {
            const participant = room.remoteParticipants.get(participantIdentity);
            const micPub = participant?.getTrackPublication(Track.Source.Microphone);
            mediaTrack = micPub?.track?.mediaStreamTrack;
          }
          if (!mediaTrack) {
            muteNativeElements();
            return;
          }

          // The worklet module loads asynchronously; keep the native element playing until the
          // booster is wired, and remember only the latest requested volume meanwhile.
          const alreadyPending = pendingBoostersRef.current.has(participantIdentity);
          pendingBoostersRef.current.set(participantIdentity, clamped);
          if (alreadyPending) return;

          if (!boostWorkletRef.current || boostWorkletRef.current.ctx !== ctx) {
            boostWorkletRef.current = {
              ctx,
              ready: ctx.audioWorklet.addModule(getAssetUrl('audio-worklets/voiceBoostWorklet.js')),
            };
          }
          boostWorkletRef.current.ready
            .then(() => {
              const vol = pendingBoostersRef.current.get(participantIdentity);
              pendingBoostersRef.current.delete(participantIdentity);
              // Volume dropped back to <= 100%, or the context was replaced, while loading.
              if (vol === undefined || ctx !== boostAudioContextRef.current || ctx.state === 'closed') return;

              const stream = new MediaStream([mediaTrack]);
              const source = ctx.createMediaStreamSource(stream);
              // Evens out quiet speakers, applies the user's gain, then a lookahead limiter catches
              // the peaks (a fast compressor here modulates the gain and sounds robotic).
              const leveler = new AudioWorkletNode(ctx, 'voice-leveler');
              const gain = ctx.createGain();
              const limiter = new AudioWorkletNode(ctx, 'voice-limiter', {
                processorOptions: { ceilingDb: -1, lookaheadMs: 5, releaseMs: 120 },
              });
              source.connect(leveler);
              leveler.connect(gain);
              gain.connect(limiter);
              limiter.connect(ctx.destination);
              const booster: AudioBooster = { source, leveler, gain, limiter, stream };
              audioBoostersRef.current.set(participantIdentity, booster);
              applyBoost(booster, ctx, vol);
              micElements(participantIdentity).forEach((node) => {
                try {
                  node.volume = 0;
                  node.muted = true;
                } catch {}
              });
            })
            .catch((err) => {
              pendingBoostersRef.current.delete(participantIdentity);
              boostWorkletRef.current = null;
              console.warn('Failed to apply audio boost:', err);
            });
        } catch (err) {
          pendingBoostersRef.current.delete(participantIdentity);
          console.warn('Failed to apply audio boost:', err);
        }
      } else {
        // Normal volume (0% to 100%) or deafened:
        disposeBooster(participantIdentity);

        audioElements.forEach((el) => {
          try {
            el.volume = isDeafenedRef.current ? 0 : nativeVol;
            el.muted = nativeVol === 0 || isDeafenedRef.current;
          } catch {}
        });
      }
    },
    [roomRef, getBoostAudioContext, disposeBooster]
  );

  /** Plays a newly subscribed remote audio track with the user's current volume/deafen settings. */
  const attachRemoteAudio = useCallback((track: Track, participantIdentity: string) => {
    const el = track.attach();
    const isScreenAudio = track.source === Track.Source.ScreenShareAudio;
    el.setAttribute('data-livekit-track', track.sid || track.kind);
    el.setAttribute('data-participant', participantIdentity);
    el.setAttribute('data-source', isScreenAudio ? 'screen_share_audio' : 'microphone');

    // Deafening disables the incoming tracks (setDeafened); tracks that arrive afterwards,
    // such as someone joining later, must start disabled too or they would be heard.
    if (isDeafenedRef.current && track.mediaStreamTrack) {
      track.mediaStreamTrack.enabled = false;
    }

    if (isScreenAudio) {
      const streamVol = streamVolumesRef.current[participantIdentity] !== undefined
        ? streamVolumesRef.current[participantIdentity]
        : 1;
      const clampedStreamVol = Math.max(0, Math.min(1, streamVol));

      if ('setVolume' in track) {
        try {
          (track as any).setVolume(clampedStreamVol);
        } catch {}
      }
      if (el) {
        try {
          (el as HTMLAudioElement).volume = clampedStreamVol;
          (el as HTMLAudioElement).muted = clampedStreamVol === 0 || isDeafenedRef.current;
        } catch {}
      }
    } else {
      // Voice Microphone track: individual volume, or the global one
      const voiceVol = userVolumesRef.current[participantIdentity] !== undefined
        ? userVolumesRef.current[participantIdentity]
        : currentVolumeRef.current;

      applyParticipantVolume(participantIdentity, voiceVol, track);
    }
  }, [applyParticipantVolume]);

  const detachRemoteAudio = useCallback((track: Track, participantIdentity?: string) => {
    track.detach();
    if (participantIdentity) disposeBooster(participantIdentity);
  }, [disposeBooster]);

  // Individual stream audio volume (ONLY affects ScreenShareAudio, keeping Microphone voice intact)
  const setStreamVolume = useCallback((participantIdentity: string, volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setStreamVolumes((prev) => ({ ...prev, [participantIdentity]: clamped }));

    const room = roomRef.current;
    if (!room) return;

    // Local participant does not need audio playback adjustment
    if (room.localParticipant?.identity === participantIdentity) return;

    const participant = room.remoteParticipants.get(participantIdentity);
    if (participant) {
      try {
        participant.setVolume(clamped, Track.Source.ScreenShareAudio);
      } catch {}
      participant.audioTrackPublications.forEach((pub) => {
        if (pub.source === Track.Source.ScreenShareAudio && pub.track && 'setVolume' in pub.track) {
          try {
            (pub.track as any).setVolume(clamped);
          } catch {}
        }
      });
    }

    document
      .querySelectorAll(`audio[data-participant="${participantIdentity}"][data-source="screen_share_audio"]`)
      .forEach((el) => {
        try {
          (el as HTMLAudioElement).volume = clamped;
          (el as HTMLAudioElement).muted = clamped === 0 || isDeafenedRef.current;
        } catch {}
      });
  }, [roomRef]);

  // Individual voice volume (ONLY affects local hearing of that participant's voice), 0 to 2.0
  const setUserVolume = useCallback((participantIdentity: string, volume: number) => {
    const clamped = Math.max(0, Math.min(2, volume));
    setUserVolumes((prev) => {
      const updated = { ...prev, [participantIdentity]: clamped };
      try {
        localStorage.setItem(USER_VOLUMES_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    applyParticipantVolume(participantIdentity, clamped);
  }, [applyParticipantVolume]);

  // Global audio volume for all remote participants and audio elements
  const setGlobalVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    currentVolumeRef.current = clamped;
    const room = roomRef.current;
    if (!room) return;

    room.remoteParticipants.forEach((p) => {
      // Set volume for both microphone and screen share audio tracks
      p.setVolume(clamped, Track.Source.Microphone);
      p.setVolume(clamped, Track.Source.ScreenShareAudio);

      // Also set volume directly on track instances
      p.audioTrackPublications.forEach((pub) => {
        if (pub.track && 'setVolume' in pub.track) {
          (pub.track as any).setVolume(clamped);
        }
      });
    });

    // Also update attached audio elements in DOM
    document.querySelectorAll('audio').forEach((el) => {
      (el as HTMLAudioElement).volume = clamped;
      (el as HTMLAudioElement).muted = clamped === 0 || isDeafenedRef.current;
    });
  }, [roomRef]);

  /** Silences (or restores) every incoming track, booster and audio element. */
  const setDeafened = useCallback((nextDeafen: boolean) => {
    setIsDeafenedState(nextDeafen);
    isDeafenedRef.current = nextDeafen;

    const room = roomRef.current;
    if (!room) return;

    room.remoteParticipants.forEach((p) => {
      p.audioTrackPublications.forEach((pub) => {
        if (pub.track && pub.track.mediaStreamTrack) {
          pub.track.mediaStreamTrack.enabled = !nextDeafen;
        }
      });
    });

    audioBoostersRef.current.forEach((booster, participantId) => {
      try {
        const ctx = boostAudioContextRef.current;
        if (ctx) {
          if (nextDeafen) {
            booster.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          } else {
            const vol = userVolumesRef.current[participantId] ?? 1.0;
            booster.gain.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
          }
        }
      } catch {}
    });

    document.querySelectorAll('audio').forEach((el) => {
      const audioElement = el as HTMLAudioElement;
      if (nextDeafen) {
        audioElement.muted = true;
      } else {
        const participantId = audioElement.getAttribute('data-participant');
        const source = audioElement.getAttribute('data-source');
        if (source === 'screen_share_audio') {
          const vol = participantId ? streamVolumesRef.current[participantId] ?? 1 : 1;
          const clamped = Math.min(1, Math.max(0, vol));
          audioElement.volume = clamped;
          audioElement.muted = clamped === 0;
        } else {
          const vol = participantId ? userVolumesRef.current[participantId] ?? currentVolumeRef.current : 1;
          if (vol > 1.0) {
            audioElement.volume = 0;
            audioElement.muted = true;
          } else {
            const clamped = Math.min(1, Math.max(0, vol));
            audioElement.volume = clamped;
            audioElement.muted = clamped === 0;
          }
        }
      }
    });
  }, [roomRef]);

  return {
    isDeafened,
    isDeafenedRef,
    setDeafened,
    streamVolumes,
    userVolumes,
    setStreamVolume,
    setUserVolume,
    setGlobalVolume,
    attachRemoteAudio,
    detachRemoteAudio,
    disposeAll,
  };
}
