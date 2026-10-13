import React, { useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { getOrCreateGuestRecoveryCode, syncGuestAccount, recoverGuestAccount, getGuestRooms } from '../utils/guestStorage';
import { Button, ErrorText, Field, Modal, Segmented, inputClass } from './ui';
import type { UserRoom } from '../types';

interface GuestRecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentNickname: string;
  onRecoverSuccess: (recovered: { nickname: string; rooms: UserRoom[] }) => void;
}

type Tab = 'my_code' | 'restore';

/**
 * Código de convidado: leva apelido e servidores para outro aparelho sem conta.
 * Os chamadores montam o modal só quando aberto, então o estado inicial vale para cada abertura.
 */
export const GuestRecoveryModal: React.FC<GuestRecoveryModalProps> = ({ isOpen, onClose, currentNickname, onRecoverSuccess }) => {
  const [tab, setTab] = useState<Tab>('my_code');
  const [recoveryCode, setRecoveryCode] = useState(() => getOrCreateGuestRecoveryCode());
  const [copied, setCopied] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [inputCode, setInputCode] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(recoveryCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncStatus(null);
    const ok = await syncGuestAccount(currentNickname);
    setIsSyncing(false);
    setSyncStatus(ok ? { ok, text: 'Apelido e servidores salvos.' } : { ok, text: 'Não foi possível salvar. Verifique sua conexão.' });
  };

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputCode.trim().toUpperCase();
    if (!clean) {
      setRestoreError('Digite o código de convidado.');
      return;
    }
    setIsRestoring(true);
    setRestoreError(null);
    setRestoreSuccess(null);
    const res = await recoverGuestAccount(clean);
    setIsRestoring(false);

    if (res.success && res.nickname) {
      const rooms = res.rooms || getGuestRooms();
      setRestoreSuccess(`Pronto! "${res.nickname}" e ${rooms.length} servidor(es) recuperados.`);
      setRecoveryCode(res.recoveryCode || clean);
      onRecoverSuccess({ nickname: res.nickname, rooms });
      setTimeout(onClose, 1500);
    } else {
      setRestoreError(res.error || 'Código não encontrado. Confira e tente de novo.');
    }
  };

  const savedRooms = getGuestRooms().length;

  return (
    <Modal open={isOpen} onClose={onClose} title="Código de convidado" className="max-w-md">
      <div className="space-y-4">
        <Segmented
          ariaLabel="Opções do código de convidado"
          options={[
            { value: 'my_code', label: 'Meu código' },
            { value: 'restore', label: 'Recuperar' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'my_code' ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Use este código em outro aparelho para levar seu apelido e {savedRooms} servidor(es) salvo(s).
            </p>
            <div className="flex items-center gap-2 bg-app border border-line rounded-xl pl-4 pr-1.5 py-1.5">
              <span className="flex-1 font-mono text-base tracking-wider">{recoveryCode}</span>
              <Button variant="ghost" onClick={handleCopy} aria-label="Copiar código">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="secondary" onClick={handleSync} disabled={isSyncing}>
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                Salvar agora
              </Button>
              {syncStatus && (
                <span className={`text-xs ${syncStatus.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{syncStatus.text}</span>
              )}
            </div>
            <p className="text-xs text-gray-500">Guarde o código: quem tiver ele pode usar seu apelido e seus servidores.</p>
          </div>
        ) : (
          <form onSubmit={handleRestore} className="space-y-4">
            <Field label="Código de convidado" htmlFor="recovery-code">
              <input
                id="recovery-code"
                autoFocus
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                placeholder="PNT-8B4K-19X2"
                className={`${inputClass} font-mono tracking-wider uppercase`}
              />
            </Field>
            <p className="text-xs text-gray-500">Os servidores salvos neste navegador serão substituídos pelos do código.</p>
            {restoreError && <ErrorText>{restoreError}</ErrorText>}
            {restoreSuccess && <p className="text-xs text-emerald-400">{restoreSuccess}</p>}
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={isRestoring}>
                {isRestoring ? 'Recuperando' : 'Recuperar'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
