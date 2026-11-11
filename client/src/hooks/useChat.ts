import { useCallback, useRef, useState, type RefObject } from 'react';
import type { ByteStreamHandler, RemoteParticipant, Room } from 'livekit-client';
import type { ChatMessage, ReactionEvent } from '../types';
import { CHAT_IMAGE_TOPIC, MAX_CAPTION_LENGTH, MAX_RECEIVED_BYTES, isAcceptedMime, prepareChatImage } from '../utils/chatImage';

// Message ids are chosen by the sender so edits and deletes can refer to them; peers only
// accept short, plain ids and fall back to a local one otherwise.
const MESSAGE_ID_PATTERN = /^[\w.-]{1,64}$/;
const newMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const acceptMessageId = (id: unknown) => (typeof id === 'string' && MESSAGE_ID_PATTERN.test(id) ? id : newMessageId());

const encode = (data: unknown) => new TextEncoder().encode(JSON.stringify(data));

/**
 * Room chat over LiveKit data messages (text, edits, deletes, reactions) and byte streams (images).
 * `isHost` tags our messages while we are sharing the screen.
 */
export function useChat(roomRef: RefObject<Room | null>, initialMessages: ChatMessage[], isHost: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  // blob: URLs of chat images, released when the room is left.
  const chatImageUrlsRef = useRef<string[]>([]);
  const [reaction, setReaction] = useState<ReactionEvent | null>(null);

  const addSystemMessage = useCallback((id: string, text: string) => {
    setMessages((prev) => [...prev, { id, sender: 'Sistema', text, timestamp: Date.now(), isSystem: true }]);
  }, []);

  /** Handles a decoded data message of a chat type (chat, chat-edit, chat-delete, reaction). */
  const handleData = useCallback((data: any, participant?: RemoteParticipant) => {
    if (data.type === 'chat') {
      const id = acceptMessageId(data.id);
      setMessages((prev) => [
        ...prev,
        ...(prev.some((m) => m.id === id)
          ? []
          : [
              {
                id,
                sender: participant?.name || participant?.identity || data.sender || 'Amigo',
                senderIdentity: participant?.identity,
                text: data.text,
                timestamp: Date.now(),
                isHost: data.isHost,
              },
            ]),
      ]);
    } else if (data.type === 'chat-edit' || data.type === 'chat-delete') {
      // Only the author may change a message: the sender identity comes from LiveKit,
      // so a peer cannot touch someone else's message by guessing its id.
      if (!participant || typeof data.id !== 'string') return;
      const target = messagesRef.current.find(
        (m) => m.id === data.id && m.senderIdentity === participant.identity
      );
      if (!target) return;
      if (data.type === 'chat-delete') {
        if (target.imageUrl) URL.revokeObjectURL(target.imageUrl);
        setMessages((prev) => prev.filter((m) => m !== target));
      } else {
        const text = typeof data.text === 'string' ? data.text.trim() : '';
        if (!text && !target.imageUrl) return;
        const next = target.imageUrl ? text.slice(0, MAX_CAPTION_LENGTH) : text;
        setMessages((prev) => prev.map((m) => (m === target ? { ...m, text: next, edited: true } : m)));
      }
    } else if (data.type === 'reaction') {
      setReaction({
        emoji: data.emoji,
        sender: participant?.name || participant?.identity || 'Amigo',
        timestamp: Date.now(),
      });
    }
  }, []);

  /** Byte stream handler for CHAT_IMAGE_TOPIC; `isActive` is false once the room effect is torn down. */
  const createImageHandler = useCallback((room: Room, isActive: () => boolean): ByteStreamHandler => {
    return async (reader, { identity }) => {
      const { size, attributes } = reader.info;
      const mimeType = attributes?.mime ?? '';
      // Never trust the sender: check type and size before touching the bytes.
      if (!isAcceptedMime(mimeType) || (size ?? 0) > MAX_RECEIVED_BYTES) return;
      try {
        const chunks = await reader.readAll();
        if (!isActive()) return;
        const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: mimeType }));
        chatImageUrlsRef.current.push(url);
        const sender = room.remoteParticipants.get(identity);
        const id = acceptMessageId(attributes?.id);
        setMessages((prev) => [
          ...prev,
          ...(prev.some((m) => m.id === id)
            ? []
            : [
                {
                  id,
                  sender: sender?.name || identity,
                  senderIdentity: identity,
                  text: (attributes?.caption ?? '').slice(0, MAX_CAPTION_LENGTH),
                  imageUrl: url,
                  timestamp: Date.now(),
                  isHost: attributes?.isHost === '1',
                },
              ]),
        ]);
      } catch (err) {
        console.error('Failed to receive chat image', err);
      }
    };
  }, []);

  const releaseImages = useCallback(() => {
    chatImageUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    chatImageUrlsRef.current = [];
  }, []);

  const sendMessage = async (text: string) => {
    const room = roomRef.current;
    if (!room || !text.trim()) return;

    const msg: ChatMessage = {
      id: newMessageId(),
      sender: room.localParticipant.name || room.localParticipant.identity,
      senderIdentity: room.localParticipant.identity,
      isOwn: true,
      text: text.trim(),
      timestamp: Date.now(),
      isHost,
    };

    await room.localParticipant.publishData(
      encode({ type: 'chat', id: msg.id, text: msg.text, sender: msg.sender, isHost }),
      { reliable: true }
    );
    setMessages((prev) => [...prev, msg]);
  };

  // Sends an image (with optional caption) as one chat message over a LiveKit byte stream.
  // Throws a user-facing Error on invalid files.
  const sendImage = async (file: File, caption = '') => {
    const room = roomRef.current;
    if (!room) return;

    const prepared = await prepareChatImage(file);
    const text = caption.trim().slice(0, MAX_CAPTION_LENGTH);
    const id = newMessageId();
    await room.localParticipant.sendBytes(new Uint8Array(await prepared.arrayBuffer()), {
      topic: CHAT_IMAGE_TOPIC,
      attributes: { id, mime: prepared.type, caption: text, isHost: isHost ? '1' : '0' },
    });

    const url = URL.createObjectURL(prepared);
    chatImageUrlsRef.current.push(url);
    setMessages((prev) => [
      ...prev,
      {
        id,
        sender: room.localParticipant.name || room.localParticipant.identity,
        senderIdentity: room.localParticipant.identity,
        isOwn: true,
        text,
        imageUrl: url,
        timestamp: Date.now(),
        isHost,
      },
    ]);
  };

  // Edits one of our own messages; peers re-check authorship on their side.
  const editMessage = async (id: string, text: string) => {
    const room = roomRef.current;
    const target = messagesRef.current.find((m) => m.id === id && m.isOwn);
    if (!room || !target) return;
    const trimmed = text.trim();
    const next = target.imageUrl ? trimmed.slice(0, MAX_CAPTION_LENGTH) : trimmed;
    if (next === target.text || (!next && !target.imageUrl)) return;

    await room.localParticipant.publishData(encode({ type: 'chat-edit', id, text: next }), { reliable: true });
    setMessages((prev) => prev.map((m) => (m === target ? { ...m, text: next, edited: true } : m)));
  };

  const deleteMessage = async (id: string) => {
    const room = roomRef.current;
    const target = messagesRef.current.find((m) => m.id === id && m.isOwn);
    if (!room || !target) return;

    await room.localParticipant.publishData(encode({ type: 'chat-delete', id }), { reliable: true });
    if (target.imageUrl) URL.revokeObjectURL(target.imageUrl);
    setMessages((prev) => prev.filter((m) => m !== target));
  };

  const sendReaction = async (emoji: string) => {
    const room = roomRef.current;
    if (!room) return;

    await room.localParticipant.publishData(encode({ type: 'reaction', emoji }), { reliable: false });
    setReaction({
      emoji,
      sender: room.localParticipant.name || room.localParticipant.identity,
      timestamp: Date.now(),
    });
  };

  return {
    messages,
    reaction,
    addSystemMessage,
    handleData,
    createImageHandler,
    releaseImages,
    sendMessage,
    sendImage,
    editMessage,
    deleteMessage,
    sendReaction,
  };
}
