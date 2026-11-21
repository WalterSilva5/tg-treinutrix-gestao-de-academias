// Relatório financeiro: competência, caixa, planos, formas e devedores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { relatorioFinanceiro } from '../src/finance.js';

function loja() {
  return {
    plans: [
      { id: 'p3', nome: '3x' },
      { id: 'pf', nome: 'Funcional' },
    ],
    persons: new Map([
      ['a1', { id: 'a1', nome: 'Ana', matricula: 'A1' }],
      ['a2', { id: 'a2', nome: 'Beto', matricula: 'A2' }],
    ]),
    charges: [
      { id: 'c1', personId: 'a1', planId: 'p3', competencia: '2026-11', vencimento: '2026-11-10', valor: 100, status: 'PAGO', pagoEm: '2026-11-05T10:00:00', forma: 'pix' },
      { id: 'c2', personId: 'a2', planId: 'p3', competencia: '2026-11', vencimento: '2026-11-10', valor: 100, status: 'ATRASADO', pagoEm: null },
      { id: 'c3', personId: 'a1', planId: 'pf', competencia: '2026-11', vencimento: '2026-11-15', valor: 50, status: 'PENDENTE', pagoEm: null },
      { id: 'c4', personId: 'a2', planId: 'p3', competencia: '2026-10', vencimento: '2026-10-10', valor: 100, status: 'PAGO', pagoEm: '2026-11-02T10:00:00', forma: 'dinheiro' },
      { id: 'c5', personId: 'a1', planId: 'p3', competencia: '2026-12', vencimento: '2026-12-10', valor: 100, status: 'PENDENTE' },
    ],
  };
}

test('consolida previsto, recebido, aberto e vencido', () => {
  const r = relatorioFinanceiro(loja(), { inicio: '2026-11-01', fim: '2026-11-30', agora: new Date('2026-11-20T12:00:00') });
  assert.equal(r.kpis.previsto, 250); // c1+c2+c3
  assert.equal(r.kpis.recebido, 200); // c1 100 + c4 100 (pago em nov)
  assert.equal(r.kpis.emAberto, 150);
  assert.equal(r.kpis.vencido, 150);
  assert.equal(r.kpis.taxaRecebimento, 80);
  assert.equal(r.kpis.devedores, 2);

  assert.equal(r.porCompetencia.length, 1);
  assert.equal(r.porCompetencia[0].competencia, '2026-11');
  assert.equal(r.porCompetencia[0].previsto, 250);

  const p3 = r.porPlano.find((p) => p.planId === 'p3');
  assert.equal(p3.previsto, 200);
  assert.equal(p3.recebido, 100);
  assert.equal(p3.aberto, 100);

  assert.deepEqual(r.porForma.map((f) => f.forma).sort(), ['dinheiro', 'pix']);
  assert.equal(r.devedores[0].vencido, 100);
});

test('mês sem cobranças devolve zeros', () => {
  const r = relatorioFinanceiro(loja(), { inicio: '2027-01-01', fim: '2027-01-31', agora: new Date('2027-01-20T12:00:00') });
  assert.equal(r.kpis.previsto, 0);
  assert.equal(r.kpis.recebido, 0);
  assert.equal(r.kpis.devedores, 0);
  assert.equal(r.porCompetencia[0].competencia, '2027-01');
});
