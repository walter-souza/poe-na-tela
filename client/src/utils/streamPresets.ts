import type { VideoFrameRate, VideoResolution } from '../types';

/**
 * Bitrate de vídeo (kbps) por resolução e taxa de quadros para compartilhamento de tela/jogos em H.264.
 * Fonte única usada pelo modal e pelo hook de publicação: o LiveKit só respeita este valor
 * quando passado em `screenShareEncoding` (a opção `videoEncoding` é ignorada para tela).
 */
const BITRATE_KBPS: Record<VideoResolution, Record<VideoFrameRate, number>> = {
  '720p': { 30: 2500, 60: 4500 },
  '1080p': { 30: 4500, 60: 8000 },
  '1440p': { 30: 8000, 60: 14000 },
  '4k': { 30: 14000, 60: 25000 },
};

export function getTargetBitrateKbps(resolution: VideoResolution | undefined, frameRate: VideoFrameRate | undefined): number {
  const res = resolution && BITRATE_KBPS[resolution] ? resolution : '1080p';
  const fps: VideoFrameRate = frameRate === 30 ? 30 : 60;
  return BITRATE_KBPS[res][fps];
}
