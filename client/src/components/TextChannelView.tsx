import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Hash, Lock, Send, Smile, Tv } from 'lucide-react';
import type { ChatMessage } from '../types';

interface TextChannelViewProps {
  channelName: string;
  roomName: string;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onSendReaction?: (emoji: string) => void;
  userName: string;
  isEncrypted?: boolean;
  isVoiceConnected?: boolean;
  activeVoiceChannelName?: string;
  onSwitchToStage?: () => void;
  /** Substitui o título do canal no cabeçalho (layout Palco usa o seletor de canais). */
  headerStart?: React.ReactNode;
}

const EMOJI_LIST = [
  '🔥', '👏', '😂', '❤️', '🎮',
  '🚀', '🎉', '🍿', '💯', '🤯',
  '😎', '👀', '👍', '🙌', '🥳',
  '😭', '✨', '⚡', '🏆', '💀'
];

const AVATAR_PALETTES = [
  { bg: 'from-blue-600/30 to-indigo-600/30 text-blue-300 border-blue-500/30' },
  { bg: 'from-emerald-600/30 to-teal-600/30 text-emerald-300 border-emerald-500/30' },
  { bg: 'from-violet-600/30 to-purple-600/30 text-violet-300 border-violet-500/30' },
  { bg: 'from-amber-600/30 to-orange-600/30 text-amber-300 border-amber-500/30' },
  { bg: 'from-rose-600/30 to-pink-600/30 text-rose-300 border-rose-500/30' },
  { bg: 'from-cyan-600/30 to-sky-600/30 text-cyan-300 border-cyan-500/30' },
  { bg: 'from-fuchsia-600/30 to-pink-600/30 text-fuchsia-300 border-fuchsia-500/30' },
];

function getAvatarStyle(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index];
}

function isSameDay(t1: number, t2: number): boolean {
  const d1 = new Date(t1);
  const d2 = new Date(t2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function formatDayDivider(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  const targetMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((todayMidnight - targetMidnight) / oneDayMs);

  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';

  const formatted = date.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });

  return formatted.replace(/(de )([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase());
}

export const TextChannelView: React.FC<TextChannelViewProps> = ({
  channelName,
  roomName,
  messages,
  onSendMessage,
  onSendReaction,
  userName,
  isEncrypted = false,
  isVoiceConnected = false,
  activeVoiceChannelName,
  onSwitchToStage,
  headerStart,
}) => {
  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // Ordenação cronológica estrita
  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => a.timestamp - b.timestamp);
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [sortedMessages]);

  // Click outside to close emoji picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-app min-w-0 select-text relative">
      {/* Channel Header (Discord-like minimalist) */}
      <div className="h-13 border-b border-white/[0.08] px-4 sm:px-6 flex items-center justify-between bg-app/80 backdrop-blur-md shrink-0 select-none z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          {headerStart ?? (
            <>
              <Hash className="w-5 h-5 text-zinc-400 shrink-0" />
              <span className="font-bold text-zinc-100 text-sm sm:text-base tracking-tight truncate">
                {channelName}
              </span>
            </>
          )}

          <div className="h-4 w-[1px] bg-white/10 mx-1 hidden sm:block" />

          {isEncrypted ? (
            <span
              title="As mensagens ficam criptografadas no banco de dados"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs text-gray-400"
            >
              <Lock className="w-3 h-3" /> Criptografado
            </span>
          ) : (
            <span className="hidden sm:inline text-xs text-zinc-400 truncate">
              Canal de texto de {roomName}
            </span>
          )}
        </div>

        {/* Banner para voltar ao palco se voz conectada */}
        {isVoiceConnected && onSwitchToStage && (
          <button
            onClick={onSwitchToStage}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-accent/15 hover:bg-accent/25 text-accent-text text-xs font-semibold transition cursor-pointer shrink-0"
          >
            <Tv className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Voltar à chamada</span>
            <span className="text-[10px] bg-accent/20 px-1.5 py-0.5 rounded">
              {activeVoiceChannelName || 'Voz'}
            </span>
          </button>
        )}
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20 scrollbar-track-transparent">
        {/* Modern Welcome Header */}
        <div className="pt-6 pb-4 mb-3 border-b border-white/[0.06]">
          <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-transparent border border-indigo-500/30 text-indigo-400 flex items-center justify-center mb-3 shadow-lg shadow-indigo-500/5">
            <Hash className="w-6.5 h-6.5" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Bem-vindo a #{channelName}!
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1 leading-relaxed max-w-lg">
            Este é o início da conversa no canal de texto <strong className="text-zinc-200 font-semibold">#{channelName}</strong> da sala <span className="text-indigo-400 font-medium">{roomName}</span>.
          </p>
        </div>

        {/* Message List */}
        {sortedMessages.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-500 italic">
            Nenhuma mensagem por aqui ainda. Seja o primeiro a dizer olá!
          </div>
        ) : (
          sortedMessages.map((msg, index) => {
            const isMe = msg.sender === userName;
            const prevMsg = sortedMessages[index - 1];

            // Distinção de dias
            const showDateDivider = !prevMsg || !isSameDay(prevMsg.timestamp, msg.timestamp);

            // Agrupamento compacto: mesmo autor, mesmo dia, menos de 5 min de diferença
            const isCompact =
              !showDateDivider &&
              prevMsg &&
              prevMsg.sender === msg.sender &&
              msg.timestamp - prevMsg.timestamp < 5 * 60 * 1000;

            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            const avatarStyle = getAvatarStyle(msg.sender);

            return (
              <React.Fragment key={msg.id || `${msg.sender}-${msg.timestamp}-${index}`}>
                {/* Separador de dia */}
                {showDateDivider && (
                  <div className="relative flex items-center justify-center my-4.5 select-none">
                    <div className="flex-1 border-t border-white/[0.07]" />
                    <span className="mx-3.5 px-3 py-0.5 text-[11px] font-semibold text-zinc-400 bg-surface rounded-full border border-white/[0.08] shadow-sm tracking-wide">
                      {formatDayDivider(msg.timestamp)}
                    </span>
                    <div className="flex-1 border-t border-white/[0.07]" />
                  </div>
                )}

                {/* Mensagem */}
                <div
                  className={`group relative flex items-start gap-3.5 px-3 -mx-2 rounded-lg hover:bg-white/[0.03] transition-colors ${
                    isCompact ? 'py-[2.5px] mt-0' : 'pt-2.5 pb-1 mt-2.5'
                  }`}
                >
                  {!isCompact ? (
                    /* Avatar da mensagem inicial */
                    <div
                      className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarStyle.bg} flex items-center justify-center font-bold text-xs shrink-0 select-none shadow-sm mt-0.5 border`}
                    >
                      {msg.sender.charAt(0).toUpperCase()}
                    </div>
                  ) : (
                    /* Gutter com timestamp sutil no hover para mensagens compactas */
                    <div className="w-9 shrink-0 flex items-center justify-end select-none pr-1 pt-0.5">
                      <span className="text-[10px] text-zinc-500 opacity-0 group-hover:opacity-100 font-mono transition-opacity">
                        {timeStr}
                      </span>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    {!isCompact && (
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span
                          className={`text-[13.5px] font-semibold tracking-tight ${
                            isMe ? 'text-indigo-400' : 'text-zinc-100'
                          }`}
                        >
                          {msg.sender}
                        </span>
                        {msg.isHost && (
                          <span className="text-[9.5px] font-medium px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25">
                            Host
                          </span>
                        )}
                        <span className="text-[11px] text-zinc-500 font-normal select-none">
                          {timeStr}
                        </span>
                      </div>
                    )}

                    <div className="text-[13.5px] text-zinc-200 leading-[1.35rem] break-words whitespace-pre-wrap select-text">
                      {msg.text}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box (Minimalist Floating Dock) */}
      <div className="px-4 pb-4 pt-2 bg-app shrink-0 select-none">
        <form onSubmit={handleSend} className="relative flex items-center">
          <div className="relative w-full flex items-center bg-surface-2 border border-white/[0.08] focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/30 rounded-xl px-4 py-2.5 shadow-inner transition-all">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Conversar em #${channelName}...`}
              maxLength={1000}
              className="w-full bg-transparent text-zinc-100 text-[13.5px] placeholder-zinc-500 focus:outline-none pr-20 select-text"
            />

            <div className="absolute right-2.5 flex items-center gap-1.5">
              {/* Emoji Picker Button */}
              <div className="relative" ref={emojiPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="p-1.5 text-zinc-400 hover:text-amber-400 transition cursor-pointer rounded-lg hover:bg-white/[0.06]"
                  title="Inserir Emoji"
                >
                  <Smile className="w-4 h-4" />
                </button>

                {showEmojiPicker && (
                  <div className="absolute bottom-11 right-0 p-2.5 bg-surface-2 border border-white/10 rounded-2xl shadow-2xl z-50 grid grid-cols-5 gap-1.5 w-52 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
                    {EMOJI_LIST.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          if (onSendReaction) onSendReaction(emoji);
                          setInputText((prev) => prev + emoji);
                          setShowEmojiPicker(false);
                        }}
                        className="p-1.5 text-xl hover:bg-white/10 rounded-xl transition text-center cursor-pointer active:scale-95"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Send Button */}
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:hover:bg-indigo-600 text-on-accent transition cursor-pointer shadow-sm active:scale-95"
                title="Enviar mensagem"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
