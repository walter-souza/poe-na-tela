import { useState, useEffect, useRef, useCallback } from 'react';
import type { VoiceParticipant } from '../types';
import { supabase, isSupabaseConfigured } from '../utils/supabase';

interface UseVoicePresenceOptions {
  roomSlug: string;
  userName: string;
  activeVoiceChannelId: string | null;
  isVoiceConnected: boolean;
  isMuted: boolean;
  avatarUrl?: string | null;
}

export function useVoicePresence({
  roomSlug,
  userName,
  activeVoiceChannelId,
  isVoiceConnected,
  isMuted,
  avatarUrl,
}: UseVoicePresenceOptions) {
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const channelRef = useRef<any>(null);
  const isSubscribedRef = useRef<boolean>(false);
  const isTrackingRef = useRef<boolean>(false);
  const pendingPayloadRef = useRef<any>(null);

  const targetVoiceChannelId = isVoiceConnected && activeVoiceChannelId ? activeVoiceChannelId : null;

  const currentPresencePayload = useRef({
    identity: userName,
    name: userName,
    voiceChannelId: targetVoiceChannelId,
    isMuted,
    avatarUrl,
    updatedAt: Date.now(),
  });

  currentPresencePayload.current = {
    identity: userName,
    name: userName,
    voiceChannelId: targetVoiceChannelId,
    isMuted,
    avatarUrl,
    updatedAt: Date.now(),
  };

  // Fila sequencial (FIFO com coalescência) para garantir que NUNCA haja múltiplos channel.track() concorrentes no WebSocket do Supabase
  const queuePresenceTrack = useCallback(async (channel: any) => {
    if (!channel || !isSubscribedRef.current) return;
    pendingPayloadRef.current = currentPresencePayload.current;

    if (isTrackingRef.current) {
      return; // Já há um track em andamento; o loop processará o pendingPayload assim que concluir
    }

    isTrackingRef.current = true;
    while (pendingPayloadRef.current && isSubscribedRef.current) {
      const toTrack = pendingPayloadRef.current;
      pendingPayloadRef.current = null;
      try {
        await channel.track(toTrack);
      } catch (err) {
        console.warn('Falha ao sincronizar presença de voz no Supabase:', err);
      }
    }
    isTrackingRef.current = false;
  }, []);

  useEffect(() => {
    if (!roomSlug || !userName) return;

    if (!isSupabaseConfigured || !supabase) {
      // Fallback gracioso para modo offline / sem Supabase
      setVoiceParticipants([
        {
          identity: userName,
          name: userName,
          voiceChannelId: targetVoiceChannelId,
          isSpeaking: false,
          isMuted,
          avatarUrl,
        },
      ]);
      return;
    }

    const channelName = `room-voice-presence:${roomSlug}`;
    const channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: userName,
        },
      },
    });

    channelRef.current = channel;

    const handleSync = () => {
      const state = channel.presenceState();
      const list: VoiceParticipant[] = [];

      Object.values(state).forEach((presences: any) => {
        if (Array.isArray(presences) && presences.length > 0) {
          const latest = presences[presences.length - 1];
          if (latest && latest.identity) {
            list.push({
              identity: latest.identity,
              name: latest.name || latest.identity,
              voiceChannelId: latest.voiceChannelId || null,
              isSpeaking: false,
              isMuted: Boolean(latest.isMuted),
              avatarUrl: latest.avatarUrl,
            });
          }
        }
      });

      setVoiceParticipants(list);
    };

    channel.on('presence', { event: 'sync' }, handleSync);
    channel.on('presence', { event: 'join' }, handleSync);
    channel.on('presence', { event: 'leave' }, handleSync);

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        isSubscribedRef.current = true;
        // Disparar track inicial seguro no canal da sala recém-inscrita
        queuePresenceTrack(channel);
      }
    });

    return () => {
      isSubscribedRef.current = false;
      isTrackingRef.current = false;
      pendingPayloadRef.current = null;
      setVoiceParticipants([]); // Limpar imediatamente participantes ao sair da sala
      channel.untrack().catch(() => {});
      supabase?.removeChannel(channel).catch(() => {});
      channelRef.current = null;
    };
  }, [roomSlug, userName, queuePresenceTrack]);

  // Transmitir atualização de presença sempre que o canal de voz ativo, estado de conexão ou mute mudarem
  useEffect(() => {
    // 1. Refletir imediatamente o estado local do próprio usuário para feedback instantâneo na UI
    setVoiceParticipants((prev) => {
      const other = prev.filter((p) => p.identity !== userName);
      if (targetVoiceChannelId) {
        return [
          ...other,
          {
            identity: userName,
            name: userName,
            voiceChannelId: targetVoiceChannelId,
            isSpeaking: false,
            isMuted,
            avatarUrl,
          },
        ];
      }
      return other;
    });

    // 2. Transmitir com segurança sequencial para toda a guilda via Supabase Presence
    if (isSubscribedRef.current && channelRef.current) {
      queuePresenceTrack(channelRef.current);
    }
  }, [targetVoiceChannelId, isMuted, avatarUrl, userName, queuePresenceTrack]);

  return { voiceParticipants };
}
