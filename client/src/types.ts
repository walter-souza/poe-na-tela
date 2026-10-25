export type VideoResolution = '720p' | '1080p' | '1440p' | '4k';
export type VideoFrameRate = 30 | 60;
export type VideoCodecPreference = 'vp9' | 'vp8' | 'h264' | 'av1';

export interface StreamQualityConfig {
  resolution: VideoResolution;
  frameRate: VideoFrameRate;
  bitrateKbps?: number; // override; default derives from resolution/fps/codec
  codec?: VideoCodecPreference; // default: auto-detected from device encoder support
  includeAudio: boolean;
  contentHint?: 'motion' | 'detail';
  isolateRoomAudio?: boolean; // WebRTC restrictOwnAudio to prevent voice chat loopback
}

export interface StreamStats {
  bitrateKbps: number;
  rttMs: number;
  packetLossPercent: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
  jitterMs: number;
  bufferDelayMs?: number;
  playoutBufferMs?: number;
  bytesReceivedOrSent: number;
  /** Publisher only: why the encoder is below target ('cpu' | 'bandwidth' | 'none'). */
  qualityLimitationReason?: string;
  /** Publisher only: frames per second delivered by the screen capture (before encoding). */
  captureFps?: number;
  /** Publisher only: captured frame size before any simulcast downscale. */
  captureSize?: string;
  /** Publisher only: each simulcast layer actually encoded (rid:WxH@fps). */
  layers?: string;
  /** Publisher only: bitrate the congestion controller is currently targeting (kbps). */
  targetBitrateKbps?: number;
  /** Retransmission requests / keyframe requests in the last sampling window (both directions). */
  nackCount?: number;
  pliCount?: number;
  /** Publisher only: average encode time per frame (ms). */
  encodeTimeMs?: number;
  /** Viewer only: video freezes in the last sampling window. */
  freezeCount?: number;
  /** Viewer only: frames dropped by the decoder/renderer in the last sampling window. */
  framesDropped?: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  /** blob: URL of an attached image (text is empty for image-only messages). */
  imageUrl?: string;
  /** LiveKit identity of the author, as authenticated by the server (never taken from the payload). */
  senderIdentity?: string;
  /** True for messages sent by this client; only these can be edited or deleted. */
  isOwn?: boolean;
  edited?: boolean;
  timestamp: number;
  isHost?: boolean;
  isSystem?: boolean;
}

export interface ReactionEvent {
  emoji: string;
  sender: string;
  timestamp: number;
}

export interface ParticipantInfo {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isScreenSharing: boolean;
  isMuted: boolean;
  isDeafened?: boolean;
}

export interface FavoriteRoom {
  name: string;
  addedAt: number;
}

export interface ActiveRoomInfo {
  name: string;
  numParticipants: number;
  hasPasscode?: boolean;
}

export type StreamLayoutMode = 'grid' | 'spotlight';

export interface ScreenShareItem {
  id: string; // participantIdentity
  participantIdentity: string;
  participantName: string;
  videoTrack: any; // Track from livekit-client
  videoPublication?: any; // TrackPublication from livekit-client (remote: used to request a simulcast layer)
  audioTrack?: any; // Track from livekit-client
  isLocal: boolean;
}
