// Testes de integração HTTP. Cada arquivo roda em um processo próprio, então
// o ambiente abaixo isola dados/fotos/backups em diretórios temporários.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-http-'));
process.env.AUTH_SECRET = 'segredo-de-teste';
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.DATA_FILE = path.join(TMP, 'data', 'state.json');
process.env.EVENTS_FILE = path.join(TMP, 'data', 'events.jsonl');
process.env.PHOTO_DIR = path.join(TMP, 'photos');
process.env.BACKUP_DIR = path.join(TMP, 'backups');
process.env.SEED_ADMIN_PASSWORD = 'admin123';
process.env.SEED_DEMO = '1';
process.env.NOTIFY_INTERVAL_MS = '3600000';
process.env.PERSIST_INTERVAL_MS = '3600000';

const { createServer } = await import('../src/server.js');

let server;
let base;
let admin;
const run = Date.now().toString(36).slice(-5);
let aluno; // pessoa criada no teste 2

async function api(p, { method = 'GET', body, token, headers = {} } = {}) {
  const r = await fetch(base + p, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* html */ }
  return { status: r.status, json, text };
}

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await api('/api/auth/login', { method: 'POST', body: { login: 'admin', senha: 'admin123' } });
  assert.equal(r.status, 200);
  admin = r.json.token;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('health e login', async () => {
  assert.equal((await api('/health')).json.ok, true);
  const bad = await api('/api/auth/login', { method: 'POST', body: { login: 'admin', senha: 'x' } });
  assert.equal(bad.status, 401);
  const noToken = await api('/api/persons');
  assert.equal(noToken.status, 401);
});

test('cadastro cria regra padrão e libera pelo cartão (person_id = enrollid)', async () => {
  const r = await api('/api/persons', {
    method: 'POST', token: admin,
    body: { nome: `Aluno ${run}`, tipo: 'ALUNO' },
  });
  assert.equal(r.status, 201, r.text);
  aluno = r.json;
  assert.match(aluno.matricula, /^M\d+$/);
  assert.ok(aluno.enrollid >= 1001);

  const rules = await api(`/api/persons/${aluno.id}/rules`, { token: admin });
  assert.equal(rules.json.length, 1);
  assert.equal(rules.json[0].diasSemana, 127);

  const byEnroll = await api('/api/identification', {
    method: 'POST', token: admin,
    body: { device_id: 'dev_fit4_01', person_id: String(aluno.enrollid), score: 0.95 },
  });
  assert.equal(byEnroll.json.allow, true, JSON.stringify(byEnroll.json));

  const byMatricula = await api('/api/identification', {
    method: 'POST', token: admin,
    body: { device_id: 'dev_fit4_01', person_id: aluno.matricula, score: 0.95 },
  });
  assert.equal(byMatricula.json.allow, true);

  const byId = await api('/api/identification', {
    method: 'POST', token: admin,
    body: { device_id: 'dev_fit4_01', person_id: aluno.id, score: 0.95 },
  });
  assert.equal(byId.json.allow, true);
});

test('não sobrescreve cadastro existente nem duplica matrícula/enrollid', async () => {
  const sameId = await api('/api/persons', { method: 'POST', token: admin, body: { id: aluno.id, nome: 'invasor' } });
  assert.equal(sameId.status, 409);
  const sameEnroll = await api('/api/persons', { method: 'POST', token: admin, body: { nome: 'x', enrollid: aluno.enrollid } });
  assert.equal(sameEnroll.status, 409);
  const sameMat = await api('/api/persons', { method: 'POST', token: admin, body: { nome: 'y', enrollid: 424242, matricula: aluno.matricula } });
  assert.equal(sameMat.status, 409);
});

test('score só é exigido no facial; cartão passa sem score', async () => {
  const facial = await api('/api/identification', {
    method: 'POST', token: admin,
    body: { device_id: 'dev_fit4_01', person_id: String(aluno.enrollid) },
  });
  assert.equal(facial.json.motivo, 'SCORE_BAIXO');
  const cartao = await api('/api/identification', {
    method: 'POST', token: admin,
    body: { device_id: 'dev_fit4_01', person_id: String(aluno.enrollid), metodo: 'CARTAO' },
  });
  assert.equal(cartao.json.allow, true);
});

test('logindex repetido não duplica evento (retry do leitor)', async () => {
  const before = (await api('/api/events', { token: admin })).json.length;
  const body = { device_id: 'dev_fit4_01', person_id: String(aluno.enrollid), score: 0.9, logindex: 12345 };
  const a = await api('/api/identification', { method: 'POST', token: admin, body });
  const b = await api('/api/identification', { method: 'POST', token: admin, body });
  assert.deepEqual(a.json, b.json);
  const after = (await api('/api/events', { token: admin })).json.length;
  assert.equal(after, before + 1);
});

test('regra de horário: valida e nega dia não permitido', async () => {
  const invalida = await api(`/api/persons/${aluno.id}/rules`, {
    method: 'PUT', token: admin,
    body: { rules: [{ deviceId: 'dev_fit4_01', diasSemana: 127, horaIni: '25:00', horaFim: '06:00' }] },
  });
  assert.equal(invalida.status, 400);

  // Só domingo = bit 1.
  const ok = await api(`/api/persons/${aluno.id}/rules`, {
    method: 'PUT', token: admin,
    body: { rules: [{ deviceId: 'dev_fit4_01', diasSemana: 1, horaIni: '00:00', horaFim: '23:59' }] },
  });
  assert.equal(ok.status, 200);
  const quarta = new Date(2026, 10, 18, 10, 0, 0); // quarta local
  const r = await api('/api/identification', {
    method: 'POST', token: admin,
    body: { device_id: 'dev_fit4_01', person_id: String(aluno.enrollid), metodo: 'CARTAO', timestamp: quarta.toISOString() },
  });
  assert.equal(r.json.motivo, 'DIA_NAO_PERMITIDO');
});

test('cadastro inativo e validade vencida negam acesso', async () => {
  await api(`/api/persons/${aluno.id}`, { method: 'PATCH', token: admin, body: { ativo: false } });
  const inativo = await api('/api/identification', {
    method: 'POST', token: admin,
    body: { device_id: 'dev_fit4_01', person_id: String(aluno.enrollid), metodo: 'CARTAO' },
  });
  assert.equal(inativo.json.motivo, 'PESSOA_INATIVA');

  await api(`/api/persons/${aluno.id}`, { method: 'PATCH', token: admin, body: { ativo: true, validadeFim: '2020-01-01' } });
  const vencido = await api('/api/identification', {
    method: 'POST', token: admin,
    body: { device_id: 'dev_fit4_01', person_id: String(aluno.enrollid), metodo: 'CARTAO' },
  });
  assert.equal(vencido.json.motivo, 'FORA_VALIDADE');
  await api(`/api/persons/${aluno.id}`, { method: 'PATCH', token: admin, body: { validadeFim: null } });
});

test('fila de sincronismo não spamma e aceita baixa', async () => {
  await api(`/api/persons/${aluno.id}`, { method: 'PATCH', token: admin, body: { treinutrix: '@teste' } });
  await api(`/api/persons/${aluno.id}`, { method: 'PATCH', token: admin, body: { treinutrix: '@teste2' } });

  const pend = await api('/api/sync?device_id=dev_fit4_01&status=PENDING', { token: admin });
  const meus = pend.json.filter((s) => s.personId === aluno.id);
  assert.equal(meus.length, 1);
  assert.equal(meus[0].payload.enable, true);
  assert.equal(meus[0].payload.enrollid, aluno.enrollid);
  assert.equal(meus[0].payload.name, aluno.nome);

  const ack = await api(`/api/sync/${meus[0].id}/ack`, { method: 'POST', token: admin, body: { status: 'SENT' } });
  assert.equal(ack.json.status, 'SENT');
  assert.equal(ack.json.tentativas, 1);
});

test('aluno só vê o próprio cadastro e não acessa operação', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { login: aluno.matricula, senha: aluno.matricula } });
  assert.equal(login.status, 200);
  const token = login.json.token;

  const persons = await api('/api/persons', { token });
  assert.deepEqual(persons.json.map((p) => p.id), [aluno.id]);
  assert.equal(persons.json[0].senhaHash, undefined);
  assert.equal((await api('/api/overview', { token })).status, 403);
  assert.equal((await api('/api/users', { token })).status, 403);
  assert.equal((await api('/api/sync', { token })).status, 403);
});

test('URL malformada vira 400 e não derruba a API', async () => {
  const r = await api('/api/persons/%E0%A4%A/photo', { token: admin });
  assert.equal(r.status, 400);
  assert.equal((await api('/health')).json.ok, true);
});

test('identificação com payload inválido não derruba a API', async () => {
  const r = await api('/api/identification', {
    method: 'POST', token: admin,
    body: { device_id: 'dev_fit4_01', person_id: { id: 1 } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.motivo, 'PESSOA_NAO_ENCONTRADA');
  const dev = await api('/api/identification', { method: 'POST', token: admin, body: { device_id: 'dev_inexistente' } });
  assert.equal(dev.json.motivo, 'DEVICE_NAO_ENCONTRADO');
});

test('liberação manual registra evento mesmo sem edge', async () => {
  const r = await api('/api/release', {
    method: 'POST', token: admin,
    body: { device_id: 'dev_fit4_01', person_id: aluno.id },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.allow, true);
  const evs = await api('/api/events', { token: admin });
  assert.equal(evs.json[0].metodo, 'MANUAL');
});

test('backup e restore', async () => {
  const b = await api('/api/backup', { method: 'POST', token: admin });
  assert.equal(b.status, 201);
  const list = await api('/api/backup', { token: admin });
  assert.ok(list.json.some((x) => x.file === b.json.file));
  const restore = await api('/api/backup/restore', { method: 'POST', token: admin, body: { file: b.json.file } });
  assert.equal(restore.status, 200);
  const traversal = await api('/api/backup/restore', { method: 'POST', token: admin, body: { file: '../../etc/passwd' } });
  assert.equal(traversal.status, 400);
});

test('excluir pessoa é só gerência e limpa regras/fila', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { login: aluno.matricula, senha: aluno.matricula } });
  const recepcao = await api('/api/users', {
    method: 'POST', token: admin,
    body: { nome: 'Recep', login: `recep${run}`, senha: 'recep123', perfil: 'recepcao' },
  });
  assert.equal(recepcao.status, 201);
  const rl = await api('/api/auth/login', { method: 'POST', body: { login: recepcao.json.login, senha: 'recep123' } });
  const negado = await api(`/api/persons/${aluno.id}`, { method: 'DELETE', token: rl.json.token });
  assert.equal(negado.status, 403);

  const ok = await api(`/api/persons/${aluno.id}`, { method: 'DELETE', token: admin });
  assert.equal(ok.status, 200);
  const rules = await api(`/api/rules?personId=${aluno.id}`, { token: admin });
  assert.equal(rules.json.length, 0);
  const pessoa = await api(`/api/persons/${aluno.id}`, { method: 'PATCH', token: admin, body: { ativo: true } });
  assert.equal(pessoa.status, 404);
  assert.ok(login.json.token); // sessão antiga não derruba a API
});
