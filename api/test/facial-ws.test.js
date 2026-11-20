import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSetUserinfo, buildDeleteUser, buildAccessAnswer, parseReaderMessage } from '../../edge-catraca/src/facial-ws.js';

test('setuserinfo com foto usa backupnum 50', () => {
  const p = buildSetUserinfo({ enrollid: 123, name: 'Ana', fotoBase64: 'abc' });
  assert.equal(p.cmd, 'setuserinfo');
  assert.equal(p.backupnum, 50);
});

test('setuserinfo sem foto usa backupnum 0 e record 0', () => {
  const p = buildSetUserinfo({ enrollid: 123, name: 'Ana' });
  assert.equal(p.backupnum, 0);
  assert.equal(p.record, '0');
});

test('deleteuser usa backupnum 13', () => {
  assert.equal(buildDeleteUser(123).cmd, 'deleteuser');
});

test('resposta de acesso usa ret sendlog', () => {
  const a = buildAccessAnswer({ sn: 'ABC', access: true, enrollid: 123, message: 'ok' });
  assert.equal(a.ret, 'sendlog');
  assert.equal(a.access, true);
});

test('parse sendlog / reg / desconhecido', () => {
  assert.equal(parseReaderMessage({ cmd: 'sendlog', sn: 'S1', record: [{ enrollid: 7 }] }).tipo, 'ACESSO');
  assert.equal(parseReaderMessage({ cmd: 'reg', sn: 'S1' }).tipo, 'REGISTRO');
  assert.equal(parseReaderMessage({ cmd: 'futuro' }).tipo, 'DESCONHECIDO');
});
