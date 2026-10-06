import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Lock,
  User,
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeOff,
  AlertCircle,
  Radio,
  PlusCircle,
  Loader2,
} from 'lucide-react';

interface InviteModalProps {
  isOpen: boolean;
  roomName: string;
  onJoin: (roomName: string, userName: string, isPublisher: boolean, passcode?: string) => Promise<void>;
  onCancel: () => void;
  defaultUserName?: string;
}

interface RoomInfo {
  roomName: string;
  hasPasscode: boolean;
  isActive: boolean;
  numParticipants: number;
}

const USERNAME_STORAGE_KEY = 'poe-na-tela-username';

export const InviteModal: React.FC<InviteModalProps> = ({
  isOpen,
  roomName,
  onJoin,
  onCancel,
  defaultUserName = '',
}) => {
  const [userName, setUserName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isCheckingRoom, setIsCheckingRoom] = useState(true);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize or fetch room info and username
  useEffect(() => {
    if (!isOpen || !roomName) return;

    // Load saved or provided username
    const savedName = localStorage.getItem(USERNAME_STORAGE_KEY) || defaultUserName;
    if (savedName && savedName.trim()) {
      setUserName(savedName.trim());
    } else {
      const randomGamers = ['GamerPro', 'PlayerOne', 'CyberKnight', 'PixelHero', 'Falcon', 'Shadow', 'Vortex', 'Neon'];
      const randomPick = randomGamers[Math.floor(Math.random() * randomGamers.length)] + Math.floor(Math.random() * 90 + 10);
      setUserName(randomPick);
    }

    setErrorMessage(null);
    setIsCheckingRoom(true);

    const checkRoom = async () => {
      try {
        const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
        const cleanRoom = roomName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        const infoUrl = apiBase.endsWith('/api')
          ? `${apiBase}/room/${encodeURIComponent(cleanRoom)}/info`
          : `${apiBase}/api/room/${encodeURIComponent(cleanRoom)}/info`;

        const res = await fetch(infoUrl);
        if (res.ok) {
          const data = await res.json();
          setRoomInfo({
            roomName: data.roomName || cleanRoom,
            hasPasscode: Boolean(data.hasPasscode),
            isActive: Boolean(data.isActive),
            numParticipants: data.numParticipants || 0,
          });
        } else {
          // If 404 or error, assume room not active
          setRoomInfo({
            roomName: cleanRoom,
            hasPasscode: false,
            isActive: false,
            numParticipants: 0,
          });
        }
      } catch {
        setRoomInfo({
          roomName,
          hasPasscode: false,
          isActive: false,
          numParticipants: 0,
        });
      } finally {
        setIsCheckingRoom(false);
      }
    };

    checkRoom();
  }, [isOpen, roomName, defaultUserName]);

  if (!isOpen || !roomName) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) {
      setErrorMessage('Por favor, informe seu nome ou apelido.');
      return;
    }

    const cleanUser = userName.trim();
    const cleanRoom = roomName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const cleanPass = passcode.trim() || undefined;

    if (roomInfo?.isActive && roomInfo?.hasPasscode && !cleanPass) {
      setErrorMessage('Esta sala requer uma senha de acesso.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      localStorage.setItem(USERNAME_STORAGE_KEY, cleanUser);
      await onJoin(cleanRoom, cleanUser, true, cleanPass);
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao conectar à sala. Verifique a senha e tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn select-none">
      <div className="bg-[#11131c] border border-indigo-500/20 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden text-gray-200">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 bg-gradient-to-r from-indigo-950/40 to-violet-950/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-lg shadow-indigo-500/10">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base leading-tight">Convite de Transmissão</h3>
              <p className="text-xs text-gray-400">Você recebeu um link para entrar na sala</p>
            </div>
          </div>

          <div className="px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 font-mono text-xs font-semibold">
            {roomName}
          </div>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Room Status Badge */}
          {isCheckingRoom ? (
            <div className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-white/5 rounded-2xl text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Verificando disponibilidade da sala...</span>
            </div>
          ) : roomInfo?.isActive ? (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                <div>
                  <div className="font-bold text-emerald-300 text-xs flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5" />
                    <span>Sala Ativa e Pronta</span>
                  </div>
                  <div className="text-[11px] text-gray-300 mt-0.5">
                    {roomInfo.numParticipants === 1
                      ? '1 pessoa conectada agora'
                      : `${roomInfo.numParticipants} pessoas conectadas agora`}
                  </div>
                </div>
              </div>
              {roomInfo.hasPasscode && (
                <div className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/20 border border-amber-500/30 rounded-xl text-[11px] text-amber-300 font-medium">
                  <Lock className="w-3 h-3" />
                  <span>Com Senha</span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-1">
              <div className="font-bold text-amber-300 text-xs flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <span>Sala ainda não criada ou inativa</span>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Ninguém está na sala no momento. Você pode criá-la agora mesmo e ser o anfitrião!
              </p>
            </div>
          )}

          {/* Error Message Banner */}
          {errorMessage && (
            <div className="p-3.5 bg-rose-500/15 border border-rose-500/30 rounded-2xl text-xs text-rose-300 flex items-center gap-2.5 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* User Name Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Seu Nome ou Apelido
            </label>
            <div className="relative">
              <input
                type="text"
                required
                maxLength={30}
                placeholder="Ex: João, Player1..."
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                disabled={isSubmitting}
                className="w-full bg-black/40 border border-white/10 rounded-2xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
              />
              <User className="w-4 h-4 text-gray-500 absolute left-3.5 top-3.5" />
            </div>
          </div>

          {/* Passcode Input (Required if active room has passcode, Optional if creating new room) */}
          {(!roomInfo?.isActive || roomInfo?.hasPasscode) && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {roomInfo?.isActive ? 'Senha da Sala' : 'Senha de Proteção (Opcional)'}
                </label>
                {!roomInfo?.isActive && (
                  <span className="text-[10px] text-gray-500">Deixe em branco para pública</span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required={Boolean(roomInfo?.isActive && roomInfo?.hasPasscode)}
                  placeholder={
                    roomInfo?.isActive ? 'Digite a senha da sala...' : 'Senha opcional para proteger a sala...'
                  }
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-black/40 border border-white/10 rounded-2xl pl-10 pr-10 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <Lock className="w-4 h-4 text-gray-500 absolute left-3.5 top-3.5" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3.5 text-gray-500 hover:text-white transition"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar ao Menu Principal</span>
            </button>

            <button
              type="submit"
              disabled={isSubmitting || isCheckingRoom || !userName.trim()}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 text-white font-bold text-xs rounded-2xl shadow-lg shadow-indigo-600/30 transition cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Conectando...</span>
                </>
              ) : roomInfo?.isActive ? (
                <>
                  <span>Entrar na Sala</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  <PlusCircle className="w-4 h-4" />
                  <span>Criar Sala e Entrar</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
