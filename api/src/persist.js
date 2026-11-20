// Persistência local em SQLite (node:sqlite, nativo do Node 22+).
// - data/painel.db -> cadastros, usuários, regras, fila, notificações e eventos
// - uma linha de snapshot (JSON) para o estado "pequeno" + tabela de eventos
// - migra automaticamente o antigo data/state.json + events.jsonl no 1º boot
//
// DB_FILE/DATA_DIR podem apontar para disco externo. Sem Docker: o arquivo é
// local e entra no backup.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { serialize, hydrate } from './state.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'painel.db');
// Caminhos legados (migração/backup em JSON).
export const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'state.json');
export const EVENTS_FILE = process.env.EVENTS_FILE || path.join(DATA_DIR, 'events.jsonl');
const EVENT_MAX = Number(process.env.EVENT_MAX || 50000);
const COMPACT_EVERY = Number(process.env.EVENT_COMPACT_EVERY || 1000);

let db = null;
let dirty = false;
let appended = 0;

function abrir() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const conexao = new DatabaseSync(DB_FILE);
  conexao.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = OFF;
    CREATE TABLE IF NOT EXISTS state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      device_id TEXT,
      person_id TEXT,
      decisao TEXT,
      motivo TEXT,
      metodo TEXT,
      direcao TEXT,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_person ON events(person_id);
  `);
  return conexao;
}

export function getDb() {
  if (!db) db = abrir();
  return db;
}

export function closeDb() {
  if (!db) return;
  try { db.close(); } catch { /* já fechado */ }
  db = null;
}

export function markDirty() {
  dirty = true;
}

export function hasUnsaved() {
  return dirty;
}

function lerEventosLegado() {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  const eventos = [];
  for (const linha of fs.readFileSync(EVENTS_FILE, 'utf8').split('\n')) {
    if (!linha.trim()) continue;
    try { eventos.push(JSON.parse(linha)); } catch { /* linha truncada */ }
  }
  return eventos.slice(-EVENT_MAX);
}

function inserirEvento(conexao, evt) {
  conexao.prepare(`
    INSERT OR IGNORE INTO events
      (id, timestamp, device_id, person_id, decisao, motivo, metodo, direcao, json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(evt.id || `${Date.now()}-${Math.random()}`),
    String(evt.timestamp || new Date().toISOString()),
    evt.deviceId || null,
    evt.personId || null,
    evt.decisao || null,
    evt.motivo || null,
    evt.metodo || null,
    evt.direcao || null,
    JSON.stringify(evt),
  );
}

function gravarSnapshot(conexao, store, at = new Date()) {
  const data = serialize(store, at);
  delete data.events; // eventos têm tabela própria
  conexao.prepare(`
    INSERT INTO state (id, json, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
  `).run(JSON.stringify(data), data.at);
  return data;
}

function lerEventos(conexao) {
  return conexao.prepare('SELECT json FROM events ORDER BY rowid DESC LIMIT ?')
    .all(EVENT_MAX)
    .map((linha) => JSON.parse(linha.json))
    .reverse();
}

function migrarJsonLegado(conexao, store) {
  if (!fs.existsSync(DATA_FILE)) return false;
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  hydrate(store, data);
  store.events = lerEventosLegado();
  conexao.exec('BEGIN');
  try {
    gravarSnapshot(conexao, store);
    for (const evt of store.events) inserirEvento(conexao, evt);
    conexao.exec('COMMIT');
  } catch (e) {
    conexao.exec('ROLLBACK');
    throw e;
  }
  dirty = false;
  // Mantém o JSON antigo como cópia de segurança da migração.
  const backup = `${DATA_FILE}.migrado-${Date.now()}`;
  try { fs.renameSync(DATA_FILE, backup); } catch { /* sem permissão: deixa como está */ }
  console.log(`[persist] migrado ${DATA_FILE} -> ${DB_FILE} (cópia em ${backup})`);
  return true;
}

export function loadState(store) {
  const conexao = getDb();
  const linha = conexao.prepare('SELECT json FROM state WHERE id = 1').get();
  if (linha) {
    hydrate(store, JSON.parse(linha.json));
    store.events = lerEventos(conexao);
    dirty = false;
    trimEventos(conexao);
    return true;
  }
  if (migrarJsonLegado(conexao, store)) return true;
  return false;
}

function trimEventos(conexao) {
  const total = conexao.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  if (total > EVENT_MAX) {
    conexao.prepare(`
      DELETE FROM events WHERE rowid NOT IN (
        SELECT rowid FROM events ORDER BY rowid DESC LIMIT ?
      )
    `).run(EVENT_MAX);
  }
}

export function saveNow(store) {
  const conexao = getDb();
  conexao.exec('BEGIN');
  try {
    gravarSnapshot(conexao, store);
    conexao.exec('COMMIT');
  } catch (e) {
    conexao.exec('ROLLBACK');
    throw e;
  }
  dirty = false;
  return DB_FILE;
}

export function saveIfDirty(store) {
  if (!dirty) return null;
  return saveNow(store);
}

export function appendEvent(store, evt) {
  try {
    inserirEvento(getDb(), evt);
    appended += 1;
    if (appended >= COMPACT_EVERY) compactEvents(store);
  } catch (e) {
    console.log('[persist] evento não gravado:', e.message);
  }
}

export function compactEvents(store) {
  try {
    trimEventos(getDb());
    appended = 0;
  } catch (e) {
    console.log('[persist] compactação falhou:', e.message);
  }
}

// Restore de backup: o store veio do JSON, então a tabela de eventos precisa
// ser substituída para o banco não ficar com o histórico antigo.
export function replaceEvents(store) {
  try {
    const conexao = getDb();
    conexao.exec('BEGIN');
    try {
      conexao.exec('DELETE FROM events');
      for (const evt of store.events) inserirEvento(conexao, evt);
      conexao.exec('COMMIT');
    } catch (e) {
      conexao.exec('ROLLBACK');
      throw e;
    }
    appended = 0;
  } catch (e) {
    console.log('[persist] eventos do restore não gravados:', e.message);
  }
}

// Backup: força o WAL para o arquivo principal antes de copiar.
export function checkpointDb() {
  try { getDb().exec('PRAGMA wal_checkpoint(FULL)'); } catch { /* sem WAL ativo */ }
}

export function startAutoSave(store, intervalMs = Number(process.env.PERSIST_INTERVAL_MS || 3000)) {
  const timer = setInterval(() => {
    try { saveIfDirty(store); } catch (e) { console.log('[persist]', e.message); }
  }, intervalMs);
  timer.unref();
  return timer;
}
