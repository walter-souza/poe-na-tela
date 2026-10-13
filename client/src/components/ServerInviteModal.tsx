import React, { useState, useEffect } from 'react';
import {
  Lock,
  User,
  ArrowRight,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { GoogleLoginButton } from './GoogleLoginButton';
import { useAuth } from '../context/AuthContext';
import { sanitizeRoomName, sanitizeUserName } from '../utils/sanitize';
import { getRoomInfoUrl } from '../utils/api';

interface ServerInviteModalProps {
  isOpen: boolean;
  roomName: string;
  onAccept: (roomName: string, userName: string, passcode?: string) => Promise<void>;
  onCancel: () => void;
  defaultUserName?: string;
}

interface ServerInfo {
  roomName: string;
  displayName: string;
  hasPasscode: boolean;
  isActive: boolean;
  numParticipants: number;
  memberCount: number;
}

const USERNAME_STORAGE_KEY = 'poe-na-tela-username';

export const ServerInviteModal: React.FC<ServerInviteModalProps> = ({
  isOpen,
  roomName,
  onAccept,
  onCancel,
  defaultUserName = '',
}) => {
  const { profile, isAuthenticated } = useAuth();
  const [userName, setUserName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isCheckingServer, setIsCheckingServer] = useState(true);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync username
  useEffect(() => {
    if (!isOpen || !roomName) return;

    if (profile?.username) {
      setUserName(profile.username);
    } else {
      const savedName = localStorage.getItem(USERNAME_STORAGE_KEY) || defaultUserName;
      if (savedName && savedName.trim()) {
        setUserName(savedName.trim());
      } else {
        const randomGamers = ['GamerPro', 'PlayerOne', 'CyberKnight', 'PixelHero', 'Falcon', 'Shadow', 'Neon'];
        const randomPick = randomGamers[Math.floor(Math.random() * randomGamers.length)] + Math.floor(Math.random() * 90 + 10);
        setUserName(randomPick);
      }
    }

    setErrorMessage(null);
    setIsCheckingServer(true);

    const checkServer = async () => {
      try {
        const cleanRoom = sanitizeRoomName(roomName);
        const res = await fetch(getRoomInfoUrl(cleanRoom));
        if (res.ok) {
          const data = await res.json();
          setServerInfo({
            roomName: data.roomName || cleanRoom,
            displayName: data.displayName || cleanRoom,
            hasPasscode: Boolean(data.hasPasscode),
            isActive: Boolean(data.isActive),
            numParticipants: data.numParticipants || 0,
            memberCount: data.memberCount || 1,
          });
        } else {
          setServerInfo({
            roomName: cleanRoom,
            displayName: cleanRoom,
            hasPasscode: false,
            isActive: false,
            numParticipants: 0,
            memberCount: 1,
          });
        }
      } catch {
        setServerInfo({
          roomName: sanitizeRoomName(roomName),
          displayName: sanitizeRoomName(roomName),
          hasPasscode: false,
          isActive: false,
          numParticipants: 0,
          memberCount: 1,
        });
      } finally {
        setIsCheckingServer(false);
      }
    };

    checkServer();
  }, [isOpen, roomName, profile, defaultUserName]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = sanitizeUserName(userName);
    const cleanRoom = sanitizeRoomName(roomName);
    const cleanPass = passcode.trim() || undefined;

    if (!cleanUser) {
      setErrorMessage('Por favor, informe seu nome de usuário.');
      return;
    }

    if (serverInfo?.hasPasscode && !cleanPass) {
      setErrorMessage('Este servidor é protegido por senha. Por favor, insira a senha.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      localStorage.setItem(USERNAME_STORAGE_KEY, cleanUser);
      await onAccept(cleanRoom, cleanUser, cleanPass);
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao entrar no servidor. Verifique a senha e tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayName = serverInfo?.displayName || roomName;
  const initials = displayName
    .split(' ')
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('') || displayName.slice(0, 2).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fadeIn select-none">
      <div className="bg-surface border border-indigo-500/20 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden text-gray-200">
        {/* Discord-like Server Header */}
        <div className="pt-8 pb-6 px-6 bg-gradient-to-b from-surface-2 to-surface border-b border-white/5 flex flex-col items-center text-center">
          {/* Server Icon */}
          <div className="w-20 h-20 rounded-[24px] bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 flex items-center justify-center text-on-accent font-extrabold text-2xl shadow-xl shadow-indigo-600/30 mb-4 ring-4 ring-surface">
            {initials}
          </div>

          <span className="text-xs uppercase font-bold tracking-wider text-gray-400 mb-1">
            Você foi convidado para participar de
          </span>

          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-wide truncate max-w-full">
            {displayName}
          </h2>

          {/* Members / Online Status */}
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              {serverInfo?.numParticipants || 0} Online
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2 h-2 rounded-full bg-gray-500" />
              {serverInfo?.memberCount || 1} Membros
            </span>
          </div>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {isCheckingServer ? (
            <div className="flex items-center justify-center gap-2 p-3 bg-white/5 rounded-2xl text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Verificando servidor...</span>
            </div>
          ) : null}

          {/* Password Input (if protected) */}
          {serverInfo?.hasPasscode && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" /> Senha do Servidor
              </label>
              <div className="relative flex items-center">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Insira a senha do servidor..."
                  className="w-full bg-surface-2 text-white text-xs sm:text-sm rounded-xl px-3.5 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-amber-500 border border-amber-500/30 placeholder-gray-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 text-gray-400 hover:text-white transition"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* User Account / Identity Display */}
          {isAuthenticated && profile ? (
            <div className="p-3 bg-white/[0.03] border border-white/5 rounded-2xl flex items-center gap-3">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.username}
                  className="w-9 h-9 rounded-full object-cover ring-1 ring-white/10"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-indigo-600/30 text-indigo-300 font-bold text-xs flex items-center justify-center">
                  {profile.username?.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] text-gray-400">Entrando como</span>
                <span className="text-xs font-bold text-white truncate">
                  {profile.username}
                </span>
              </div>
              <CheckCircle2 className="w-4 h-4 text-emerald-400 ml-auto shrink-0" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-indigo-400" /> Seu Apelido de Convidado
                </label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Como quer ser chamado?"
                  maxLength={32}
                  className="w-full bg-surface-2 text-white text-xs sm:text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 border border-white/5 placeholder-gray-500"
                />
              </div>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-white/5" />
                <span className="flex-shrink mx-2 text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                  ou faça login
                </span>
                <div className="flex-grow border-t border-white/5" />
              </div>

              <GoogleLoginButton className="w-full flex justify-center" />
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 space-y-2">
            <button
              type="submit"
              disabled={isSubmitting || isCheckingServer}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-on-accent font-bold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Entrando no Servidor...</span>
                </>
              ) : (
                <>
                  <span>Aceitar Convite</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onCancel}
              className="w-full py-2.5 text-xs text-gray-400 hover:text-white transition cursor-pointer"
            >
              Voltar ao Início
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
