import React, { useEffect, useRef, useState } from 'react';
import type { Track } from 'livekit-client';
import {
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  PictureInPicture,
  Tv,
  Radio,
  Layers,
} from 'lucide-react';
import type { ReactionEvent } from '../types';
import confetti from 'canvas-confetti';

interface VideoPlayerProps {
  track: Track | null;
  hostName?: string;
  isLocal: boolean;
  reaction: ReactionEvent | null;
  onToggleHUD: () => void;
  isHUDOpen: boolean;
  canPlaybackAudio?: boolean;
  onUnlockAudio?: () => void;
  onVolumeChange?: (volume: number) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  track,
  hostName,
  isLocal,
  reaction,
  onToggleHUD,
  isHUDOpen,
  canPlaybackAudio = true,
  onUnlockAudio,
  onVolumeChange,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [activeReactions, setActiveReactions] = useState<{ id: number; emoji: string; sender: string; createdAt: number }[]>([]);

  const hideTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    if (track) {
      track.attach(videoRef.current);
    }

    return () => {
      if (track && videoRef.current) {
        track.detach(videoRef.current);
      }
    };
  }, [track]);

  // Add new reactions and trigger confetti
  useEffect(() => {
    if (!reaction) return;

    const id = Date.now() + Math.random();
    const newReaction = {
      id,
      emoji: reaction.emoji,
      sender: reaction.sender,
      createdAt: Date.now(),
    };

    setActiveReactions((prev) => [...prev.slice(-4), newReaction]);

    if (reaction.emoji === '🎉' || reaction.emoji === '🚀') {
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.8 },
      });
    }
  }, [reaction]);

  // Clean expired reactions every 400ms
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActiveReactions((prev) => {
        const next = prev.filter((r) => now - r.createdAt < 2500);
        return next.length === prev.length ? prev : next;
      });
    }, 400);

    return () => clearInterval(interval);
  }, []);

  const handleMouseMove = () => {
    setShowControls(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = window.setTimeout(() => {
      if (isFullscreen) {
        setShowControls(false);
      }
    }, 3000);
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const togglePiP = async () => {
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
    setVolume(val);
    const effectiveMute = val === 0;
    setIsMuted(effectiveMute);

    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = effectiveMute;
    }

    onVolumeChange?.(effectiveMute ? 0 : val);
  };

  const toggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);

    if (videoRef.current) {
      videoRef.current.muted = nextMute;
    }

    onVolumeChange?.(nextMute ? 0 : volume);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative flex-1 bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-white/5 shadow-2xl group select-none min-h-[400px]"
    >
      {track ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-contain bg-black"
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-center p-8 max-w-md">
          <div className="w-20 h-20 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-6 text-indigo-400 glow-active">
            <Tv className="w-10 h-10 animate-pulse" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Aguardando Transmissão</h3>
          <p className="text-sm text-gray-400 mb-6 leading-relaxed">
            Ninguém está compartilhando tela no momento. Clique em <span className="text-indigo-400 font-medium">Transmitir Tela</span> abaixo para começar a streamar em 60 FPS com áudio!
          </p>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-gray-400">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>Sala pronta para conexão WebRTC de ultra-baixa latência</span>
          </div>
        </div>
      )}

      {/* Floating Reaction Overlay */}
      <div className="absolute bottom-20 right-8 z-30 pointer-events-none flex flex-col items-end gap-2">
        {activeReactions.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-2 bg-black/80 backdrop-blur-md border border-white/15 px-3 py-1.5 rounded-full text-white text-sm shadow-2xl animate-float-up"
          >
            <span className="text-2xl">{r.emoji}</span>
            <span className="text-xs font-semibold text-indigo-300">{r.sender}</span>
          </div>
        ))}
      </div>

      {/* Browser Autoplay Blocked Warning / Unmute Banner */}
      {!canPlaybackAudio && !isLocal && (
        <div
          onClick={onUnlockAudio}
          className="absolute top-16 inset-x-8 z-40 bg-indigo-600/95 hover:bg-indigo-500 backdrop-blur-md border border-indigo-400/30 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center justify-between cursor-pointer animate-pulse transition"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Volume2 className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm">Áudio Pausado pelo Navegador</div>
              <div className="text-xs text-indigo-100">Clique aqui para desbloquear e ouvir o áudio da live</div>
            </div>
          </div>
          <button className="px-4 py-1.5 bg-white text-indigo-700 font-bold text-xs rounded-xl shadow">
            Ativar Som
          </button>
        </div>
      )}

      {/* Top Stream Status Overlay */}
      {track && (
        <div className="absolute top-4 left-4 z-30 flex items-center gap-3">
          <div className="flex items-center gap-2 bg-red-600/90 backdrop-blur-md px-3 py-1 rounded-full text-white text-xs font-bold uppercase tracking-wider shadow-lg">
            <span className="w-2 h-2 rounded-full bg-white animate-ping" />
            <span>AO VIVO</span>
          </div>

          <div className="bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1 rounded-full text-xs text-gray-200 flex items-center gap-2 shadow">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="font-medium text-white">{hostName || 'Host'}</span>
            {isLocal && <span className="text-[10px] bg-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded">Você</span>}
          </div>
        </div>
      )}

      {/* Player Overlaid Controls Bar */}
      {track && (
        <div
          className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 z-30 transition-opacity duration-300 flex items-center justify-between ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-white">
              <button onClick={toggleMute} className="hover:text-indigo-400 transition">
                {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 sm:w-24 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onToggleHUD}
              title="Estatísticas do Stream (HUD)"
              className={`p-2 rounded-xl border transition ${
                isHUDOpen
                  ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg'
                  : 'bg-white/10 border-white/10 text-gray-300 hover:text-white hover:bg-white/20'
              }`}
            >
              <Layers className="w-4 h-4" />
            </button>

            <button
              onClick={togglePiP}
              title="Picture-in-Picture"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-gray-300 hover:text-white transition"
            >
              <PictureInPicture className="w-4 h-4" />
            </button>

            <button
              onClick={toggleFullscreen}
              title="Tela Cheia"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-gray-300 hover:text-white transition"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
