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

  // Automatically update spotlightId if current spotlight stream leaves
  useEffect(() => {
    if (screenShares.length === 0) {
      setSpotlightId(null);
    } else if (!screenShares.some((s) => s.id === spotlightId)) {
      setSpotlightId(screenShares[0].id);
    }
  }, [screenShares, spotlightId]);

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

  const featuredStream = useMemo(() => {
    if (screenShares.length === 0) return null;
    return screenShares.find((s) => s.id === spotlightId) || screenShares[0];
  }, [screenShares, spotlightId]);

  const otherStreams = useMemo(() => {
    return screenShares.filter((s) => s.id !== featuredStream?.id);
  }, [screenShares, featuredStream]);

  // Multi-Stream OBS Squad State
  const [obsStreams, setObsStreams] = useState<ObsStreamItem[]>([]);
  const [activeWhepMap, setActiveWhepMap] = useState<Record<string, boolean>>({});
  const [obsSpotlightId, setObsSpotlightId] = useState<string | null>(null);

  // Poll for active OBS streams in the room
  useEffect(() => {
    if (!roomName) return;
    let isMounted = true;

    const poll = async () => {
      const list = await fetchRoomStreams(roomName);
      if (isMounted) {
        setObsStreams(list);
      }
    };

    poll();
    const interval = setInterval(poll, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [roomName]);

  const displayedObsStreams = useMemo(() => {
    if (obsStreams.length > 0) return obsStreams;
    return roomName
      ? [{ id: 'main', name: 'Principal', path: roomName, whepUrl: getWhepUrl(roomName) }]
      : [];
  }, [obsStreams, roomName]);

  const activeObsStreams = useMemo(() => {
    return displayedObsStreams.filter((s) => Boolean(activeWhepMap[s.id]));
  }, [displayedObsStreams, activeWhepMap]);

  // Keep spotlight id valid for OBS streams
  useEffect(() => {
    if (activeObsStreams.length === 0) {
      setObsSpotlightId(null);
    } else if (!activeObsStreams.some((s) => s.id === obsSpotlightId)) {
      setObsSpotlightId(activeObsStreams[0].id);
    }
  }, [activeObsStreams, obsSpotlightId]);

  // Empty State (0 streams sharing via LiveKit WebRTC)
  if (screenShares.length === 0) {
    const hasActiveObs = activeObsStreams.length > 0;

    // 1. Single OBS Stream Active -> Full container
    if (hasActiveObs && activeObsStreams.length === 1) {
      const single = activeObsStreams[0];
      return (
        <div className="relative flex-1 bg-black rounded-2xl overflow-hidden flex flex-col min-h-[400px]">
          <div className="flex-1 relative">
            <WhepTile
              key={single.id}
              whepUrl={single.whepUrl}
              roomName={roomName || 'Sala'}
              streamerName={single.name}
              onStateChange={(active) => {
                setActiveWhepMap((prev) => (prev[single.id] === active ? prev : { ...prev, [single.id]: active }));
              }}
            />
          </div>
          {/* Reaction Overlay */}
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

    // 2. Multi-Stream OBS Squad (2 or more active OBS streams) -> Squad Grid / Spotlight
    if (hasActiveObs && activeObsStreams.length >= 2) {
      const featuredObs = activeObsStreams.find((s) => s.id === obsSpotlightId) || activeObsStreams[0];
      const otherObs = activeObsStreams.filter((s) => s.id !== featuredObs.id);

      return (
        <div className="relative flex-1 bg-black/40 rounded-2xl overflow-hidden flex flex-col min-h-0">
          {/* Top Multi-Stream Header Bar */}
          <div className="absolute top-2 inset-x-2 sm:top-3 sm:inset-x-3 z-30 flex items-center justify-between pointer-events-none">
            {/* Left: Stream Count */}
            <div className="pointer-events-auto flex items-center gap-2 bg-black/60 backdrop-blur-md border border-white/15 px-3 py-1.5 rounded-2xl text-xs text-white shadow-lg">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-bold">{activeObsStreams.length}</span>
              <span className="text-gray-300">transmissões OBS ao vivo (Squad)</span>
            </div>

            {/* Right: Layout Switcher */}
            <div className="pointer-events-auto flex items-center gap-2 bg-black/60 backdrop-blur-md border border-white/15 p-1 rounded-2xl shadow-lg">
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
          </div>

          {/* Main Video View Area */}
          <div className="flex-1 flex flex-col p-1 sm:p-2 min-h-0 pt-12 sm:pt-14">
            {layoutMode === 'grid' ? (
              <div
                className={`flex-1 grid gap-2 sm:gap-3 min-h-0 ${
                  activeObsStreams.length === 2
                    ? 'grid-cols-1 md:grid-cols-2'
                    : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                }`}
              >
                {activeObsStreams.map((st) => (
                  <div key={st.id} className="min-h-[160px] sm:min-h-[220px] flex-1 flex">
                    <WhepTile
                      whepUrl={st.whepUrl}
                      roomName={roomName || 'Sala'}
                      streamerName={st.name}
                      onStateChange={(active) => {
                        setActiveWhepMap((prev) => (prev[st.id] === active ? prev : { ...prev, [st.id]: active }));
                      }}
                      isSpotlighted={obsSpotlightId === st.id}
                      onToggleSpotlight={() => {
                        setObsSpotlightId(st.id);
                        setLayoutMode('spotlight');
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-3 min-h-0">
                {/* Featured Main Stream */}
                <div className="flex-1 min-h-0 flex">
                  <WhepTile
                    key={featuredObs.id}
                    whepUrl={featuredObs.whepUrl}
                    roomName={roomName || 'Sala'}
                    streamerName={featuredObs.name}
                    onStateChange={(active) => {
                      setActiveWhepMap((prev) => (prev[featuredObs.id] === active ? prev : { ...prev, [featuredObs.id]: active }));
                    }}
                    isSpotlighted={true}
                    onToggleSpotlight={() => setLayoutMode('grid')}
                  />
                </div>

                {/* Other Streams Strip */}
                {otherObs.length > 0 && (
                  <div className="flex items-center justify-center gap-3 overflow-x-auto py-1 px-1 custom-scrollbar">
                    {otherObs.map((st) => (
                      <div
                        key={st.id}
                        onClick={() => setObsSpotlightId(st.id)}
                        className="w-48 h-28 bg-black rounded-xl overflow-hidden border border-white/10 hover:border-indigo-500 cursor-pointer shrink-0 relative transition"
                      >
                        <WhepTile
                          whepUrl={st.whepUrl}
                          roomName={roomName || 'Sala'}
                          streamerName={st.name}
                          onStateChange={(active) => {
                            setActiveWhepMap((prev) => (prev[st.id] === active ? prev : { ...prev, [st.id]: active }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reaction Overlay */}
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

    // 3. No active OBS streams yet -> Empty State with background auto-probing
    return (
      <div className="relative flex-1 bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-white/5 shadow-2xl group select-none min-h-[400px]">
        {/* Probers in background for auto-detection */}
        <div className="hidden">
          {displayedObsStreams.map((st) => (
            <WhepTile
              key={st.id}
              whepUrl={st.whepUrl}
              roomName={roomName || 'Sala'}
              streamerName={st.name}
              onStateChange={(active) => {
                setActiveWhepMap((prev) => (prev[st.id] === active ? prev : { ...prev, [st.id]: active }));
              }}
            />
          ))}
        </div>

        <div className="flex flex-col items-center justify-center text-center p-8 max-w-md z-0">
          <div className="w-20 h-20 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-6 text-indigo-400 glow-active">
            <Tv className="w-10 h-10 animate-pulse" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Aguardando Transmissão</h3>
          <p className="text-sm text-gray-400 mb-6 leading-relaxed">
            Ninguém está transmitindo no momento. Até <strong>múltiplos amigos</strong> podem transmitir via <strong>OBS Studio (SRT 60 FPS)</strong> simultaneamente!
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
            <span>Detecção automática de Squad Stream ativa</span>
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

  return (
    <div className="relative flex-1 bg-black/40 rounded-2xl overflow-hidden flex flex-col min-h-0">
      {/* Top Multi-Stream Header Bar */}
      <div className="absolute top-2 inset-x-2 sm:top-3 sm:inset-x-3 z-30 flex items-center justify-between pointer-events-none">
        {/* Left: Stream Count */}
        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 bg-black/60 backdrop-blur-md border border-white/15 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-2xl text-[11px] sm:text-xs text-white shadow-lg">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold">{screenShares.length}</span>
          <span className="text-gray-300 hidden sm:inline">
            {screenShares.length === 1 ? 'tela ao vivo' : 'telas ao vivo'}
          </span>
        </div>

        {/* Right: Layout Switcher & HUD Toggle */}
        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 bg-black/60 backdrop-blur-md border border-white/15 p-1 rounded-2xl shadow-lg">
          {screenShares.length > 1 && (
            <div className="flex items-center gap-1 border-r border-white/10 pr-1.5 mr-0.5">
              <button
                onClick={() => setLayoutMode('grid')}
                title="Modo Grade (Grid)"
                className={`p-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition ${
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
                className={`p-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition ${
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
            className={`p-1.5 rounded-xl transition ${
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
        {layoutMode === 'grid' || screenShares.length === 1 ? (
          // GRID MODE LAYOUT
          <div
            className={`flex-1 grid gap-2 sm:gap-3 min-h-0 ${
              screenShares.length === 1
                ? 'grid-cols-1'
                : screenShares.length === 2
                ? 'grid-cols-1 md:grid-cols-2'
                : screenShares.length === 3
                ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                : 'grid-cols-1 md:grid-cols-2'
            }`}
          >
            {screenShares.map((stream) => (
              <div key={stream.id} className="min-h-[160px] sm:min-h-[220px] flex-1 flex">
                <StreamTile
                  stream={stream}
                  volume={streamVolumes[stream.participantIdentity] ?? 1}
                  onVolumeChange={(vol) => onStreamVolumeChange(stream.participantIdentity, vol)}
                  isSpotlighted={spotlightId === stream.id && screenShares.length > 1}
                  onToggleSpotlight={
                    screenShares.length > 1
                      ? () => {
                          setSpotlightId(stream.id);
                          setLayoutMode('spotlight');
                        }
                      : undefined
                  }
                  isLocalScreenAudioMuted={isLocalScreenAudioMuted}
                  onToggleLocalScreenAudio={onToggleLocalScreenAudio}
                />
              </div>
            ))}
          </div>
        ) : (
          // SPOTLIGHT MODE LAYOUT
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            {/* Featured Main Stream */}
            {featuredStream && (
              <div className="flex-1 min-h-0 flex">
                <StreamTile
                  stream={featuredStream}
                  volume={streamVolumes[featuredStream.participantIdentity] ?? 1}
                  onVolumeChange={(vol) =>
                    onStreamVolumeChange(featuredStream.participantIdentity, vol)
                  }
                  isSpotlighted={true}
                  onToggleSpotlight={() => setLayoutMode('grid')}
                  isLocalScreenAudioMuted={isLocalScreenAudioMuted}
                  onToggleLocalScreenAudio={onToggleLocalScreenAudio}
                />
              </div>
            )}

            {/* Thumbnail Strip for other streams */}
            {otherStreams.length > 0 && (
              <div className="flex items-center justify-center gap-3 overflow-x-auto py-1 px-1 custom-scrollbar">
                {otherStreams.map((stream) => (
                  <StreamTile
                    key={stream.id}
                    stream={stream}
                    isThumbnail={true}
                    isSpotlighted={false}
                    onSelectThumbnail={() => setSpotlightId(stream.id)}
                  />
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
