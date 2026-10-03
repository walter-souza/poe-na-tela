import React, { useState } from 'react';
import { Wrench, Sparkles, RefreshCw, Key, ArrowRight } from 'lucide-react';

interface MaintenanceScreenProps {
  message?: string;
  onRetry: () => void;
  isChecking?: boolean;
  onAdminBypass?: (bypassKey: string) => void;
}

export const MaintenanceScreen: React.FC<MaintenanceScreenProps> = ({
  message = 'Estamos realizando melhorias e otimizações de infraestrutura para melhorar a sua experiência de streaming. Voltaremos em breve!',
  onRetry,
  isChecking = false,
  onAdminBypass,
}) => {
  const [showAdminInput, setShowAdminInput] = useState(false);
  const [bypassKey, setBypassKey] = useState('');

  const handleBypassSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (bypassKey.trim() && onAdminBypass) {
      onAdminBypass(bypassKey.trim());
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#07080d] flex flex-col items-center justify-between p-4 sm:p-8 text-gray-100 relative overflow-hidden select-none">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[350px] h-[350px] bg-violet-600/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Top Bar Header */}
      <header className="w-full max-w-5xl flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-xl shadow-indigo-600/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              <span>Põe na Tela</span>
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 font-semibold px-2 py-0.5 rounded-md border border-indigo-500/30">
                Ultra-Baixa Latência
              </span>
            </h1>
            <p className="text-xs text-gray-400">Streaming de jogos em 60 FPS com amigos</p>
          </div>
        </div>

        {/* Live Status Badge */}
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold shadow-lg backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>Manutenção Programada</span>
        </div>
      </header>

      {/* Main Center Card */}
      <main className="w-full max-w-lg z-10 my-auto py-8 text-center animate-fade-in">
        {/* Animated Icon Container */}
        <div className="relative mx-auto w-24 h-24 mb-6 flex items-center justify-center">
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-indigo-600/30 to-violet-600/30 blur-xl animate-pulse" />
          <div className="w-24 h-24 rounded-3xl bg-[#11131c] border border-white/15 flex items-center justify-center shadow-2xl relative">
            <Wrench className="w-11 h-11 text-indigo-400 animate-bounce" />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-3">
          Voltamos em Breve
        </h2>

        {/* Message */}
        <p className="text-sm text-gray-300 leading-relaxed max-w-md mx-auto mb-8 font-normal">
          {message}
        </p>

        {/* Features list in progress */}
        <div className="bg-[#11131c]/90 border border-white/10 rounded-2xl p-4 mb-8 text-left space-y-2.5 backdrop-blur-md shadow-xl text-xs text-gray-300">
          <div className="flex items-center gap-2.5 text-gray-200 font-semibold border-b border-white/10 pb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>O que estamos aprimorando:</span>
          </div>
          <div className="flex items-center gap-2 text-gray-400">
            <span className="text-indigo-400 font-bold">•</span>
            <span>Otimização de servidores para menor latência em 60 FPS</span>
          </div>
          <div className="flex items-center gap-2 text-gray-400">
            <span className="text-indigo-400 font-bold">•</span>
            <span>Melhorias na estabilidade de transmissão de áudio e vídeo</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onRetry}
            disabled={isChecking}
            className="w-full sm:w-auto px-6 py-3.5 rounded-2xl font-bold text-xs bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-xl shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
            <span>{isChecking ? 'Verificando Status...' : 'Verificar Novamente'}</span>
          </button>
        </div>

        {/* Admin Bypass Toggle */}
        <div className="mt-8">
          {!showAdminInput ? (
            <button
              onClick={() => setShowAdminInput(true)}
              className="text-[11px] text-gray-500 hover:text-gray-300 transition flex items-center justify-center gap-1 mx-auto cursor-pointer"
            >
              <Key className="w-3 h-3" />
              <span>Acesso Administrativo</span>
            </button>
          ) : (
            <form onSubmit={handleBypassSubmit} className="max-w-xs mx-auto mt-2 flex items-center gap-2">
              <input
                type="password"
                placeholder="Chave de Acesso Admin"
                value={bypassKey}
                onChange={(e) => setBypassKey(e.target.value)}
                className="flex-1 bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                autoFocus
              />
              <button
                type="submit"
                className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow transition cursor-pointer"
                title="Acessar"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-gray-500 z-10">
        <span>© {new Date().getFullYear()} Põe na Tela. Todos os direitos reservados.</span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
          <span>Status: Manutenção de Rotina</span>
        </div>
      </footer>
    </div>
  );
};
