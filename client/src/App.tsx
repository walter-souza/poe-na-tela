import { useState, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { ConnectionState } from 'livekit-client';
import { MessageSquare, Tv } from 'lucide-react';
import { useLiveKit } from './hooks/useLiveKit';
import { useVoicePresence } from './hooks/useVoicePresence';
import { VideoPlayer } from './components/VideoPlayer';
import { ControlsBar } from './components/ControlsBar';
import { ChatPanel } from './components/ChatPanel';
import { StreamHUD } from './components/StreamHUD';
import { ScreenShareModal } from './components/ScreenShareModal';
import { MaintenanceScreen } from './components/MaintenanceScreen';
import { Lobby } from './components/Lobby';
import { ServerInviteModal } from './components/ServerInviteModal';
import { ChannelSidebar } from './components/ChannelSidebar';
import { CreateChannelModal } from './components/CreateChannelModal';
import { usePersistentChat } from './hooks/usePersistentChat';
import { useAuth } from './context/AuthContext';
import { getHealthUrl, getTokenUrl, getApiBaseUrl } from './utils/api';
import { GuildBar } from './components/GuildBar';
import { TextChannelView } from './components/TextChannelView';
import { CreateRoomModal } from './components/CreateRoomModal';
import { PasswordModal } from './components/PasswordModal';
import { playJoinSound, playLeaveSound } from './utils/soundEffects';
import type { StreamQualityConfig, Channel, UserRoom, VoiceParticipant } from './types';

interface AppSession {
  token: string;
  livekitUrl: string;
  roomName: string;
  userName: string;
  isPublisher: boolean;
  passcode?: string;
  voiceChannelId?: string;
  initialVoiceConnected?: boolean;
}

export function App() {
  const { profile, isAuthenticated, session: authSession } = useAuth();
  const [session, setSession] = useState<AppSession | null>(null);

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

  // LiveKit default URL
  const [livekitUrl, setLivekitUrl] = useState<string>('wss://livekit.194.61.238.98.sslip.io');

  // Discord Guilds (Salas do Usuário Autenticado)
  const [userRooms, setUserRooms] = useState<UserRoom[]>([]);
  const [activeRoomSlug, setActiveRoomSlug] = useState<string | null>(null);
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false);
  const [passwordPromptRoom, setPasswordPromptRoom] = useState<UserRoom | null>(null);
  const [passwordModalError, setPasswordModalError] = useState<string | null>(null);
  const [roomPasscodes, setRoomPasscodes] = useState<Record<string, string>>({});

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
        if (data.livekitUrl) setLivekitUrl(data.livekitUrl);
        if (data.maintenance) {
          setIsMaintenance(true);
          if (data.message) setMaintenanceMessage(data.message);
        } else {
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

  // Buscar salas das quais o usuário é dono ou membro
  const fetchUserRooms = async () => {
    if (!authSession?.access_token) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/user/rooms`, {
        headers: {
          Authorization: `Bearer ${authSession.access_token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.rooms)) {
          setUserRooms(data.rooms);
        }
      }
    } catch (err) {
      console.warn('Erro ao carregar salas do usuário:', err);
    }
  };

  useEffect(() => {
    if (isAuthenticated && authSession?.access_token) {
      fetchUserRooms();
    }
  }, [isAuthenticated, authSession?.access_token]);

  // Detect server parameter in URL for Discord-style invite modal
  const [inviteServerName, setInviteServerName] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get('server') ||
      params.get('s') ||
      params.get('invite') ||
      params.get('room') ||
      params.get('r') ||
      null
    );
  });

  // Connect to room via token (Lobby Join)
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
        passcode,
        voiceChannelId: data.voiceChannelId,
        initialVoiceConnected: true,
      });

      setActiveRoomSlug(data.roomName);
      if (passcode) {
        setRoomPasscodes((prev) => ({ ...prev, [data.roomName]: passcode }));
      }

      window.history.replaceState({}, '', window.location.pathname);
      setInviteServerName(null);
      fetchUserRooms();
    } catch (err: any) {
      const msg = err.message || 'Erro ao conectar ao servidor de streaming';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectRoom = (slug: string) => {
    const room = userRooms.find((r) => r.slug === slug);
    if (room && room.hasPasscode && !room.isOwner && !roomPasscodes[slug]) {
      setPasswordPromptRoom(room);
      setPasswordModalError(null);
      return;
    }
    setActiveRoomSlug(slug);
    setInviteServerName(null);
  };

  const handleSelectHome = () => {
    setActiveRoomSlug(null);
    setSession(null);
    setInviteServerName(null);
    window.history.replaceState({}, '', window.location.pathname);
  };

  const handleConfirmRoomPassword = async (passcode: string) => {
    if (!passwordPromptRoom) return;
    const slug = passwordPromptRoom.slug;
    try {
      const token = authSession?.access_token;
      const res = await fetch(`${getApiBaseUrl()}/api/rooms/${slug}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ passcode }),
      });

      if (res.ok) {
        setRoomPasscodes((prev) => ({ ...prev, [slug]: passcode }));
        setPasswordPromptRoom(null);
        setActiveRoomSlug(slug);
        fetchUserRooms();
      } else {
        const data = await res.json().catch(() => ({}));
        setPasswordModalError(data.error || 'Senha incorreta.');
      }
    } catch (err) {
      setPasswordModalError('Erro ao verificar senha da sala.');
    }
  };

  const handleAcceptServerInvite = async (
    targetRoomSlug: string,
    guestUserName: string,
    passcode?: string
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      if (authSession?.access_token) {
        try {
          const joinRes = await fetch(`${getApiBaseUrl()}/api/rooms/${targetRoomSlug}/join`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authSession.access_token}`,
            },
            body: JSON.stringify({ passcode }),
          });
          if (!joinRes.ok) {
            const errData = await joinRes.json().catch(() => ({}));
            if (errData.error) {
              throw new Error(errData.error);
            }
          }
        } catch (err: any) {
          console.warn('Erro ao registrar membro na sala:', err);
          throw err;
        }
      }

      if (passcode) {
        setRoomPasscodes((prev) => ({ ...prev, [targetRoomSlug]: passcode }));
      }

      if (guestUserName) {
        localStorage.setItem('poe-na-tela-username', guestUserName);
      }

      window.history.replaceState({}, '', window.location.pathname);
      setInviteServerName(null);

      if (authSession?.access_token) {
        await fetchUserRooms();
      }

      setActiveRoomSlug(targetRoomSlug);
    } catch (err: any) {
      const msg = err.message || 'Falha ao aceitar convite do servidor';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const handleLeave = () => {
    window.history.replaceState({}, '', window.location.pathname);
    setActiveRoomSlug(null);
    setSession(null);
    setInviteServerName(null);
  };

  const handleCancelServerInvite = () => {
    window.history.replaceState({}, '', window.location.pathname);
    setInviteServerName(null);
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

  // Nome do usuário para a sessão ativa
  const effectiveUserName =
    profile?.username || localStorage.getItem('poe-na-tela-username') || 'Usuário';

  // Sessão atual: se já foi gerada com token ou modo de navegação sem voz
  const currentSession: AppSession | null = useMemo(() => {
    if (session && session.roomName === activeRoomSlug) {
      return session;
    }
    if (activeRoomSlug) {
      return {
        token: '',
        livekitUrl,
        roomName: activeRoomSlug,
        userName: effectiveUserName,
        isPublisher: false,
        passcode: roomPasscodes[activeRoomSlug],
        initialVoiceConnected: false,
      };
    }
    return null;
  }, [session, activeRoomSlug, livekitUrl, effectiveUserName, roomPasscodes]);

  return (
    <div className="h-screen h-[100dvh] w-screen flex bg-[#07080d] text-gray-100 overflow-hidden select-none">
      {/* 1. Discord Guild Bar (Servidores / Salas) */}
      <GuildBar
        userRooms={userRooms}
        activeRoomSlug={activeRoomSlug}
        onSelectRoom={handleSelectRoom}
        onSelectHome={handleSelectHome}
        onOpenCreateRoom={() => setIsCreateRoomOpen(true)}
      />

      {/* 2. Área Principal: Sala ou Lobby */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        {currentSession ? (
          <StreamRoom
            key={currentSession.roomName}
            session={currentSession}
            onLeave={handleLeave}
            isChatOpen={isChatOpen}
            setIsChatOpen={setIsChatOpen}
            isHUDOpen={isHUDOpen}
            setIsHUDOpen={setIsHUDOpen}
            isScreenShareModalOpen={isScreenShareModalOpen}
            setIsScreenShareModalOpen={setIsScreenShareModalOpen}
            adminBypassToken={adminBypassToken}
          />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <Lobby onJoin={handleJoin} isLoading={isLoading} error={error} />
          </div>
        )}
      </div>

      {/* Modais Globais */}
      {inviteServerName && (
        <ServerInviteModal
          isOpen={Boolean(inviteServerName)}
          roomName={inviteServerName}
          onAccept={handleAcceptServerInvite}
          onCancel={handleCancelServerInvite}
        />
      )}

      <CreateRoomModal
        isOpen={isCreateRoomOpen}
        onClose={() => setIsCreateRoomOpen(false)}
        onRoomCreated={(slug, passcode) => {
          setIsCreateRoomOpen(false);
          fetchUserRooms();
          if (passcode) {
            setRoomPasscodes((prev) => ({ ...prev, [slug]: passcode }));
          }
          setActiveRoomSlug(slug);
        }}
      />

      {passwordPromptRoom && (
        <PasswordModal
          isOpen={Boolean(passwordPromptRoom)}
          roomName={passwordPromptRoom.name}
          onClose={() => setPasswordPromptRoom(null)}
          onConfirm={handleConfirmRoomPassword}
          error={passwordModalError}
        />
      )}
    </div>
  );
}

interface StreamRoomProps {
  session: AppSession;
  onLeave: () => void;
  isChatOpen: boolean;
  setIsChatOpen: Dispatch<SetStateAction<boolean>>;
  isHUDOpen: boolean;
  setIsHUDOpen: Dispatch<SetStateAction<boolean>>;
  isScreenShareModalOpen: boolean;
  setIsScreenShareModalOpen: Dispatch<SetStateAction<boolean>>;
  adminBypassToken?: string | null;
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
  adminBypassToken,
}: StreamRoomProps) {
  const { profile, session: authSession } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeTextChannelId, setActiveTextChannelId] = useState<string>('');
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<string>(
    session.initialVoiceConnected ? session.voiceChannelId || '' : ''
  );
  const [connectingVoiceChannelId, setConnectingVoiceChannelId] = useState<string | null>(null);
  const [isVoiceConnected, setIsVoiceConnected] = useState<boolean>(
    Boolean(session.initialVoiceConnected && session.token)
  );
  const [voiceToken, setVoiceToken] = useState<string>(session.token || '');
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState<boolean>(false);

  // Modo de visualização central: 'chat' para canais de texto, 'stage' para palco de transmissão
  const [activeView, setActiveView] = useState<'chat' | 'stage'>(() => {
    return session.initialVoiceConnected ? 'stage' : 'chat';
  });

  const {
    connectionState,
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
    token: isVoiceConnected ? voiceToken : '',
    onDisconnected: () => {
      setIsVoiceConnected(false);
      setActiveVoiceChannelId('');
      setConnectingVoiceChannelId(null);
    },
  });

  // Canal de voz 100% confirmado e ativo no LiveKit
  const isVoiceFullyConnected =
    isVoiceConnected &&
    connectionState === ConnectionState.Connected &&
    Boolean(activeVoiceChannelId);

  const isLocalConnecting = Boolean(isVoiceConnected && !isVoiceFullyConnected);

  // Limpa o indicador de conectando ao confirmar conexão no LiveKit
  useEffect(() => {
    if (connectionState === ConnectionState.Connected) {
      setConnectingVoiceChannelId(null);
    }
  }, [connectionState]);

  // Status de fala do participante local
  const localParticipant = participants.find((p) => p.identity === session.userName);
  const recentlyLeftMapRef = useRef<Map<string, number>>(new Map());

  // Presença em tempo real cross-channel via Supabase Realtime
  const { voiceParticipants } = useVoicePresence({
    roomSlug: session.roomName,
    userName: session.userName,
    activeVoiceChannelId: isVoiceConnected ? activeVoiceChannelId : null,
    isVoiceConnected,
    isMuted: !isMicEnabled,
    avatarUrl: profile?.avatar_url,
    isConnecting: isLocalConnecting,
    isDeafened,
    onParticipantLeave: (identity) => {
      recentlyLeftMapRef.current.set(identity, Date.now());
    },
  });

  // Mesclar VAD local de 0ms para participantes no mesmo canal de voz e garantir a presença do usuário conectado
  const mergedVoiceParticipants = useMemo(() => {
    const map = new Map<string, VoiceParticipant>();

    // 1. Participantes conhecidos via Supabase Realtime em qualquer canal da sala/servidor
    for (const vp of voiceParticipants) {
      if (vp.identity) {
        map.set(vp.identity, vp);
      }
    }

    // 2. Se o usuário local estiver com canal ativo selecionado, garantir presença no canal
    if (isVoiceConnected && activeVoiceChannelId) {
      const existing = map.get(session.userName);
      map.set(session.userName, {
        identity: session.userName,
        name: session.userName,
        voiceChannelId: activeVoiceChannelId,
        isSpeaking: localParticipant?.isSpeaking ?? false,
        isMuted: !isMicEnabled,
        avatarUrl: profile?.avatar_url || existing?.avatarUrl,
        isConnecting: isLocalConnecting,
      });
    }

    // 3. Mesclar dados de áudio em tempo real (0ms) do LiveKit apenas para quem está no mesmo canal físico
    if (isVoiceFullyConnected && activeVoiceChannelId) {
      for (const p of participants) {
        if (!p.identity || p.identity === session.userName) continue;

        // Se o participante acabou de desconectar explicitamente, ignorar por 3.5s para evitar fantasma durante teardown do LiveKit
        const leftAt = recentlyLeftMapRef.current.get(p.identity);
        if (leftAt && Date.now() - leftAt < 3500) {
          continue;
        }

        const existing = map.get(p.identity);
        if (existing) {
          // Se o participante já é conhecido e está no mesmo canal de voz que nós: atualizar áudio 0ms do LiveKit
          if (existing.voiceChannelId === activeVoiceChannelId) {
            map.set(p.identity, {
              ...existing,
              isSpeaking: p.isSpeaking,
              isMuted: p.isMuted,
            });
          }
        } else {
          // Se ainda não sincronizou no Supabase, adicioná-lo no canal local ativo
          map.set(p.identity, {
            identity: p.identity,
            name: p.name || p.identity,
            voiceChannelId: activeVoiceChannelId,
            isSpeaking: p.isSpeaking,
            isMuted: p.isMuted,
          });
        }
      }
    }

    return Array.from(map.values());
  }, [
    voiceParticipants,
    participants,
    isVoiceFullyConnected,
    isVoiceConnected,
    isLocalConnecting,
    activeVoiceChannelId,
    session.userName,
    localParticipant?.isSpeaking,
    isMicEnabled,
    profile?.avatar_url,
  ]);

  // Chat persistente e criptografado via Supabase Realtime & KMS
  const {
    messages: persistentMessages,
    sendMessage: sendPersistentMessage,
    isEncrypted,
  } = usePersistentChat({
    roomSlug: session.roomName,
    channelId: activeTextChannelId,
    authorName: session.userName,
    passcode: session.passcode,
    fallbackMessages: messages,
    onFallbackSend: sendMessage,
  });

  // Carregar canais da sala persistente
  useEffect(() => {
    let isCancelled = false;
    const fetchChannels = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/rooms/${session.roomName}/channels`);
        if (res.ok) {
          const data = await res.json();
          if (isCancelled) return;
          if (Array.isArray(data.channels) && data.channels.length > 0) {
            setChannels(data.channels);
            const textChan = data.channels.find((c: Channel) => c.type === 'text');
            const voiceChan = data.channels.find((c: Channel) => c.type === 'voice');
            if (textChan) setActiveTextChannelId((prev) => prev || textChan.id);
            if (voiceChan) setActiveVoiceChannelId((prev) => prev || voiceChan.id);
            if (profile?.id && data.ownerId === profile.id) {
              setIsOwner(true);
            }
          }
        }
      } catch (err) {
        console.warn('Erro ao carregar canais da sala:', err);
      }
    };
    fetchChannels();
    return () => {
      isCancelled = true;
    };
  }, [session.roomName, profile]);

  const handleSelectTextChannel = (channel: Channel) => {
    setActiveTextChannelId(channel.id);
    setActiveView('chat');
  };

  const selectVoiceAbortRef = useRef<AbortController | null>(null);

  const handleSelectVoiceChannel = async (channel: Channel) => {
    if (activeVoiceChannelId === channel.id && (isVoiceFullyConnected || connectingVoiceChannelId === channel.id)) {
      return;
    }

    // Feedback sonoro instantâneo de entrada / troca de sala (0ms)
    playJoinSound();

    // Cancelar requisição anterior de troca de canal ainda em voo
    if (selectVoiceAbortRef.current) {
      selectVoiceAbortRef.current.abort();
    }
    const abortCtrl = new AbortController();
    selectVoiceAbortRef.current = abortCtrl;

    setConnectingVoiceChannelId(channel.id);
    setActiveVoiceChannelId(channel.id);
    setIsVoiceConnected(true);
    setActiveView('stage');

    try {
      const res = await fetch(getTokenUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          roomName: session.roomName,
          voiceChannelId: channel.id,
          participantName: session.userName,
          isPublisher: session.isPublisher,
          passcode: session.passcode,
          bypassToken: adminBypassToken,
        }),
      });

      if (abortCtrl.signal.aborted) return;

      if (res.ok) {
        const data = await res.json();
        if (abortCtrl.signal.aborted) return;
        const confirmedChanId = data.voiceChannelId || channel.id;
        setActiveVoiceChannelId(confirmedChanId);
        setVoiceToken(data.token);
        setIsVoiceConnected(true);
      } else {
        const err = await res.json().catch(() => ({}));
        console.error('Falha ao obter token para canal de voz:', err);
        setConnectingVoiceChannelId(null);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Erro ao conectar ao canal de voz:', err);
      setConnectingVoiceChannelId(null);
    }
  };

  const handleDisconnectVoice = () => {
    // Feedback sonoro instantâneo de saída de sala (0ms)
    playLeaveSound();
    recentlyLeftMapRef.current.set(session.userName, Date.now());

    if (selectVoiceAbortRef.current) {
      selectVoiceAbortRef.current.abort();
      selectVoiceAbortRef.current = null;
    }
    disconnect();
    setIsVoiceConnected(false);
    setActiveVoiceChannelId('');
    setConnectingVoiceChannelId(null);
    setVoiceToken('');
    if (activeView === 'stage') {
      setActiveView('chat');
    }
  };

  const handleToggleMic = () => {
    if (!isVoiceFullyConnected) {
      const targetChan =
        channels.find((c) => c.id === activeVoiceChannelId && c.type === 'voice') ||
        channels.find((c) => c.type === 'voice');
      if (targetChan) {
        handleSelectVoiceChannel(targetChan);
      }
    }
    toggleMic();
  };

  const handleChannelCreated = (newChan: Channel) => {
    setChannels((prev) => [...prev, newChan]);
    if (newChan.type === 'text') {
      setActiveTextChannelId(newChan.id);
      setActiveView('chat');
    }
  };

  const handleDeleteChannel = async (channelId: string) => {
    try {
      const token = authSession?.access_token;
      const res = await fetch(
        `${getApiBaseUrl()}/api/rooms/${session.roomName}/channels/${channelId}`,
        {
          method: 'DELETE',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
      );
      if (res.ok) {
        setChannels((prev) => {
          const updated = prev.filter((c) => c.id !== channelId);
          if (activeTextChannelId === channelId) {
            const nextText = updated.find((c) => c.type === 'text');
            if (nextText) setActiveTextChannelId(nextText.id);
          }
          if (activeVoiceChannelId === channelId) {
            const nextVoice = updated.find((c) => c.type === 'voice');
            if (nextVoice) {
              handleSelectVoiceChannel(nextVoice);
            } else {
              handleDisconnectVoice();
            }
          }
          return updated;
        });
      }
    } catch (err) {
      console.warn('Erro ao deletar canal:', err);
    }
  };

  const handleConfirmScreenShare = (config: StreamQualityConfig) => {
    startScreenShare(config);
  };

  const handleToggleScreenShare = () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      if (!isVoiceConnected) {
        const targetChan =
          channels.find((c) => c.id === activeVoiceChannelId && c.type === 'voice') ||
          channels.find((c) => c.type === 'voice');
        if (targetChan) {
          handleSelectVoiceChannel(targetChan);
        }
      }
      setIsScreenShareModalOpen(true);
    }
  };

  const handleExitRoom = () => {
    disconnect();
    onLeave();
  };

  return (
    <div className="h-screen h-[100dvh] w-full flex flex-col bg-[#090a0f] text-gray-100 overflow-hidden select-none">
      <div className="flex-1 flex overflow-hidden relative">
        {/* Channel Sidebar (Discord-like) */}
        <ChannelSidebar
          roomName={session.roomName}
          channels={channels}
          activeTextChannelId={activeTextChannelId}
          activeVoiceChannelId={activeVoiceChannelId}
          isVoiceConnected={isVoiceFullyConnected}
          connectingVoiceChannelId={connectingVoiceChannelId}
          isOwner={isOwner}
          voiceParticipants={mergedVoiceParticipants}
          onSelectTextChannel={handleSelectTextChannel}
          onSelectVoiceChannel={handleSelectVoiceChannel}
          onDisconnectVoice={handleDisconnectVoice}
          onOpenCreateChannel={() => setIsCreateChannelOpen(true)}
          onDeleteChannel={handleDeleteChannel}
          onLeaveRoom={handleExitRoom}
        />

        {/* Central View: Text Chat OU Video Stage */}
        {activeView === 'chat' ? (
          <TextChannelView
            channelName={channels.find((c) => c.id === activeTextChannelId)?.name || 'geral'}
            roomName={session.roomName}
            messages={persistentMessages}
            onSendMessage={sendPersistentMessage}
            onSendReaction={sendReaction}
            userName={session.userName}
            isEncrypted={isEncrypted}
            isVoiceConnected={isVoiceFullyConnected}
            activeVoiceChannelName={
              isVoiceFullyConnected
                ? channels.find((c) => c.id === activeVoiceChannelId)?.name
                : undefined
            }
            onSwitchToStage={() => setActiveView('stage')}
          />
        ) : (
          <div className="flex-1 flex flex-col p-1 sm:p-3 md:p-4 min-w-0 relative">
            <StreamHUD
              stats={stats}
              isOpen={isHUDOpen}
              onClose={() => setIsHUDOpen(false)}
              playoutBufferMs={playoutBufferMs}
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
                <span className="text-gray-500">|</span>
                <span className="text-emerald-400 font-semibold truncate">
                  {channels.find((c) => c.id === activeVoiceChannelId)?.name || 'Voz'}
                </span>
              </div>
            </div>

            {!isChatOpen && (
              <button
                onClick={() => setIsChatOpen(true)}
                title="Exibir Chat Lateral"
                className="absolute top-2 right-2 sm:top-6 sm:right-6 z-30 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2.5 rounded-2xl bg-[#11131c]/90 hover:bg-[#181a26] border border-white/15 text-white text-xs font-semibold shadow-2xl backdrop-blur-md transition-all hover:scale-105 active:scale-95 group cursor-pointer"
              >
                <MessageSquare className="w-4 h-4 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
                <span className="hidden sm:inline">Exibir Chat</span>
                {persistentMessages.length > 0 && (
                  <span className="bg-indigo-600 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                    {persistentMessages.length}
                  </span>
                )}
              </button>
            )}
          </div>
        )}

        {/* Side Chat Drawer (only when in stage mode and user opened chat) */}
        {activeView === 'stage' && isChatOpen && (
          <ChatPanel
            messages={persistentMessages}
            participants={participants}
            onSendMessage={sendPersistentMessage}
            onSendReaction={sendReaction}
            userName={session.userName}
            roomName={session.roomName}
            channelName={channels.find((c) => c.id === activeTextChannelId)?.name || 'geral'}
            isEncrypted={isEncrypted}
            onClose={() => setIsChatOpen(false)}
            userVolumes={userVolumes}
            onUserVolumeChange={setUserVolume}
          />
        )}
      </div>

      {/* Controls Bar (visível quando em modo palco ou quando voz está conectada) */}
      {(activeView === 'stage' || isVoiceConnected) && (
        <ControlsBar
          isMicEnabled={isMicEnabled}
          isDeafened={isDeafened}
          isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
          isScreenSharing={isScreenSharing}
          isChatOpen={isChatOpen}
          isHUDOpen={isHUDOpen}
          roomName={session.roomName}
          userName={session.userName}
          onToggleMic={handleToggleMic}
          onToggleDeafen={toggleDeafen}
          onToggleNoiseSuppression={toggleNoiseSuppression}
          onToggleScreenShare={handleToggleScreenShare}
          onOpenScreenShareConfig={() => setIsScreenShareModalOpen(true)}
          onToggleChat={() => {
            if (activeView === 'chat') {
              setActiveView('stage');
              setIsChatOpen(true);
            } else {
              setIsChatOpen(!isChatOpen);
            }
          }}
          onToggleHUD={() => setIsHUDOpen(!isHUDOpen)}
          onLeave={handleExitRoom}
        />
      )}

      <ScreenShareModal
        isOpen={isScreenShareModalOpen}
        onClose={() => setIsScreenShareModalOpen(false)}
        onConfirm={handleConfirmScreenShare}
      />

      <CreateChannelModal
        isOpen={isCreateChannelOpen}
        roomSlug={session.roomName}
        onClose={() => setIsCreateChannelOpen(false)}
        onChannelCreated={handleChannelCreated}
      />
    </div>
  );
}

export default App;
