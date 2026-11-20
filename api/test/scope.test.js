import test from 'node:test';
import assert from 'node:assert/strict';
import { visiblePersons, visibleEvents, canSeeOperations } from '../src/scope.js';

const persons = [
  { id: 'p1', nome: 'Ana' },
  { id: 'p2', nome: 'Beto' },
];
const events = [
  { id: 'e1', personId: 'p1' },
  { id: 'e2', personId: 'p2' },
  { id: 'e3', personId: 'p1' },
];

test('aluno vê somente o próprio cadastro', () => {
  const out = visiblePersons(persons, { sub: 'p1', perfil: 'aluno' });
  assert.deepEqual(out.map((p) => p.id), ['p1']);
});

test('aluno vê somente os próprios eventos', () => {
  const out = visibleEvents(events, { sub: 'p1', perfil: 'aluno' });
  assert.deepEqual(out.map((e) => e.id), ['e1', 'e3']);
});

test('equipe vê tudo', () => {
  const gestor = { sub: 'u1', perfil: 'gerencia' };
  assert.equal(visiblePersons(persons, gestor).length, 2);
  assert.equal(visibleEvents(events, gestor).length, 3);
});

test('sem usuário, nada é visível', () => {
  assert.deepEqual(visiblePersons(persons, null), []);
  assert.deepEqual(visibleEvents(events, null), []);
});

test('operações liberadas só para equipe', () => {
  assert.equal(canSeeOperations({ perfil: 'aluno' }), false);
  assert.equal(canSeeOperations({ perfil: 'recepcao' }), true);
  assert.equal(canSeeOperations({ perfil: 'gerencia' }), true);
  assert.equal(canSeeOperations(null), false);
});
