import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Tv, Volume2, VolumeX, Maximize, RefreshCw, Radio } from 'lucide-react';

interface WhepPlayerProps {
  whepUrl: string; // Ex: https://stream.194.61.238.98.sslip.io/jogatina/whep
  streamTitle?: string;
  isMuted?: boolean;
}

export const WhepPlayer: React.FC<WhepPlayerProps> = ({
  whepUrl,
  streamTitle = 'Gameplay ao Vivo (60 FPS)',
  isMuted = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pollTimerRef = useRef<any>(null);
  const isConnectingRef = useRef(false);
  const isMountedRef = useRef(true);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(isMuted);

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
      startWhep();
    }, delayMs);
  }, []);

  const handleStreamLost = useCallback(() => {
    if (!isMountedRef.current) return;
    cleanupPeerConnection();
    setIsPlaying(false);
    setIsConnecting(true);
    setError('Transmissão no OBS pausada. Reconectando automaticamente assim que o OBS retornar...');
    scheduleNextProbe(1500);
  }, [cleanupPeerConnection, scheduleNextProbe]);

  const startWhep = async () => {
    if (!isMountedRef.current || isConnectingRef.current || isPlaying) return;
    isConnectingRef.current = true;
    setIsConnecting(true);
    setError(null);

    try {
      cleanupPeerConnection();

      // 1. Criar PeerConnection configurada com STUN
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      // Adicionar transceivers de recepção (apenas receber o vídeo e o áudio da live)
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (!isMountedRef.current) return;
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          const playPromise = videoRef.current.play();
          if (playPromise !== undefined) {
            playPromise.catch((err) => {
              console.log('[WHEP] Autoplay unmuted bloqueado, reproduzindo com mute:', err);
              if (videoRef.current) {
                videoRef.current.muted = true;
                setMuted(true);
                videoRef.current.play().catch(() => {});
              }
            });
          }
          setIsPlaying(true);
          setIsConnecting(false);
          setError(null);
        }
      };

      // Detecta quando o streamer encerra ou reinicia a transmissão no OBS
      pc.onconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          console.log(`[WHEP] Conexão OBS alterada (${state}). Reiniciando busca...`);
          handleStreamLost();
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        const iceState = pc.iceConnectionState;
        if (iceState === 'failed' || iceState === 'disconnected') {
          console.log(`[WHEP] Conexão ICE perdida (${iceState}). Reiniciando busca...`);
          handleStreamLost();
        }
      };

      // 2. Criar Offer SDP
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Esperar gathering de candidatos ICE locais com proteção de timeout
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

      // 3. Enviar SDP Offer para o endpoint WHEP do MediaMTX
      const res = await fetch(whepUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription?.sdp,
      });

      if (!res.ok) {
        throw new Error(`MediaMTX WHEP respondeu com HTTP ${res.status}`);
      }

      const answerSdp = await res.text();
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      setIsPlaying(true);
      setIsConnecting(false);
      setError(null);
      console.log('[WHEP] Transmissão conectada com sucesso via OBS!');
    } catch (err: any) {
      cleanupPeerConnection();
      if (isMountedRef.current) {
        setIsPlaying(false);
        setIsConnecting(false);
        setError('Aguardando início do stream no OBS (início automático ativo)...');
        // Tenta novamente a cada 2 segundos até o OBS ser aberto
        scheduleNextProbe(2000);
      }
    } finally {
      isConnectingRef.current = false;
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    startWhep();

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

  return (
    <div className="relative w-full h-full bg-black rounded-3xl overflow-hidden border border-slate-800 flex items-center justify-center group shadow-2xl">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="w-full h-full object-contain"
      />

      {/* Header Overlay */}
      <div className="absolute top-4 left-4 flex items-center gap-2 bg-slate-950/80 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-slate-800 text-xs">
        <span className={`h-2 w-2 rounded-full ${isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></span>
        <span className="font-semibold text-white">{streamTitle}</span>
        <span className="text-slate-500">|</span>
        <span className="text-indigo-400 font-mono font-medium">SRT 60 FPS</span>
      </div>

      {/* Loading / Error States */}
      {!isPlaying && (
        <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center text-center p-6 backdrop-blur-sm">
          <Tv className="h-12 w-12 text-indigo-400 mb-3 animate-pulse" />
          <p className="text-sm font-semibold text-slate-200 mb-1">
            {error || 'Conectando ao stream de jogo em 60 FPS...'}
          </p>
          <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300 mt-2 mb-4">
            <Radio className="h-3 w-3 text-emerald-400 animate-pulse" />
            <span>Detecção automática: inicie a transmissão no OBS e o vídeo começará sozinho</span>
          </div>
          <button
            onClick={() => startWhep()}
            disabled={isConnecting}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-200 text-xs font-semibold rounded-xl transition cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isConnecting ? 'animate-spin' : ''}`} />
            {isConnecting ? 'Detectando OBS...' : 'Forçar Tentativa Agora'}
          </button>
        </div>
      )}

      {/* Bottom Floating Controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800">
        <button
          onClick={() => setMuted(!muted)}
          className="p-1.5 text-slate-300 hover:text-white transition cursor-pointer"
          title={muted ? 'Desmutar som do jogo' : 'Mutar som do jogo'}
        >
          {muted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4" />}
        </button>

        <button
          onClick={toggleFullscreen}
          className="p-1.5 text-slate-300 hover:text-white transition cursor-pointer"
          title="Tela Cheia"
        >
          <Maximize className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
