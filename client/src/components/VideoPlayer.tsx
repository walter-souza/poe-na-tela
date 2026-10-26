import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  Tv,
  Radio,
  Volume2,
  LayoutGrid,
  Square,
  Layers,
  Sparkles,
  ListVideo,
} from 'lucide-react';
import type { ScreenShareItem, ReactionEvent, StreamLayoutMode, StreamStats } from '../types';
import { StreamTile } from './StreamTile';
import { WhepTile } from './WhepTile';
import { fetchRoomStreams, type ObsStreamItem } from '../utils/api';
import { AvailableStrip, NewStreamToast, StreamPanel, StreamPicker } from './StreamChooser';
import confetti from 'canvas-confetti';

interface UnifiedStreamBase {
  id: string;
  rawId: string;
  volumeId: string;
  name: string;
  /** Own streams and streams the viewer opted into; everything else is not received at all. */
  isWatching: boolean;
  isLocal: boolean;
  resolution?: string;
  bitrateKbps?: number;
}

export type UnifiedStreamItem =
  | (UnifiedStreamBase & { type: 'webrtc'; webrtcStream: ScreenShareItem })
  | (UnifiedStreamBase & { type: 'obs'; obsStream: ObsStreamItem });

// A new stream is announced with a toast, but not for those already live when the room opens.
const INITIAL_SYNC_MS = 4000;
const TOAST_MS = 12000;

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
  /** Starts or stops receiving a remote WebRTC screen share. */
  onScreenShareWatchingChange?: (participantIdentity: string, watching: boolean) => void;
  roomName?: string;
  stats?: StreamStats | null;
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
  onScreenShareWatchingChange,
  roomName,
  stats = null,
}) => {
  const [layoutMode, setLayoutMode] = useState<StreamLayoutMode>('grid');
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [activeReactions, setActiveReactions] = useState<{
    id: number;
    emoji: string;
    sender: string;
    createdAt: number;
  }[]>([]);

  // OBS (MediaMTX) streams in the room; polling only lists them, nothing is received until watched.
  const [obsStreams, setObsStreams] = useState<ObsStreamItem[]>([]);
  const [watchedObs, setWatchedObs] = useState<Set<string>>(new Set());
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [announced, setAnnounced] = useState<UnifiedStreamItem | null>(null);
  const mountedAtRef = useRef(Date.now());
  const seenStreamIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!roomName) return;
    let isMounted = true;

    const poll = async () => {
      const list = await fetchRoomStreams(roomName);
      if (isMounted) {
        setObsStreams((prev) => {
          const key = (l: ObsStreamItem[]) =>
            l.map((s) => `${s.id}:${s.path}:${s.whepUrl}:${s.bitrateKbps ?? ''}`).join('|');
          return key(prev) === key(list) ? prev : list;
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

  // Every live stream (WebRTC and OBS) in one list, flagged by whether the viewer receives it.
  const unifiedStreams = useMemo<UnifiedStreamItem[]>(() => {
    const list: UnifiedStreamItem[] = [];

    for (const s of screenShares) {
      list.push({
        type: 'webrtc',
        id: `webrtc:${s.id}`,
        rawId: s.id,
        volumeId: s.participantIdentity,
        name: s.participantName || s.participantIdentity,
        isWatching: s.isWatching,
        isLocal: s.isLocal,
        resolution: s.resolution,
        webrtcStream: s,
      });
    }

    for (const st of obsStreams) {
      list.push({
        type: 'obs',
        id: `obs:${st.id}`,
        rawId: st.id,
        volumeId: st.id,
        name: st.name,
        isWatching: watchedObs.has(st.id),
        isLocal: false,
        bitrateKbps: st.bitrateKbps,
        obsStream: st,
      });
    }

    return list;
  }, [screenShares, obsStreams, watchedObs]);

  const watchedStreams = useMemo(() => unifiedStreams.filter((s) => s.isWatching), [unifiedStreams]);
  const availableStreams = useMemo(() => unifiedStreams.filter((s) => !s.isWatching), [unifiedStreams]);

  // A stream that ends and comes back is a new one: the viewer decides again.
  useEffect(() => {
    setWatchedObs((prev) => {
      const live = new Set(obsStreams.map((s) => s.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [obsStreams]);

  const setWatching = (item: UnifiedStreamItem, watching: boolean) => {
    if (item.type === 'webrtc') {
      onScreenShareWatchingChange?.(item.volumeId, watching);
      return;
    }
    setWatchedObs((prev) => {
      const next = new Set(prev);
      if (watching) next.add(item.rawId);
      else next.delete(item.rawId);
      return next;
    });
  };

  const stopAll = () => {
    for (const item of watchedStreams) if (!item.isLocal) setWatching(item, false);
  };

  // Announce streams that start while the viewer is already in the room.
  useEffect(() => {
    const current = new Set(unifiedStreams.map((s) => s.id));
    const seen = seenStreamIdsRef.current;
    for (const id of seen) if (!current.has(id)) seen.delete(id);
    const fresh = unifiedStreams.filter((s) => !s.isLocal && !seen.has(s.id));
    fresh.forEach((s) => seen.add(s.id));
    if (fresh.length > 0 && Date.now() - mountedAtRef.current > INITIAL_SYNC_MS) {
      setAnnounced(fresh[fresh.length - 1]);
    }
  }, [unifiedStreams]);

  useEffect(() => {
    if (!announced) return;
    const live = unifiedStreams.find((s) => s.id === announced.id);
    if (!live || live.isWatching) {
      setAnnounced(null);
      return;
    }
    const timer = setTimeout(() => setAnnounced(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [announced, unifiedStreams]);

  // Automatically update spotlightId if current spotlight stream leaves
  useEffect(() => {
    if (watchedStreams.length === 0) {
      setSpotlightId(null);
    } else if (!watchedStreams.some((s) => s.id === spotlightId)) {
      setSpotlightId(watchedStreams[0].id);
    }
  }, [watchedStreams, spotlightId]);

  // Featured stream and other streams for Spotlight mode
  const featuredStream = useMemo(() => {
    if (watchedStreams.length === 0) return null;
    return watchedStreams.find((s) => s.id === spotlightId) || watchedStreams[0];
  }, [watchedStreams, spotlightId]);

  const otherStreams = useMemo(() => {
    return watchedStreams.filter((s) => s.id !== featuredStream?.id);
  }, [watchedStreams, featuredStream]);

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

  // LiveKit stats are room-wide: show them once on the local (publisher) tile and once on the first remote tile.
  const firstLocalId = screenShares.find((s) => s.isLocal)?.id;
  const firstRemoteId = screenShares.find((s) => !s.isLocal && s.isWatching)?.id;
  const ownsStats = (s: ScreenShareItem) =>
    s.isLocal
      ? s.id === firstLocalId && stats?.captureFps !== undefined
      : s.id === firstRemoteId && stats?.bufferDelayMs !== undefined;

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
          onStopWatching={item.isLocal ? undefined : () => setWatching(item, false)}
          isLocalScreenAudioMuted={isLocalScreenAudioMuted}
          onToggleLocalScreenAudio={onToggleLocalScreenAudio}
          stats={stats}
          showStats={isHUDOpen && ownsStats(item.webrtcStream)}
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
        onStopWatching={() => setWatching(item, false)}
        showStats={isHUDOpen}
      />
    );
  };

  // 1. EMPTY STATE (Nenhum stream WebRTC e nenhum stream OBS ativo)
  if (unifiedStreams.length === 0) {
    return (
      <div className="relative flex-1 bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-white/5 shadow-2xl group select-none min-h-[400px]">
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
            <span>Avisaremos quando alguém começar a transmitir</span>
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

  const currentKbps =
    watchedStreams.reduce((sum, s) => sum + (s.type === 'obs' ? s.bitrateKbps ?? 0 : 0), 0) +
    (watchedStreams.some((s) => s.type === 'webrtc' && !s.isLocal) ? stats?.bitrateKbps ?? 0 : 0);

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
          </span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-300">{watchedStreams.filter((w) => !w.isLocal).length} assistindo</span>
        </div>

        {/* Right: Layout Switcher & HUD Toggle */}
        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 bg-black/60 backdrop-blur-md border border-white/15 p-1 rounded-2xl shadow-lg">
          {watchedStreams.length > 1 && (
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
            onClick={() => setIsPanelOpen((open) => !open)}
            title="Escolher quais transmissões assistir"
            className={`p-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
              isPanelOpen ? 'bg-indigo-600 text-white shadow' : 'text-gray-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <ListVideo className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Transmissões</span>
            <span className="bg-indigo-500 text-white text-[10px] px-1.5 rounded-full font-bold">
              {unifiedStreams.length}
            </span>
          </button>

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
      <div className="flex-1 flex flex-col p-1 sm:p-2 min-h-0 pt-12 sm:pt-14 gap-2">
        {watchedStreams.length === 0 ? (
          <StreamPicker items={availableStreams} onWatch={(item) => setWatching(item, true)} />
        ) : layoutMode === 'grid' || watchedStreams.length === 1 ? (
          // GRID MODE LAYOUT
          <div
            className={`flex-1 grid gap-2 sm:gap-3 min-h-0 ${
              watchedStreams.length === 1
                ? 'grid-cols-1'
                : watchedStreams.length === 2
                ? 'grid-cols-1 md:grid-cols-2'
                : watchedStreams.length === 3
                ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                : 'grid-cols-1 md:grid-cols-2'
            }`}
          >
            {watchedStreams.map((item) => (
              <div key={item.id} className="min-h-[160px] sm:min-h-[220px] flex-1 flex">
                {renderStreamTile(item, {
                  isSpotlighted: spotlightId === item.id && watchedStreams.length > 1,
                  onToggleSpotlight:
                    watchedStreams.length > 1
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

        {watchedStreams.length > 0 && availableStreams.length > 0 && (
          <AvailableStrip items={availableStreams} onWatch={(item) => setWatching(item, true)} />
        )}
      </div>

      {isPanelOpen && (
        <StreamPanel
          items={unifiedStreams}
          currentKbps={currentKbps}
          onToggle={setWatching}
          onStopAll={stopAll}
        />
      )}

      {announced && (
        <NewStreamToast
          item={announced}
          onWatch={() => {
            setWatching(announced, true);
            setAnnounced(null);
          }}
          onClose={() => setAnnounced(null)}
        />
      )}

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
