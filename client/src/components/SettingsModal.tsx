import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, LogOut, Mic, Palette, User } from 'lucide-react';
import { GoogleLoginButton } from './GoogleLoginButton';
import { GuestRecoveryModal } from './GuestRecoveryModal';
import { Button, Field, Modal, Segmented, Switch, inputClass } from './ui';
import { useAuth } from '../context/AuthContext';
import { useTheme, type ThemePreference } from '../hooks/useTheme';
import {
  micDevicePref,
  noiseSuppressionPref,
  roomLayoutPref,
  usePreference,
  userNamePref,
  type RoomLayout,
} from '../utils/preferences';
import { isNoiseSuppressionSupported, NoiseSuppressionProcessor } from '../utils/noiseSuppression';
import { sanitizeUserName } from '../utils/sanitize';
import type { UserRoom } from '../types';

type Section = 'audio' | 'appearance' | 'account';

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: 'audio', label: 'Áudio', icon: Mic },
  { id: 'appearance', label: 'Aparência', icon: Palette },
  { id: 'account', label: 'Conta', icon: User },
];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onGuestRecovered?: (recovered: { nickname: string; rooms: UserRoom[] }) => void;
}

/** Ajustes: microfone, teste de voz, supressão de ruído, tema e conta. */
export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose, onGuestRecovered }) => {
  const [section, setSection] = useState<Section>('audio');

  return (
    <Modal open={open} onClose={onClose} title="Ajustes" className="max-w-2xl">
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 min-h-[340px]">
        <nav aria-label="Seções de ajustes" className="flex sm:flex-col gap-1 sm:w-40 shrink-0">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={section === id ? 'page' : undefined}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition cursor-pointer ${
                section === id ? 'bg-surface-2 text-gray-100' : 'text-gray-400 hover:text-gray-100 hover:bg-white/5'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0">
          {section === 'audio' && <AudioSection active={open} />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'account' && <AccountSection onDone={onClose} onGuestRecovered={onGuestRecovered} />}
        </div>
      </div>
    </Modal>
  );
};

/** Lista os microfones; os nomes só aparecem depois que o navegador libera o acesso. */
function useMicrophones(): { devices: MediaDeviceInfo[]; refresh: () => void } {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const refresh = useCallback(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')))
      .catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh);
  }, [refresh]);

  return { devices, refresh };
}

const AudioSection: React.FC<{ active: boolean }> = ({ active }) => {
  const micDeviceId = usePreference(micDevicePref);
  const noiseSuppression = usePreference(noiseSuppressionPref);
  const { devices, refresh } = useMicrophones();
  const [level, setLevel] = useState(0);
  const [isTesting, setIsTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<NoiseSuppressionProcessor | null>(null);
  const frameRef = useRef<number | null>(null);

  const stopTest = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    processorRef.current?.destroy().catch(() => {});
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (contextRef.current && contextRef.current.state !== 'closed') contextRef.current.close().catch(() => {});
    contextRef.current = null;
    setIsTesting(false);
    setLevel(0);
  }, []);

  const startTest = useCallback(async () => {
    setTestError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micDevicePref.get() ? { deviceId: { exact: micDevicePref.get() } } : true,
      });
      streamRef.current = stream;
      refresh(); // com a permissão concedida, os microfones passam a ter nome

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AudioCtx({ sampleRate: 48000 });
      contextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      let source: MediaStream = stream;
      if (noiseSuppressionPref.get() && isNoiseSuppressionSupported()) {
        try {
          const processor = new NoiseSuppressionProcessor();
          processorRef.current = processor;
          await processor.init({ kind: 'audio' as any, track: stream.getAudioTracks()[0], audioContext: ctx });
          if (processor.processedTrack) source = new MediaStream([processor.processedTrack]);
        } catch (err) {
          console.warn('Teste de microfone sem supressão de ruído:', err);
        }
      }
      ctx.createMediaStreamSource(source).connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setLevel(Math.min(100, Math.round((sum / data.length / 128) * 100)));
        frameRef.current = requestAnimationFrame(tick);
      };
      setIsTesting(true);
      tick();
    } catch (err) {
      console.warn('Microfone indisponível:', err);
      setTestError('Não foi possível acessar o microfone. Verifique a permissão do navegador.');
      stopTest();
    }
  }, [refresh, stopTest]);

  // Para o teste ao fechar Ajustes ou sair da seção.
  useEffect(() => {
    if (!active) stopTest();
  }, [active, stopTest]);
  useEffect(() => stopTest, [stopTest]);

  // Trocar microfone ou supressão durante o teste reinicia o teste com a nova configuração.
  const restartIfTesting = () => {
    if (!isTesting) return;
    stopTest();
    setTimeout(() => void startTest(), 120);
  };

  const hasLabels = devices.some((d) => d.label);

  return (
    <div className="space-y-5">
      <Field
        label="Microfone"
        htmlFor="settings-mic"
        hint={!hasLabels && devices.length > 0 ? 'Clique em Testar para ver o nome dos microfones.' : undefined}
      >
        <div className="flex gap-2">
          <select
            id="settings-mic"
            value={micDeviceId}
            onChange={(e) => {
              micDevicePref.set(e.target.value);
              restartIfTesting();
            }}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="">Padrão do sistema</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microfone ${i + 1}`}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={isTesting ? stopTest : startTest} className="shrink-0">
            {isTesting ? 'Parar' : 'Testar'}
          </Button>
        </div>
      </Field>

      <div aria-label="Nível do microfone" className="h-2 rounded-full bg-surface-2 overflow-hidden">
        <div className="h-full bg-emerald-500 transition-[width] duration-75" style={{ width: `${level}%` }} />
      </div>
      {testError && <p className="text-xs text-rose-400">{testError}</p>}

      <div className="border-t border-line pt-3">
        <Switch
          checked={noiseSuppression}
          onChange={(next) => {
            noiseSuppressionPref.set(next);
            restartIfTesting();
          }}
          disabled={!isNoiseSuppressionSupported()}
          label="Supressão de ruído (IA)"
          description={
            isNoiseSuppressionSupported()
              ? 'Remove teclado, ventilador e ruído de fundo. Vale também durante a chamada.'
              : 'Não disponível neste navegador.'
          }
        />
      </div>
    </div>
  );
};

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
];

const LAYOUT_OPTIONS: { value: RoomLayout; label: string }[] = [
  { value: 'palco', label: 'Palco' },
  { value: 'classico', label: 'Clássico' },
];

const AppearanceSection: React.FC = () => {
  const { preference, setPreference } = useTheme();
  const layout = usePreference(roomLayoutPref);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-400">Tema</p>
        <Segmented ariaLabel="Tema" options={THEME_OPTIONS} value={preference} onChange={setPreference} />
        <p className="text-xs text-gray-500">"Sistema" acompanha o modo claro ou escuro do seu computador.</p>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-400">Layout da sala</p>
        <Segmented ariaLabel="Layout da sala" options={LAYOUT_OPTIONS} value={layout} onChange={roomLayoutPref.set} />
        <p className="text-xs text-gray-500">
          {layout === 'palco'
            ? 'Vídeo em destaque; os canais ficam no seletor do topo.'
            : 'Lista de canais sempre visível à esquerda.'}
        </p>
      </div>
    </div>
  );
};

const AccountSection: React.FC<{
  onDone: () => void;
  onGuestRecovered?: SettingsModalProps['onGuestRecovered'];
}> = ({ onDone, onGuestRecovered }) => {
  const { profile, isAuthenticated, signOut, updateNickname } = useAuth();
  const storedName = usePreference(userNamePref);
  const [name, setName] = useState(storedName);
  const [saved, setSaved] = useState(false);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);

  if (isAuthenticated && profile) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover" />
          ) : (
            <span className="w-11 h-11 rounded-full bg-surface-2 border border-line flex items-center justify-center font-semibold">
              {profile.username.charAt(0).toUpperCase()}
            </span>
          )}
          <div>
            <p className="font-medium">{profile.username}</p>
            <p className="text-xs text-gray-400">Conta Google</p>
          </div>
        </div>
        <Button
          variant="danger"
          onClick={() => {
            onDone();
            void signOut();
          }}
        >
          <LogOut className="w-4 h-4" />
          Sair da conta
        </Button>
      </div>
    );
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeUserName(name);
    if (!clean) return;
    userNamePref.set(clean);
    if (profile) updateNickname(clean);
    setSaved(true);
  };

  return (
    <div className="space-y-5">
      <form onSubmit={save} className="space-y-2">
        <Field label="Seu apelido" htmlFor="settings-name">
          <div className="flex gap-2">
            <input
              id="settings-name"
              type="text"
              maxLength={32}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              placeholder="Como seus amigos te chamam"
              className={inputClass}
            />
            <Button type="submit" variant="secondary" disabled={!sanitizeUserName(name)} className="shrink-0">
              Salvar
            </Button>
          </div>
        </Field>
        {saved && <p className="text-xs text-emerald-400">Apelido salvo.</p>}
      </form>

      <div className="border-t border-line pt-4 space-y-3">
        <p className="text-sm">Você está como convidado</p>
        <p className="text-xs text-gray-400">
          Seus servidores ficam neste navegador. Use o código de convidado para levá-los a outro aparelho, ou entre
          com o Google para guardá-los na conta.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setIsRecoveryOpen(true)}>
            <KeyRound className="w-4 h-4" />
            Código de convidado
          </Button>
          <GoogleLoginButton size="medium" shape="pill" theme="outline" />
        </div>
      </div>

      {isRecoveryOpen && (
        <GuestRecoveryModal
          isOpen={isRecoveryOpen}
          onClose={() => setIsRecoveryOpen(false)}
          currentNickname={storedName || 'Convidado'}
          onRecoverSuccess={(rec) => {
            userNamePref.set(rec.nickname);
            setName(rec.nickname);
            onGuestRecovered?.(rec);
          }}
        />
      )}
    </div>
  );
};
