import type { VideoCodecPreference, VideoFrameRate, VideoResolution } from '../types';

export interface ScreenShareProfile {
  codec: VideoCodecPreference;
  /** SVC mode so the SFU can drop temporal/spatial layers per viewer without a second encode. */
  scalabilityMode?: 'L1T3';
  maxBitrate: number;
  degradationPreference: RTCDegradationPreference;
}

// H.264 baseline bitrates (kbps). Other codecs scale from these by efficiency.
const H264_BITRATE_KBPS: Record<VideoResolution, Record<VideoFrameRate, number>> = {
  '720p': { 30: 2000, 60: 3000 },
  '1080p': { 30: 3500, 60: 6000 },
  '1440p': { 30: 5500, 60: 9000 },
  '4k': { 30: 9000, 60: 14000 },
};

const CODEC_EFFICIENCY: Record<VideoCodecPreference, number> = {
  h264: 1,
  vp8: 1.1,
  vp9: 0.8,
  av1: 0.7,
};

const RESOLUTION_SIZE: Record<VideoResolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
};

export const getResolutionSize = (resolution: VideoResolution) => RESOLUTION_SIZE[resolution];

const CODEC_MIME: Partial<Record<VideoCodecPreference, string>> = {
  av1: 'video/AV1',
  vp9: 'video/VP9',
  h264: 'video/H264',
};

async function probeEncoder(
  codec: VideoCodecPreference,
  resolution: VideoResolution,
  fps: VideoFrameRate,
  bitrateKbps: number
): Promise<{ supported: boolean; smooth: boolean; powerEfficient: boolean }> {
  const mime = CODEC_MIME[codec];
  const mc = navigator.mediaCapabilities as MediaCapabilities | undefined;
  if (!mime || !mc?.encodingInfo) return { supported: false, smooth: false, powerEfficient: false };

  const { width, height } = RESOLUTION_SIZE[resolution];
  const contentType = codec === 'h264' ? `${mime};profile-level-id=42e01f` : mime;
  try {
    const info = await mc.encodingInfo({
      type: 'webrtc',
      video: {
        contentType,
        width,
        height,
        bitrate: bitrateKbps * 1000,
        framerate: fps,
      },
    });
    return { supported: info.supported, smooth: info.smooth, powerEfficient: info.powerEfficient };
  } catch {
    return { supported: false, smooth: false, powerEfficient: false };
  }
}

function isPublishableByBrowser(codec: VideoCodecPreference): boolean {
  const mime = CODEC_MIME[codec];
  if (!mime || typeof RTCRtpSender === 'undefined' || !RTCRtpSender.getCapabilities) return false;
  return !!RTCRtpSender.getCapabilities('video')?.codecs.some(
    (c) => c.mimeType.toLowerCase() === mime.toLowerCase()
  );
}

/**
 * Picks the most efficient codec the device can encode without burning CPU:
 * hardware AV1 > hardware VP9 > H.264 (usually hardware) > smooth software VP9 > H.264.
 * AV1/VP9 enable L1T3 SVC so weak viewers can fall back to 30/15 fps from the SFU.
 */
export async function buildScreenShareProfile(
  resolution: VideoResolution,
  fps: VideoFrameRate,
  options: { codec?: VideoCodecPreference; bitrateKbps?: number } = {}
): Promise<ScreenShareProfile> {
  const base = H264_BITRATE_KBPS[resolution][fps];

  let codec: VideoCodecPreference = options.codec ?? 'h264';
  if (!options.codec) {
    const candidates = (['av1', 'vp9', 'h264'] as const).filter(isPublishableByBrowser);
    const probes = await Promise.all(
      candidates.map(async (c) => ({
        codec: c,
        ...(await probeEncoder(c, resolution, fps, Math.round(base * CODEC_EFFICIENCY[c]))),
      }))
    );
    const byCodec = (c: VideoCodecPreference) => probes.find((p) => p.codec === c);
    const hw = (c: VideoCodecPreference) => {
      const p = byCodec(c);
      return !!p && p.supported && p.smooth && p.powerEfficient;
    };

    if (hw('av1')) codec = 'av1';
    else if (hw('vp9')) codec = 'vp9';
    else if (byCodec('h264')?.supported !== false) codec = 'h264';
    else if (byCodec('vp9')?.smooth) codec = 'vp9';
  }

  const maxBitrate = (options.bitrateKbps ?? Math.round(base * CODEC_EFFICIENCY[codec])) * 1000;

  return {
    codec,
    scalabilityMode: codec === 'av1' || codec === 'vp9' ? 'L1T3' : undefined,
    maxBitrate,
    // Games: keep fps and let resolution give. Lower fps: let both adapt.
    degradationPreference: fps === 60 ? 'maintain-framerate' : 'balanced',
  };
}
