import { useState, type Dispatch, type SetStateAction } from 'react';
import { useLiveKit } from './hooks/useLiveKit';
import { VideoPlayer } from './components/VideoPlayer';
import { ControlsBar } from './components/ControlsBar';
import { ChatPanel } from './components/ChatPanel';
import { StreamHUD } from './components/StreamHUD';
import { ScreenShareModal } from './components/ScreenShareModal';
import { Lobby } from './components/Lobby';
import { InviteModal } from './components/InviteModal';
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

  // Detect room parameter in URL for invite link auto-redirection
  const [inviteRoomName, setInviteRoomName] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || params.get('r') || null;
  });

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

      // Update URL search param to reflect active room
      window.history.replaceState({}, '', `${window.location.pathname}?room=${encodeURIComponent(data.roomName)}`);
      setInviteRoomName(null);
    } catch (err: any) {
      const msg = err.message || 'Erro ao conectar ao servidor de streaming';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const handleLeave = () => {
    window.history.replaceState({}, '', window.location.pathname);
    setSession(null);
    setInviteRoomName(null);
  };

  const handleCancelInvite = () => {
    window.history.replaceState({}, '', window.location.pathname);
    setInviteRoomName(null);
  };

  if (!session) {
    return (
      <>
        <Lobby onJoin={handleJoin} isLoading={isLoading} error={error} />
        {inviteRoomName && (
          <InviteModal
            isOpen={Boolean(inviteRoomName)}
            roomName={inviteRoomName}
            onJoin={handleJoin}
            onCancel={handleCancelInvite}
          />
        )}
      </>
    );
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
    setStreamVolume,
    streamVolumes,
    screenShares,
    messages,
    participants,
    stats,
    reaction,
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
            screenShares={screenShares}
            streamVolumes={streamVolumes}
            onStreamVolumeChange={setStreamVolume}
            reaction={reaction}
            onToggleHUD={() => setIsHUDOpen(!isHUDOpen)}
            isHUDOpen={isHUDOpen}
            canPlaybackAudio={canPlaybackAudio}
            onUnlockAudio={unlockAudio}
            onOpenScreenShareConfig={() => setIsScreenShareModalOpen(true)}
          />
        </div>

        {isChatOpen && (
          <ChatPanel
            messages={messages}
            participants={participants}
            onSendMessage={sendMessage}
            onSendReaction={sendReaction}
            userName={session.userName}
            roomName={session.roomName}
          />
        )}
      </div>

      <ControlsBar
        isMicEnabled={isMicEnabled}
        isDeafened={isDeafened}
        isScreenSharing={isScreenSharing}
        isChatOpen={isChatOpen}
        isHUDOpen={isHUDOpen}
        roomName={session.roomName}
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
