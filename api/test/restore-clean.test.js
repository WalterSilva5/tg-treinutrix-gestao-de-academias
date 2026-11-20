// Restore em instalação limpa: banco vazio + backup JSON/fotos de outro diretório.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-restore-'));
const DESTINO = path.join(TMP, 'instalacao-nova');
const BACKUPS = path.join(TMP, 'backups');
process.env.AUTH_SECRET = 'segredo-restore';
process.env.DATA_DIR = DESTINO;
process.env.DB_FILE = path.join(DESTINO, 'painel.db');
process.env.PHOTO_DIR = path.join(DESTINO, 'photos');
process.env.BACKUP_DIR = BACKUPS;
process.env.SEED_ADMIN_PASSWORD = 'admin123';
process.env.SEED_DEMO = '0';
process.env.EDGE_URL = 'http://127.0.0.1:1';
process.env.PERSIST_INTERVAL_MS = '3600000';
process.env.NOTIFY_INTERVAL_MS = '3600000';

const { hashPassword } = await import('../src/auth.js');
const { createServer } = await import('../src/server.js');

const STAMP = '2026-11-20T12-00-00-000Z';
const ARQUIVO = `painel_${STAMP}.json`;
fs.mkdirSync(BACKUPS, { recursive: true });
fs.mkdirSync(path.join(BACKUPS, `photos-${STAMP}`), { recursive: true });
fs.writeFileSync(path.join(BACKUPS, `photos-${STAMP}`, 'per_restore.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
fs.writeFileSync(path.join(BACKUPS, ARQUIVO), JSON.stringify({
  v: 1,
  at: '2026-11-20T12:00:00.000Z',
  persons: [{
    id: 'per_restore', nome: 'Aluno Restaurado', matricula: 'R001', tipo: 'ALUNO',
    enrollid: 2001, ativo: true, validadeFim: '2027-12-31', foto: { ext: 'jpg', mime: 'image/jpeg', bytes: 4 },
    senhaHash: hashPassword('R001'), criadoEm: '2026-11-01T10:00:00.000Z',
  }],
  devices: [{ id: 'dev_novo', nome: 'Catraca Restaurada', driver: 'topdata_easyinner', ip: '192.168.0.50', porta: 3570, online: false, lastSeen: null }],
  users: [{ id: 'usr_admin', nome: 'Administrador', login: 'admin', senhaHash: hashPassword('admin123'), perfil: 'gerencia' }],
  rules: [{ personId: 'per_restore', deviceId: 'dev_novo', diasSemana: 127, horaIni: '00:00', horaFim: '23:59' }],
  events: [{ id: 'evt_restore', deviceId: 'dev_novo', personId: 'per_restore', timestamp: '2026-11-20T10:00:00.000Z', direcao: 'IN', metodo: 'FACIAL', decisao: 'ALLOW', motivo: 'OK' }],
  socialEvents: [{ id: 'evo_restore', nome: 'Evento Restaurado', inicio: '2026-12-01T19:00:00.000Z', ativo: true, inscricoesAbertas: true, permiteVisitantes: true }],
  eventParticipants: [{ id: 'par_restore', eventId: 'evo_restore', personId: 'per_restore', nome: 'Aluno Restaurado', tipo: 'ALUNO', status: 'PRESENTE' }],
  raffles: [{ id: 'sor_restore', nome: 'Sorteio Restaurado', publico: 'ALUNOS', status: 'ATIVA', ativo: true, entradasBase: 1, premio: 'Brinde' }],
  syncQueue: [],
  notifications: [],
  meta: { lastBackupAt: '2026-11-20T12:00:00.000Z', nextEnrollid: 2002, dedup: {} },
}));

let server;
let base;
let token;

async function api(p, { method = 'GET', body, auth = true } = {}) {
  const r = await fetch(base + p, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* binário */ }
  return { status: r.status, json, text, headers: r.headers };
}

test.before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // A instalação nova sobe vazia (seed), depois restaura o backup de fora.
  const loginSeed = await api('/api/auth/login', { method: 'POST', auth: false, body: { login: 'admin', senha: 'admin123' } });
  assert.equal(loginSeed.status, 200);
  token = loginSeed.json.token;
  const restore = await api('/api/backup/restore', { method: 'POST', body: { file: ARQUIVO } });
  assert.equal(restore.status, 200, restore.text);
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('restore em diretório limpo devolve cadastros, eventos, sorteios e foto', async () => {
  const login = await api('/api/auth/login', { method: 'POST', auth: false, body: { login: 'admin', senha: 'admin123' } });
  assert.equal(login.status, 200);
  token = login.json.token;

  const pessoas = await api('/api/persons');
  assert.equal(pessoas.status, 200);
  const p = pessoas.json.find((x) => x.id === 'per_restore');
  assert.ok(p, 'pessoa restaurada');
  assert.equal(p.nome, 'Aluno Restaurado');
  assert.equal(p.foto.ext, 'jpg');

  const foto = await fetch(`${base}/api/persons/per_restore/photo`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(foto.status, 200);
  assert.equal(foto.headers.get('content-type'), 'image/jpeg');

  const eventos = await api('/api/events');
  assert.ok(eventos.json.some((e) => e.id === 'evt_restore'));

  const sociais = await api('/api/eventos/evo_restore');
  assert.equal(sociais.status, 200);
  assert.equal(sociais.json.participantes.length, 1);

  const sorteios = await api('/api/sorteios');
  assert.ok(sorteios.json.some((s) => s.id === 'sor_restore'));

  const health = await api('/api/health');
  assert.equal(health.json.storage.engine, 'sqlite');
  assert.ok(health.json.counts.persons >= 1);
});
