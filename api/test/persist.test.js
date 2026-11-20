// Persistência em SQLite (node:sqlite): snapshot de estado + tabela de eventos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-persist-'));
process.env.DATA_DIR = TMP;
process.env.DB_FILE = path.join(TMP, 'painel.db');
process.env.EVENT_MAX = '3';
process.env.EVENT_COMPACT_EVERY = '2';

const persist = await import('../src/persist.js');

function freshStore() {
  return {
    persons: new Map([['p1', { id: 'p1', nome: 'Ana', enrollid: 1001 }]]),
    devices: new Map([['d1', { id: 'd1', nome: 'Catraca' }]]),
    users: new Map([['u1', { id: 'u1', login: 'admin' }]]),
    rules: [{ personId: 'p1', deviceId: 'd1', diasSemana: 127, horaIni: '00:00', horaFim: '23:59' }],
    events: [],
    syncQueue: [{ id: 's1', personId: 'p1', deviceId: 'd1', status: 'PENDING' }],
    notifications: [],
    meta: { lastBackupAt: null, nextEnrollid: 1002, dedup: {} },
  };
}

test('salva e recarrega cadastros no SQLite', () => {
  const s = freshStore();
  persist.markDirty();
  assert.equal(persist.hasUnsaved(), true);
  assert.equal(persist.saveNow(s), persist.DB_FILE);
  assert.ok(fs.existsSync(persist.DB_FILE));
  assert.equal(persist.hasUnsaved(), false);

  const outro = freshStore();
  outro.persons.clear();
  assert.equal(persist.loadState(outro), true);
  assert.equal(outro.persons.get('p1').nome, 'Ana');
  assert.equal(outro.rules.length, 1);
  assert.equal(outro.syncQueue[0].id, 's1');
});

test('eventos vão para a tabela e respeitam EVENT_MAX', () => {
  const s = freshStore();
  for (let i = 0; i < 5; i += 1) {
    const evt = {
      id: `e${i}`, deviceId: 'd1', personId: 'p1',
      timestamp: new Date(Date.now() + i * 1000).toISOString(), decisao: 'ALLOW',
    };
    s.events.push(evt);
    persist.appendEvent(s, evt);
  }
  const outro = freshStore();
  persist.loadState(outro);
  assert.equal(outro.events.length, 3);
  assert.equal(outro.events[2].id, 'e4');
});

test('snapshot não carrega a lista de eventos (tabela separada)', () => {
  const s = freshStore();
  s.events.push({ id: 'e1', timestamp: new Date().toISOString() });
  persist.saveNow(s);
  const db = new DatabaseSync(persist.DB_FILE);
  const raw = JSON.parse(db.prepare('SELECT json FROM state WHERE id = 1').get().json);
  const total = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  db.close();
  assert.equal(raw.events, undefined);
  assert.equal(raw.v, 1);
  assert.ok(total >= 1);
  assert.ok(fs.existsSync(persist.DB_FILE.replace(/\.db$/, '.db-wal')) || total >= 1);
});
