import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, X, Zap, Cpu } from 'lucide-react';
import { SourcePicker } from './SourcePicker';
import { getObsSrtUrl } from '../utils/api';
import { getResolutionSize } from '../utils/streamProfile';
import {
  detectEncoders,
  listSources,
  toCaptureSource,
  type CaptureSources,
  type NativeCaptureConfig,
  type SourceChoice,
} from '../utils/desktop';
import type { VideoFrameRate, VideoResolution } from '../types';

interface NativeStreamModalProps {
  isOpen: boolean;
  roomName: string;
  userName: string;
  onClose: () => void;
  onStart: (config: NativeCaptureConfig) => void;
}

const RESOLUTIONS: VideoResolution[] = ['720p', '1080p', '1440p'];
const BITRATES = [3000, 4500, 6000, 8000, 12000];
// Mesma receita do guia do OBS: 1080p60 a 6 Mbps; o check-obs do servidor avisa acima de 8 Mbps.
const DEFAULT_BITRATE: Record<VideoResolution, Record<VideoFrameRate, number>> = {
  '720p': { 30: 3000, 60: 4500 },
  '1080p': { 30: 4500, 60: 6000 },
  '1440p': { 30: 8000, 60: 12000 },
  '4k': { 30: 12000, 60: 12000 },
};
const ENCODER_LABEL: Record<string, string> = {
  h264_nvenc: 'NVIDIA NVENC',
  h264_qsv: 'Intel Quick Sync',
  h264_amf: 'AMD AMF',
};
const OWN_WINDOW_TITLE = 'Põe na Tela!';

export const NativeStreamModal: React.FC<NativeStreamModalProps> = ({
  isOpen,
  roomName,
  userName,
  onClose,
  onStart,
}) => {
  const [sources, setSources] = useState<CaptureSources | null>(null);
  const [encoders, setEncoders] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<SourceChoice>('monitor:0');
  const [encoder, setEncoder] = useState('');
  const [resolution, setResolution] = useState<VideoResolution>('1080p');
  const [fps, setFps] = useState<VideoFrameRate>(60);
  const [bitrate, setBitrate] = useState(DEFAULT_BITRATE['1080p'][60]);
  const [systemAudio, setSystemAudio] = useState(true);

  const load = useCallback(async () => {
    try {
      const [src, enc] = await Promise.all([listSources(), detectEncoders()]);
      setLoadError(null);
      setSources(src);
      setEncoders(enc);
      setEncoder((current) => (enc.includes(current) ? current : (enc[0] ?? '')));
    } catch (err) {
      setLoadError(String(err));
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  // Referência estável: a sala re-renderiza a cada segundo e um objeto novo aqui reiniciaria a fila de miniaturas.
  const visibleSources = useMemo(
    () => sources && { ...sources, windows: sources.windows.filter((w) => w.title !== OWN_WINDOW_TITLE) },
    [sources],
  );

  if (!isOpen) return null;

  const pickQuality = (nextRes: VideoResolution, nextFps: VideoFrameRate) => {
    setResolution(nextRes);
    setFps(nextFps);
    setBitrate(DEFAULT_BITRATE[nextRes][nextFps]);
  };

  const handleStart = () => {
    const { width, height } = getResolutionSize(resolution);
    onStart({
      source: toCaptureSource(source),
      encoder,
      fps,
      width,
      height,
      bitrateKbps: bitrate,
      srtUrl: getObsSrtUrl(roomName, userName),
      systemAudio,
    });
    onClose();
  };

  const noEncoder = encoders !== null && encoders.length === 0;
  const canStart = !!sources && !!encoder && !loadError;

  const label = 'block font-medium text-xs text-gray-400 uppercase tracking-wider mb-2';
  const chip = (active: boolean) =>
    `px-3 py-2 rounded-xl border text-sm font-medium transition ${
      active
        ? 'bg-indigo-600 border-indigo-500 text-white'
        : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#13151f] border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden text-gray-200">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm sm:text-base">Transmissão Nativa (sem OBS)</h3>
              <p className="text-[11px] sm:text-xs text-gray-400">
                Captura direta + encoder da GPU, enviada por SRT como o OBS
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5 text-sm max-h-[75vh] overflow-y-auto">
          {loadError && (
            <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-rose-200 text-xs">
              Não foi possível ler as fontes de captura: {loadError}
            </div>
          )}
          {noEncoder && (
            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs">
              Nenhum encoder de GPU (NVENC, Quick Sync ou AMF) foi encontrado. Atualize o driver de vídeo.
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-xs text-gray-400 uppercase tracking-wider">O que transmitir</span>
              <button
                onClick={() => void load()}
                title="Atualizar telas, janelas e miniaturas"
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <SourcePicker sources={visibleSources} value={source} onChange={setSource} />
            <p className="mt-2 text-[11px] text-gray-500">
              Jogos em tela cheia exclusiva podem não aparecer: use o modo janela sem bordas.
            </p>
          </div>

          <div>
            <span className={label}>Qualidade</span>
            <div className="flex flex-wrap gap-2">
              {RESOLUTIONS.map((r) => (
                <button key={r} onClick={() => pickQuality(r, fps)} className={chip(resolution === r)}>
                  {r}
                </button>
              ))}
              <span className="w-px bg-white/10 mx-1" />
              {([60, 30] as VideoFrameRate[]).map((f) => (
                <button key={f} onClick={() => pickQuality(resolution, f)} className={chip(fps === f)}>
                  {f} FPS
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={label}>Bitrate (Mbps)</span>
            <div className="flex flex-wrap gap-2">
              {BITRATES.map((b) => (
                <button key={b} onClick={() => setBitrate(b)} className={chip(bitrate === b)}>
                  {b / 1000}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">
              Use 4,5 Mbps se o upload for fraco. Acima de 8 Mbps só com upload folgado.
            </p>
          </div>

          <div>
            <span className={label}>Encoder</span>
            <div className="flex flex-wrap gap-2">
              {(encoders ?? []).map((enc) => (
                <button
                  key={enc}
                  onClick={() => setEncoder(enc)}
                  className={`${chip(encoder === enc)} flex items-center gap-1.5`}
                >
                  <Cpu className="w-3.5 h-3.5" />
                  {ENCODER_LABEL[enc] ?? enc}
                </button>
              ))}
              {encoders === null && !loadError && <span className="text-xs text-gray-500">Detectando…</span>}
            </div>
          </div>

          <label className="flex items-center justify-between p-3.5 border border-white/10 bg-white/5 rounded-xl cursor-pointer">
            <div>
              <div className="font-medium text-white">Enviar áudio do sistema</div>
              <div className="text-xs text-gray-400">
                Som do jogo. Sua voz continua indo pelo chat de voz da sala.
              </div>
            </div>
            <input
              type="checkbox"
              checked={systemAudio}
              onChange={(e) => setSystemAudio(e.target.checked)}
              className="w-4 h-4 accent-indigo-500 cursor-pointer"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-white/10 bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 font-medium text-sm transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition"
          >
            Iniciar Transmissão
          </button>
        </div>
      </div>
    </div>
  );
};
