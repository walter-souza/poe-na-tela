import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { TokenVerifier } from 'livekit-server-sdk';
import { streamKeyFor } from '../src/auth.js';
import { fake } from './fakeLivekit.js';

vi.mock('../src/livekit.js', () => import('./fakeLivekit.js'));
const { app } = await import('../src/app.js');

const SECRET = process.env.LIVEKIT_API_SECRET!;

// Cada teste usa um IP próprio (X-Forwarded-For, com trust proxy 2) para não esbarrar no limite por IP,
// que tem teste próprio em rateLimit.test.ts.
let ip = 0;
const token = (body: Record<string, unknown>) =>
  request(app).post('/api/token').set('X-Forwarded-For', `10.0.0.${++ip}, 10.1.0.1`).send(body);

beforeEach(() => fake.reset());

describe('POST /api/token', () => {
  it('cria a sessão e devolve um token válido só para aquela sala', async () => {
    const res = await token({ roomName: 'Jogatina', participantName: 'Ana' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ roomName: 'jogatina', identity: 'Ana', livekitUrl: 'ws://livekit.test' });
    const claims = await new TokenVerifier(process.env.LIVEKIT_API_KEY!, SECRET).verify(res.body.token);
    expect(claims.sub).toBe('Ana');
    expect(claims.video).toMatchObject({ room: 'jogatina', roomJoin: true });
    expect(res.body.streamKey).toBe(streamKeyFor(SECRET, 'jogatina/Ana'));
  });

  it('guarda o hash da senha (nunca a senha) nos metadados da sessão nova', async () => {
    await token({ roomName: 'privada', participantName: 'Ana', passcode: 'segredo' });

    const meta = JSON.parse(fake.room('privada')!.metadata);
    expect(meta.pass).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(meta.pass).not.toContain('segredo');
    expect(meta).toMatchObject({ clip: false });
    expect(typeof meta.claimedAt).toBe('number');
  });

  it('exige a senha de quem chega depois, e recusa a errada', async () => {
    await token({ roomName: 'privada', participantName: 'Ana', passcode: 'segredo' });
    fake.join('privada', 'Ana');

    const semSenha = await token({ roomName: 'privada', participantName: 'Bia' });
    expect(semSenha.status).toBe(403);
    expect(semSenha.body.requiresPasscode).toBe(true);

    const errada = await token({ roomName: 'privada', participantName: 'Bia', passcode: 'chute' });
    expect(errada.status).toBe(403);

    const certa = await token({ roomName: 'privada', participantName: 'Bia', passcode: 'segredo' });
    expect(certa.status).toBe(200);
  });

  it('protege a sala na janela entre o token do criador e a conexão dele', async () => {
    await token({ roomName: 'privada', participantName: 'Ana', passcode: 'segredo' });
    // Ana ainda não conectou (LiveKit sem participantes), mas a sessão já é dela.
    const res = await token({ roomName: 'privada', participantName: 'Bia' });
    expect(res.status).toBe(403);
  });

  it('recusa senha em sala ativa pública', async () => {
    await token({ roomName: 'aberta', participantName: 'Ana' });
    fake.join('aberta', 'Ana');

    const res = await token({ roomName: 'aberta', participantName: 'Bia', passcode: 'qualquer' });
    expect(res.status).toBe(403);
  });

  it('recusa nome já em uso na sala, sem diferenciar maiúsculas', async () => {
    await token({ roomName: 'aberta', participantName: 'Ana' });
    fake.join('aberta', 'Ana');

    const res = await token({ roomName: 'aberta', participantName: 'ANA' });
    expect(res.status).toBe(409);
  });

  it('descarta a senha da sessão anterior quando a sala esvazia', async () => {
    await token({ roomName: 'sala', participantName: 'Ana', passcode: 'antiga' });
    fake.expireSession('sala');

    const res = await token({ roomName: 'sala', participantName: 'Bia' });
    expect(res.status).toBe(200);
    expect(JSON.parse(fake.room('sala')!.metadata).pass).toBeUndefined();
  });

  it('recusa nome vazio, sala vazia e a identidade reservada do bot de clipe', async () => {
    expect((await token({ roomName: '', participantName: 'Ana' })).status).toBe(400);
    expect((await token({ roomName: 'sala', participantName: '  ' })).status).toBe(400);
    expect((await token({ roomName: 'sala', participantName: '__clipbot__' })).status).toBe(400);
  });

  it('falha fechado (503) quando o LiveKit não responde', async () => {
    fake.setUnavailable(true);
    const res = await token({ roomName: 'sala', participantName: 'Ana' });
    expect(res.status).toBe(503);
  });

  it('em manutenção, só entra quem tem o token de acesso', async () => {
    process.env.MAINTENANCE_MODE = 'true';
    try {
      const bloqueado = await token({ roomName: 'sala', participantName: 'Ana' });
      expect(bloqueado.status).toBe(503);
      expect(bloqueado.body.maintenance).toBe(true);

      const chuteErrado = await token({ roomName: 'sala', participantName: 'Ana', bypassToken: 'errado' });
      expect(chuteErrado.status).toBe(503);

      const liberado = await token({ roomName: 'sala', participantName: 'Ana', bypassToken: process.env.ADMIN_BYPASS_TOKEN });
      expect(liberado.status).toBe(200);
    } finally {
      delete process.env.MAINTENANCE_MODE;
    }
  });

  it('também responde no caminho antigo /token', async () => {
    const res = await request(app).post('/token').set('X-Forwarded-For', '10.9.9.9, 10.1.0.1').send({ roomName: 'x', participantName: 'Ana' });
    expect(res.status).toBe(200);
  });
});
