export type VideoResolution = '720p' | '1080p' | '1440p' | '4k';
export type VideoFrameRate = 30 | 60;
export type VideoCodecPreference = 'vp9' | 'vp8' | 'h264' | 'av1';

export interface StreamQualityConfig {
  resolution: VideoResolution;
  frameRate: VideoFrameRate;
  bitrateKbps: number; // e.g. 6000 for 6 Mbps
  codec: VideoCodecPreference;
  includeAudio: boolean;
  contentHint: 'motion' | 'detail';
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
  bytesReceivedOrSent: number;
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
