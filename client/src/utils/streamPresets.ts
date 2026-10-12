import type { QualityMode, VideoFrameRate, VideoResolution } from '../types';

/**
 * Bitrate de vídeo (kbps) por modo, resolução e taxa de quadros para compartilhamento de tela/jogos em H.264.
 * Fonte única usada pelo modal e pelo hook de publicação: o LiveKit só respeita este valor
 * quando passado em `screenShareEncoding` (a opção `videoEncoding` é ignorada para tela).
 * São tetos: o WebRTC reduz sozinho quando a rede não comporta.
 */
const BITRATE_KBPS: Record<QualityMode, Record<VideoResolution, Record<VideoFrameRate, number>>> = {
  stable: {
    '720p': { 30: 2000, 60: 3500 },
    '1080p': { 30: 3500, 60: 6000 },
  },
  high: {
    '720p': { 30: 2500, 60: 4500 },
    '1080p': { 30: 4500, 60: 8000 },
  },
};

/** Piso do bitrate durante a adaptação automática: abaixo disso, reduz resolução/FPS em vez do bitrate. */
export const MIN_BITRATE_KBPS: Record<VideoResolution, number> = {
  '720p': 1500,
  '1080p': 2500,
};

export const RESOLUTION_SIZE: Record<VideoResolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

/** Camada leve do simulcast, para quem assiste com banda fraca. */
export const SIMULCAST_LOW_LAYER = { width: 1280, height: 720, bitrateKbps: 1800, frameRate: 30 };

export function getTargetBitrateKbps(
  resolution: VideoResolution | undefined,
  frameRate: VideoFrameRate | undefined,
  mode: QualityMode = 'stable'
): number {
  const res: VideoResolution = resolution === '720p' ? '720p' : '1080p';
  const fps: VideoFrameRate = frameRate === 30 ? 30 : 60;
  return BITRATE_KBPS[mode === 'high' ? 'high' : 'stable'][res][fps];
}

export interface RecommendedQuality {
  resolution: VideoResolution;
  frameRate: VideoFrameRate;
  reason: string;
}

/**
 * Sugere uma qualidade segundo a capacidade do computador de quem transmite.
 * `hardwareConcurrency` e `deviceMemory` são estimativas do navegador (deviceMemory só existe no Chromium
 * e é limitado a 8 GB). Em dúvida, a sugestão é conservadora: o usuário pode sempre escolher outra.
 */
export function getRecommendedQuality(): RecommendedQuality {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    | (Navigator & { deviceMemory?: number })
    | undefined;
  const cores = nav?.hardwareConcurrency ?? 4;
  const memory = nav?.deviceMemory;

  if (cores <= 2 || (memory !== undefined && memory <= 2)) {
    return { resolution: '720p', frameRate: 30, reason: 'seu computador parece ter poucos recursos' };
  }
  if (cores <= 4 || (memory !== undefined && memory <= 4)) {
    return { resolution: '720p', frameRate: 60, reason: 'fluidez com menos carga no processador' };
  }
  return { resolution: '1080p', frameRate: 60, reason: 'seu computador comporta Full HD a 60 FPS' };
}
