import React, { useState } from 'react';
import { X, Sparkles, Lock, Hash, ShieldAlert } from 'lucide-react';
import { GoogleLoginButton } from './GoogleLoginButton';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl } from '../utils/api';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRoomCreated: (roomSlug: string, passcode?: string) => void;
}

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({
  isOpen,
  onClose,
  onRoomCreated,
}) => {
  const { isAuthenticated, session } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [passcode, setPasscode] = useState('');
  const [hasPasscode, setHasPasscode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]/g, '-')) {
      const autoSlug = val
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
      setSlug(autoSlug);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Por favor, informe o nome da sala.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const cleanSlug = slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-');
      const token = session?.access_token;

      const res = await fetch(`${getApiBaseUrl()}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          slug: cleanSlug,
          passcode: hasPasscode && passcode.trim() ? passcode.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao criar a sala.');
      }

      onRoomCreated(data.room.slug, hasPasscode ? passcode.trim() : undefined);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Falha ao criar sala.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800/60 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {!isAuthenticated ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Autenticação Necessária</h3>
            <p className="text-sm text-gray-400 mb-6 leading-relaxed">
              Para criar salas persistentes, canais personalizados e gerenciar permissões, você precisa entrar com sua conta Google.
            </p>
            <div className="flex flex-col items-center justify-center py-2">
              <GoogleLoginButton size="large" shape="pill" theme="outline" width={280} />
            </div>
            <button
              onClick={onClose}
              className="mt-4 text-xs text-gray-500 hover:text-gray-400"
            >
              Voltar ao Lobby
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-indigo-600/15 text-indigo-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Criar Nova Sala</h3>
                <p className="text-xs text-gray-400">Sala persistente com canais de texto e voz</p>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">Nome da Sala</label>
              <input
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Ex: Jogatina dos Amigos"
                maxLength={48}
                className="w-full bg-[#181b26] border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1">
                <Hash className="w-3.5 h-3.5 text-indigo-400" /> Link / Identificador (Slug)
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="ex: jogatina-dos-amigos"
                maxLength={32}
                className="w-full bg-[#181b26] border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors font-mono text-xs"
                required
              />
              <p className="text-[11px] text-gray-500 mt-1">Usado no link de convite da sala</p>
            </div>

            <div className="pt-2 border-t border-gray-800/80">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-300 mb-2">
                <input
                  type="checkbox"
                  checked={hasPasscode}
                  onChange={(e) => setHasPasscode(e.target.checked)}
                  className="rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-0"
                />
                <Lock className="w-3.5 h-3.5 text-amber-400" /> Proteger com Senha
              </label>

              {hasPasscode && (
                <input
                  type="password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Defina uma senha para a sala"
                  className="w-full bg-[#181b26] border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
                  required={hasPasscode}
                />
              )}
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-colors shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2"
              >
                {isLoading ? 'Criando...' : 'Criar Sala'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
