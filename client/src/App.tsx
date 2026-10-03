import { useState, type Dispatch, type SetStateAction } from 'react';
import { MessageSquare, Tv, Server } from 'lucide-react';
import { useLiveKit } from './hooks/useLiveKit';
import { VideoPlayer } from './components/VideoPlayer';
import { ControlsBar } from './components/ControlsBar';
import { ChatPanel } from './components/ChatPanel';
import { StreamHUD } from './components/StreamHUD';
import { ScreenShareModal } from './components/ScreenShareModal';
import { ServerMigrationModal } from './components/ServerMigrationModal';
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
    projectId?: string;
    projectName?: string;
    passcode?: string;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isHUDOpen, setIsHUDOpen] = useState(false);
  const [isScreenShareModalOpen, setIsScreenShareModalOpen] = useState(false);
  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
  const [migrationReason, setMigrationReason] = useState<'limit_reached' | 'manual'>('limit_reached');
  const [isMigrating, setIsMigrating] = useState(false);

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
        projectId: data.projectId,
        projectName: data.projectName,
        passcode,
      });

      // Clean URL search params so the address bar stays clean (without ?room=...)
      window.history.replaceState({}, '', window.location.pathname);
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
      setSession={setSession}
      onLeave={handleLeave}
      isChatOpen={isChatOpen}
      setIsChatOpen={setIsChatOpen}
      isHUDOpen={isHUDOpen}
      setIsHUDOpen={setIsHUDOpen}
      isScreenShareModalOpen={isScreenShareModalOpen}
      setIsScreenShareModalOpen={setIsScreenShareModalOpen}
      isMigrationModalOpen={isMigrationModalOpen}
      setIsMigrationModalOpen={setIsMigrationModalOpen}
      migrationReason={migrationReason}
      setMigrationReason={setMigrationReason}
      isMigrating={isMigrating}
      setIsMigrating={setIsMigrating}
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
    projectId?: string;
    projectName?: string;
    passcode?: string;
  };
  setSession: Dispatch<SetStateAction<{
    token: string;
    livekitUrl: string;
    roomName: string;
    userName: string;
    isPublisher: boolean;
    projectId?: string;
    projectName?: string;
    passcode?: string;
  } | null>>;
  onLeave: () => void;
  isChatOpen: boolean;
  setIsChatOpen: Dispatch<SetStateAction<boolean>>;
  isHUDOpen: boolean;
  setIsHUDOpen: Dispatch<SetStateAction<boolean>>;
  isScreenShareModalOpen: boolean;
  setIsScreenShareModalOpen: Dispatch<SetStateAction<boolean>>;
  isMigrationModalOpen: boolean;
  setIsMigrationModalOpen: Dispatch<SetStateAction<boolean>>;
  migrationReason: 'limit_reached' | 'manual';
  setMigrationReason: Dispatch<SetStateAction<'limit_reached' | 'manual'>>;
  isMigrating: boolean;
  setIsMigrating: Dispatch<SetStateAction<boolean>>;
}

function StreamRoom({
  session,
  setSession,
  onLeave,
  isChatOpen,
  setIsChatOpen,
  isHUDOpen,
  setIsHUDOpen,
  isScreenShareModalOpen,
  setIsScreenShareModalOpen,
  isMigrationModalOpen,
  setIsMigrationModalOpen,
  migrationReason,
  setMigrationReason,
  isMigrating,
  setIsMigrating,
}: StreamRoomProps) {
  // Re-join when migration signal is received from other participants or backend
  const handleMigrationSignal = async () => {
    try {
      setIsMigrating(true);
      const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
      const res = await fetch(`${apiBase}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: session.roomName,
          participantName: session.userName,
          isPublisher: session.isPublisher,
          passcode: session.passcode,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSession({
          token: data.token,
          livekitUrl: data.livekitUrl,
          roomName: data.roomName,
          userName: data.identity,
          isPublisher: data.isPublisher,
          projectId: data.projectId,
          projectName: data.projectName,
          passcode: session.passcode,
        });
      }
    } catch (err) {
      console.error('Falha ao reconectar após sinal de migração:', err);
    } finally {
      setIsMigrating(false);
    }
  };

  const {
    isScreenSharing,
    isLocalScreenAudioMuted,
    isMicEnabled,
    isDeafened,
    canPlaybackAudio,
    unlockAudio,
    setStreamVolume,
    streamVolumes,
    setUserVolume,
    userVolumes,
    screenShares,
    messages,
    participants,
    stats,
    reaction,
    startScreenShare,
    stopScreenShare,
    toggleLocalScreenAudio,
    toggleMic,
    toggleDeafen,
    sendMessage,
    sendReaction,
    sendMigrationSignal,
    disconnect,
  } = useLiveKit({
    url: session.livekitUrl,
    token: session.token,
    onDisconnected: onLeave,
    onMigrationSignal: handleMigrationSignal,
  });

  const handleConfirmScreenShare = async (config: StreamQualityConfig) => {
    try {
      await startScreenShare(config);
    } catch (err) {
      // If sharing fails (e.g. quota/bandwidth/permission limits), prompt migration modal
      setMigrationReason('limit_reached');
      setIsMigrationModalOpen(true);
    }
  };

  const handleToggleScreenShare = () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      setIsScreenShareModalOpen(true);
    }
  };

  const handleExecuteMigration = async () => {
    setIsMigrating(true);
    try {
      const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
      const res = await fetch(`${apiBase}/room/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: session.roomName,
          passcode: session.passcode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao migrar sala');
      }

      // Broadcast signal to everyone in the room
      await sendMigrationSignal(data.targetProjectId);

      // Fetch new token for self on the target project
      const tokenRes = await fetch(`${apiBase}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: session.roomName,
          participantName: session.userName,
          isPublisher: session.isPublisher,
          passcode: session.passcode,
        }),
      });
      const tokenData = await tokenRes.json();

      setSession({
        token: tokenData.token,
        livekitUrl: tokenData.livekitUrl,
        roomName: tokenData.roomName,
        userName: tokenData.identity,
        isPublisher: tokenData.isPublisher,
        projectId: tokenData.projectId,
        projectName: tokenData.projectName,
        passcode: session.passcode,
      });

      setIsMigrationModalOpen(false);
    } catch (err: any) {
      alert(`Erro na migração: ${err.message}`);
    } finally {
      setIsMigrating(false);
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
            isLocalScreenAudioMuted={isLocalScreenAudioMuted}
            onToggleLocalScreenAudio={toggleLocalScreenAudio}
          />

          {/* Centered Room Name & Server Badge at top */}
          <div className="absolute top-6 inset-x-0 mx-auto w-fit z-20 pointer-events-none flex items-center justify-center gap-2">
            <div className="pointer-events-auto flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-[#11131c]/90 border border-white/15 text-white text-xs font-semibold shadow-2xl backdrop-blur-md select-none">
              <Tv className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-gray-400 font-medium">Sala:</span>
              <span className="font-bold text-white tracking-wide max-w-[180px] sm:max-w-xs truncate">
                {session.roomName}
              </span>
            </div>

            {session.projectName && (
              <button
                onClick={() => {
                  setMigrationReason('manual');
                  setIsMigrationModalOpen(true);
                }}
                title="Clique para alternar o servidor da sala"
                className="pointer-events-auto hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-[#11131c]/90 hover:bg-amber-500/10 border border-white/15 hover:border-amber-500/30 text-amber-300 text-xs font-semibold shadow-2xl backdrop-blur-md transition cursor-pointer"
              >
                <Server className="w-3.5 h-3.5 text-amber-400" />
                <span>{session.projectName}</span>
              </button>
            )}
          </div>

          {!isChatOpen && (
            <button
              onClick={() => setIsChatOpen(true)}
              title="Exibir Chat e Participantes"
              className="absolute top-6 right-6 z-30 flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-[#11131c]/90 hover:bg-[#181a26] border border-white/15 text-white text-xs font-semibold shadow-2xl backdrop-blur-md transition-all hover:scale-105 active:scale-95 group cursor-pointer"
            >
              <MessageSquare className="w-4 h-4 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              <span>Exibir Chat</span>
              {messages.length > 0 && (
                <span className="bg-indigo-600 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                  {messages.length}
                </span>
              )}
            </button>
          )}
        </div>

        {isChatOpen && (
          <ChatPanel
            messages={messages}
            participants={participants}
            onSendMessage={sendMessage}
            onSendReaction={sendReaction}
            userName={session.userName}
            roomName={session.roomName}
            onClose={() => setIsChatOpen(false)}
            userVolumes={userVolumes}
            onUserVolumeChange={setUserVolume}
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
        projectName={session.projectName}
        onToggleMic={toggleMic}
        onToggleDeafen={toggleDeafen}
        onToggleScreenShare={handleToggleScreenShare}
        onOpenScreenShareConfig={() => setIsScreenShareModalOpen(true)}
        onOpenMigrationModal={() => {
          setMigrationReason('manual');
          setIsMigrationModalOpen(true);
        }}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
        onToggleHUD={() => setIsHUDOpen(!isHUDOpen)}
        onLeave={handleExitRoom}
      />

      <ScreenShareModal
        isOpen={isScreenShareModalOpen}
        onClose={() => setIsScreenShareModalOpen(false)}
        onConfirm={handleConfirmScreenShare}
      />

      <ServerMigrationModal
        isOpen={isMigrationModalOpen}
        onClose={() => setIsMigrationModalOpen(false)}
        onConfirm={handleExecuteMigration}
        isLoading={isMigrating}
        currentServerName={session.projectName || 'Servidor Atual'}
        reason={migrationReason}
      />
    </div>
  );
}

export default App;
