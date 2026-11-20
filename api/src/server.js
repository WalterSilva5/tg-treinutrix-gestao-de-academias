// API central. Node http puro, zero dependências. Roda em Linux e Windows.
import http from 'node:http';
import { decideAccess } from './decision.js';
import { store, seed, nextId } from './store.js';

seed();
const PORT = Number(process.env.API_PORT || 3001);

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

  return send(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => console.log(`API ouvindo em http://localhost:${PORT}`));
