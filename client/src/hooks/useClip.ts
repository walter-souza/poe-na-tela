import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, Track, type Room } from 'livekit-client';
import { ClipRecorder, collectClipSources, downloadClip } from '../utils/clipRecorder';
import { getClipUrl, getRoomClipUrl, getRoomClipsUrl } from '../utils/api';

/** processing: montando no servidor; local: salvo no dispositivo sem as vozes (servidor indisponível). */
export type ClipStatus = 'idle' | 'processing' | 'local' | 'empty';

/** Clipe pronto no servidor, à espera de a pessoa decidir entre baixar e descartar. */
export interface ClipPreview {
  id: string;
  videoUrl: string;
  downloadUrl: string;
  seconds?: number;
}

interface ClipSession {
  token: string;
  roomName: string;
}

/** O clipe é uma configuração da sala (metadado `{"clip":true}`), definida pelo anfitrião. */
function isClipEnabled(metadata: string | undefined): boolean {
  if (!metadata) return false;
  try {
    return JSON.parse(metadata)?.clip === true;
  } catch {
    return false;
  }
}

const NOTICE_MS = 9000;

/**
 * Clipe da sala. Ligado por qualquer participante, vale para todos: as vozes de todos ficam num buffer de memória
 * no servidor (60s) e cada cliente guarda localmente o vídeo da stream. Ao clipar, o vídeo sobe para o
 * servidor, que mistura as vozes e devolve um clipe para preview antes de baixar. Desligado, nada é gravado.
 */
export function useClip(room: Room | null, session: ClipSession) {
  const { token, roomName } = session;
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<ClipStatus>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<ClipPreview | null>(null);
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  const recorderRef = useRef<ClipRecorder | null>(null);
  const timers = useRef<{ status: number | null; notice: number | null }>({ status: null, notice: null });
  const announced = useRef<boolean | null>(null);
  const busy = useRef(false);
  const previewRef = useRef<ClipPreview | null>(null);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (timers.current.notice !== null) window.clearTimeout(timers.current.notice);
    timers.current.notice = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const flashStatus = useCallback((next: ClipStatus) => {
    setStatus(next);
    if (timers.current.status !== null) window.clearTimeout(timers.current.status);
    timers.current.status = window.setTimeout(() => setStatus('idle'), 2500);
  }, []);

  const discardClip = useCallback(() => {
    const current = previewRef.current;
    setPreview(null);
    if (current) void fetch(getClipUrl(current.id), { method: 'DELETE' }).catch(() => {});
  }, []);

  // Acompanha a configuração da sala e quem pode alterá-la.
  useEffect(() => {
    if (!room) return;
    const sync = () => {
      const next = isClipEnabled(room.metadata);
      setEnabled(next);
      // Sem clipe ligado na sala, um preview aberto não faz mais sentido.
      if (!next) discardClip();
      // Avisa todos ao entrar numa sala com clipe ligado e a cada mudança depois disso.
      if (announced.current !== next && (announced.current !== null || next)) {
        showNotice(
          next
            ? 'Clipe ligado nesta sala: as vozes de todos ficam num buffer de 60s no servidor. Quem não concordar pode sair da sala.'
            : 'Clipe desligado: o buffer de vozes foi descartado.',
        );
      }
      announced.current = next;
    };
    sync();
    room.on(RoomEvent.Connected, sync);
    room.on(RoomEvent.RoomMetadataChanged, sync);
    return () => {
      room.off(RoomEvent.Connected, sync);
      room.off(RoomEvent.RoomMetadataChanged, sync);
    };
  }, [room, showNotice, discardClip]);

  // Buffer local do vídeo e do áudio da stream: existe somente enquanto o clipe está ligado na sala.
  // As vozes não entram aqui: o servidor mistura as de todos (microfones) no clipe.
  useEffect(() => {
    if (!enabled) return;
    const recorder = new ClipRecorder(() => {
      const tracks: Array<MediaStreamTrack | undefined> = [];
      roomRef.current?.remoteParticipants.forEach((p) => {
        tracks.push(p.getTrackPublication(Track.Source.ScreenShareAudio)?.track?.mediaStreamTrack);
      });
      return collectClipSources(tracks);
    });
    recorderRef.current = recorder;
    recorder.start();
    return () => {
      recorder.stop();
      recorderRef.current = null;
    };
  }, [enabled]);

  const authHeader = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token]);

  // Ao sair da sala o clipe pendente é descartado (o servidor também o expira sozinho).
  useEffect(() => {
    const t = timers.current;
    return () => {
      if (t.status !== null) window.clearTimeout(t.status);
      if (t.notice !== null) window.clearTimeout(t.notice);
      const pending = previewRef.current;
      if (pending) void fetch(getClipUrl(pending.id), { method: 'DELETE', keepalive: true }).catch(() => {});
    };
  }, []);

  const toggleClip = useCallback(async () => {
    const next = !enabled;
    if (
      next &&
      !window.confirm(
        'Ligar o clipe vale para TODOS na sala: as vozes de todos ficam num buffer de memória de 60s no servidor (nada é salvo em disco) e qualquer um pode clipar. Continuar?',
      )
    ) {
      return;
    }
    try {
      const res = await fetch(getRoomClipUrl(roomName), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Não foi possível alterar o clipe.');
      }
      // O estado muda quando o LiveKit entrega o novo metadado da sala (para todos, inclusive aqui).
    } catch (err: any) {
      showNotice(err?.message || 'Não foi possível alterar o clipe.');
    }
  }, [enabled, roomName, authHeader, showNotice]);

  const saveClip = useCallback(async () => {
    if (busy.current) return;
    const recorder = recorderRef.current;
    const blob = recorder?.buildClip() ?? null;
    if (!recorder || !blob) {
      flashStatus('empty');
      return;
    }
    const lagMs = recorder.lagMs;
    busy.current = true;
    setStatus('processing');
    try {
      const begin = await fetch(getRoomClipsUrl(roomName), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ lagMs }),
      });
      const started = await begin.json().catch(() => ({}));
      if (!begin.ok || !started.id) throw new Error(started.error || 'O servidor não aceitou o clipe.');

      const upload = await fetch(`${getRoomClipsUrl(roomName)}/${started.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/webm', ...authHeader() },
        body: blob,
      });
      const built = await upload.json().catch(() => ({}));
      if (!upload.ok) throw new Error(built.error || 'Não foi possível montar o clipe.');

      const base = getClipUrl(started.id);
      discardClip(); // um preview anterior ainda aberto
      setPreview({ id: started.id, videoUrl: `${base}/video`, downloadUrl: `${base}/video?download=1`, seconds: built.seconds });
      setStatus('idle');
    } catch (err: any) {
      // Servidor indisponível: não perde o clipe, mas sai só com o áudio da stream.
      downloadClip(blob, roomName);
      showNotice(`${err?.message || 'Falha ao falar com o servidor.'} Clipe salvo no dispositivo, só com o áudio da stream (sem as vozes).`);
      flashStatus('local');
    } finally {
      busy.current = false;
    }
  }, [roomName, authHeader, discardClip, showNotice, flashStatus]);

  return {
    saveClip,
    clipStatus: status,
    clipEnabled: enabled,
    toggleClip,
    /** Aviso temporário (mudança da configuração da sala, erro ou clipe salvo sem vozes). */
    clipNotice: notice,
    clipPreview: preview,
    discardClip,
  };
}
