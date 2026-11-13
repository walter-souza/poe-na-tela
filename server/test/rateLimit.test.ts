import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { fake } from './fakeLivekit.js';

vi.mock('../src/livekit.js', () => import('./fakeLivekit.js'));
const { app } = await import('../src/app.js');

beforeEach(() => fake.reset());

describe('limites de tentativas em /api/token', () => {
  it('bloqueia o mesmo IP depois de 15 pedidos por minuto', async () => {
    const from = (n: number) =>
      request(app).post('/api/token').set('X-Forwarded-For', '10.5.5.5, 10.1.0.1').send({ roomName: `sala-${n}`, participantName: 'Ana' });

    for (let i = 0; i < 15; i++) expect((await from(i)).status).toBe(200);
    const blocked = await from(15);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Muitas tentativas/);
  });

  it('bloqueia força bruta de senha numa sala mesmo vinda de IPs diferentes', async () => {
    let ip = 0;
    const guess = (passcode: string) =>
      request(app).post('/api/token').set('X-Forwarded-For', `10.7.${Math.floor(++ip / 200)}.${ip % 200}, 10.1.0.1`)
        .send({ roomName: 'cofre', participantName: `Visitante${ip}`, passcode });

    await guess('certa');
    fake.join('cofre', 'Visitante1');

    // 30 erros por sala em 5 minutos; o 31º é bloqueado mesmo com a senha certa.
    for (let i = 0; i < 30; i++) expect((await guess(`chute-${i}`)).status).toBe(403);
    expect((await guess('certa')).status).toBe(429);
  });
});
