import React, { useState } from 'react';
import { X, Hash, Volume2, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl } from '../utils/api';
import type { Channel } from '../types';

interface CreateChannelModalProps {
  isOpen: boolean;
  roomSlug: string;
  onClose: () => void;
  onChannelCreated: (newChannel: Channel) => void;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  isOpen,
  roomSlug,
  onClose,
  onChannelCreated,
}) => {
  const { session } = useAuth();
  const [channelType, setChannelType] = useState<'text' | 'voice'>('text');
  const [channelName, setChannelName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = channelName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32);
    if (!cleanName) {
      setError('Por favor, informe o nome do canal.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = session?.access_token;
      const res = await fetch(`${getApiBaseUrl()}/api/rooms/${roomSlug}/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: cleanName,
          type: channelType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao criar canal.');
      }

      onChannelCreated(data.channel);
      onClose();
      setChannelName('');
    } catch (err: any) {
      setError(err?.message || 'Falha ao criar canal.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-sm p-5 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800/60 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 rounded-xl bg-indigo-600/15 text-indigo-400">
            <Plus className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Criar Canal</h3>
            <p className="text-xs text-gray-400">Adicione à sala {roomSlug}</p>
          </div>
        </div>

        {error && (
          <div className="p-2.5 mb-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tipo de Canal */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Tipo de Canal
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChannelType('text')}
                className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                  channelType === 'text'
                    ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                    : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                <Hash className="w-4 h-4 text-indigo-400 shrink-0" />
                <div className="text-left">
                  <span className="block font-bold">Texto</span>
                  <span className="text-[10px] text-gray-400">Postar chats</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setChannelType('voice')}
                className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                  channelType === 'voice'
                    ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="text-left">
                  <span className="block font-bold">Voz</span>
                  <span className="text-[10px] text-gray-400">Falar e stream</span>
                </div>
              </button>
            </div>
          </div>

          {/* Nome do Canal */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Nome do Canal
            </label>
            <div className="relative flex items-center">
              <div className="absolute left-3 text-gray-500 pointer-events-none">
                {channelType === 'text' ? <Hash className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </div>
              <input
                type="text"
                value={channelName}
                onChange={(e) =>
                  setChannelName(
                    e.target.value
                      .toLowerCase()
                      .replace(/\s+/g, '-')
                      .replace(/[^a-z0-9_-]/g, '')
                  )
                }
                placeholder={channelType === 'text' ? 'ex: bate-papo' : 'ex: squad-alfa'}
                maxLength={32}
                className="w-full bg-[#181b26] border border-gray-800 rounded-xl pl-9 pr-3.5 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 font-mono text-xs transition"
                required
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl text-xs transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading || !channelName.trim()}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-xl text-xs transition shadow-lg shadow-indigo-600/25 cursor-pointer"
            >
              {isLoading ? 'Criando...' : 'Criar Canal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
