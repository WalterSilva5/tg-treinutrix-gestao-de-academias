import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNotifications, ackNotification, listInadimplentes } from '../src/notify.js';

function freshStore() {
  return {
    persons: new Map([['p1', { id: 'p1' }]]),
    devices: new Map([['d1', { id: 'd1', nome: 'Catraca 1', lastSeen: new Date().toISOString() }]]),
    rules: [], events: [], syncQueue: [],
    notifications: [], meta: { lastBackupAt: new Date().toISOString() },
  };
}

test('primeira avaliação cria digest do dia', () => {
  const s = freshStore();
  const c = evaluateNotifications(s, new Date('2026-11-20T12:00:00'));
  assert.ok(c.some((n) => n.key === 'digest:2026-11-20'));
});

test('dedup: não duplica pendente com mesma chave', () => {
  const s = freshStore();
  const now = new Date('2026-11-20T12:00:00');
  evaluateNotifications(s, now);
  const n1 = s.notifications.length;
  evaluateNotifications(s, new Date(now.getTime() + 60000));
  assert.equal(s.notifications.length, n1);
});

test('lembrete de backup quando nunca fez', () => {
  const s = freshStore();
  s.meta.lastBackupAt = null;
  const c = evaluateNotifications(s);
  assert.ok(c.some((n) => n.tipo === 'BACKUP'));
});

test('sem lembrete com backup recente', () => {
  const s = freshStore();
  const c = evaluateNotifications(s);
  assert.ok(!c.some((n) => n.tipo === 'BACKUP'));
});

test('dispositivo sem contato gera notificação', () => {
  const s = freshStore();
  s.devices.get('d1').lastSeen = new Date(Date.now() - 3600e3).toISOString();
  const c = evaluateNotifications(s);
  assert.ok(c.some((n) => n.key === 'device-offline:d1'));
});

test('ack exige existir e marca responsável', () => {
  const s = freshStore();
  evaluateNotifications(s);
  const id = s.notifications[0].id;
  assert.equal(ackNotification(s, 'inexistente', 'Ana'), null);
  const n = ackNotification(s, id, 'Ana');
  assert.equal(n.resolvida, true);
  assert.equal(n.resolvidaPor, 'Ana');
  assert.equal(ackNotification(s, id, 'Beto'), null); // já resolvida
});

test('inativo não entra na inadimplência', () => {
  const s = {
    persons: new Map([
      ['a', { id: 'a', ativo: true, validadeFim: '2020-01-01T00:00:00Z' }],
      ['b', { id: 'b', ativo: false, validadeFim: '2020-01-01T00:00:00Z' }],
      ['c', { id: 'c', ativo: true, validadeFim: '2099-01-01T00:00:00Z' }],
      ['d', { id: 'd', ativo: true, validadeFim: null }],
    ]),
    devices: new Map(), rules: [], events: [], syncQueue: [],
    notifications: [], meta: { lastBackupAt: new Date().toISOString() },
  };
  const inad = listInadimplentes(s, new Date('2026-11-20T12:00:00'));
  assert.deepEqual(inad.map((p) => p.id), ['a']);
});
