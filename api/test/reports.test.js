// Relatório agregado por período (função pura).
import test from 'node:test';
import assert from 'node:assert/strict';
import { relatorioGeral } from '../src/reports.js';

const agora = new Date('2026-11-20T12:00:00-03:00');

function loja() {
  return {
    events: [
      { id: 'e1', personId: 'a1', timestamp: '2026-11-18T10:00:00-03:00', decisao: 'ALLOW', motivo: 'OK' },
      { id: 'e2', personId: 'a1', timestamp: '2026-11-18T18:00:00-03:00', decisao: 'ALLOW', motivo: 'OK' },
      { id: 'e3', personId: 'a2', timestamp: '2026-11-19T07:00:00-03:00', decisao: 'DENY', motivo: 'FORA_VALIDADE' },
      { id: 'e4', personId: 'a2', timestamp: '2026-09-01T07:00:00-03:00', decisao: 'ALLOW', motivo: 'OK' },
    ],
    persons: new Map([
      ['a1', { id: 'a1', nome: 'Ana', matricula: 'A1', tipo: 'ALUNO', ativo: true, validadeFim: '2026-12-31', criadoEm: '2026-11-01T10:00:00-03:00' }],
      ['a2', { id: 'a2', nome: 'Beto', matricula: 'A2', tipo: 'ALUNO', ativo: true, validadeFim: '2026-10-01', criadoEm: '2025-01-01T10:00:00-03:00' }],
    ]),
    socialEvents: [{ id: 'ev1', nome: 'Aulão', inicio: '2026-11-18T19:00:00-03:00', local: 'Sala' }],
    eventParticipants: [
      { id: 'p1', eventId: 'ev1', personId: 'a1', status: 'PRESENTE', valorPago: 50 },
      { id: 'p2', eventId: 'ev1', personId: null, status: 'ESPERA' },
    ],
    raffleDraws: [{ id: 'd1', raffleNome: 'Sorteio', sorteadoEm: '2026-11-19T20:00:00-03:00', vencedores: [{ nome: 'Ana' }], totalParticipantes: 2 }],
  };
}

test('agrega acessos, pessoas, inadimplentes, eventos e sorteios', () => {
  const r = relatorioGeral(loja(), { inicio: '2026-11-01', fim: '2026-11-20', agora });
  assert.equal(r.kpis.eventos, 3);
  assert.equal(r.kpis.liberados, 2);
  assert.equal(r.kpis.negados, 1);
  assert.equal(r.kpis.pessoasUnicas, 2);
  assert.equal(r.kpis.novos, 1);
  assert.equal(r.kpis.inadimplentes, 1);
  assert.equal(r.kpis.eventosSociais, 1);
  assert.equal(r.kpis.sorteios, 1);

  assert.deepEqual(r.porDia.map((d) => d.dia), ['2026-11-18', '2026-11-19']);
  assert.equal(r.porDia[0].total, 2);
  assert.equal(r.porDia[0].pessoas, 1);
  assert.equal(r.topPessoas[0].nome, 'Ana');
  assert.equal(r.topPessoas[0].acessos, 2);
  assert.equal(r.topPessoas[0].dias, 1);
  assert.equal(r.inadimplentes[0].nome, 'Beto');
  assert.equal(r.eventosSociais[0].inscritos, 1);
  assert.equal(r.eventosSociais[0].presentes, 1);
  assert.equal(r.eventosSociais[0].receita, 50);
  assert.deepEqual(r.sorteios[0].vencedores, ['Ana']);
});

test('período padrão cobre 30 dias e não inclui fora da janela', () => {
  const r = relatorioGeral(loja(), { agora });
  assert.equal(r.kpis.eventos, 3);
  assert.equal(r.kpis.eventos, r.porDia.reduce((s, d) => s + d.total, 0));
});
