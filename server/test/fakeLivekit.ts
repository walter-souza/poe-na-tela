// LiveKit em memória para os testes de rota: substitui src/livekit.ts via vi.mock.
// A autenticação de sala é a real (createRoomAuth), usando este roomService falso.
import { createRoomAuth } from '../src/auth.js';
import { sanitizeRoomName } from '../src/room.js';

interface FakeRoom {
  name: string;
  metadata: string;
  creationTime: bigint;
  participants: { identity: string; name: string }[];
}

const rooms = new Map<string, FakeRoom>();
let unavailable = false;

const toRoom = (r: FakeRoom) => ({
  name: r.name,
  metadata: r.metadata,
  creationTime: r.creationTime,
  numParticipants: r.participants.length,
});

function check() {
  if (unavailable) throw new Error('LiveKit indisponível (teste)');
}

export const roomService = {
  async listRooms(names?: string[]) {
    check();
    const list = [...rooms.values()].filter((r) => !names || names.includes(r.name));
    return list.map(toRoom);
  },
  async listParticipants(roomName: string) {
    check();
    return rooms.get(roomName)?.participants ?? [];
  },
  async createRoom({ name }: { name: string }) {
    check();
    if (!rooms.has(name)) rooms.set(name, { name, metadata: '', creationTime: 1n, participants: [] });
    return toRoom(rooms.get(name)!);
  },
  async updateRoomMetadata(name: string, metadata: string) {
    check();
    const room = rooms.get(name);
    if (!room) throw new Error('sala não existe');
    room.metadata = metadata;
    return toRoom(room);
  },
};

export const roomAuth = createRoomAuth({
  roomService: roomService as any,
  apiKey: process.env.LIVEKIT_API_KEY!,
  apiSecret: process.env.LIVEKIT_API_SECRET!,
  sanitizeRoomName,
});

export const listRoomsWithTimeout = (names?: string[]) => roomService.listRooms(names);
export const listParticipantsWithTimeout = (roomName: string) => roomService.listParticipants(roomName);

/** Controles usados pelos testes. */
export const fake = {
  reset() {
    rooms.clear();
    unavailable = false;
  },
  setUnavailable(value: boolean) {
    unavailable = value;
  },
  /** Simula alguém conectado à sala (o LiveKit passa a listá-lo como participante). */
  join(roomName: string, identity: string) {
    const room = rooms.get(roomName) ?? { name: roomName, metadata: '', creationTime: 1n, participants: [] };
    room.participants.push({ identity, name: identity });
    rooms.set(roomName, room);
  },
  room(roomName: string) {
    return rooms.get(roomName);
  },
  /** Deixa a sala sem ninguém e sem a janela de reserva do criador (sessão encerrada). */
  expireSession(roomName: string) {
    const room = rooms.get(roomName);
    if (!room) return;
    room.participants = [];
    const meta = room.metadata ? JSON.parse(room.metadata) : {};
    delete meta.claimedAt;
    room.metadata = JSON.stringify(meta);
  },
};
