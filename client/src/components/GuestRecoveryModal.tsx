import React, { useState, useEffect } from 'react';
import {
  X,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  Download,
  AlertCircle,
  ShieldCheck,
  Laptop,
} from 'lucide-react';
import {
  getOrCreateGuestRecoveryCode,
  syncGuestAccount,
  recoverGuestAccount,
  getGuestRooms,
} from '../utils/guestStorage';
import { GoogleLoginButton } from './GoogleLoginButton';
import type { UserRoom } from '../types';

interface GuestRecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentNickname: string;
  onRecoverSuccess: (recovered: { nickname: string; rooms: UserRoom[] }) => void;
}

export const GuestRecoveryModal: React.FC<GuestRecoveryModalProps> = ({
  isOpen,
  onClose,
  currentNickname,
  onRecoverSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'my_id' | 'restore'>('my_id');
  const [recoveryCode, setRecoveryCode] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Restore tab state
  const [inputCode, setInputCode] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const code = getOrCreateGuestRecoveryCode();
      setRecoveryCode(code);
      setSyncStatus(null);
      setRestoreError(null);
      setRestoreSuccess(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(recoveryCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncStatus(null);
    const ok = await syncGuestAccount(currentNickname);
    setIsSyncing(false);
    if (ok) {
      setSyncStatus('Servidores e apelido sincronizados na nuvem!');
      setTimeout(() => setSyncStatus(null), 3500);
    } else {
      setSyncStatus('Erro ao sincronizar. Verifique sua conexão.');
    }
  };

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputCode.trim().toUpperCase();
    if (!clean) {
      setRestoreError('Por favor, digite um código de recuperação.');
      return;
    }

    setIsRestoring(true);
    setRestoreError(null);
    setRestoreSuccess(null);

    const res = await recoverGuestAccount(clean);
    setIsRestoring(false);

    if (res.success && res.nickname) {
      const rooms = res.rooms || getGuestRooms();
      setRestoreSuccess(
        `Conta recuperada com sucesso! Apelido "${res.nickname}" e ${rooms.length} sala(s) restauradas.`
      );
      setRecoveryCode(res.recoveryCode || clean);
      onRecoverSuccess({
        nickname: res.nickname,
        rooms,
      });
      setTimeout(() => {
        onClose();
      }, 1800);
    } else {
      setRestoreError(res.error || 'Código de convidado não encontrado ou inválido.');
    }
  };

  const guestRoomsCount = getGuestRooms().length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-app border border-white/10 rounded-3xl p-6 sm:p-7 shadow-2xl relative overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow de Fundo */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-violet-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                Identificador de Convidado
              </h2>
              <p className="text-[11px] text-gray-400">
                Portabilidade e recuperação entre computadores
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs de Navegação */}
        <div className="flex bg-white/5 p-1 rounded-2xl my-4 border border-white/5 relative z-10">
          <button
            onClick={() => {
              setActiveTab('my_id');
              setRestoreError(null);
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-xl transition cursor-pointer ${
              activeTab === 'my_id'
                ? 'bg-indigo-600 text-on-accent shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Meu Código Atual
          </button>
          <button
            onClick={() => {
              setActiveTab('restore');
              setRestoreError(null);
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-xl transition cursor-pointer ${
              activeTab === 'restore'
                ? 'bg-indigo-600 text-on-accent shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Restaurar em Outro PC
          </button>
        </div>

        {/* Tab 1: Meu Código Atual */}
        {activeTab === 'my_id' && (
          <div className="space-y-4 relative z-10">
            <div>
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
                Seu Código de Recuperação
              </label>

              <div className="flex items-center justify-between bg-app border border-indigo-500/30 rounded-2xl px-4 py-3 group hover:border-indigo-500/50 transition">
                <span className="font-mono text-base font-bold tracking-widest text-indigo-300 select-all">
                  {recoveryCode}
                </span>

                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1.5 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Explicações */}
            <div className="space-y-2 bg-white/5 border border-white/5 rounded-2xl p-3.5 text-xs text-gray-300">
              <div className="flex items-start gap-2">
                <Laptop className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed text-gray-300">
                  Guarde este código para restaurar seu apelido e suas{' '}
                  <strong className="text-white">{guestRoomsCount} sala(s) salvas</strong> em
                  qualquer outro navegador ou computador.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed text-gray-300">
                  Suas salas são sincronizadas com segurança na nuvem sempre que você entra ou aceita
                  convites.
                </p>
              </div>
            </div>

            {/* Ação de sincronização manual */}
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={handleManualSync}
                disabled={isSyncing}
                className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white font-medium py-2.5 rounded-xl text-xs transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar Salas na Nuvem Agora'}</span>
              </button>

              {syncStatus && (
                <p className="text-[11px] text-center text-emerald-400 font-medium animate-in fade-in">
                  {syncStatus}
                </p>
              )}
            </div>

            {/* Banner de Migração Permanente para o Google */}
            <div className="bg-indigo-950/40 border border-indigo-500/20 rounded-2xl p-3 flex items-center justify-between gap-2.5 mt-2">
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-white leading-tight">Salvar com o Google</p>
                <p className="text-[10px] text-gray-400">Vincule em 1 clique e dispense o código.</p>
              </div>
              <div className="shrink-0">
                <GoogleLoginButton size="small" shape="pill" theme="outline" />
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Restaurar em Outro PC */}
        {activeTab === 'restore' && (
          <form onSubmit={handleRestore} className="space-y-4 relative z-10">
            <div>
              <label
                htmlFor="restore-code-input"
                className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5"
              >
                Código do Convidado
              </label>
              <input
                id="restore-code-input"
                type="text"
                placeholder="Ex: PNT-8B4K-19X2"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                autoFocus
                className="w-full bg-app border border-white/15 rounded-2xl px-4 py-3 text-sm font-mono tracking-wider text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition uppercase"
              />
            </div>

            <p className="text-[11px] text-gray-400 leading-relaxed">
              Cole o código gerado no outro dispositivo para importar imediatamente todos os seus
              servidores e preferências.
            </p>

            {restoreError && (
              <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{restoreError}</span>
              </div>
            )}

            {restoreSuccess && (
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300">
                <Check className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>{restoreSuccess}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isRestoring || !inputCode.trim()}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 text-on-accent font-semibold py-3 rounded-2xl text-xs sm:text-sm shadow-lg shadow-indigo-600/30 transition cursor-pointer"
            >
              {isRestoring ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Buscando Servidores...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Restaurar Servidores & Apelido</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
