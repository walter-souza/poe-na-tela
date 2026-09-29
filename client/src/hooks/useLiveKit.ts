import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  ScreenSharePresets,
  ConnectionState,
  type RemoteParticipant,
  type TrackPublication,
} from 'livekit-client';
import type { StreamQualityConfig, StreamStats, ChatMessage, ReactionEvent, ParticipantInfo } from '../types';

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [remoteScreenTrack, setRemoteScreenTrack] = useState<Track | null>(null);
  const [localScreenTrack, setLocalScreenTrack] = useState<Track | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [reaction, setReaction] = useState<ReactionEvent | null>(null);
  const [hostName, setHostName] = useState<string>('');

  const statsIntervalRef = useRef<number | null>(null);
  const prevBytesRef = useRef<{ bytes: number; timestamp: number } | null>(null);

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

  // WebRTC Real-time Stats Collector
  const collectStats = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;

    try {
      let activeTrackPub: TrackPublication | undefined = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      let isLocal = true;

      if (!activeTrackPub) {
        for (const [, p] of room.remoteParticipants) {
          const pub = p.getTrackPublication(Track.Source.ScreenShare);
          if (pub && pub.track) {
            activeTrackPub = pub;
            isLocal = false;
            break;
          }
        }
      }

      const rtcStatsReport = await (isLocal
        ? (room.engine as any)?.pcManager?.publisher?.getStats()
        : (room.engine as any)?.pcManager?.subscriber?.getStats());

      if (!rtcStatsReport) return;

      let rtt = 0;
      let packetLoss = 0;
      let fps = 0;
      let width = 0;
      let height = 0;
      let codec = 'VP9';
      let bitrate = 0;
      let currentBytes = 0;
      const now = Date.now();

      rtcStatsReport.forEach((report: any) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
          rtt = Math.round(report.currentRoundTripTime * 1000);
        }

        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          fps = report.framesPerSecond || fps;
          width = report.frameWidth || width;
          height = report.frameHeight || height;
          if (report.packetsLost !== undefined && report.packetsReceived) {
            const total = report.packetsLost + report.packetsReceived;
            packetLoss = total > 0 ? (report.packetsLost / total) * 100 : 0;
          }
          currentBytes = report.bytesReceived || 0;
          if (report.codecId) {
            const codecReport = rtcStatsReport.get(report.codecId);
            if (codecReport && codecReport.mimeType) {
              codec = codecReport.mimeType.replace('video/', '').toUpperCase();
            }
          }
        }

        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          fps = report.framesPerSecond || fps;
          width = report.frameWidth || width;
          height = report.frameHeight || height;
          currentBytes = report.bytesSent || 0;
          if (report.codecId) {
            const codecReport = rtcStatsReport.get(report.codecId);
            if (codecReport && codecReport.mimeType) {
              codec = codecReport.mimeType.replace('video/', '').toUpperCase();
            }
          }
        }
      });

      if (prevBytesRef.current && currentBytes > 0) {
        const timeDiffSec = (now - prevBytesRef.current.timestamp) / 1000;
        const bytesDiff = currentBytes - prevBytesRef.current.bytes;
        if (timeDiffSec > 0 && bytesDiff >= 0) {
          bitrate = Math.round((bytesDiff * 8) / timeDiffSec / 1000);
        }
      }
      prevBytesRef.current = { bytes: currentBytes, timestamp: now };

      setStats({
        bitrateKbps: bitrate,
        rttMs: rtt,
        packetLossPercent: parseFloat(packetLoss.toFixed(1)),
        fps: Math.round(fps) || (activeTrackPub ? 60 : 0),
        width: width || 1920,
        height: height || 1080,
        codec,
        jitterMs: 0,
        bytesReceivedOrSent: currentBytes,
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

      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = window.setInterval(collectStats, 1000);
    };

    const handleDisconnected = () => {
      if (!isSubscribed) return;
      setConnectionState(ConnectionState.Disconnected);
      setIsScreenSharing(false);
      setRemoteScreenTrack(null);
      setLocalScreenTrack(null);
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);

      if (isExplicitDisconnectRef.current) {
        onDisconnectedRef.current?.();
      }
    };

    const handleReconnecting = () => setConnectionState(ConnectionState.Reconnecting);
    const handleReconnected = () => setConnectionState(ConnectionState.Connected);

    const handleTrackSubscribed = (
      track: Track,
      _publication: any,
      participant: RemoteParticipant
    ) => {
      if (!isSubscribed) return;
      if (track.source === Track.Source.ScreenShare || track.source === Track.Source.ScreenShareAudio) {
        if (track.kind === Track.Kind.Video) {
          setRemoteScreenTrack(track);
          setHostName(participant.name || participant.identity);
        }
      }
      updateParticipantList(room);
    };

    const handleTrackUnsubscribed = (track: Track) => {
      if (!isSubscribed) return;
      if (track.source === Track.Source.ScreenShare && track.kind === Track.Kind.Video) {
        setRemoteScreenTrack(null);
      }
      updateParticipantList(room);
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
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    room.on(RoomEvent.ParticipantConnected, () => updateParticipantList(room));
    room.on(RoomEvent.ParticipantDisconnected, () => updateParticipantList(room));
    room.on(RoomEvent.ActiveSpeakersChanged, () => updateParticipantList(room));
    room.on(RoomEvent.DataReceived, handleDataReceived);

    room.connect(url, token).catch((err: any) => {
      if (!isSubscribed) return;
      // Ignore client initiated disconnects during component unmount
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
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.disconnect();
    };
  }, [url, token, collectStats, updateParticipantList]);

  // Start Screen Sharing with custom quality
  const startScreenShare = async (config?: Partial<StreamQualityConfig>) => {
    const room = roomRef.current;
    if (!room) return;

    try {
      const targetFps = config?.frameRate || 60;

      await room.localParticipant.setScreenShareEnabled(true, {
        audio: config?.includeAudio ?? true,
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

    const room = roomRef.current;
    if (!room) return;

    room.remoteParticipants.forEach((p) => {
      p.audioTrackPublications.forEach((pub) => {
        if (pub.track) {
          pub.track.mediaStreamTrack.enabled = !nextDeafen;
        }
      });
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
