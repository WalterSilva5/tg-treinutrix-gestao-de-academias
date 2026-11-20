// Testes de integração HTTP. Cada arquivo roda em um processo próprio, então
// o ambiente abaixo isola dados/fotos/backups em diretórios temporários.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
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
process.env.EDGE_URL = 'http://127.0.0.1:1';

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
  assert.equal((await api('/health')).json.storage, 'sqlite');
  const bad = await api('/api/auth/login', { method: 'POST', body: { login: 'admin', senha: 'x' } });
  assert.equal(bad.status, 401);
  const noToken = await api('/api/persons');
  assert.equal(noToken.status, 401);
});

test('health consolidado mostra banco, contadores e edge', async () => {
  const r = await api('/api/health', { token: admin });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.storage.engine, 'sqlite');
  assert.ok(r.json.storage.bytes > 0);
  assert.ok(r.json.counts.persons >= 1);
  assert.equal(r.json.edge.ok, false);
  assert.match(r.json.commit, /^[0-9a-f]{7,40}$|^desconhecido$/);
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

test('importação em lote: prévia não grava, confirmação cria sem foto e deduplica', async () => {
  const antes = (await api('/api/persons', { token: admin })).json;
  const linhas = [
    { nome: `Importado ${run}`, matricula: `IMP${run}`, tipo: 'ALUNO', validadeFim: '2027-12-31' },
    { nome: 'Duplicado', matricula: antes[0] ? antes[0].matricula : `DUP${run}` },
    { nome: '', matricula: `SEMNOME${run}` },
  ];
  const previa = await api('/api/persons/import', { method: 'POST', token: admin, body: { confirmar: false, pessoas: linhas } });
  assert.equal(previa.status, 200, previa.text);
  assert.equal(previa.json.confirmado, false);
  assert.equal(previa.json.criados, 0);
  assert.equal(previa.json.itens[0].status, 'NOVO');
  assert.equal(previa.json.itens[1].status, 'JA_EXISTE');
  assert.equal(previa.json.itens[2].status, 'ERRO');
  assert.equal((await api('/api/persons', { token: admin })).json.length, antes.length);

  const conf = await api('/api/persons/import', { method: 'POST', token: admin, body: { confirmar: true, pessoas: linhas } });
  assert.equal(conf.status, 200, conf.text);
  assert.equal(conf.json.criados, 1);
  assert.equal(conf.json.ignorados, 1);
  assert.equal(conf.json.erros, 1);

  const pessoas = (await api('/api/persons', { token: admin })).json;
  const nova = pessoas.find((p) => p.matricula === `IMP${run}`);
  assert.ok(nova, 'pessoa importada existe');
  assert.equal(nova.foto, null, 'importação não exige biometria');
  assert.equal(nova.validadeFim, '2027-12-31');

  const sync = (await api(`/api/sync?device_id=dev_fit4_01&status=PENDING`, { token: admin })).json;
  assert.ok(sync.some((s) => s.personId === nova.id && s.payload?.enrollid === nova.enrollid));
});

test('catraca: editar, testar conexão e excluir com limpeza de regras/fila', async () => {
  const srv = net.createServer((s) => s.end());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;

  const criado = await api('/api/devices', {
    method: 'POST', token: admin,
    body: { nome: `Controlador ${run}`, driver: 'generic_http', ip: '127.0.0.1', porta },
  });
  assert.equal(criado.status, 201, criado.text);
  const dev = criado.json;
  assert.equal(dev.endpoint, `http://127.0.0.1:${porta}/open`);

  const editado = await api(`/api/devices/${encodeURIComponent(dev.id)}`, {
    method: 'PATCH', token: admin, body: { nome: `Controlador ${run} editado`, porta },
  });
  assert.equal(editado.status, 200, editado.text);
  assert.match(editado.json.nome, /editado/);

  const teste = await api(`/api/devices/${encodeURIComponent(dev.id)}/test`, { method: 'POST', token: admin, body: {} });
  assert.equal(teste.status, 200, teste.text);
  assert.equal(teste.json.ok, true);
  assert.ok(teste.json.latencyMs >= 0);
  await new Promise((r) => srv.close(r));

  // A pessoa do teste de cadastro ganhou regra e sync para o novo device.
  const regras = (await api('/api/rules', { token: admin })).json;
  assert.ok(regras.some((r) => r.deviceId === dev.id));

  const del = await api(`/api/devices/${encodeURIComponent(dev.id)}`, { method: 'DELETE', token: admin });
  assert.equal(del.status, 200, del.text);
  const regrasDepois = (await api('/api/rules', { token: admin })).json;
  assert.equal(regrasDepois.some((r) => r.deviceId === dev.id), false);
  const sync = (await api('/api/sync?device_id=' + encodeURIComponent(dev.id), { token: admin })).json;
  assert.equal(sync.length, 0);
});

test('descoberta recusa faixa pública sem varrer a rede', async () => {
  const r = await api('/api/devices/discover', { method: 'POST', token: admin, body: { subnet: '8.8.8.0/24' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /privadas/);
});

test('recuperação local do administrador padrão', async () => {
  const r = await api('/api/auth/recover-admin', { method: 'POST', body: { login: 'admin', senha: 'senhaNova123' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.login, 'admin');

  const velha = await api('/api/auth/login', { method: 'POST', body: { login: 'admin', senha: 'admin123' } });
  assert.equal(velha.status, 401);
  const nova = await api('/api/auth/login', { method: 'POST', body: { login: 'admin', senha: 'senhaNova123' } });
  assert.equal(nova.status, 200);
  assert.equal(nova.json.perfil, 'gerencia');

  // Devolve a senha padrão para o restante da suíte/ambiente de teste.
  const volta = await api('/api/auth/recover-admin', { method: 'POST', body: { login: 'admin', senha: 'admin123' } });
  assert.equal(volta.status, 200);
});


test('eventos: aluno e externo, check-in e export CSV/PDF', async () => {
  const p = await api('/api/persons', {
    method: 'POST', token: admin,
    body: { nome: 'Aluno Evento ' + run, tipo: 'ALUNO', validadeFim: '2027-12-31' },
  });
  assert.equal(p.status, 201, p.text);

  const ev = await api('/api/eventos', {
    method: 'POST', token: admin,
    body: { nome: 'Aul?o ' + run, inicio: '2026-12-01T19:00', local: 'Sala 1', capacidade: 10, permiteVisitantes: true },
  });
  assert.equal(ev.status, 201, ev.text);
  const id = ev.json.id;

  const a = await api('/api/eventos/' + id + '/participantes', { method: 'POST', token: admin, body: { personId: p.json.id } });
  assert.equal(a.status, 201, a.text);
  assert.equal(a.json.tipo, 'ALUNO');
  const x = await api('/api/eventos/' + id + '/participantes', { method: 'POST', token: admin, body: { nome: 'Externo ' + run, contato: '11 9999' } });
  assert.equal(x.status, 201, x.text);
  assert.equal(x.json.tipo, 'EXTERNO');

  const dup = await api('/api/eventos/' + id + '/participantes', { method: 'POST', token: admin, body: { personId: p.json.id } });
  assert.equal(dup.status, 400);

  const det = await api('/api/eventos/' + id, { token: admin });
  assert.equal(det.status, 200);
  assert.equal(det.json.participantes.length, 2);

  const chk = await api('/api/eventos/' + id + '/participantes/' + x.json.id, { method: 'PATCH', token: admin, body: { checkin: true } });
  assert.equal(chk.status, 200);
  assert.equal(chk.json.status, 'PRESENTE');

  const csv = await fetch(base + '/api/eventos/' + id + '/export.csv', { headers: { Authorization: 'Bearer ' + admin } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const csvText = await csv.text();
  assert.match(csvText, /Aluno Evento/);
  assert.match(csvText, /Externo/);
  assert.match(csvText, /;PRESENTE;/);

  const pdf = await fetch(base + '/api/eventos/' + id + '/export.pdf', { headers: { Authorization: 'Bearer ' + admin } });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  const pdfBuf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBuf.subarray(0, 8).toString(), '%PDF-1.4');
  assert.match(pdfBuf.subarray(-20).toString('latin1'), /%%EOF/);
});

test('sorteio de evento: eleg?veis, roleta, desabilitar, reset e entrega', async () => {
  const ev = await api('/api/eventos', {
    method: 'POST', token: admin,
    body: { nome: 'Evento Sorteio ' + run, inicio: '2026-12-02T19:00', permiteVisitantes: true },
  });
  const id = ev.json.id;
  await api('/api/eventos/' + id + '/participantes', { method: 'POST', token: admin, body: { nome: 'Concorrente A ' + run } });
  await api('/api/eventos/' + id + '/participantes', { method: 'POST', token: admin, body: { nome: 'Concorrente B ' + run } });

  const s = await api('/api/sorteios', {
    method: 'POST', token: admin,
    body: { nome: 'Sorteio ' + run, premio: '1 m?s', publico: 'EVENTO', eventId: id, entradasBase: 1, ativo: true },
  });
  assert.equal(s.status, 201, s.text);
  const sid = s.json.id;

  const eleg = await api('/api/sorteios/' + sid + '/elegiveis', { token: admin });
  assert.equal(eleg.status, 200);
  assert.equal(eleg.json.participantes.length, 2);

  const draw = await api('/api/sorteios/' + sid + '/sortear', { method: 'POST', token: admin, body: {} });
  assert.equal(draw.status, 200, draw.text);
  assert.ok(['Concorrente A ' + run, 'Concorrente B ' + run].includes(draw.json.vencedor.nome));
  assert.equal(draw.json.totalEntradas, 2);

  const lista = await api('/api/sorteios', { token: admin });
  assert.equal(lista.json.find((x) => x.id === sid).status, 'SORTEADA');
  const notif = await api('/api/notifications', { token: admin });
  assert.ok(notif.json.some((n) => n.tipo === 'SORTEIO' && n.titulo.includes('Sorteio ' + run)));

  const entrega = await api('/api/sorteios/' + sid + '/entregar', { method: 'POST', token: admin, body: { por: 'Recep??o' } });
  assert.equal(entrega.status, 200);
  assert.equal(entrega.json.entrega.entregue, true);

  const off = await api('/api/sorteios/' + sid, { method: 'PATCH', token: admin, body: { ativo: false } });
  assert.equal(off.status, 200);
  const reset = await api('/api/sorteios/' + sid + '/reset', { method: 'POST', token: admin, body: {} });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.vencedor, null);
  const negado = await api('/api/sorteios/' + sid + '/sortear', { method: 'POST', token: admin, body: {} });
  assert.equal(negado.status, 409);
});

test('sorteio valida p?blico e evento', async () => {
  const semEvento = await api('/api/sorteios', { method: 'POST', token: admin, body: { nome: 'X', publico: 'EVENTO' } });
  assert.equal(semEvento.status, 400);
  const publicoRuim = await api('/api/sorteios', { method: 'POST', token: admin, body: { nome: 'X', publico: 'NADA' } });
  assert.equal(publicoRuim.status, 400);
});


test('evento: lista de espera, check-in por c?digo e pagamento', async () => {
  const ev = await api('/api/eventos', {
    method: 'POST', token: admin,
    body: { nome: 'Lotado ' + run, inicio: '2026-12-03T19:00', capacidade: 1, valor: 50, permiteVisitantes: true, listaEspera: true },
  });
  assert.equal(ev.status, 201, ev.text);
  const id = ev.json.id;
  assert.match(ev.json.publicToken, /^[0-9a-f]{16}$/);

  const a = await api('/api/eventos/' + id + '/participantes', { method: 'POST', token: admin, body: { nome: 'Primeiro ' + run } });
  assert.equal(a.status, 201);
  assert.equal(a.json.status, 'INSCRITO');
  assert.match(a.json.codigo, /^[0-9A-F]{6}$/);
  const b = await api('/api/eventos/' + id + '/participantes', { method: 'POST', token: admin, body: { nome: 'Segundo ' + run } });
  assert.equal(b.status, 201);
  assert.equal(b.json.status, 'ESPERA');

  const cancel = await api('/api/eventos/' + id + '/participantes/' + a.json.id, { method: 'PATCH', token: admin, body: { status: 'CANCELADO' } });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.json.promovido.nome, 'Segundo ' + run);
  assert.equal(cancel.json.promovido.status, 'INSCRITO');

  const checkin = await api('/api/eventos/' + id + '/checkin', { method: 'POST', token: admin, body: { codigo: b.json.codigo } });
  assert.equal(checkin.status, 200);
  assert.equal(checkin.json.status, 'PRESENTE');

  const pago = await api('/api/eventos/' + id + '/participantes/' + b.json.id, { method: 'PATCH', token: admin, body: { pago: true } });
  assert.equal(pago.status, 200);
  assert.equal(pago.json.valorPago, 50);
  assert.equal(pago.json.pago, true);
});

test('evento p?blico: link sem login, inscri??o e p?gina', async () => {
  const ev = await api('/api/eventos', {
    method: 'POST', token: admin,
    body: { nome: 'P?blico ' + run, inicio: '2026-12-04T19:00', capacidade: 5, permiteVisitantes: true },
  });
  const token = ev.json.publicToken;
  const id = ev.json.id;

  const info = await api('/api/public/eventos/' + token, { auth: false });
  assert.equal(info.status, 200);
  assert.equal(info.json.nome, 'P?blico ' + run);
  assert.equal(info.json.restantes, 5);

  const insc = await api('/api/public/eventos/' + token + '/participantes', {
    method: 'POST', auth: false,
    body: { nome: 'Externo P?blico ' + run, contato: '11 98888' },
  });
  assert.equal(insc.status, 201, insc.text);
  assert.equal(insc.json.status, 'INSCRITO');
  assert.match(insc.json.codigo, /^[0-9A-F]{6}$/);

  const pagina = await api('/e/' + token, { auth: false });
  assert.equal(pagina.status, 200);
  assert.match(pagina.text, /Inscri/);

  const rot = await api('/api/eventos/' + id + '/token', { method: 'POST', token: admin, body: {} });
  assert.equal(rot.status, 200);
  assert.notEqual(rot.json.publicToken, token);
  const velho = await api('/api/public/eventos/' + token, { auth: false });
  assert.equal(velho.status, 404);
  const novo = await api('/api/public/eventos/' + rot.json.publicToken, { auth: false });
  assert.equal(novo.status, 200);
});

test('evento: duplicar, repetir, importar e promover externo', async () => {
  const ev = await api('/api/eventos', {
    method: 'POST', token: admin,
    body: { nome: 'S?rie ' + run, inicio: '2026-12-05T19:00', permiteVisitantes: true, valor: 0 },
  });
  const id = ev.json.id;

  const dup = await api('/api/eventos/' + id + '/duplicar', { method: 'POST', token: admin, body: {} });
  assert.equal(dup.status, 201);
  assert.match(dup.json.nome, /c?pia/);

  const rec = await api('/api/eventos/' + id + '/recorrencia', { method: 'POST', token: admin, body: { tipo: 'SEMANAL', vezes: 2 } });
  assert.equal(rec.status, 201);
  assert.equal(rec.json.criados.length, 2);

  const imp = await api('/api/eventos/' + id + '/participantes/import', {
    method: 'POST', token: admin,
    body: { pessoas: [{ nome: 'Importado A ' + run, contato: '1' }, { nome: 'Importado B ' + run, contato: '2' }] },
  });
  assert.equal(imp.status, 200, imp.text);
  assert.equal(imp.json.criados, 2);
  assert.equal(imp.json.erros, 0);

  const det = await api('/api/eventos/' + id, { token: admin });
  const externo = det.json.participantes.find((p) => p.nome === 'Importado A ' + run);
  assert.ok(externo, JSON.stringify(det.json.participantes.map((p) => p.nome)));
  const promo = await api('/api/eventos/' + id + '/participantes/' + externo.id + '/promover', {
    method: 'POST', token: admin, body: { tipo: 'VISITANTE' },
  });
  assert.equal(promo.status, 200, promo.text);
  assert.equal(promo.json.pessoa.tipo, 'VISITANTE');
  assert.ok(promo.json.pessoa.matricula);
  const pessoas = await api('/api/persons', { token: admin });
  assert.ok(pessoas.json.some((p) => p.id === promo.json.pessoa.id));
});

test('relat?rio de eventos: JSON, CSV e PDF por per?odo', async () => {
  const rel = await api('/api/relatorios/eventos?inicio=2026-12-01&fim=2026-12-31', { token: admin });
  assert.equal(rel.status, 200);
  assert.ok(rel.json.total >= 1);
  assert.ok(rel.json.eventos.some((e) => e.nome.startsWith('S?rie ' + run)));

  const csv = await fetch(base + '/api/relatorios/eventos.csv?inicio=2026-12-01&fim=2026-12-31', { headers: { Authorization: 'Bearer ' + admin } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /S?rie /);

  const pdf = await fetch(base + '/api/relatorios/eventos.pdf?inicio=2026-12-01&fim=2026-12-31', { headers: { Authorization: 'Bearer ' + admin } });
  assert.equal(pdf.status, 200);
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 8).toString(), '%PDF-1.4');
  assert.match(buf.subarray(-20).toString('latin1'), /%%EOF/);
});
