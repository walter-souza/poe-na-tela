import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AccessToken } from 'livekit-server-sdk';
import { streamKeyFor } from '../src/auth.js';
import { fake } from './fakeLivekit.js';

vi.mock('../src/livekit.js', () => import('./fakeLivekit.js'));
const { app } = await import('../src/app.js');

const KEY = process.env.LIVEKIT_API_KEY!;
const SECRET = process.env.LIVEKIT_API_SECRET!;

async function tokenFor(identity: string, room: string, secret = SECRET) {
  const at = new AccessToken(KEY, secret, { identity });
  at.addGrant({ roomJoin: true, room });
  return at.toJwt();
}

/** Responde a API do MediaMTX (/v3/paths/list) com os caminhos dados. */
function mediamtxWith(items: unknown[]) {
  const realFetch = globalThis.fetch;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith('http://mediamtx.test/')) {
      return new Response(JSON.stringify({ items }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
  });
}

beforeEach(() => fake.reset());
afterEach(() => vi.restoreAllMocks());

describe('GET /api/health', () => {
  it('informa o estado normal e o de manutenção', async () => {
    const ok = await request(app).get('/api/health');
    expect(ok.body).toMatchObject({ status: 'ok', maintenance: false });

    process.env.MAINTENANCE_MODE = '1';
    try {
      const maint = await request(app).get('/health');
      expect(maint.body).toMatchObject({ status: 'maintenance', maintenance: true });
      expect(maint.body.message).toBeTruthy();
    } finally {
      delete process.env.MAINTENANCE_MODE;
    }
  });
});

describe('GET /api/rooms e /api/room-info', () => {
  it('lista só salas com gente, com indicação de senha e clipe', async () => {
    fake.join('cheia', 'Ana');
    fake.room('cheia')!.metadata = JSON.stringify({ pass: 'x:y', clip: true });
    await request(app).post('/api/token').set('X-Forwarded-For', '10.2.0.1, 10.1.0.1').send({ roomName: 'vazia', participantName: 'Bia' });

    const res = await request(app).get('/api/rooms');
    expect(res.body.rooms).toEqual([
      { name: 'cheia', numParticipants: 1, creationTime: 1, hasPasscode: true, clipEnabled: true },
    ]);
  });

  it('não lista salas em manutenção', async () => {
    fake.join('cheia', 'Ana');
    process.env.MAINTENANCE_MODE = 'true';
    try {
      expect((await request(app).get('/api/rooms')).body).toEqual({ rooms: [], maintenance: true });
    } finally {
      delete process.env.MAINTENANCE_MODE;
    }
  });

  it('degrada para lista vazia se o LiveKit cair', async () => {
    fake.setUnavailable(true);
    const res = await request(app).get('/api/rooms');
    expect(res.status).toBe(200);
    expect(res.body.rooms).toEqual([]);
  });

  it('informa uma sala pelo nome sanitizado', async () => {
    fake.join('sala teste', 'Ana');
    const res = await request(app).get('/api/room-info/Sala%20Teste');
    expect(res.body).toEqual({ roomName: 'sala teste', hasPasscode: false, isActive: true, numParticipants: 1, clipEnabled: false });
  });
});

describe('GET /api/rooms/:sala/streams', () => {
  it('exige um participante presente na sala', async () => {
    expect((await request(app).get('/api/rooms/sala/streams')).status).toBe(401);

    const token = await tokenFor('Ana', 'sala');
    // Token válido, mas Ana não está conectada.
    expect((await request(app).get('/api/rooms/sala/streams').set('Authorization', `Bearer ${token}`)).status).toBe(401);

    // Token de outra sala.
    fake.join('sala', 'Ana');
    const outra = await tokenFor('Ana', 'outra');
    expect((await request(app).get('/api/rooms/sala/streams').set('Authorization', `Bearer ${outra}`)).status).toBe(401);

    // Assinado com outro segredo.
    const forjado = await tokenFor('Ana', 'sala', 'outro-segredo-qualquer-com-32-caracteres');
    expect((await request(app).get('/api/rooms/sala/streams').set('Authorization', `Bearer ${forjado}`)).status).toBe(401);
  });

  it('lista o stream principal e os de cada participante, só da própria sala', async () => {
    fake.join('jogo', 'Ana');
    mediamtxWith([
      { name: 'jogo', ready: true },
      { name: 'jogo/pedro_silva', ready: true },
      { name: 'jogo/offline', ready: false },
      { name: 'jogo-secreto', ready: true },
      { name: 'jogo-secreto/x', ready: true },
    ]);

    const res = await request(app).get('/api/rooms/jogo/streams').set('Authorization', `Bearer ${await tokenFor('Ana', 'jogo')}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.streams).toEqual([
      { id: 'main', name: 'Principal', path: 'jogo', whepUrl: 'https://stream.test/jogo/whep' },
      { id: 'pedro_silva', name: 'Pedro Silva', path: 'jogo/pedro_silva', whepUrl: 'https://stream.test/jogo/pedro_silva/whep' },
    ]);
  });

  it('devolve lista vazia se o MediaMTX estiver fora', async () => {
    fake.join('jogo', 'Ana');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    const res = await request(app).get('/api/rooms/jogo/streams').set('Authorization', `Bearer ${await tokenFor('Ana', 'jogo')}`);
    expect(res.body).toEqual({ roomName: 'jogo', streams: [], count: 0 });
  });
});

describe('POST /api/mediamtx/auth', () => {
  const auth = (body: Record<string, unknown>) => request(app).post('/api/mediamtx/auth').send(body);

  it('libera publicar só em sala/usuario com a chave desse caminho', async () => {
    const key = streamKeyFor(SECRET, 'sala/ana');
    expect((await auth({ action: 'publish', path: 'sala/ana', password: key })).status).toBe(200);
    expect((await auth({ action: 'publish', path: 'sala/bia', password: key })).status).toBe(401);
    expect((await auth({ action: 'publish', path: 'sala', password: streamKeyFor(SECRET, 'sala') })).status).toBe(401);
    expect((await auth({ action: 'publish', path: 'sala/ana/x', password: key })).status).toBe(401);
  });

  it('libera assistir só para quem está na sala', async () => {
    const token = await tokenFor('Ana', 'sala');
    expect((await auth({ action: 'read', path: 'sala/bia', token })).status).toBe(401);
    fake.join('sala', 'Ana');
    expect((await auth({ action: 'read', path: 'sala/bia', token })).status).toBe(200);
    expect((await auth({ action: 'read', path: 'SALA/bia', token })).status).toBe(401);
  });

  it('recusa chamadas que passaram por proxy e ações desconhecidas', async () => {
    const key = streamKeyFor(SECRET, 'sala/ana');
    const viaProxy = await request(app).post('/api/mediamtx/auth').set('X-Forwarded-For', '1.2.3.4')
      .send({ action: 'publish', path: 'sala/ana', password: key });
    expect(viaProxy.status).toBe(403);
    expect((await auth({ action: 'api' })).status).toBe(401);
  });
});

describe('CORS', () => {
  const preflight = (origin: string) =>
    request(app).options('/api/token').set('Origin', origin).set('Access-Control-Request-Method', 'POST');

  it('aceita o site, os previews da Vercel, o app desktop e o Vite local', async () => {
    for (const origin of [
      'https://poe-na-tela.vercel.app',
      'https://poe-na-tela-git-develop-walter-souzas-projects.vercel.app',
      'http://tauri.localhost',
      'http://localhost:3000',
    ]) {
      expect((await preflight(origin)).headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('não libera outras origens', async () => {
    for (const origin of ['https://malicioso.com', 'https://poe-na-tela.vercel.app.evil.com', 'https://poe-na-tela-x-outro.vercel.app']) {
      expect((await preflight(origin)).headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});
