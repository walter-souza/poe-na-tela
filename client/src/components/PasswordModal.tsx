import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button, ErrorText, Field, Modal, inputClass } from './ui';

interface PasswordModalProps {
  isOpen: boolean;
  roomName: string;
  onClose: () => void;
  onConfirm: (passcode: string) => void;
  error?: string | null;
}

/** Pede a senha só quando o servidor exige. */
export const PasswordModal: React.FC<PasswordModalProps> = ({ isOpen, roomName, onClose, onConfirm, error }) => {
  const [passcode, setPasscode] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) return;
    onConfirm(passcode.trim());
  };

  return (
    <Modal open={isOpen} onClose={onClose} title="Servidor protegido" className="max-w-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-400">
          Digite a senha para entrar em <span className="text-gray-100 font-medium">{roomName}</span>.
        </p>
        <Field label="Senha" htmlFor="room-passcode">
          <div className="relative">
            <input
              id="room-passcode"
              autoFocus
              type={showPassword ? 'text' : 'password'}
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Senha do servidor"
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
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={!passcode.trim()}>
            Entrar
          </Button>
        </div>
      </form>
    </Modal>
  );
};
