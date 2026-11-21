// Relatório financeiro: competência, caixa, planos, formas e devedores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { relatorioFinanceiro, agingFinanceiro, fluxoCaixa } from '../src/finance.js';

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


test('aging classifica atraso e fluxo soma receitas e despesas', () => {
  const store = loja();
  store.expenses = [
    { id: 'x1', data: '2026-11-05', valor: 30, descricao: 'Luz', categoria: 'Contas' },
    { id: 'x2', data: '2026-11-15', valor: 20, descricao: 'Internet', categoria: 'Contas' },
  ];
  const a = agingFinanceiro(store, { agora: new Date('2026-11-20T12:00:00') });
  assert.ok(a.totalVencido >= 150);
  assert.ok(a.pessoas.length >= 2);
  assert.ok(a.pessoas.some((p) => p.faixa === 'd1_30'));
  assert.equal(a.pessoas.find((p) => p.personId === 'a1').faixa, 'd1_30');

  const f = fluxoCaixa(store, { inicio: '2026-11-01', fim: '2026-11-30', agora: new Date('2026-11-20T12:00:00') });
  assert.equal(f.totalReceitas, 200); // c1 100 + c4 100 pagos em nov
  assert.equal(f.totalDespesas, 50);
  assert.equal(f.saldo, 150);
  assert.equal(f.porCategoria[0].categoria, 'Contas');
});

test('fluxo soma mensalidades, eventos e servicos com origem', () => {
  const store = loja();
  store.socialEvents = [{ id: 'e1', nome: 'Workshop', inicio: '2026-11-10T19:00:00', valor: 50 }];
  store.eventParticipants = [
    { id: 'ep1', eventId: 'e1', personId: 'a1', nome: 'Ana', pago: true, valorPago: 50, pagoEm: '2026-11-12T10:00:00', formaPagamento: 'pix' },
    { id: 'ep2', eventId: 'e1', personId: 'a2', nome: 'Beto', pago: false, valorPago: 0, status: 'INSCRITO' },
  ];
  store.serviceCharges = [
    { id: 's1', descricao: 'Personal', categoria: 'Personal', valor: 80, data: '2026-11-15', status: 'PAGO', pagoEm: '2026-11-15T12:00:00', forma: 'dinheiro' },
    { id: 's2', descricao: 'Camiseta', categoria: 'Produto', valor: 60, data: '2026-11-16', status: 'PENDENTE' },
  ];
  store.expenses = [{ id: 'x1', data: '2026-11-05', valor: 30, descricao: 'Luz', categoria: 'Contas' }];

  const f = fluxoCaixa(store, { inicio: '2026-11-01', fim: '2026-11-30', agora: new Date('2026-11-20T12:00:00') });
  assert.equal(f.totais.mensalidades, 200);
  assert.equal(f.totais.eventos, 50);
  assert.equal(f.totais.servicos, 80);
  assert.equal(f.totalReceitas, 330);
  assert.equal(f.saldo, 300);
  assert.deepEqual(f.porOrigem.map((o) => o.origem).sort(), ['EVENTO', 'MENSALIDADE', 'SERVICO']);
});
