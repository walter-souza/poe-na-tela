import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Radio,
  Pin,
  PictureInPicture,
  User,
} from 'lucide-react';

interface WhepTileProps {
  whepUrl: string;
  roomName: string;
  streamerName?: string;
  onStateChange?: (isPlaying: boolean) => void;
  isSpotlighted?: boolean;
  onToggleSpotlight?: () => void;
  isThumbnail?: boolean;
  onSelectThumbnail?: () => void;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
}

export const WhepTile: React.FC<WhepTileProps> = ({
  whepUrl,
  roomName,
  streamerName,
  onStateChange,
  isSpotlighted = false,
  onToggleSpotlight,
  isThumbnail = false,
  onSelectThumbnail,
  volume = 1,
  onVolumeChange,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pollTimerRef = useRef<any>(null);
  const isConnectingRef = useRef(false);
  const isMountedRef = useRef(true);
  const hideTimeoutRef = useRef<number | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);

  // Stable ref for onStateChange to prevent effect re-trigger loops
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  // Notify parent of state change
  useEffect(() => {
    onStateChangeRef.current?.(isPlaying);
  }, [isPlaying]);

  // Sync volume with video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : Math.max(0, Math.min(1, volume));
    }
  }, [volume, isMuted]);

  // Attach stream to video element whenever stream changes or becomes active
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.log('[WHEP] Autoplay bloqueado pelo navegador, iniciando mutado:', err);
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

      pc.onconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          console.log(`[WHEP] Conexão com OBS alterada (${state}). Reiniciando detecção...`);
          handleStreamLost();
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        const iceState = pc.iceConnectionState;
        if (iceState === 'failed' || iceState === 'disconnected') {
          console.log(`[WHEP] Conexão ICE perdida (${iceState}). Reiniciando detecção...`);
          handleStreamLost();
        }
      };

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        } else {
          const timeout = setTimeout(() => {
            pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }, 2000);

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

  const handleMouseMove = () => {
    if (isThumbnail) return;
    setShowControls(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = window.setTimeout(() => {
      setShowControls(false);
    }, 2500);
  };

  const handleToggleControls = () => {
    if (isThumbnail) return;
    setShowControls((prev) => !prev);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = window.setTimeout(() => {
      setShowControls(false);
    }, 3500);
  };

  const toggleFullscreen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    try {
      if (container && (container.requestFullscreen || (container as any).webkitRequestFullscreen)) {
        if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
          if (container.requestFullscreen) {
            await container.requestFullscreen();
          } else if ((container as any).webkitRequestFullscreen) {
            await (container as any).webkitRequestFullscreen();
          }
          setIsFullscreen(true);
        } else {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if ((document as any).webkitExitFullscreen) {
            await (document as any).webkitExitFullscreen();
          }
          setIsFullscreen(false);
        }
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  };

  const togglePiP = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error('Error toggling PiP:', err);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const muted = val === 0;
    setIsMuted(muted);
    onVolumeChange?.(val);
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    onVolumeChange?.(nextMute ? 0 : (volume || 1));
  };

  const displayName = streamerName && streamerName !== 'Principal' ? streamerName : roomName;

  // 1. Thumbnail view (Strip lateral/inferior no modo spotlight)
  if (isThumbnail) {
    return (
      <div
        onClick={onSelectThumbnail}
        className={`relative aspect-video w-36 sm:w-44 rounded-xl overflow-hidden cursor-pointer border-2 transition-all duration-200 group bg-black/60 shadow-lg shrink-0 ${
          isSpotlighted
            ? 'border-indigo-500 shadow-indigo-500/30 scale-[1.02]'
            : 'border-white/10 hover:border-white/40 hover:scale-[1.01]'
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain bg-black"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 flex items-center justify-between text-[11px] text-white">
          <span className="truncate font-medium">{displayName}</span>
          {isSpotlighted ? (
            <span className="text-[9px] bg-emerald-500/40 text-emerald-200 px-1 py-0.2 rounded font-semibold">
              Foco
            </span>
          ) : (
            <span className="text-[9px] bg-indigo-500/30 text-indigo-300 px-1 py-0.2 rounded font-semibold">
              OBS
            </span>
          )}
        </div>
      </div>
    );
  }

  // 2. Full / Grid Stream Tile (ALWAYS mounted so video element and WebRTC tracks are NEVER unmounted)
  return (
    <div
      ref={containerRef}
      onClick={handleToggleControls}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShowControls(false)}
      className={`relative w-full h-full bg-black rounded-2xl overflow-hidden flex items-center justify-center border transition-all duration-300 group select-none shadow-2xl cursor-pointer ${
        isSpotlighted ? 'border-indigo-500/40 ring-1 ring-indigo-500/30' : 'border-white/10 hover:border-white/20'
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMuted}
        className="w-full h-full object-contain bg-black"
      />

      {/* Loading / Connecting Overlay when not yet playing */}
      {!isPlaying && (
        <div className="absolute inset-0 z-10 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4">
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10 text-xs text-gray-300 shadow-xl">
            <Radio className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            <span>Aguardando transmissão de <strong>{displayName}</strong>...</span>
          </div>
        </div>
      )}

      {/* Top Stream Info Badge — Idêntico ao padrão WebRTC */}
      <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-20 flex items-center gap-1.5 sm:gap-2 pointer-events-none">
        <div className="flex items-center gap-1 sm:gap-1.5 bg-red-600/90 backdrop-blur-md px-2 sm:px-2.5 py-0.5 rounded-full text-white text-[10px] sm:text-[11px] font-bold uppercase tracking-wider shadow">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
          <span>AO VIVO</span>
        </div>

        <div className="bg-black/60 backdrop-blur-md border border-white/15 px-2 sm:px-2.5 py-0.5 rounded-full text-[11px] sm:text-xs text-gray-200 flex items-center gap-1.5 shadow">
          <User className="w-3 h-3 text-indigo-400" />
          <span className="font-semibold text-white truncate max-w-[110px] xs:max-w-[150px] sm:max-w-[220px]">
            {displayName}
          </span>
          <span className="text-[10px] bg-indigo-500/30 text-indigo-200 px-1.5 py-0.2 rounded font-bold font-mono">
            OBS 60 FPS
          </span>
        </div>
      </div>

      {/* Top Right Pin / Spotlight Button */}
      {onToggleSpotlight && (
        <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-20">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSpotlight();
            }}
            title={isSpotlighted ? 'Remover destaque' : 'Destacar esta transmissão'}
            className={`p-1.5 sm:p-2 rounded-xl backdrop-blur-md border transition ${
              isSpotlighted
                ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-600/30'
                : 'bg-black/60 hover:bg-black/80 border-white/15 text-gray-300 hover:text-white'
            }`}
          >
            <Pin className={`w-3.5 h-3.5 ${isSpotlighted ? 'rotate-45 text-white' : ''}`} />
          </button>
        </div>
      )}

      {/* Bottom Controls Bar (Visible on Hover / In Fullscreen) */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-2 sm:p-4 z-20 transition-opacity duration-300 flex items-center justify-between ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Left: Volume Slider per streamer */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-white/15 text-white">
            <button
              onClick={toggleMute}
              className="hover:text-indigo-400 transition"
              title={
                isMuted || volume === 0
                  ? 'Ativar som da transmissão'
                  : 'Silenciar áudio da transmissão'
              }
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-rose-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              title={`Volume de ${displayName}`}
              className="w-14 sm:w-20 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <span className="text-[10px] text-gray-300 min-w-[28px]">
              {Math.round((isMuted ? 0 : volume) * 100)}%
            </span>
          </div>
        </div>

        {/* Right: PiP & Fullscreen */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={togglePiP}
            title="Picture-in-Picture"
            className="p-1.5 sm:p-2 rounded-xl bg-black/60 hover:bg-black/80 border border-white/15 text-gray-300 hover:text-white transition shadow"
          >
            <PictureInPicture className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={toggleFullscreen}
            title="Tela Cheia"
            className="p-1.5 sm:p-2 rounded-xl bg-black/60 hover:bg-black/80 border border-white/15 text-gray-300 hover:text-white transition shadow"
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};
