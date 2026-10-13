import React, { useState } from 'react';
import { GoogleLoginButton } from './GoogleLoginButton';
import { Button, ErrorText, Field, Modal, Switch, inputClass } from './ui';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl } from '../utils/api';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRoomCreated: (roomSlug: string, passcode?: string) => void;
}

/** Nome do servidor -> identificador do link (sem acentos, só letras, números e hífen). */
function toSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** Criar servidor: nome com prévia do link, senha opcional. Exige conta Google. */
export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({ isOpen, onClose, onRoomCreated }) => {
  const { isAuthenticated, session } = useAuth();
  const [name, setName] = useState('');
  const [customSlug, setCustomSlug] = useState<string | null>(null);
  const [isEditingSlug, setIsEditingSlug] = useState(false);
  const [hasPasscode, setHasPasscode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = customSlug ?? toSlug(name);
  const inviteLink = `${window.location.origin}/?room=${slug || 'seu-servidor'}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Dê um nome ao servidor.');
      return;
    }
    if (!slug) {
      setError('O link precisa ter pelo menos uma letra ou número.');
      return;
    }
    if (hasPasscode && !passcode.trim()) {
      setError('Defina a senha ou desligue a proteção por senha.');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const token = session?.access_token;
      const res = await fetch(`${getApiBaseUrl()}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          slug,
          passcode: hasPasscode ? passcode.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível criar o servidor.');

      onRoomCreated(data.room.slug, hasPasscode ? passcode.trim() : undefined);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível criar o servidor.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <Modal open={isOpen} onClose={onClose} title="Criar servidor" className="max-w-sm">
        <div className="space-y-4 text-center">
          <p className="text-sm text-gray-400">
            Para criar um servidor com canais próprios, entre com sua conta Google. Assim ele fica guardado e só você
            gerencia os canais.
          </p>
          <div className="flex justify-center">
            <GoogleLoginButton size="large" shape="pill" theme="outline" />
          </div>
          <Button variant="ghost" block onClick={onClose}>
            Agora não
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={isOpen} onClose={onClose} title="Criar servidor" className="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Nome"
          htmlFor="room-name"
          hint={
            <>
              Link de convite: <span className="text-gray-300 break-all">{inviteLink}</span>{' '}
              {!isEditingSlug && (
                <button
                  type="button"
                  onClick={() => setIsEditingSlug(true)}
                  className="text-accent-text hover:underline cursor-pointer"
                >
                  Personalizar
                </button>
              )}
            </>
          }
        >
          <input
            id="room-name"
            autoFocus
            type="text"
            maxLength={48}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jogatina dos amigos"
            className={inputClass}
          />
        </Field>

        {isEditingSlug && (
          <Field label="Final do link" htmlFor="room-slug" hint="Só letras minúsculas, números e hífen.">
            <input
              id="room-slug"
              type="text"
              maxLength={32}
              value={slug}
              onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className={`${inputClass} font-mono`}
            />
          </Field>
        )}

        <div className="border-t border-line pt-2">
          <Switch
            checked={hasPasscode}
            onChange={setHasPasscode}
            label="Proteger com senha"
            description="Só entra quem souber a senha."
          />
          {hasPasscode && (
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Senha do servidor"
              aria-label="Senha do servidor"
              className={`${inputClass} mt-2`}
            />
          )}
        </div>

        <p className="text-xs text-gray-500">O servidor já vem com os canais #geral e Voz principal.</p>

        {error && <ErrorText>{error}</ErrorText>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isLoading}>
            {isLoading ? 'Criando' : 'Criar servidor'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
