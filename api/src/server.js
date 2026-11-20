// API central. Node http puro, zero dependências. Roda em Linux e Windows.
// Serve também o PWA (front/) na mesma origem: um único endereço IP local.
//
// Regras gerais:
// - /api/* exige Bearer, exceto login; /api/*/photo aceita ?t=<token> (para <img>).
// - Bootstrap: carrega data/state.json, completa com o seed, autossalva.
// - Todo erro é convertido em resposta JSON (nunca derruba o processo).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideAccess } from './decision.js';
import { store, seed, nextId, ensureRules, TIPOS_PESSOA, METODOS } from './store.js';
import { getSystemInfo } from './system.js';
import { evaluateNotifications, ackNotification, listInadimplentes } from './notify.js';
import { doBackup, listBackups, doRestore } from './backup.js';
import { hashPassword, verifyPassword, issueToken, verifyToken, authenticate } from './auth.js';
import { visiblePersons, visibleEvents, canSeeOperations } from './scope.js';
import { parsePhoto, validatePhoto, savePhoto, readPhoto, deletePhoto } from './photos.js';
import { localDayKey, parseDate, isDateOnly } from './time.js';
import { enqueueSync, enqueueDelete, ackSync } from './sync.js';
import { DATA_FILE, loadState, saveIfDirty, startAutoSave, markDirty, appendEvent, compactEvents } from './persist.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONT_DIR = path.join(HERE, '..', '..', 'front');
const STATIC_TYPES = {
  '/': 'text/html', '/index.html': 'text/html',
  '/manifest.webmanifest': 'application/manifest+json',
  '/sw.js': 'application/javascript', '/icon.svg': 'image/svg+xml',
};

const PORT = Number(process.env.API_PORT || 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 2 * 1024 * 1024);
const EVENT_MAX = Number(process.env.EVENT_MAX || 50000);
const MIN_SCORE = Number(process.env.MIN_SCORE || 0.7);
const EDGE_URL = process.env.EDGE_URL || `http://localhost:${process.env.EDGE_PORT || 3002}`;
const EDGE_TOKEN = process.env.EDGE_TOKEN || '';
const NOTIFY_INTERVAL_MS = Number(process.env.NOTIFY_INTERVAL_MS || 5 * 60 * 1000);
const LOGIN_MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS || 5);
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------
let booted = false;
let notifyTimer = null;

export function bootstrap() {
  if (booted) return store;
  booted = true;
  try {
    if (loadState(store)) console.log('[persist] estado restaurado de data/state.json');
  } catch (e) {
    // Não apaga o arquivo: renomeia para inspeção e sobe com o seed.
    const broken = `${DATA_FILE}.corrupt-${Date.now()}`;
    try { fs.renameSync(DATA_FILE, broken); } catch {}
    console.log('[persist] estado corrompido, preservado em', broken, '—', e.message);
  }
  seed();
  store.meta.dedup = store.meta.dedup || {};
  try { evaluateNotifications(store); } catch (e) { console.log('[notify]', e.message); }
  markDirty();
  notifyTimer = setInterval(() => {
    try { evaluateNotifications(store); } catch (e) { console.log('[notify]', e.message); }
  }, NOTIFY_INTERVAL_MS);
  notifyTimer.unref();
  startAutoSave(store);
  return store;
}

// ---------------------------------------------------------------------------
// helpers HTTP
// ---------------------------------------------------------------------------
function corsHeaders() {
  if (!CORS_ORIGIN) return {};
  return { 'Access-Control-Allow-Origin': CORS_ORIGIN, Vary: 'Origin' };
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
  res.end(data);
}

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks = [];
    const end = (fn, arg) => { if (!done) { done = true; fn(arg); } };
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        end(reject, fail(413, `corpo maior que ${Math.round(limit / 1024)} KB`));
        req.resume(); // drena o restante sem acumular memória
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      if (!chunks.length) return end(resolve, {});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        end(resolve, parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        end(reject, fail(400, 'JSON inválido'));
      }
    });
    req.on('error', (e) => end(reject, e));
  });
}

function serveStatic(pathname, res) {
  if (!Object.hasOwn(STATIC_TYPES, pathname)) return false;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  try {
    const data = fs.readFileSync(path.join(FRONT_DIR, file));
    res.writeHead(200, {
      'Content-Type': `${STATIC_TYPES[pathname]}; charset=utf-8`,
      'Cache-Control': pathname === '/sw.js' ? 'no-cache' : 'no-cache',
    });
    res.end(data);
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// autenticação / perfis
// ---------------------------------------------------------------------------
function getUser(req, url) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/);
  if (m) return verifyToken(m[1]);
  // <img> não envia cabeçalho: aceita token na query apenas na rota de foto.
  if (url.pathname.endsWith('/photo')) {
    const t = url.searchParams.get('t');
    if (t) return verifyToken(t);
  }
  return null;
}

const isOperador = (u) => Boolean(u) && (u.perfil === 'recepcao' || u.perfil === 'gerencia');
const isGerencia = (u) => Boolean(u) && u.perfil === 'gerencia';

const loginAttempts = new Map();
function clientIp(req) {
  return req.socket.remoteAddress || 'desconhecido';
}
function loginBlocked(ip) {
  const a = loginAttempts.get(ip);
  if (!a) return false;
  if (Date.now() > a.until) { loginAttempts.delete(ip); return false; }
  return a.count >= LOGIN_MAX_FAILS;
}
function loginFailed(ip) {
  const a = loginAttempts.get(ip) || { count: 0, until: 0 };
  a.count += 1;
  a.until = Date.now() + LOGIN_WINDOW_MS;
  loginAttempts.set(ip, a);
  if (loginAttempts.size > 2000) loginAttempts.clear();
}

// ---------------------------------------------------------------------------
// domínio
// ---------------------------------------------------------------------------
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const METODO_MODE = { 2: 'SENHA', 3: 'CARTAO', 8: 'FACIAL' };

function cleanId(value) {
  const s = String(value ?? '').trim();
  return ID_RE.test(s) ? s : null;
}

function cleanText(value, max = 120) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : '';
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return null; }
}

// Resolve pessoa por id interno, matrícula ou enrollid (número do cartão no facial).
function resolvePerson(key) {
  if (key === null || key === undefined || key === '') return null;
  const k = String(key).trim();
  const direct = store.persons.get(k);
  if (direct) return direct;
  return [...store.persons.values()].find(
    (p) => p.matricula === k || String(p.enrollid) === k
  ) || null;
}

function metodoDoEvento(b) {
  const raw = String(b.metodo ?? '').toUpperCase();
  if (METODOS.includes(raw)) return raw;
  return METODO_MODE[Number(b.mode)] || 'FACIAL';
}

function defaultMatricula(tipo, enrollid) {
  return `${tipo === 'VISITANTE' ? 'V' : 'M'}${enrollid}`;
}

function publicPerson(p) {
  const { senhaHash, ...rest } = p;
  return rest;
}

function uniqueEnrollid() {
  const used = new Set([...store.persons.values()].map((p) => Number(p.enrollid)));
  let n = Number(store.meta.nextEnrollid) || 1001;
  while (used.has(n)) n += 1;
  store.meta.nextEnrollid = n + 1;
  return n;
}

function pushEvent(evt) {
  const event = { id: nextId('evt'), ...evt };
  store.events.push(event);
  if (store.events.length > EVENT_MAX + 1000) store.events.splice(0, store.events.length - EVENT_MAX);
  appendEvent(store, event);
  return event;
}

function todayEvents(now = new Date()) {
  const dia = localDayKey(now);
  return store.events.filter((e) => localDayKey(new Date(e.timestamp)) === dia);
}

// Presentes = última decisão ALLOW do dia e sem saída registrada depois.
function presentesHoje(events) {
  const ultima = new Map();
  for (const e of events) {
    if (e.decisao !== 'ALLOW' || !e.personId) continue;
    ultima.set(e.personId, e.direcao === 'OUT' ? 'OUT' : 'IN');
  }
  return [...ultima.values()].filter((d) => d !== 'OUT').length;
}

function normalizeValidity(value) {
  if (value == null || value === '') return null;
  const parsed = parseDate(value);
  if (!parsed) throw fail(400, 'data inválida (use AAAA-MM-DD ou ISO)');
  return isDateOnly(value) ? String(value).trim() : parsed.toISOString();
}

async function forwardRelease({ deviceId, direcao }) {
  try {
    const res = await fetch(`${EDGE_URL.replace(/\/$/, '')}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(EDGE_TOKEN ? { 'X-Edge-Token': EDGE_TOKEN } : {}) },
      body: JSON.stringify({ device_id: deviceId, direcao }),
      signal: AbortSignal.timeout(Number(process.env.EDGE_TIMEOUT_MS || 1500)),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// rotas
// ---------------------------------------------------------------------------
async function route(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(),
      ...(CORS_ORIGIN ? { 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } : {}),
    });
    return res.end();
  }

  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });

  // Login público (com limite de tentativas por IP).
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const ip = clientIp(req);
    if (loginBlocked(ip)) return send(res, 429, { error: 'muitas tentativas — aguarde alguns minutos' });
    const b = await readBody(req);
    const who = authenticate(store, b.login, b.senha);
    if (!who) {
      loginFailed(ip);
      return send(res, 401, { error: 'credenciais inválidas' });
    }
    loginAttempts.delete(ip);
    return send(res, 200, { ...who, token: issueToken(who) });
  }

  // Demais /api/* exigem token.
  const user = url.pathname.startsWith('/api/') ? getUser(req, url) : null;
  if (url.pathname.startsWith('/api/') && !user) return send(res, 401, { error: 'não autenticado' });

  const operadorOnly = () => {
    if (!isOperador(user)) throw fail(403, 'só equipe (recepção/gerência)');
  };
  const gerenciaOnly = () => {
    if (!isGerencia(user)) throw fail(403, 'só gerência');
  };

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
    gerenciaOnly();
    if (req.method === 'GET') {
      return send(res, 200, [...store.users.values()].map(({ senhaHash, ...u }) => u));
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (!b.login || !b.senha || String(b.senha).length < 4) return send(res, 400, { error: 'login e senha (mín. 4) obrigatórios' });
      if (!/^[A-Za-z0-9._@-]{3,40}$/.test(String(b.login))) return send(res, 400, { error: 'login inválido (3-40, letras/números/._@-)' });
      if (!['recepcao', 'gerencia'].includes(b.perfil)) return send(res, 400, { error: 'perfil deve ser recepcao|gerencia' });
      if ([...store.users.values()].some((u) => u.login === b.login)) return send(res, 409, { error: 'login já existe' });
      const u = { id: nextId('usr'), nome: cleanText(b.nome, 120) || b.login, login: String(b.login), senhaHash: hashPassword(b.senha), perfil: b.perfil };
      store.users.set(u.id, u);
      const { senhaHash, ...pub } = u;
      return send(res, 201, pub);
    }
  }

  // ------------------------------------------------------------------ pessoas
  if (req.method === 'GET' && url.pathname === '/api/persons') {
    return send(res, 200, visiblePersons([...store.persons.values()].map(publicPerson), user));
  }

  if (req.method === 'POST' && url.pathname === '/api/persons') {
    operadorOnly();
    const b = await readBody(req);
    const nome = cleanText(b.nome, 120);
    if (!nome) return send(res, 400, { error: 'nome obrigatório' });
    const tipo = TIPOS_PESSOA.includes(b.tipo) ? b.tipo : 'ALUNO';

    const id = b.id ? cleanId(b.id) : nextId('per');
    if (!id) return send(res, 400, { error: 'id inválido (letras, números, _ e -)' });
    if (store.persons.has(id)) return send(res, 409, { error: 'pessoa já existe com este id' });

    let enrollid;
    if (b.enrollid !== undefined && b.enrollid !== null && String(b.enrollid).trim() !== '') {
      enrollid = Number(b.enrollid);
      if (!Number.isInteger(enrollid) || enrollid < 1 || enrollid > 99999999) {
        return send(res, 400, { error: 'enrollid deve ser inteiro entre 1 e 99999999' });
      }
      if ([...store.persons.values()].some((p) => Number(p.enrollid) === enrollid)) {
        return send(res, 409, { error: 'enrollid já usado por outra pessoa' });
      }
    } else {
      enrollid = uniqueEnrollid();
    }

    const matricula = cleanText(b.matricula, 40) || defaultMatricula(tipo, enrollid);
    if ([...store.persons.values()].some((p) => p.matricula === matricula)) {
      return send(res, 409, { error: 'matrícula já existe' });
    }

    const person = {
      id, nome, matricula, tipo, treinutrix: cleanText(b.treinutrix, 200) || null,
      enrollid, ativo: b.ativo !== false,
      validadeIni: normalizeValidity(b.validadeIni),
      validadeFim: normalizeValidity(b.validadeFim),
      foto: null,
      senhaHash: hashPassword(b.senha || matricula),
      criadoEm: new Date().toISOString(),
    };
    if (b.foto) {
      const parsed = parsePhoto(b.foto);
      const ok = parsed && validatePhoto(parsed);
      if (!ok || !ok.ok) return send(res, 400, { error: ok ? ok.error : 'foto inválida' });
      savePhoto(id, parsed.buffer, ok.ext);
      person.foto = { ext: ok.ext, mime: ok.mime, bytes: ok.bytes, updatedAt: new Date().toISOString() };
    }
    store.persons.set(id, person);
    // Sem regra não há acesso: o cadastro já nasce liberado no horário padrão.
    ensureRules(store, id);
    enqueueSync(store, person);
    return send(res, 201, publicPerson(person));
  }

  // Foto do cadastro: ver, enviar e remover.
  const photoRoute = url.pathname.match(/^\/api\/persons\/([^/]+)\/photo$/);
  if (photoRoute) {
    const id = safeDecode(photoRoute[1]);
    if (!id) return send(res, 400, { error: 'id inválido' });
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
      if (!isOperador(user) && !self) throw fail(403, 'sem permissão');
      const b = await readBody(req);
      const parsed = parsePhoto(b.foto);
      const ok = parsed && validatePhoto(parsed);
      if (!ok || !ok.ok) return send(res, 400, { error: ok ? ok.error : 'foto inválida' });
      savePhoto(id, parsed.buffer, ok.ext);
      p.foto = { ext: ok.ext, mime: ok.mime, bytes: ok.bytes, updatedAt: new Date().toISOString() };
      enqueueSync(store, p);
      return send(res, 200, { ok: true, foto: p.foto });
    }

    if (req.method === 'DELETE') {
      operadorOnly();
      deletePhoto(id);
      p.foto = null;
      enqueueSync(store, p);
      return send(res, 200, { ok: true });
    }
  }

  // Regras de horário por equipamento.
  if (req.method === 'GET' && url.pathname === '/api/rules') {
    operadorOnly();
    const personId = url.searchParams.get('personId');
    const list = personId ? store.rules.filter((r) => r.personId === personId) : store.rules;
    return send(res, 200, list);
  }

  const rulesRoute = url.pathname.match(/^\/api\/persons\/([^/]+)\/rules$/);
  if (rulesRoute) {
    operadorOnly();
    const id = safeDecode(rulesRoute[1]);
    if (!id || !store.persons.has(id)) return send(res, 404, { error: 'person_not_found' });
    if (req.method === 'GET') return send(res, 200, store.rules.filter((r) => r.personId === id));
    if (req.method === 'PUT') {
      const b = await readBody(req);
      if (!Array.isArray(b.rules)) return send(res, 400, { error: 'rules deve ser uma lista' });
      const seen = new Set();
      const normalized = [];
      for (const r of b.rules) {
        const deviceId = cleanId(r && r.deviceId);
        if (!deviceId || !store.devices.has(deviceId)) return send(res, 400, { error: 'dispositivo inválido' });
        if (seen.has(deviceId)) return send(res, 400, { error: 'dispositivo repetido nas regras' });
        seen.add(deviceId);
        const diasSemana = Number(r.diasSemana);
        if (!Number.isInteger(diasSemana) || diasSemana < 0 || diasSemana > 127) {
          return send(res, 400, { error: 'diasSemana deve ser 0..127 (dom=1, seg=2, ter=4...)' });
        }
        const horaIni = String(r.horaIni || '').trim();
        const horaFim = String(r.horaFim || '').trim();
        if (!HHMM_RE.test(horaIni) || !HHMM_RE.test(horaFim)) return send(res, 400, { error: 'horário deve ser HH:MM' });
        normalized.push({ personId: id, deviceId, diasSemana, horaIni, horaFim });
      }
      store.rules = store.rules.filter((r) => r.personId !== id).concat(normalized);
      const p = store.persons.get(id);
      enqueueSync(store, p);
      return send(res, 200, normalized);
    }
  }

  // Atualizar cadastro (não muda enrollid: o cartão do leitor é imutável).
  const personRoute = url.pathname.match(/^\/api\/persons\/([^/]+)$/);
  if (personRoute && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const id = safeDecode(personRoute[1]);
    if (!id) return send(res, 400, { error: 'id inválido' });
    const p = store.persons.get(id);
    if (!p) return send(res, 404, { error: 'person_not_found' });

    if (req.method === 'DELETE') {
      gerenciaOnly();
      deletePhoto(id);
      store.persons.delete(id);
      store.rules = store.rules.filter((r) => r.personId !== id);
      enqueueDelete(store, id, p.enrollid);
      return send(res, 200, { ok: true });
    }

    operadorOnly();
    const b = await readBody(req);
    if (b.nome !== undefined) p.nome = cleanText(b.nome, 120) || p.nome;
    if (b.matricula !== undefined) {
      const m = cleanText(b.matricula, 40);
      if (!m) return send(res, 400, { error: 'matrícula vazia' });
      if ([...store.persons.values()].some((x) => x.id !== id && x.matricula === m)) {
        return send(res, 409, { error: 'matrícula já existe' });
      }
      p.matricula = m;
    }
    if (TIPOS_PESSOA.includes(b.tipo)) p.tipo = b.tipo;
    if (typeof b.ativo === 'boolean') p.ativo = b.ativo;
    if (b.treinutrix !== undefined) p.treinutrix = cleanText(b.treinutrix, 200) || null;
    if (b.senha) {
      if (String(b.senha).length < 4) return send(res, 400, { error: 'senha curta (mín. 4)' });
      p.senhaHash = hashPassword(b.senha);
    }
    if (b.validadeIni !== undefined) p.validadeIni = normalizeValidity(b.validadeIni);
    if (b.validadeFim !== undefined) p.validadeFim = normalizeValidity(b.validadeFim);
    if (b.foto === null) { deletePhoto(id); p.foto = null; }
    enqueueSync(store, p);
    return send(res, 200, publicPerson(p));
  }

  // ----------------------------------------------------------------- devices
  if (req.method === 'GET' && url.pathname === '/api/devices') {
    if (!canSeeOperations(user)) throw fail(403, 'sem permissão');
    return send(res, 200, [...store.devices.values()]);
  }
  if (req.method === 'POST' && url.pathname === '/api/devices') {
    gerenciaOnly();
    const b = await readBody(req);
    const nome = cleanText(b.nome, 120);
    if (!nome) return send(res, 400, { error: 'nome obrigatório' });
    const id = b.id ? cleanId(b.id) : nextId('dev');
    if (!id) return send(res, 400, { error: 'id inválido' });
    if (store.devices.has(id)) return send(res, 409, { error: 'dispositivo já existe' });
    const porta = Number(b.porta || 3570);
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return send(res, 400, { error: 'porta inválida' });
    const dev = {
      id, nome, ip: cleanText(b.ip, 60) || '', porta, tipo: cleanText(b.tipo, 20) || 'FIT4',
      online: false, lastSeen: null, criadoEm: new Date().toISOString(),
    };
    store.devices.set(id, dev);
    // Novos dispositivos já enxergam os cadastros existentes (regra + sync).
    for (const p of store.persons.values()) {
      ensureRules(store, p.id, [dev]);
      enqueueSync(store, p);
    }
    return send(res, 201, dev);
  }
  const hbRoute = url.pathname.match(/^\/api\/devices\/([^/]+)\/heartbeat$/);
  if (req.method === 'POST' && hbRoute) {
    operadorOnly();
    const id = safeDecode(hbRoute[1]);
    const dev = id && store.devices.get(id);
    if (!dev) return send(res, 404, { error: 'device_not_found' });
    dev.online = true;
    dev.lastSeen = new Date().toISOString();
    return send(res, 200, dev);
  }

  // ------------------------------------------------------------------ eventos
  if (req.method === 'GET' && url.pathname === '/api/events') {
    return send(res, 200, visibleEvents(store.events, user).slice(-200).reverse());
  }

  // --------------------------------------------------------------- sincronismo
  if (req.method === 'GET' && url.pathname === '/api/sync') {
    operadorOnly();
    const deviceId = url.searchParams.get('device_id');
    const status = url.searchParams.get('status');
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    let list = store.syncQueue;
    if (deviceId) list = list.filter((s) => s.deviceId === deviceId);
    if (status) list = list.filter((s) => s.status === status);
    list = [...list];
    // Edge pede ordem cronológica (asc); painel mostra o mais recente primeiro.
    return send(res, 200, deviceId ? list.slice(0, limit) : list.slice(-limit).reverse());
  }
  const syncAckRoute = url.pathname.match(/^\/api\/sync\/([^/]+)\/ack$/);
  if (req.method === 'POST' && syncAckRoute) {
    operadorOnly();
    const id = safeDecode(syncAckRoute[1]);
    const b = await readBody(req);
    const item = id ? ackSync(store, id, String(b.status || 'SENT').toUpperCase(), b.erro) : null;
    if (!item) return send(res, 404, { error: 'sync_not_found' });
    return send(res, 200, item);
  }

  // ------------------------------------------------------------ motor de acesso
  if (req.method === 'POST' && url.pathname === '/api/identification') {
    operadorOnly();
    const b = await readBody(req);
    const deviceId = cleanId(b.device_id);
    const dev = deviceId ? store.devices.get(deviceId) : null;
    if (!dev) {
      return send(res, 200, { allow: false, motivo: 'DEVICE_NAO_ENCONTRADO', display_msg: 'Equipamento não cadastrado.' });
    }

    // Idempotência: o leitor pode reenviar o mesmo logindex (retry de rede).
    const dedupKey = b.logindex !== undefined && b.logindex !== null ? `${deviceId}:${b.logindex}` : null;
    const dedup = store.meta.dedup || (store.meta.dedup = {});
    if (dedupKey && dedup[dedupKey]) return send(res, 200, dedup[dedupKey]);

    const person = resolvePerson(b.person_id);
    const metodo = metodoDoEvento(b);
    const at = parseDate(b.timestamp) || new Date();
    const result = decideAccess({
      person,
      rules: person ? store.rules.filter((r) => r.personId === person.id) : [],
      deviceId,
      at,
      score: b.score,
      minScore: MIN_SCORE,
      metodo,
    });

    dev.online = true;
    dev.lastSeen = new Date().toISOString();

    const personKey = person ? person.id : (b.person_id != null ? String(b.person_id).slice(0, 64) : null);
    pushEvent({
      deviceId, personId: personKey, timestamp: at.toISOString(),
      direcao: b.direcao === 'OUT' ? 'OUT' : 'IN', metodo,
      score: Number.isFinite(Number(b.score)) ? Number(b.score) : null,
      decisao: result.allow ? 'ALLOW' : 'DENY', motivo: result.motivo,
    });

    if (dedupKey) {
      dedup[dedupKey] = result;
      const keys = Object.keys(dedup);
      if (keys.length > 2000) for (const k of keys.slice(0, 1000)) delete dedup[k];
    }
    return send(res, 200, result);
  }

  // Liberação manual: registra e pede ao edge para abrir o giro.
  if (req.method === 'POST' && url.pathname === '/api/release') {
    operadorOnly();
    const b = await readBody(req);
    const deviceId = cleanId(b.device_id);
    const dev = deviceId ? store.devices.get(deviceId) : null;
    if (!dev) return send(res, 404, { error: 'device_not_found' });
    const person = resolvePerson(b.person_id);
    const direcao = b.direcao === 'OUT' ? 'OUT' : 'IN';
    pushEvent({
      deviceId, personId: person ? person.id : (b.person_id || null),
      timestamp: new Date().toISOString(), direcao, metodo: 'MANUAL',
      score: null, decisao: 'ALLOW', motivo: cleanText(b.motivo, 60) || 'MANUAL_OPERADOR',
    });
    const forwarded = await forwardRelease({ deviceId, direcao });
    return send(res, 200, {
      allow: true, motivo: 'MANUAL_OPERADOR', forwarded,
      display_msg: forwarded ? 'Acesso liberado.' : 'Registrado. Catraca não confirmou a abertura.',
    });
  }

  // ------------------------------------------------------------------- painéis
  if (req.method === 'GET' && url.pathname === '/api/overview') {
    operadorOnly();
    const inad = listInadimplentes(store);
    const hoje = todayEvents();
    return send(res, 200, {
      dia: localDayKey(),
      kpis: {
        eventosHoje: hoje.length,
        liberados: hoje.filter((e) => e.decisao === 'ALLOW').length,
        negados: hoje.filter((e) => e.decisao === 'DENY').length,
        presentes: presentesHoje(hoje),
        inadimplentes: inad.length,
        syncPendente: store.syncQueue.filter((s) => s.status === 'PENDING').length,
        notifPendentes: store.notifications.filter((n) => !n.resolvida).length,
        persons: store.persons.size,
      },
      inadimplentes: inad.map((p) => ({ id: p.id, nome: p.nome, matricula: p.matricula, validadeFim: p.validadeFim })),
      ultimasEntradas: hoje.filter((e) => e.decisao === 'ALLOW').slice(-8).reverse(),
      notifPendentes: store.notifications.filter((n) => !n.resolvida).slice(-5).reverse(),
      devices: [...store.devices.values()],
      lastBackupAt: store.meta.lastBackupAt,
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/system') {
    operadorOnly();
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
    operadorOnly();
    return send(res, 200, [...store.notifications].reverse());
  }
  if (req.method === 'POST' && url.pathname === '/api/notifications/evaluate') {
    operadorOnly();
    return send(res, 200, { created: evaluateNotifications(store) });
  }
  const ackNotifRoute = url.pathname.match(/^\/api\/notifications\/([^/]+)\/ack$/);
  if (req.method === 'POST' && ackNotifRoute) {
    operadorOnly();
    const b = await readBody(req);
    const id = safeDecode(ackNotifRoute[1]);
    const n = id ? ackNotification(store, id, cleanText(b.por, 80)) : null;
    if (!n) return send(res, 404, { error: 'not_found_or_resolved' });
    return send(res, 200, n);
  }

  // Backup: gerar snapshot, listar, restaurar (restaurar só gerência).
  if (req.method === 'POST' && url.pathname === '/api/backup') {
    operadorOnly();
    return send(res, 201, doBackup(store));
  }
  if (req.method === 'GET' && url.pathname === '/api/backup') {
    operadorOnly();
    return send(res, 200, listBackups());
  }
  if (req.method === 'POST' && url.pathname === '/api/backup/restore') {
    gerenciaOnly();
    const b = await readBody(req);
    try {
      const out = doRestore(store, b.file);
      compactEvents(store);
      return send(res, 200, out);
    } catch (e) {
      throw fail(400, e.message);
    }
  }

  if (req.method === 'GET' && serveStatic(url.pathname, res)) return;

  return send(res, 404, { error: 'not_found' });
}

async function handle(req, res) {
  try {
    await route(req, res);
  } catch (e) {
    const status = Number(e && e.status) || 500;
    if (status >= 500) console.log('[api]', req.method, req.url, e && (e.stack || e.message));
    try {
      if (!res.headersSent) send(res, status, { error: status >= 500 ? 'erro interno' : e.message });
      else res.end();
    } catch {
      try { res.destroy(); } catch {}
    }
  } finally {
    // Qualquer método que não seja leitura pode ter alterado o estado.
    if (req.method !== 'GET' && req.method !== 'OPTIONS') markDirty();
  }
}

export function createServer() {
  bootstrap();
  return http.createServer(handle);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createServer();
  server.listen(PORT, () => console.log(`API ouvindo em http://localhost:${PORT}`));
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      try { saveIfDirty(store); } catch {}
      process.exit(0);
    });
  }
}
