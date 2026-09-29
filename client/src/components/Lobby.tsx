import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Tv,
  Lock,
  User,
  ArrowRight,
  Mic,
} from 'lucide-react';

interface LobbyProps {
  onJoin: (roomName: string, userName: string, isPublisher: boolean, passcode?: string) => void;
  isLoading: boolean;
  error?: string | null;
}

export const Lobby: React.FC<LobbyProps> = ({ onJoin, isLoading, error }) => {
  const [roomName, setRoomName] = useState('');
  const [userName, setUserName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [isPublisher, setIsPublisher] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [isMicTesting, setIsMicTesting] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Parse URL query params for easy friend invite link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const passParam = params.get('pass');
    const roleParam = params.get('role');

    if (roomParam) setRoomName(roomParam);
    if (passParam) setPasscode(passParam);
    if (roleParam === 'viewer') setIsPublisher(false);

    const randomGamers = ['GamerPro', 'PlayerOne', 'CyberKnight', 'PixelHero', 'Falcon', 'Shadow', 'Vortex', 'Neon'];
    const randomPick = randomGamers[Math.floor(Math.random() * randomGamers.length)] + Math.floor(Math.random() * 90 + 10);
    setUserName(randomPick);
  }, []);

  const startMicTest = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        setMicLevel(Math.min(100, Math.round((average / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };

      setIsMicTesting(true);
      updateLevel();
    } catch (e) {
      console.warn('Microphone permission denied or unavailable', e);
    }
  };

  const stopMicTest = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
    }
    setIsMicTesting(false);
    setMicLevel(0);
  };

  useEffect(() => {
    return () => stopMicTest();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim() || !userName.trim()) return;
    stopMicTest();
    onJoin(roomName.trim(), userName.trim(), isPublisher, passcode.trim() || undefined);
  };

  return (
    <div className="min-h-screen bg-[#090a0f] text-gray-100 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-xl shadow-indigo-600/30 mb-4 glow-active">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">Põe na Tela!</h1>
          <p className="text-sm text-gray-400 mt-1">
            Põe na tela, comandante! Transmissão de jogos para amigos em 60 FPS com ultra-baixa latência
          </p>
        </div>

        <div className="bg-[#11131a]/90 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
              <span className="font-bold">Erro:</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Nome da Sala / Canal
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="ex: jogatina-da-noite"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <Tv className="w-4 h-4 text-gray-500 absolute right-3.5 top-3.5" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Seu Nome de Exibição
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="Seu nome ou nick"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <User className="w-4 h-4 text-gray-500 absolute right-3.5 top-3.5" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Senha da Sala (Opcional)
              </label>
              <div className="relative">
                <input
                  type="password"
                  placeholder="Deixe em branco para sala aberta"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <Lock className="w-4 h-4 text-gray-500 absolute right-3.5 top-3.5" />
              </div>
            </div>

            <div className="pt-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Seu Objetivo
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setIsPublisher(true)}
                  className={`p-3 rounded-xl border text-left transition ${
                    isPublisher
                      ? 'bg-indigo-600/30 border-indigo-500 text-white'
                      : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
                  }`}
                >
                  <div className="font-semibold text-xs text-white">Vou Transmitir</div>
                  <div className="text-[11px] text-gray-400">Compartilhar tela / jogo</div>
                </button>

                <button
                  type="button"
                  onClick={() => setIsPublisher(false)}
                  className={`p-3 rounded-xl border text-left transition ${
                    !isPublisher
                      ? 'bg-indigo-600/30 border-indigo-500 text-white'
                      : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
                  }`}
                >
                  <div className="font-semibold text-xs text-white">Vou Assistir</div>
                  <div className="text-[11px] text-gray-400">Apenas assistir e conversar</div>
                </button>
              </div>
            </div>

            <div className="p-3 bg-white/5 rounded-2xl border border-white/5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400 flex items-center gap-1.5 font-medium">
                  <Mic className="w-3.5 h-3.5 text-indigo-400" />
                  Teste de Microfone
                </span>
                <button
                  type="button"
                  onClick={isMicTesting ? stopMicTest : startMicTest}
                  className="text-indigo-400 hover:text-indigo-300 font-semibold"
                >
                  {isMicTesting ? 'Parar Teste' : 'Testar Voz'}
                </button>
              </div>

              {isMicTesting && (
                <div className="w-full bg-black/50 h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-75"
                    style={{ width: `${micLevel}%` }}
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || !roomName.trim() || !userName.trim()}
              className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2 group cursor-pointer"
            >
              {isLoading ? (
                <span>Conectando à sala...</span>
              ) : (
                <>
                  <span>Entrar na Sala</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-white/10 grid grid-cols-3 gap-2 text-center text-[11px] text-gray-400">
            <div className="p-1.5 bg-white/5 rounded-lg border border-white/5">
              <span className="font-bold text-indigo-300 block">WebRTC SFU</span>
              <span>&lt;200ms Latência</span>
            </div>
            <div className="p-1.5 bg-white/5 rounded-lg border border-white/5">
              <span className="font-bold text-emerald-300 block">60 FPS Crisp</span>
              <span>Hardware Accel</span>
            </div>
            <div className="p-1.5 bg-white/5 rounded-lg border border-white/5">
              <span className="font-bold text-purple-300 block">Stereo Loop</span>
              <span>Som do Jogo</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
