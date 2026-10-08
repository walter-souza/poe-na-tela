import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { MessageSquare, Tv } from 'lucide-react';
import { useLiveKit } from './hooks/useLiveKit';
import { VideoPlayer } from './components/VideoPlayer';
import { ControlsBar } from './components/ControlsBar';
import { ChatPanel } from './components/ChatPanel';
import { StreamHUD } from './components/StreamHUD';
import { ScreenShareModal } from './components/ScreenShareModal';
import { MaintenanceScreen } from './components/MaintenanceScreen';
import { Lobby } from './components/Lobby';
import { InviteModal } from './components/InviteModal';
import { getHealthUrl, getTokenUrl } from './utils/api';
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
  const [isChatOpen, setIsChatOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768;
    }
    return true;
  });
  const [isHUDOpen, setIsHUDOpen] = useState(false);
  const [isScreenShareModalOpen, setIsScreenShareModalOpen] = useState(false);

  // Maintenance Mode States
  const [isMaintenance, setIsMaintenance] = useState<boolean>(() => {
    return import.meta.env.VITE_MAINTENANCE_MODE === 'true' || import.meta.env.VITE_MAINTENANCE_MODE === '1';
  });
  const [maintenanceMessage, setMaintenanceMessage] = useState<string>('');
  const [isCheckingMaintenance, setIsCheckingMaintenance] = useState(false);

  // Admin bypass token check (URL query param ?bypass=... or ?admin=... or sessionStorage)
  const [adminBypassToken, setAdminBypassToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlBypass = params.get('bypass') || params.get('admin');
    if (urlBypass) {
      sessionStorage.setItem('admin_bypass_token', urlBypass);
      return urlBypass;
    }
    return sessionStorage.getItem('admin_bypass_token') || null;
  });

  // Check health and maintenance mode from API
  const checkMaintenanceStatus = async () => {
    setIsCheckingMaintenance(true);
    try {
      const res = await fetch(getHealthUrl());
      if (res.ok) {
        const data = await res.json();
        if (data.maintenance) {
          setIsMaintenance(true);
          if (data.message) setMaintenanceMessage(data.message);
        } else {
          // If env var is not forcefully true, set false
          if (import.meta.env.VITE_MAINTENANCE_MODE !== 'true') {
            setIsMaintenance(false);
          }
        }
      }
    } catch {
      // If backend is completely down or unreachable
    } finally {
      setIsCheckingMaintenance(false);
    }
  };

  useEffect(() => {
    checkMaintenanceStatus();
  }, []);

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
      const res = await fetch(getTokenUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName,
          participantName: userName,
          isPublisher,
          passcode,
          bypassToken: adminBypassToken,
          createIfMissing: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.maintenance) {
          setIsMaintenance(true);
          if (data.error) setMaintenanceMessage(data.error);
        }
        throw new Error(data.error || 'Falha ao entrar na sala');
      }

      setSession({
        token: data.token,
        livekitUrl: data.livekitUrl,
        roomName: data.roomName,
        userName: data.identity,
        isPublisher: data.isPublisher,
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

  const handleAdminBypass = (key: string) => {
    sessionStorage.setItem('admin_bypass_token', key);
    setAdminBypassToken(key);
    setIsMaintenance(false);
  };

  // If in Maintenance mode and no admin bypass token active, show Maintenance Screen
  if (isMaintenance && !adminBypassToken) {
    return (
      <MaintenanceScreen
        message={maintenanceMessage}
        onRetry={checkMaintenanceStatus}
        isChecking={isCheckingMaintenance}
        onAdminBypass={handleAdminBypass}
      />
    );
  }

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
    isLocalScreenAudioMuted,
    isMicEnabled,
    isDeafened,
    isNoiseSuppressionEnabled,
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
    playoutBufferMs,
    setPlayoutBufferMs,
    reaction,
    startScreenShare,
    stopScreenShare,
    toggleLocalScreenAudio,
    toggleMic,
    toggleDeafen,
    toggleNoiseSuppression,
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
    <div className="h-screen h-[100dvh] w-screen flex flex-col bg-[#090a0f] text-gray-100 overflow-hidden select-none">
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 flex flex-col p-1 sm:p-3 md:p-4 min-w-0 relative">
          <StreamHUD
            stats={stats}
            isOpen={isHUDOpen}
            onClose={() => setIsHUDOpen(false)}
            playoutBufferMs={playoutBufferMs}
            onPlayoutBufferChange={setPlayoutBufferMs}
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
            roomName={session.roomName}
          />

          {/* Centered Room Name at top */}
          <div className="absolute top-2 sm:top-6 inset-x-0 mx-auto w-fit z-20 pointer-events-none flex items-center justify-center px-2">
            <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-2xl bg-[#11131c]/90 border border-white/15 text-white text-[11px] sm:text-xs font-semibold shadow-2xl backdrop-blur-md select-none">
              <Tv className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="text-gray-400 font-medium hidden sm:inline">Sala:</span>
              <span className="font-bold text-white tracking-wide max-w-[100px] xs:max-w-[140px] sm:max-w-xs md:max-w-md truncate">
                {session.roomName}
              </span>
            </div>
          </div>

          {!isChatOpen && (
            <button
              onClick={() => setIsChatOpen(true)}
              title="Exibir Chat e Participantes"
              className="absolute top-2 right-2 sm:top-6 sm:right-6 z-30 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2.5 rounded-2xl bg-[#11131c]/90 hover:bg-[#181a26] border border-white/15 text-white text-xs font-semibold shadow-2xl backdrop-blur-md transition-all hover:scale-105 active:scale-95 group cursor-pointer"
            >
              <MessageSquare className="w-4 h-4 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              <span className="hidden sm:inline">Exibir Chat</span>
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
        isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
        isScreenSharing={isScreenSharing}
        isChatOpen={isChatOpen}
        isHUDOpen={isHUDOpen}
        roomName={session.roomName}
        onToggleMic={toggleMic}
        onToggleDeafen={toggleDeafen}
        onToggleNoiseSuppression={toggleNoiseSuppression}
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
