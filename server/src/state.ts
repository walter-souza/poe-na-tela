

// In-memory room store for passcodes and custom room settings
export interface RoomConfig {
  name: string;
  passcode?: string;
  hostIdentity?: string;
  createdAt: number;
}
export const roomStore = new Map<string, RoomConfig>();
