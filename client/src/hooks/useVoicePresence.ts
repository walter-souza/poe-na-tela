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

interface InternalParticipant extends VoiceParticipant {
  localReceivedAt: number;
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
  const participantsMapRef = useRef<Map<string, InternalParticipant>>(new Map());

  const lastBroadcastVoiceChannelIdRef = useRef<string | null>(null);
  const lastBroadcastMutedRef = useRef<boolean>(isMuted);

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
          const res = await channel.track(toTrack);
          if (res !== 'ok') {
            console.warn('[VoicePresence] track status:', res);
          }
        } else {
          await channel.untrack();
        }
      } catch (err) {
        console.warn('[VoicePresence] Falha ao sincronizar presença no Supabase:', err);
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

    const cleanSlug = roomSlug.toLowerCase().trim();
    const channelName = `room-voice-presence:${cleanSlug}`;
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

      const now = Date.now();
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
          isSpeaking: Boolean(payload.isSpeaking),
          isMuted: Boolean(payload.isMuted),
          avatarUrl: payload.avatarUrl || current?.avatarUrl,
          isConnecting: Boolean(payload.isConnecting),
          updatedAt: payload.updatedAt || now,
          localReceivedAt: now,
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

    // Resposta imediata quando um novo par solicita a presença dos membros da sala
    const handlePresenceRequest = ({ payload }: { payload: any }) => {
      if (!payload || payload.from === userName) return;
      if (currentPresencePayload.current.voiceChannelId && channelRef.current && isSubscribedRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'voice_presence_update',
          payload: currentPresencePayload.current,
        }).catch(() => {});
      }
    };

    // 2. Manipulador de CRDT Presence (Sincronização autoritativa global entre navegadores)
    const handleSync = () => {
      const state = channel.presenceState();
      const activePresences = new Map<string, VoiceParticipant>();
      const now = Date.now();

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
            updatedAt: latest.updatedAt || now,
          });
        }
      }

      // Atualizar participantes a partir do CRDT autoritativo
      for (const [id, participant] of activePresences.entries()) {
        const existing = participantsMapRef.current.get(id);
        participantsMapRef.current.set(id, {
          ...participant,
          localReceivedAt: now,
          avatarUrl: participant.avatarUrl || existing?.avatarUrl,
        });
      }

      // Remover participantes que não estão mais no CRDT E não foram vistos localmente recentemente
      // Utiliza localReceivedAt para imunidade total contra clock skew entre navegadores
      for (const [id, participant] of participantsMapRef.current.entries()) {
        if (id !== userName && !activePresences.has(id)) {
          const isRecent = participant.localReceivedAt && (now - participant.localReceivedAt < 20000);
          if (!isRecent) {
            onParticipantLeaveRef.current?.(id);
            participantsMapRef.current.delete(id);
          }
        }
      }

      setVoiceParticipants(Array.from(participantsMapRef.current.values()));
    };

    channel.on('presence', { event: 'sync' }, handleSync);
    channel.on('broadcast', { event: 'voice_presence_update' }, handleBroadcastUpdate);
    channel.on('broadcast', { event: 'voice_presence_heartbeat' }, handleBroadcastUpdate);
    channel.on('broadcast', { event: 'voice_presence_leave' }, handleBroadcastLeave);
    channel.on('broadcast', { event: 'voice_presence_request' }, handlePresenceRequest);

    channel.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') {
        isSubscribedRef.current = true;
        // 1. Solicitar presença dos membros já ativos para descoberta instantânea bilateral (1 disparo)
        channel.send({
          type: 'broadcast',
          event: 'voice_presence_request',
          payload: { from: userName },
        }).catch(() => {});

        // 2. Disparar track inicial e broadcast se já conectado a um canal de voz
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

    // 3. Heartbeat periódico a cada 10 segundos para manter presença e recuperar eventuais pacotes perdidos
    const heartbeatInterval = setInterval(() => {
      if (!isSubscribedRef.current || !channelRef.current) return;
      if (currentPresencePayload.current.voiceChannelId) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'voice_presence_heartbeat',
          payload: currentPresencePayload.current,
        }).catch(() => {});
        queuePresenceTrack(channelRef.current);
      }
    }, 10000);

    return () => {
      isSubscribedRef.current = false;
      isTrackingRef.current = false;
      pendingPayloadRef.current = null;
      clearInterval(heartbeatInterval);
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

  // Transmitir atualização de presença sempre que o canal de voz ativo ou status de mute realmente mudarem
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

    // 1. Refletir imediatamente o estado local do próprio usuário para feedback instantâneo na UI (0ms)
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
        localReceivedAt: now,
      });
    } else {
      participantsMapRef.current.delete(userName);
    }
    setVoiceParticipants(Array.from(participantsMapRef.current.values()));

    // Verificar se houve mudança real de canal de voz ou mute para evitar broadcasts duplicados nas transições de render
    const channelChanged = targetVoiceChannelId !== lastBroadcastVoiceChannelIdRef.current;
    const muteChanged = isMuted !== lastBroadcastMutedRef.current;

    if (channelChanged || muteChanged) {
      lastBroadcastVoiceChannelIdRef.current = targetVoiceChannelId;
      lastBroadcastMutedRef.current = isMuted;

      // 2. Disparar BROADCAST direto (1 disparo confiável garantido)
      if (isSubscribedRef.current && channelRef.current) {
        const eventName = targetVoiceChannelId ? 'voice_presence_update' : 'voice_presence_leave';
        channelRef.current.send({
          type: 'broadcast',
          event: eventName,
          payload,
        }).catch(() => {});
      }

      // 3. Debounce (100ms) no channel.track() para consolidar o estado no Phoenix CRDT
      if (debounceTrackTimeoutRef.current) {
        clearTimeout(debounceTrackTimeoutRef.current);
      }
      debounceTrackTimeoutRef.current = setTimeout(() => {
        if (isSubscribedRef.current && channelRef.current) {
          queuePresenceTrack(channelRef.current);
        }
      }, 100);
    }

    return () => {
      if (debounceTrackTimeoutRef.current) {
        clearTimeout(debounceTrackTimeoutRef.current);
      }
    };
  }, [targetVoiceChannelId, isMuted, avatarUrl, userName, isConnecting, queuePresenceTrack]);

  return { voiceParticipants };
}
