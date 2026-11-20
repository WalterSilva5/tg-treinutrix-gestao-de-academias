// API central. Node http puro, zero dependências. Roda em Linux e Windows.
// Serve também o PWA (front/) na mesma origem: um único endereço IP local.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideAccess } from './decision.js';
import { store, seed, nextId } from './store.js';
import { getSystemInfo } from './system.js';
import { evaluateNotifications, ackNotification, listInadimplentes } from './notify.js';
import { doBackup, listBackups, doRestore } from './backup.js';

const FRONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'front');
const STATIC_TYPES = {
  '/': 'text/html', '/index.html': 'text/html',
  '/manifest.webmanifest': 'application/manifest+json',
  '/sw.js': 'application/javascript', '/icon.svg': 'image/svg+xml',
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' });
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });

  if (req.method === 'GET' && url.pathname === '/api/persons') {
    return send(res, 200, [...store.persons.values()]);
  }
  if (req.method === 'POST' && url.pathname === '/api/persons') {
    const b = await readBody(req);
    const id = b.id || nextId('per');
    const person = { id, nome: b.nome || 'Sem nome', matricula: b.matricula || id, ativo: b.ativo !== false, validadeIni: b.validadeIni || null, validadeFim: b.validadeFim || null };
    store.persons.set(id, person);
    for (const d of store.devices.values()) {
      store.syncQueue.push({ id: nextId('sync'), personId: id, deviceId: d.id, operacao: 'UPSERT', status: 'PENDING', tentativas: 0 });
    }
    return send(res, 201, person);
  }

  // Ativar/inativar aluno (inativo some das métricas de inadimplência e nega acesso).
  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/persons\/.+$/)) {
    const id = decodeURIComponent(url.pathname.split('/')[3]);
    const p = store.persons.get(id);
    if (!p) return send(res, 404, { error: 'person_not_found' });
    const b = await readBody(req);
    if (typeof b.ativo === 'boolean') p.ativo = b.ativo;
    if (b.nome !== undefined) p.nome = b.nome;
    if (b.validadeIni !== undefined) p.validadeIni = b.validadeIni;
    if (b.validadeFim !== undefined) p.validadeFim = b.validadeFim;
    for (const d of store.devices.values()) {
      store.syncQueue.push({ id: nextId('sync'), personId: id, deviceId: d.id, operacao: 'UPSERT', status: 'PENDING', tentativas: 0 });
    }
    return send(res, 200, p);
  }

  if (req.method === 'GET' && url.pathname === '/api/devices') {
    return send(res, 200, [...store.devices.values()]);
  }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/devices\/.+\/heartbeat$/)) {
    const id = url.pathname.split('/')[3];
    const dev = store.devices.get(id);
    if (!dev) return send(res, 404, { error: 'device_not_found' });
    dev.online = true;
    dev.lastSeen = new Date().toISOString();
    return send(res, 200, dev);
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    return send(res, 200, store.events.slice(-200).reverse());
  }

  if (req.method === 'GET' && url.pathname === '/api/sync') {
    return send(res, 200, store.syncQueue.slice(-100).reverse());
  }

  // Motor de decisão: chamado pelo edge a cada identificação facial.
  if (req.method === 'POST' && url.pathname === '/api/identification') {
    const b = await readBody(req);
    const person = store.persons.get(b.person_id) || null;
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
    const b = await readBody(req);
    store.events.push({
      id: nextId('evt'), deviceId: b.device_id, personId: b.person_id || null,
      timestamp: new Date().toISOString(), direcao: b.direcao || 'IN',
      metodo: 'MANUAL', score: null, decisao: 'ALLOW', motivo: b.motivo || 'MANUAL_OPERADOR',
    });
    return send(res, 200, { allow: true, motivo: 'MANUAL_OPERADOR', display_msg: 'Liberado pelo operador.' });
  }

  // Painel Sistema: info da máquina + contadores (overview estilo admin/overview).
  if (req.method === 'GET' && url.pathname === '/api/system') {
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
    return send(res, 200, [...store.notifications].reverse());
  }
  if (req.method === 'POST' && url.pathname === '/api/notifications/evaluate') {
    return send(res, 200, { created: evaluateNotifications(store) });
  }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/notifications\/.+\/ack$/)) {
    const b = await readBody(req);
    const n = ackNotification(store, url.pathname.split('/')[3], b.por);
    if (!n) return send(res, 404, { error: 'not_found_or_resolved' });
    return send(res, 200, n);
  }

  // Backup: gerar snapshot, listar, restaurar.
  if (req.method === 'POST' && url.pathname === '/api/backup') {
    try { return send(res, 201, doBackup(store)); }
    catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/backup') {
    try { return send(res, 200, listBackups()); }
    catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/backup/restore') {
    try {
      const b = await readBody(req);
      return send(res, 200, doRestore(store, b.file));
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (req.method === 'GET' && serveStatic(url.pathname, res)) return;

  return send(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => console.log(`API ouvindo em http://localhost:${PORT}`));
