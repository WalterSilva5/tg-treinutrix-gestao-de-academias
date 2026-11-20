import test from 'node:test';
import assert from 'node:assert/strict';
import { diasFrequentados, alunosNoDia } from '../src/frequency.js';

const eventos = [
  // Ana entra e sai 3x no mesmo dia -> 1 dia
  { personId: 'ana', decisao: 'ALLOW', timestamp: '2026-11-18T07:00:00.000Z' },
  { personId: 'ana', decisao: 'ALLOW', timestamp: '2026-11-18T12:00:00.000Z' },
  { personId: 'ana', decisao: 'ALLOW', timestamp: '2026-11-18T18:00:00.000Z' },
  { personId: 'ana', decisao: 'ALLOW', timestamp: '2026-11-19T07:10:00.000Z' },
  { personId: 'ana', decisao: 'DENY', timestamp: '2026-11-19T07:20:00.000Z' },
  { personId: 'beto', decisao: 'ALLOW', timestamp: '2026-11-18T08:00:00.000Z' },
];

test('conta dias distintos, não passagens', () => {
  const r = diasFrequentados(eventos, 'ana', new Date('2026-11-20T12:00:00.000Z'));
  assert.equal(r.totalDias, 2);
  assert.deepEqual(r.dias, ['2026-11-18', '2026-11-19']);
});

test('negado não conta como frequência', () => {
  const r = diasFrequentados(eventos, 'ana', new Date('2026-11-20T12:00:00.000Z'));
  assert.equal(r.dias.includes('2026-11-02'), false);
  assert.equal(r.totalDias, 2);
});

test('resume mês atual e últimos 30 dias', () => {
  const r = diasFrequentados(eventos, 'ana', new Date('2026-11-20T12:00:00.000Z'));
  assert.equal(r.diasNoMes, 2);
  assert.equal(r.ultimos30, 2);
});

test('frequência de outro mês não entra no mês atual', () => {
  const antigos = [{ personId: 'ana', decisao: 'ALLOW', timestamp: '2026-08-10T09:00:00.000Z' }];
  const r = diasFrequentados(antigos, 'ana', new Date('2026-11-20T12:00:00.000Z'));
  assert.equal(r.totalDias, 1);
  assert.equal(r.diasNoMes, 0);
  assert.equal(r.ultimos30, 0);
});

test('alunosNoDia conta pessoas distintas', () => {
  assert.equal(alunosNoDia(eventos, '2026-11-18'), 2);
  assert.equal(alunosNoDia(eventos, '2026-11-19'), 1);
  assert.equal(alunosNoDia(eventos, '2026-11-20'), 0);
});
