import { useState, type Dispatch, type SetStateAction } from 'react';
import { useLiveKit } from './hooks/useLiveKit';
import { VideoPlayer } from './components/VideoPlayer';
import { ControlsBar } from './components/ControlsBar';
import { ChatPanel } from './components/ChatPanel';
import { StreamHUD } from './components/StreamHUD';
import { ScreenShareModal } from './components/ScreenShareModal';
import { Lobby } from './components/Lobby';
import type { StreamQualityConfig } from './types';

export function App() {
  const [session, setSession] = useState<{
    token: string;
    livekitUrl: string;
    roomName: string;
    userName: string;
    isPublisher: boolean;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isHUDOpen, setIsHUDOpen] = useState(false);
  const [isScreenShareModalOpen, setIsScreenShareModalOpen] = useState(false);

  // Connect to room via token
  const handleJoin = async (
    roomName: string,
    userName: string,
    isPublisher: boolean,
    passcode?: string
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
      const res = await fetch(`${apiBase}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName,
          participantName: userName,
          isPublisher,
          passcode,
          createIfMissing: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Falha ao entrar na sala');
      }

      setSession({
        token: data.token,
        livekitUrl: data.livekitUrl,
        roomName: data.roomName,
        userName: data.identity,
        isPublisher: data.isPublisher,
      });
    } catch (err: any) {
      setError(err.message || 'Erro ao conectar ao servidor de streaming');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLeave = () => {
    setSession(null);
  };

  if (!session) {
    return <Lobby onJoin={handleJoin} isLoading={isLoading} error={error} />;
  }

  return (
    <StreamRoom
      session={session}
      onLeave={handleLeave}
      isChatOpen={isChatOpen}
      setIsChatOpen={setIsChatOpen}
      isHUDOpen={isHUDOpen}
      setIsHUDOpen={setIsHUDOpen}
      isScreenShareModalOpen={isScreenShareModalOpen}
      setIsScreenShareModalOpen={setIsScreenShareModalOpen}
    />
  );
}

interface StreamRoomProps {
  session: {
    token: string;
    livekitUrl: string;
    roomName: string;
    userName: string;
    isPublisher: boolean;
  };
  onLeave: () => void;
  isChatOpen: boolean;
  setIsChatOpen: Dispatch<SetStateAction<boolean>>;
  isHUDOpen: boolean;
  setIsHUDOpen: Dispatch<SetStateAction<boolean>>;
  isScreenShareModalOpen: boolean;
  setIsScreenShareModalOpen: Dispatch<SetStateAction<boolean>>;
}

function StreamRoom({
  session,
  onLeave,
  isChatOpen,
  setIsChatOpen,
  isHUDOpen,
  setIsHUDOpen,
  isScreenShareModalOpen,
  setIsScreenShareModalOpen,
}: StreamRoomProps) {
  const {
    isScreenSharing,
    isMicEnabled,
    isDeafened,
    canPlaybackAudio,
    unlockAudio,
    setGlobalVolume,
    messages,
    participants,
    remoteScreenTrack,
    localScreenTrack,
    stats,
    reaction,
    hostName,
    startScreenShare,
    stopScreenShare,
    toggleMic,
    toggleDeafen,
    sendMessage,
    sendReaction,
    disconnect,
  } = useLiveKit({
    url: session.livekitUrl,
    token: session.token,
    onDisconnected: onLeave,
  });

  const activeVideoTrack = localScreenTrack || remoteScreenTrack;
  const isLocalActive = Boolean(localScreenTrack);

  const handleConfirmScreenShare = (config: StreamQualityConfig) => {
    startScreenShare(config);
  };

  const handleToggleScreenShare = () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      setIsScreenShareModalOpen(true);
    }
  };

  const handleExitRoom = () => {
    disconnect();
    onLeave();
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#090a0f] text-gray-100 overflow-hidden select-none">
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 flex flex-col p-3 sm:p-4 min-w-0 relative">
          <StreamHUD
            stats={stats}
            isOpen={isHUDOpen}
            onClose={() => setIsHUDOpen(false)}
          />

          <VideoPlayer
            track={activeVideoTrack}
            hostName={hostName || session.userName}
            isLocal={isLocalActive}
            reaction={reaction}
            onToggleHUD={() => setIsHUDOpen(!isHUDOpen)}
            isHUDOpen={isHUDOpen}
            canPlaybackAudio={canPlaybackAudio}
            onUnlockAudio={unlockAudio}
            onVolumeChange={setGlobalVolume}
          />
        </div>

        {isChatOpen && (
          <ChatPanel
            messages={messages}
            participants={participants}
            onSendMessage={sendMessage}
            onSendReaction={sendReaction}
            userName={session.userName}
          />
        )}
      </div>

      <ControlsBar
        isMicEnabled={isMicEnabled}
        isDeafened={isDeafened}
        isScreenSharing={isScreenSharing}
        isChatOpen={isChatOpen}
        isHUDOpen={isHUDOpen}
        onToggleMic={toggleMic}
        onToggleDeafen={toggleDeafen}
        onToggleScreenShare={handleToggleScreenShare}
        onOpenScreenShareConfig={() => setIsScreenShareModalOpen(true)}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
        onToggleHUD={() => setIsHUDOpen(!isHUDOpen)}
        onLeave={handleExitRoom}
      />

      <ScreenShareModal
        isOpen={isScreenShareModalOpen}
        onClose={() => setIsScreenShareModalOpen(false)}
        onConfirm={handleConfirmScreenShare}
      />
    </div>
  );
}

export default App;
