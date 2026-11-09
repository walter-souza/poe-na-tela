import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { MessageSquare, RefreshCw, Tv } from 'lucide-react';
import { useLiveKit } from './hooks/useLiveKit';
import { useNativeStream } from './hooks/useNativeStream';
import { useHotkeys } from './hooks/useHotkeys';
import { useAppUpdate } from './hooks/useAppUpdate';
import { useClip } from './hooks/useClip';
import { NativeStreamModal } from './components/NativeStreamModal';
import { NativeStreamStatus } from './components/NativeStreamStatus';
import { HotkeyModal } from './components/HotkeyModal';
import { isDesktop } from './utils/desktop';
import { VideoPlayer } from './components/VideoPlayer';
import { ControlsBar } from './components/ControlsBar';
import { ClipPreviewModal } from './components/ClipPreviewModal';
import { ChatPanel } from './components/ChatPanel';
import { ScreenShareModal } from './components/ScreenShareModal';
import { MaintenanceScreen } from './components/MaintenanceScreen';
import { Lobby } from './components/Lobby';
import { InviteModal } from './components/InviteModal';
import { getHealthUrl, getTokenUrl } from './utils/api';
import type { StreamQualityConfig } from './types';
import { saveResume, takeResume, type JoinArgs, type RoomRestore } from './utils/resumeSession';

// Read once per page load (outside React, so StrictMode's double render can't consume it twice).
const initialResume = takeResume();
const UPDATE_COUNTDOWN_S = 10;

export function App() {
  const [session, setSession] = useState<{
    token: string;
    livekitUrl: string;
    roomName: string;
    userName: string;
    isPublisher: boolean;
    /** Senha SRT do caminho sala/nome deste participante (OBS e app desktop). */
    streamKey: string;
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

  // New deploys are applied by reloading the page; inside a room the session is carried across it.
  const updateAvailable = useAppUpdate();
  const [isResuming, setIsResuming] = useState(Boolean(initialResume));
  const [roomRestore, setRoomRestore] = useState<RoomRestore | null>(initialResume);
  const lastJoinRef = useRef<JoinArgs | null>(null);
  const resumeStartedRef = useRef(false);

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
        throw Object.assign(new Error(data.error || 'Falha ao entrar na sala'), { status: res.status });
      }

      lastJoinRef.current = { roomName, userName, isPublisher, passcode };

      setSession({
        token: data.token,
        livekitUrl: data.livekitUrl,
        roomName: data.roomName,
        userName: data.identity,
        isPublisher: data.isPublisher,
        streamKey: data.streamKey,
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

  // Back into the room this tab was in before the update reload. Its old connection can linger in the
  // room for a few seconds, which the server reports as the name being taken (409), so retry briefly.
  useEffect(() => {
    if (!initialResume || resumeStartedRef.current) return;
    resumeStartedRef.current = true;
    const { roomName, userName, isPublisher, passcode } = initialResume.join;
    (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await handleJoin(roomName, userName, isPublisher, passcode);
          break;
        } catch (err: any) {
          if (err?.status !== 409 || attempt >= 5) {
            setRoomRestore(null);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      setIsResuming(false);
    })();
  }, []);

  // Outside a room there is nothing to lose: apply the update right away.
  useEffect(() => {
    if (updateAvailable && !session && !isResuming && !isLoading) window.location.reload();
  }, [updateAvailable, session, isResuming, isLoading]);

  const reloadForUpdate = (room: RoomRestore) => {
    if (lastJoinRef.current) saveResume({ join: lastJoinRef.current, ...room });
    window.location.reload();
  };

  const handleLeave = () => {
    window.history.replaceState({}, '', window.location.pathname);
    setRoomRestore(null);
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

  if (isResuming && !session) {
    return (
      <div className="min-h-screen min-h-[100dvh] w-screen bg-[#07080d] flex flex-col items-center justify-center gap-3 text-gray-100 select-none">
        <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
        <p className="text-sm font-semibold">Aplicativo atualizado</p>
        <p className="text-xs text-gray-400">Voltando para a sala {initialResume?.join.roomName}…</p>
      </div>
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
      restore={roomRestore}
      updateAvailable={updateAvailable}
      onReloadForUpdate={reloadForUpdate}
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
    /** Senha SRT do caminho sala/nome deste participante (OBS e app desktop). */
    streamKey: string;
  };
  onLeave: () => void;
  isChatOpen: boolean;
  setIsChatOpen: Dispatch<SetStateAction<boolean>>;
  isHUDOpen: boolean;
  setIsHUDOpen: Dispatch<SetStateAction<boolean>>;
  isScreenShareModalOpen: boolean;
  setIsScreenShareModalOpen: Dispatch<SetStateAction<boolean>>;
  restore: RoomRestore | null;
  updateAvailable: boolean;
  onReloadForUpdate: (room: RoomRestore) => void;
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
  restore,
  updateAvailable,
  onReloadForUpdate,
}: StreamRoomProps) {
  const {
    room,
    isScreenSharing,
    isLocalScreenAudioMuted,
    isMicEnabled,
    isDeafened,
    isNoiseSuppressionEnabled,
    canPlaybackAudio,
    unlockAudio,
    setStreamVolume,
    setScreenShareWatching,
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
    toggleNoiseSuppression,
    sendMessage,
    sendImage,
    editMessage,
    deleteMessage,
    sendReaction,
    disconnect,
  } = useLiveKit({
    url: session.livekitUrl,
    token: session.token,
    onDisconnected: onLeave,
    restore,
  });

  const { saveClip, clipStatus, clipEnabled, toggleClip, clipNotice, clipPreview, discardClip } = useClip(room, session);

  // No app desktop a transmissão é nativa (GPU + SRT, como o OBS); no navegador segue o WebRTC do LiveKit.
  const native = useNativeStream();
  const [isHotkeyModalOpen, setIsHotkeyModalOpen] = useState(false);
  const { hotkeys, errors: hotkeyErrors, setHotkey } = useHotkeys(
    {
      mic: () => {
        void toggleMic();
      },
      deafen: () => {
        toggleDeafen();
      },
    },
    { paused: isHotkeyModalOpen },
  );

  const handleConfirmScreenShare = (config: StreamQualityConfig) => {
    startScreenShare(config);
  };

  const isBroadcasting = isScreenSharing || native.isStreaming;

  const handleToggleScreenShare = () => {
    if (native.isStreaming) {
      void native.stop();
    } else if (isScreenSharing) {
      stopScreenShare();
    } else {
      setIsScreenShareModalOpen(true);
    }
  };

  // A new deploy reloads the room after a short notice, but never cuts a live broadcast: the browser
  // only re-shares a screen on a user click, so that tab waits until the broadcast ends.
  const [updateCountdown, setUpdateCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (!updateAvailable || isBroadcasting) {
      setUpdateCountdown(null);
      return;
    }
    setUpdateCountdown(UPDATE_COUNTDOWN_S);
    const timer = setInterval(() => setUpdateCountdown((s) => (s === null ? s : Math.max(0, s - 1))), 1000);
    return () => clearInterval(timer);
  }, [updateAvailable, isBroadcasting]);

  const applyUpdate = () => {
    disconnect();
    onReloadForUpdate({ micEnabled: isMicEnabled, deafened: isDeafened, messages });
  };

  useEffect(() => {
    if (updateCountdown === 0) applyUpdate();
  }, [updateCountdown]);

  const handleExitRoom = () => {
    disconnect();
    onLeave();
  };

  return (
    <div className="h-screen h-[100dvh] w-screen flex flex-col bg-[#090a0f] text-gray-100 overflow-hidden select-none">
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 flex flex-col p-1 sm:p-3 md:p-4 min-w-0 relative">
          <VideoPlayer
            stats={stats}
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
            onScreenShareWatchingChange={setScreenShareWatching}
            roomName={session.roomName}
            token={session.token}
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

          {updateAvailable && (
            <div className="absolute top-12 sm:top-20 inset-x-0 mx-auto w-fit max-w-[calc(100%-1rem)] z-30 flex items-center gap-2 sm:gap-3 px-3 py-2 rounded-2xl bg-[#11131c]/95 border border-indigo-500/40 text-[11px] sm:text-xs text-gray-200 shadow-2xl backdrop-blur-md">
              <RefreshCw className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>
                {updateCountdown !== null
                  ? `Nova versão disponível. Atualizando em ${updateCountdown}s…`
                  : 'Nova versão disponível. Atualiza quando você parar de transmitir.'}
              </span>
              <button
                onClick={applyUpdate}
                className="shrink-0 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer"
              >
                Atualizar agora
              </button>
            </div>
          )}

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
            onSendImage={sendImage}
            onEditMessage={editMessage}
            onDeleteMessage={deleteMessage}
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
        isScreenSharing={isBroadcasting}
        isChatOpen={isChatOpen}
        isHUDOpen={isHUDOpen}
        roomName={session.roomName}
        userName={session.userName}
        streamKey={session.streamKey}
        onToggleMic={toggleMic}
        onOpenHotkeySettings={isDesktop ? () => setIsHotkeyModalOpen(true) : undefined}
        onToggleDeafen={toggleDeafen}
        onToggleNoiseSuppression={toggleNoiseSuppression}
        onToggleScreenShare={handleToggleScreenShare}
        onOpenScreenShareConfig={() => setIsScreenShareModalOpen(true)}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
        onToggleHUD={() => setIsHUDOpen(!isHUDOpen)}
        onClip={saveClip}
        clipStatus={clipStatus}
        clipEnabled={clipEnabled}
        onToggleClip={toggleClip}
        clipNotice={clipNotice}
        onLeave={handleExitRoom}
      />

      {clipPreview && <ClipPreviewModal clip={clipPreview} onDiscard={discardClip} />}

      {isDesktop ? (
        <>
          <NativeStreamModal
            isOpen={isScreenShareModalOpen}
            roomName={session.roomName}
            userName={session.userName}
            streamKey={session.streamKey}
            onClose={() => setIsScreenShareModalOpen(false)}
            onStart={(config) => void native.start(config)}
          />
          <HotkeyModal
            isOpen={isHotkeyModalOpen}
            hotkeys={hotkeys}
            errors={hotkeyErrors}
            onSave={setHotkey}
            onClose={() => setIsHotkeyModalOpen(false)}
          />
          <NativeStreamStatus state={native.state} stats={native.stats} message={native.message} />
        </>
      ) : (
        <ScreenShareModal
          isOpen={isScreenShareModalOpen}
          onClose={() => setIsScreenShareModalOpen(false)}
          onConfirm={handleConfirmScreenShare}
        />
      )}
    </div>
  );
}

export default App;
