import React, { useState } from 'react';
import { X, Tv, Copy, Check, Zap } from 'lucide-react';

interface ObsGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  obsUrl: string;
}

const STEPS: { title: string; items: string[] }[] = [
  {
    title: '1. Servidor de transmissão',
    items: [
      'Configurações → Transmissão → Serviço: "Personalizado".',
      'Cole o link acima no campo "Servidor". Deixe a "Chave de transmissão" vazia.',
    ],
  },
  {
    title: '2. Saída (modo Avançado)',
    items: [
      'Encoder: NVENC H.264 (placa NVIDIA) ou AMF/QuickSync. Evite x264 em jogos.',
      'Controle de taxa: CBR, bitrate 6000 Kbps (use 4500 se sua internet de subida for lenta).',
      'Intervalo de quadro-chave: 1 s. Preset: P4 ou "Baixa latência". Perfil: high. B-frames: 0.',
    ],
  },
  {
    title: '3. Vídeo',
    items: [
      'FPS comum: 60.',
      'Resolução de saída: 1920x1080 (ou a do seu monitor, se for ultrawide).',
    ],
  },
  {
    title: '4. Dicas para manter 60 fps',
    items: [
      'Jogue em "janela sem borda", não em tela cheia exclusiva.',
      'No OBS, use "Captura de jogo" em vez de "Captura de tela".',
      'Veja Visualizar → Docks → Estatísticas: "quadros ignorados" deve ficar em ~0%.',
    ],
  },
];

export const ObsGuideModal: React.FC<ObsGuideModalProps> = ({ isOpen, onClose, obsUrl }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const copy = () => {
    navigator.clipboard.writeText(obsUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#13151f] border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden text-gray-200">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-2 bg-purple-500/20 text-purple-300 rounded-xl shrink-0">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm sm:text-base">Transmitir com o OBS (60 FPS)</h3>
              <p className="text-[11px] sm:text-xs text-gray-400">
                Melhor qualidade para jogos: usa o encoder da sua placa de vídeo
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

        <div className="p-4 sm:p-6 space-y-4 text-sm max-h-[75vh] overflow-y-auto">
          <div>
            <label className="block font-medium text-xs text-gray-400 uppercase tracking-wider mb-2">
              Seu link de transmissão
            </label>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-indigo-200 break-all select-all">
                {obsUrl}
              </code>
              <button
                onClick={copy}
                className={`px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition shrink-0 ${
                  copied
                    ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300'
                    : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-200'
                }`}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">
              O trecho <span className="font-mono">latency=250000</span> deixa a conexão mais tolerante a perda de pacotes.
            </p>
          </div>

          {STEPS.map((step) => (
            <div key={step.title} className="p-3.5 bg-white/5 border border-white/5 rounded-xl">
              <div className="font-semibold text-white text-sm mb-1.5">{step.title}</div>
              <ul className="list-disc pl-5 space-y-1 text-xs text-gray-300 leading-relaxed">
                {step.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}

          <div className="p-3.5 bg-indigo-950/20 border border-indigo-500/20 rounded-xl text-xs text-gray-300 leading-relaxed">
            <div className="flex items-center gap-2 text-indigo-300 font-semibold mb-1">
              <Zap className="w-4 h-4" />
              <span>Como saber se está em 60 fps</span>
            </div>
            Quando a transmissão aparecer na sala, clique no botão de estatísticas (HUD). O painel da transmissão mostra
            FPS, resolução, bitrate, perda e atraso em tempo real.
          </div>
        </div>

        <div className="flex items-center justify-end px-4 sm:px-6 py-3 sm:py-4 border-t border-white/10 bg-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs sm:text-sm transition"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
};
