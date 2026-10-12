import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatMessage } from '../types';
import { supabase, isSupabaseConfigured } from '../utils/supabase';
import { importRoomKey, encryptText, decryptText } from '../utils/cryptoService';
import { getApiBaseUrl, getChannelMessagesUrl } from '../utils/api';

interface UsePersistentChatOptions {
  roomSlug: string;
  channelId?: string;
  authorName: string;
  passcode?: string;
  fallbackMessages?: ChatMessage[];
  onFallbackSend?: (text: string) => void;
}

export function usePersistentChat({
  roomSlug,
  channelId,
  authorName,
  passcode,
  fallbackMessages = [],
  onFallbackSend,
}: UsePersistentChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);

  // 1. Obter e importar a Room Key da sala via KMS do backend
  useEffect(() => {
    let isMounted = true;

    async function loadRoomKey() {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/rooms/${roomSlug}/key`, {
          headers: passcode ? { 'x-room-passcode': passcode } : undefined,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.roomKey) {
            const key = await importRoomKey(data.roomKey);
            if (isMounted) {
              setCryptoKey(key);
              cryptoKeyRef.current = key;
            }
          }
        }
      } catch (err) {
        console.warn('Não foi possível carregar a chave de criptografia da sala:', err);
      }
    }

    loadRoomKey();

    return () => {
      isMounted = false;
    };
  }, [roomSlug, passcode]);

  // 2. Carregar mensagens persistentes e assinar Supabase Realtime
  useEffect(() => {
    if (!channelId || !isSupabaseConfigured || !supabase || !cryptoKey) {
      if (!isSupabaseConfigured) {
        setMessages(fallbackMessages);
        setIsLoading(false);
      }
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    // Carregar histórico inicial do canal
    async function fetchHistoricalMessages() {
      try {
        const res = await fetch(getChannelMessagesUrl(channelId!));
        if (!res.ok) {
          console.warn('Erro ao buscar mensagens do servidor:', res.statusText);
          if (isMounted) setMessages(fallbackMessages);
          return;
        }

        const json = await res.json();
        const data = json.messages;

        if (data && isMounted) {
          const decrypted = await Promise.all(
            data.map(async (m: any) => ({
              id: m.id,
              sender: m.author_name,
              text: await decryptText(m.ciphertext, m.iv, cryptoKey!),
              timestamp: new Date(m.created_at).getTime(),
            }))
          );
          if (isMounted) {
            setMessages(decrypted);
          }
        }
      } catch (err) {
        console.warn('Erro ao decifrar histórico de mensagens:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchHistoricalMessages();

    // Assinar novas mensagens via Supabase Realtime
    const subscription = supabase
      .channel(`realtime:messages:${channelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${channelId}`,
        },
        async (payload) => {
          const newRow = payload.new as any;
          if (!newRow) return;

          const plainText = await decryptText(newRow.ciphertext, newRow.iv, cryptoKey!);
          setMessages((prev) => {
            if (prev.some((m) => m.id === newRow.id)) return prev;
            return [
              ...prev,
              {
                id: newRow.id,
                sender: newRow.author_name,
                text: plainText,
                timestamp: new Date(newRow.created_at).getTime(),
              },
            ];
          });
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase?.removeChannel(subscription);
    };
  }, [channelId, cryptoKey, fallbackMessages]);

  // 3. Enviar mensagem com criptografia ponta a ponta
  const sendMessage = useCallback(
    async (text: string) => {
      const cleanText = text.trim();
      if (!cleanText) return;

      const currentKey = cryptoKeyRef.current || cryptoKey;

      if (isSupabaseConfigured && channelId && currentKey) {
        try {
          // Cifra o texto com AES-GCM 256 bits
          const { ciphertext, iv } = await encryptText(cleanText, currentKey);

          // Obter token de autenticação se disponível
          let token: string | undefined;
          if (supabase) {
            try {
              const sessionRes = await supabase.auth.getSession();
              token = sessionRes.data.session?.access_token;
            } catch {}
          }

          const res = await fetch(getChannelMessagesUrl(channelId), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              authorName,
              ciphertext,
              iv,
            }),
          });

          if (!res.ok) {
            console.warn('Erro ao salvar mensagem no servidor:', res.statusText);
            if (onFallbackSend) onFallbackSend(cleanText);
          }
          return;
        } catch (err) {
          console.warn('Erro ao cifrar e enviar mensagem:', err);
          if (onFallbackSend) onFallbackSend(cleanText);
          return;
        }
      }

      // Fallback: envio efêmero via Data Channel se Supabase não estiver conectado
      if (onFallbackSend) {
        onFallbackSend(cleanText);
      }
    },
    [channelId, cryptoKey, authorName, onFallbackSend]
  );

  return {
    messages,
    sendMessage,
    isLoading,
    isEncrypted: Boolean(cryptoKey),
  };
}
