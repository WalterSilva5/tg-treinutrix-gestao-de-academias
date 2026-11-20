// Migração automática do formato antigo (state.json + events.jsonl) para SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-migra-'));
process.env.DATA_DIR = TMP;
process.env.DB_FILE = path.join(TMP, 'painel.db');
process.env.DATA_FILE = path.join(TMP, 'state.json');
process.env.EVENTS_FILE = path.join(TMP, 'events.jsonl');

fs.writeFileSync(process.env.DATA_FILE, JSON.stringify({
  v: 1,
  at: new Date().toISOString(),
  persons: [{ id: 'per_1', nome: 'Legado', matricula: 'M1', enrollid: 1001 }],
  devices: [{ id: 'dev_fit4_01', nome: 'Catraca', ip: '192.168.0.100', porta: 3570 }],
  users: [{ id: 'usr_admin', login: 'admin', nome: 'Admin' }],
  rules: [{ personId: 'per_1', deviceId: 'dev_fit4_01', diasSemana: 127, horaIni: '00:00', horaFim: '23:59' }],
  events: [],
  syncQueue: [],
  notifications: [],
  meta: { lastBackupAt: null, nextEnrollid: 1002, dedup: {} },
}));
fs.writeFileSync(process.env.EVENTS_FILE, [
  JSON.stringify({ id: 'evt_1', timestamp: '2026-11-20T10:00:00.000Z', decisao: 'ALLOW' }),
  JSON.stringify({ id: 'evt_2', timestamp: '2026-11-20T11:00:00.000Z', decisao: 'DENY' }),
].join('\n'));

const persist = await import('../src/persist.js');

test('importa state.json + events.jsonl no primeiro boot', () => {
  const store = {
    persons: new Map(), devices: new Map(), users: new Map(),
    rules: [], events: [], syncQueue: [], notifications: [], meta: {},
  };
  assert.equal(persist.loadState(store), true);
  assert.equal(store.persons.get('per_1').nome, 'Legado');
  assert.equal(store.devices.size, 1);
  assert.equal(store.events.length, 2);
  assert.equal(store.events[1].id, 'evt_2');
  assert.ok(fs.existsSync(persist.DB_FILE));
  // O JSON antigo é renomeado como cópia da migração.
  assert.equal(fs.existsSync(process.env.DATA_FILE), false);

  const outro = {
    persons: new Map(), devices: new Map(), users: new Map(),
    rules: [], events: [], syncQueue: [], notifications: [], meta: {},
  };
  assert.equal(persist.loadState(outro), true);
  assert.equal(outro.persons.get('per_1').nome, 'Legado');
  assert.equal(outro.events.length, 2);
});
