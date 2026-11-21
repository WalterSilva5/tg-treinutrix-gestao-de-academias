// Relatório financeiro agregado (competência x caixa). Função pura.
import { parseDate, localDayKey, addMonths } from './time.js';

function mesDe(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function mesesEntre(de, ate) {
  const out = [];
  let d = new Date(de.getFullYear(), de.getMonth(), 1);
  const fim = new Date(ate.getFullYear(), ate.getMonth(), 1);
  while (d <= fim) {
    out.push(mesDe(d));
    d = addMonths(d, 1);
  }
  return out;
}

export function relatorioFinanceiro(store, { inicio, fim, agora = new Date() } = {}) {
  const ate = fim ? parseDate(fim, { endOfDay: true }) : agora;
  const de = inicio ? parseDate(inicio) : new Date(ate.getFullYear(), ate.getMonth(), 1);
  const competencias = mesesEntre(de, ate);
  const primeiroMes = competencias[0];
  const ultimoMes = competencias[competencias.length - 1];

  const charges = store.charges || [];
  const noPeriodo = charges.filter((c) => c.competencia >= primeiroMes && c.competencia <= ultimoMes && c.status !== 'CANCELADO');
  const pagasNoPeriodo = charges.filter((c) => {
    if (c.status !== 'PAGO' || !c.pagoEm) return false;
    const d = new Date(c.pagoEm);
    return !Number.isNaN(d.getTime()) && d >= de && d <= ate;
  });

  const valor = (c) => Number(c.valor) || 0;
  const previsto = noPeriodo.reduce((s, c) => s + valor(c), 0);
  const recebido = pagasNoPeriodo.reduce((s, c) => s + valor(c), 0);
  const emAberto = noPeriodo.filter((c) => c.status === 'PENDENTE' || c.status === 'ATRASADO')
    .reduce((s, c) => s + valor(c), 0);
  const vencido = noPeriodo.filter((c) => c.status === 'ATRASADO' || (c.status === 'PENDENTE' && c.vencimento < localDayKey(agora)))
    .reduce((s, c) => s + valor(c), 0);

  const porCompetencia = new Map();
  for (const mes of competencias) porCompetencia.set(mes, { competencia: mes, previsto: 0, recebido: 0, aberto: 0, vencido: 0, quantidade: 0 });
  for (const c of noPeriodo) {
    const row = porCompetencia.get(c.competencia);
    if (!row) continue;
    row.previsto += valor(c);
    row.quantidade += 1;
    if (c.status === 'PAGO') row.recebido += valor(c);
    else if (c.status === 'PENDENTE' || c.status === 'ATRASADO') row.aberto += valor(c);
    if (c.status === 'ATRASADO' || (c.status === 'PENDENTE' && c.vencimento < localDayKey(agora))) row.vencido += valor(c);
  }

  const porPlano = new Map();
  for (const c of noPeriodo) {
    const plano = (store.plans || []).find((p) => p.id === c.planId);
    const chave = c.planId || 'sem-plano';
    const row = porPlano.get(chave) || { planId: chave, plano: plano?.nome || 'Sem plano', quantidade: 0, previsto: 0, recebido: 0, aberto: 0 };
    row.quantidade += 1;
    row.previsto += valor(c);
    if (c.status === 'PAGO') row.recebido += valor(c);
    else if (c.status === 'PENDENTE' || c.status === 'ATRASADO') row.aberto += valor(c);
    porPlano.set(chave, row);
  }

  const porForma = new Map();
  for (const c of pagasNoPeriodo) {
    const forma = c.forma || 'não informado';
    const row = porForma.get(forma) || { forma, quantidade: 0, total: 0 };
    row.quantidade += 1;
    row.total += valor(c);
    porForma.set(forma, row);
  }

  const devedores = new Map();
  for (const c of noPeriodo) {
    if (c.status !== 'PENDENTE' && c.status !== 'ATRASADO') continue;
    const p = store.persons.get(c.personId);
    const row = devedores.get(c.personId) || {
      personId: c.personId, nome: p?.nome || c.personId, matricula: p?.matricula || '',
      aberto: 0, vencido: 0, cobrancas: 0,
    };
    row.aberto += valor(c);
    if (c.status === 'ATRASADO' || (c.status === 'PENDENTE' && c.vencimento < localDayKey(agora))) row.vencido += valor(c);
    row.cobrancas += 1;
    devedores.set(c.personId, row);
  }

  return {
    periodo: { inicio: de.toISOString(), fim: ate.toISOString(), competencias },
    kpis: {
      previsto, recebido, emAberto, vencido,
      taxaRecebimento: previsto > 0 ? Math.round((recebido / previsto) * 1000) / 10 : 0,
      cobrancas: noPeriodo.length,
      pagas: pagasNoPeriodo.length,
      devedores: devedores.size,
    },
    porCompetencia: [...porCompetencia.values()],
    porPlano: [...porPlano.values()].sort((a, b) => b.previsto - a.previsto),
    porForma: [...porForma.values()].sort((a, b) => b.total - a.total),
    devedores: [...devedores.values()].sort((a, b) => b.vencido - a.vencido || b.aberto - a.aberto).slice(0, 50),
  };
}
