import React, { useEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { GoogleLoginButton } from './GoogleLoginButton';
import { Button, ErrorText, Field, Modal, inputClass } from './ui';
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
  displayName: string;
  hasPasscode: boolean;
  numParticipants: number;
}

const USERNAME_STORAGE_KEY = 'poe-na-tela-username';

/** Entrada por link ou código: mostra o servidor, pede apelido (convidado) e senha só se houver. */
export const ServerInviteModal: React.FC<ServerInviteModalProps> = ({
  isOpen,
  roomName,
  onAccept,
  onCancel,
  defaultUserName = '',
}) => {
  const { profile, isAuthenticated } = useAuth();
  // Montado de novo a cada convite (App usa key={roomName}), então o estado inicial basta.
  const [userName, setUserName] = useState(
    () => profile?.username || localStorage.getItem(USERNAME_STORAGE_KEY)?.trim() || defaultUserName
  );
  const [passcode, setPasscode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isCheckingServer, setIsCheckingServer] = useState(true);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !roomName) return;

    const cleanRoom = sanitizeRoomName(roomName);
    const fallback: ServerInfo = { displayName: cleanRoom, hasPasscode: false, numParticipants: 0 };
    let cancelled = false;

    fetch(getRoomInfoUrl(cleanRoom))
      .then(async (res) => {
        if (!res.ok) return fallback;
        const data = await res.json();
        return {
          displayName: data.displayName || cleanRoom,
          hasPasscode: Boolean(data.hasPasscode),
          numParticipants: data.numParticipants || 0,
        };
      })
      .catch(() => fallback)
      .then((info) => {
        if (cancelled) return;
        setServerInfo(info);
        setIsCheckingServer(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, roomName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = sanitizeUserName(userName);
    const cleanPass = passcode.trim() || undefined;

    if (!cleanUser) {
      setErrorMessage('Escolha um apelido para entrar.');
      return;
    }
    if (serverInfo?.hasPasscode && !cleanPass) {
      setErrorMessage('Este servidor tem senha. Digite a senha para entrar.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      localStorage.setItem(USERNAME_STORAGE_KEY, cleanUser);
      await onAccept(sanitizeRoomName(roomName), cleanUser, cleanPass);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Não foi possível entrar no servidor. Confira a senha e tente de novo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayName = serverInfo?.displayName || roomName;

  return (
    <Modal open={isOpen} onClose={onCancel} className="max-w-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="text-center pt-1">
          <span className="mx-auto w-14 h-14 rounded-2xl bg-surface-2 border border-line flex items-center justify-center text-xl font-semibold">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <p className="text-xs text-gray-400 mt-3">Você foi convidado para</p>
          <h2 className="text-lg font-semibold truncate">{displayName}</h2>
          <p className="text-xs text-gray-400 mt-1 h-4 flex items-center justify-center gap-1.5">
            {isCheckingServer ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> Verificando servidor
              </>
            ) : serverInfo && serverInfo.numParticipants > 0 ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {serverInfo.numParticipants} na voz agora
              </>
            ) : (
              'Ninguém na voz agora'
            )}
          </p>
        </div>

        {isAuthenticated && profile ? (
          <p className="text-sm text-gray-400 text-center">
            Entrando como <span className="text-gray-100 font-medium">{profile.username}</span>
          </p>
        ) : (
          <Field label="Seu apelido" htmlFor="invite-name">
            <input
              id="invite-name"
              type="text"
              maxLength={32}
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Como quer ser chamado?"
              className={inputClass}
            />
          </Field>
        )}

        {serverInfo?.hasPasscode && (
          <Field label="Senha do servidor" htmlFor="invite-pass">
            <div className="relative">
              <input
                id="invite-pass"
                type={showPassword ? 'text' : 'password'}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Digite a senha"
                className={`${inputClass} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-100 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
        )}

        {errorMessage && <ErrorText>{errorMessage}</ErrorText>}

        <Button type="submit" variant="primary" block disabled={isSubmitting || isCheckingServer}>
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Entrando
            </>
          ) : (
            <>
              Entrar no servidor <ArrowRight className="w-4 h-4" />
            </>
          )}
        </Button>

        {!isAuthenticated && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex-1 h-px bg-line" />
              ou entre com sua conta
              <span className="flex-1 h-px bg-line" />
            </div>
            <GoogleLoginButton className="w-full flex justify-center" />
          </div>
        )}

        <Button variant="ghost" block onClick={onCancel}>
          Voltar ao início
        </Button>
      </form>
    </Modal>
  );
};
