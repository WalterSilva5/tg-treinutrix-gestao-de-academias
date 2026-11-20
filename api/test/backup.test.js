import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isola backups dos testes num diretório temporário.
process.env.BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-bkp-'));
const { doBackup, listBackups, doRestore, BACKUP_DIR } = await import('../src/backup.js');

function freshStore() {
  return {
    persons: new Map([['p1', { id: 'p1', nome: 'Ana' }]]),
    devices: new Map(), rules: [],
    events: [{ id: 'e1' }], syncQueue: [],
    notifications: [], meta: { lastBackupAt: null },
  };
}

test('backup gera arquivo e atualiza lastBackupAt', () => {
  const s = freshStore();
  const r = doBackup(s);
  assert.match(r.file, /^painel_.*\.json$/);
  assert.ok(s.meta.lastBackupAt);
  assert.ok(fs.existsSync(`${BACKUP_DIR}/${r.file}`));
});

test('restore recupera dados e rejeita path traversal', () => {
  const s = freshStore();
  const { file } = doBackup(s);
  s.persons.clear();
  assert.equal(s.persons.size, 0);
  const r = doRestore(s, file);
  assert.equal(s.persons.size, 1);
  assert.equal(r.file, file);
  assert.throws(() => doRestore(s, '../../etc/passwd'), /inválido/);
});
