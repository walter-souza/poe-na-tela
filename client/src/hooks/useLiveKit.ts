import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  LocalVideoTrack,
  LocalAudioTrack,
  VideoPresets,
  ConnectionState,
  type RemoteParticipant,
} from 'livekit-client';
import type { StreamQualityConfig, StreamStats, ChatMessage, ReactionEvent, ParticipantInfo, ScreenShareItem } from '../types';
import { playJoinSound, playLeaveSound } from '../utils/soundEffects';
import { startKeepAlive, stopKeepAlive } from '../utils/keepAlive';
import { isNoiseSuppressionSupported, NoiseSuppressionProcessor } from '../utils/noiseSuppression';

export interface UseLiveKitOptions {
  url: string;
  token: string;
  onDisconnected?: () => void;
}

export function useLiveKit({ url, token, onDisconnected }: UseLiveKitOptions) {
  const roomRef = useRef<Room | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  const isExplicitDisconnectRef = useRef(false);

  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isLocalScreenAudioMuted, setIsLocalScreenAudioMuted] = useState<boolean>(false);
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(false);
  const [isDeafened, setIsDeafened] = useState<boolean>(false);
  const isDeafenedRef = useRef<boolean>(false);
  const [canPlaybackAudio, setCanPlaybackAudio] = useState<boolean>(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [screenShares, setScreenShares] = useState<ScreenShareItem[]>([]);
  const [streamVolumes, setStreamVolumes] = useState<Record<string, number>>({});
  const streamVolumesRef = useRef<Record<string, number>>({});
  streamVolumesRef.current = streamVolumes;

  const USER_VOLUMES_STORAGE_KEY = 'poe-na-tela-user-volumes';
  const [userVolumes, setUserVolumes] = useState<Record<string, number>>(() => {
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
  });
  const userVolumesRef = useRef<Record<string, number>>({});
  userVolumesRef.current = userVolumes;

  // Dedicated Web Audio Boost Context for 101% - 200% voice amplification
  const boostAudioContextRef = useRef<AudioContext | null>(null);
  const audioBoostersRef = useRef<
    Map<string, { source: MediaStreamAudioSourceNode; gain: GainNode; stream: MediaStream }>
  >(new Map());

  const getBoostAudioContext = useCallback((): AudioContext => {
    if (!boostAudioContextRef.current || boostAudioContextRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      boostAudioContextRef.current = new AudioCtx({ sampleRate: 48000 });
    }
    if (boostAudioContextRef.current.state === 'suspended') {
      boostAudioContextRef.current.resume().catch(() => {});
    }
    return boostAudioContextRef.current;
  }, []);

  // Real-time Client-Side Voice Activity Detection (VAD) via Web Audio API (< 20ms response)
  interface VadNode {
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    buffer: Uint8Array<ArrayBuffer>;
    track: MediaStreamTrack;
  }

  const vadContextRef = useRef<AudioContext | null>(null);
  const vadNodesRef = useRef<Map<string, VadNode>>(new Map());
  const vadSpeakingMapRef = useRef<Map<string, boolean>>(new Map());
  const vadLastSpokeAtRef = useRef<Map<string, number>>(new Map());
  const vadIntervalRef = useRef<number | null>(null);

  const getVadAudioContext = useCallback((): AudioContext => {
    if (!vadContextRef.current || vadContextRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      vadContextRef.current = new AudioCtx({ sampleRate: 48000 });
    }
    if (vadContextRef.current.state === 'suspended') {
      vadContextRef.current.resume().catch(() => {});
    }
    return vadContextRef.current;
  }, []);

  const unregisterVadTrack = useCallback((identity?: string) => {
    if (!identity) return;
    const node = vadNodesRef.current.get(identity);
    if (node) {
      try {
        node.source.disconnect();
        node.analyser.disconnect();
      } catch {}
      vadNodesRef.current.delete(identity);
    }
    vadSpeakingMapRef.current.delete(identity);
    vadLastSpokeAtRef.current.delete(identity);
  }, []);

  const registerVadTrack = useCallback((identity: string, mediaTrack: MediaStreamTrack) => {
    if (!identity || !mediaTrack || mediaTrack.readyState === 'ended') return;

    const existing = vadNodesRef.current.get(identity);
    if (existing && existing.track === mediaTrack) return;

    unregisterVadTrack(identity);

    try {
      const ctx = getVadAudioContext();
      const stream = new MediaStream([mediaTrack]);
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64; // 32 frequency bins for minimal compute overhead
      analyser.smoothingTimeConstant = 0.2; // fast attack response
      analyser.minDecibels = -70;
      analyser.maxDecibels = -10;
      source.connect(analyser); // NOT connected to destination to avoid loopback/echo

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      vadNodesRef.current.set(identity, { source, analyser, buffer, track: mediaTrack });
    } catch (err) {
      console.warn(`[VAD] Failed to register track for ${identity}:`, err);
    }
  }, [getVadAudioContext, unregisterVadTrack]);

  const [remoteScreenTrack, setRemoteScreenTrack] = useState<Track | null>(null);
  const [localScreenTrack, setLocalScreenTrack] = useState<Track | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [reaction, setReaction] = useState<ReactionEvent | null>(null);
  const [hostName, setHostName] = useState<string>('');

  // Noise Suppression (RNNoise AI) - opt-in (desativado por padrão para voz 100% natural)
  const NOISE_SUPPRESSION_KEY = 'poe-na-tela-noise-suppression';
  const [isNoiseSuppressionEnabled, setIsNoiseSuppressionEnabledState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(NOISE_SUPPRESSION_KEY);
      return saved === 'true';
    } catch {
      return false;
    }
  });
  const isNoiseSuppressionEnabledRef = useRef<boolean>(false);
  isNoiseSuppressionEnabledRef.current = isNoiseSuppressionEnabled;
  const activeProcessorRef = useRef<NoiseSuppressionProcessor | null>(null);

  // WebRTC Playout / Jitter Buffer (Estabilizado padrão em 800ms [faixa de 600-1000ms] para máxima fluidez e zero congelamentos)
  const DEFAULT_STREAM_BUFFER_MS = 800;
  const [playoutBufferMs] = useState<number>(DEFAULT_STREAM_BUFFER_MS);
  const playoutBufferMsRef = useRef<number>(DEFAULT_STREAM_BUFFER_MS);

  const statsIntervalRef = useRef<number | null>(null);
  const prevStatsRef = useRef<{ bytes: number; frames: number; timestamp: number } | null>(null);
  const currentVolumeRef = useRef<number>(1);
  const desktopTracksRef = useRef<{ videoTrack?: LocalVideoTrack; audioTrack?: LocalAudioTrack }>({});

  const applyNoiseSuppression = useCallback(async (track: LocalAudioTrack, enable: boolean) => {
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

        const processor = new NoiseSuppressionProcessor();
        activeProcessorRef.current = processor;
        await track.setProcessor(processor);
      } else {
        if (activeProcessorRef.current || (track as any).processor) {
          await track.stopProcessor();
          activeProcessorRef.current = null;
        }
      }
    } catch (err) {
      console.error('Failed to apply noise suppression to track:', err);
      activeProcessorRef.current = null;
    }
  }, []);

  // Helper to apply volume (both native 0-100% and WebAudio boost 101-200%)
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
      const audioElements = document.querySelectorAll(
        `audio[data-participant="${participantIdentity}"][data-source="microphone"]`
      ) as NodeListOf<HTMLAudioElement>;

      if (clamped > 1.0 && !isDeafenedRef.current) {
        // Boosted (>100%): Mute native element so there is no echo/double audio
        audioElements.forEach((el) => {
          try {
            el.volume = 0;
            el.muted = true;
          } catch {}
        });

        // Find media track for booster
        let mediaTrack = (track as any)?.mediaStreamTrack;
        if (!mediaTrack && room) {
          const participant = room.remoteParticipants.get(participantIdentity);
          const micPub = participant?.getTrackPublication(Track.Source.Microphone);
          mediaTrack = micPub?.track?.mediaStreamTrack;
        }

        if (mediaTrack) {
          try {
            const ctx = getBoostAudioContext();
            let booster = audioBoostersRef.current.get(participantIdentity);
            if (!booster) {
              const stream = new MediaStream([mediaTrack]);
              const source = ctx.createMediaStreamSource(stream);
              const gain = ctx.createGain();
              source.connect(gain);
              gain.connect(ctx.destination);
              booster = { source, gain, stream };
              audioBoostersRef.current.set(participantIdentity, booster);
            }
            booster.gain.gain.setTargetAtTime(clamped, ctx.currentTime, 0.05);
          } catch (err) {
            console.warn('Failed to apply audio boost:', err);
            // Fallback: restore native audio to 100%
            audioElements.forEach((el) => {
              try {
                el.volume = 1;
                el.muted = false;
              } catch {}
            });
          }
        }
      } else {
        // Normal volume (0% to 100%) or deafened:
        const booster = audioBoostersRef.current.get(participantIdentity);
        if (booster) {
          try {
            booster.gain.disconnect();
            booster.source.disconnect();
          } catch {}
          audioBoostersRef.current.delete(participantIdentity);
        }

        audioElements.forEach((el) => {
          try {
            el.volume = isDeafenedRef.current ? 0 : nativeVol;
            el.muted = nativeVol === 0 || isDeafenedRef.current;
          } catch {}
        });
      }
    },
    [getBoostAudioContext]
  );

  // Helper to apply WebRTC playoutDelayHint & jitterBufferTarget to an individual track's receiver
  const applyReceiverPlayoutBuffer = useCallback((track: Track, bufferMs: number = DEFAULT_STREAM_BUFFER_MS) => {
    try {
      const isScreen =
        track.source === Track.Source.ScreenShare ||
        track.source === Track.Source.ScreenShareAudio;

      // Screen share video & game audio get the stabilized anti-freeze buffer (800ms).
      // Voice chat (microphone) stays at low latency (<= 150ms) to preserve natural conversation.
      const targetMs = isScreen ? bufferMs : Math.min(bufferMs, 150);
      const targetSec = targetMs / 1000;

      const receiver = (track as any).receiver as RTCRtpReceiver | undefined;
      if (receiver) {
        if ('playoutDelayHint' in receiver) {
          receiver.playoutDelayHint = targetSec;
        }
        if ('jitterBufferTarget' in receiver) {
          (receiver as any).jitterBufferTarget = targetMs;
        }
      }
    } catch (err) {
      console.warn('Failed to apply receiver buffer delay hint:', err);
    }
  }, []);

  // Helper to update all active receivers across the Room & PeerConnection
  const applyBufferToAllReceivers = useCallback((bufferMs: number = DEFAULT_STREAM_BUFFER_MS) => {
    const room = roomRef.current;
    if (!room) return;

    // 1. Through PeerConnection subscriber receivers
    try {
      const subPC =
        (room.engine as any)?.pcManager?.subscriber?.pc ||
        (room.engine as any)?.pcManager?.subscriber ||
        (room.engine as any)?.subscriber?.pc;

      if (subPC && typeof subPC.getReceivers === 'function') {
        const receivers = subPC.getReceivers() as RTCRtpReceiver[];
        const bufferSec = bufferMs / 1000;
        receivers.forEach((receiver) => {
          if ('playoutDelayHint' in receiver) {
            receiver.playoutDelayHint = bufferSec;
          }
          if ('jitterBufferTarget' in receiver) {
            (receiver as any).jitterBufferTarget = bufferMs;
          }
        });
      }
    } catch (e) {
      console.warn('Failed to update pc receivers buffer:', e);
    }

    // 2. Through remote participants published tracks
    room.remoteParticipants.forEach((p) => {
      p.trackPublications.forEach((pub) => {
        if (pub.track) {
          applyReceiverPlayoutBuffer(pub.track, bufferMs);
        }
      });
    });
  }, [applyReceiverPlayoutBuffer]);

  const setPlayoutBufferMs = useCallback((bufferMs: number) => {
    const clamped = Math.max(600, Math.min(1000, bufferMs));
    playoutBufferMsRef.current = clamped;
    applyBufferToAllReceivers(clamped);
  }, [applyBufferToAllReceivers]);

  // Update screen shares list from room participants
  const updateScreenShares = useCallback((room: Room) => {
    const list: ScreenShareItem[] = [];

    // Local screen share
    if (room.localParticipant) {
      const localVideoPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      const localAudioPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
      if (localVideoPub && localVideoPub.track) {
        list.push({
          id: room.localParticipant.identity,
          participantIdentity: room.localParticipant.identity,
          participantName: room.localParticipant.name || room.localParticipant.identity,
          videoTrack: localVideoPub.track,
          audioTrack: localAudioPub?.track,
          isLocal: true,
        });
      }
    }

    // Remote screen shares
    room.remoteParticipants.forEach((p) => {
      const videoPub = p.getTrackPublication(Track.Source.ScreenShare);
      const audioPub = p.getTrackPublication(Track.Source.ScreenShareAudio);
      if (videoPub && videoPub.track) {
        list.push({
          id: p.identity,
          participantIdentity: p.identity,
          participantName: p.name || p.identity,
          videoTrack: videoPub.track,
          audioTrack: audioPub?.track,
          isLocal: false,
        });
      }
    });

    setScreenShares(list);

    // Keep remoteScreenTrack / localScreenTrack synced for backwards compatibility
    const local = list.find((s) => s.isLocal);
    const remote = list.find((s) => !s.isLocal);
    setLocalScreenTrack(local?.videoTrack || null);
    setRemoteScreenTrack(remote?.videoTrack || null);
    if (list.length > 0) {
      setHostName(list[0].participantName);
    }
  }, []);

  // Update participant list with real-time VAD voice status
  const updateParticipantList = useCallback((room: Room) => {
    const list: ParticipantInfo[] = [];

    // Local participant
    if (room.localParticipant) {
      const localVad = vadSpeakingMapRef.current.get(room.localParticipant.identity);
      const isSpeaking = room.localParticipant.isMicrophoneEnabled
        ? (localVad !== undefined ? localVad : room.localParticipant.isSpeaking)
        : false;

      list.push({
        identity: room.localParticipant.identity,
        name: room.localParticipant.name || room.localParticipant.identity,
        isSpeaking,
        isScreenSharing: room.localParticipant.isScreenShareEnabled,
        isMuted: !room.localParticipant.isMicrophoneEnabled,
      });
    }

    // Remote participants
    room.remoteParticipants.forEach((p) => {
      const remoteVad = vadSpeakingMapRef.current.get(p.identity);
      const isSpeaking = remoteVad !== undefined ? remoteVad : p.isSpeaking;

      list.push({
        identity: p.identity,
        name: p.name || p.identity,
        isSpeaking,
        isScreenSharing: p.isScreenShareEnabled,
        isMuted: !p.isMicrophoneEnabled,
      });
    });

    setParticipants(list);
  }, []);

  // Real-time audio activity detector (runs every 40ms, updates React ONLY on state change)
  const checkAudioActivity = useCallback(() => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;

    const now = Date.now();
    let stateChanged = false;

    vadNodesRef.current.forEach((node, identity) => {
      if (node.track.readyState === 'ended') {
        unregisterVadTrack(identity);
        stateChanged = true;
        return;
      }

      // If local participant and mic is disabled, force not speaking
      if (identity === room.localParticipant?.identity && !room.localParticipant.isMicrophoneEnabled) {
        if (vadSpeakingMapRef.current.get(identity)) {
          vadSpeakingMapRef.current.set(identity, false);
          stateChanged = true;
        }
        return;
      }

      node.analyser.getByteFrequencyData(node.buffer as any);
      let sum = 0;
      let max = 0;
      for (let i = 0; i < node.buffer.length; i++) {
        const val = node.buffer[i];
        sum += val;
        if (val > max) max = val;
      }
      const avg = sum / node.buffer.length;

      // Sensitivity: avg > 8 or peak frequency > 35 indicates speech
      const isAboveThreshold = avg > 8 || max > 35;
      if (isAboveThreshold) {
        vadLastSpokeAtRef.current.set(identity, now);
      }

      const lastSpoke = vadLastSpokeAtRef.current.get(identity) || 0;
      const shouldBeSpeaking = now - lastSpoke < 350; // 350ms smooth hold time
      const currentSpeaking = vadSpeakingMapRef.current.get(identity) || false;

      if (shouldBeSpeaking !== currentSpeaking) {
        vadSpeakingMapRef.current.set(identity, shouldBeSpeaking);
        stateChanged = true;
      }
    });

    if (stateChanged) {
      updateParticipantList(room);
    }
  }, [unregisterVadTrack, updateParticipantList]);

  // WebRTC Real-time Stats Collector for both Host (publisher) and Viewer (subscriber)
  const collectStats = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;

    try {
      const pubPromise = (room.engine as any)?.pcManager?.publisher?.getStats?.();
      const subPromise = (room.engine as any)?.pcManager?.subscriber?.getStats?.();

      const [pubResult, subResult] = await Promise.allSettled([pubPromise, subPromise]);
      const reports: RTCStatsReport[] = [];
      if (pubResult.status === 'fulfilled' && pubResult.value) reports.push(pubResult.value);
      if (subResult.status === 'fulfilled' && subResult.value) reports.push(subResult.value);

      if (reports.length === 0) return;

      let rtt = 0;
      let packetLoss = 0;
      let fps = 0;
      let width = 0;
      let height = 0;
      let codec = 'VP9';
      let totalBytes = 0;
      let totalFrames = 0;
      let jitter = 0;
      let measuredBufferDelay: number | undefined;
      const now = Date.now();

      reports.forEach((rtcReport) => {
        rtcReport.forEach((report: any) => {
          // 1. Connection RTT (Latência)
          if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
            if (report.currentRoundTripTime !== undefined) {
              rtt = Math.round(report.currentRoundTripTime * 1000);
            }
          }

          // 2. Remote Inbound (Packet Loss and RTT from remote feedback)
          if (report.type === 'remote-inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            if (report.roundTripTime !== undefined && rtt === 0) {
              rtt = Math.round(report.roundTripTime * 1000);
            }
            if (report.fractionLost !== undefined && report.fractionLost > 0) {
              packetLoss = Math.max(packetLoss, (report.fractionLost / 256) * 100);
            }
            if (report.packetsLost !== undefined && report.packetsReceived) {
              const total = report.packetsLost + report.packetsReceived;
              if (total > 0) {
                packetLoss = Math.max(packetLoss, (report.packetsLost / total) * 100);
              }
            }
          }

          // 3. Inbound RTP (Viewer receiving video)
          if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            if (report.framesPerSecond) fps = Math.max(fps, Math.round(report.framesPerSecond));
            if (report.frameWidth) width = Math.max(width, report.frameWidth);
            if (report.frameHeight) height = Math.max(height, report.frameHeight);
            if (report.framesDecoded || report.framesReceived) {
              totalFrames = Math.max(totalFrames, report.framesDecoded || report.framesReceived);
            }
            if (report.bytesReceived) {
              totalBytes = Math.max(totalBytes, report.bytesReceived);
            }
            if (report.jitter !== undefined) {
              jitter = Math.round(report.jitter * 1000);
            }
            if (report.jitterBufferDelay !== undefined && report.jitterBufferEmittedCount) {
              measuredBufferDelay = Math.round(
                (report.jitterBufferDelay / report.jitterBufferEmittedCount) * 1000
              );
            }
            if (report.packetsLost !== undefined && report.packetsReceived) {
              const total = report.packetsLost + report.packetsReceived;
              if (total > 0) {
                packetLoss = Math.max(packetLoss, (report.packetsLost / total) * 100);
              }
            }
            if (report.codecId) {
              const codecReport = rtcReport.get(report.codecId);
              if (codecReport && codecReport.mimeType) {
                codec = codecReport.mimeType.replace('video/', '').toUpperCase();
              }
            }
          }

          // 4. Outbound RTP (Host sending video)
          if (report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            if (report.framesPerSecond) fps = Math.max(fps, Math.round(report.framesPerSecond));
            if (report.frameWidth) width = Math.max(width, report.frameWidth);
            if (report.frameHeight) height = Math.max(height, report.frameHeight);
            if (report.framesSent || report.framesEncoded) {
              totalFrames = Math.max(totalFrames, report.framesSent || report.framesEncoded);
            }
            if (report.bytesSent) {
              totalBytes = Math.max(totalBytes, report.bytesSent);
            }
            if (report.codecId) {
              const codecReport = rtcReport.get(report.codecId);
              if (codecReport && codecReport.mimeType) {
                codec = codecReport.mimeType.replace('video/', '').toUpperCase();
              }
            }
          }
        });
      });

      // Calculate Bitrate and FPS from deltas if not directly reported
      let bitrate = 0;
      if (prevStatsRef.current && totalBytes > 0) {
        const timeDiffSec = (now - prevStatsRef.current.timestamp) / 1000;
        const bytesDiff = totalBytes - prevStatsRef.current.bytes;
        const framesDiff = totalFrames - prevStatsRef.current.frames;

        if (timeDiffSec > 0.4 && bytesDiff >= 0) {
          bitrate = Math.round((bytesDiff * 8) / timeDiffSec / 1000);
        }

        if (fps === 0 && timeDiffSec > 0.4 && framesDiff > 0) {
          fps = Math.round(framesDiff / timeDiffSec);
        }
      }

      prevStatsRef.current = { bytes: totalBytes, frames: totalFrames, timestamp: now };

      if (width === 0 || height === 0) {
        width = 1920;
        height = 1080;
      }

      setStats({
        bitrateKbps: bitrate,
        rttMs: rtt,
        packetLossPercent: parseFloat(packetLoss.toFixed(1)),
        fps: fps || (totalBytes > 0 ? 60 : 0),
        width,
        height,
        codec,
        jitterMs: jitter,
        bufferDelayMs: measuredBufferDelay ?? playoutBufferMsRef.current,
        playoutBufferMs: playoutBufferMsRef.current,
        bytesReceivedOrSent: totalBytes,
      });
    } catch {
      // Ignore stats collection error during renegotiations
    }
  }, []);

  // Connect to room
  useEffect(() => {
    if (!url || !token) return;

    let isSubscribed = true;
    isExplicitDisconnectRef.current = false;

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        autoGainControl: true,
        noiseSuppression: true,
        echoCancellation: true,
      },
      videoCaptureDefaults: {
        resolution: VideoPresets.h1080.resolution,
      },
      publishDefaults: {
        videoCodec: 'h264',
        screenShareEncoding: {
          maxBitrate: 8000000,
          maxFramerate: 60,
          priority: 'high',
        },
        audioPreset: {
          maxBitrate: 192000,
          priority: 'high',
        },
        dtx: false,
        red: true,
        simulcast: true,
      },
    });

    roomRef.current = room;

    const handleConnected = () => {
      if (!isSubscribed) return;
      setConnectionState(ConnectionState.Connected);
      updateParticipantList(room);
      updateScreenShares(room);

      setMessages((prev) => [
        ...prev,
        {
          id: `system-welcome-${Date.now()}`,
          sender: 'Sistema',
          text: 'Você entrou na sala',
          timestamp: Date.now(),
          isSystem: true,
        },
      ]);

      // Attempt unlocking browser audio autoplay
      room.startAudio().catch(() => {});
      setCanPlaybackAudio(room.canPlaybackAudio);

      // Start real-time Client-Side VAD (< 20ms response)
      try {
        getVadAudioContext();
        room.remoteParticipants.forEach((p) => {
          const micPub = p.getTrackPublication(Track.Source.Microphone);
          if (micPub?.track?.mediaStreamTrack) {
            registerVadTrack(p.identity, micPub.track.mediaStreamTrack);
          }
        });
        const localMicPub = room.localParticipant?.getTrackPublication(Track.Source.Microphone);
        if (localMicPub?.track?.mediaStreamTrack) {
          registerVadTrack(room.localParticipant.identity, localMicPub.track.mediaStreamTrack);
        }
        if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
        vadIntervalRef.current = window.setInterval(checkAudioActivity, 40);
      } catch (vadErr) {
        console.warn('Failed to start VAD on connect:', vadErr);
      }

      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = window.setInterval(collectStats, 1000);
    };

    const handleDisconnected = () => {
      if (!isSubscribed) return;
      setConnectionState(ConnectionState.Disconnected);
      setIsScreenSharing(false);
      setRemoteScreenTrack(null);
      setLocalScreenTrack(null);
      setScreenShares([]);
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);

      if (vadIntervalRef.current) {
        clearInterval(vadIntervalRef.current);
        vadIntervalRef.current = null;
      }
      vadNodesRef.current.forEach((node) => {
        try {
          node.source.disconnect();
          node.analyser.disconnect();
        } catch {}
      });
      vadNodesRef.current.clear();
      vadSpeakingMapRef.current.clear();
      vadLastSpokeAtRef.current.clear();

      if (isExplicitDisconnectRef.current) {
        onDisconnectedRef.current?.();
      }
    };

    const handleReconnecting = () => setConnectionState(ConnectionState.Reconnecting);
    const handleReconnected = () => {
      setConnectionState(ConnectionState.Connected);
      updateParticipantList(room);
      updateScreenShares(room);
      applyBufferToAllReceivers(playoutBufferMsRef.current);
    };

    const handleAudioPlaybackStatusChanged = () => {
      if (!isSubscribed) return;
      setCanPlaybackAudio(room.canPlaybackAudio);
    };

    // ATTACH REMOTE TRACKS (AUDIO & VIDEO)
    const handleTrackSubscribed = (
      track: Track,
      _publication: any,
      participant: RemoteParticipant
    ) => {
      if (!isSubscribed) return;

      // Apply playout buffer hint to remote track for smooth 60 FPS playback
      applyReceiverPlayoutBuffer(track, playoutBufferMsRef.current);

      // Automatically attach and play remote audio (Microphone & Screen Audio)
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        const isScreenAudio = track.source === Track.Source.ScreenShareAudio;
        el.setAttribute('data-livekit-track', track.sid || track.kind);
        el.setAttribute('data-participant', participant.identity);
        el.setAttribute('data-source', isScreenAudio ? 'screen_share_audio' : 'microphone');

        if (isScreenAudio) {
          const streamVol = streamVolumesRef.current[participant.identity] !== undefined
            ? streamVolumesRef.current[participant.identity]
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
          // Voice Microphone track: check individual userVolumesRef or fallback to currentVolumeRef
          const voiceVol = userVolumesRef.current[participant.identity] !== undefined
            ? userVolumesRef.current[participant.identity]
            : currentVolumeRef.current;

          applyParticipantVolume(participant.identity, voiceVol, track);

          // Register in real-time VAD for 0ms voice activity feedback
          if (track.mediaStreamTrack) {
            registerVadTrack(participant.identity, track.mediaStreamTrack);
          }
        }
      }

      updateParticipantList(room);
      updateScreenShares(room);
    };

    const handleTrackUnsubscribed = (track: Track, _pub?: any, participant?: RemoteParticipant) => {
      if (!isSubscribed) return;

      if (track.kind === Track.Kind.Audio) {
        track.detach();
        const participantId = participant?.identity;
        if (participantId) {
          if (track.source !== Track.Source.ScreenShareAudio) {
            unregisterVadTrack(participantId);
          }
          const booster = audioBoostersRef.current.get(participantId);
          if (booster) {
            try {
              booster.gain.disconnect();
              booster.source.disconnect();
            } catch {}
            audioBoostersRef.current.delete(participantId);
          }
        }
      }

      updateParticipantList(room);
      updateScreenShares(room);
    };

    const handleDataReceived = (payload: Uint8Array, participant?: RemoteParticipant) => {
      if (!isSubscribed) return;
      try {
        const decoded = new TextDecoder().decode(payload);
        const data = JSON.parse(decoded);

        if (data.type === 'chat') {
          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random()}`,
              sender: participant?.name || participant?.identity || data.sender || 'Amigo',
              text: data.text,
              timestamp: Date.now(),
              isHost: data.isHost,
            },
          ]);
        } else if (data.type === 'reaction') {
          setReaction({
            emoji: data.emoji,
            sender: participant?.name || participant?.identity || 'Amigo',
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error('Failed to parse received data channel payload', err);
      }
    };

    const handleParticipantConnected = (participant: RemoteParticipant) => {
      if (!isSubscribed) return;
      updateParticipantList(room);
      updateScreenShares(room);
      const name = participant.name || participant.identity || 'Um usuário';
      setMessages((prev) => [
        ...prev,
        {
          id: `system-join-${Date.now()}-${Math.random()}`,
          sender: 'Sistema',
          text: `${name} entrou na sala`,
          timestamp: Date.now(),
          isSystem: true,
        },
      ]);

      // Play join notification sound if not self and not deafened
      if (participant.identity !== room.localParticipant?.identity && !isDeafenedRef.current) {
        playJoinSound();
      }
    };

    const handleParticipantDisconnected = (participant: RemoteParticipant) => {
      if (!isSubscribed) return;
      unregisterVadTrack(participant.identity);
      updateParticipantList(room);
      updateScreenShares(room);
      const name = participant.name || participant.identity || 'Um usuário';
      setMessages((prev) => [
        ...prev,
        {
          id: `system-leave-${Date.now()}-${Math.random()}`,
          sender: 'Sistema',
          text: `${name} saiu da sala`,
          timestamp: Date.now(),
          isSystem: true,
        },
      ]);

      // Play leave notification sound if not self and not deafened
      if (participant.identity !== room.localParticipant?.identity && !isDeafenedRef.current) {
        playLeaveSound();
      }
    };

    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.Reconnecting, handleReconnecting);
    room.on(RoomEvent.Reconnected, handleReconnected);
    room.on(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged);
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    room.on(RoomEvent.TrackPublished, () => updateScreenShares(room));
    room.on(RoomEvent.TrackUnpublished, () => updateScreenShares(room));
    room.on(RoomEvent.LocalTrackPublished, (pub) => {
      updateScreenShares(room);
      if (pub.source === Track.Source.Microphone && pub.track?.mediaStreamTrack) {
        registerVadTrack(room.localParticipant.identity, pub.track.mediaStreamTrack);
      }
    });
    room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
      updateScreenShares(room);
      if (pub.source === Track.Source.Microphone) {
        unregisterVadTrack(room.localParticipant?.identity);
      }
    });
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    room.on(RoomEvent.ActiveSpeakersChanged, () => updateParticipantList(room));
    room.on(RoomEvent.DataReceived, handleDataReceived);

    room.connect(url, token).catch((err: any) => {
      if (!isSubscribed) return;
      if (err?.message?.includes('Client initiated disconnect')) {
        return;
      }
      console.error('Error connecting to LiveKit room:', err);
      setConnectionState(ConnectionState.Disconnected);
    });

    return () => {
      isSubscribed = false;
      stopKeepAlive();
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      if (vadIntervalRef.current) {
        clearInterval(vadIntervalRef.current);
        vadIntervalRef.current = null;
      }
      vadNodesRef.current.forEach((node) => {
        try {
          node.source.disconnect();
          node.analyser.disconnect();
        } catch {}
      });
      vadNodesRef.current.clear();
      vadSpeakingMapRef.current.clear();
      vadLastSpokeAtRef.current.clear();
      if (vadContextRef.current && vadContextRef.current.state !== 'closed') {
        vadContextRef.current.close().catch(() => {});
        vadContextRef.current = null;
      }
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged);
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      if (activeProcessorRef.current) {
        activeProcessorRef.current.destroy().catch(() => {});
        activeProcessorRef.current = null;
      }
      audioBoostersRef.current.forEach((booster) => {
        try {
          booster.gain.disconnect();
          booster.source.disconnect();
        } catch {}
      });
      audioBoostersRef.current.clear();
      if (boostAudioContextRef.current && boostAudioContextRef.current.state !== 'closed') {
        boostAudioContextRef.current.close().catch(() => {});
        boostAudioContextRef.current = null;
      }
      room.disconnect();
    };
  }, [
    url,
    token,
    collectStats,
    updateParticipantList,
    updateScreenShares,
    checkAudioActivity,
    getVadAudioContext,
    registerVadTrack,
    unregisterVadTrack,
  ]);

  // Unlock browser audio autoplay policy
  const unlockAudio = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
      setCanPlaybackAudio(room.canPlaybackAudio);
      if (vadContextRef.current?.state === 'suspended') {
        await vadContextRef.current.resume().catch(() => {});
      }
    } catch (e) {
      console.error('Failed to unlock audio playback:', e);
    }
  };

  // Set individual stream audio volume (ONLY affects ScreenShareAudio, keeping Microphone voice intact)
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
  }, []);

  // Set individual participant microphone audio volume (ONLY affects local hearing of that participant's voice)
  // Supports volume range from 0 to 2.0 (0% to 200%, where 1.0 is 100% normal)
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

  // Set global audio volume for all remote participants and audio elements
  const setGlobalVolume = (volume: number) => {
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
  };

  // Start Screen Sharing with high-fidelity stereo audio capture (Cinema / Gaming / Music mode)
  const startScreenShare = async (config?: Partial<StreamQualityConfig>) => {
    const room = roomRef.current;
    if (!room) return;

    try {
      const targetFps = config?.frameRate || 60;
      const is60Fps = targetFps === 60;
      const shouldIncludeAudio = config?.includeAudio ?? true;
      const shouldIsolateRoomAudio = config?.isolateRoomAudio ?? true;

      const targetBitrate = config?.bitrateKbps
        ? config.bitrateKbps * 1000
        : config?.resolution === '4k'
        ? (is60Fps ? 14000000 : 8000000)
        : config?.resolution === '1440p'
        ? (is60Fps ? 9000000 : 5500000)
        : config?.resolution === '1080p'
        ? (is60Fps ? 6000000 : 3600000)
        : (is60Fps ? 3500000 : 2200000);

      const screenResolution =
        config?.resolution === '4k'
          ? { width: 3840, height: 2160, frameRate: targetFps }
          : config?.resolution === '1440p'
          ? { width: 2560, height: 1440, frameRate: targetFps }
          : config?.resolution === '720p'
          ? { width: 1280, height: 720, frameRate: targetFps }
          : { width: 1920, height: 1080, frameRate: targetFps };

      // 1. Check if running in native Desktop App with selected source
      if (typeof window !== 'undefined' && window.desktopAPI?.isDesktop && config?.sourceId) {
        const desktopConstraints: any = {
          audio: shouldIncludeAudio
            ? {
                mandatory: {
                  chromeMediaSource: 'desktop',
                },
              }
            : false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: config.sourceId,
              minWidth: screenResolution.width,
              maxWidth: screenResolution.width,
              minHeight: screenResolution.height,
              maxHeight: screenResolution.height,
              minFrameRate: Math.min(30, targetFps),
              maxFrameRate: targetFps,
            },
            optional: [
              { minFrameRate: Math.min(30, targetFps) },
              { maxFrameRate: targetFps },
              { frameRate: targetFps },
            ],
          },
        };

        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia(desktopConstraints);
        } catch (mediaErr) {
          console.warn('Desktop getUserMedia with audio failed, falling back to video-only capture:', mediaErr);
          const videoOnlyConstraints: any = {
            audio: false,
            video: desktopConstraints.video,
          };
          mediaStream = await navigator.mediaDevices.getUserMedia(videoOnlyConstraints);
        }
        const videoMediaTrack = mediaStream.getVideoTracks()[0];
        const audioMediaTrack = mediaStream.getAudioTracks()[0];

        if (videoMediaTrack) {
          videoMediaTrack.contentHint = config?.contentHint || 'motion';
          const localVideoTrack = new LocalVideoTrack(videoMediaTrack);

          await room.localParticipant.publishTrack(localVideoTrack, {
            name: 'screen_share',
            source: Track.Source.ScreenShare,
            videoCodec: (config?.codec as any) || 'h264',
            videoEncoding: {
              maxBitrate: targetBitrate,
              maxFramerate: targetFps,
              priority: 'high',
            },
            simulcast: true,
          });

          try {
            const sender = (localVideoTrack as any).sender as RTCRtpSender;
            if (sender && typeof sender.getParameters === 'function') {
              const params = sender.getParameters();
              if (params) {
                params.degradationPreference = 'balanced';
                if (params.encodings && params.encodings.length > 0) {
                  params.encodings[0].maxFramerate = targetFps;
                  params.encodings[0].maxBitrate = targetBitrate;
                  params.encodings[0].networkPriority = 'high';
                  params.encodings[0].priority = 'high';
                }
                await sender.setParameters(params);
              }
            }
          } catch (e) {
            // Non-critical
          }

          desktopTracksRef.current.videoTrack = localVideoTrack;
          setLocalScreenTrack(localVideoTrack);
        }

        if (audioMediaTrack && shouldIncludeAudio) {
          audioMediaTrack.contentHint = 'music';
          const localAudioTrack = new LocalAudioTrack(audioMediaTrack);

          await room.localParticipant.publishTrack(localAudioTrack, {
            name: 'screen_share_audio',
            source: Track.Source.ScreenShareAudio,
            audioPreset: { maxBitrate: 192000, priority: 'high' },
            dtx: false,
            red: true,
          });

          desktopTracksRef.current.audioTrack = localAudioTrack;
        }

        setIsScreenSharing(true);
        setIsLocalScreenAudioMuted(false);
        setHostName(room.localParticipant.name || room.localParticipant.identity);
        startKeepAlive();
        updateScreenShares(room);
        return;
      }

      // 2. Browser Standard getDisplayMedia capture
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          audio: shouldIncludeAudio
            ? {
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
                channelCount: 2,
                sampleRate: 48000,
                restrictOwnAudio: shouldIsolateRoomAudio,
              }
            : false,
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          systemAudio: 'include',
          suppressLocalAudioPlayback: false,
          resolution: screenResolution,
        },
        {
          audioPreset: {
            maxBitrate: 192000,
            priority: 'high',
          },
          dtx: false,
          red: true,
          simulcast: true,
          videoCodec: (config?.codec as any) || 'h264',
          videoEncoding: {
            maxBitrate: targetBitrate,
            maxFramerate: targetFps,
            priority: 'high',
          },
        }
      );

      // Force 'music' contentHint on screen audio track for full cinema/music dynamic range
      const audioPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
      if (audioPub?.track?.mediaStreamTrack) {
        audioPub.track.mediaStreamTrack.contentHint = 'music';
      }

      const videoTrackPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (videoTrackPub && videoTrackPub.track) {
        const mediaTrack = videoTrackPub.track.mediaStreamTrack;

        // Determine effective contentHint and degradation preference:
        const isDetailMode = config?.contentHint === 'detail';
        const effectiveContentHint = isDetailMode ? 'detail' : (config?.contentHint || 'motion');

        if (mediaTrack) {
          mediaTrack.contentHint = effectiveContentHint;
        }

        // Apply degradation preference & encoding parameters to allow smooth adaptation under network stress without freezing
        try {
          const sender = (videoTrackPub.track as any).sender as RTCRtpSender;
          if (sender && typeof sender.getParameters === 'function') {
            const params = sender.getParameters();
            if (params) {
              // For detail mode: maintain-resolution guarantees crisp native text.
              // For motion/games mode: balanced dynamically trades off bitrate and framerate without stalling playback.
              params.degradationPreference = isDetailMode ? 'maintain-resolution' : 'balanced';

              if (params.encodings && params.encodings.length > 0) {
                params.encodings[0].maxFramerate = targetFps;
                params.encodings[0].maxBitrate = targetBitrate;
                params.encodings[0].networkPriority = 'high';
                params.encodings[0].priority = 'high';
              }
              await sender.setParameters(params);
            }
          }
        } catch (e) {
          // Non-critical fallback
        }

        setLocalScreenTrack(videoTrackPub.track);
        setIsScreenSharing(true);
        setIsLocalScreenAudioMuted(false);
        setHostName(room.localParticipant.name || room.localParticipant.identity);
        startKeepAlive();
      }
      updateScreenShares(room);
    } catch (err) {
      console.error('Failed to start screen share:', err);
      setIsScreenSharing(false);
      setIsLocalScreenAudioMuted(false);
      stopKeepAlive();
    }
  };

  const stopScreenShare = async () => {
    stopKeepAlive();
    const room = roomRef.current;
    if (!room) return;

    if (desktopTracksRef.current.videoTrack || desktopTracksRef.current.audioTrack) {
      if (desktopTracksRef.current.videoTrack) {
        try {
          await room.localParticipant.unpublishTrack(desktopTracksRef.current.videoTrack);
          desktopTracksRef.current.videoTrack.stop();
        } catch {}
      }
      if (desktopTracksRef.current.audioTrack) {
        try {
          await room.localParticipant.unpublishTrack(desktopTracksRef.current.audioTrack);
          desktopTracksRef.current.audioTrack.stop();
        } catch {}
      }
      desktopTracksRef.current = {};
    } else {
      await room.localParticipant.setScreenShareEnabled(false);
    }

    setIsScreenSharing(false);
    setIsLocalScreenAudioMuted(false);
    setLocalScreenTrack(null);
    updateScreenShares(room);
  };

  // Toggle local screen share audio (Host mutes/unmutes outgoing screen sound without muting their mic)
  const toggleLocalScreenAudio = () => {
    const room = roomRef.current;
    if (!room || !room.localParticipant) return;

    if (desktopTracksRef.current.audioTrack?.mediaStreamTrack) {
      const nextMute = !isLocalScreenAudioMuted;
      desktopTracksRef.current.audioTrack.mediaStreamTrack.enabled = !nextMute;
      setIsLocalScreenAudioMuted(nextMute);
      return;
    }

    const audioPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
    if (audioPub && audioPub.track && audioPub.track.mediaStreamTrack) {
      const nextMute = !isLocalScreenAudioMuted;
      audioPub.track.mediaStreamTrack.enabled = !nextMute;
      setIsLocalScreenAudioMuted(nextMute);
    }
  };

  // Toggle Microphone
  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;

    try {
      const nextState = !isMicEnabled;
      const pub = await room.localParticipant.setMicrophoneEnabled(nextState, {
        echoCancellation: true,
        noiseSuppression: !isNoiseSuppressionEnabledRef.current,
        autoGainControl: true,
      });
      setIsMicEnabled(nextState);
      if (nextState) {
        const localTrack = pub?.track as LocalAudioTrack | undefined;
        if (localTrack?.mediaStreamTrack) {
          registerVadTrack(room.localParticipant.identity, localTrack.mediaStreamTrack);
        }
        if (isNoiseSuppressionEnabledRef.current && pub?.track) {
          try {
            await applyNoiseSuppression(pub.track as LocalAudioTrack, true);
          } catch (suppressErr) {
            console.warn('Noise suppression could not be applied, continuing with raw mic:', suppressErr);
          }
        }
      } else {
        unregisterVadTrack(room.localParticipant.identity);
      }
      updateParticipantList(room);
    } catch (err) {
      console.error('Failed to toggle microphone:', err);
    }
  };

  // Toggle Noise Suppression (AI RNNoise)
  const toggleNoiseSuppression = useCallback(async () => {
    const next = !isNoiseSuppressionEnabled;
    setIsNoiseSuppressionEnabledState(next);
    isNoiseSuppressionEnabledRef.current = next;
    try {
      localStorage.setItem(NOISE_SUPPRESSION_KEY, String(next));
    } catch {}

    const room = roomRef.current;
    if (!room) return;

    const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const micTrack = micPub?.track as LocalAudioTrack | undefined;
    if (micTrack) {
      await applyNoiseSuppression(micTrack, next);
    }
  }, [isNoiseSuppressionEnabled, applyNoiseSuppression]);

  // Toggle Deafen
  const toggleDeafen = () => {
    const nextDeafen = !isDeafened;
    setIsDeafened(nextDeafen);
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
  };

  // Send Live Chat Message
  const sendMessage = async (text: string) => {
    const room = roomRef.current;
    if (!room || !text.trim()) return;

    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random()}`,
      sender: room.localParticipant.name || room.localParticipant.identity,
      text: text.trim(),
      timestamp: Date.now(),
      isHost: isScreenSharing,
    };

    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'chat',
        text: msg.text,
        sender: msg.sender,
        isHost: isScreenSharing,
      })
    );

    await room.localParticipant.publishData(payload, { reliable: true });
    setMessages((prev) => [...prev, msg]);
  };

  // Send Reaction / Emoji
  const sendReaction = async (emoji: string) => {
    const room = roomRef.current;
    if (!room) return;

    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'reaction',
        emoji,
      })
    );

    await room.localParticipant.publishData(payload, { reliable: false });
    setReaction({
      emoji,
      sender: room.localParticipant.name || room.localParticipant.identity,
      timestamp: Date.now(),
    });
  };

  const handleManualDisconnect = () => {
    isExplicitDisconnectRef.current = true;
    stopKeepAlive();
    if (activeProcessorRef.current) {
      activeProcessorRef.current.destroy().catch(() => {});
      activeProcessorRef.current = null;
    }
    audioBoostersRef.current.forEach((booster) => {
      try {
        booster.gain.disconnect();
        booster.source.disconnect();
      } catch {}
    });
    audioBoostersRef.current.clear();
    if (boostAudioContextRef.current && boostAudioContextRef.current.state !== 'closed') {
      boostAudioContextRef.current.close().catch(() => {});
      boostAudioContextRef.current = null;
    }
    roomRef.current?.disconnect();
  };

  return {
    room: roomRef.current,
    connectionState,
    isScreenSharing,
    isLocalScreenAudioMuted,
    isMicEnabled,
    isDeafened,
    isNoiseSuppressionEnabled,
    isNoiseSuppressionSupported: isNoiseSuppressionSupported(),
    canPlaybackAudio,
    unlockAudio,
    setGlobalVolume,
    setStreamVolume,
    streamVolumes,
    setUserVolume,
    userVolumes,
    screenShares,
    messages,
    participants,
    remoteScreenTrack,
    localScreenTrack,
    stats,
    playoutBufferMs,
    setPlayoutBufferMs,
    reaction,
    hostName,
    startScreenShare,
    stopScreenShare,
    toggleLocalScreenAudio,
    toggleMic,
    toggleDeafen,
    toggleNoiseSuppression,
    sendMessage,
    sendReaction,
    disconnect: handleManualDisconnect,
  };
}
