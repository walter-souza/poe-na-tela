import { useState, useEffect, useRef } from 'react';
import type { VoiceParticipant } from '../types';
import { supabase, isSupabaseConfigured } from '../utils/supabase';

interface UseVoicePresenceOptions {
  roomSlug: string;
  userName: string;
  activeVoiceChannelId: string | null;
  isVoiceConnected: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  avatarUrl?: string | null;
}

export function useVoicePresence({
  roomSlug,
  userName,
  activeVoiceChannelId,
  isVoiceConnected,
  isSpeaking,
  isMuted,
  avatarUrl,
}: UseVoicePresenceOptions) {
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const channelRef = useRef<any>(null);
  const isSubscribedRef = useRef<boolean>(false);

  // Keep latest presence state in ref so callbacks and subscriptions have fresh data
  const currentPresencePayload = useRef({
    identity: userName,
    name: userName,
    voiceChannelId: isVoiceConnected ? activeVoiceChannelId : null,
    isSpeaking,
    isMuted,
    avatarUrl,
    updatedAt: Date.now(),
  });

  currentPresencePayload.current = {
    identity: userName,
    name: userName,
    voiceChannelId: isVoiceConnected ? activeVoiceChannelId : null,
    isSpeaking,
    isMuted,
    avatarUrl,
    updatedAt: Date.now(),
  };

  useEffect(() => {
    if (!roomSlug || !userName) return;

    if (!isSupabaseConfigured || !supabase) {
      // Graceful fallback for offline / mock mode
      setVoiceParticipants([
        {
          identity: userName,
          name: userName,
          voiceChannelId: isVoiceConnected ? activeVoiceChannelId : null,
          isSpeaking,
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
              isSpeaking: Boolean(latest.isSpeaking),
              isMuted: Boolean(latest.isMuted),
              avatarUrl: latest.avatarUrl,
            });
          }
        }
      });

      setVoiceParticipants(list);
    };

    channel.on('presence', { event: 'sync' }, handleSync);

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        isSubscribedRef.current = true;
        try {
          await channel.track(currentPresencePayload.current);
        } catch (err) {
          console.warn('Failed to track initial voice presence:', err);
        }
      }
    });

    return () => {
      isSubscribedRef.current = false;
      channel.untrack().catch(() => {});
      supabase?.removeChannel(channel).catch(() => {});
      channelRef.current = null;
    };
  }, [roomSlug, userName]);

  // Broadcast presence updates when active channel, connection, or mute state changes
  useEffect(() => {
    if (!isSubscribedRef.current || !channelRef.current) return;

    const trackTimeout = setTimeout(() => {
      channelRef.current?.track(currentPresencePayload.current).catch(() => {});
    }, 50);

    return () => clearTimeout(trackTimeout);
  }, [activeVoiceChannelId, isVoiceConnected, isMuted, isSpeaking, avatarUrl]);

  return { voiceParticipants };
}
