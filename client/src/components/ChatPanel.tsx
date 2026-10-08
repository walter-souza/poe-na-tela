import React, { useState, useRef, useEffect } from 'react';
import {
  MessageSquare,
  Users,
  Send,
  Sparkles,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Monitor,
  Share2,
  Check,
  Smile,
  LogIn,
  LogOut,
  PanelRightClose,
} from 'lucide-react';
import type { ChatMessage, ParticipantInfo } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  participants: ParticipantInfo[];
  onSendMessage: (text: string) => void;
  onSendReaction: (emoji: string) => void;
  userName: string;
  roomName: string;
  onClose?: () => void;
  userVolumes?: Record<string, number>;
  onUserVolumeChange?: (participantIdentity: string, volume: number) => void;
}

const EMOJI_LIST = [
  '🔥', '👏', '😂', '❤️', '🎮',
  '🚀', '🎉', '🍿', '💯', '🤯',
  '😎', '👀', '👍', '🙌', '🥳',
  '😭', '✨', '⚡', '🏆', '💀'
];

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  participants,
  onSendMessage,
  onSendReaction,
  userName,
  roomName,
  onClose,
  userVolumes,
  onUserVolumeChange,
}) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'participants'>('chat');
  const [inputText, setInputText] = useState('');
  const [copied, setCopied] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (activeTab === 'chat') {
      scrollToBottom();
    }
  }, [messages, activeTab]);

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

  const copyRoomLink = () => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomName)}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 w-full h-[100dvh] flex flex-col bg-[#11131a] md:relative md:inset-auto md:w-80 lg:w-96 md:h-full md:border-l border-white/10 shadow-2xl">
      <div className="flex items-center justify-between p-3 border-b border-white/10 bg-white/5 safe-area-top">
        <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'chat'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
            {messages.length > 0 && (
              <span className="bg-white/20 text-[10px] px-1.5 py-0.2 rounded-full">
                {messages.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('participants')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'participants'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Amigos</span>
            <span className="bg-white/20 text-[10px] px-1.5 py-0.2 rounded-full">
              {participants.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={copyRoomLink}
            title="Copiar Link da Sala para Amigos"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 hover:text-white transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copiado!' : 'Convidar'}</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              title="Fechar Chat"
              className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 border border-transparent hover:border-white/10 transition flex items-center gap-1"
            >
              <PanelRightClose className="w-4 h-4" />
              <span className="text-xs font-medium md:hidden">Fechar</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-0.5">
        {activeTab === 'chat' ? (
          messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 text-sm p-6">
              <Sparkles className="w-8 h-8 text-indigo-500/40 mb-2" />
              <p className="font-semibold text-gray-400 mb-1">Nenhuma mensagem ainda</p>
              <p className="text-xs">Mande um oi ou envie uma reação abaixo para animar a transmissão!</p>
            </div>
          ) : (
            messages.map((m) => {
              const timeString = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              if (m.isSystem) {
                const isJoin = m.text.includes('entrou');
                const isLeave = m.text.includes('saiu');

                return (
                  <div
                    key={m.id}
                    className="py-1 px-2 rounded-lg text-xs leading-relaxed select-none animate-fadeIn flex items-center gap-1.5"
                  >
                    <span className="text-gray-500 font-mono tabular-nums text-xs select-none mr-1">
                      {timeString}
                    </span>
                    {isJoin && <LogIn className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                    {isLeave && <LogOut className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                    <span className={isJoin ? 'text-emerald-300 font-medium' : isLeave ? 'text-rose-300 font-medium' : 'text-gray-400'}>
                      {m.text}
                    </span>
                  </div>
                );
              }

              const isMe = m.sender === userName;
              return (
                <div
                  key={m.id}
                  className="py-1 px-2 rounded-lg hover:bg-white/[0.04] transition-colors text-sm leading-relaxed animate-fadeIn"
                >
                  <span className="text-xs text-gray-500 font-mono tabular-nums mr-2 select-none align-baseline">
                    {timeString}
                  </span>
                  <span
                    className={`font-semibold mr-1 cursor-default ${
                      isMe ? 'text-indigo-400' : 'text-purple-400'
                    }`}
                  >
                    {m.sender}
                    {m.isHost && (
                      <span className="ml-1 mr-0.5 inline-block align-baseline bg-red-500/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase">
                        HOST
                      </span>
                    )}
                    :
                  </span>
                  <span className="text-gray-100 break-words whitespace-pre-wrap selection:bg-indigo-500/30">
                    {m.text}
                  </span>
                </div>
              );
            })
          )
        ) : (
          <div className="space-y-2">
            {participants.map((p) => {
              const isMe = p.identity === userName || p.name === userName;
              const userVol = userVolumes?.[p.identity] !== undefined ? userVolumes[p.identity] : 1;
              const isUserMuted = userVol === 0;

              return (
                <div
                  key={p.identity}
                  className={`flex flex-col gap-2 p-2.5 rounded-xl border transition ${
                    p.isSpeaking
                      ? 'bg-emerald-950/30 border-emerald-500/50 shadow-sm shadow-emerald-500/10'
                      : 'bg-white/5 border-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative shrink-0">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-xs text-white uppercase shadow">
                          {p.name.slice(0, 2)}
                        </div>
                        {p.isSpeaking && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 border-2 border-[#11131a] rounded-full animate-ping" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white flex items-center gap-1.5 truncate">
                          <span className="truncate">{p.name}</span>
                          {isMe && <span className="text-[10px] text-indigo-400 font-normal shrink-0">(Você)</span>}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {p.isScreenSharing ? 'Transmitindo Tela' : 'Assistindo'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 text-gray-400 shrink-0">
                      {p.isScreenSharing && (
                        <span className="p-1 rounded bg-indigo-500/20 text-indigo-400" title="Compartilhando Tela">
                          <Monitor className="w-3.5 h-3.5" />
                        </span>
                      )}
                      {p.isMuted ? (
                        <span className="p-1 rounded bg-rose-500/20 text-rose-400" title="Microfone desligado pelo usuário">
                          <MicOff className="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <span className="p-1 rounded bg-emerald-500/20 text-emerald-400" title="Microfone ativo">
                          <Mic className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Individual Voice Volume Slider for Remote Participants */}
                  {!isMe && onUserVolumeChange && (
                    <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-white/5 bg-black/20 px-2 py-1 rounded-lg">
                      <button
                        type="button"
                        onClick={() => onUserVolumeChange(p.identity, isUserMuted ? 1 : 0)}
                        className="text-gray-400 hover:text-indigo-400 transition shrink-0"
                        title={
                          isUserMuted
                            ? 'Desmutar voz deste amigo (apenas para você)'
                            : 'Silenciar voz deste amigo (apenas para você)'
                        }
                      >
                        {isUserMuted ? (
                          <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={isUserMuted ? 0 : userVol}
                        onChange={(e) => onUserVolumeChange(p.identity, parseFloat(e.target.value))}
                        title="Ajustar volume da voz deste amigo para você (0% a 200%, 100% padrão)"
                        className="flex-1 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />

                      <span
                        className={`text-[10px] font-mono min-w-[36px] text-right shrink-0 ${
                          isUserMuted
                            ? 'text-gray-400'
                            : userVol > 1
                            ? 'text-amber-400 font-semibold'
                            : 'text-gray-300'
                        }`}
                        title={userVol > 1 ? 'Volume amplificado (+dB)' : undefined}
                      >
                        {isUserMuted ? 'Mudo' : `${Math.round(userVol * 100)}%`}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {activeTab === 'chat' && (
        <form onSubmit={handleSend} className="p-3 border-t border-white/10 bg-white/5 flex items-center gap-2 relative safe-area-bottom">
          <input
            type="text"
            placeholder="Conversar com amigos..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
          />

          {/* Emoji Reaction Popover */}
          <div className="relative" ref={emojiPickerRef}>
            {showEmojiPicker && (
              <div className="absolute bottom-full right-0 mb-3 p-3 bg-[#151722] border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl z-50 w-64 max-w-[calc(100vw-2rem)] animate-fadeIn select-none">
                <div className="text-[11px] font-semibold text-gray-400 mb-2 px-1 flex items-center justify-between border-b border-white/5 pb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    Reações na Tela
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5 p-0.5">
                  {EMOJI_LIST.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        onSendReaction(emoji);
                        setShowEmojiPicker(false);
                      }}
                      className="h-9 w-9 flex items-center justify-center text-xl rounded-xl hover:bg-white/10 hover:scale-115 active:scale-95 transition-all cursor-pointer"
                      title={`Reagir com ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowEmojiPicker((prev) => !prev)}
              title="Reações e Emojis"
              className={`p-2 rounded-xl border transition cursor-pointer ${
                showEmojiPicker
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300 hover:text-white'
              }`}
            >
              <Smile className="w-4 h-4" />
            </button>
          </div>

          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 rounded-xl text-white transition shadow cursor-pointer disabled:cursor-not-allowed"
            title="Enviar mensagem"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      )}
    </div>
  );
};
