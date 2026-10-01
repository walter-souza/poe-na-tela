import React, { useState, useRef, useEffect } from 'react';
import {
  MessageSquare,
  Users,
  Send,
  Sparkles,
  Mic,
  MicOff,
  Monitor,
  Share2,
  Check,
  Smile,
  LogIn,
  LogOut,
} from 'lucide-react';
import type { ChatMessage, ParticipantInfo } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  participants: ParticipantInfo[];
  onSendMessage: (text: string) => void;
  onSendReaction: (emoji: string) => void;
  userName: string;
  roomName: string;
}

const EMOJI_LIST = ['🔥', '👏', '😂', '❤️', '🎮', '🚀', '🎉', '🍿', '💯', '🤯'];

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  participants,
  onSendMessage,
  onSendReaction,
  userName,
  roomName,
}) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'participants'>('chat');
  const [inputText, setInputText] = useState('');
  const [copied, setCopied] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (activeTab === 'chat') {
      scrollToBottom();
    }
  }, [messages, activeTab]);

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
    <div className="w-80 lg:w-96 bg-[#11131a] border-l border-white/10 flex flex-col h-full shadow-2xl">
      <div className="flex items-center justify-between p-3 border-b border-white/10 bg-white/5">
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

        <button
          onClick={copyRoomLink}
          title="Copiar Link da Sala para Amigos"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 hover:text-white transition"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copiado!' : 'Convidar'}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {activeTab === 'chat' ? (
          messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 text-xs p-6">
              <Sparkles className="w-8 h-8 text-indigo-500/40 mb-2" />
              <p className="font-semibold text-gray-400 mb-1">Nenhuma mensagem ainda</p>
              <p>Mande um oi ou envie uma reação abaixo para animar a transmissão!</p>
            </div>
          ) : (
            messages.map((m) => {
              if (m.isSystem) {
                const isJoin = m.text.includes('entrou');
                const isLeave = m.text.includes('saiu');

                return (
                  <div key={m.id} className="flex items-center justify-center my-1.5 animate-fadeIn">
                    <div
                      className={`px-3 py-1 rounded-full text-[11px] font-medium flex items-center gap-1.5 shadow-sm border ${
                        isJoin
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                          : isLeave
                          ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                          : 'bg-white/5 border-white/5 text-gray-400'
                      }`}
                    >
                      {isJoin && <LogIn className="w-3 h-3 text-emerald-400 shrink-0" />}
                      {isLeave && <LogOut className="w-3 h-3 text-rose-400 shrink-0" />}
                      <span>{m.text}</span>
                      <span className="text-[10px] text-gray-500 ml-0.5">
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              }

              const isMe = m.sender === userName;
              return (
                <div key={m.id} className="flex flex-col text-xs leading-relaxed animate-fadeIn">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className={`font-semibold ${
                        isMe ? 'text-indigo-400' : 'text-purple-400'
                      }`}
                    >
                      {m.sender}
                    </span>
                    {m.isHost && (
                      <span className="bg-red-500/20 text-red-400 text-[10px] px-1.5 py-0.2 rounded font-bold">
                        HOST
                      </span>
                    )}
                    <span className="text-[10px] text-gray-500">
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-gray-200 break-words shadow-sm">
                    {m.text}
                  </div>
                </div>
              );
            })
          )
        ) : (
          <div className="space-y-2">
            {participants.map((p) => {
              const isMe = p.identity === userName || p.name === userName;
              return (
                <div
                  key={p.identity}
                  className={`flex items-center justify-between p-2.5 rounded-xl border transition ${
                    p.isSpeaking
                      ? 'bg-emerald-950/30 border-emerald-500/50 shadow-sm shadow-emerald-500/10'
                      : 'bg-white/5 border-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="relative">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-xs text-white uppercase shadow">
                        {p.name.slice(0, 2)}
                      </div>
                      {p.isSpeaking && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 border-2 border-[#11131a] rounded-full animate-ping" />
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                        <span>{p.name}</span>
                        {isMe && <span className="text-[10px] text-indigo-400 font-normal">(Você)</span>}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {p.isScreenSharing ? 'Transmitindo Tela' : 'Assistindo'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-gray-400">
                    {p.isScreenSharing && (
                      <span className="p-1 rounded bg-indigo-500/20 text-indigo-400" title="Compartilhando Tela">
                        <Monitor className="w-3.5 h-3.5" />
                      </span>
                    )}
                    {p.isMuted ? (
                      <span className="p-1 rounded bg-rose-500/20 text-rose-400" title="Microfone Mudo">
                        <MicOff className="w-3.5 h-3.5" />
                      </span>
                    ) : (
                      <span className="p-1 rounded bg-emerald-500/20 text-emerald-400" title="Microfone Ativo">
                        <Mic className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="px-3 py-2 border-t border-white/10 bg-black/30 flex items-center gap-1 overflow-x-auto">
        <span className="text-xs text-gray-500 mr-1 flex items-center">
          <Smile className="w-3.5 h-3.5" />
        </span>
        {EMOJI_LIST.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSendReaction(emoji)}
            className="hover:scale-125 transition-transform text-lg p-1 rounded hover:bg-white/10"
            title={`Reagir com ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {activeTab === 'chat' && (
        <form onSubmit={handleSend} className="p-3 border-t border-white/10 bg-white/5 flex gap-2">
          <input
            type="text"
            placeholder="Conversar com amigos..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 rounded-xl text-white transition shadow"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      )}
    </div>
  );
};
