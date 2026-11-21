// API central. Node http puro, zero dependências. Roda em Linux e Windows.
// Serve também o PWA (front/) na mesma origem: um único endereço IP local.
//
// Regras gerais:
// - /api/* exige Bearer, exceto login; /api/*/photo aceita ?t=<token> (para <img>).
// - Bootstrap: carrega data/state.json, completa com o seed, autossalva.
// - Todo erro é convertido em resposta JSON (nunca derruba o processo).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideAccess } from './decision.js';
import { store, seed, nextId, ensureRules, TIPOS_PESSOA, METODOS } from './store.js';
import { getSystemInfo } from './system.js';
import { evaluateNotifications, ackNotification, listInadimplentes } from './notify.js';
import { doBackup, listBackups, doRestore } from './backup.js';
import { hashPassword, verifyPassword, issueToken, verifyToken, authenticate, TOKEN_TTL_MS } from './auth.js';
import { visiblePersons, visibleEvents, canSeeOperations } from './scope.js';
import { parsePhoto, validatePhoto, savePhoto, readPhoto, deletePhoto } from './photos.js';
import { localDayKey, parseDate, isDateOnly, endOfDay } from './time.js';
import { enqueueSync, enqueueDelete, ackSync } from './sync.js';
import { DB_FILE, loadState, saveNow, saveIfDirty, startAutoSave, markDirty, appendEvent, compactEvents, closeDb, replaceEvents } from './persist.js';
import { catalogo, normalizarDevice } from './devices.js';
import { diasFrequentados, alunosNoDia } from './frequency.js';
import { descobrirCatracas, probarTcp, redesLocais, normalizarSubnet } from './discovery.js';
import {
  normalizarEvento, normalizarSorteio, novoEvento, novaInscricao, elegiveis, sortear, sortearVarios,
  STATUS_PARTICIPANTE, promoverEspera, gerarRecorrencias, eventoPorToken,
} from './social.js';
import { eventoParaCsv, eventoParaPdf, nomeArquivoEvento, eventosParaCsv, eventosParaPdf, sorteioParaCsv, sorteioParaPdf, csvTabela, pdfTexto } from './report.js';
import { relatorioGeral } from './reports.js';
import { relatorioFinanceiro } from './finance.js';
import { serialize } from './state.js';
import {
  normalizarPlano, novoPlano, criarAssinatura, cancelarAssinatura,
  gerarCobrancasMes, planosAtivos, usoDaSemana,
} from './plans.js';
import { aplicarRetencao } from './retention.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONT_DIR = path.join(HERE, '..', '..', 'front');
const STATIC_TYPES = {
  '/': 'text/html', '/index.html': 'text/html',
  '/manifest.webmanifest': 'application/manifest+json',
  '/sw.js': 'application/javascript', '/icon.svg': 'image/svg+xml', '/qr.js': 'application/javascript',
  '/evento.html': 'text/html',
};

const PORT = Number(process.env.API_PORT || 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 2 * 1024 * 1024);
const IMPORT_MAX_ROWS = Number(process.env.IMPORT_MAX_ROWS || 20000);
const IMPORT_MAX_BYTES = Number(process.env.IMPORT_MAX_BYTES || 10 * 1024 * 1024);
const EVENT_MAX = Number(process.env.EVENT_MAX || 50000);
const MIN_SCORE = Number(process.env.MIN_SCORE || 0.7);
const EDGE_URL = process.env.EDGE_URL || `http://localhost:${process.env.EDGE_PORT || 3002}`;
const EDGE_TOKEN = process.env.EDGE_TOKEN || '';
const NOTIFY_INTERVAL_MS = Number(process.env.NOTIFY_INTERVAL_MS || 5 * 60 * 1000);
const LOGIN_MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS || 5);
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 5 * 60 * 1000);
const PKG = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'package.json'), 'utf8')); }
  catch { return { version: '0.0.0' }; }
})();
function commitAtual() {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.slice(0, 12);
  try {
    const git = path.join(HERE, '..', '..', '.git');
    const head = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref: ')) return fs.readFileSync(path.join(git, head.slice(5)), 'utf8').trim().slice(0, 12);
    return head.slice(0, 12);
  } catch { return 'desconhecido'; }
}
const GIT_COMMIT = commitAtual();
const DISCOVER_MIN_MS = Number(process.env.DISCOVER_MIN_MS || 5000);
const RAFFLE_INTERVAL_MS = Number(process.env.RAFFLE_INTERVAL_MS || 60000);
const RETENCAO = {
  eventosDias: Number(process.env.RETENTION_EVENT_DAYS ?? 365),
  externosDias: Number(process.env.RETENTION_EXTERNAL_DAYS ?? 365),
  socialDias: Number(process.env.RETENTION_SOCIAL_DAYS ?? 0),
  fotosDias: Number(process.env.RETENTION_PHOTO_DAYS ?? 0),
  unknownDias: Number(process.env.RETENTION_UNKNOWN_DAYS ?? 30),
};
const RETENCAO_INTERVALO_H = Number(process.env.RETENTION_INTERVAL_HOURS ?? 24);
let retentionTimer = null;
const UNKNOWN_DIR = process.env.UNKNOWN_DIR || path.join(path.dirname(DB_FILE), 'unknown');
let ultimaVarredura = 0;
let varrendo = false;
let raffleTimer = null;
const sorteando = new Set();

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------
let booted = false;
let notifyTimer = null;
let backupTimer = null;

export function bootstrap() {
  if (booted) return store;
  booted = true;
  try {
    if (loadState(store)) console.log(`[persist] estado restaurado de ${DB_FILE}`);
  } catch (e) {
    // Não apaga o banco: renomeia para inspeção e sobe com o seed.
    try { closeDb(); } catch {}
    const stamp = Date.now();
    for (const sufixo of ['', '-wal', '-shm']) {
      const origem = `${DB_FILE}${sufixo}`;
      if (!fs.existsSync(origem)) continue;
      try { fs.renameSync(origem, `${origem}.corrupt-${stamp}`); } catch {}
    }
    console.log('[persist] banco corrompido, preservado com sufixo .corrupt-', stamp, '—', e.message);
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
  const backupHoras = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
  if (backupHoras > 0) {
    backupTimer = setInterval(() => {
      try {
        doBackup(store);
        markDirty();
        console.log('[backup] automático concluído');
      } catch (e) { console.log('[backup]', e.message); }
    }, backupHoras * 3600 * 1000);
    backupTimer.unref();
  }
  // Sorteios programados: avalia no boot e a cada minuto.
  if (RAFFLE_INTERVAL_MS > 0) {
    try { sortearProgramados(); } catch (e) { console.log('[sorteio]', e.message); }
    raffleTimer = setInterval(() => {
      try { sortearProgramados(); } catch (e) { console.log('[sorteio]', e.message); }
    }, RAFFLE_INTERVAL_MS);
    raffleTimer.unref();
  }
  if (RETENCAO_INTERVALO_H > 0) {
    try { executarRetencao(); } catch (e) { console.log('[retencao]', e.message); }
    retentionTimer = setInterval(() => {
      try { executarRetencao(); } catch (e) { console.log('[retencao]', e.message); }
    }, RETENCAO_INTERVALO_H * 3600 * 1000);
    retentionTimer.unref();
  }
  return store;
}

function executarRetencao(agora = new Date()) {
  const r = aplicarRetencao(store, { agora, ...RETENCAO });
  let mudou = false;
  for (const id of r.fotosParaRemover) {
    const p = store.persons.get(id);
    if (!p) continue;
    try { deletePhoto(id); } catch { /* arquivo já ausente */ }
    p.foto = null;
    mudou = true;
  }
  if (r.rostosParaRemover.length) {
    const remover = new Set(r.rostosParaRemover);
    for (const u of store.unknownFaces || []) {
      if (!remover.has(u.id)) continue;
      try { fs.rmSync(path.join(UNKNOWN_DIR, `${u.id}.${u.ext}`), { force: true }); } catch { }
    }
    store.unknownFaces = (store.unknownFaces || []).filter((u) => !remover.has(u.id));
    mudou = true;
  }
  if (r.eventosRemovidos > 0) {
    replaceEvents(store);
    mudou = true;
  }
  if (r.externosAnonimizados > 0 || r.eventosSociaisRemovidos > 0) mudou = true;
  if (mudou) {
    saveNow(store);
    console.log(`[retencao] eventos=${r.eventosRemovidos} externos=${r.externosAnonimizados} social=${r.eventosSociaisRemovidos} fotos=${r.fotosParaRemover.length}`);
  }
  return r;
}

// Executa sorteios ATIVOS cuja data programada já passou.
function sortearProgramados(agora = new Date()) {
  for (const r of store.raffles) {
    if (!r.ativo || r.status !== 'ATIVA' || !r.sorteioEm) continue;
    const quando = new Date(r.sorteioEm);
    if (Number.isNaN(quando.getTime()) || quando > agora) continue;
    try {
      realizarSorteio(r, { agora, automatico: true, por: 'automático' });
      console.log(`[sorteio] ${r.nome}: ${r.vencedores.map((v) => v.nome).join(', ')}`);
    } catch (e) {
      if (r.ultimoErro !== e.message) console.log(`[sorteio] ${r.nome}: ${e.message}`);
      r.ultimoErro = e.message;
    }
  }
}

function realizarSorteio(r, { agora = new Date(), randomInt, por = 'operador', automatico = false } = {}) {
  if (sorteando.has(r.id)) throw new Error('sorteio em andamento');
  sorteando.add(r.id);
  try {
    const out = sortearVarios(store, r, {
      quantidade: r.ganhadoresQtd || 1, agora, randomInt,
    });
    r.vencedores = out.vencedores;
    r.vencedor = out.vencedores[0] || null;
    r.totalParticipantes = out.totalParticipantes;
    r.totalEntradas = out.totalEntradas;
    r.status = 'SORTEADA';
    r.sorteadoEm = agora.toISOString();
    r.ultimoErro = null;
    const registro = {
      id: nextId('sdr'),
      raffleId: r.id,
      raffleNome: r.nome,
      premio: r.premio,
      vencedores: out.vencedores,
      totalParticipantes: out.totalParticipantes,
      totalEntradas: out.totalEntradas,
      sorteadoEm: r.sorteadoEm,
      automatico,
      por,
    };
    store.raffleDraws.unshift(registro);
    if (store.raffleDraws.length > 1000) store.raffleDraws.length = 1000;
    store.notifications.push({
      id: nextId('ntf'),
      key: `sorteio:${registro.id}`,
      tipo: 'SORTEIO',
      titulo: `Sorteio realizado: ${r.nome}`,
      detalhe: `Ganhador(es): ${out.vencedores.map((v) => `${v.nome}${v.matricula ? ` (${v.matricula})` : ''}`).join(', ')} - prêmio: ${r.premio || 'não informado'}.`,
      createdAt: agora.toISOString(),
      resolvida: false,
      resolvidaPor: null,
      resolvidaEm: null,
    });
    markDirty();
    return { ...out, vencedor: out.vencedores[0] || null };
  } finally {
    sorteando.delete(r.id);
  }
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

function ehLoopback(req) {
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1';
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
  let payload = null;
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/);
  if (m) payload = verifyToken(m[1]);
  if (!payload) {
    const cookie = lerCookie(req);
    if (cookie) payload = verifyToken(cookie);
  }
  // <img> não envia cabeçalho: aceita token na query apenas na rota de foto.
  if (!payload && url.pathname.endsWith('/photo')) {
    const t = url.searchParams.get('t');
    if (t) payload = verifyToken(t);
  }
  if (!payload) return null;
  if ((Number(payload.epoch) || 0) !== (Number(store.meta.sessionEpoch) || 0)) return null;
  const ent = payload.perfil === 'aluno' ? store.persons.get(payload.sub) : store.users.get(payload.sub);
  if (!ent) return null;
  if ((Number(payload.ver) || 0) !== (Number(ent.tokenVersion) || 0)) return null;
  return { ...payload, mustChangePassword: ent.mustChangePassword === true };
}

const COOKIE_NAME = 'painel_token';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

function lerCookie(req) {
  const raw = String(req.headers.cookie || '');
  for (const parte of raw.split(';')) {
    const [nome, ...resto] = parte.trim().split('=');
    if (nome === COOKIE_NAME) {
      try { return decodeURIComponent(resto.join('=')); } catch { return null; }
    }
  }
  return null;
}

function definirCookieSessao(req, res, token) {
  const seguro = COOKIE_SECURE || Boolean(req.socket.encrypted) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}${seguro}`);
}

function limparCookieSessao(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function entradaDe(user) {
  if (!user) return null;
  return user.perfil === 'aluno' ? store.persons.get(user.sub) : store.users.get(user.sub);
}

function auditar(user, acao, detalhe = '', req = null) {
  store.audit = store.audit || [];
  store.audit.unshift({
    id: nextId('aud'),
    em: new Date().toISOString(),
    por: user?.nome || user?.sub || 'sistema',
    perfil: user?.perfil || '',
    ip: req ? clientIp(req) : '',
    acao,
    detalhe: String(detalhe || '').slice(0, 300),
  });
  if (store.audit.length > 2000) store.audit.length = 2000;
  markDirty();
}

const isOperador = (u) => Boolean(u) && (u.perfil === 'recepcao' || u.perfil === 'gerencia');
const isGerencia = (u) => Boolean(u) && u.perfil === 'gerencia';

const loginAttempts = new Map();
const publicAttempts = new Map();
const PUBLIC_MAX = Number(process.env.PUBLIC_MAX_HITS || 20);
const PUBLIC_WINDOW_MS = Number(process.env.PUBLIC_WINDOW_MS || 10 * 60 * 1000);

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

// Limite simples para inscrição pública (sem autenticação).
function publicBlocked(ip) {
  const a = publicAttempts.get(ip);
  if (!a) return false;
  if (Date.now() > a.until) { publicAttempts.delete(ip); return false; }
  return a.count >= PUBLIC_MAX;
}
function publicHit(ip) {
  const a = publicAttempts.get(ip) || { count: 0, until: 0 };
  a.count += 1;
  a.until = Date.now() + PUBLIC_WINDOW_MS;
  publicAttempts.set(ip, a);
  if (publicAttempts.size > 5000) publicAttempts.clear();
}

const limites = new Map();
function limitar(chave, max, janelaMs) {
  const agora = Date.now();
  const a = limites.get(chave);
  if (!a || agora > a.until) {
    limites.set(chave, { count: 1, until: agora + janelaMs });
    return true;
  }
  if (a.count >= max) return false;
  a.count += 1;
  return true;
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
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : '';
}

// CPF é opcional e não bloqueia cadastro; guarda só dígitos quando houver.
function limparCpf(value) {
  const d = String(value ?? '').replace(/\D/g, '');
  return d ? d.slice(0, 11) : null;
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

// Valida e monta a pessoa (não grava). Usado pelo cadastro unitário e pela
// importação em lote, para as duas rotas terem exatamente as mesmas regras.
function criarPessoa(b) {
  const nome = cleanText(b.nome, 120);
  if (!nome) throw fail(400, 'nome obrigatório');
  const tipo = TIPOS_PESSOA.includes(b.tipo) ? b.tipo : 'ALUNO';

  const id = b.id ? cleanId(b.id) : nextId('per');
  if (!id) throw fail(400, 'id inválido (letras, números, _ e -)');
  if (store.persons.has(id)) throw fail(409, 'pessoa já existe com este id');

  let enrollid;
  if (b.enrollid !== undefined && b.enrollid !== null && String(b.enrollid).trim() !== '') {
    enrollid = Number(b.enrollid);
    if (!Number.isInteger(enrollid) || enrollid < 1 || enrollid > 99999999) {
      throw fail(400, 'enrollid deve ser inteiro entre 1 e 99999999');
    }
    if ([...store.persons.values()].some((p) => Number(p.enrollid) === enrollid)) {
      throw fail(409, 'enrollid já usado por outra pessoa');
    }
  } else {
    enrollid = uniqueEnrollid();
  }

  const matricula = cleanText(b.matricula, 40) || defaultMatricula(tipo, enrollid);
  if ([...store.persons.values()].some((p) => p.matricula === matricula)) {
    throw fail(409, 'matrícula já existe');
  }

  const person = {
    id, nome, matricula, tipo, treinutrix: cleanText(b.treinutrix, 200) || null,
    cpf: limparCpf(b.cpf),
    telefone: cleanText(b.telefone, 40) || null,
    email: cleanText(b.email, 120).toLowerCase() || null,
    nascimento: cleanText(b.nascimento, 20) || null,
    endereco: cleanText(b.endereco, 200) || null,
    bairro: cleanText(b.bairro, 100) || null,
    cidade: cleanText(b.cidade, 100) || null,
    cep: cleanText(b.cep, 20) || null,
    observacoes: cleanText(b.observacoes, 1000) || null,
    enrollid, ativo: b.ativo !== false,
    validadeIni: normalizeValidity(b.validadeIni),
    validadeFim: normalizeValidity(b.validadeFim),
    foto: null,
    senhaHash: hashPassword(b.senha || matricula),
    tokenVersion: 0,
    mustChangePassword: !b.senha,
    criadoEm: new Date().toISOString(),
  };
  if (b.foto) {
    const parsed = parsePhoto(b.foto);
    const ok = parsed && validatePhoto(parsed);
    if (!ok || !ok.ok) throw fail(400, ok ? ok.error : 'foto inválida');
    savePhoto(id, parsed.buffer, ok.ext);
    person.foto = { ext: ok.ext, mime: ok.mime, bytes: ok.bytes, updatedAt: new Date().toISOString() };
  }
  return person;
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

function normalizeValidity(value) {
  if (value == null || value === '') return null;
  const parsed = parseDate(value);
  if (!parsed) throw fail(400, 'data inválida (use AAAA-MM-DD ou ISO)');
  return isDateOnly(value) ? String(value).trim() : parsed.toISOString();
}

const IMPORT_FIELDS = new Set(['nome', 'matricula', 'tipo', 'enrollid', 'validadeIni', 'validadeFim', 'treinutrix', 'ativo', 'senha', 'foto', 'cpf', 'telefone', 'email', 'nascimento', 'endereco', 'bairro', 'cidade', 'cep', 'observacoes']);

function mapearLinha(linha, mapeamento) {
  if (!mapeamento || typeof mapeamento !== 'object') return linha;
  const out = { ...linha };
  for (const [campo, origem] of Object.entries(mapeamento)) {
    if (!IMPORT_FIELDS.has(campo) || !origem) continue;
    if (linha[origem] !== undefined) out[campo] = linha[origem];
  }
  return out;
}

// Importação de pessoas com prévia, upsert, fotos e gravação atômica.
function importarPessoas(store, b, { por = 'operador' } = {}) {
  const linhas = Array.isArray(b.pessoas) ? b.pessoas : null;
  if (!linhas) throw Object.assign(new Error('pessoas deve ser uma lista'), { status: 400 });
  if (linhas.length > IMPORT_MAX_ROWS) {
    throw Object.assign(new Error(`máximo de ${IMPORT_MAX_ROWS} linhas por importação`), { status: 413 });
  }
  const confirmar = b.confirmar === true;
  const modo = String(b.modo || 'IGNORAR').toUpperCase() === 'ATUALIZAR' ? 'ATUALIZAR' : 'IGNORAR';
  const atomic = b.atomic !== false;
  const ignorarErros = b.ignorarErros === true;

  const usadosEnroll = new Set([...store.persons.values()].map((p) => Number(p.enrollid)));
  const usadosMat = new Set([...store.persons.values()].map((p) => p.matricula));
  let proximoEnroll = Number(store.meta.nextEnrollid) || 1001;
  const alocarEnroll = () => {
    while (usadosEnroll.has(proximoEnroll)) proximoEnroll += 1;
    const n = proximoEnroll;
    proximoEnroll += 1;
    usadosEnroll.add(n);
    return n;
  };
  const plano = [];
  const itens = [];
  let criados = 0;
  let atualizados = 0;
  let ignorados = 0;
  let erros = 0;
  const alvos = new Set();

  linhas.forEach((original, i) => {
    const numero = i + 1;
    const linha = mapearLinha(original || {}, b.mapeamento);
    const nome = cleanText(linha.nome, 120);
    const matricula = cleanText(linha.matricula, 40) || null;
    try {
      if (!nome) throw new Error('nome obrigatório');
      const tipo = TIPOS_PESSOA.includes(linha.tipo) ? linha.tipo : 'ALUNO';
      const enrollTexto = linha.enrollid !== undefined && linha.enrollid !== null ? String(linha.enrollid).trim() : '';
      let enrollid = null;
      if (enrollTexto !== '') {
        enrollid = Number(enrollTexto);
        if (!Number.isInteger(enrollid) || enrollid < 1 || enrollid > 99999999) throw new Error('enrollid inválido');
      }
      const validadeIni = normalizeValidity(linha.validadeIni);
      const validadeFim = normalizeValidity(linha.validadeFim);
      const ativo = linha.ativo === undefined ? true
        : !['0', 'false', 'nao', 'não', 'inativo', 'n'].includes(String(linha.ativo).trim().toLowerCase());
      const extras = {
        cpf: limparCpf(linha.cpf),
        telefone: cleanText(linha.telefone, 40) || null,
        email: cleanText(linha.email, 120).toLowerCase() || null,
        nascimento: cleanText(linha.nascimento, 20) || null,
        endereco: cleanText(linha.endereco, 200) || null,
        bairro: cleanText(linha.bairro, 100) || null,
        cidade: cleanText(linha.cidade, 100) || null,
        cep: cleanText(linha.cep, 20) || null,
        observacoes: cleanText(linha.observacoes, 1000) || null,
      };
      let foto = null;
      if (linha.foto) {
        const parsed = parsePhoto(linha.foto);
        const ok = parsed && validatePhoto(parsed);
        if (!ok || !ok.ok) throw new Error(ok ? ok.error : 'foto inválida');
        foto = { buffer: parsed.buffer, ext: ok.ext, mime: ok.mime, bytes: ok.bytes };
      }
      const porMatricula = matricula ? [...store.persons.values()].find((p) => p.matricula === matricula) : null;
      const porEnroll = enrollid !== null ? [...store.persons.values()].find((p) => Number(p.enrollid) === enrollid) : null;
      const existente = porMatricula || porEnroll || null;

      if (existente) {
        if (alvos.has(existente.id)) throw new Error('cadastro repetido na mesma importação');
        alvos.add(existente.id);
        if (modo === 'IGNORAR') {
          ignorados += 1;
          itens.push({ linha: numero, nome, matricula: existente.matricula, status: 'JA_EXISTE', id: existente.id, enrollid: existente.enrollid });
          return;
        }
        plano.push({
          acao: 'ATUALIZAR', linha: numero, existente, nome, tipo,
          treinutrix: cleanText(linha.treinutrix, 200) || null,
          validadeIni, validadeFim, ativo, ...extras,
          senha: linha.senha ? String(linha.senha) : null,
          foto,
        });
        atualizados += 1;
        itens.push({ linha: numero, nome, matricula: existente.matricula, status: 'ATUALIZAR', id: existente.id, enrollid: existente.enrollid });
        return;
      }

      const novoEnroll = enrollid !== null ? enrollid : alocarEnroll();
      if (enrollid !== null) usadosEnroll.add(enrollid);
      const novaMatricula = matricula || defaultMatricula(tipo, novoEnroll);
      if (usadosMat.has(novaMatricula)) throw new Error(`matrícula ${novaMatricula} já existe; informe a matrícula correta`);
      usadosMat.add(novaMatricula);
      const id = nextId('per');
      plano.push({
        acao: 'CRIAR', linha: numero, id, nome, matricula: novaMatricula, tipo,
        enrollid: novoEnroll, treinutrix: cleanText(linha.treinutrix, 200) || null,
        validadeIni, validadeFim, ativo, ...extras,
        senha: linha.senha ? String(linha.senha) : novaMatricula,
        foto,
      });
      criados += 1;
      itens.push({ linha: numero, nome, matricula: novaMatricula, status: 'NOVO', id, enrollid: novoEnroll });
    } catch (e) {
      erros += 1;
      itens.push({ linha: numero, nome: nome || null, matricula: matricula || null, status: 'ERRO', erro: e.message });
    }
  });

  const resumo = {
    confirmado: confirmar, modo, atomic, total: linhas.length,
    criados: confirmar ? criados : 0,
    atualizados: confirmar ? atualizados : 0,
    novos: itens.filter((i) => i.status === 'NOVO').length,
    atualizaveis: itens.filter((i) => i.status === 'ATUALIZAR').length,
    ignorados, erros,
    itens: itens.slice(0, 500),
    truncado: itens.length > 500,
  };

  if (confirmar && erros > 0 && atomic && !ignorarErros) {
    throw Object.assign(new Error('importação com erros; nada foi gravado'), { status: 409, relatorio: resumo });
  }
  if (!confirmar) return { status: 200, ...resumo };

  // Aplica com rollback em memória se algo inesperado falhar.
  const backup = {
    persons: new Map(store.persons),
    rules: [...store.rules],
    syncQueue: [...store.syncQueue],
    meta: { ...store.meta },
    nextEnrollid: store.meta.nextEnrollid,
  };
  const fotosGravadas = [];
  try {
    for (const item of plano) {
      if (item.acao === 'CRIAR') {
        const person = {
          id: item.id, nome: item.nome, matricula: item.matricula, tipo: item.tipo,
          treinutrix: item.treinutrix, enrollid: item.enrollid, ativo: item.ativo,
          cpf: item.cpf, telefone: item.telefone, email: item.email, nascimento: item.nascimento,
          endereco: item.endereco, bairro: item.bairro, cidade: item.cidade, cep: item.cep,
          observacoes: item.observacoes,
          validadeIni: item.validadeIni, validadeFim: item.validadeFim,
          foto: null, senhaHash: hashPassword(item.senha),
          tokenVersion: 0, mustChangePassword: !item.senha,
          criadoEm: new Date().toISOString(),
        };
        if (item.foto) {
          savePhoto(item.id, item.foto.buffer, item.foto.ext);
          fotosGravadas.push(item.id);
          person.foto = { ext: item.foto.ext, mime: item.foto.mime, bytes: item.foto.bytes, updatedAt: new Date().toISOString() };
        }
        store.persons.set(person.id, person);
        ensureRules(store, person.id);
        enqueueSync(store, person);
      } else {
        const p = item.existente;
        p.nome = item.nome;
        p.tipo = item.tipo;
        p.treinutrix = item.treinutrix;
        p.cpf = item.cpf;
        p.telefone = item.telefone;
        p.email = item.email;
        p.nascimento = item.nascimento;
        p.endereco = item.endereco;
        p.bairro = item.bairro;
        p.cidade = item.cidade;
        p.cep = item.cep;
        p.observacoes = item.observacoes;
        p.validadeIni = item.validadeIni;
        p.validadeFim = item.validadeFim;
        p.ativo = item.ativo;
        if (item.senha) p.senhaHash = hashPassword(item.senha);
        if (item.foto) {
          deletePhoto(p.id);
          savePhoto(p.id, item.foto.buffer, item.foto.ext);
          fotosGravadas.push(p.id);
          p.foto = { ext: item.foto.ext, mime: item.foto.mime, bytes: item.foto.bytes, updatedAt: new Date().toISOString() };
        }
        enqueueSync(store, p);
      }
    }
    store.meta.nextEnrollid = Math.max(Number(store.meta.nextEnrollid) || 1001, proximoEnroll);
    store.imports = store.imports || [];
    store.imports.unshift({
      id: nextId('imp'), em: new Date().toISOString(), por,
      arquivo: cleanText(b.arquivo, 120), modo, atomic,
      total: linhas.length, criados, atualizados, ignorados, erros,
      itens: itens.map((i) => (i.status === 'NOVO' ? { ...i, status: 'CRIADO' } : i)).slice(0, 500),
      truncado: itens.length > 500,
    });
    if (store.imports.length > 100) store.imports.length = 100;
    saveNow(store);
  } catch (e) {
    store.persons = backup.persons;
    store.rules = backup.rules;
    store.syncQueue = backup.syncQueue;
    store.meta = backup.meta;
    for (const id of fotosGravadas) { try { deletePhoto(id); } catch { /* já removida */ } }
    throw Object.assign(new Error(`importação revertida: ${e.message}`), { status: 500 });
  }

  // Reflete os status definitivos nos itens retornados.
  const itensFinal = itens.map((i) => (i.status === 'NOVO' ? { ...i, status: 'CRIADO' } : i));
  return {
    status: 200, ...resumo,
    criados, atualizados,
    itens: itensFinal.slice(0, 500),
  };
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

// Resumo dos eventos para relatórios (filtro por período de início).
function notificarEspera(eventId, participante) {
  const ev = store.socialEvents.find((e) => e.id === eventId);
  if (!ev) return;
  const key = `evento-espera:${eventId}:${participante.id}`;
  if (store.notifications.some((n) => n.key === key)) return;
  store.notifications.push({
    id: nextId('ntf'), key, tipo: 'EVENTO',
    titulo: `Lista de espera: ${ev.nome}`,
    detalhe: `${participante.nome} entrou na espera (capacidade ${ev.capacidade}).`,
    createdAt: new Date().toISOString(), resolvida: false, resolvidaPor: null, resolvidaEm: null,
  });
}

function resumoEventos(inicio, fim) {
  const de = inicio ? parseDate(inicio) : null;
  const ate = fim ? parseDate(fim, { endOfDay: true }) : null;
  return [...store.socialEvents]
    .filter((e) => {
      const d = parseDate(e.inicio);
      if (!d) return false;
      if (de && d < de) return false;
      if (ate && d > ate) return false;
      return true;
    })
    .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
    .map((e) => {
      const ps = store.eventParticipants.filter((p) => p.eventId === e.id && p.status !== 'CANCELADO');
      const inscritos = ps.filter((p) => p.status !== 'ESPERA').length;
      return {
        id: e.id, nome: e.nome, inicio: e.inicio, local: e.local || '',
        capacidade: e.capacidade || null, inscritos,
        presentes: ps.filter((p) => p.status === 'PRESENTE').length,
        espera: ps.filter((p) => p.status === 'ESPERA').length,
        receita: ps.reduce((s, p) => s + Number(p.valorPago || 0), 0),
        valor: e.valor || 0, ativo: e.ativo !== false, inscricoesAbertas: e.inscricoesAbertas !== false,
      };
    });
}

// ---------------------------------------------------------------------------
// rotas
// ---------------------------------------------------------------------------
async function route(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' https://fonts.gstatic.com data:");
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(),
      ...(CORS_ORIGIN ? { 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } : {}),
    });
    return res.end();
  }

  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, storage: 'sqlite', version: PKG.version, commit: GIT_COMMIT });
  }

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
    const ent = who.perfil === 'aluno' ? store.persons.get(who.sub) : store.users.get(who.sub);
    const token = issueToken({
      ...who,
      ver: Number(ent?.tokenVersion) || 0,
      epoch: Number(store.meta.sessionEpoch) || 0,
    });
    definirCookieSessao(req, res, token);
    return send(res, 200, {
      ...who,
      token,
      mustChangePassword: ent?.mustChangePassword === true,
    });
  }

  // Recuperação do administrador padrão: só aceita conexão da própria máquina
  // (loopback). Usada pelos scripts restaurar-admin.bat/.sh quando a senha do
  // admin foi perdida. Não fica exposta na rede.
  if (req.method === 'POST' && url.pathname === '/api/auth/recover-admin') {
    if (!ehLoopback(req)) return send(res, 403, { error: 'somente na máquina local' });
    const b = await readBody(req);
    const login = (String(b.login || process.env.SEED_ADMIN_LOGIN || 'admin').trim() || 'admin').slice(0, 60);
    const senha = String(b.senha || process.env.SEED_ADMIN_PASSWORD || 'admin123');
    if (senha.length < 4) return send(res, 400, { error: 'senha curta (mín. 4)' });
    let admin = [...store.users.values()].find((u) => u.login === login)
      || store.users.get('usr_admin')
      || [...store.users.values()].find((u) => u.perfil === 'gerencia');
    if (!admin) {
      admin = { id: 'usr_admin', nome: 'Administrador', login };
      store.users.set(admin.id, admin);
    }
    admin.login = login;
    admin.nome = admin.nome || 'Administrador';
    admin.perfil = 'gerencia';
    admin.senhaHash = hashPassword(senha);
    admin.tokenVersion = (Number(admin.tokenVersion) || 0) + 1;
    admin.mustChangePassword = false;
    loginAttempts.clear();
    saveNow(store);
    console.log(`[auth] administrador restaurado (${login})`);
    return send(res, 200, { ok: true, login });
  }

  // Inscrição pública por link/QR (sem login), limitada por IP.
  const publicEventoRoute = url.pathname.match(/^\/api\/public\/eventos\/([^/]+)$/);
  const publicParticipanteRoute = url.pathname.match(/^\/api\/public\/eventos\/([^/]+)\/participantes$/);
  if (req.method === 'GET' && publicEventoRoute) {
    const ev = eventoPorToken(store, safeDecode(publicEventoRoute[1]));
    if (!ev || !ev.ativo) return send(res, 404, { error: 'evento não encontrado ou cancelado' });
    const ps = store.eventParticipants.filter((p) => p.eventId === ev.id && p.status !== 'CANCELADO');
    const inscritos = ps.filter((p) => p.status !== 'ESPERA').length;
    return send(res, 200, {
      nome: ev.nome, descricao: ev.descricao, local: ev.local, inicio: ev.inicio, fim: ev.fim,
      valor: ev.valor || 0, capacidade: ev.capacidade || null,
      inscritos, espera: ps.filter((p) => p.status === 'ESPERA').length,
      restantes: ev.capacidade ? Math.max(0, ev.capacidade - inscritos) : null,
      permiteVisitantes: ev.permiteVisitantes !== false,
      inscricoesAbertas: ev.inscricoesAbertas !== false && ev.ativo !== false,
    });
  }
  if (req.method === 'POST' && publicParticipanteRoute) {
    const ip = clientIp(req);
    if (publicBlocked(ip)) return send(res, 429, { error: 'muitas inscrições — tente mais tarde' });
    publicHit(ip);
    const ev = eventoPorToken(store, safeDecode(publicParticipanteRoute[1]));
    if (!ev || !ev.ativo) return send(res, 404, { error: 'evento não encontrado ou cancelado' });
    const b = await readBody(req);
    try {
      const p = novaInscricao(store, ev.id, { nome: b.nome, contato: b.contato, documento: b.documento });
      store.eventParticipants.push(p);
      if (p.status === 'ESPERA') notificarEspera(ev.id, p);
      markDirty();
      return send(res, 201, {
        nome: p.nome, status: p.status, codigo: p.codigo,
        evento: ev.nome, inicio: ev.inicio,
        mensagem: p.status === 'ESPERA' ? 'Evento lotado: você entrou na lista de espera.' : 'Inscrição confirmada.',
      });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  // Tela pública do sorteio (somente leitura, sem dados sensíveis).
  const publicSorteioRoute = url.pathname.match(/^\/api\/public\/sorteios\/([^/]+)$/);
  if (req.method === 'GET' && publicSorteioRoute) {
    const token = safeDecode(publicSorteioRoute[1]);
    const sorteio = store.raffles.find((r) => r.publicToken === token);
    if (!sorteio) return send(res, 404, { error: 'sorteio não encontrado' });
    let elegiveisQtd = 0;
    try { elegiveisQtd = elegiveis(store, sorteio).participantes.length; } catch { /* regras incompletas */ }
    return send(res, 200, {
      nome: sorteio.nome, premio: sorteio.premio, status: sorteio.status,
      ativo: sorteio.ativo !== false, sorteadoEm: sorteio.sorteadoEm || null,
      elegiveisQtd,
      vencedores: (sorteio.vencedores || (sorteio.vencedor ? [sorteio.vencedor] : []))
        .map((v) => ({ nome: v.nome, matricula: v.matricula || null })),
    });
  }

  // Demais /api/* exigem token.
  const user = url.pathname.startsWith('/api/') ? getUser(req, url) : null;
  if (url.pathname.startsWith('/api/') && !user) return send(res, 401, { error: 'não autenticado' });
  const trocaObrigatoria = ['/api/auth/change-password', '/api/auth/logout'].includes(url.pathname);
  if (user?.mustChangePassword && req.method !== 'GET' && !trocaObrigatoria) {
    return send(res, 403, { error: 'troque a senha inicial antes de continuar' });
  }
  if (req.method === 'GET' && /(export\.(csv|pdf)|resultado\.(csv|pdf)|relatorios\/eventos\.(csv|pdf))/.test(url.pathname)) {
    if (!limitar('export:' + clientIp(req), 60, 10 * 60 * 1000)) {
      return send(res, 429, { error: 'muitas exportações — aguarde alguns minutos' });
    }
  }

  const operadorOnly = () => {
    if (!isOperador(user)) throw fail(403, 'só equipe (recepção/gerência)');
  };
  const gerenciaOnly = () => {
    if (!isGerencia(user)) throw fail(403, 'só gerência');
  };

  // Encerra a sessão atual (invalida os tokens deste usuário).
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const ent = entradaDe(user);
    if (ent) {
      ent.tokenVersion = (Number(ent.tokenVersion) || 0) + 1;
      markDirty();
    }
    limparCookieSessao(res);
    auditar(user, 'LOGOUT', '', req);
    return send(res, 200, { ok: true });
  }

  // Troca de senha (qualquer autenticado). Invalida tokens antigos e emite novo.
  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
    const b = await readBody(req);
    if (!b.nova || String(b.nova).length < 4) return send(res, 400, { error: 'nova senha curta (mín. 4)' });
    const ent = entradaDe(user);
    if (!ent || !verifyPassword(b.atual, ent.senhaHash || '')) {
      return send(res, 401, { error: 'senha atual incorreta' });
    }
    ent.senhaHash = hashPassword(b.nova);
    ent.mustChangePassword = false;
    ent.tokenVersion = (Number(ent.tokenVersion) || 0) + 1;
    const token = issueToken({
      sub: user.sub, perfil: user.perfil, nome: user.nome,
      ver: ent.tokenVersion, epoch: Number(store.meta.sessionEpoch) || 0,
    });
    definirCookieSessao(req, res, token);
    markDirty();
    auditar({ ...user, mustChangePassword: false }, 'SENHA_ALTERADA', '', req);
    return send(res, 200, {
      ok: true, token, sub: user.sub, perfil: user.perfil, nome: user.nome,
      mustChangePassword: false,
    });
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
      const u = { id: nextId('usr'), nome: cleanText(b.nome, 120) || b.login, login: String(b.login), senhaHash: hashPassword(b.senha), perfil: b.perfil, tokenVersion: 0, mustChangePassword: false };
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
    const person = criarPessoa(b);
    store.persons.set(person.id, person);
    // Sem regra não há acesso: o cadastro já nasce liberado no horário padrão.
    ensureRules(store, person.id);
    enqueueSync(store, person);
    return send(res, 201, publicPerson(person));
  }

  // Importação em lote de outro sistema (CSV/JSON convertido pelo painel).
  // `confirmar:false` faz a prévia; `modo:ATUALIZAR` faz upsert; atômica por padrão.
  if (req.method === 'POST' && url.pathname === '/api/persons/import') {
    gerenciaOnly();
    if (!limitar('import:' + user.sub, 10, 60 * 60 * 1000)) {
      return send(res, 429, { error: 'muitas importações — aguarde uma hora' });
    }
    const b = await readBody(req, IMPORT_MAX_BYTES);
    try {
      const out = importarPessoas(store, b, { por: user.nome || user.sub });
      auditar(user, 'IMPORTACAO', `${b.modo || 'IGNORAR'} · ${out.criados} criado(s), ${out.atualizados} atualizado(s), ${out.erros} erro(s)`, req);
      return send(res, out.status || 200, out);
    } catch (e) {
      return send(res, e.status || 400, {
        error: e.message,
        ...(e.relatorio ? { relatorio: e.relatorio } : {}),
      });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/imports') {
    operadorOnly();
    return send(res, 200, store.imports || []);
  }
  const importacaoRoute = url.pathname.match(/^\/api\/imports\/([^/]+)$/);
  if (req.method === 'GET' && importacaoRoute) {
    operadorOnly();
    const id = safeDecode(importacaoRoute[1]);
    const rec = (store.imports || []).find((i) => i.id === id);
    if (!rec) return send(res, 404, { error: 'importacao_not_found' });
    return send(res, 200, rec);
  }
  const importacaoRelatorioRoute = url.pathname.match(/^\/api\/imports\/([^/]+)\/relatorio\.csv$/);
  if (req.method === 'GET' && importacaoRelatorioRoute) {
    operadorOnly();
    const id = safeDecode(importacaoRelatorioRoute[1]);
    const rec = (store.imports || []).find((i) => i.id === id);
    if (!rec) return send(res, 404, { error: 'importacao_not_found' });
    const linhas = (rec.itens || []).map((i) => [
      i.linha, i.nome || '', i.matricula || '', i.status || '', i.erro || '',
    ]);
    const corpo = csvTabela(['Linha', 'Nome', 'Matrícula', 'Status', 'Erro'], linhas);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="importacao-${id}.csv"`,
      ...corsHeaders(),
    });
    return res.end(corpo);
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
      markDirty();
      auditar(user, 'PESSOA_EXCLUIDA', `${p.nome} (${p.matricula})`, req);
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
    if (b.cpf !== undefined) p.cpf = limparCpf(b.cpf);
    if (b.telefone !== undefined) p.telefone = cleanText(b.telefone, 40) || null;
    if (b.email !== undefined) p.email = cleanText(b.email, 120).toLowerCase() || null;
    if (b.nascimento !== undefined) p.nascimento = cleanText(b.nascimento, 20) || null;
    if (b.endereco !== undefined) p.endereco = cleanText(b.endereco, 200) || null;
    if (b.bairro !== undefined) p.bairro = cleanText(b.bairro, 100) || null;
    if (b.cidade !== undefined) p.cidade = cleanText(b.cidade, 100) || null;
    if (b.cep !== undefined) p.cep = cleanText(b.cep, 20) || null;
    if (b.observacoes !== undefined) p.observacoes = cleanText(b.observacoes, 1000) || null;
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

  // -------------------------------------------------------- planos/mensalidades
  if (url.pathname === '/api/plans') {
    if (req.method === 'GET') {
      operadorOnly();
      return send(res, 200, (store.plans || []).map((p) => ({ ...p })));
    }
    if (req.method === 'POST') {
      gerenciaOnly();
      const b = await readBody(req);
      try {
        const plano = novoPlano(b);
        store.plans.push(plano);
        markDirty();
        auditar(user, 'PLANO_CRIADO', `${plano.nome} (R$ ${plano.valor})`, req);
        return send(res, 201, plano);
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
  }
  const planRoute = url.pathname.match(/^\/api\/plans\/([^/]+)$/);
  if (planRoute) {
    gerenciaOnly();
    const id = safeDecode(planRoute[1]);
    const plano = (store.plans || []).find((p) => p.id === id);
    if (!plano) return send(res, 404, { error: 'plano_not_found' });
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      try {
        Object.assign(plano, normalizarPlano(b, plano), { atualizadoEm: new Date().toISOString() });
        markDirty();
        auditar(user, 'PLANO_ATUALIZADO', plano.nome, req);
        return send(res, 200, plano);
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (req.method === 'DELETE') {
      const usados = (store.subscriptions || []).some((s) => s.planId === id);
      if (usados) {
        plano.ativo = false;
        markDirty();
        auditar(user, 'PLANO_DESATIVADO', plano.nome, req);
        return send(res, 200, { ok: true, desativado: true });
      }
      store.plans = store.plans.filter((p) => p.id !== id);
      markDirty();
      auditar(user, 'PLANO_EXCLUIDO', plano.nome, req);
      return send(res, 200, { ok: true });
    }
  }

  const personPlanRoute = url.pathname.match(/^\/api\/persons\/([^/]+)\/plano$/);
  if (personPlanRoute) {
    const id = safeDecode(personPlanRoute[1]);
    const pessoa = id ? store.persons.get(id) : null;
    if (!pessoa) return send(res, 404, { error: 'person_not_found' });
    if (user.perfil === 'aluno' && user.sub !== id) return send(res, 403, { error: 'sem permissão' });
    if (req.method === 'GET') {
      for (const c of store.charges || []) {
        if (c.status === 'PENDENTE' && c.vencimento < localDayKey()) c.status = 'ATRASADO';
      }
      const assinaturas = (store.subscriptions || []).filter((s) => s.personId === id)
        .sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
      return send(res, 200, {
        pessoa: { id: pessoa.id, nome: pessoa.nome, validadeFim: pessoa.validadeFim },
        planosAtivos: planosAtivos(store, id),
        assinaturas,
        cobrancas: (store.charges || []).filter((c) => c.personId === id)
          .sort((a, b) => String(b.competencia).localeCompare(String(a.competencia))),
        uso: usoDaSemana(store, id),
      });
    }
    if (req.method === 'POST') {
      operadorOnly();
      const b = await readBody(req);
      const plano = (store.plans || []).find((p) => p.id === b.planoId || p.nome === b.planoId);
      if (!plano || plano.ativo === false) return send(res, 400, { error: 'plano inválido' });
      try {
        const assinatura = criarAssinatura(store, id, plano, {
          inicio: b.inicio, meses: b.meses, por: user.nome || user.sub,
        });
        markDirty();
        auditar(user, 'PLANO_CONTRATADO', `${pessoa.nome}: ${plano.nome}`, req);
        return send(res, 201, assinatura);
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
  }
  const personPlanSubRoute = url.pathname.match(/^\/api\/persons\/([^/]+)\/plano\/([^/]+)$/);
  if (req.method === 'DELETE' && personPlanSubRoute) {
    operadorOnly();
    const personId = safeDecode(personPlanSubRoute[1]);
    const subId = safeDecode(personPlanSubRoute[2]);
    const sub = (store.subscriptions || []).find((s) => s.id === subId && s.personId === personId);
    if (!sub) return send(res, 404, { error: 'assinatura_not_found' });
    const b = await readBody(req).catch(() => ({}));
    cancelarAssinatura(store, sub, { motivo: b.motivo });
    markDirty();
    auditar(user, 'PLANO_CANCELADO', `${personId}: ${sub.planoNome || sub.planId}`, req);
    return send(res, 200, sub);
  }

  if (req.method === 'GET' && url.pathname === '/api/charges') {
    operadorOnly();
    const personId = url.searchParams.get('personId');
    const competencia = url.searchParams.get('competencia');
    const status = url.searchParams.get('status');
    for (const c of store.charges || []) {
      if (c.status === 'PENDENTE' && c.vencimento < localDayKey()) c.status = 'ATRASADO';
    }
    let lista = [...(store.charges || [])];
    if (personId) lista = lista.filter((c) => c.personId === personId);
    if (competencia) lista = lista.filter((c) => c.competencia === competencia);
    if (status) lista = lista.filter((c) => c.status === status);
    lista.sort((a, b) => String(b.vencimento).localeCompare(String(a.vencimento)));
    return send(res, 200, lista.map((c) => {
      const p = store.persons.get(c.personId);
      const plano = (store.plans || []).find((x) => x.id === c.planId);
      return { ...c, pessoaNome: p?.nome || c.personId, planoNome: plano?.nome || '' };
    }));
  }
  const chargePayRoute = url.pathname.match(/^\/api\/charges\/([^/]+)\/pagar$/);
  if (req.method === 'POST' && chargePayRoute) {
    operadorOnly();
    const id = safeDecode(chargePayRoute[1]);
    const c = (store.charges || []).find((x) => x.id === id);
    if (!c) return send(res, 404, { error: 'cobranca_not_found' });
    if (c.status === 'PAGO') return send(res, 200, c);
    const b = await readBody(req);
    c.status = 'PAGO';
    c.pagoEm = b.pagoEm ? (parseDate(b.pagoEm) || new Date()).toISOString() : new Date().toISOString();
    c.pagoPor = cleanText(b.por, 80) || user.nome || user.sub;
    c.forma = cleanText(b.forma, 40) || 'manual';
    c.observacao = cleanText(b.observacao, 300) || null;
    markDirty();
    auditar(user, 'MENSALIDADE_PAGA', `${c.personId} ${c.competencia} R$ ${c.valor}`, req);
    return send(res, 200, c);
  }
  const chargeCancelRoute = url.pathname.match(/^\/api\/charges\/([^/]+)\/cancelar$/);
  if (req.method === 'POST' && chargeCancelRoute) {
    gerenciaOnly();
    const id = safeDecode(chargeCancelRoute[1]);
    const c = (store.charges || []).find((x) => x.id === id);
    if (!c) return send(res, 404, { error: 'cobranca_not_found' });
    c.status = 'CANCELADO';
    markDirty();
    auditar(user, 'MENSALIDADE_CANCELADA', `${c.personId} ${c.competencia}`, req);
    return send(res, 200, c);
  }
  if (req.method === 'POST' && url.pathname === '/api/charges/gerar') {
    gerenciaOnly();
    const b = await readBody(req);
    try {
      const criadas = gerarCobrancasMes(store, b.competencia);
      markDirty();
      auditar(user, 'MENSALIDADES_GERADAS', `${criadas.length} em ${b.competencia || 'mês atual'}`, req);
      return send(res, 200, { criadas: criadas.length, cobrancas: criadas });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  // ----------------------------------------------------------------- devices
  if (req.method === 'GET' && url.pathname === '/api/devices') {
    if (!canSeeOperations(user)) throw fail(403, 'sem permissão');
    return send(res, 200, [...store.devices.values()]);
  }
  // Catálogo de catracas/controladores suportados.
  if (req.method === 'GET' && url.pathname === '/api/device-catalog') {
    operadorOnly();
    return send(res, 200, catalogo());
  }
  // Detecção de catracas/controladores na rede local (somente gerência).
  if (req.method === 'POST' && url.pathname === '/api/devices/discover') {
    gerenciaOnly();
    if (!limitar('discover:' + clientIp(req), 5, 10 * 60 * 1000)) {
      return send(res, 429, { error: 'muitas varreduras — aguarde alguns minutos' });
    }
    const b = await readBody(req);
    const redes = redesLocais();
    const subnet = b.subnet ? normalizarSubnet(b.subnet) : (redes[0] && redes[0].cidr);
    if (!subnet) return send(res, 400, { error: 'informe a faixa (ex.: 192.168.0.0/24)', redes });
    if (varrendo) return send(res, 429, { error: 'varredura em andamento' });
    if (Date.now() - ultimaVarredura < DISCOVER_MIN_MS) {
      return send(res, 429, { error: 'aguarde alguns segundos antes de varrer novamente' });
    }
    varrendo = true;
    try {
      const out = await descobrirCatracas({
        subnet,
        portas: Array.isArray(b.portas) ? b.portas : undefined,
        timeoutMs: b.timeoutMs,
      });
      ultimaVarredura = Date.now();
      const cadastrados = new Set([...store.devices.values()].map((d) => `${d.ip}:${d.porta}`));
      const encontrados = out.encontrados.map((e) => ({
        ...e, cadastrado: e.portas.some((p) => cadastrados.has(`${e.ip}:${p}`)),
      }));
      return send(res, 200, { ...out, encontrados, redes });
    } catch (e) {
      return send(res, 400, { error: e.message, redes });
    } finally {
      varrendo = false;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/devices') {
    gerenciaOnly();
    const b = await readBody(req);
    const r = normalizarDevice(b);
    if (!r.ok) return send(res, 400, { error: r.error });
    const id = b.id ? cleanId(b.id) : nextId('dev');
    if (!id) return send(res, 400, { error: 'id inválido' });
    if (store.devices.has(id)) return send(res, 409, { error: 'dispositivo já existe' });
    const dev = {
      id, ...r.device, online: false, lastSeen: null, criadoEm: new Date().toISOString(),
    };
    store.devices.set(id, dev);
    // Novos dispositivos já enxergam os cadastros existentes (regra + sync).
    for (const p of store.persons.values()) {
      ensureRules(store, p.id, [dev]);
      enqueueSync(store, p);
    }
    return send(res, 201, dev);
  }
  const deviceDiagnosticsRoute = url.pathname.match(/^\/api\/devices\/([^/]+)\/diagnostics$/);
  if (req.method === 'GET' && deviceDiagnosticsRoute) {
    operadorOnly();
    const id = safeDecode(deviceDiagnosticsRoute[1]);
    const dev = id ? store.devices.get(id) : null;
    if (!dev) return send(res, 404, { error: 'device_not_found' });
    const tcp = dev.ip ? await probarTcp(dev.ip, dev.porta, 1500) : { ok: false, error: 'sem IP' };
    let edge = null;
    try {
      const r = await fetch(`${EDGE_URL.replace(/\/$/, '')}/hardware`, {
        headers: EDGE_TOKEN ? { 'X-Edge-Token': EDGE_TOKEN } : {},
        signal: AbortSignal.timeout(Number(process.env.EDGE_TIMEOUT_MS || 1500)),
      });
      if (r.ok) edge = await r.json();
    } catch { /* edge offline */ }
    return send(res, 200, {
      device: { id: dev.id, nome: dev.nome, ip: dev.ip, porta: dev.porta, driver: dev.driver },
      tcp,
      edge,
      edgeOnline: Boolean(edge),
      verificadoEm: new Date().toISOString(),
    });
  }
  const deviceRestartRoute = url.pathname.match(/^\/api\/devices\/([^/]+)\/restart$/);
  if (req.method === 'POST' && deviceRestartRoute) {
    gerenciaOnly();
    const id = safeDecode(deviceRestartRoute[1]);
    const dev = id ? store.devices.get(id) : null;
    if (!dev) return send(res, 404, { error: 'device_not_found' });
    try {
      const r = await fetch(`${EDGE_URL.replace(/\/$/, '')}/hardware/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(EDGE_TOKEN ? { 'X-Edge-Token': EDGE_TOKEN } : {}) },
        body: JSON.stringify({ device_id: dev.id }),
        signal: AbortSignal.timeout(Number(process.env.EDGE_TIMEOUT_MS || 3000)),
      });
      const body = await r.json().catch(() => ({}));
      auditar(user, 'BRIDGE_REINICIADO', dev.nome, req);
      return send(res, r.status, body);
    } catch (e) {
      return send(res, 502, { error: `edge indisponível: ${e.message}` });
    }
  }

  const deviceTestRoute = url.pathname.match(/^\/api\/devices\/([^/]+)\/test$/);
  if (req.method === 'POST' && deviceTestRoute) {
    operadorOnly();
    const id = safeDecode(deviceTestRoute[1]);
    const dev = id ? store.devices.get(id) : null;
    if (!dev) return send(res, 404, { error: 'device_not_found' });
    if (!dev.ip) return send(res, 400, { error: 'equipamento sem IP' });
    const b = await readBody(req);
    const r = await probarTcp(dev.ip, dev.porta, Number(b.timeoutMs) || undefined);
    dev.online = r.ok;
    if (r.ok) dev.lastSeen = new Date().toISOString();
    markDirty();
    return send(res, 200, {
      ok: r.ok, deviceId: dev.id, ip: dev.ip, porta: dev.porta,
      latencyMs: r.latencyMs, error: r.error,
    });
  }
  const deviceRoute = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
  if (deviceRoute && (req.method === 'PATCH' || req.method === 'DELETE')) {
    gerenciaOnly();
    const id = safeDecode(deviceRoute[1]);
    const dev = id ? store.devices.get(id) : null;
    if (!dev) return send(res, 404, { error: 'device_not_found' });
    if (req.method === 'DELETE') {
      store.devices.delete(id);
      store.rules = store.rules.filter((r) => r.deviceId !== id);
      store.syncQueue = store.syncQueue.filter((s) => s.deviceId !== id);
      markDirty();
      auditar(user, 'DISPOSITIVO_EXCLUIDO', dev ? dev.nome : id, req);
      return send(res, 200, { ok: true });
    }
    const b = await readBody(req);
    const merged = { ...dev, ...b };
    // Trocar de driver limpa endpoint herdado do driver anterior.
    if (b.driver && b.driver !== dev.driver && b.endpoint === undefined) merged.endpoint = null;
    const r = normalizarDevice(merged);
    if (!r.ok) return send(res, 400, { error: r.error });
    Object.assign(dev, r.device, {
      id,
      online: b.ip !== undefined || b.porta !== undefined ? false : dev.online,
      atualizadoEm: new Date().toISOString(),
    });
    markDirty();
    return send(res, 200, dev);
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

  // ------------------------------------------------------- eventos (agenda)
  if (req.method === 'GET' && url.pathname === '/api/eventos') {
    operadorOnly();
    const lista = [...store.socialEvents]
      .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
      .map((e) => {
        const ps = store.eventParticipants.filter((p) => p.eventId === e.id && p.status !== 'CANCELADO');
        return { ...e, participantes: ps.length, presentes: ps.filter((p) => p.status === 'PRESENTE').length };
      });
    return send(res, 200, lista);
  }
  if (req.method === 'POST' && url.pathname === '/api/eventos') {
    operadorOnly();
    const b = await readBody(req);
    let evento;
    try { evento = novoEvento(b); } catch (e) { return send(res, 400, { error: e.message }); }
    store.socialEvents.push(evento);
    markDirty();
    return send(res, 201, evento);
  }
  const eventoRoute = url.pathname.match(/^\/api\/eventos\/([^/]+)$/);
  if (eventoRoute) {
    const id = safeDecode(eventoRoute[1]);
    const evento = id ? store.socialEvents.find((e) => e.id === id) : null;
    if (!evento) return send(res, 404, { error: 'evento_not_found' });
    if (req.method === 'GET') {
      operadorOnly();
      const participantes = store.eventParticipants
        .filter((p) => p.eventId === id)
        .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
      return send(res, 200, { ...evento, participantes });
    }
    if (req.method === 'PATCH') {
      operadorOnly();
      const b = await readBody(req);
      let normalizado;
      try { normalizado = normalizarEvento(b, evento); } catch (e) { return send(res, 400, { error: e.message }); }
      Object.assign(evento, normalizado, { atualizadoEm: new Date().toISOString() });
      markDirty();
      return send(res, 200, evento);
    }
    if (req.method === 'DELETE') {
      gerenciaOnly();
      store.socialEvents = store.socialEvents.filter((e) => e.id !== id);
      store.eventParticipants = store.eventParticipants.filter((p) => p.eventId !== id);
      markDirty();
      auditar(user, 'EVENTO_EXCLUIDO', evento.nome, req);
      return send(res, 200, { ok: true });
    }
  }

  const eventoParticipantesRoute = url.pathname.match(/^\/api\/eventos\/([^/]+)\/participantes$/);
  if (req.method === 'POST' && eventoParticipantesRoute) {
    operadorOnly();
    const eventId = safeDecode(eventoParticipantesRoute[1]);
    const b = await readBody(req);
    let participante;
    try { participante = novaInscricao(store, eventId, b); } catch (e) { return send(res, 400, { error: e.message }); }
    store.eventParticipants.push(participante);
    if (participante.status === 'ESPERA') notificarEspera(eventId, participante);
    markDirty();
    return send(res, 201, participante);
  }
  // Importação de participantes (CSV convertido pelo painel).
  const eventoImportRoute = url.pathname.match(/^\/api\/eventos\/([^/]+)\/participantes\/import$/);
  if (req.method === 'POST' && eventoImportRoute) {
    operadorOnly();
    const eventId = safeDecode(eventoImportRoute[1]);
    const b = await readBody(req);
    const linhas = Array.isArray(b.pessoas) ? b.pessoas : null;
    if (!linhas) return send(res, 400, { error: 'pessoas deve ser uma lista' });
    if (linhas.length > 1000) return send(res, 413, { error: 'máximo de 1000 linhas por importação' });
    const itens = [];
    let criados = 0;
    let espera = 0;
    linhas.forEach((linha, i) => {
      try {
        let personId = linha.personId || null;
        if (!personId && linha.matricula) {
          const pessoa = [...store.persons.values()].find((p) => p.matricula === String(linha.matricula).trim());
          if (!pessoa) throw new Error('matrícula não encontrada');
          personId = pessoa.id;
        }
        const p = novaInscricao(store, eventId, { personId, nome: linha.nome, contato: linha.contato, documento: linha.documento });
        store.eventParticipants.push(p);
        if (p.status === 'ESPERA') { espera += 1; notificarEspera(eventId, p); } else criados += 1;
        itens.push({ linha: i + 1, nome: p.nome, status: p.status, codigo: p.codigo });
      } catch (e) {
        itens.push({ linha: i + 1, nome: linha.nome || null, status: 'ERRO', erro: e.message });
      }
    });
    markDirty();
    return send(res, 200, {
      total: linhas.length, criados, espera,
      erros: itens.filter((i) => i.status === 'ERRO').length,
      itens: itens.slice(0, 500),
    });
  }

  const eventoParticipanteRoute = url.pathname.match(/^\/api\/eventos\/([^/]+)\/participantes\/([^/]+)$/);
  if (eventoParticipanteRoute) {
    operadorOnly();
    const eventId = safeDecode(eventoParticipanteRoute[1]);
    const pid = safeDecode(eventoParticipanteRoute[2]);
    const evento = store.socialEvents.find((e) => e.id === eventId);
    const p = store.eventParticipants.find((x) => x.id === pid && x.eventId === eventId);
    if (!p) return send(res, 404, { error: 'participante_not_found' });
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      if (b.status && STATUS_PARTICIPANTE.includes(String(b.status).toUpperCase())) {
        p.status = String(b.status).toUpperCase();
        p.checkinAt = p.status === 'PRESENTE' ? (b.checkinAt ? new Date(b.checkinAt).toISOString() : new Date().toISOString()) : null;
      }
      if (b.checkin === true) { p.status = 'PRESENTE'; p.checkinAt = new Date().toISOString(); }
      if (b.checkin === false) { p.status = 'INSCRITO'; p.checkinAt = null; }
      if (b.nome !== undefined && !p.personId) p.nome = cleanText(b.nome, 120);
      if (b.contato !== undefined) p.contato = cleanText(b.contato, 120);
      if (b.documento !== undefined) p.documento = cleanText(b.documento, 60);
      if (b.pago !== undefined) {
        p.pago = b.pago !== false;
        p.valorPago = p.pago ? Math.max(0, Number(b.valorPago ?? evento?.valor ?? 0) || 0) : 0;
        p.pagoEm = p.pago ? new Date().toISOString() : null;
        p.pagoPor = p.pago ? (cleanText(b.por, 80) || 'operador') : null;
      }
      const promovido = p.status === 'CANCELADO' ? promoverEspera(store, eventId) : null;
      markDirty();
      return send(res, 200, { ...p, promovido });
    }
    if (req.method === 'DELETE') {
      store.eventParticipants = store.eventParticipants.filter((x) => x.id !== pid);
      const promovido = promoverEspera(store, eventId);
      markDirty();
      return send(res, 200, { ok: true, promovido });
    }
  }

  // Check-in por código curto (QR/impresso na recepção).
  const eventoCheckinRoute = url.pathname.match(/^\/api\/eventos\/([^/]+)\/checkin$/);
  if (req.method === 'POST' && eventoCheckinRoute) {
    operadorOnly();
    const eventId = safeDecode(eventoCheckinRoute[1]);
    const b = await readBody(req);
    const codigo = String(b.codigo || '').trim().toUpperCase();
    const p = store.eventParticipants.find(
      (x) => x.eventId === eventId && String(x.codigo || '').toUpperCase() === codigo && x.status !== 'CANCELADO',
    );
    if (!p) return send(res, 404, { error: 'código não encontrado' });
    p.status = 'PRESENTE';
    p.checkinAt = new Date().toISOString();
    markDirty();
    return send(res, 200, p);
  }

  // Promove um participante externo a aluno/visitante cadastrado.
  const eventoPromoverRoute = url.pathname.match(/^\/api\/eventos\/([^/]+)\/participantes\/([^/]+)\/promover$/);
  if (req.method === 'POST' && eventoPromoverRoute) {
    operadorOnly();
    const eventId = safeDecode(eventoPromoverRoute[1]);
    const pid = safeDecode(eventoPromoverRoute[2]);
    const p = store.eventParticipants.find((x) => x.id === pid && x.eventId === eventId);
    if (!p) return send(res, 404, { error: 'participante_not_found' });
    if (p.personId) return send(res, 409, { error: 'participante já tem cadastro' });
    const b = await readBody(req);
    try {
      const pessoa = criarPessoa({
        nome: p.nome, tipo: b.tipo === 'VISITANTE' ? 'VISITANTE' : 'ALUNO',
        matricula: b.matricula, senha: b.senha, validadeFim: b.validadeFim,
      });
      store.persons.set(pessoa.id, pessoa);
      ensureRules(store, pessoa.id);
      enqueueSync(store, pessoa);
      p.personId = pessoa.id;
      p.tipo = pessoa.tipo;
      p.matricula = pessoa.matricula;
      markDirty();
      return send(res, 200, { pessoa: publicPerson(pessoa), participante: p });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message });
    }
  }

  // Duplicar, repetir e rotacionar link público.
  const eventoDuplicarRoute = url.pathname.match(/^\/api\/eventos\/([^/]+)\/duplicar$/);
  if (req.method === 'POST' && eventoDuplicarRoute) {
    operadorOnly();
    const id = safeDecode(eventoDuplicarRoute[1]);
    const ev = id ? store.socialEvents.find((e) => e.id === id) : null;
    if (!ev) return send(res, 404, { error: 'evento_not_found' });
    const b = await readBody(req);
    try {
      const copia = novoEvento({
        ...ev,
        nome: cleanText(b.nome, 120) || `${ev.nome} (cópia)`,
        inicio: b.inicio || ev.inicio,
        fim: b.fim !== undefined ? b.fim : ev.fim,
      });
      copia.serieId = ev.serieId || ev.id;
      store.socialEvents.push(copia);
      markDirty();
      return send(res, 201, copia);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  const eventoRecorrenciaRoute = url.pathname.match(/^\/api\/eventos\/([^/]+)\/recorrencia$/);
  if (req.method === 'POST' && eventoRecorrenciaRoute) {
    operadorOnly();
    const id = safeDecode(eventoRecorrenciaRoute[1]);
    const ev = id ? store.socialEvents.find((e) => e.id === id) : null;
    if (!ev) return send(res, 404, { error: 'evento_not_found' });
    const b = await readBody(req);
    try {
      const criados = gerarRecorrencias(ev, { tipo: b.tipo, vezes: b.vezes });
      store.socialEvents.push(...criados);
      markDirty();
      return send(res, 201, { criados });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  const eventoTokenRoute = url.pathname.match(/^\/api\/eventos\/([^/]+)\/token$/);
  if (req.method === 'POST' && eventoTokenRoute) {
    gerenciaOnly();
    const id = safeDecode(eventoTokenRoute[1]);
    const ev = id ? store.socialEvents.find((e) => e.id === id) : null;
    if (!ev) return send(res, 404, { error: 'evento_not_found' });
    ev.publicToken = crypto.randomBytes(8).toString('hex');
    markDirty();
    return send(res, 200, { publicToken: ev.publicToken });
  }

  // Relatórios de eventos por período (JSON, CSV e PDF).
  const relatorioEventosRoute = url.pathname.match(/^\/api\/relatorios\/eventos(?:\.(csv|pdf))?$/);
  if (req.method === 'GET' && relatorioEventosRoute) {
    operadorOnly();
    const formato = relatorioEventosRoute[1];
    const inicio = url.searchParams.get('inicio');
    const fim = url.searchParams.get('fim');
    const eventos = resumoEventos(inicio, fim);
    if (!formato) return send(res, 200, { inicio, fim, total: eventos.length, eventos });
    if (formato === 'csv') {
      const corpo = eventosParaCsv(eventos);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="relatorio-eventos.csv"',
        ...corsHeaders(),
      });
      return res.end(corpo);
    }
    const pdf = eventosParaPdf(eventos, { inicio, fim });
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="relatorio-eventos.pdf"',
      'Content-Length': pdf.length,
      ...corsHeaders(),
    });
    return res.end(pdf);
  }

  // Relatório financeiro do período.
  const relatorioFinanceiroRoute = url.pathname.match(/^\/api\/relatorios\/financeiro(?:\.(csv|pdf))?$/);
  if (req.method === 'GET' && relatorioFinanceiroRoute) {
    gerenciaOnly();
    const formato = relatorioFinanceiroRoute[1];
    const inicio = url.searchParams.get('inicio');
    const fim = url.searchParams.get('fim');
    const r = relatorioFinanceiro(store, { inicio, fim });
    if (!formato) return send(res, 200, r);
    const periodoTxt = `${new Date(r.periodo.inicio).toLocaleDateString('pt-BR')} a ${new Date(r.periodo.fim).toLocaleDateString('pt-BR')}`;
    const brl = (n) => Number(n || 0).toFixed(2).replace('.', ',');
    if (formato === 'csv') {
      const secoes = [
        ['Resumo', [['Indicador', 'Valor'], ['Previsto', brl(r.kpis.previsto)], ['Recebido', brl(r.kpis.recebido)], ['Em aberto', brl(r.kpis.emAberto)], ['Vencido', brl(r.kpis.vencido)], ['Taxa de recebimento (%)', String(r.kpis.taxaRecebimento)], ['Cobranças', String(r.kpis.cobrancas)]]],
        ['Por competência', [['Competência', 'Cobranças', 'Previsto', 'Recebido', 'Aberto', 'Vencido'], ...r.porCompetencia.map((m) => [m.competencia, m.quantidade, brl(m.previsto), brl(m.recebido), brl(m.aberto), brl(m.vencido)])]],
        ['Por plano', [['Plano', 'Cobranças', 'Previsto', 'Recebido', 'Aberto'], ...r.porPlano.map((p) => [p.plano, p.quantidade, brl(p.previsto), brl(p.recebido), brl(p.aberto)])]],
        ['Por forma', [['Forma', 'Pagamentos', 'Total'], ...r.porForma.map((f) => [f.forma, f.quantidade, brl(f.total)])]],
        ['Devedores', [['Nome', 'Matrícula', 'Cobranças', 'Aberto', 'Vencido'], ...r.devedores.map((d) => [d.nome, d.matricula, d.cobrancas, brl(d.aberto), brl(d.vencido)])]],
      ];
      const corpo = secoes.map(([titulo, tabela], i) => {
        const csv = csvTabela(tabela[0], tabela.slice(1)).replace(/^\uFEFF/, '');
        return `${i ? '' : '\uFEFF'}${titulo}\r\n${csv}`;
      }).join('\r\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="relatorio-financeiro.csv"',
        ...corsHeaders(),
      });
      return res.end(corpo);
    }
    const linhas = [
      `Período: ${periodoTxt}`,
      `Previsto: R$ ${brl(r.kpis.previsto)} · recebido: R$ ${brl(r.kpis.recebido)} · aberto: R$ ${brl(r.kpis.emAberto)} · vencido: R$ ${brl(r.kpis.vencido)}`,
      `Taxa de recebimento: ${r.kpis.taxaRecebimento}% · ${r.kpis.cobrancas} cobrança(s) · ${r.kpis.devedores} devedor(es)`,
      '',
      'Por competência:',
      ...r.porCompetencia.map((m) => `${m.competencia}: previsto R$ ${brl(m.previsto)}, recebido R$ ${brl(m.recebido)}, aberto R$ ${brl(m.aberto)}, vencido R$ ${brl(m.vencido)}`),
      '',
      'Por plano:',
      ...r.porPlano.map((p) => `${p.plano}: previsto R$ ${brl(p.previsto)}, recebido R$ ${brl(p.recebido)}, aberto R$ ${brl(p.aberto)}`),
      '',
      'Por forma de pagamento:',
      ...r.porForma.map((f) => `${f.forma}: R$ ${brl(f.total)} (${f.quantidade})`),
      '',
      'Devedores:',
      ...r.devedores.map((d) => `${d.nome} (${d.matricula || 'sem matrícula'}): aberto R$ ${brl(d.aberto)}, vencido R$ ${brl(d.vencido)}`),
    ];
    const pdf = pdfTexto('Relatório financeiro', periodoTxt, linhas);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="relatorio-financeiro.pdf"',
      'Content-Length': pdf.length,
      ...corsHeaders(),
    });
    return res.end(pdf);
  }

  // Relatório geral do período (frequência, inadimplência, eventos e sorteios).
  const relatorioGeralRoute = url.pathname.match(/^\/api\/relatorios\/geral(?:\.(csv|pdf))?$/);
  if (req.method === 'GET' && relatorioGeralRoute) {
    operadorOnly();
    const formato = relatorioGeralRoute[1];
    const inicio = url.searchParams.get('inicio');
    const fim = url.searchParams.get('fim');
    const r = relatorioGeral(store, { inicio, fim });
    if (!formato) return send(res, 200, r);
    const periodoTxt = `${new Date(r.periodo.inicio).toLocaleDateString('pt-BR')} a ${new Date(r.periodo.fim).toLocaleDateString('pt-BR')}`;
    if (formato === 'csv') {
      const secoes = [
        ['Resumo', [['Indicador', 'Valor'], ...Object.entries(r.kpis)]],
        ['Por dia', [['Dia', 'Total', 'Liberados', 'Negados', 'Pessoas'], ...r.porDia.map((d) => [d.dia, d.total, d.liberados, d.negados, d.pessoas])]],
        ['Top pessoas', [['Nome', 'Matrícula', 'Acessos', 'Dias'], ...r.topPessoas.map((p) => [p.nome, p.matricula, p.acessos, p.dias])]],
        ['Inadimplentes', [['Nome', 'Matrícula', 'Vencimento'], ...r.inadimplentes.map((p) => [p.nome, p.matricula, p.validadeFim || ''])]],
        ['Eventos', [['Evento', 'Início', 'Inscritos', 'Presentes', 'Espera', 'Receita'], ...r.eventosSociais.map((e) => [e.nome, e.inicio, e.inscritos, e.presentes, e.espera, e.receita])]],
        ['Sorteios', [['Sorteio', 'Ganhadores', 'Data'], ...r.sorteios.map((s) => [s.nome, s.vencedores.join(', '), s.sorteadoEm])]],
      ];
      const corpo = secoes.map(([titulo, tabela], i) => {
        const csv = csvTabela(tabela[0], tabela.slice(1)).replace(/^\uFEFF/, '');
        return `${i ? '' : '\uFEFF'}${titulo}\r\n${csv}`;
      }).join('\r\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="relatorio-geral.csv"',
        ...corsHeaders(),
      });
      return res.end(corpo);
    }
    const linhas = [
      `Período: ${periodoTxt}`,
      '',
      `Eventos: ${r.kpis.eventos} · liberados: ${r.kpis.liberados} · negados: ${r.kpis.negados} · pessoas: ${r.kpis.pessoasUnicas}`,
      `Novos cadastros: ${r.kpis.novos} · inadimplentes: ${r.kpis.inadimplentes}`,
      `Eventos da agenda: ${r.kpis.eventosSociais} · sorteios: ${r.kpis.sorteios}`,
      '',
      'Por dia:',
      ...r.porDia.map((d) => `${d.dia}: ${d.total} total, ${d.liberados} liberados, ${d.negados} negados, ${d.pessoas} pessoa(s)`),
      '',
      'Top pessoas:',
      ...r.topPessoas.map((p) => `${p.nome} (${p.matricula}): ${p.acessos} acesso(s) em ${p.dias} dia(s)`),
      '',
      'Inadimplentes:',
      ...r.inadimplentes.map((p) => `${p.nome} (${p.matricula}) venceu em ${p.validadeFim || '-'}`),
      '',
      'Eventos da agenda:',
      ...r.eventosSociais.map((e) => `${e.nome}: ${e.inscritos} inscrito(s), ${e.presentes} presente(s), ${e.espera} espera`),
      '',
      'Sorteios:',
      ...r.sorteios.map((s) => `${s.nome}: ${s.vencedores.join(', ')} (${new Date(s.sorteadoEm).toLocaleString('pt-BR')})`),
    ];
    const pdf = pdfTexto('Relatório geral', periodoTxt, linhas);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="relatorio-geral.pdf"',
      'Content-Length': pdf.length,
      ...corsHeaders(),
    });
    return res.end(pdf);
  }

  // Exportação completa para migração/portabilidade (JSON).
  if (req.method === 'GET' && url.pathname === '/api/export/dados') {
    gerenciaOnly();
    const data = serialize(store);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="painel-dados-${localDayKey()}.json"`,
      ...corsHeaders(),
    });
    auditar(user, 'EXPORTACAO_DADOS', 'JSON completo', req);
    return res.end(JSON.stringify(data, null, 2));
  }

  const eventoExportRoute = url.pathname.match(/^\/api\/eventos\/([^/]+)\/export\.(csv|pdf)$/);
  if (req.method === 'GET' && eventoExportRoute) {
    operadorOnly();
    const id = safeDecode(eventoExportRoute[1]);
    const formato = eventoExportRoute[2];
    const evento = id ? store.socialEvents.find((e) => e.id === id) : null;
    if (!evento) return send(res, 404, { error: 'evento_not_found' });
    const participantes = store.eventParticipants
      .filter((p) => p.eventId === id && p.status !== 'CANCELADO')
      .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
    if (formato === 'csv') {
      const corpo = eventoParaCsv(evento, participantes);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nomeArquivoEvento(evento, 'csv')}"`,
        ...corsHeaders(),
      });
      return res.end(corpo);
    }
    const pdf = eventoParaPdf(evento, participantes);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nomeArquivoEvento(evento, 'pdf')}"`,
      'Content-Length': pdf.length,
      ...corsHeaders(),
    });
    return res.end(pdf);
  }

  // ------------------------------------------------------- sorteios/premiações
  if (req.method === 'GET' && url.pathname === '/api/sorteios') {
    operadorOnly();
    const lista = store.raffles.map((r) => {
      let elegiveisQtd = 0;
      let entradas = 0;
      try {
        const e = elegiveis(store, r);
        elegiveisQtd = e.participantes.length;
        entradas = e.totalEntradas;
      } catch { /* configuração incompleta */ }
      return { ...r, elegiveisQtd, entradas };
    });
    return send(res, 200, lista);
  }
  if (req.method === 'POST' && url.pathname === '/api/sorteios') {
    gerenciaOnly();
    const b = await readBody(req);
    if (b.sorteioEm && b.agendamentoConfirmado !== true) {
      return send(res, 400, { error: 'confirme o agendamento (agendamentoConfirmado:true)' });
    }
    let sorteio;
    try {
      sorteio = {
        id: nextId('sor'), ...normalizarSorteio(b),
        publicToken: crypto.randomBytes(8).toString('hex'),
        criadoEm: new Date().toISOString(),
      };
    } catch (e) { return send(res, 400, { error: e.message }); }
    if (sorteio.publico === 'EVENTO' && !store.socialEvents.some((e) => e.id === sorteio.eventId)) {
      return send(res, 400, { error: 'evento do sorteio não encontrado' });
    }
    store.raffles.push(sorteio);
    markDirty();
    return send(res, 201, sorteio);
  }
  const sorteioRoute = url.pathname.match(/^\/api\/sorteios\/([^/]+)$/);
  if (sorteioRoute) {
    const id = safeDecode(sorteioRoute[1]);
    const sorteio = id ? store.raffles.find((r) => r.id === id) : null;
    if (!sorteio) return send(res, 404, { error: 'sorteio_not_found' });
    if (req.method === 'GET') {
      operadorOnly();
      return send(res, 200, sorteio);
    }
    if (req.method === 'PATCH') {
      gerenciaOnly();
      const b = await readBody(req);
      if (b.sorteioEm && b.agendamentoConfirmado !== true) {
        return send(res, 400, { error: 'confirme o agendamento (agendamentoConfirmado:true)' });
      }
      let atualizado;
      try { atualizado = normalizarSorteio(b, sorteio); } catch (e) { return send(res, 400, { error: e.message }); }
      if (atualizado.publico === 'EVENTO' && !store.socialEvents.some((e) => e.id === atualizado.eventId)) {
        return send(res, 400, { error: 'evento do sorteio não encontrado' });
      }
      Object.assign(sorteio, atualizado, { atualizadoEm: new Date().toISOString() });
      markDirty();
      return send(res, 200, sorteio);
    }
    if (req.method === 'DELETE') {
      gerenciaOnly();
      store.raffles = store.raffles.filter((r) => r.id !== id);
      markDirty();
      auditar(user, 'SORTEIO_EXCLUIDO', sorteio.nome, req);
      return send(res, 200, { ok: true });
    }
  }
  const sorteioElegiveisRoute = url.pathname.match(/^\/api\/sorteios\/([^/]+)\/elegiveis$/);
  if (req.method === 'GET' && sorteioElegiveisRoute) {
    operadorOnly();
    const id = safeDecode(sorteioElegiveisRoute[1]);
    const sorteio = id ? store.raffles.find((r) => r.id === id) : null;
    if (!sorteio) return send(res, 404, { error: 'sorteio_not_found' });
    try {
      return send(res, 200, elegiveis(store, sorteio));
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }
  const sorteioSortearRoute = url.pathname.match(/^\/api\/sorteios\/([^/]+)\/sortear$/);
  if (req.method === 'POST' && sorteioSortearRoute) {
    gerenciaOnly();
    const id = safeDecode(sorteioSortearRoute[1]);
    const sorteio = id ? store.raffles.find((r) => r.id === id) : null;
    if (!sorteio) return send(res, 404, { error: 'sorteio_not_found' });
    if (!sorteio.ativo) return send(res, 409, { error: 'sorteio desabilitado' });
    const b = await readBody(req);
    if (sorteio.status === 'SORTEADA' && b.forcar !== true) {
      return send(res, 409, { error: 'sorteio já realizado; use reset para sortear de novo' });
    }
    try {
      if (sorteio.status === 'SORTEADA') {
        sorteio.vencedor = null;
        sorteio.vencedores = [];
        sorteio.sorteadoEm = null;
        sorteio.status = 'ATIVA';
      }
      const out = realizarSorteio(sorteio, { agora: new Date(), por: user.nome || user.sub });
      auditar(user, 'SORTEIO', `${sorteio.nome}: ${out.vencedores.map((v) => v.nome).join(', ')}`, req);
      return send(res, 200, out);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }
  const sorteioHistoricoRoute = url.pathname.match(/^\/api\/sorteios\/([^/]+)\/historico$/);
  if (req.method === 'GET' && sorteioHistoricoRoute) {
    operadorOnly();
    const id = safeDecode(sorteioHistoricoRoute[1]);
    if (!store.raffles.some((r) => r.id === id)) return send(res, 404, { error: 'sorteio_not_found' });
    return send(res, 200, store.raffleDraws.filter((d) => d.raffleId === id));
  }
  const sorteioResultadoRoute = url.pathname.match(/^\/api\/sorteios\/([^/]+)\/resultado\.(csv|pdf)$/);
  if (req.method === 'GET' && sorteioResultadoRoute) {
    operadorOnly();
    const id = safeDecode(sorteioResultadoRoute[1]);
    const formato = sorteioResultadoRoute[2];
    const sorteio = id ? store.raffles.find((r) => r.id === id) : null;
    if (!sorteio) return send(res, 404, { error: 'sorteio_not_found' });
    if (formato === 'csv') {
      const corpo = sorteioParaCsv(sorteio);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sorteio-${id}.csv"`,
        ...corsHeaders(),
      });
      return res.end(corpo);
    }
    const pdf = sorteioParaPdf(sorteio);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="sorteio-${id}.pdf"`,
      'Content-Length': pdf.length,
      ...corsHeaders(),
    });
    return res.end(pdf);
  }
  const sorteioTokenRoute = url.pathname.match(/^\/api\/sorteios\/([^/]+)\/token$/);
  if (req.method === 'POST' && sorteioTokenRoute) {
    gerenciaOnly();
    const id = safeDecode(sorteioTokenRoute[1]);
    const sorteio = id ? store.raffles.find((r) => r.id === id) : null;
    if (!sorteio) return send(res, 404, { error: 'sorteio_not_found' });
    sorteio.publicToken = crypto.randomBytes(8).toString('hex');
    markDirty();
    return send(res, 200, { publicToken: sorteio.publicToken });
  }
  const sorteioResetRoute = url.pathname.match(/^\/api\/sorteios\/([^/]+)\/reset$/);
  if (req.method === 'POST' && sorteioResetRoute) {
    gerenciaOnly();
    const id = safeDecode(sorteioResetRoute[1]);
    const sorteio = id ? store.raffles.find((r) => r.id === id) : null;
    if (!sorteio) return send(res, 404, { error: 'sorteio_not_found' });
    sorteio.vencedor = null;
    sorteio.vencedores = [];
    sorteio.sorteadoEm = null;
    sorteio.totalParticipantes = null;
    sorteio.totalEntradas = null;
    sorteio.entrega = null;
    sorteio.status = 'ATIVA';
    sorteio.ultimoErro = null;
    markDirty();
    auditar(user, 'SORTEIO_RESET', sorteio.nome, req);
    return send(res, 200, sorteio);
  }
  const sorteioEntregaRoute = url.pathname.match(/^\/api\/sorteios\/([^/]+)\/entregar$/);
  if (req.method === 'POST' && sorteioEntregaRoute) {
    gerenciaOnly();
    const id = safeDecode(sorteioEntregaRoute[1]);
    const sorteio = id ? store.raffles.find((r) => r.id === id) : null;
    if (!sorteio) return send(res, 404, { error: 'sorteio_not_found' });
    if (!sorteio.vencedor) return send(res, 409, { error: 'sorteio ainda não realizado' });
    const b = await readBody(req);
    const por = cleanText(b.por, 80) || 'operador';
    const em = new Date().toISOString();
    const todos = b.todos === true;
    const indice = Number.isInteger(Number(b.indice)) ? Number(b.indice) : null;
    if (Array.isArray(sorteio.vencedores) && sorteio.vencedores.length > 0) {
      sorteio.vencedores.forEach((v, i) => {
        if (todos || indice === null || i === indice) {
          v.entrega = { entregue: true, por, em };
        }
      });
      sorteio.entrega = sorteio.vencedores.every((v) => v.entrega && v.entrega.entregue)
        ? { entregue: true, por, em } : sorteio.entrega || null;
    } else {
      sorteio.entrega = { entregue: true, por, em };
    }
    markDirty();
    auditar(user, 'PREMIO_ENTREGUE', sorteio.nome, req);
    return send(res, 200, sorteio);
  }

  // ------------------------------------------------------------------ eventos
  // Health consolidado (equipe): versão, banco, fila e edge.
  if (req.method === 'GET' && url.pathname === '/api/health') {
    operadorOnly();
    let edge = null;
    try {
      const r = await fetch(`${EDGE_URL.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(Number(process.env.EDGE_TIMEOUT_MS || 1500)),
      });
      if (r.ok) edge = await r.json();
    } catch { /* edge offline */ }
    let dbBytes = 0;
    try { dbBytes = fs.statSync(DB_FILE).size; } catch { /* sem arquivo ainda */ }
    return send(res, 200, {
      ok: true,
      version: PKG.version,
      commit: GIT_COMMIT,
      uptimeSec: Math.round(process.uptime()),
      now: new Date().toISOString(),
      storage: { engine: 'sqlite', file: DB_FILE, bytes: dbBytes },
      counts: {
        persons: store.persons.size,
        devices: store.devices.size,
        events: store.events.length,
        socialEvents: store.socialEvents.length,
        raffles: store.raffles.length,
        syncPending: store.syncQueue.filter((s) => s.status === 'PENDING').length,
        notifications: store.notifications.filter((n) => !n.resolvida).length,
      },
      edge: edge ? { ok: true, ...edge } : { ok: false, error: 'edge offline', url: EDGE_URL },
      lastBackupAt: store.meta.lastBackupAt,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    return send(res, 200, visibleEvents(store.events, user).slice(-200).reverse());
  }

  // Frequência por dias distintos (não por passagens).
  if (req.method === 'GET' && url.pathname === '/api/frequency') {
    const alvo = url.searchParams.get('personId') || (user.perfil === 'aluno' ? user.sub : null);
    if (!alvo) return send(res, 400, { error: 'informe personId' });
    if (user.perfil === 'aluno' && alvo !== user.sub) return send(res, 403, { error: 'sem permissão' });
    return send(res, 200, diasFrequentados(store.events, alvo));
  }

  // Cadastro feito no próprio leitor (senduser) refletido na API.
  if (req.method === 'POST' && url.pathname === '/api/facial/users') {
    operadorOnly();
    const b = await readBody(req);
    const enrollid = Number(b.enrollid);
    if (!Number.isInteger(enrollid) || enrollid < 1 || enrollid > 99999999) {
      return send(res, 400, { error: 'enrollid inválido' });
    }
    const existente = [...store.persons.values()].find((p) => Number(p.enrollid) === enrollid);
    if (existente) {
      return send(res, 200, { ok: true, existente: true, id: existente.id, matricula: existente.matricula });
    }
    try {
      const p = criarPessoa({
        nome: cleanText(b.name, 120) || `Usuário ${enrollid}`,
        tipo: 'ALUNO', enrollid, ativo: true,
      });
      store.persons.set(p.id, p);
      ensureRules(store, p.id);
      enqueueSync(store, p);
      markDirty();
      auditar(user, 'CADASTRO_NO_LEITOR', `${p.nome} (enrollid ${enrollid})`, req);
      return send(res, 201, { ok: true, id: p.id, matricula: p.matricula, enrollid: p.enrollid });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message });
    }
  }

  // Rosto desconhecido capturado pelo leitor (LGPD: acesso restrito).
  if (req.method === 'POST' && url.pathname === '/api/facial/unknown') {
    operadorOnly();
    const b = await readBody(req, 1024 * 1024 + 1024);
    const parsed = parsePhoto(b.image);
    const ok = parsed && validatePhoto(parsed);
    if (!ok || !ok.ok) return send(res, 400, { error: ok ? ok.error : 'imagem inválida' });
    fs.mkdirSync(UNKNOWN_DIR, { recursive: true });
    const id = nextId('unk');
    const arquivo = `${id}.${ok.ext}`;
    try {
      fs.writeFileSync(path.join(UNKNOWN_DIR, arquivo), parsed.buffer);
    } catch (e) {
      return send(res, 500, { error: `não foi possível salvar a imagem: ${e.message}` });
    }
    const registro = {
      id,
      deviceId: cleanId(b.device_id) || null,
      at: b.timestamp ? (parseDate(b.timestamp) || new Date()).toISOString() : new Date().toISOString(),
      ext: ok.ext,
      bytes: ok.bytes,
      mime: ok.mime,
    };
    store.unknownFaces = store.unknownFaces || [];
    store.unknownFaces.unshift(registro);
    while (store.unknownFaces.length > 500) {
      const velho = store.unknownFaces.pop();
      try { fs.rmSync(path.join(UNKNOWN_DIR, `${velho.id}.${velho.ext}`), { force: true }); } catch { }
    }
    store.notifications.push({
      id: nextId('ntf'), key: `rosto-desconhecido:${id}`, tipo: 'SEGURANCA',
      titulo: 'Rosto desconhecido detectado',
      detalhe: `Equipamento ${registro.deviceId || '?'} em ${new Date(registro.at).toLocaleString('pt-BR')}.`,
      createdAt: new Date().toISOString(), resolvida: false, resolvidaPor: null, resolvidaEm: null,
    });
    markDirty();
    auditar(user, 'ROSTO_DESCONHECIDO', `${registro.deviceId || '?'} (${id})`, req);
    return send(res, 201, registro);
  }
  if (req.method === 'GET' && url.pathname === '/api/facial/unknown') {
    operadorOnly();
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    return send(res, 200, (store.unknownFaces || []).slice(0, limit));
  }
  const unknownPhotoRoute = url.pathname.match(/^\/api\/facial\/unknown\/([^/]+)\/photo$/);
  if (req.method === 'GET' && unknownPhotoRoute) {
    operadorOnly();
    const id = safeDecode(unknownPhotoRoute[1]);
    const rec = (store.unknownFaces || []).find((u) => u.id === id);
    if (!rec) return send(res, 404, { error: 'not_found' });
    try {
      const buf = fs.readFileSync(path.join(UNKNOWN_DIR, `${rec.id}.${rec.ext}`));
      res.writeHead(200, { 'Content-Type': rec.mime || 'image/jpeg', 'Cache-Control': 'private, max-age=30' });
      return res.end(buf);
    } catch {
      return send(res, 404, { error: 'arquivo_ausente' });
    }
  }

  // Eventos do aluno (próximos) e autoinscrição.
  if (req.method === 'GET' && url.pathname === '/api/me/eventos') {    if (user.perfil !== 'aluno') return send(res, 403, { error: 'só aluno' });
    const agora = new Date();
    const lista = store.socialEvents
      .filter((e) => e.ativo !== false && new Date(e.fim || e.inicio) >= agora)
      .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
      .map((e) => {
        const p = store.eventParticipants.find(
          (x) => x.eventId === e.id && x.personId === user.sub && x.status !== 'CANCELADO',
        );
        return {
          id: e.id, nome: e.nome, local: e.local, inicio: e.inicio, fim: e.fim,
          valor: e.valor || 0, inscricoesAbertas: e.inscricoesAbertas !== false,
          inscrito: Boolean(p), statusInscricao: p ? p.status : null,
          codigo: p ? p.codigo : null,
        };
      });
    return send(res, 200, lista);
  }
  const meuEventoRoute = url.pathname.match(/^\/api\/me\/eventos\/([^/]+)\/(?:inscrever|inscricao)$/);
  if (meuEventoRoute) {
    if (user.perfil !== 'aluno') return send(res, 403, { error: 'só aluno' });
    const eventId = safeDecode(meuEventoRoute[1]);
    const evento = store.socialEvents.find((e) => e.id === eventId);
    if (!evento) return send(res, 404, { error: 'evento_not_found' });
    if (req.method === 'POST') {
      try {
        const p = novaInscricao(store, eventId, { personId: user.sub });
        store.eventParticipants.push(p);
        if (p.status === 'ESPERA') notificarEspera(eventId, p);
        markDirty();
        return send(res, 201, { status: p.status, codigo: p.codigo });
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (req.method === 'DELETE') {
      const p = store.eventParticipants.find(
        (x) => x.eventId === eventId && x.personId === user.sub && x.status !== 'CANCELADO',
      );
      if (!p) return send(res, 404, { error: 'inscricao_not_found' });
      p.status = 'CANCELADO';
      promoverEspera(store, eventId);
      markDirty();
      return send(res, 200, { ok: true });
    }
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
    const planos = person ? planosAtivos(store, person.id, at) : [];
    const uso = person ? usoDaSemana(store, person.id, at) : { diasUsadosSemana: 0, hojeJaUsado: false };
    const result = decideAccess({
      person,
      rules: person ? store.rules.filter((r) => r.personId === person.id) : [],
      deviceId,
      at,
      score: b.score,
      minScore: MIN_SCORE,
      metodo,
      planos,
      diasUsadosSemana: uso.diasUsadosSemana,
      hojeJaUsado: uso.hojeJaUsado,
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
    const dia = localDayKey();
    // Últimos 7 dias no fuso local (não usar toISOString: muda de dia à noite).
    const semana = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDayKey(d);
      const evs = store.events.filter((e) => localDayKey(new Date(e.timestamp)) === key);
      semana.push({
        dia: key,
        total: evs.length,
        liberados: evs.filter((e) => e.decisao === 'ALLOW').length,
        alunos: alunosNoDia(store.events, key),
      });
    }
    // Quem entrou e não saiu: último evento ALLOW por pessoa é de entrada.
    const ultimoPorPessoa = new Map();
    for (const e of store.events) {
      if (e.decisao === 'ALLOW' && e.personId) ultimoPorPessoa.set(e.personId, e);
    }
    const presentes = [...ultimoPorPessoa.values()]
      .filter((e) => (e.direcao || 'IN') !== 'OUT' && localDayKey(new Date(e.timestamp)) === dia)
      .map((e) => ({ personId: e.personId, timestamp: e.timestamp }));
    return send(res, 200, {
      dia,
      semana,
      presentes,
      kpis: {
        eventosHoje: hoje.length,
        liberados: hoje.filter((e) => e.decisao === 'ALLOW').length,
        negados: hoje.filter((e) => e.decisao === 'DENY').length,
        alunosHoje: alunosNoDia(store.events, dia),
        presentes: presentes.length,
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
  if (req.method === 'GET' && url.pathname === '/api/audit') {
    gerenciaOnly();
    const limite = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 200));
    return send(res, 200, (store.audit || []).slice(0, limite));
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
      storage: {
        engine: 'sqlite',
        file: DB_FILE,
        bytes: (() => { try { return fs.statSync(DB_FILE).size; } catch { return 0; } })(),
      },
      retention: { ...RETENCAO },
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
      saveNow(store);
      auditar(user, 'BACKUP_RESTAURADO', b.file, req);
      return send(res, 200, out);
    } catch (e) {
      throw fail(400, e.message);
    }
  }

  // Página pública de inscrição: /e/<token> (sem login).
  if (req.method === 'GET' && /^\/e\/[A-Za-z0-9]{6,64}\/?$/.test(url.pathname)) {
    try {
      const html = fs.readFileSync(path.join(FRONT_DIR, 'evento.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      return send(res, 404, { error: 'página não encontrada' });
    }
  }

  // Página pública da tela do sorteio: /s/<token> (somente leitura).
  if (req.method === 'GET' && /^\/s\/[A-Za-z0-9]{6,64}\/?$/.test(url.pathname)) {
    try {
      const html = fs.readFileSync(path.join(FRONT_DIR, 'sorteio.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      return send(res, 404, { error: 'página não encontrada' });
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
