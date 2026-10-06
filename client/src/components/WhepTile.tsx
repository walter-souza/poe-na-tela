import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Maximize } from 'lucide-react';

interface WhepTileProps {
  whepUrl: string;
  roomName: string;
}

export const WhepTile: React.FC<WhepTileProps> = ({ whepUrl, roomName }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const startWhep = async () => {
    try {
      if (pcRef.current) {
        pcRef.current.close();
      }

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          videoRef.current.play().catch(() => {});
          setIsPlaying(true);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        } else {
          const checkState = () => {
            if (pc.iceGatheringState === 'complete') {
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
        throw new Error(`Stream SRT/WHEP não disponível (${res.status})`);
      }

      const answerSdp = await res.text();
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });
    } catch (err: any) {
      console.warn('WHEP connection failed:', err);
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    startWhep();

    return () => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
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
    return null; // Se não houver transmissão ativa no MediaMTX, permite exibir a tela padrão
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
        <span className="font-semibold">{roomName} (OBS / SRT)</span>
        <span className="text-gray-400">|</span>
        <span className="text-indigo-400 font-mono font-medium">60 FPS Cravados</span>
      </div>

      {/* Controles Flutuantes */}
      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15">
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="p-1.5 text-gray-300 hover:text-white transition"
          title={isMuted ? 'Desmutar áudio' : 'Mutar áudio'}
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
        </button>

        <button
          onClick={toggleFullscreen}
          className="p-1.5 text-gray-300 hover:text-white transition"
          title="Tela Cheia"
        >
          <Maximize className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
