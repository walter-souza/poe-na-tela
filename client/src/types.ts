export type VideoResolution = '720p' | '1080p';
export type VideoFrameRate = 30 | 60;
/** 'stable': bitrates menores, para internet instável; 'high': máxima qualidade */
export type QualityMode = 'stable' | 'high';
export type VideoCodecPreference = 'vp9' | 'vp8' | 'h264' | 'av1';

export interface StreamQualityConfig {
  resolution: VideoResolution;
  frameRate: VideoFrameRate;
  bitrateKbps: number; // e.g. 6000 for 6 Mbps
  codec: VideoCodecPreference;
  includeAudio: boolean;
  contentHint?: 'motion' | 'detail';
  isolateRoomAudio?: boolean; // WebRTC restrictOwnAudio to prevent voice chat loopback
  sourceId?: string; // Specific window or screen ID in Desktop App
  qualityMode?: QualityMode;
  /** Publica também uma camada leve (720p30) para espectadores com banda fraca. Usa mais CPU no emissor. */
  simulcast?: boolean;
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
  /** Quem limita o envio (só no emissor): 'none' | 'cpu' | 'bandwidth' | 'other' */
  limitationReason?: string;
  /** Implementação do codificador no emissor (ex.: 'OpenH264' = software, 'MediaFoundation'/'ExternalEncoder' = hardware) */
  encoderImplementation?: string;
  /** Bitrate-alvo do codificador (kbps), só no emissor */
  targetBitrateKbps?: number;
  /** Quadros por segundo capturados da tela (antes de codificar), só no emissor */
  captureFps?: number;
  /** Banda de upload estimada pelo WebRTC (kbps), só no emissor */
  availableOutgoingKbps?: number;
  /** Resolução entregue pela captura (antes de codificar), só no emissor */
  captureWidth?: number;
  captureHeight?: number;
  /** O que está sendo capturado: 'browser' (aba), 'window' (janela) ou 'monitor' (tela inteira) */
  displaySurface?: string;
  /** Quadros descartados pelo decodificador/renderização, só no espectador */
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

export interface VoiceParticipant {
  identity: string;
  name: string;
  voiceChannelId: string | null;
  isSpeaking: boolean;
  isMuted: boolean;
  avatarUrl?: string | null;
  updatedAt?: number;
  isConnecting?: boolean;
}

export interface FavoriteRoom {
  name: string;
  addedAt: number;
}

export interface UserRoom {
  id: string;
  name: string;
  slug: string;
  hasPasscode: boolean;
  isOwner: boolean;
  role: string;
  createdAt?: string;
}

export interface ActiveRoomInfo {
  name: string;
  numParticipants: number;
  hasPasscode?: boolean;
}

export interface Channel {
  id: string;
  room_id: string;
  name: string;
  type: 'text' | 'voice' | 'stream';
  position: number;
  created_at?: string;
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

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon?: string | null;
  display_id?: string;
}

declare global {
  interface Window {
    desktopAPI?: {
      isDesktop: boolean;
      getSources: () => Promise<DesktopSource[]>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      setPriority: (priority: 'high' | 'realtime' | 'normal') => Promise<boolean>;
      registerShortcut: (shortcut: string, actionName: string) => Promise<boolean>;
      onShortcut: (callback: (action: string) => void) => () => void;
    };
  }
}
