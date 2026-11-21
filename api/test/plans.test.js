// Planos, assinaturas, cobran?as e uso semanal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarPlano, novoPlano, criarAssinatura, cancelarAssinatura,
  planosAtivos, limiteSemanal, usoDaSemana, gerarCobrancasMes, trancarAssinatura, retomarAssinatura,
} from '../src/plans.js';

function loja() {
  return {
    persons: new Map([['p1', { id: 'p1', nome: 'Ana', ativo: true, validadeFim: null }]]),
    plans: [], subscriptions: [], charges: [], events: [], meta: {},
  };
}

test('normaliza plano e valida limites', () => {
  const p = normalizarPlano({ nome: '3x', valor: 99.9, diasPorSemana: 3, diasSemana: 127 });
  assert.equal(p.valor, 99.9);
  assert.equal(p.diasPorSemana, 3);
  assert.throws(() => normalizarPlano({ nome: 'X', diasPorSemana: 9 }), /entre 0 e 7/);
  assert.throws(() => normalizarPlano({ nome: 'X', valor: -1 }), /valor/);
});

test('contrata plano, gera cobran?a e validade; cancelar limpa validade', () => {
  const store = loja();
  const plano = novoPlano({ nome: '3x', valor: 100, diasPorSemana: 3, duracaoMeses: 1, diaVencimento: 10 });
  store.plans.push(plano);
  const sub = criarAssinatura(store, 'p1', plano, { inicio: '2026-11-01', agora: new Date('2026-11-01T10:00:00') });
  assert.equal(sub.status, 'ATIVA');
  assert.equal(store.charges.length, 1);
  assert.equal(store.charges[0].valor, 100);
  assert.equal(store.charges[0].competencia, '2026-11');
  assert.ok(store.persons.get('p1').validadeFim);
  assert.equal(planosAtivos(store, 'p1', new Date('2026-11-15T10:00:00')).length, 1);
  assert.equal(limiteSemanal(planosAtivos(store, 'p1', new Date('2026-11-15T10:00:00'))), 3);

  cancelarAssinatura(store, sub, { agora: new Date('2026-11-15T10:00:00') });
  assert.equal(sub.status, 'CANCELADA');
  assert.equal(store.persons.get('p1').validadeFim, null);

  const criadas = gerarCobrancasMes(store, '2026-12', { agora: new Date('2026-12-01T10:00:00') });
  assert.equal(criadas.length, 0); // assinatura cancelada
});

test('complementar soma limite e plano livre zera limite', () => {
  assert.equal(limiteSemanal([{ diasPorSemana: 3 }, { diasPorSemana: 1 }]), 4);
  assert.equal(limiteSemanal([{ diasPorSemana: 3 }, { diasPorSemana: 0 }]), 0);
});

test('uso da semana conta dias distintos, nao entradas', () => {
  const store = loja();
  const at = new Date('2026-11-18T20:00:00'); // quarta
  store.events = [
    { personId: 'p1', decisao: 'ALLOW', timestamp: '2026-11-16T10:00:00' },
    { personId: 'p1', decisao: 'ALLOW', timestamp: '2026-11-16T18:00:00' },
    { personId: 'p1', decisao: 'ALLOW', timestamp: '2026-11-17T10:00:00' },
    { personId: 'p1', decisao: 'DENY', timestamp: '2026-11-18T10:00:00' },
  ];
  const u = usoDaSemana(store, 'p1', at);
  assert.equal(u.diasUsadosSemana, 2);
  assert.equal(u.hojeJaUsado, false);
});


test('trancamento bloqueia acesso, estende fim e retomada reativa', () => {
  const store = loja();
  const plano = novoPlano({ nome: 'Mensal', valor: 100, diasPorSemana: 3, duracaoMeses: 1 });
  store.plans.push(plano);
  const inicio = '2026-11-01';
  const sub = criarAssinatura(store, 'p1', plano, { inicio, agora: new Date('2026-11-01T10:00:00') });
  const fimOriginal = new Date(sub.fim).getTime();
  const agora = new Date('2026-11-10T10:00:00');
  trancarAssinatura(store, sub, { dias: 30, agora, motivo: 'viagem' });
  assert.equal(sub.status, 'TRANCADA');
  assert.equal(store.persons.get('p1').validadeFim, null);
  assert.equal(planosAtivos(store, 'p1', agora).length, 0);

  retomarAssinatura(store, sub, { agora: new Date('2026-12-10T10:00:00') });
  assert.equal(sub.status, 'ATIVA');
  assert.ok(new Date(sub.fim).getTime() >= fimOriginal + 30 * 24 * 3600 * 1000 - 1000);
  assert.ok(store.persons.get('p1').validadeFim);
});
