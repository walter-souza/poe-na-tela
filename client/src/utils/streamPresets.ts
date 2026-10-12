import type { VideoFrameRate, VideoResolution } from '../types';

/**
 * Bitrate de vídeo (kbps) por resolução e taxa de quadros para compartilhamento de tela/jogos em H.264.
 * Fonte única usada pelo modal e pelo hook de publicação: o LiveKit só respeita este valor
 * quando passado em `screenShareEncoding` (a opção `videoEncoding` é ignorada para tela).
 */
const BITRATE_KBPS: Record<VideoResolution, Record<VideoFrameRate, number>> = {
  '720p': { 30: 2500, 60: 4500 },
  '1080p': { 30: 4500, 60: 8000 },
};

export const RESOLUTION_SIZE: Record<VideoResolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export function getTargetBitrateKbps(resolution: VideoResolution | undefined, frameRate: VideoFrameRate | undefined): number {
  const res: VideoResolution = resolution === '720p' ? '720p' : '1080p';
  const fps: VideoFrameRate = frameRate === 30 ? 30 : 60;
  return BITRATE_KBPS[res][fps];
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
