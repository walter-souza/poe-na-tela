import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, Lock, Mic, Plus, Star, Trash2, Users } from 'lucide-react';
import { PasswordModal } from './PasswordModal';
import { Logo } from './Logo';
import { PointerBackground } from './PointerBackground';
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


// Miniatura gerada a partir do nome da sala: cada canal ganha sempre as mesmas cores.
const SCENES: Array<[string, string, string, string]> = [
  ['#0c3a3f', '#1f8a82', '#f0a24c', '#ffe08a'],
  ['#3a1408', '#c2501f', '#f5b83d', '#fff0b8'],
  ['#10264d', '#2f6fd1', '#8cc3ff', '#e8f3ff'],
];
const hashName = (name: string) => [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

const RoomScene: React.FC<{ name: string }> = ({ name }) => {
  const h = hashName(name);
  const p = SCENES[h % SCENES.length];
  const id = `scene-${h}`;
  return (
    <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" className="w-full h-full block transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-105" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p[0]} />
          <stop offset=".6" stopColor={p[1]} />
          <stop offset="1" stopColor={p[2]} />
        </linearGradient>
      </defs>
      <rect width="1600" height="1000" fill={`url(#${id})`} />
      <circle cx={900 + (h % 5) * 80} cy="560" r="115" fill={p[3]} />
      <polygon points="0,700 220,480 380,610 560,420 800,680 1000,540 1250,700 1600,500 1600,1000 0,1000" fill="#0003" />
      <polygon points="0,800 300,640 520,760 840,600 1180,790 1600,640 1600,1000 0,1000" fill="#0006" />
    </svg>
  );
};

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
      return localStorage.getItem('poe-na-tela-noise-suppression') === 'true';
    } catch {
      return false;
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


  const liveRooms = Object.values(activeRooms)
    .filter((r) => r.numParticipants > 0)
    .sort((a, b) => b.numParticipants - a.numParticipants)
    .slice(0, 4);
  const savedOffline = favorites.filter((f) => !(activeRooms[f.name.toLowerCase()]?.numParticipants > 0));
  const initial = (userName.trim()[0] || '?').toUpperCase();
  const fieldCls =
    'w-full h-[46px] px-3.5 bg-[#100f0d] border border-[#2c2a25] rounded-xl text-sm text-gray-100 placeholder-gray-600 hover:border-[#413e36] focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-400/15 transition';

  return (
    <div className="relative min-h-screen min-h-[100dvh] bg-[#100f0d] text-gray-100 overflow-x-hidden overflow-y-auto">
      <PointerBackground />

      <header className="relative z-10 flex items-center justify-between px-5 sm:px-8 lg:px-16 py-5">
        <Logo />
        <div className="flex items-center gap-2.5 pl-1.5 pr-4 py-1.5 rounded-full border border-[#2c2a25] bg-[#171613]/70 text-sm text-gray-400">
          <span className="grid place-items-center w-7 h-7 rounded-full bg-indigo-400 text-[#05201c] font-display font-semibold text-[13px]">
            {initial}
          </span>
          <span className="max-w-[140px] truncate">{userName || 'Convidado'}</span>
        </div>
      </header>

      <main className="relative z-10 grid grid-cols-1 lg:grid-cols-[5fr_6fr] gap-8 lg:gap-16 px-5 sm:px-8 lg:px-16 pt-2 pb-12 max-w-[1320px] mx-auto items-start">
        {/* Esquerda: entrada */}
        <section>
          <div className="inline-flex items-center gap-2 mb-4 pl-2.5 pr-3 py-1 rounded-full border border-live/25 bg-live/15 text-[13px] text-orange-200">
            <span className={`w-1.5 h-1.5 rounded-full bg-live ${liveRooms.length ? 'animate-pulse' : 'opacity-50'}`} />
            {liveRooms.length === 0
              ? 'Nenhuma sala ao vivo agora'
              : liveRooms.length === 1
                ? '1 sala ao vivo agora'
                : `${liveRooms.length} salas ao vivo agora`}
          </div>

          <h1 className="font-display font-semibold tracking-[-0.045em] leading-none text-[clamp(2.6rem,5.4vw,4.75rem)]">
            Põe na <span className="brand-frame">tela</span>
          </h1>
          <p className="mt-4 mb-7 max-w-[38ch] text-base text-gray-400">
            Seu jogo na tela dos amigos, com menos de 200 ms de atraso.
          </p>

          <form
            onSubmit={handleSubmit}
            className="grid gap-3.5 p-5 rounded-[18px] bg-[#171613] border border-[#2c2a25] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.04)]"
          >
            {error && (
              <div role="alert" className="px-3 py-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">
                <span className="font-semibold">Erro:</span> {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="grid gap-1.5 min-w-0">
                <span className="text-xs text-gray-400">Sala</span>
                <span className="relative block">
                  <input
                    type="text"
                    required
                    placeholder="jogatina-da-noite"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    autoComplete="off"
                    className={`${fieldCls} pr-11`}
                  />
                  {roomName.trim() && (
                    <button
                      type="button"
                      onClick={toggleFavoriteCurrentRoom}
                      title={isCurrentRoomFavorited ? 'Remover dos favoritos' : 'Salvar nos favoritos'}
                      aria-label={isCurrentRoomFavorited ? 'Remover dos favoritos' : 'Salvar nos favoritos'}
                      className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition cursor-pointer ${
                        isCurrentRoomFavorited ? 'text-violet-400' : 'text-gray-500 hover:text-violet-400'
                      }`}
                    >
                      <Star className={`w-4 h-4 ${isCurrentRoomFavorited ? 'fill-violet-400' : ''}`} />
                    </button>
                  )}
                </span>
              </label>
              <label className="grid gap-1.5 min-w-0">
                <span className="text-xs text-gray-400">Seu nome</span>
                <input
                  type="text"
                  required
                  placeholder="Seu nome ou nick"
                  value={userName}
                  onChange={(e) => handleUserNameChange(e.target.value)}
                  autoComplete="off"
                  className={fieldCls}
                />
              </label>
            </div>

            <label className="grid gap-1.5">
              <span className="text-xs text-gray-400">
                Senha da sala <em className="not-italic text-gray-600">(opcional)</em>
              </span>
              <span className="relative block">
                <input
                  type="password"
                  placeholder="Deixe vazio para sala aberta"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  autoComplete="off"
                  className={`${fieldCls} pr-10`}
                />
                <Lock className="w-4 h-4 text-gray-600 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </span>
            </label>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={isMicTesting ? stopMicTest : startMicTest}
                className={`inline-flex items-center gap-2.5 h-10 pl-3 pr-4 rounded-full border text-sm transition cursor-pointer ${
                  isMicTesting ? 'border-indigo-400 bg-[#201e1a]' : 'border-[#413e36] hover:border-indigo-400'
                }`}
              >
                <Mic className="w-[18px] h-[18px]" />
                <span
                  className="flex items-center gap-0.5 h-4 overflow-hidden transition-[width] duration-500 ease-[var(--ease-out)]"
                  style={{ width: isMicTesting ? 44 : 0 }}
                  aria-hidden="true"
                >
                  {[0.55, 0.85, 1, 0.7, 0.95, 0.6, 0.8].map((f, i) => (
                    <i
                      key={i}
                      className="block w-[3px] h-full rounded-sm bg-indigo-400 transition-transform duration-100"
                      style={{ transform: `scaleY(${Math.max(0.18, Math.min(1, (micLevel / 100) * f * 1.6))})` }}
                    />
                  ))}
                </span>
                {isMicTesting ? 'Ouvindo' : 'Testar microfone'}
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={isNoiseSuppressionEnabled}
                onClick={toggleNoiseSuppressionInLobby}
                title="Elimina ruído de teclado mecânico, cliques e ruído de fundo"
                className={`ml-auto inline-flex items-center gap-2 text-sm cursor-pointer ${
                  isNoiseSuppressionEnabled ? 'text-gray-100' : 'text-gray-400'
                }`}
              >
                <span className={`relative w-8 h-[19px] rounded-full transition-colors ${isNoiseSuppressionEnabled ? 'bg-emerald-400' : 'bg-[#413e36]'}`}>
                  <span
                    className={`absolute left-0.5 top-0.5 w-[15px] h-[15px] rounded-full transition-transform duration-300 ${
                      isNoiseSuppressionEnabled ? 'translate-x-[13px] bg-[#10200a]' : 'bg-gray-100'
                    }`}
                  />
                </span>
                Cortar ruído
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoading || !roomName.trim() || !userName.trim()}
              className="group h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-live hover:bg-[#ff7050] disabled:opacity-40 disabled:pointer-events-none text-[#1c0903] font-semibold transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(255,90,54,0.6)] active:scale-[0.98] cursor-pointer"
            >
              {isLoading ? (
                'Conectando à sala...'
              ) : (
                <>
                  Entrar na sala
                  <ArrowRight className="w-[18px] h-[18px] transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-gray-600">
            <span><b className="font-semibold text-indigo-400">&lt;200 ms</b> de latência</span>
            <span><b className="font-semibold text-violet-400">60 fps</b></span>
            <span><b className="font-semibold text-sky-400">Estéreo</b> som do jogo</span>
          </div>
        </section>

        {/* Direita: salas */}
        <aside aria-label="Salas">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display font-semibold text-lg tracking-tight">Ao vivo agora</h2>
            <span className="text-[13px] text-gray-400">
              {liveRooms.length} {liveRooms.length === 1 ? 'sala' : 'salas'}
            </span>
          </div>

          {liveRooms.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-[#413e36] px-5 py-10 text-center text-sm text-gray-400">
              Ninguém transmitindo agora. Escolha um nome de sala e seja o primeiro.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {liveRooms.map((room) => (
                <button
                  key={room.name}
                  type="button"
                  onClick={() => handleQuickJoinFavorite(room.name)}
                  className="room-tile group text-left rounded-[18px] overflow-hidden bg-[#171613] border border-[#2c2a25] cursor-pointer"
                >
                  <span className="relative block aspect-[16/10] overflow-hidden">
                    <RoomScene name={room.name} />
                    <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-[#100f0d]/75 backdrop-blur text-xs font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse" />
                      Ao vivo
                    </span>
                    <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-[#100f0d]/75 backdrop-blur text-xs font-medium">
                      {room.hasPasscode ? <Lock className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                      {room.numParticipants}
                    </span>
                  </span>
                  <span className="flex items-center gap-2.5 px-3.5 py-3">
                    <span className="min-w-0">
                      <span className="block font-display font-semibold text-base tracking-tight truncate">{room.name}</span>
                      <span className="block text-[12.5px] text-gray-400">
                        {room.numParticipants} {room.numParticipants === 1 ? 'pessoa' : 'pessoas'}
                      </span>
                    </span>
                    <span className="room-tile-go ml-auto grid place-items-center w-[34px] h-[34px] rounded-full border border-[#413e36] shrink-0">
                      <ArrowRight className="w-[18px] h-[18px]" />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-6">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-display font-semibold text-lg tracking-tight">Salas salvas</h2>
              <span className="text-[13px] text-gray-400">{favorites.length}</span>
            </div>

            {savedOffline.map((fav) => (
              <div key={fav.name} className="saved-row group">
                <button type="button" onClick={() => handleQuickJoinFavorite(fav.name)} className="saved-row-main cursor-pointer">
                  <span className="saved-dot" />
                  <span className="saved-name">{fav.name}</span>
                  <span className="saved-status">Fora do ar</span>
                  <span className="saved-go">
                    Abrir sala <ArrowRight className="w-[15px] h-[15px]" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveFavorite(fav.name)}
                  title="Remover dos favoritos"
                  aria-label={`Remover ${fav.name} dos favoritos`}
                  className="saved-remove cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}

            <form onSubmit={handleAddFavoriteInput} className="saved-add">
              <Plus className="w-[18px] h-[18px] shrink-0" />
              <input
                type="text"
                placeholder="Salvar uma sala"
                aria-label="Salvar uma sala"
                value={newFavoriteInput}
                onChange={(e) => setNewFavoriteInput(e.target.value)}
                autoComplete="off"
              />
            </form>
          </div>
        </aside>
      </main>

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
