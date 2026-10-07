import React, { useEffect, useState, useMemo } from 'react';
import {
  Tv,
  Radio,
  Volume2,
  LayoutGrid,
  Square,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { ScreenShareItem, ReactionEvent, StreamLayoutMode } from '../types';
import { StreamTile } from './StreamTile';
import { WhepTile } from './WhepTile';
import { getWhepUrl, fetchRoomStreams, type ObsStreamItem } from '../utils/api';
import confetti from 'canvas-confetti';

export type UnifiedStreamItem =
  | {
      type: 'webrtc';
      id: string;
      rawId: string;
      volumeId: string;
      name: string;
      webrtcStream: ScreenShareItem;
    }
  | {
      type: 'obs';
      id: string;
      rawId: string;
      volumeId: string;
      name: string;
      obsStream: ObsStreamItem;
    };

interface VideoPlayerProps {
  screenShares: ScreenShareItem[];
  streamVolumes: Record<string, number>;
  onStreamVolumeChange: (participantIdentity: string, volume: number) => void;
  reaction: ReactionEvent | null;
  onToggleHUD: () => void;
  isHUDOpen: boolean;
  canPlaybackAudio?: boolean;
  onUnlockAudio?: () => void;
  onOpenScreenShareConfig?: () => void;
  isLocalScreenAudioMuted?: boolean;
  onToggleLocalScreenAudio?: () => void;
  roomName?: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  screenShares,
  streamVolumes,
  onStreamVolumeChange,
  reaction,
  onToggleHUD,
  isHUDOpen,
  canPlaybackAudio = true,
  onUnlockAudio,
  onOpenScreenShareConfig,
  isLocalScreenAudioMuted = false,
  onToggleLocalScreenAudio,
  roomName,
}) => {
  const [layoutMode, setLayoutMode] = useState<StreamLayoutMode>('grid');
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [activeReactions, setActiveReactions] = useState<{
    id: number;
    emoji: string;
    sender: string;
    createdAt: number;
  }[]>([]);

  // Multi-Stream OBS Squad State
  const [obsStreams, setObsStreams] = useState<ObsStreamItem[]>([]);
  const [activeWhepMap, setActiveWhepMap] = useState<Record<string, boolean>>({});

  // Poll for active OBS streams in the room
  useEffect(() => {
    if (!roomName) return;
    let isMounted = true;

    const poll = async () => {
      const list = await fetchRoomStreams(roomName);
      if (isMounted) {
        setObsStreams((prev) => {
          const prevKeys = prev.map((s) => `${s.id}:${s.path}:${s.whepUrl}`).join('|');
          const nextKeys = list.map((s) => `${s.id}:${s.path}:${s.whepUrl}`).join('|');
          return prevKeys === nextKeys ? prev : list;
        });
      }
    };

    poll();
    const interval = setInterval(poll, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [roomName]);

  // Active OBS streams from MediaMTX polling or fallback
  const effectiveObsStreams = useMemo(() => {
    if (obsStreams.length > 0) return obsStreams;
    if (activeWhepMap['main'] && roomName) {
      return [{ id: 'main', name: 'Principal', path: roomName, whepUrl: getWhepUrl(roomName) }];
    }
    return [];
  }, [obsStreams, activeWhepMap, roomName]);

  // UNIFIED HYBRID STREAM ENGINE: Combines WebRTC Screen Shares and OBS Streams
  const unifiedStreams = useMemo<UnifiedStreamItem[]>(() => {
    const list: UnifiedStreamItem[] = [];

    // 1. WebRTC screenshares (LiveKit)
    for (const s of screenShares) {
      list.push({
        type: 'webrtc',
        id: `webrtc:${s.id}`,
        rawId: s.id,
        volumeId: s.participantIdentity,
        name: s.participantName || s.participantIdentity,
        webrtcStream: s,
      });
    }

    // 2. OBS Studio streams (SRT / MediaMTX / WHEP)
    for (const st of effectiveObsStreams) {
      list.push({
        type: 'obs',
        id: `obs:${st.id}`,
        rawId: st.id,
        volumeId: st.id,
        name: st.name,
        obsStream: st,
      });
    }

    return list;
  }, [screenShares, effectiveObsStreams]);

  // Automatically update spotlightId if current spotlight stream leaves
  useEffect(() => {
    if (unifiedStreams.length === 0) {
      setSpotlightId(null);
    } else if (!unifiedStreams.some((s) => s.id === spotlightId)) {
      setSpotlightId(unifiedStreams[0].id);
    }
  }, [unifiedStreams, spotlightId]);

  // Featured stream and other streams for Spotlight mode
  const featuredStream = useMemo(() => {
    if (unifiedStreams.length === 0) return null;
    return unifiedStreams.find((s) => s.id === spotlightId) || unifiedStreams[0];
  }, [unifiedStreams, spotlightId]);

  const otherStreams = useMemo(() => {
    return unifiedStreams.filter((s) => s.id !== featuredStream?.id);
  }, [unifiedStreams, featuredStream]);

  // Floating reactions & confetti triggers
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

  // Helper to render polymorphic stream tile (WebRTC or OBS)
  const renderStreamTile = (
    item: UnifiedStreamItem,
    options: {
      isSpotlighted?: boolean;
      onToggleSpotlight?: () => void;
      isThumbnail?: boolean;
      onSelectThumbnail?: () => void;
    } = {}
  ) => {
    if (item.type === 'webrtc') {
      return (
        <StreamTile
          key={item.id}
          stream={item.webrtcStream}
          volume={streamVolumes[item.volumeId] ?? 1}
          onVolumeChange={(vol) => onStreamVolumeChange(item.volumeId, vol)}
          isSpotlighted={options.isSpotlighted}
          onToggleSpotlight={options.onToggleSpotlight}
          isThumbnail={options.isThumbnail}
          onSelectThumbnail={options.onSelectThumbnail}
          isLocalScreenAudioMuted={isLocalScreenAudioMuted}
          onToggleLocalScreenAudio={onToggleLocalScreenAudio}
        />
      );
    }

    return (
      <WhepTile
        key={item.id}
        whepUrl={item.obsStream.whepUrl}
        roomName={roomName || 'Sala'}
        streamerName={item.name}
        volume={streamVolumes[item.volumeId] ?? 1}
        onVolumeChange={(vol) => onStreamVolumeChange(item.volumeId, vol)}
        isSpotlighted={options.isSpotlighted}
        onToggleSpotlight={options.onToggleSpotlight}
        isThumbnail={options.isThumbnail}
        onSelectThumbnail={options.onSelectThumbnail}
        onStateChange={(active) => {
          setActiveWhepMap((prev) =>
            prev[item.rawId] === active ? prev : { ...prev, [item.rawId]: active }
          );
        }}
      />
    );
  };

  // 1. EMPTY STATE (Nenhum stream WebRTC e nenhum stream OBS ativo)
  if (unifiedStreams.length === 0) {
    return (
      <div className="relative flex-1 bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-white/5 shadow-2xl group select-none min-h-[400px]">
        {/* Background prober for auto-detection of default room stream */}
        <div className="hidden">
          <WhepTile
            key="main"
            whepUrl={getWhepUrl(roomName || 'Sala')}
            roomName={roomName || 'Sala'}
            onStateChange={(active) => {
              setActiveWhepMap((prev) => (prev['main'] === active ? prev : { ...prev, main: active }));
            }}
          />
        </div>

        <div className="flex flex-col items-center justify-center text-center p-8 max-w-md z-0">
          <div className="w-20 h-20 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-6 text-indigo-400 glow-active">
            <Tv className="w-10 h-10 animate-pulse" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Aguardando Transmissão</h3>
          <p className="text-sm text-gray-400 mb-6 leading-relaxed">
            Ninguém está transmitindo no momento. Compartilhe sua tela pelo navegador/desktop ou conecte via <strong>OBS Studio (SRT 60 FPS)</strong>!
          </p>

          {onOpenScreenShareConfig && (
            <button
              onClick={onOpenScreenShareConfig}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition transform hover:scale-[1.02] active:scale-[0.98] mb-6 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Começar a Transmitir</span>
            </button>
          )}

          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>Detecção automática de transmissões ativa</span>
          </div>
        </div>

        {/* Floating Reaction Overlay */}
        <div className="absolute bottom-6 right-6 z-30 pointer-events-none flex flex-col items-end gap-2">
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
      </div>
    );
  }

  const webrtcCount = screenShares.length;
  const obsCount = effectiveObsStreams.length;

  // 2. ACTIVE STREAMS VIEW (Híbrido: WebRTC + OBS em conjunto)
  return (
    <div className="relative flex-1 bg-black/40 rounded-2xl overflow-hidden flex flex-col min-h-0">
      {/* Top Multi-Stream Header Bar */}
      <div className="absolute top-2 inset-x-2 sm:top-3 sm:inset-x-3 z-30 flex items-center justify-between pointer-events-none">
        {/* Left: Stream Count & Breakdown */}
        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 bg-black/60 backdrop-blur-md border border-white/15 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-2xl text-[11px] sm:text-xs text-white shadow-lg">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold">{unifiedStreams.length}</span>
          <span className="text-gray-300 hidden sm:inline">
            {unifiedStreams.length === 1 ? 'transmissão ao vivo' : 'transmissões ao vivo'}
            {unifiedStreams.length > 1 && (
              <span className="text-indigo-300 font-medium ml-1">
                ({webrtcCount > 0 ? `${webrtcCount} WebRTC` : ''}
                {webrtcCount > 0 && obsCount > 0 ? ' • ' : ''}
                {obsCount > 0 ? `${obsCount} OBS` : ''})
              </span>
            )}
          </span>
        </div>

        {/* Right: Layout Switcher & HUD Toggle */}
        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 bg-black/60 backdrop-blur-md border border-white/15 p-1 rounded-2xl shadow-lg">
          {unifiedStreams.length > 1 && (
            <div className="flex items-center gap-1 border-r border-white/10 pr-1.5 mr-0.5">
              <button
                onClick={() => setLayoutMode('grid')}
                title="Modo Grade (Grid)"
                className={`p-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  layoutMode === 'grid'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-gray-400 hover:text-white hover:bg-white/10'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Grade</span>
              </button>

              <button
                onClick={() => setLayoutMode('spotlight')}
                title="Modo Destaque (Spotlight)"
                className={`p-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  layoutMode === 'spotlight'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-gray-400 hover:text-white hover:bg-white/10'
                }`}
              >
                <Square className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Destaque</span>
              </button>
            </div>
          )}

          <button
            onClick={onToggleHUD}
            title="Estatísticas Técnicas (HUD)"
            className={`p-1.5 rounded-xl transition cursor-pointer ${
              isHUDOpen
                ? 'bg-indigo-600 text-white shadow'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Browser Autoplay Blocked Warning / Unmute Banner */}
      {!canPlaybackAudio && (
        <div
          onClick={onUnlockAudio}
          className="absolute top-14 sm:top-16 inset-x-2 sm:inset-x-8 z-40 bg-indigo-600/95 hover:bg-indigo-500 backdrop-blur-md border border-indigo-400/30 text-white px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl shadow-2xl flex items-center justify-between cursor-pointer animate-pulse transition"
        >
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-white/20 rounded-xl">
              <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <div className="font-bold text-xs sm:text-sm">Áudio Pausado pelo Navegador</div>
              <div className="text-[11px] sm:text-xs text-indigo-100">
                Toque aqui para desbloquear e ouvir o áudio
              </div>
            </div>
          </div>
          <button className="px-3 sm:px-4 py-1.5 bg-white text-indigo-700 font-bold text-xs rounded-xl shadow shrink-0">
            Ativar Som
          </button>
        </div>
      )}

      {/* Main Video View Area */}
      <div className="flex-1 flex flex-col p-1 sm:p-2 min-h-0 pt-12 sm:pt-14">
        {layoutMode === 'grid' || unifiedStreams.length === 1 ? (
          // GRID MODE LAYOUT
          <div
            className={`flex-1 grid gap-2 sm:gap-3 min-h-0 ${
              unifiedStreams.length === 1
                ? 'grid-cols-1'
                : unifiedStreams.length === 2
                ? 'grid-cols-1 md:grid-cols-2'
                : unifiedStreams.length === 3
                ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                : 'grid-cols-1 md:grid-cols-2'
            }`}
          >
            {unifiedStreams.map((item) => (
              <div key={item.id} className="min-h-[160px] sm:min-h-[220px] flex-1 flex">
                {renderStreamTile(item, {
                  isSpotlighted: spotlightId === item.id && unifiedStreams.length > 1,
                  onToggleSpotlight:
                    unifiedStreams.length > 1
                      ? () => {
                          setSpotlightId(item.id);
                          setLayoutMode('spotlight');
                        }
                      : undefined,
                })}
              </div>
            ))}
          </div>
        ) : (
          // SPOTLIGHT MODE LAYOUT
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            {/* Featured Main Stream */}
            {featuredStream && (
              <div className="flex-1 min-h-0 flex">
                {renderStreamTile(featuredStream, {
                  isSpotlighted: true,
                  onToggleSpotlight: () => setLayoutMode('grid'),
                })}
              </div>
            )}

            {/* Thumbnail Strip for other streams */}
            {otherStreams.length > 0 && (
              <div className="flex items-center justify-center gap-3 overflow-x-auto py-1 px-1 custom-scrollbar">
                {otherStreams.map((item) => (
                  <div key={item.id} className="shrink-0">
                    {renderStreamTile(item, {
                      isThumbnail: true,
                      isSpotlighted: false,
                      onSelectThumbnail: () => setSpotlightId(item.id),
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Reaction Overlay */}
      <div className="absolute bottom-6 right-6 z-30 pointer-events-none flex flex-col items-end gap-2">
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
    </div>
  );
};
