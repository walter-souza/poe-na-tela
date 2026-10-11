import { useState, useEffect, useRef, useCallback } from 'react';
import type { VoiceParticipant } from '../types';
import { supabase, isSupabaseConfigured } from '../utils/supabase';
import { fetchVoicePresence } from '../utils/api';
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

  // Rastreamento dos participantes no nosso canal para emitir sons de entrada/saída com precisão
  const prevMyChannelParticipantsRef = useRef<Set<string>>(new Set());

  // Consulta autoritativa no LiveKit via Backend
  const refreshPresence = useCallback(async () => {
    if (!roomSlug || isPollingRef.current) return;
    isPollingRef.current = true;
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
            isMuted,
            avatarUrl,
            isConnecting,
          });
        }
      }

      // Notificação sonora quando alguém entra ou sai do canal ativo do usuário local
      if (myChannel && !isDeaf) {
        // Alguém entrou no nosso canal
        for (const id of currentInMyChannel) {
          if (!prevMyChannelParticipantsRef.current.has(id)) {
            playJoinSound();
          }
        }
        // Alguém saiu do nosso canal
        for (const id of prevMyChannelParticipantsRef.current) {
          if (!currentInMyChannel.has(id)) {
            playLeaveSound();
            onParticipantLeaveRef.current?.(id);
          }
        }
      }
      prevMyChannelParticipantsRef.current = currentInMyChannel;

      setVoiceParticipants(mapped);
    } catch (err) {
      console.warn('[VoicePresence] Erro ao consultar presença no LiveKit:', err);
    } finally {
      isPollingRef.current = false;
    }
  }, [roomSlug, userName, isMuted, avatarUrl, isConnecting]);

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

      // Quando qualquer par muda de canal ou desconecta, dispara recarga imediata do LiveKit
      channel.on('broadcast', { event: 'voice_presence_changed' }, () => {
        refreshPresence();
      });

      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          isSubscribedRef.current = true;
        }
      });
    }

    // 2. Polling de segurança (2.5 segundos) para garantia contra qualquer queda ou oscilação de rede
    const pollInterval = setInterval(() => {
      refreshPresence();
    }, 2500);

    return () => {
      clearInterval(pollInterval);
      isSubscribedRef.current = false;
      if (channelRef.current && supabase) {
        supabase.removeChannel(channelRef.current).catch(() => {});
        channelRef.current = null;
      }
    };
  }, [roomSlug, userName, refreshPresence]);

  // 3. Atualização otimista e notificação aos pares quando o canal local mudar
  const lastTargetChannelRef = useRef<string | null>(targetVoiceChannelId);
  useEffect(() => {
    const channelChanged = targetVoiceChannelId !== lastTargetChannelRef.current;
    lastTargetChannelRef.current = targetVoiceChannelId;

    if (channelChanged) {
      // Notificar pares via broadcast leve para que eles atualizem o LiveKit imediatamente (~50ms)
      if (channelRef.current && isSubscribedRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'voice_presence_changed',
          payload: { roomSlug, userName, voiceChannelId: targetVoiceChannelId },
        }).catch(() => {});
      }

      // Reconsultar LiveKit logo após conectar
      const t1 = setTimeout(() => refreshPresence(), 200);
      const t2 = setTimeout(() => refreshPresence(), 1000);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [targetVoiceChannelId, roomSlug, userName, refreshPresence]);

  return { voiceParticipants, refreshPresence };
}
