import { useState, useEffect, useRef, useCallback } from 'react';
import type { VoiceParticipant } from '../types';
import { supabase, isSupabaseConfigured } from '../utils/supabase';
import { fetchVoicePresence, postVoiceDisconnect } from '../utils/api';
import { playJoinSound, playLeaveSound } from '../utils/soundEffects';

interface UseVoicePresenceOptions {
  roomSlug: string;
  userName: string;
  activeVoiceChannelId: string | null;
  isVoiceConnected: boolean;
  isMuted: boolean;
  avatarUrl?: string | null;
  isConnecting?: boolean;
  isDeafened?: boolean;
  onParticipantLeave?: (identity: string) => void;
}

/**
 * Hook de presença em canais de voz com autoridade absoluta do servidor LiveKit (Abordagem 2).
 * Consulta a lista oficial de WebRTC do LiveKit via API backend e sincroniza instantaneamente
 * entre navegadores via Supabase Broadcast leve + polling periódico de segurança (2.5s).
 */
export function useVoicePresence({
  roomSlug,
  userName,
  activeVoiceChannelId,
  isVoiceConnected,
  isMuted,
  avatarUrl,
  isConnecting = false,
  isDeafened = false,
  onParticipantLeave,
}: UseVoicePresenceOptions) {
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const channelRef = useRef<any>(null);
  const isSubscribedRef = useRef<boolean>(false);
  const isPollingRef = useRef<boolean>(false);

  const onParticipantLeaveRef = useRef(onParticipantLeave);
  onParticipantLeaveRef.current = onParticipantLeave;

  const targetVoiceChannelId = isVoiceConnected && activeVoiceChannelId ? activeVoiceChannelId : null;
  const targetVoiceChannelIdRef = useRef<string | null>(targetVoiceChannelId);
  targetVoiceChannelIdRef.current = targetVoiceChannelId;

  const isDeafenedRef = useRef<boolean>(isDeafened);
  isDeafenedRef.current = isDeafened;

  const isMutedRef = useRef<boolean>(isMuted);
  isMutedRef.current = isMuted;

  const avatarUrlRef = useRef<string | null | undefined>(avatarUrl);
  avatarUrlRef.current = avatarUrl;

  const isConnectingRef = useRef<boolean>(isConnecting);
  isConnectingRef.current = isConnecting;

  // Rastreamento de canal e participantes para evitar falsos positivos de áudio
  const currentChannelRef = useRef<string | null>(targetVoiceChannelId);
  const isInitialLoadForChannelRef = useRef<boolean>(true);
  const prevMyChannelParticipantsRef = useRef<Set<string>>(new Set());

  // Debounce e fila de consultas para evitar rajadas de requisições HTTP
  const debounceTimerRef = useRef<any>(null);
  const hasPendingRefreshRef = useRef<boolean>(false);

  // Consulta autoritativa no LiveKit via Backend (estável para não recriar subscriptions)
  const refreshPresence = useCallback(async () => {
    if (!roomSlug) return;
    if (isPollingRef.current) {
      hasPendingRefreshRef.current = true;
      return;
    }
    isPollingRef.current = true;
    hasPendingRefreshRef.current = false;
    try {
      const serverParticipants = await fetchVoicePresence(roomSlug);
      const myChannel = targetVoiceChannelIdRef.current;
      const isDeaf = isDeafenedRef.current;

      const currentInMyChannel = new Set<string>();

      const mapped: VoiceParticipant[] = serverParticipants.map((p: any) => {
        const isInMyChan = myChannel && p.voiceChannelId === myChannel && p.identity !== userName;
        if (isInMyChan) {
          currentInMyChannel.add(p.identity);
        }
        return {
          identity: p.identity,
          name: p.name || p.identity,
          voiceChannelId: p.voiceChannelId,
          isSpeaking: Boolean(p.isSpeaking),
          isMuted: Boolean(p.isMuted),
          avatarUrl: p.avatarUrl,
          isConnecting: false,
        };
      });

      // Se o usuário local estiver conectado, garantir sua presença otimista
      if (myChannel) {
        const hasLocal = mapped.some((p) => p.identity === userName);
        if (!hasLocal) {
          mapped.push({
            identity: userName,
            name: userName,
            voiceChannelId: myChannel,
            isSpeaking: false,
            isMuted: isMutedRef.current,
            avatarUrl: avatarUrlRef.current,
            isConnecting: isConnectingRef.current,
          });
        }
      }

      // Notificação sonora quando alguém entra ou sai do canal ativo do usuário local
      if (myChannel && !isDeaf) {
        if (!isInitialLoadForChannelRef.current) {
          // Alguém entrou no nosso canal enquanto já estávamos nele
          let someoneJoined = false;
          for (const id of currentInMyChannel) {
            if (!prevMyChannelParticipantsRef.current.has(id)) {
              someoneJoined = true;
              break;
            }
          }
          if (someoneJoined) {
            playJoinSound();
          }

          // Alguém saiu do nosso canal enquanto já estávamos nele
          let someoneLeft = false;
          for (const id of prevMyChannelParticipantsRef.current) {
            if (!currentInMyChannel.has(id)) {
              someoneLeft = true;
              onParticipantLeaveRef.current?.(id);
            }
          }
          if (someoneLeft) {
            playLeaveSound();
          }
        } else {
          // Primeira consulta após entrar ou mudar de canal: memoriza baseline sem disparar sons
          isInitialLoadForChannelRef.current = false;
        }
      } else {
        isInitialLoadForChannelRef.current = true;
      }
      prevMyChannelParticipantsRef.current = currentInMyChannel;

      setVoiceParticipants(mapped);
    } catch (err) {
      console.warn('[VoicePresence] Erro ao consultar presença no LiveKit:', err);
    } finally {
      isPollingRef.current = false;
      if (hasPendingRefreshRef.current) {
        hasPendingRefreshRef.current = false;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          refreshPresence();
        }, 150);
      }
    }
  }, [roomSlug, userName]);

  // Agendador com debounce para agrupar múltiplos eventos em uma única chamada HTTP
  const scheduleRefresh = useCallback(
    (delayMs = 250) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        refreshPresence();
      }, delayMs);
    },
    [refreshPresence]
  );

  // 1. Inscrição leve no Supabase Broadcast para push instantâneo entre navegadores
  useEffect(() => {
    if (!roomSlug || !userName) return;

    // Carga inicial autoritativa imediata
    refreshPresence();

    if (isSupabaseConfigured && supabase) {
      const cleanSlug = roomSlug.toLowerCase().trim();
      const channelName = `room-voice-presence:${cleanSlug}`;
      const channel = supabase.channel(channelName, {
        config: {
          broadcast: {
            self: false,
          },
        },
      });

      channelRef.current = channel;

      // Quando qualquer par muda de canal ou desconecta, reagendar recarga com debounce
      channel.on('broadcast', { event: 'voice_presence_changed' }, () => {
        scheduleRefresh(200);
      });

      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          isSubscribedRef.current = true;
        }
      });
    }

    // 2. Polling espaçado de segurança (a cada 20s) apenas se a aba estiver visível
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshPresence();
      }
    }, 20000);

    // Reconciliar ao voltar para a aba do navegador
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh(0);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Notificar desconexão rápida ao fechar aba
    const handleUnload = () => {
      if (targetVoiceChannelIdRef.current) {
        postVoiceDisconnect(roomSlug, userName);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);

    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      isSubscribedRef.current = false;
      if (channelRef.current && supabase) {
        supabase.removeChannel(channelRef.current).catch(() => {});
        channelRef.current = null;
      }
    };
  }, [roomSlug, userName, refreshPresence, scheduleRefresh]);

  // 3. Atualização e notificação aos pares quando o canal local mudar
  useEffect(() => {
    if (targetVoiceChannelId !== currentChannelRef.current) {
      currentChannelRef.current = targetVoiceChannelId;
      isInitialLoadForChannelRef.current = true;
      prevMyChannelParticipantsRef.current.clear();

      // Notificar pares via broadcast leve para que eles atualizem o LiveKit imediatamente (~50ms)
      if (channelRef.current && isSubscribedRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'voice_presence_changed',
          payload: { roomSlug, userName, voiceChannelId: targetVoiceChannelId },
        }).catch(() => {});
      }

      scheduleRefresh(250);
    }
  }, [targetVoiceChannelId, roomSlug, userName, scheduleRefresh]);

  return { voiceParticipants, refreshPresence };
}
