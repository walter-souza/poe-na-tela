import React, { useEffect, useRef, useState } from 'react';
import {
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  PictureInPicture,
  Pin,
  Sparkles,
  User,
  Eye,
  EyeOff,
  Radio,
} from 'lucide-react';
import type { ScreenShareItem } from '../types';

interface StreamTileProps {
  stream: ScreenShareItem;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  isSpotlighted?: boolean;
  onToggleSpotlight?: () => void;
  isThumbnail?: boolean;
  onSelectThumbnail?: () => void;
  isLocalScreenAudioMuted?: boolean;
  onToggleLocalScreenAudio?: () => void;
}

export const StreamTile: React.FC<StreamTileProps> = ({
  stream,
  volume = 1,
  onVolumeChange,
  isSpotlighted = false,
  onToggleSpotlight,
  isThumbnail = false,
  onSelectThumbnail,
  isLocalScreenAudioMuted = false,
  onToggleLocalScreenAudio,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [isPreviewPaused, setIsPreviewPaused] = useState(false);
  const hideTimeoutRef = useRef<number | null>(null);

  // Attach and detach video track based on isPreviewPaused
  useEffect(() => {
    if (!videoRef.current || !stream.videoTrack) return;

    if (stream.isLocal && isPreviewPaused) {
      stream.videoTrack.detach(videoRef.current);
      return;
    }

    stream.videoTrack.attach(videoRef.current);

    return () => {
      if (videoRef.current && stream.videoTrack) {
        stream.videoTrack.detach(videoRef.current);
      }
    };
  }, [stream.videoTrack, stream.isLocal, isPreviewPaused]);

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
    const video = videoRef.current;

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
      } else if (video && (video as any).webkitEnterFullscreen) {
        // iOS Safari native video fullscreen
        (video as any).webkitEnterFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
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

  // If thumbnail mode (for spotlight bottom strip)
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
          <span className="truncate font-medium">{stream.participantName}</span>
          {stream.isLocal ? (
            <span className="text-[9px] bg-indigo-500/40 text-indigo-200 px-1 py-0.2 rounded font-semibold">
              Você
            </span>
          ) : isSpotlighted ? (
            <span className="text-[9px] bg-emerald-500/40 text-emerald-200 px-1 py-0.2 rounded font-semibold">
              Foco
            </span>
          ) : null}
        </div>
      </div>
    );
  }

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
      {stream.isLocal && isPreviewPaused ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#0d1017] text-center p-6 select-none animate-fadeIn">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3 shadow-lg shadow-indigo-500/10">
            <Radio className="w-8 h-8 animate-pulse text-indigo-400" />
          </div>
          <h4 className="text-sm font-bold text-white mb-1">Prévia do Streamer Pausada</h4>
          <p className="text-xs text-gray-400 max-w-sm mb-4">
            A renderização local do seu vídeo foi pausada para economizar CPU/GPU e evitar queda de FPS. Seus espectadores continuam assistindo normalmente.
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsPreviewPaused(false);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Reativar Prévia</span>
          </button>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={stream.isLocal}
          className="w-full h-full object-contain bg-black"
        />
      )}

      {/* Top Stream Info Badge */}
      <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-20 flex items-center gap-1.5 sm:gap-2 pointer-events-none">
        <div className="flex items-center gap-1 sm:gap-1.5 bg-red-600/90 backdrop-blur-md px-2 sm:px-2.5 py-0.5 rounded-full text-white text-[10px] sm:text-[11px] font-bold uppercase tracking-wider shadow">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
          <span>AO VIVO</span>
        </div>

        <div className="bg-black/60 backdrop-blur-md border border-white/15 px-2 sm:px-2.5 py-0.5 rounded-full text-[11px] sm:text-xs text-gray-200 flex items-center gap-1.5 shadow">
          <User className="w-3 h-3 text-indigo-400" />
          <span className="font-semibold text-white truncate max-w-[90px] xs:max-w-[130px] sm:max-w-[200px]">
            {stream.participantName}
          </span>
          {stream.isLocal && (
            <span className="text-[10px] bg-indigo-500/40 text-indigo-200 px-1.5 py-0.2 rounded font-bold">
              Você
            </span>
          )}
        </div>
      </div>

      {/* Top Right Pin/Spotlight Button */}
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
        {/* Left: Volume Slider per stream or Local Screen Audio Toggle */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {!stream.isLocal ? (
            <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-white/15 text-white">
              <button
                onClick={toggleMute}
                className="hover:text-indigo-400 transition"
                title={
                  isMuted || volume === 0
                    ? 'Ativar som da transmissão'
                    : 'Silenciar som da transmissão (a voz continuará ativa)'
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
                title="Volume do Som da Transmissão (Jogo/Vídeo)"
                className="w-14 sm:w-20 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <span className="text-[10px] text-gray-300 min-w-[28px]">
                {Math.round((isMuted ? 0 : volume) * 100)}%
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-indigo-500/20 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-indigo-500/30 text-indigo-300 text-xs font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Sua Transmissão</span>
              </div>

              {/* Pause / Resume Local Preview Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPreviewPaused((prev) => !prev);
                }}
                className={`flex items-center gap-1.5 backdrop-blur-md px-2.5 py-1.5 rounded-xl border text-xs font-medium transition shadow ${
                  isPreviewPaused
                    ? 'bg-amber-500/20 border-amber-500/30 text-amber-300 hover:bg-amber-500/30'
                    : 'bg-white/10 border-white/15 text-gray-200 hover:bg-white/20'
                }`}
                title={
                  isPreviewPaused
                    ? 'Reativar prévia local (gasta mais GPU)'
                    : 'Pausar prévia local (economiza CPU/GPU e aumenta FPS)'
                }
              >
                {isPreviewPaused ? (
                  <>
                    <Eye className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[11px] font-semibold">Prévia Pausada</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-gray-300" />
                    <span className="text-[11px]">Pausar Prévia (Aumenta FPS)</span>
                  </>
                )}
              </button>

              {stream.audioTrack && onToggleLocalScreenAudio && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLocalScreenAudio();
                  }}
                  className={`flex items-center gap-1.5 backdrop-blur-md px-2.5 py-1.5 rounded-xl border text-xs font-medium transition shadow ${
                    isLocalScreenAudioMuted
                      ? 'bg-rose-500/20 border-rose-500/30 text-rose-300 hover:bg-rose-500/30'
                      : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30'
                  }`}
                  title={
                    isLocalScreenAudioMuted
                      ? 'Desmutar áudio do compartilhamento'
                      : 'Silenciar áudio do compartilhamento (seu microfone continuará ativo)'
                  }
                >
                  {isLocalScreenAudioMuted ? (
                    <>
                      <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                      <span className="text-[11px] font-semibold">Áudio da tela mutado</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[11px] font-semibold">Áudio da tela ativo</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}
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
