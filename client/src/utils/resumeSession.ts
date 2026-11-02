import type { ChatMessage } from '../types';

// Carries a room session across the reload that applies an update, so the user lands back in the
// same room with the same mic/deafen state and chat. Kept in sessionStorage (this tab only) and
// consumed on the next load; a stale entry (the user closed the tab mid-reload) is ignored.
const STORAGE_KEY = 'poe-na-tela-resume';
const MAX_AGE_MS = 2 * 60 * 1000;
const MAX_MESSAGES = 200;

export interface JoinArgs {
  roomName: string;
  userName: string;
  isPublisher: boolean;
  passcode?: string;
}

export interface RoomRestore {
  micEnabled: boolean;
  deafened: boolean;
  messages: ChatMessage[];
}

export interface ResumeState extends RoomRestore {
  join: JoinArgs;
}

export function saveResume(state: ResumeState): void {
  // Chat images are blob: URLs that die with the page; keep their caption, drop image-only messages.
  const messages = state.messages
    .map(({ imageUrl, ...msg }) => (imageUrl && msg.text ? { ...msg, text: `[imagem] ${msg.text}` } : imageUrl ? null : msg))
    .filter((msg): msg is ChatMessage => msg !== null)
    .slice(-MAX_MESSAGES);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, messages, savedAt: Date.now() }));
  } catch {}
}

export function takeResume(): ResumeState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (!raw) return null;
    const { savedAt, ...state } = JSON.parse(raw);
    if (typeof savedAt !== 'number' || Date.now() - savedAt > MAX_AGE_MS || !state.join?.roomName) return null;
    return state as ResumeState;
  } catch {
    return null;
  }
}
