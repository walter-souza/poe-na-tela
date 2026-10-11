import { useState, useEffect, useRef, useCallback } from 'react';
import type { VoiceParticipant } from '../types';
import { supabase, isSupabaseConfigured } from '../utils/supabase';
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
  const isTrackingRef = useRef<boolean>(false);
  const pendingPayloadRef = useRef<any>(null);
  const debounceTrackTimeoutRef = useRef<any>(null);
  const participantsMapRef = useRef<Map<string, VoiceParticipant>>(new Map());

  const onParticipantLeaveRef = useRef(onParticipantLeave);
  onParticipantLeaveRef.current = onParticipantLeave;

  const targetVoiceChannelId = isVoiceConnected && activeVoiceChannelId ? activeVoiceChannelId : null;
  const targetVoiceChannelIdRef = useRef<string | null>(targetVoiceChannelId);
  targetVoiceChannelIdRef.current = targetVoiceChannelId;

  const isDeafenedRef = useRef<boolean>(isDeafened);
  isDeafenedRef.current = isDeafened;

  const currentPresencePayload = useRef({
    identity: userName,
    name: userName,
    voiceChannelId: targetVoiceChannelId,
    isMuted,
    avatarUrl,
    isConnecting,
    updatedAt: Date.now(),
  });

  currentPresencePayload.current = {
    identity: userName,
    name: userName,
    voiceChannelId: targetVoiceChannelId,
    isMuted,
    avatarUrl,
    isConnecting,
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
        if (toTrack.voiceChannelId) {
          await channel.track(toTrack);
        } else {
          await channel.untrack();
        }
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
          isConnecting,
          updatedAt: Date.now(),
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
        broadcast: {
          self: false,
        },
      },
    });

    channelRef.current = channel;

    // 1. Manipulador de Broadcast Instantâneo (0ms de latência direta entre navegadores)
    const handleBroadcastUpdate = ({ payload }: { payload: any }) => {
      if (!payload || !payload.identity) return;
      if (payload.identity === userName) return; // O próprio usuário já é gerenciado localmente

      const current = participantsMapRef.current.get(payload.identity);

      // Notificação sonora instantânea se outro usuário entra ou sai do nosso canal ativo
      const myChannel = targetVoiceChannelIdRef.current;
      if (myChannel && !isDeafenedRef.current) {
        const wasInMyChannel = current && current.voiceChannelId === myChannel;
        const isInMyChannel = payload.voiceChannelId === myChannel;
        if (!wasInMyChannel && isInMyChannel) {
          playJoinSound();
        } else if (wasInMyChannel && !isInMyChannel) {
          playLeaveSound();
        }
      }

      if (payload.voiceChannelId) {
        participantsMapRef.current.set(payload.identity, {
          identity: payload.identity,
          name: payload.name || payload.identity,
          voiceChannelId: payload.voiceChannelId,
          isSpeaking: false,
          isMuted: Boolean(payload.isMuted),
          avatarUrl: payload.avatarUrl,
          isConnecting: Boolean(payload.isConnecting),
          updatedAt: payload.updatedAt || Date.now(),
        });
      } else {
        onParticipantLeaveRef.current?.(payload.identity);
        participantsMapRef.current.delete(payload.identity);
      }

      setVoiceParticipants(Array.from(participantsMapRef.current.values()));
    };

    const handleBroadcastLeave = ({ payload }: { payload: any }) => {
      if (!payload || !payload.identity) return;
      if (payload.identity === userName) return;
      const current = participantsMapRef.current.get(payload.identity);
      const myChannel = targetVoiceChannelIdRef.current;
      if (myChannel && !isDeafenedRef.current && current && current.voiceChannelId === myChannel) {
        playLeaveSound();
      }
      onParticipantLeaveRef.current?.(payload.identity);
      participantsMapRef.current.delete(payload.identity);
      setVoiceParticipants(Array.from(participantsMapRef.current.values()));
    };

    // 2. Manipulador de CRDT Presence (Sincronização autoritativa global entre navegadores)
    const handleSync = () => {
      const state = channel.presenceState();
      const activePresences = new Map<string, VoiceParticipant>();

      for (const [key, presences] of Object.entries(state)) {
        if (!Array.isArray(presences) || presences.length === 0) continue;
        const latest: any = presences[presences.length - 1];
        if (!latest) continue;

        const id = latest.identity || key;
        if (id === userName) continue; // O próprio usuário já é gerenciado localmente

        if (latest.voiceChannelId) {
          activePresences.set(id, {
            identity: id,
            name: latest.name || id,
            voiceChannelId: latest.voiceChannelId,
            isSpeaking: false,
            isMuted: Boolean(latest.isMuted),
            avatarUrl: latest.avatarUrl,
            isConnecting: Boolean(latest.isConnecting),
            updatedAt: latest.updatedAt || Date.now(),
          });
        }
      }

      // Atualizar participantes a partir do CRDT autoritativo
      for (const [id, participant] of activePresences.entries()) {
        participantsMapRef.current.set(id, participant);
      }

      // Remover participantes que não estão mais no CRDT E não tiveram broadcast recente (< 10s)
      for (const [id, participant] of participantsMapRef.current.entries()) {
        if (id !== userName && !activePresences.has(id)) {
          const isRecent = participant.updatedAt && Date.now() - participant.updatedAt < 10000;
          if (!isRecent) {
            participantsMapRef.current.delete(id);
          }
        }
      }

      setVoiceParticipants(Array.from(participantsMapRef.current.values()));
    };

    channel.on('presence', { event: 'sync' }, handleSync);
    channel.on('broadcast', { event: 'voice_presence_update' }, handleBroadcastUpdate);
    channel.on('broadcast', { event: 'voice_presence_leave' }, handleBroadcastLeave);

    channel.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') {
        isSubscribedRef.current = true;
        // Disparar track inicial e broadcast de boas-vindas
        if (currentPresencePayload.current.voiceChannelId) {
          channel.send({
            type: 'broadcast',
            event: 'voice_presence_update',
            payload: currentPresencePayload.current,
          }).catch(() => {});
          queuePresenceTrack(channel);
        }
      }
    });

    return () => {
      isSubscribedRef.current = false;
      isTrackingRef.current = false;
      pendingPayloadRef.current = null;
      if (debounceTrackTimeoutRef.current) {
        clearTimeout(debounceTrackTimeoutRef.current);
      }
      participantsMapRef.current.clear();
      setVoiceParticipants([]); // Limpar imediatamente participantes ao sair da sala
      channel.untrack().catch(() => {});
      supabase?.removeChannel(channel).catch(() => {});
      channelRef.current = null;
    };
  }, [roomSlug, userName, queuePresenceTrack]);

  // Transmitir atualização de presença sempre que o canal de voz ativo, estado de conexão ou mute mudarem
  useEffect(() => {
    const now = Date.now();
    const payload = {
      identity: userName,
      name: userName,
      voiceChannelId: targetVoiceChannelId,
      isMuted,
      avatarUrl,
      isConnecting,
      updatedAt: now,
    };
    currentPresencePayload.current = payload;

    // 1. Refletir imediatamente o estado local do próprio usuário para feedback instantâneo na UI
    if (targetVoiceChannelId) {
      participantsMapRef.current.set(userName, {
        identity: userName,
        name: userName,
        voiceChannelId: targetVoiceChannelId,
        isSpeaking: false,
        isMuted,
        avatarUrl,
        isConnecting,
        updatedAt: now,
      });
    } else {
      participantsMapRef.current.delete(userName);
    }
    setVoiceParticipants(Array.from(participantsMapRef.current.values()));

    // 2. Disparar BROADCAST INSTANTÂNEO direto via WebSocket (0ms de latência para todos os pares)
    if (isSubscribedRef.current && channelRef.current) {
      const eventName = targetVoiceChannelId ? 'voice_presence_update' : 'voice_presence_leave';
      channelRef.current.send({
        type: 'broadcast',
        event: eventName,
        payload,
      }).catch(() => {});
    }

    // 3. Debounce (150ms) no channel.track() para consolidar o estado no Phoenix CRDT sem sobrecarga
    if (debounceTrackTimeoutRef.current) {
      clearTimeout(debounceTrackTimeoutRef.current);
    }
    debounceTrackTimeoutRef.current = setTimeout(() => {
      if (isSubscribedRef.current && channelRef.current) {
        queuePresenceTrack(channelRef.current);
      }
    }, 150);

    return () => {
      if (debounceTrackTimeoutRef.current) {
        clearTimeout(debounceTrackTimeoutRef.current);
      }
    };
  }, [targetVoiceChannelId, isMuted, avatarUrl, userName, isConnecting, queuePresenceTrack]);

  return { voiceParticipants };
}
