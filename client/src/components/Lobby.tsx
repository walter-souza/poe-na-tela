import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Tv,
  Lock,
  User,
  ArrowRight,
  Mic,
  Star,
  Plus,
  Trash2,
  Users,
  Play,
  Wand2,
} from 'lucide-react';
import { PasswordModal } from './PasswordModal';
import { sanitizeRoomName, sanitizeUserName } from '../utils/sanitize';
import type { FavoriteRoom, ActiveRoomInfo } from '../types';
import { getRoomsUrl, getRoomInfoUrl } from '../utils/api';
import { isNoiseSuppressionSupported, NoiseSuppressionProcessor } from '../utils/noiseSuppression';

interface LobbyProps {
  onJoin: (roomName: string, userName: string, isPublisher: boolean, passcode?: string) => void;
  isLoading: boolean;
  error?: string | null;
}

const USERNAME_STORAGE_KEY = 'poe-na-tela-username';
const FAVORITES_STORAGE_KEY = 'poe-na-tela-favorites';

export const Lobby: React.FC<LobbyProps> = ({ onJoin, isLoading, error }) => {
  const [roomName, setRoomName] = useState('');
  const [userName, setUserName] = useState(() => {
    return localStorage.getItem(USERNAME_STORAGE_KEY) || '';
  });
  const [passcode, setPasscode] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [isMicTesting, setIsMicTesting] = useState(false);

  // Favorites state
  const [favorites, setFavorites] = useState<FavoriteRoom[]>(() => {
    try {
      const saved = localStorage.getItem(FAVORITES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [newFavoriteInput, setNewFavoriteInput] = useState('');
  const [activeRooms, setActiveRooms] = useState<Record<string, ActiveRoomInfo>>({});
  const [passwordPromptRoom, setPasswordPromptRoom] = useState<string | null>(null);
  const [passwordModalError, setPasswordModalError] = useState<string | null>(null);
  const [isNoiseSuppressionEnabled, setIsNoiseSuppressionEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('poe-na-tela-noise-suppression') !== 'false';
    } catch {
      return true;
    }
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<NoiseSuppressionProcessor | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Fetch active rooms from backend API
  const fetchActiveRooms = async () => {
    try {
      const res = await fetch(getRoomsUrl());
      if (!res.ok) return;
      const data = await res.json();
      if (data.rooms && Array.isArray(data.rooms)) {
        const map: Record<string, ActiveRoomInfo> = {};
        data.rooms.forEach((r: any) => {
          map[r.name.toLowerCase()] = {
            name: r.name,
            numParticipants: r.numParticipants || 0,
            hasPasscode: Boolean(r.hasPasscode),
          };
        });
        setActiveRooms(map);
      }
    } catch {}
  };

  // Parse URL query params and initialize saved/random username & polling
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const passParam = params.get('pass');

    if (roomParam) setRoomName(roomParam);
    if (passParam) setPasscode(passParam);

    const savedName = localStorage.getItem(USERNAME_STORAGE_KEY);
    if (savedName && savedName.trim()) {
      setUserName(savedName.trim());
    } else if (!userName) {
      const randomGamers = ['GamerPro', 'PlayerOne', 'CyberKnight', 'PixelHero', 'Falcon', 'Shadow', 'Vortex', 'Neon'];
      const randomPick = randomGamers[Math.floor(Math.random() * randomGamers.length)] + Math.floor(Math.random() * 90 + 10);
      setUserName(randomPick);
      localStorage.setItem(USERNAME_STORAGE_KEY, randomPick);
    }

    fetchActiveRooms();
    const interval = setInterval(fetchActiveRooms, 8000);
    return () => clearInterval(interval);
  }, []);

  const saveFavorites = (updated: FavoriteRoom[]) => {
    setFavorites(updated);
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(updated));
  };

  const toggleFavoriteCurrentRoom = () => {
    const sanitized = sanitizeRoomName(roomName);
    if (!sanitized) return;
    const exists = favorites.some((f) => f.name.toLowerCase() === sanitized.toLowerCase());

    if (exists) {
      saveFavorites(favorites.filter((f) => f.name.toLowerCase() !== sanitized.toLowerCase()));
    } else {
      saveFavorites([...favorites, { name: sanitized, addedAt: Date.now() }]);
    }
  };

  const handleAddFavoriteInput = (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = sanitizeRoomName(newFavoriteInput);
    if (!sanitized) return;
    if (!favorites.some((f) => f.name.toLowerCase() === sanitized.toLowerCase())) {
      saveFavorites([...favorites, { name: sanitized, addedAt: Date.now() }]);
    }
    setNewFavoriteInput('');
  };

  const handleRemoveFavorite = (nameToRemove: string) => {
    saveFavorites(favorites.filter((f) => f.name.toLowerCase() !== nameToRemove.toLowerCase()));
  };

  // Quick join from favorites list
  const handleQuickJoinFavorite = async (favName: string) => {
    const sanitized = sanitizeRoomName(favName);
    const activeInfo = activeRooms[sanitized];

    if (activeInfo?.hasPasscode) {
      setPasswordPromptRoom(sanitized);
      return;
    }

    try {
      const res = await fetch(getRoomInfoUrl(sanitized));
      if (res.ok) {
        const info = await res.json();
        if (info.hasPasscode) {
          setPasswordPromptRoom(sanitized);
          return;
        }
      }
    } catch {}

    stopMicTest();
    const cleanUser = sanitizeUserName(userName) || 'Amigo';
    localStorage.setItem(USERNAME_STORAGE_KEY, cleanUser);
    onJoin(sanitized, cleanUser, true);
  };

  const handlePasswordConfirm = (pwd: string) => {
    if (!passwordPromptRoom) return;
    const targetRoom = sanitizeRoomName(passwordPromptRoom);
    setPasswordPromptRoom(null);
    setPasswordModalError(null);
    stopMicTest();
    const cleanUser = sanitizeUserName(userName) || 'Amigo';
    localStorage.setItem(USERNAME_STORAGE_KEY, cleanUser);
    onJoin(targetRoom, cleanUser, true, pwd.trim() || undefined);
  };

  const startMicTest = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      if (isNoiseSuppressionEnabled && isNoiseSuppressionSupported()) {
        try {
          const processor = new NoiseSuppressionProcessor();
          processorRef.current = processor;
          const mockTrack = stream.getAudioTracks()[0];
          await processor.init({
            kind: 'audio' as any,
            track: mockTrack,
            audioContext: audioCtx,
          });
          if (processor.processedTrack) {
            const processedStream = new MediaStream([processor.processedTrack]);
            const source = audioCtx.createMediaStreamSource(processedStream);
            source.connect(analyser);
          } else {
            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);
          }
        } catch (err) {
          console.warn('Microphone test noise suppression fallback:', err);
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);
        }
      } else {
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
      }

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
    if (processorRef.current) {
      processorRef.current.destroy().catch(() => {});
      processorRef.current = null;
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

  const toggleNoiseSuppressionInLobby = () => {
    const next = !isNoiseSuppressionEnabled;
    setIsNoiseSuppressionEnabled(next);
    localStorage.setItem('poe-na-tela-noise-suppression', String(next));
    if (isMicTesting) {
      stopMicTest();
      setTimeout(() => {
        startMicTest();
      }, 150);
    }
  };

  useEffect(() => {
    return () => stopMicTest();
  }, []);

  const handleUserNameChange = (val: string) => {
    setUserName(val);
    if (val.trim()) {
      localStorage.setItem(USERNAME_STORAGE_KEY, val.trim());
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanRoom = sanitizeRoomName(roomName);
    const cleanUser = sanitizeUserName(userName);
    if (!cleanRoom || !cleanUser) return;
    localStorage.setItem(USERNAME_STORAGE_KEY, cleanUser);
    stopMicTest();
    onJoin(cleanRoom, cleanUser, true, passcode.trim() || undefined);
  };

  const isCurrentRoomFavorited = roomName.trim()
    ? favorites.some((f) => f.name.toLowerCase() === sanitizeRoomName(roomName).toLowerCase())
    : false;

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#090a0f] text-gray-100 flex flex-col justify-start lg:justify-center items-center p-3.5 sm:p-6 py-6 sm:py-8 lg:py-6 relative overflow-x-hidden overflow-y-auto lg:overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header Branding */}
      <div className="w-full max-w-5xl text-center mb-5 sm:mb-6 z-10">
        <div className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-xl shadow-indigo-600/30 mb-2.5 sm:mb-3 glow-active">
          <Sparkles className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
        </div>
        <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight">Põe na Tela!</h1>
        <p className="text-xs sm:text-sm text-gray-400 mt-1 max-w-md mx-auto">
          Põe na tela, comandante! Transmissão de tela para amigos com ultra-baixa latência
        </p>
      </div>

      {/* Main Container Grid (Standardized Fixed Height Layout) */}
      <div className="w-full max-w-5xl relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start pb-8 lg:pb-0">
        {/* Left Side: Room Entry Form (7 cols - Standard Fixed Height) */}
        <div className="lg:col-span-7 bg-[#11131a]/90 backdrop-blur-xl border border-white/10 rounded-3xl p-5 sm:p-7 shadow-2xl flex flex-col justify-between lg:h-[510px]">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2 mb-2">
              <span className="font-bold">Erro:</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5 flex-1 flex flex-col justify-between">
            {/* Room Name Input with Favorite Star Toggle */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                Nome da Sala / Canal
              </label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  required
                  placeholder="ex: jogatina-da-noite"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-4 pr-20 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <div className="absolute right-2 flex items-center gap-1">
                  {roomName.trim() && (
                    <button
                      type="button"
                      onClick={toggleFavoriteCurrentRoom}
                      title={isCurrentRoomFavorited ? 'Remover dos Favoritos' : 'Salvar nos Favoritos'}
                      className={`p-1.5 rounded-lg transition cursor-pointer ${
                        isCurrentRoomFavorited
                          ? 'text-amber-400 bg-amber-400/10 hover:bg-amber-400/20'
                          : 'text-gray-500 hover:text-amber-400 hover:bg-white/5'
                      }`}
                    >
                      <Star className={`w-4 h-4 ${isCurrentRoomFavorited ? 'fill-amber-400' : ''}`} />
                    </button>
                  )}
                  <div className="p-1.5 text-gray-500 pointer-events-none">
                    <Tv className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </div>

            {/* Display Name */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                Seu Nome de Exibição
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="Seu nome ou nick"
                  value={userName}
                  onChange={(e) => handleUserNameChange(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <User className="w-4 h-4 text-gray-500 absolute right-3.5 top-3" />
              </div>
            </div>

            {/* Passcode (Optional) */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                Senha da Sala (Opcional)
              </label>
              <div className="relative">
                <input
                  type="password"
                  placeholder="Deixe em branco para sala aberta"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                />
                <Lock className="w-4 h-4 text-gray-500 absolute right-3.5 top-3" />
              </div>
            </div>

            {/* Mic Test & Noise Suppression */}
            <div className="p-2.5 bg-white/5 rounded-2xl border border-white/5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400 flex items-center gap-1.5 font-medium">
                  <Mic className="w-3.5 h-3.5 text-indigo-400" />
                  Teste de Microfone
                </span>
                <button
                  type="button"
                  onClick={isMicTesting ? stopMicTest : startMicTest}
                  className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
                >
                  {isMicTesting ? 'Parar Teste' : 'Testar Voz'}
                </button>
              </div>

              {isMicTesting && (
                <div className="w-full bg-black/50 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-75"
                    style={{ width: `${micLevel}%` }}
                  />
                </div>
              )}

              {/* Noise Suppression Toggle */}
              <div className="pt-1.5 border-t border-white/5 flex items-center justify-between text-xs">
                <span className="text-gray-400 flex items-center gap-1.5 font-medium">
                  <Wand2 className="w-3.5 h-3.5 text-violet-400" />
                  Supressão de Ruído (IA)
                </span>
                <button
                  type="button"
                  onClick={toggleNoiseSuppressionInLobby}
                  title="Elimina ruído de teclado mecânico, cliques e ruído de fundo"
                  className={`text-[11px] px-2.5 py-0.5 rounded-md font-semibold transition cursor-pointer flex items-center gap-1 ${
                    isNoiseSuppressionEnabled
                      ? 'bg-violet-600/30 text-violet-300 border border-violet-500/40 shadow-sm shadow-violet-500/20'
                      : 'bg-white/5 text-gray-400 border border-white/10 hover:text-white'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isNoiseSuppressionEnabled ? 'bg-violet-400 animate-pulse' : 'bg-gray-500'}`} />
                  {isNoiseSuppressionEnabled ? 'Ativada' : 'Desativada'}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || !roomName.trim() || !userName.trim()}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2 group cursor-pointer"
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

          {/* Tech Badges */}
          <div className="pt-3 border-t border-white/10 grid grid-cols-3 gap-1.5 sm:gap-2 text-center text-[10px] sm:text-[11px] text-gray-400 mt-2">
            <div className="p-1 sm:p-1.5 bg-white/5 rounded-lg border border-white/5">
              <span className="font-bold text-indigo-300 block">WebRTC SFU</span>
              <span>&lt;200ms</span>
            </div>
            <div className="p-1 sm:p-1.5 bg-white/5 rounded-lg border border-white/5">
              <span className="font-bold text-emerald-300 block">60 FPS</span>
              <span>Hardware</span>
            </div>
            <div className="p-1 sm:p-1.5 bg-white/5 rounded-lg border border-white/5">
              <span className="font-bold text-purple-300 block">Stereo Loop</span>
              <span>Som do Jogo</span>
            </div>
          </div>
        </div>

        {/* Right Side: Favorites List (5 cols - Standard Fixed Height Matching Left) */}
        <div className="lg:col-span-5 bg-[#11131a]/90 backdrop-blur-xl border border-white/10 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col lg:h-[510px] space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl">
                <Star className="w-4 h-4 fill-amber-400" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Salas Favoritas</h3>
                <p className="text-[11px] text-gray-400">Acesso rápido com status ao vivo</p>
              </div>
            </div>
            <span className="text-xs bg-white/10 text-gray-300 px-2 py-0.5 rounded-full font-semibold">
              {favorites.length}
            </span>
          </div>

          {/* Quick Add Favorite Input */}
          <form onSubmit={handleAddFavoriteInput} className="flex gap-2 flex-shrink-0">
            <input
              type="text"
              placeholder="Adicionar sala favorita..."
              value={newFavoriteInput}
              onChange={(e) => setNewFavoriteInput(e.target.value)}
              className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
            />
            <button
              type="submit"
              disabled={!newFavoriteInput.trim()}
              className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl transition shadow cursor-pointer"
              title="Salvar sala favorita"
            >
              <Plus className="w-4 h-4" />
            </button>
          </form>

          {/* Favorites List Items (Fills the remaining area in standard height card with internal scroll) */}
          <div className="flex-1 min-h-[140px] max-h-[320px] lg:max-h-none min-h-0 space-y-2.5 overflow-y-auto pr-1">
            {favorites.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-xs border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center space-y-2">
                <Star className="w-8 h-8 text-amber-500/30 stroke-1" />
                <p className="font-medium text-gray-400">Nenhuma sala salva ainda</p>
                <p className="text-[11px] leading-relaxed max-w-xs text-gray-500">
                  Digite o nome de uma sala e clique na estrela ⭐ para fixá-la nesta lista.
                </p>
              </div>
            ) : (
              favorites.map((fav) => {
                const activeInfo = activeRooms[fav.name.toLowerCase()];
                const isLive = Boolean(activeInfo && activeInfo.numParticipants > 0);
                const hasPasscode = Boolean(activeInfo?.hasPasscode);

                return (
                  <div
                    key={fav.name}
                    className={`p-3 rounded-2xl border transition-all flex items-center justify-between group ${
                      isLive
                        ? 'bg-gradient-to-r from-emerald-950/20 to-black/40 border-emerald-500/40 hover:border-emerald-500 shadow-sm'
                        : 'bg-white/5 border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-white truncate group-hover:text-indigo-300 transition">
                          {fav.name}
                        </span>
                        {hasPasscode && (
                          <span title="Protegida por senha" className="text-amber-400 flex-shrink-0">
                            <Lock className="w-3 h-3" />
                          </span>
                        )}
                      </div>

                      {/* Status indicator */}
                      <div className="flex items-center gap-2 mt-1">
                        {isLive ? (
                          <div className="flex items-center gap-1.5">
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                              AO VIVO
                            </span>
                            <span className="text-[10px] text-gray-400 flex items-center gap-0.5 ml-1">
                              <Users className="w-3 h-3 text-gray-400" />
                              <span>{activeInfo.numParticipants}</span>
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-gray-500 text-[10px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                            <span>Offline</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleQuickJoinFavorite(fav.name)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow ${
                          isLive
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                            : 'bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-300 hover:text-white'
                        }`}
                        title="Entrar nesta sala"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Entrar</span>
                      </button>

                      <button
                        onClick={() => handleRemoveFavorite(fav.name)}
                        className="p-1.5 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition cursor-pointer"
                        title="Remover dos favoritos"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Password Prompt Modal */}
      <PasswordModal
        isOpen={Boolean(passwordPromptRoom)}
        roomName={passwordPromptRoom || ''}
        onClose={() => {
          setPasswordPromptRoom(null);
          setPasswordModalError(null);
        }}
        onConfirm={handlePasswordConfirm}
        error={passwordModalError}
      />
    </div>
  );
};
