import React, { useState } from 'react';
import { ArrowRight, RefreshCw, Wrench } from 'lucide-react';
import { Button, inputClass } from './ui';

interface MaintenanceScreenProps {
  message?: string;
  onRetry: () => void;
  isChecking?: boolean;
  onAdminBypass?: (bypassKey: string) => void;
}

/** Tela de manutenção: mensagem do servidor, tentar de novo e acesso discreto da equipe. */
export const MaintenanceScreen: React.FC<MaintenanceScreenProps> = ({
  message = 'Estamos fazendo melhorias. Voltamos em breve.',
  onRetry,
  isChecking = false,
  onAdminBypass,
}) => {
  const [showAdminInput, setShowAdminInput] = useState(false);
  const [bypassKey, setBypassKey] = useState('');

  const handleBypassSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (bypassKey.trim() && onAdminBypass) onAdminBypass(bypassKey.trim());
  };

  return (
    <div className="min-h-screen min-h-[100dvh] w-full bg-app text-gray-100 flex items-center justify-center p-6">
      <main className="w-full max-w-sm text-center">
        <span className="mx-auto w-14 h-14 rounded-2xl bg-surface border border-line flex items-center justify-center text-accent-text">
          <Wrench className="w-6 h-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight mt-5">Voltamos já</h1>
        <p className="text-sm text-gray-400 mt-2 leading-relaxed">{message}</p>

        <Button variant="primary" onClick={onRetry} disabled={isChecking} className="mt-6">
          <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
          {isChecking ? 'Verificando' : 'Tentar de novo'}
        </Button>

        {onAdminBypass && (
          <div className="mt-10">
            {!showAdminInput ? (
              <button
                type="button"
                onClick={() => setShowAdminInput(true)}
                className="text-xs text-gray-500 hover:text-gray-300 transition cursor-pointer"
              >
                Acesso da equipe
              </button>
            ) : (
              <form onSubmit={handleBypassSubmit} className="flex items-center gap-2">
                <input
                  type="password"
                  autoFocus
                  placeholder="Chave de acesso"
                  aria-label="Chave de acesso da equipe"
                  value={bypassKey}
                  onChange={(e) => setBypassKey(e.target.value)}
                  className={inputClass}
                />
                <Button type="submit" variant="secondary" aria-label="Entrar">
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </form>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
