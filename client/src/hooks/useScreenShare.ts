import { useCallback, useRef, useState, type RefObject } from 'react';
import { Track, type Room } from 'livekit-client';
import type { ScreenShareItem, StreamQualityConfig } from '../types';
import { startKeepAlive, stopKeepAlive } from '../utils/keepAlive';
import { buildScreenShareProfile, formatResolution, getResolutionSize } from '../utils/streamProfile';

/**
 * Screen shares in the room: publishing our own and choosing which remote ones to receive.
 * Remote shares are listed as soon as they are published but only subscribed once watched.
 */
export function useScreenShare(roomRef: RefObject<Room | null>) {
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isLocalScreenAudioMuted, setIsLocalScreenAudioMuted] = useState<boolean>(false);
  const [screenShares, setScreenShares] = useState<ScreenShareItem[]>([]);
  const [remoteScreenTrack, setRemoteScreenTrack] = useState<Track | null>(null);
  const [localScreenTrack, setLocalScreenTrack] = useState<Track | null>(null);
  const [hostName, setHostName] = useState<string>('');

  // Screen shares are never received until the viewer picks them (bandwidth), while voice and
  // everything else keeps auto-subscribing: the room joins with autoSubscribe off, so this is the
  // single place that decides what each remote publication should be doing.
  const watchedShareIdsRef = useRef<Set<string>>(new Set());
  const syncSubscriptions = useCallback((room: Room) => {
    room.remoteParticipants.forEach((p) => {
      p.trackPublications.forEach((pub) => {
        const isShare =
          pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio;
        const wanted = isShare ? watchedShareIdsRef.current.has(p.identity) : true;
        if (pub.isDesired !== wanted) pub.setSubscribed(wanted);
      });
    });
  }, []);

  /** A share that ends (or whose owner leaves) is a new share next time: the viewer chooses again. */
  const unwatch = useCallback((participantIdentity: string) => {
    watchedShareIdsRef.current.delete(participantIdentity);
  }, []);

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
          videoPublication: localVideoPub,
          audioTrack: localAudioPub?.track,
          isLocal: true,
          isWatching: true,
          resolution: formatResolution(localVideoPub.dimensions),
        });
      }
    }

    // Remote screen shares
    room.remoteParticipants.forEach((p) => {
      const videoPub = p.getTrackPublication(Track.Source.ScreenShare);
      const audioPub = p.getTrackPublication(Track.Source.ScreenShareAudio);
      // Listed as soon as it is published, even unsubscribed, so the viewer can choose to watch it.
      if (videoPub) {
        list.push({
          id: p.identity,
          participantIdentity: p.identity,
          participantName: p.name || p.identity,
          videoTrack: videoPub.track ?? null,
          videoPublication: videoPub,
          audioTrack: audioPub?.track,
          isLocal: false,
          isWatching: watchedShareIdsRef.current.has(p.identity),
          resolution: formatResolution(videoPub.dimensions),
        });
      }
    });

    setScreenShares(list);

    // Keep remoteScreenTrack / localScreenTrack synced for backwards compatibility
    const local = list.find((s) => s.isLocal);
    const remote = list.find((s) => !s.isLocal && s.videoTrack);
    setLocalScreenTrack(local?.videoTrack || null);
    setRemoteScreenTrack(remote?.videoTrack || null);
    if (list.length > 0) {
      setHostName(list[0].participantName);
    }
  }, []);

  /** Clears everything after a disconnect. */
  const reset = useCallback(() => {
    setIsScreenSharing(false);
    setRemoteScreenTrack(null);
    setLocalScreenTrack(null);
    setScreenShares([]);
  }, []);

  // Starts or stops receiving one participant's screen share (video + its audio).
  const setScreenShareWatching = useCallback((participantIdentity: string, watching: boolean) => {
    const room = roomRef.current;
    if (!room) return;
    if (watching) watchedShareIdsRef.current.add(participantIdentity);
    else watchedShareIdsRef.current.delete(participantIdentity);
    syncSubscriptions(room);
    updateScreenShares(room);
  }, [roomRef, syncSubscriptions, updateScreenShares]);

  // Codec/bitrate/SVC are derived from the device's encoder support (see streamProfile)
  const startScreenShare = async (config?: Partial<StreamQualityConfig>) => {
    const room = roomRef.current;
    if (!room) return;

    try {
      const targetFps = config?.frameRate || 60;
      const resolution = config?.resolution || '1080p';
      const shouldIncludeAudio = config?.includeAudio ?? true;
      const shouldIsolateRoomAudio = config?.isolateRoomAudio ?? true;

      const profile = await buildScreenShareProfile(resolution, targetFps, {
        codec: config?.codec,
        bitrateKbps: config?.bitrateKbps,
      });
      const { width, height } = getResolutionSize(resolution);

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
          resolution: { width, height, frameRate: targetFps },
          contentHint: config?.contentHint || 'motion',
        },
        {
          audioPreset: {
            maxBitrate: 192000,
            priority: 'high',
          },
          dtx: false,
          red: true,
          simulcast: !!profile.simulcastLayers,
          screenShareSimulcastLayers: profile.simulcastLayers,
          videoCodec: profile.codec,
          scalabilityMode: profile.scalabilityMode,
          // Backup codec costs a second encode on the host; only AV1 has decoders missing in the wild.
          backupCodec: profile.codec === 'av1',
          degradationPreference: profile.degradationPreference,
          // livekit-client reads `screenShareEncoding` (not `videoEncoding`) for screen shares;
          // omitting it falls back to its 15 fps / 2.5 Mbps preset.
          screenShareEncoding: {
            maxBitrate: profile.maxBitrate,
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

    await room.localParticipant.setScreenShareEnabled(false);

    setIsScreenSharing(false);
    setIsLocalScreenAudioMuted(false);
    setLocalScreenTrack(null);
    updateScreenShares(room);
  };

  // Host mutes/unmutes outgoing screen sound without muting their mic
  const toggleLocalScreenAudio = () => {
    const room = roomRef.current;
    if (!room || !room.localParticipant) return;

    const audioPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
    if (audioPub && audioPub.track && audioPub.track.mediaStreamTrack) {
      const nextMute = !isLocalScreenAudioMuted;
      audioPub.track.mediaStreamTrack.enabled = !nextMute;
      setIsLocalScreenAudioMuted(nextMute);
    }
  };

  return {
    isScreenSharing,
    isLocalScreenAudioMuted,
    screenShares,
    remoteScreenTrack,
    localScreenTrack,
    hostName,
    syncSubscriptions,
    updateScreenShares,
    unwatch,
    reset,
    setScreenShareWatching,
    startScreenShare,
    stopScreenShare,
    toggleLocalScreenAudio,
  };
}
