import React, { useState, useRef, useEffect } from 'react';
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
}

const EMOJI_LIST = [
  '🔥', '👏', '😂', '❤️', '🎮',
  '🚀', '🎉', '🍿', '💯', '🤯',
  '😎', '👀', '👍', '🙌', '🥳',
  '😭', '✨', '⚡', '🏆', '💀'
];

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
}) => {
  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
    <div className="flex-1 flex flex-col h-full bg-[#0d0f17] min-w-0 select-text relative">
      {/* Channel Header (Discord-like) */}
      <div className="h-14 border-b border-white/10 px-4 sm:px-6 flex items-center justify-between bg-[#11131c]/70 backdrop-blur-md shrink-0 select-none z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <Hash className="w-5 h-5 text-gray-400 shrink-0" />
          <span className="font-bold text-white text-sm sm:text-base truncate">
            {channelName}
          </span>

          <div className="h-4 w-[1px] bg-white/10 mx-1 hidden sm:block" />

          {isEncrypted ? (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
              <Lock className="w-3 h-3" /> Criptografado (KMS)
            </span>
          ) : (
            <span className="hidden sm:inline text-xs text-gray-400 truncate">
              Canal de texto de {roomName}
            </span>
          )}
        </div>

        {/* Banner para voltar à transmissão se voz conectada */}
        {isVoiceConnected && onSwitchToStage && (
          <button
            onClick={onSwitchToStage}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition cursor-pointer shrink-0 animate-pulse"
          >
            <Tv className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Voltar ao Palco</span>
            <span className="text-[10px] bg-emerald-500/30 px-1.5 py-0.5 rounded text-emerald-200">
              {activeVoiceChannelName || 'Voz'}
            </span>
          </button>
        )}
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4 scrollbar-thin scrollbar-thumb-gray-800">
        {/* Welcome Header */}
        <div className="pt-4 pb-2 border-b border-white/5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center mb-3">
            <Hash className="w-6 h-6" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">
            Bem-vindo a #{channelName}!
          </h2>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">
            Este é o início do canal de texto #{channelName} na sala {roomName}.
          </p>
        </div>

        {/* Message List */}
        {messages.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-500 italic">
            Nenhuma mensagem por aqui ainda. Seja o primeiro a dizer olá!
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMe = msg.sender === userName;
            const prevMsg = messages[index - 1];
            const isCompact = prevMsg && prevMsg.sender === msg.sender && msg.timestamp - prevMsg.timestamp < 120000;

            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={msg.id || index}
                className={`group flex items-start gap-3 hover:bg-white/[0.02] -mx-2 px-2 py-1 rounded-lg transition-colors ${
                  isCompact ? 'mt-0.5' : 'mt-2.5'
                }`}
              >
                {!isCompact ? (
                  <div className="w-9 h-9 rounded-full bg-indigo-600/30 text-indigo-300 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 ring-1 ring-white/10">
                    {msg.sender.charAt(0).toUpperCase()}
                  </div>
                ) : (
                  <div className="w-9 shrink-0 text-[10px] text-gray-600 opacity-0 group-hover:opacity-100 text-center select-none pt-0.5">
                    {timeStr}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  {!isCompact && (
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs font-bold ${isMe ? 'text-indigo-400' : 'text-white'}`}>
                        {msg.sender}
                      </span>
                      {msg.isHost && (
                        <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-medium">
                          Host
                        </span>
                      )}
                      <span className="text-[10px] text-gray-500 select-none">
                        {timeStr}
                      </span>
                    </div>
                  )}

                  <div className="text-xs sm:text-sm text-gray-200 leading-relaxed break-words whitespace-pre-wrap select-text">
                    {msg.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box (Discord-like bottom dock) */}
      <div className="p-3 sm:p-4 bg-[#11131c]/60 border-t border-white/10 shrink-0">
        <form onSubmit={handleSend} className="relative flex items-center">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Conversar em #${channelName}...`}
            maxLength={1000}
            className="w-full bg-[#181a26] text-white text-xs sm:text-sm rounded-xl pl-4 pr-24 py-3 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 border border-white/5 transition"
          />

          <div className="absolute right-2 flex items-center gap-1">
            {/* Emoji Picker Button */}
            <div className="relative" ref={emojiPickerRef}>
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className="p-1.5 text-gray-400 hover:text-amber-400 transition cursor-pointer rounded-lg hover:bg-white/5"
                title="Inserir Emoji"
              >
                <Smile className="w-4 h-4" />
              </button>

              {showEmojiPicker && (
                <div className="absolute bottom-10 right-0 p-2 bg-[#1c1e2b] border border-white/15 rounded-xl shadow-2xl z-50 grid grid-cols-5 gap-1 w-48">
                  {EMOJI_LIST.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        if (onSendReaction) onSendReaction(emoji);
                        setInputText((prev) => prev + emoji);
                        setShowEmojiPicker(false);
                      }}
                      className="p-1.5 text-lg hover:bg-white/10 rounded transition text-center cursor-pointer"
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
              className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition cursor-pointer"
              title="Enviar mensagem"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
