import React, { useEffect, useState } from 'react';
import { ArrowRight, KeyRound, Link2, Lock, LogOut, Plus, Radio, Users } from 'lucide-react';
import { GoogleLoginButton } from './GoogleLoginButton';
import { GuestRecoveryModal } from './GuestRecoveryModal';
import { Button, inputClass } from './ui';
import { useAuth } from '../context/AuthContext';
import { parseRoomInput, sanitizeUserName } from '../utils/sanitize';
import { getRoomsUrl } from '../utils/api';
import { usePreference, userNamePref } from '../utils/preferences';
import type { UserRoom } from '../types';

interface LobbyProps {
  /** Servidores da conta e os salvos como convidado. */
  rooms: UserRoom[];
  onOpenRoom: (slug: string) => void;
  /** Abre o convite (nome, senha se houver) para o servidor informado. */
  onOpenInvite: (slug: string) => void;
  onOpenCreateRoom: () => void;
  onGuestRecovered?: (recovered: { nickname: string; rooms: UserRoom[] }) => void;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export const Lobby: React.FC<LobbyProps> = ({ rooms, onOpenRoom, onOpenInvite, onOpenCreateRoom, onGuestRecovered }) => {
  const { profile, isAuthenticated, signOut } = useAuth();
  const guestName = usePreference(userNamePref);
  const [isGuestModalOpen, setIsGuestModalOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [voiceCounts, setVoiceCounts] = useState<Record<string, number>>({});

  const displayName = profile?.username || guestName;

  // Quantas pessoas estão na voz de cada servidor (o servidor cacheia por ~4s; polling só com a aba visível).
  useEffect(() => {
    if (rooms.length === 0) return;
    const load = async () => {
      try {
        const res = await fetch(getRoomsUrl());
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data.rooms)) return;
        const counts: Record<string, number> = {};
        for (const r of data.rooms) {
          const key = String(r.slug || r.name || '').toLowerCase();
          if (key) counts[key] = r.numParticipants || 0;
        }
        setVoiceCounts(counts);
      } catch {
        // Sem status ao vivo: os cartões continuam funcionando.
      }
    };
    load();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 15000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [rooms.length]);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = parseRoomInput(joinInput);
    if (!slug) {
      setJoinError('Cole um link de convite ou digite o nome do servidor.');
      return;
    }
    setJoinError(null);
    setJoinInput('');
    setIsJoinOpen(false);
    onOpenInvite(slug);
  };

  // Primeiro acesso: sem conta, sem apelido e sem servidores salvos.
  if (!isAuthenticated && !displayName && rooms.length === 0) {
    return (
      <>
        <WelcomeCard
          onContinue={(name) => userNamePref.set(name)}
          onRecover={() => setIsGuestModalOpen(true)}
        />
        {isGuestModalOpen && (
          <GuestRecoveryModal
            isOpen={isGuestModalOpen}
            onClose={() => setIsGuestModalOpen(false)}
            currentNickname="Convidado"
            onRecoverSuccess={(rec) => {
              userNamePref.set(rec.nickname);
              onGuestRecovered?.(rec);
            }}
          />
        )}
      </>
    );
  }

  const isGuestWithRooms = !isAuthenticated && rooms.length > 0;

  return (
    <div className="min-h-full bg-app text-gray-100 flex flex-col">
      {/* Barra superior */}
      <header className="flex items-center gap-3 px-4 sm:px-8 py-3 border-b border-line">
        <span className="flex items-center gap-2 font-semibold">
          <span className="w-7 h-7 rounded-lg bg-accent text-on-accent flex items-center justify-center">
            <Radio className="w-4 h-4" />
          </span>
          Põe na Tela
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isAuthenticated ? (
            <div className="flex items-center gap-2 bg-surface border border-line rounded-full pl-1 pr-1.5 py-1">
              <Avatar name={profile?.username || ''} url={profile?.avatar_url} />
              <span className="text-sm hidden sm:inline">{profile?.username}</span>
              <button
                type="button"
                onClick={() => signOut()}
                title="Sair da conta"
                aria-label="Sair da conta"
                className="p-1.5 rounded-full text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setIsGuestModalOpen(true)}
                title="Ver seu código de convidado ou recuperar servidores de outro aparelho"
                className="flex items-center gap-2 bg-surface border border-line rounded-full pl-1 pr-3 py-1 text-sm hover:border-gray-600 transition cursor-pointer"
              >
                <Avatar name={displayName} />
                <span className="hidden sm:inline">{displayName}</span>
                <KeyRound className="w-3.5 h-3.5 text-gray-400" />
              </button>
              <GoogleLoginButton size="medium" shape="pill" theme="outline" />
            </>
          )}
        </div>
      </header>

      <main className="w-full max-w-4xl mx-auto px-4 sm:px-8 py-8 sm:py-10 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting()}
          {displayName ? `, ${displayName}` : ''}
        </h1>
        <p className="text-sm text-gray-400 mt-1">Escolha um servidor ou crie um novo para chamar a galera.</p>

        <div className="flex flex-wrap gap-2 mt-5">
          <Button variant="primary" onClick={onOpenCreateRoom}>
            <Plus className="w-4 h-4" />
            Criar servidor
          </Button>
          <Button variant="secondary" onClick={() => setIsJoinOpen((open) => !open)} aria-expanded={isJoinOpen}>
            <Link2 className="w-4 h-4" />
            Entrar com link ou código
          </Button>
        </div>

        {isJoinOpen && (
          <form onSubmit={handleJoinSubmit} className="mt-3 flex flex-col sm:flex-row gap-2 max-w-xl">
            <input
              autoFocus
              type="text"
              value={joinInput}
              onChange={(e) => {
                setJoinInput(e.target.value);
                if (joinError) setJoinError(null);
              }}
              placeholder="poe-na-tela.vercel.app/?room=jogatina ou jogatina"
              aria-label="Link de convite ou nome do servidor"
              className={inputClass}
            />
            <Button type="submit" variant="primary">
              Continuar
              <ArrowRight className="w-4 h-4" />
            </Button>
          </form>
        )}
        {joinError && <p className="text-xs text-rose-400 mt-2">{joinError}</p>}

        {isGuestWithRooms && (
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3 bg-surface border border-line rounded-2xl p-4">
            <div className="flex-1">
              <p className="text-sm font-medium">Guarde seus servidores na sua conta</p>
              <p className="text-xs text-gray-400">
                Hoje eles ficam só neste navegador. Entre com o Google para acessá-los de qualquer aparelho.
              </p>
            </div>
            <GoogleLoginButton size="medium" shape="pill" theme="outline" />
          </div>
        )}

        <section className="mt-8">
          <h2 className="text-xs font-medium text-gray-400 mb-3">Seus servidores</h2>
          {rooms.length === 0 ? (
            <div className="border border-dashed border-line rounded-2xl p-8 text-center">
              <p className="text-sm font-medium">Você ainda não está em nenhum servidor</p>
              <p className="text-xs text-gray-400 mt-1">
                Crie o seu ou entre com o link que um amigo te mandou.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {rooms.map((room) => (
                <ServerCard
                  key={room.slug}
                  room={room}
                  voiceCount={voiceCounts[room.slug.toLowerCase()] || 0}
                  onOpen={() => onOpenRoom(room.slug)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {isGuestModalOpen && (
        <GuestRecoveryModal
          isOpen={isGuestModalOpen}
          onClose={() => setIsGuestModalOpen(false)}
          currentNickname={displayName || 'Convidado'}
          onRecoverSuccess={(rec) => {
            userNamePref.set(rec.nickname);
            onGuestRecovered?.(rec);
          }}
        />
      )}
    </div>
  );
};

const Avatar: React.FC<{ name: string; url?: string | null }> = ({ name, url }) =>
  url ? (
    <img src={url} alt="" className="w-7 h-7 rounded-full object-cover" />
  ) : (
    <span className="w-7 h-7 rounded-full bg-surface-2 border border-line text-xs font-semibold flex items-center justify-center">
      {name.charAt(0).toUpperCase() || '?'}
    </span>
  );

const ServerCard: React.FC<{ room: UserRoom; voiceCount: number; onOpen: () => void }> = ({ room, voiceCount, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="text-left bg-surface border border-line rounded-2xl p-4 hover:border-gray-600 transition cursor-pointer group"
  >
    <div className="flex items-center gap-3">
      <span className="w-10 h-10 rounded-xl bg-surface-2 border border-line flex items-center justify-center font-semibold">
        {room.name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate flex items-center gap-1.5">
          {room.name}
          {room.hasPasscode && <Lock className="w-3 h-3 text-gray-400" aria-label="Protegido por senha" />}
        </p>
        <p className="text-xs text-gray-400 flex items-center gap-1.5 mt-0.5">
          {voiceCount > 0 ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <Users className="w-3 h-3" />
              {voiceCount} na voz
            </>
          ) : (
            'Ninguém na voz'
          )}
        </p>
      </div>
      <span className="text-xs text-accent-text flex items-center gap-1 opacity-80 group-hover:opacity-100">
        Abrir
        <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </div>
  </button>
);

/** Primeiro acesso: entrar com Google ou escolher um apelido para continuar como convidado. */
const WelcomeCard: React.FC<{ onContinue: (name: string) => void; onRecover: () => void }> = ({ onContinue, onRecover }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeUserName(name);
    if (!clean) {
      setError('Escolha um apelido para seus amigos te reconhecerem.');
      return;
    }
    onContinue(clean);
  };

  return (
    <div className="min-h-full bg-app text-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface border border-line rounded-2xl p-6 sm:p-7">
        <div className="flex items-center gap-2 font-semibold mb-5">
          <span className="w-8 h-8 rounded-lg bg-accent text-on-accent flex items-center justify-center">
            <Radio className="w-4 h-4" />
          </span>
          Põe na Tela
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Assista e transmita com seus amigos</h1>
        <p className="text-sm text-gray-400 mt-1">Tela, jogo e voz em tempo real, direto do navegador.</p>

        <div className="mt-6 flex justify-center">
          <GoogleLoginButton size="large" shape="pill" theme="outline" />
        </div>

        <div className="flex items-center gap-3 my-5 text-xs text-gray-500">
          <span className="flex-1 h-px bg-line" />
          ou
          <span className="flex-1 h-px bg-line" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="welcome-name" className="block text-xs font-medium text-gray-400">
            Como seus amigos vão te chamar?
          </label>
          <input
            id="welcome-name"
            type="text"
            maxLength={32}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Seu apelido"
            className={inputClass}
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <Button type="submit" variant="secondary" block>
            Continuar como convidado
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>

        <button
          type="button"
          onClick={onRecover}
          className="block mx-auto mt-4 text-xs text-accent-text hover:underline cursor-pointer"
        >
          Já tem um código de convidado? Recuperar conta
        </button>
      </div>
    </div>
  );
};
