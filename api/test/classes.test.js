// Aulas, reservas, lista de espera e check-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { novaAula, normalizarAula, reservarAula, cancelarReserva, checkinAula } from '../src/classes.js';

function loja() {
  return {
    persons: new Map([
      ['p1', { id: 'p1', nome: 'Ana', matricula: 'M1' }],
      ['p2', { id: 'p2', nome: 'Bia', matricula: 'M2' }],
      ['p3', { id: 'p3', nome: 'Caio', matricula: 'M3' }],
    ]),
    classSessions: [],
    classBookings: [],
    plans: [],
    subscriptions: [],
    charges: [],
  };
}

test('valida aula obrigatória e capacidade', () => {
  assert.throws(() => normalizarAula({ inicio: '2026-12-01T10:00:00' }), /nome/);
  assert.throws(() => normalizarAula({ nome: 'X' }), /início/);
  const a = novaAula({ nome: 'Funcional', inicio: '2026-12-01T10:00:00', capacidade: 2 });
  assert.equal(a.nome, 'Funcional');
  assert.equal(a.capacidade, 2);
  assert.ok(a.id.startsWith('aula_'));
});

test('reserva respeita capacidade, coloca excedente em espera e promove ao cancelar', () => {
  const store = loja();
  const aula = novaAula({ nome: 'Funcional', inicio: '2026-12-01T10:00:00', capacidade: 2 });
  store.classSessions.push(aula);

  const r1 = reservarAula(store, aula.id, 'p1');
  const r2 = reservarAula(store, aula.id, 'p2');
  const r3 = reservarAula(store, aula.id, 'p3');
  assert.equal(r1.status, 'RESERVADO');
  assert.equal(r2.status, 'RESERVADO');
  assert.equal(r3.status, 'ESPERA');
  assert.match(r1.codigo, /^[0-9A-F]{6}$/);

  assert.throws(() => reservarAula(store, aula.id, 'p1'), /já reservado/);

  cancelarReserva(store, r2);
  assert.equal(r2.status, 'CANCELADO');
  assert.equal(r3.status, 'RESERVADO');
  assert.ok(r3.promovidoEm);
});

test('check-in por código marca presença e recusa código inválido', () => {
  const store = loja();
  const aula = novaAula({ nome: 'Sala', inicio: '2026-12-02T07:00:00' });
  store.classSessions.push(aula);
  const r = reservarAula(store, aula.id, 'p1');

  assert.throws(() => checkinAula(store, aula.id, 'ZZZZZZ'), /não encontrado/);
  const ok = checkinAula(store, aula.id, r.codigo.toLowerCase());
  assert.equal(ok.status, 'PRESENTE');
  assert.ok(ok.checkinAt);
});

test('aula encerrada não aceita reserva', () => {
  const store = loja();
  const aula = novaAula({ nome: 'Antiga', inicio: '2020-01-01T10:00:00', fim: '2020-01-01T11:00:00' });
  store.classSessions.push(aula);
  assert.throws(() => reservarAula(store, aula.id, 'p1'), /encerrada/);
});
