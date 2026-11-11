import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  LocalAudioTrack,
  ConnectionState,
  type RemoteParticipant,
} from 'livekit-client';
import type { ParticipantInfo } from '../types';
import type { RoomRestore } from '../utils/resumeSession';
import { playJoinSound, playLeaveSound } from '../utils/soundEffects';
import { stopKeepAlive } from '../utils/keepAlive';
import { isNoiseSuppressionSupported } from '../utils/noiseSuppression';
import { CHAT_IMAGE_TOPIC } from '../utils/chatImage';
import { VoiceActivityDetector } from '../utils/voiceActivity';
import { useChat } from './useChat';
import { useNoiseSuppression } from './useNoiseSuppression';
import { usePlayoutBuffer } from './usePlayoutBuffer';
import { useRoomAudio } from './useRoomAudio';
import { useScreenShare } from './useScreenShare';
import { useStreamStats } from './useStreamStats';

export interface UseLiveKitOptions {
  url: string;
  token: string;
  onDisconnected?: () => void;
  /** State to restore after the reload that applied an update (see resumeSession). */
  restore?: RoomRestore | null;
}

/**
 * One LiveKit room session: connection, participants and microphone. Audio, chat, screen shares,
 * stats and playout buffer live in their own hooks; this one wires them to the room events.
 */
export function useLiveKit({ url, token, onDisconnected, restore }: UseLiveKitOptions) {
  const roomRef = useRef<Room | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  const isExplicitDisconnectRef = useRef(false);
  const startMicOnConnectRef = useRef(restore?.micEnabled ?? true);

  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(false);
  const [canPlaybackAudio, setCanPlaybackAudio] = useState<boolean>(true);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  // Who has their audio turned off; shared over the data channel since LiveKit has no such flag.
  const deafenedPeersRef = useRef<Set<string>>(new Set());

  const audio = useRoomAudio(roomRef, restore?.deafened ?? false);
  const noise = useNoiseSuppression(roomRef);
  const screen = useScreenShare(roomRef);
  const chat = useChat(roomRef, restore?.messages ?? [], screen.isScreenSharing);
  const playout = usePlayoutBuffer(roomRef);
  const streamStats = useStreamStats(roomRef, playout);

  const { isDeafenedRef, attachRemoteAudio, detachRemoteAudio, disposeAll: disposeAudio } = audio;
  const { isEnabledRef: isNoiseSuppressionEnabledRef, apply: applyNoiseSuppression, destroy: destroyNoiseSuppression } = noise;
  const { syncSubscriptions, updateScreenShares, unwatch, reset: resetScreenShares } = screen;
  const { addSystemMessage, handleData: handleChatData, createImageHandler, releaseImages } = chat;
  const { applyToTrack: applyPlayoutBuffer, applyToAll: applyPlayoutBufferToAll, playoutBufferMsRef } = playout;
  const { start: startStats, stop: stopStats } = streamStats;

  const vadRef = useRef<VoiceActivityDetector | null>(null);

  // Participant list with real-time voice activity (VAD) and deafen status.
  const updateParticipantList = useCallback((room: Room) => {
    const vad = vadRef.current;
    const list: ParticipantInfo[] = [];

    // Local participant
    if (room.localParticipant) {
      const localVad = vad?.isSpeaking(room.localParticipant.identity);
      const isSpeaking = room.localParticipant.isMicrophoneEnabled
        ? (localVad !== undefined ? localVad : room.localParticipant.isSpeaking)
        : false;

      list.push({
        identity: room.localParticipant.identity,
        name: room.localParticipant.name || room.localParticipant.identity,
        isSpeaking,
        isScreenSharing: room.localParticipant.isScreenShareEnabled,
        isMuted: !room.localParticipant.isMicrophoneEnabled,
        isDeafened: isDeafenedRef.current,
      });
    }

    // Remote participants
    room.remoteParticipants.forEach((p) => {
      const remoteVad = vad?.isSpeaking(p.identity);
      const isSpeaking = remoteVad !== undefined ? remoteVad : p.isSpeaking;

      list.push({
        identity: p.identity,
        name: p.name || p.identity,
        isSpeaking,
        isScreenSharing: p.isScreenShareEnabled,
        isMuted: !p.isMicrophoneEnabled,
        isDeafened: deafenedPeersRef.current.has(p.identity),
      });
    });

    setParticipants(list);
  }, [isDeafenedRef]);

  // Polls every 40ms and re-renders the participant list only when someone starts/stops speaking.
  if (!vadRef.current) vadRef.current = new VoiceActivityDetector((room) => updateParticipantList(room));
  const vad = vadRef.current;

  const broadcastDeafened = useCallback((room: Room, deafened: boolean) => {
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'deafen', deafened }));
    room.localParticipant.publishData(payload, { reliable: true }).catch(() => {});
  }, []);

  const setMicEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      const room = roomRef.current;
      if (!room) return false;

      try {
        const pub = await room.localParticipant.setMicrophoneEnabled(enabled, {
          echoCancellation: true,
          noiseSuppression: !isNoiseSuppressionEnabledRef.current,
          autoGainControl: true,
        });
        setIsMicEnabled(enabled);
        if (enabled) {
          if (isNoiseSuppressionEnabledRef.current && pub?.track) {
            try {
              await applyNoiseSuppression(pub.track as LocalAudioTrack, true);
            } catch (suppressErr) {
              console.warn('Noise suppression could not be applied, continuing with raw mic:', suppressErr);
            }
          }
        } else {
          vad.unregister(room.localParticipant.identity);
        }
        updateParticipantList(room);
        return true;
      } catch (err) {
        console.error('Failed to toggle microphone:', err);
        return false;
      }
    },
    [vad, isNoiseSuppressionEnabledRef, applyNoiseSuppression, updateParticipantList]
  );

  // Connect to room
  useEffect(() => {
    if (!url || !token) return;

    let isSubscribed = true;
    isExplicitDisconnectRef.current = false;

    const room = new Room({
      // Layer choice is explicit per tile (StreamTile): adaptiveStream would cap it by element size.
      adaptiveStream: false,
      dynacast: true,
      audioCaptureDefaults: {
        autoGainControl: true,
        noiseSuppression: true,
        echoCancellation: true,
      },
      publishDefaults: {
        audioPreset: {
          maxBitrate: 192000,
          priority: 'high',
        },
        dtx: false,
        red: true,
        simulcast: false,
      },
    });

    roomRef.current = room;

    const handleConnected = () => {
      if (!isSubscribed) return;
      setConnectionState(ConnectionState.Connected);
      syncSubscriptions(room);
      updateParticipantList(room);
      updateScreenShares(room);

      addSystemMessage(`system-welcome-${Date.now()}`, 'Você entrou na sala');

      playJoinSound();

      // Attempt unlocking browser audio autoplay
      room.startAudio().catch(() => {});
      setCanPlaybackAudio(room.canPlaybackAudio);

      vad.start(room);
      startStats();
    };

    const handleDisconnected = () => {
      if (!isSubscribed) return;
      setConnectionState(ConnectionState.Disconnected);
      resetScreenShares();
      stopStats();
      vad.stop();

      if (isExplicitDisconnectRef.current) {
        onDisconnectedRef.current?.();
      }
    };

    const handleReconnecting = () => setConnectionState(ConnectionState.Reconnecting);
    const handleReconnected = () => {
      setConnectionState(ConnectionState.Connected);
      syncSubscriptions(room);
      updateParticipantList(room);
      updateScreenShares(room);
      applyPlayoutBufferToAll(playoutBufferMsRef.current);
    };

    const handleAudioPlaybackStatusChanged = () => {
      if (!isSubscribed) return;
      setCanPlaybackAudio(room.canPlaybackAudio);
    };

    const handleTrackSubscribed = (
      track: Track,
      _publication: any,
      participant: RemoteParticipant
    ) => {
      if (!isSubscribed) return;

      // Apply playout buffer hint to remote track for smooth 60 FPS playback
      applyPlayoutBuffer(track, playoutBufferMsRef.current);

      // Automatically attach and play remote audio (Microphone & Screen Audio)
      if (track.kind === Track.Kind.Audio) {
        attachRemoteAudio(track, participant.identity);
        if (track.source !== Track.Source.ScreenShareAudio && track.mediaStreamTrack) {
          vad.register(participant.identity, track.mediaStreamTrack);
        }
      }

      updateParticipantList(room);
      updateScreenShares(room);
    };

    const handleTrackUnsubscribed = (track: Track, _pub?: any, participant?: RemoteParticipant) => {
      if (!isSubscribed) return;

      if (track.kind === Track.Kind.Audio) {
        const participantId = participant?.identity;
        if (participantId && track.source !== Track.Source.ScreenShareAudio) {
          vad.unregister(participantId);
        }
        detachRemoteAudio(track, participantId);
      }

      updateParticipantList(room);
      updateScreenShares(room);
    };

    const handleDataReceived = (payload: Uint8Array, participant?: RemoteParticipant) => {
      if (!isSubscribed) return;
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));

        if (data.type === 'deafen') {
          if (participant) {
            if (data.deafened) deafenedPeersRef.current.add(participant.identity);
            else deafenedPeersRef.current.delete(participant.identity);
            updateParticipantList(room);
          }
        } else {
          handleChatData(data, participant);
        }
      } catch (err) {
        console.error('Failed to parse received data channel payload', err);
      }
    };

    const handleParticipantConnected = (participant: RemoteParticipant) => {
      if (!isSubscribed) return;
      // Newcomers cannot know the current state, so repeat it when someone joins.
      if (isDeafenedRef.current) broadcastDeafened(room, true);
      syncSubscriptions(room);
      updateParticipantList(room);
      updateScreenShares(room);
      const name = participant.name || participant.identity || 'Um usuário';
      addSystemMessage(`system-join-${Date.now()}-${Math.random()}`, `${name} entrou na sala`);

      // Play join notification sound if not self and not deafened
      if (participant.identity !== room.localParticipant?.identity && !isDeafenedRef.current) {
        playJoinSound();
      }
    };

    const handleParticipantDisconnected = (participant: RemoteParticipant) => {
      if (!isSubscribed) return;
      deafenedPeersRef.current.delete(participant.identity);
      unwatch(participant.identity);
      vad.unregister(participant.identity);
      updateParticipantList(room);
      updateScreenShares(room);
      const name = participant.name || participant.identity || 'Um usuário';
      addSystemMessage(`system-leave-${Date.now()}-${Math.random()}`, `${name} saiu da sala`);

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
    room.on(RoomEvent.TrackPublished, () => {
      syncSubscriptions(room);
      updateScreenShares(room);
    });
    room.on(RoomEvent.TrackUnpublished, (pub, participant) => {
      if (pub.source === Track.Source.ScreenShare) unwatch(participant.identity);
      updateScreenShares(room);
    });
    room.on(RoomEvent.LocalTrackPublished, () => updateScreenShares(room));
    room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
      updateScreenShares(room);
      if (pub.source === Track.Source.Microphone) {
        vad.unregister(room.localParticipant?.identity);
      }
    });
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    room.on(RoomEvent.ActiveSpeakersChanged, () => updateParticipantList(room));
    room.on(RoomEvent.DataReceived, handleDataReceived);

    room.registerByteStreamHandler(CHAT_IMAGE_TOPIC, createImageHandler(room, () => isSubscribed));

    room
      .connect(url, token, { autoSubscribe: false })
      .then(() => {
        // The microphone starts on by default (or as it was before an update reload); if permission
        // is denied it stays muted.
        if (!isSubscribed) return;
        if (startMicOnConnectRef.current) void setMicEnabled(true);
        if (isDeafenedRef.current) broadcastDeafened(room, true);
      })
      .catch((err: any) => {
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
      stopStats();
      vad.dispose();
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged);
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.unregisterByteStreamHandler(CHAT_IMAGE_TOPIC);
      releaseImages();
      destroyNoiseSuppression();
      disposeAudio();
      room.disconnect();
    };
  }, [
    url,
    token,
    vad,
    updateParticipantList,
    setMicEnabled,
    broadcastDeafened,
    isDeafenedRef,
    attachRemoteAudio,
    detachRemoteAudio,
    disposeAudio,
    destroyNoiseSuppression,
    syncSubscriptions,
    updateScreenShares,
    unwatch,
    resetScreenShares,
    addSystemMessage,
    handleChatData,
    createImageHandler,
    releaseImages,
    applyPlayoutBuffer,
    applyPlayoutBufferToAll,
    playoutBufferMsRef,
    startStats,
    stopStats,
  ]);

  // Unlock browser audio autoplay policy
  const unlockAudio = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
      setCanPlaybackAudio(room.canPlaybackAudio);
      await vad.resume();
    } catch (e) {
      console.error('Failed to unlock audio playback:', e);
    }
  };

  // Only user-initiated toggles (button or hotkey) chime; the automatic start on connect does not.
  const toggleMic = async () => {
    const nextState = !isMicEnabled;
    if (!(await setMicEnabled(nextState))) return;
    if (nextState) playJoinSound(0.2);
    else playLeaveSound(0.2);
  };

  const toggleDeafen = () => {
    const nextDeafen = !audio.isDeafened;
    audio.setDeafened(nextDeafen);
    if (nextDeafen) playLeaveSound(0.2);
    else playJoinSound(0.2);

    const room = roomRef.current;
    if (!room) return;
    broadcastDeafened(room, nextDeafen);
    updateParticipantList(room);
  };

  const handleManualDisconnect = () => {
    isExplicitDisconnectRef.current = true;
    playLeaveSound();
    stopKeepAlive();
    destroyNoiseSuppression();
    disposeAudio();
    roomRef.current?.disconnect();
  };

  return {
    room: roomRef.current,
    connectionState,
    isScreenSharing: screen.isScreenSharing,
    isLocalScreenAudioMuted: screen.isLocalScreenAudioMuted,
    isMicEnabled,
    isDeafened: audio.isDeafened,
    isNoiseSuppressionEnabled: noise.isEnabled,
    isNoiseSuppressionSupported: isNoiseSuppressionSupported(),
    canPlaybackAudio,
    unlockAudio,
    setGlobalVolume: audio.setGlobalVolume,
    setStreamVolume: audio.setStreamVolume,
    setScreenShareWatching: screen.setScreenShareWatching,
    streamVolumes: audio.streamVolumes,
    setUserVolume: audio.setUserVolume,
    userVolumes: audio.userVolumes,
    screenShares: screen.screenShares,
    messages: chat.messages,
    participants,
    remoteScreenTrack: screen.remoteScreenTrack,
    localScreenTrack: screen.localScreenTrack,
    stats: streamStats.stats,
    playoutBufferMs: playout.playoutBufferMs,
    setPlayoutBufferMs: playout.setPlayoutBufferMs,
    reaction: chat.reaction,
    hostName: screen.hostName,
    startScreenShare: screen.startScreenShare,
    stopScreenShare: screen.stopScreenShare,
    toggleLocalScreenAudio: screen.toggleLocalScreenAudio,
    toggleMic,
    toggleDeafen,
    toggleNoiseSuppression: noise.toggle,
    sendMessage: chat.sendMessage,
    sendImage: chat.sendImage,
    editMessage: chat.editMessage,
    deleteMessage: chat.deleteMessage,
    sendReaction: chat.sendReaction,
    disconnect: handleManualDisconnect,
  };
}
