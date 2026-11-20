import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSetUserinfo, buildDeleteUser, buildAccessAnswer, parseReaderMessage,
  buildRegAnswer, buildSetDevinfo, buildGetUserList, buildEnableDevice,
  BackupNum, ModoAutenticacao, ENROLLID_DESCONHECIDO,
} from '../../edge-catraca/src/facial-ws.js';

test('resposta reg obrigatória com cloudtime', () => {
  const r = buildRegAnswer(new Date('2026-11-20T12:00:00'));
  assert.equal(r.ret, 'reg');
  assert.equal(r.result, true);
  assert.match(r.cloudtime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('setuserinfo com foto usa backupnum 50', () => {
  const p = buildSetUserinfo({ enrollid: 123, name: 'Ana', fotoBase64: 'abc' });
  assert.equal(p.cmd, 'setuserinfo');
  assert.equal(p.backupnum, BackupNum.Foto);
});

test('setuserinfo sem foto usa backupnum 0 e record 0', () => {
  const p = buildSetUserinfo({ enrollid: 123, name: 'Ana' });
  assert.equal(p.backupnum, BackupNum.TodosDados);
  assert.equal(p.record, '0');
});

test('deleteuser usa backupnum 13 (Todos)', () => {
  assert.equal(buildDeleteUser(123).backupnum, BackupNum.Todos);
});

test('setdevinfo online por padrão', () => {
  assert.equal(buildSetDevinfo().server_verify, 1);
});

test('getuserlist pagina com stn', () => {
  assert.deepEqual(buildGetUserList(true), { cmd: 'getuserlist', stn: true });
  assert.deepEqual(buildGetUserList(false), { cmd: 'getuserlist', stn: false });
});

test('enable/disable device', () => {
  assert.equal(buildEnableDevice(true).cmd, 'enabledevice');
  assert.equal(buildEnableDevice(false).cmd, 'disabledevice');
});

test('resposta de acesso no formato oficial', () => {
  const a = buildAccessAnswer({ access: false, message: 'Usuário não cadastrado' });
  assert.equal(a.ret, 'sendlog');
  assert.equal(a.result, true);
  assert.equal(a.access, false);
});

test('parse sendlog oficial com mode facial', () => {
  const m = parseReaderMessage({
    cmd: 'sendlog', sn: 'S1', count: 1, logindex: 0,
    record: [{ enrollid: 300, name: 'Ana', time: '2026-11-20 12:00:00', mode: 8, inout: 0, event: 0 }],
  });
  assert.equal(m.tipo, 'ACESSO');
  assert.equal(m.mode, ModoAutenticacao.Facial);
  assert.equal(m.desconhecido, false);
});

test('parse sendlog desconhecido (99999999)', () => {
  const m = parseReaderMessage({
    cmd: 'sendlog', sn: 'S1', count: 1, logindex: 124,
    record: [{ enrollid: ENROLLID_DESCONHECIDO, name: '', time: '2026-11-20 12:00:00', mode: 1, inout: 0, event: 2 }],
  });
  assert.equal(m.desconhecido, true);
});

test('parse sendlog sem record não quebra', () => {
  assert.equal(parseReaderMessage({ cmd: 'sendlog', sn: 'S1' }).tipo, 'ACESSO_VAZIO');
});

test('parse reg / senduser / desconhecido', () => {
  assert.equal(parseReaderMessage({ cmd: 'reg', sn: 'S1' }).tipo, 'REGISTRO');
  assert.equal(parseReaderMessage({ cmd: 'senduser', backupnum: 50 }).tipo, 'USUARIO');
  assert.equal(parseReaderMessage({ cmd: 'futuro' }).tipo, 'DESCONHECIDO');
});
