import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  ScreenSharePresets,
  ConnectionState,
  type RemoteParticipant,
} from 'livekit-client';
import type { StreamQualityConfig, StreamStats, ChatMessage, ReactionEvent, ParticipantInfo, ScreenShareItem } from '../types';

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

  const [remoteScreenTrack, setRemoteScreenTrack] = useState<Track | null>(null);
  const [localScreenTrack, setLocalScreenTrack] = useState<Track | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [reaction, setReaction] = useState<ReactionEvent | null>(null);
  const [hostName, setHostName] = useState<string>('');

  const statsIntervalRef = useRef<number | null>(null);
  const prevStatsRef = useRef<{ bytes: number; frames: number; timestamp: number } | null>(null);
  const currentVolumeRef = useRef<number>(1);

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

  // Update participant list
  const updateParticipantList = useCallback((room: Room) => {
    const list: ParticipantInfo[] = [];

    // Local participant
    if (room.localParticipant) {
      list.push({
        identity: room.localParticipant.identity,
        name: room.localParticipant.name || room.localParticipant.identity,
        isSpeaking: room.localParticipant.isSpeaking,
        isScreenSharing: room.localParticipant.isScreenShareEnabled,
        isMuted: !room.localParticipant.isMicrophoneEnabled,
      });
    }

    // Remote participants
    room.remoteParticipants.forEach((p) => {
      list.push({
        identity: p.identity,
        name: p.name || p.identity,
        isSpeaking: p.isSpeaking,
        isScreenSharing: p.isScreenShareEnabled,
        isMuted: !p.isMicrophoneEnabled,
      });
    });

    setParticipants(list);
  }, []);

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
        jitterMs: 0,
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
      videoCaptureDefaults: {
        resolution: VideoPresets.h1080.resolution,
      },
      publishDefaults: {
        videoCodec: 'vp9',
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
        simulcast: false,
      },
    });

    roomRef.current = room;

    const handleConnected = () => {
      if (!isSubscribed) return;
      setConnectionState(ConnectionState.Connected);
      updateParticipantList(room);
      updateScreenShares(room);

      // Attempt unlocking browser audio autoplay
      room.startAudio().catch(() => {});
      setCanPlaybackAudio(room.canPlaybackAudio);

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

      if (isExplicitDisconnectRef.current) {
        onDisconnectedRef.current?.();
      }
    };

    const handleReconnecting = () => setConnectionState(ConnectionState.Reconnecting);
    const handleReconnected = () => {
      setConnectionState(ConnectionState.Connected);
      updateParticipantList(room);
      updateScreenShares(room);
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

      // Automatically attach and play remote audio (Microphone & Screen Audio)
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        el.setAttribute('data-livekit-track', track.sid || track.kind);
        el.setAttribute('data-participant', participant.identity);

        const currentVol = streamVolumesRef.current[participant.identity] !== undefined
          ? streamVolumesRef.current[participant.identity]
          : currentVolumeRef.current;

        if ('setVolume' in track) {
          (track as any).setVolume(currentVol);
        }
        if (el) {
          (el as HTMLAudioElement).volume = currentVol;
          (el as HTMLAudioElement).muted = currentVol === 0 || isDeafenedRef.current;
        }
      }

      updateParticipantList(room);
      updateScreenShares(room);
    };

    const handleTrackUnsubscribed = (track: Track) => {
      if (!isSubscribed) return;

      if (track.kind === Track.Kind.Audio) {
        track.detach();
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

    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.Reconnecting, handleReconnecting);
    room.on(RoomEvent.Reconnected, handleReconnected);
    room.on(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged);
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    room.on(RoomEvent.TrackPublished, () => updateScreenShares(room));
    room.on(RoomEvent.TrackUnpublished, () => updateScreenShares(room));
    room.on(RoomEvent.LocalTrackPublished, () => updateScreenShares(room));
    room.on(RoomEvent.LocalTrackUnpublished, () => updateScreenShares(room));
    room.on(RoomEvent.ParticipantConnected, () => {
      updateParticipantList(room);
      updateScreenShares(room);
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      updateParticipantList(room);
      updateScreenShares(room);
    });
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
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged);
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.disconnect();
    };
  }, [url, token, collectStats, updateParticipantList, updateScreenShares]);

  // Unlock browser audio autoplay policy
  const unlockAudio = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
      setCanPlaybackAudio(room.canPlaybackAudio);
    } catch (e) {
      console.error('Failed to unlock audio playback:', e);
    }
  };

  // Set individual stream/participant audio volume
  const setStreamVolume = useCallback((participantIdentity: string, volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setStreamVolumes((prev) => ({ ...prev, [participantIdentity]: clamped }));

    const room = roomRef.current;
    if (!room) return;

    // Local participant does not need audio playback adjustment
    if (room.localParticipant?.identity === participantIdentity) return;

    const participant = room.remoteParticipants.get(participantIdentity);
    if (participant) {
      participant.setVolume(clamped, Track.Source.Microphone);
      participant.setVolume(clamped, Track.Source.ScreenShareAudio);
      participant.audioTrackPublications.forEach((pub) => {
        if (pub.track && 'setVolume' in pub.track) {
          (pub.track as any).setVolume(clamped);
        }
      });
    }

    document.querySelectorAll(`audio[data-participant="${participantIdentity}"]`).forEach((el) => {
      (el as HTMLAudioElement).volume = clamped;
      (el as HTMLAudioElement).muted = clamped === 0 || isDeafenedRef.current;
    });
  }, []);

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

  // Start Screen Sharing with audio capture
  const startScreenShare = async (config?: Partial<StreamQualityConfig>) => {
    const room = roomRef.current;
    if (!room) return;

    try {
      const targetFps = config?.frameRate || 60;
      const shouldIncludeAudio = config?.includeAudio ?? true;

      await room.localParticipant.setScreenShareEnabled(true, {
        audio: shouldIncludeAudio,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'include',
        systemAudio: 'include',
        resolution: config?.resolution === '4k'
          ? VideoPresets.h2160.resolution
          : config?.resolution === '1440p'
          ? { width: 2560, height: 1440, frameRate: targetFps }
          : config?.resolution === '720p'
          ? VideoPresets.h720.resolution
          : VideoPresets.h1080.resolution,
      });

      const videoTrackPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (videoTrackPub && videoTrackPub.track) {
        setLocalScreenTrack(videoTrackPub.track);
        setIsScreenSharing(true);
        setHostName(room.localParticipant.name || room.localParticipant.identity);
      }
      updateScreenShares(room);
    } catch (err) {
      console.error('Failed to start screen share:', err);
      setIsScreenSharing(false);
    }
  };

  const stopScreenShare = async () => {
    const room = roomRef.current;
    if (!room) return;

    await room.localParticipant.setScreenShareEnabled(false);
    setIsScreenSharing(false);
    setLocalScreenTrack(null);
    updateScreenShares(room);
  };

  // Toggle Microphone
  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;

    const nextState = !isMicEnabled;
    await room.localParticipant.setMicrophoneEnabled(nextState, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    setIsMicEnabled(nextState);
    updateParticipantList(room);
  };

  // Toggle Deafen
  const toggleDeafen = () => {
    const nextDeafen = !isDeafened;
    setIsDeafened(nextDeafen);
    isDeafenedRef.current = nextDeafen;

    const room = roomRef.current;
    if (!room) return;

    room.remoteParticipants.forEach((p) => {
      p.audioTrackPublications.forEach((pub) => {
        if (pub.track) {
          pub.track.mediaStreamTrack.enabled = !nextDeafen;
        }
      });
    });

    document.querySelectorAll('audio').forEach((el) => {
      (el as HTMLAudioElement).muted = nextDeafen;
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
    roomRef.current?.disconnect();
  };

  return {
    room: roomRef.current,
    connectionState,
    isScreenSharing,
    isMicEnabled,
    isDeafened,
    canPlaybackAudio,
    unlockAudio,
    setGlobalVolume,
    setStreamVolume,
    streamVolumes,
    screenShares,
    messages,
    participants,
    remoteScreenTrack,
    localScreenTrack,
    stats,
    reaction,
    hostName,
    startScreenShare,
    stopScreenShare,
    toggleMic,
    toggleDeafen,
    sendMessage,
    sendReaction,
    disconnect: handleManualDisconnect,
  };
}
