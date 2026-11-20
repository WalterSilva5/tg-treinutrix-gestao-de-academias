// Persistência local do store. Sem isso, reiniciar o PC da academia apagaria
// cadastros, senhas e configurações — inviável em produção.
//
// Formato:
// - data/state.json  -> cadastros, usuários, regras, fila e notificações
//                       (escrita atômica tmp+rename, em lote)
// - data/events.jsonl -> log de acessos append-only (alto volume), com
//                       compactação periódica e leitura limitada a EVENT_MAX.
//
// DATA_DIR/DATA_FILE/EVENTS_FILE podem apontar para disco externo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialize, hydrate } from './state.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'state.json');
export const EVENTS_FILE = process.env.EVENTS_FILE || path.join(path.dirname(DATA_FILE), 'events.jsonl');
const EVENT_MAX = Number(process.env.EVENT_MAX || 50000);

let dirty = false;
let appended = 0;

export function markDirty() {
  dirty = true;
}

export function hasUnsaved() {
  return dirty;
}

function readEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  const events = [];
  for (const line of fs.readFileSync(EVENTS_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* linha truncada: ignora */ }
  }
  return events.slice(-EVENT_MAX);
}

export function loadState(store) {
  if (!fs.existsSync(DATA_FILE)) return false;
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  hydrate(store, JSON.parse(raw));
  store.events = readEvents();
  dirty = false;
  return true;
}

export function saveNow(store) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  // Eventos ficam no JSONL; o state.json permanece pequeno.
  const data = serialize(store);
  delete data.events;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DATA_FILE);
  dirty = false;
  return DATA_FILE;
}

export function saveIfDirty(store) {
  if (!dirty) return null;
  return saveNow(store);
}

export function appendEvent(store, evt) {
  try {
    fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
    fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(evt)}\n`);
    appended += 1;
    if (appended >= 5000) compactEvents(store);
  } catch (e) {
    console.log('[persist] evento não gravado:', e.message);
  }
}

export function compactEvents(store) {
  try {
    fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
    const body = store.events.map((e) => JSON.stringify(e)).join('\n');
    fs.writeFileSync(EVENTS_FILE, body ? `${body}\n` : '');
    appended = 0;
  } catch (e) {
    console.log('[persist] compactação falhou:', e.message);
  }
}

export function startAutoSave(store, intervalMs = Number(process.env.PERSIST_INTERVAL_MS || 3000)) {
  const timer = setInterval(() => {
    try { saveIfDirty(store); } catch (e) { console.log('[persist]', e.message); }
  }, intervalMs);
  timer.unref();
  return timer;
}
