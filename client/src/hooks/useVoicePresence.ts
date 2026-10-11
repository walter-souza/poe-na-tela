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
  const debounceTrackTimeoutRef = useRef<any>(null);
  const participantsMapRef = useRef<Map<string, VoiceParticipant>>(new Map());

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
      if (current && payload.updatedAt && current.updatedAt && current.updatedAt > payload.updatedAt) {
        return; // Pacote desatualizado que chegou fora de ordem
      }

      if (payload.voiceChannelId) {
        participantsMapRef.current.set(payload.identity, {
          identity: payload.identity,
          name: payload.name || payload.identity,
          voiceChannelId: payload.voiceChannelId,
          isSpeaking: false,
          isMuted: Boolean(payload.isMuted),
          avatarUrl: payload.avatarUrl,
          updatedAt: payload.updatedAt || Date.now(),
        });
      } else {
        participantsMapRef.current.delete(payload.identity);
      }

      setVoiceParticipants(Array.from(participantsMapRef.current.values()));
    };

    const handleBroadcastLeave = ({ payload }: { payload: any }) => {
      if (!payload || !payload.identity) return;
      if (payload.identity === userName) return;
      participantsMapRef.current.delete(payload.identity);
      setVoiceParticipants(Array.from(participantsMapRef.current.values()));
    };

    // 2. Manipulador de CRDT Presence (Sincronização global para novos ingressantes na sala)
    const handleSync = () => {
      const state = channel.presenceState();
      const remotePresenceIdentities = new Set<string>();

      Object.values(state).forEach((presences: any) => {
        if (Array.isArray(presences) && presences.length > 0) {
          const latest = presences[presences.length - 1];
          if (latest && latest.identity) {
            remotePresenceIdentities.add(latest.identity);
            if (latest.identity === userName) return; // O próprio usuário já está no mapa local

            const existing = participantsMapRef.current.get(latest.identity);
            // Só sobrescrever se o dado do CRDT tiver timestamp mais recente ou igual
            if (!existing || !existing.updatedAt || !latest.updatedAt || latest.updatedAt >= existing.updatedAt) {
              if (latest.voiceChannelId) {
                participantsMapRef.current.set(latest.identity, {
                  identity: latest.identity,
                  name: latest.name || latest.identity,
                  voiceChannelId: latest.voiceChannelId,
                  isSpeaking: false,
                  isMuted: Boolean(latest.isMuted),
                  avatarUrl: latest.avatarUrl,
                  updatedAt: latest.updatedAt || Date.now(),
                });
              } else {
                participantsMapRef.current.delete(latest.identity);
              }
            }
          }
        }
      });

      // Limpeza de participantes que saíram totalmente da sala segundo o CRDT (com grace period)
      for (const [id, participant] of participantsMapRef.current.entries()) {
        if (id !== userName && !remotePresenceIdentities.has(id)) {
          // Se o participante não teve atualização via broadcast recente (< 5s), remover
          const isRecent = participant.updatedAt && Date.now() - participant.updatedAt < 5000;
          if (!isRecent) {
            participantsMapRef.current.delete(id);
          }
        }
      }

      setVoiceParticipants(Array.from(participantsMapRef.current.values()));
    };

    channel.on('presence', { event: 'sync' }, handleSync);
    channel.on('presence', { event: 'join' }, handleSync);
    channel.on('presence', { event: 'leave' }, handleSync);
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
  }, [targetVoiceChannelId, isMuted, avatarUrl, userName, queuePresenceTrack]);

  return { voiceParticipants };
}
