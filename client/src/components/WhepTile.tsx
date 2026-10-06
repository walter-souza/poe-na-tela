import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, Maximize, Radio, Square } from 'lucide-react';

interface WhepTileProps {
  whepUrl: string;
  roomName: string;
  streamerName?: string;
  onStateChange?: (isPlaying: boolean) => void;
  isSpotlighted?: boolean;
  onToggleSpotlight?: () => void;
}

export const WhepTile: React.FC<WhepTileProps> = ({
  whepUrl,
  roomName,
  streamerName,
  onStateChange,
  isSpotlighted = false,
  onToggleSpotlight,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pollTimerRef = useRef<any>(null);
  const isConnectingRef = useRef(false);
  const isMountedRef = useRef(true);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Notify parent of state change
  useEffect(() => {
    onStateChange?.(isPlaying);
  }, [isPlaying, onStateChange]);

  // Attach stream to video element whenever stream changes or becomes active
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.log('[WHEP] Autoplay com áudio bloqueado pelo navegador, iniciando mutado:', err);
          if (videoRef.current) {
            videoRef.current.muted = true;
            setIsMuted(true);
            videoRef.current.play().catch(() => {});
          }
        });
      }
    }
  }, [stream, isPlaying]);

  const cleanupPeerConnection = useCallback(() => {
    if (pcRef.current) {
      try {
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.oniceconnectionstatechange = null;
        pcRef.current.ontrack = null;
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }
  }, []);

  const scheduleNextProbe = useCallback((delayMs: number = 2000) => {
    if (!isMountedRef.current) return;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }
    pollTimerRef.current = setTimeout(() => {
      attemptConnect();
    }, delayMs);
  }, []);

  const handleStreamLost = useCallback(() => {
    if (!isMountedRef.current) return;
    cleanupPeerConnection();
    setIsPlaying(false);
    setStream(null);
    scheduleNextProbe(1500);
  }, [cleanupPeerConnection, scheduleNextProbe]);

  const attemptConnect = async () => {
    if (!isMountedRef.current || isConnectingRef.current || isPlaying) return;
    isConnectingRef.current = true;

    try {
      cleanupPeerConnection();

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      const mediaStream = new MediaStream();

      pc.ontrack = (event) => {
        if (!isMountedRef.current) return;
        const incomingStream = event.streams && event.streams[0] ? event.streams[0] : null;

        if (incomingStream) {
          setStream(incomingStream);
          if (videoRef.current) {
            videoRef.current.srcObject = incomingStream;
            videoRef.current.play().catch(() => {
              if (videoRef.current) {
                videoRef.current.muted = true;
                setIsMuted(true);
                videoRef.current.play().catch(() => {});
              }
            });
          }
        } else if (event.track) {
          mediaStream.addTrack(event.track);
          setStream(mediaStream);
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
            videoRef.current.play().catch(() => {
              if (videoRef.current) {
                videoRef.current.muted = true;
                setIsMuted(true);
                videoRef.current.play().catch(() => {});
              }
            });
          }
        }
        setIsPlaying(true);
      };

      // Detecta quando o streamer encerra ou reinicia a transmissão no OBS
      pc.onconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          console.log(`[WHEP] Conexão com OBS alterada (${state}). Reiniciando detecção automática...`);
          handleStreamLost();
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        const iceState = pc.iceConnectionState;
        if (iceState === 'failed' || iceState === 'disconnected') {
          console.log(`[WHEP] Conexão ICE perdida (${iceState}). Reiniciando detecção automática...`);
          handleStreamLost();
        }
      };

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Aguarda coleta dos candidatos ICE locais com proteção de timeout de 1.2s
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        } else {
          const timeout = setTimeout(() => {
            pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }, 1200);

          const checkState = () => {
            if (pc.iceGatheringState === 'complete') {
              clearTimeout(timeout);
              pc.removeEventListener('icegatheringstatechange', checkState);
              resolve();
            }
          };
          pc.addEventListener('icegatheringstatechange', checkState);
        }
      });

      const res = await fetch(whepUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription?.sdp,
      });

      if (!res.ok) {
        // Stream ainda não começou no OBS (MediaMTX responde 404)
        throw new Error(`MediaMTX WHEP: status ${res.status}`);
      }

      const answerSdp = await res.text();
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      setIsPlaying(true);
      console.log('[WHEP] Stream do OBS identificado e conectado automaticamente!');
    } catch (err) {
      cleanupPeerConnection();
      if (isMountedRef.current) {
        setIsPlaying(false);
        // Tenta novamente a cada 2 segundos até o OBS iniciar
        scheduleNextProbe(2000);
      }
    } finally {
      isConnectingRef.current = false;
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    attemptConnect();

    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      cleanupPeerConnection();
    };
  }, [whepUrl]);

  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      videoRef.current.requestFullscreen().catch(() => {});
    }
  };

  if (!isPlaying) {
    return (
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-[11px] text-gray-400">
        <Radio className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
        <span>{streamerName && streamerName !== 'Principal' ? `Aguardando ${streamerName}...` : 'Aguardando OBS (início automático ativo)'}</span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-white/10 shadow-2xl group select-none">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMuted}
        className="w-full h-full object-contain"
      />

      {/* Badge Superior */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-black/80 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/15 text-xs text-white">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span className="font-semibold">
          {streamerName && streamerName !== 'Principal' ? `${streamerName} (OBS)` : `${roomName} (OBS / SRT)`}
        </span>
        <span className="text-gray-400">|</span>
        <span className="text-indigo-400 font-mono font-medium">60 FPS Cravados</span>
      </div>

      {/* Controles Flutuantes */}
      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15">
        <button
          onClick={() => {
            const nextMuted = !isMuted;
            setIsMuted(nextMuted);
            if (videoRef.current) videoRef.current.muted = nextMuted;
          }}
          className="p-1.5 text-gray-300 hover:text-white transition cursor-pointer"
          title={isMuted ? 'Desmutar áudio do jogo' : 'Mutar áudio do jogo'}
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
        </button>

        {onToggleSpotlight && (
          <button
            onClick={onToggleSpotlight}
            className={`p-1.5 transition cursor-pointer ${
              isSpotlighted ? 'text-indigo-400' : 'text-gray-300 hover:text-white'
            }`}
            title={isSpotlighted ? 'Remover Destaque' : 'Destacar Stream'}
          >
            <Square className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={toggleFullscreen}
          className="p-1.5 text-gray-300 hover:text-white transition cursor-pointer"
          title="Tela Cheia"
        >
          <Maximize className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
