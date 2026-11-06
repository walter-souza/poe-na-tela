import { useCallback, useEffect, useRef, useState } from 'react';
import { Track, type Room } from 'livekit-client';
import { ClipRecorder, collectClipSources, downloadClip } from '../utils/clipRecorder';

export type ClipStatus = 'idle' | 'saved' | 'empty';

/** Mantém um buffer dos últimos segundos da sala enquanto o componente está montado. */
export function useClip(room: Room | null, roomName: string) {
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  const recorderRef = useRef<ClipRecorder | null>(null);
  const [status, setStatus] = useState<ClipStatus>('idle');
  const statusTimer = useRef<number | null>(null);

  useEffect(() => {
    const recorder = new ClipRecorder(() => {
      const room = roomRef.current;
      const tracks: Array<MediaStreamTrack | undefined> = [
        room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack,
      ];
      room?.remoteParticipants.forEach((p) => {
        tracks.push(
          p.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack,
          p.getTrackPublication(Track.Source.ScreenShareAudio)?.track?.mediaStreamTrack,
        );
      });
      return collectClipSources(tracks);
    });
    recorderRef.current = recorder;
    recorder.start();
    return () => {
      recorder.stop();
      recorderRef.current = null;
      if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    };
  }, []);

  const saveClip = useCallback(() => {
    const blob = recorderRef.current?.buildClip() ?? null;
    if (blob) downloadClip(blob, roomName);
    setStatus(blob ? 'saved' : 'empty');
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus('idle'), 2500);
  }, [roomName]);

  return { saveClip, clipStatus: status };
}
