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
  audioTrack?: any; // Track from livekit-client
  isLocal: boolean;
}
