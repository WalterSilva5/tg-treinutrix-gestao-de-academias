// Lista de risco de evasão.
import test from 'node:test';
import assert from 'node:assert/strict';
import { riscosRetencao } from '../src/retention-risk.js';

function loja(pessoas = []) {
  return {
    persons: new Map(pessoas.map((p) => [p.id, p])),
    events: [],
    plans: [],
    subscriptions: [],
    charges: [],
  };
}

test('aluno sem plano e nunca frequentou entra como risco', () => {
  const store = loja([
    { id: 'p1', nome: 'Ana', tipo: 'ALUNO', ativo: true, criadoEm: '2026-10-01T10:00:00' },
  ]);
  const r = riscosRetencao(store, { agora: new Date('2026-11-20T12:00:00') });
  assert.equal(r.total, 1);
  assert.ok(r.pessoas[0].pontos >= 20);
  assert.ok(r.pessoas[0].motivos.includes('nunca frequentou'));
  assert.ok(r.pessoas[0].motivos.includes('sem plano ativo'));
});

test('visita recente com plano válido reduz risco', () => {
  const store = loja([
    {
      id: 'p1', nome: 'Bia', tipo: 'ALUNO', ativo: true, criadoEm: '2026-01-01T10:00:00',
      validadeFim: '2026-12-31',
    },
  ]);
  store.subscriptions.push({ id: 's1', personId: 'p1', status: 'ATIVA', planoNome: 'Mensal', fim: '2026-12-31T23:59:59' });
  store.events.push({ personId: 'p1', decisao: 'ALLOW', timestamp: '2026-11-19T10:00:00' });
  const r = riscosRetencao(store, { agora: new Date('2026-11-20T12:00:00') });
  assert.equal(r.total, 0);
});

test('dias sem visita e vencimento próximo somam pontos', () => {
  const store = loja([
    { id: 'p1', nome: 'Caio', tipo: 'ALUNO', ativo: true, validadeFim: '2026-11-22' },
  ]);
  store.subscriptions.push({ id: 's1', personId: 'p1', status: 'ATIVA', planoNome: 'Mensal', fim: '2026-11-24T23:59:59' });
  store.events.push({ personId: 'p1', decisao: 'ALLOW', timestamp: '2026-10-01T10:00:00' });
  const r = riscosRetencao(store, { agora: new Date('2026-11-20T12:00:00') });
  assert.equal(r.total, 1);
  assert.ok(r.pessoas[0].diasSemVisita >= 50);
  assert.ok(r.pessoas[0].motivos.some((m) => m.includes('plano vence')));
});

test('inativo e visitante ficam fora da lista', () => {
  const store = loja([
    { id: 'p1', nome: 'Inativo', tipo: 'ALUNO', ativo: false, criadoEm: '2026-01-01T10:00:00' },
    { id: 'p2', nome: 'Visitante', tipo: 'VISITANTE', ativo: true, criadoEm: '2026-01-01T10:00:00' },
  ]);
  const r = riscosRetencao(store, { agora: new Date('2026-11-20T12:00:00') });
  assert.equal(r.total, 0);
});
