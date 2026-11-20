// Persistência: state.json (cadastros) + events.jsonl (acessos).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-persist-'));
process.env.DATA_FILE = path.join(TMP, 'state.json');
process.env.EVENTS_FILE = path.join(TMP, 'events.jsonl');
process.env.EVENT_MAX = '3';

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

test('salva e recarrega cadastros', () => {
  const s = freshStore();
  persist.markDirty();
  assert.equal(persist.hasUnsaved(), true);
  assert.ok(fs.existsSync(persist.saveNow(s)));
  assert.equal(persist.hasUnsaved(), false);

  const outro = freshStore();
  outro.persons.clear();
  assert.equal(persist.loadState(outro), true);
  assert.equal(outro.persons.get('p1').nome, 'Ana');
  assert.equal(outro.rules.length, 1);
  assert.equal(outro.syncQueue[0].id, 's1');
});

test('eventos vão para o JSONL e respeitam o limite', () => {
  const s = freshStore();
  for (let i = 0; i < 5; i += 1) {
    const evt = { id: `e${i}`, deviceId: 'd1', timestamp: new Date().toISOString() };
    s.events.push(evt);
    persist.appendEvent(s, evt);
  }
  assert.equal(s.events.length, 5);
  const outro = freshStore();
  persist.loadState(outro);
  assert.equal(outro.events.length, 3);
  assert.equal(outro.events[2].id, 'e4');
});

test('state.json não carrega a lista de eventos', () => {
  const s = freshStore();
  s.events.push({ id: 'e1' });
  persist.saveNow(s);
  const raw = JSON.parse(fs.readFileSync(persist.DATA_FILE, 'utf8'));
  assert.equal(raw.events, undefined);
  assert.equal(raw.v, 1);
});
