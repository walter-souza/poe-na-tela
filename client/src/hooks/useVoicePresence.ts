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
  const lastTrackedPayloadRef = useRef<string>('');

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

  // Helper to track presence safely without redundant calls
  const sendPresenceTrack = useCallback(async (channel: any) => {
    if (!channel || !isSubscribedRef.current) return;
    const payload = currentPresencePayload.current;
    const serialized = JSON.stringify({
      voiceChannelId: payload.voiceChannelId,
      isMuted: payload.isMuted,
      avatarUrl: payload.avatarUrl,
      name: payload.name,
    });

    if (serialized === lastTrackedPayloadRef.current) {
      return; // Sem alteração de estado
    }

    try {
      await channel.track(payload);
      lastTrackedPayloadRef.current = serialized;
    } catch (err) {
      console.warn('Falha ao sincronizar presença de voz:', err);
    }
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
        await sendPresenceTrack(channel);
      }
    });

    return () => {
      isSubscribedRef.current = false;
      lastTrackedPayloadRef.current = '';
      channel.untrack().catch(() => {});
      supabase?.removeChannel(channel).catch(() => {});
      channelRef.current = null;
    };
  }, [roomSlug, userName, sendPresenceTrack]);

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

    // 2. Transmitir imediatamente para toda a guilda via Supabase Presence (sem timeouts que podem ser cancelados)
    if (isSubscribedRef.current && channelRef.current) {
      sendPresenceTrack(channelRef.current);
    }
  }, [targetVoiceChannelId, isMuted, avatarUrl, userName, sendPresenceTrack]);

  return { voiceParticipants };
}
