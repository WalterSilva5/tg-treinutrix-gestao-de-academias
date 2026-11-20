// API central. Node http puro, zero dependências. Roda em Linux e Windows.
// Serve também o PWA (front/) na mesma origem: um único endereço IP local.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideAccess } from './decision.js';
import { store, seed, nextId, TIPOS_PESSOA } from './store.js';
import { getSystemInfo } from './system.js';
import { evaluateNotifications, ackNotification, listInadimplentes } from './notify.js';
import { doBackup, listBackups, doRestore } from './backup.js';
import { hashPassword, verifyPassword, issueToken, verifyToken, authenticate } from './auth.js';
import { visiblePersons, visibleEvents, canSeeOperations } from './scope.js';
import { parsePhoto, validatePhoto, savePhoto, readPhoto, deletePhoto } from './photos.js';
import { catalogo, normalizarDevice } from './devices.js';

const FRONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'front');
const STATIC_TYPES = {
  '/': 'text/html', '/index.html': 'text/html',
  '/manifest.webmanifest': 'application/manifest+json',
  '/sw.js': 'application/javascript', '/icon.svg': 'image/svg+xml', '/qr.js': 'application/javascript',
};

function serveStatic(pathname, res) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!Object.hasOwn(STATIC_TYPES, pathname)) return false;
  try {
    const data = fs.readFileSync(path.join(FRONT_DIR, file));
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[pathname] });
    res.end(data);
    return true;
  } catch { return false; }
}

seed();
const PORT = Number(process.env.API_PORT || 3001);
// Scheduler estilo wsi-invest-ai (lá: @Cron; aqui: setInterval zero-dep).
const NOTIFY_INTERVAL_MS = Number(process.env.NOTIFY_INTERVAL_MS || 5 * 60 * 1000);
evaluateNotifications(store);
setInterval(() => {
  try { evaluateNotifications(store); } catch (e) { console.log('[notify]', e.message); }
}, NOTIFY_INTERVAL_MS).unref();

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

// Auth: tudo em /api/* exige Bearer, exceto o login. Shell PWA é público.
// A foto aceita token por query (?t=) porque <img> não envia cabeçalho.
function getUser(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/);
  if (m) return verifyToken(m[1]);
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.endsWith('/photo')) {
    const t = url.searchParams.get('t');
    if (t) return verifyToken(t);
  }
  return null;
}
const isOperador = (u) => u && (u.perfil === 'recepcao' || u.perfil === 'gerencia');
const isGerencia = (u) => u && u.perfil === 'gerencia';

// Resolve pessoa por id interno, matrícula ou enrollid (número do cartão no facial).
function resolvePerson(key) {
  if (!key) return null;
  const direct = store.persons.get(String(key));
  if (direct) return direct;
  return [...store.persons.values()].find(
    (p) => p.matricula === String(key) || String(p.enrollid) === String(key)
  ) || null;
}

// Enfileira o cadastro para o leitor. O payload é leve: o edge busca a foto
// pela própria API quando houver (evita carregar base64 na fila).
function enqueueSync(person) {
  for (const d of store.devices.values()) {
    store.syncQueue.push({
      id: nextId('sync'), personId: person.id, deviceId: d.id, operacao: 'UPSERT',
      status: 'PENDING', tentativas: 0,
      payload: {
        cmd: 'setuserinfo',
        enrollid: person.enrollid,
        name: person.nome,
        backupnum: person.foto ? 50 : 0,
        foto: person.foto ? `/api/persons/${person.id}/photo` : null,
      },
    });
  }
}

function publicPerson(p) {
  const { senhaHash, ...rest } = p;
  return rest;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' });
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });

  // Login público.
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const b = await readBody(req);
    const who = authenticate(store, b.login, b.senha);
    if (!who) return send(res, 401, { error: 'credenciais inválidas' });
    return send(res, 200, { ...who, token: issueToken(who) });
  }

  // Demais /api/* exigem token.
  const user = url.pathname.startsWith('/api/') ? getUser(req) : null;
  if (url.pathname.startsWith('/api/') && !user) return send(res, 401, { error: 'não autenticado' });

  // Troca de senha (qualquer autenticado).
  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
    const b = await readBody(req);
    if (!b.nova || String(b.nova).length < 4) return send(res, 400, { error: 'nova senha curta (mín. 4)' });
    if (user.perfil === 'aluno') {
      const p = store.persons.get(user.sub);
      if (!p || !verifyPassword(b.atual, p.senhaHash || '')) return send(res, 401, { error: 'senha atual incorreta' });
      p.senhaHash = hashPassword(b.nova);
    } else {
      const u = store.users.get(user.sub);
      if (!u || !verifyPassword(b.atual, u.senhaHash)) return send(res, 401, { error: 'senha atual incorreta' });
      u.senhaHash = hashPassword(b.nova);
    }
    return send(res, 200, { ok: true });
  }

  // Gestão de operadores (só gerência).
  if (url.pathname === '/api/users') {
    if (!isGerencia(user)) return send(res, 403, { error: 'só gerência' });
    if (req.method === 'GET') {
      return send(res, 200, [...store.users.values()].map(({ senhaHash, ...u }) => u));
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (!b.login || !b.senha || String(b.senha).length < 4) return send(res, 400, { error: 'login e senha (mín. 4) obrigatórios' });
      if (!['recepcao', 'gerencia'].includes(b.perfil)) return send(res, 400, { error: 'perfil deve ser recepcao|gerencia' });
      if ([...store.users.values()].some((u) => u.login === b.login)) return send(res, 409, { error: 'login já existe' });
      const u = { id: nextId('usr'), nome: b.nome || b.login, login: b.login, senhaHash: hashPassword(b.senha), perfil: b.perfil };
      store.users.set(u.id, u);
      const { senhaHash, ...pub } = u;
      return send(res, 201, pub);
    }
  }

  const operadorOnly = () => {
    if (!isOperador(user)) { send(res, 403, { error: 'só equipe (recepção/gerência)' }); return false; }
    return true;
  };

  if (req.method === 'GET' && url.pathname === '/api/persons') {
    return send(res, 200, visiblePersons([...store.persons.values()].map(publicPerson), user));
  }
  if (req.method === 'POST' && url.pathname === '/api/persons') {
    if (!operadorOnly()) return;
    const b = await readBody(req);
    const id = b.id || nextId('per');
    const tipo = TIPOS_PESSOA.includes(b.tipo) ? b.tipo : 'ALUNO';
    const treinutrix = typeof b.treinutrix === 'string' && b.treinutrix.trim() ? b.treinutrix.trim() : null;
    const person = {
      id, nome: b.nome || 'Sem nome', matricula: b.matricula || id, tipo, treinutrix,
      enrollid: Number(b.enrollid) || store.meta.nextEnrollid++,
      ativo: b.ativo !== false, validadeIni: b.validadeIni || null, validadeFim: b.validadeFim || null,
      foto: null, senhaHash: hashPassword(b.senha || b.matricula || id),
    };
    if (b.foto) {
      const parsed = parsePhoto(b.foto);
      const ok = parsed && validatePhoto(parsed);
      if (!ok || !ok.ok) return send(res, 400, { error: ok ? ok.error : 'foto inválida' });
      savePhoto(id, parsed.buffer, ok.ext);
      person.foto = { ext: ok.ext, mime: ok.mime, bytes: ok.bytes, updatedAt: new Date().toISOString() };
    }
    store.persons.set(id, person);
    enqueueSync(person);
    return send(res, 201, publicPerson(person));
  }

  // Foto do cadastro: ver, enviar e remover.
  const photoRoute = url.pathname.match(/^\/api\/persons\/([^/]+)\/photo$/);
  if (photoRoute) {
    const id = decodeURIComponent(photoRoute[1]);
    const p = store.persons.get(id);
    if (!p) return send(res, 404, { error: 'person_not_found' });
    const self = user.perfil === 'aluno' && user.sub === id;

    if (req.method === 'GET') {
      if (user.perfil === 'aluno' && !self) return send(res, 403, { error: 'sem permissão' });
      if (!p.foto) return send(res, 404, { error: 'sem_foto' });
      const img = readPhoto(id, p.foto.ext);
      if (!img) return send(res, 404, { error: 'arquivo_ausente' });
      res.writeHead(200, { 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=60' });
      return res.end(img.buffer);
    }

    if (req.method === 'POST') {
      if (!isOperador(user) && !self) return send(res, 403, { error: 'sem permissão' });
      const b = await readBody(req);
      const parsed = parsePhoto(b.foto);
      const ok = parsed && validatePhoto(parsed);
      if (!ok || !ok.ok) return send(res, 400, { error: ok ? ok.error : 'foto inválida' });
      savePhoto(id, parsed.buffer, ok.ext);
      p.foto = { ext: ok.ext, mime: ok.mime, bytes: ok.bytes, updatedAt: new Date().toISOString() };
      enqueueSync(p);
      return send(res, 200, { ok: true, foto: p.foto });
    }

    if (req.method === 'DELETE') {
      if (!operadorOnly()) return;
      deletePhoto(id);
      p.foto = null;
      enqueueSync(p);
      return send(res, 200, { ok: true });
    }
  }

  // Ativar/inativar aluno (inativo some das métricas de inadimplência e nega acesso).
  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/persons\/.+$/)) {
    if (!operadorOnly()) return;
    const id = decodeURIComponent(url.pathname.split('/')[3]);
    const p = store.persons.get(id);
    if (!p) return send(res, 404, { error: 'person_not_found' });
    const b = await readBody(req);
    if (typeof b.ativo === 'boolean') p.ativo = b.ativo;
    if (b.nome !== undefined) p.nome = b.nome;
    if (TIPOS_PESSOA.includes(b.tipo)) p.tipo = b.tipo;
    if (b.treinutrix !== undefined) p.treinutrix = typeof b.treinutrix === 'string' && b.treinutrix.trim() ? b.treinutrix.trim() : null;
    if (b.senha) p.senhaHash = hashPassword(b.senha);
    if (b.validadeIni !== undefined) p.validadeIni = b.validadeIni;
    if (b.validadeFim !== undefined) p.validadeFim = b.validadeFim;
    if (b.foto === null) { deletePhoto(id); p.foto = null; }
    enqueueSync(p);
    return send(res, 200, publicPerson(p));
  }

  if (req.method === 'GET' && url.pathname === '/api/devices') {
    if (!canSeeOperations(user)) return send(res, 403, { error: 'sem permissão' });
    return send(res, 200, [...store.devices.values()]);
  }

  // Catálogo de catracas/controladores suportados.
  if (req.method === 'GET' && url.pathname === '/api/device-catalog') {
    if (!operadorOnly()) return;
    return send(res, 200, catalogo());
  }

  // Cadastro de nova catraca/controlador.
  if (req.method === 'POST' && url.pathname === '/api/devices') {
    if (!isGerencia(user)) return send(res, 403, { error: 'só gerência' });
    const b = await readBody(req);
    const r = normalizarDevice(b);
    if (!r.ok) return send(res, 400, { error: r.error });
    const device = { id: nextId('dev'), ...r.device, online: false, lastSeen: null, createdAt: new Date().toISOString() };
    store.devices.set(device.id, device);
    return send(res, 201, device);
  }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/devices\/.+\/heartbeat$/)) {
    if (!operadorOnly()) return;
    const id = url.pathname.split('/')[3];
    const dev = store.devices.get(id);
    if (!dev) return send(res, 404, { error: 'device_not_found' });
    dev.online = true;
    dev.lastSeen = new Date().toISOString();
    return send(res, 200, dev);
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    return send(res, 200, visibleEvents(store.events, user).slice(-200).reverse());
  }

  if (req.method === 'GET' && url.pathname === '/api/sync') {
    if (!operadorOnly()) return;
    return send(res, 200, store.syncQueue.slice(-100).reverse());
  }

  // Motor de decisão: chamado pelo edge a cada identificação facial.
  if (req.method === 'POST' && url.pathname === '/api/identification') {
    if (!operadorOnly()) return;
    const b = await readBody(req);
    const person = resolvePerson(b.person_id);
    const result = decideAccess({
      person,
      rules: store.rules.filter((r) => !b.person_id || r.personId === b.person_id),
      deviceId: b.device_id,
      at: b.timestamp ? new Date(b.timestamp) : new Date(),
      score: Number(b.score ?? 1),
    });
    store.events.push({
      id: nextId('evt'), deviceId: b.device_id, personId: b.person_id || null,
      timestamp: new Date().toISOString(), direcao: b.direcao || 'IN',
      metodo: 'FACIAL', score: b.score ?? null,
      decisao: result.allow ? 'ALLOW' : 'DENY', motivo: result.motivo,
    });
    return send(res, 200, result);
  }

  // Liberação manual pelo operador.
  if (req.method === 'POST' && url.pathname === '/api/release') {
    if (!operadorOnly()) return;
    const b = await readBody(req);
    store.events.push({
      id: nextId('evt'), deviceId: b.device_id, personId: b.person_id || null,
      timestamp: new Date().toISOString(), direcao: b.direcao || 'IN',
      metodo: 'MANUAL', score: null, decisao: 'ALLOW', motivo: b.motivo || 'MANUAL_OPERADOR',
    });
    return send(res, 200, { allow: true, motivo: 'MANUAL_OPERADOR', display_msg: 'Liberado pelo operador.' });
  }

  // Painel Sistema: info da máquina + contadores (overview estilo admin/overview).
  if (req.method === 'GET' && url.pathname === '/api/overview') {
    if (!operadorOnly()) return;
    const inad = listInadimplentes(store);
    const dia = new Date().toISOString().slice(0, 10);
    const hoje = store.events.filter((e) => e.timestamp.slice(0, 10) === dia);
    return send(res, 200, {
      dia,
      kpis: {
        eventosHoje: hoje.length,
        liberados: hoje.filter((e) => e.decisao === 'ALLOW').length,
        negados: hoje.filter((e) => e.decisao === 'DENY').length,
        presentes: new Set(hoje.filter((e) => e.decisao === 'ALLOW').map((e) => e.personId)).size,
        inadimplentes: inad.length,
        syncPendente: store.syncQueue.filter((s) => s.status === 'PENDING').length,
        notifPendentes: store.notifications.filter((n) => !n.resolvida).length,
        persons: store.persons.size,
      },
      inadimplentes: inad.map((p) => ({ id: p.id, nome: p.nome, matricula: p.matricula, validadeFim: p.validadeFim })),
      ultimasEntradas: hoje.slice(-8).reverse(),
      notifPendentes: store.notifications.filter((n) => !n.resolvida).slice(-5).reverse(),
      devices: [...store.devices.values()],
      lastBackupAt: store.meta.lastBackupAt,
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/system') {
    if (!operadorOnly()) return;
    const inad = listInadimplentes(store);
    return send(res, 200, {
      ...getSystemInfo(),
      counts: {
        persons: store.persons.size, devices: store.devices.size,
        events: store.events.length, syncPending: store.syncQueue.filter((s) => s.status === 'PENDING').length,
        notifications: store.notifications.filter((n) => !n.resolvida).length,
        inadimplentes: inad.length,
      },
      inadimplentes: inad.map((p) => ({ id: p.id, nome: p.nome, matricula: p.matricula, validadeFim: p.validadeFim })),
      lastBackupAt: store.meta.lastBackupAt,
    });
  }

  // Notificações: listar, avaliar agora, baixa manual com responsável.
  if (req.method === 'GET' && url.pathname === '/api/notifications') {
    if (!operadorOnly()) return;
    return send(res, 200, [...store.notifications].reverse());
  }
  if (req.method === 'POST' && url.pathname === '/api/notifications/evaluate') {
    if (!operadorOnly()) return;
    return send(res, 200, { created: evaluateNotifications(store) });
  }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/notifications\/.+\/ack$/)) {
    if (!operadorOnly()) return;
    const b = await readBody(req);
    const n = ackNotification(store, url.pathname.split('/')[3], b.por);
    if (!n) return send(res, 404, { error: 'not_found_or_resolved' });
    return send(res, 200, n);
  }

  // Backup: gerar snapshot, listar, restaurar (restaurar só gerência).
  if (req.method === 'POST' && url.pathname === '/api/backup') {
    if (!operadorOnly()) return;
    try { return send(res, 201, doBackup(store)); }
    catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/backup') {
    if (!operadorOnly()) return;
    try { return send(res, 200, listBackups()); }
    catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/backup/restore') {
    if (!isGerencia(user)) return send(res, 403, { error: 'só gerência' });
    try {
      const b = await readBody(req);
      return send(res, 200, doRestore(store, b.file));
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (req.method === 'GET' && serveStatic(url.pathname, res)) return;

  return send(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => console.log(`API ouvindo em http://localhost:${PORT}`));
