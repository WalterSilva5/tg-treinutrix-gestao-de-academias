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

export function relatorioFinanceiro(store, { inicio, fim, agora = new Date() } = {}) {  const ate = fim ? parseDate(fim, { endOfDay: true }) : agora;
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

export function agingFinanceiro(store, { agora = new Date() } = {}) {
  const hoje = localDayKey(agora);
  const pessoas = new Map();
  const buckets = { aVencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };

  for (const c of store.charges || []) {
    if (c.status !== 'PENDENTE' && c.status !== 'ATRASADO') continue;
    const venc = new Date(`${c.vencimento}T12:00:00`);
    const dias = Math.max(0, Math.floor((agora - venc) / (24 * 3600 * 1000)));
    let faixa = 'aVencer';
    if (c.vencimento < hoje) {
      if (dias <= 30) faixa = 'd1_30';
      else if (dias <= 60) faixa = 'd31_60';
      else if (dias <= 90) faixa = 'd61_90';
      else faixa = 'd90';
    }
    buckets[faixa] += Number(c.valor) || 0;
    const p = store.persons.get(c.personId);
    const row = pessoas.get(c.personId) || {
      personId: c.personId, nome: p?.nome || c.personId, matricula: p?.matricula || '',
      telefone: p?.telefone || '', aberto: 0, vencido: 0, cobrancas: 0,
      maisAntigo: null, faixa: 'aVencer',
    };
    row.aberto += Number(c.valor) || 0;
    row.cobrancas += 1;
    if (c.vencimento < hoje) {
      row.vencido += Number(c.valor) || 0;
      if (!row.maisAntigo || c.vencimento < row.maisAntigo) row.maisAntigo = c.vencimento;
    }
    const ordem = { aVencer: 0, d1_30: 1, d31_60: 2, d61_90: 3, d90: 4 };
    if (ordem[faixa] > ordem[row.faixa]) row.faixa = faixa;
    pessoas.set(c.personId, row);
  }

  const lista = [...pessoas.values()].sort((a, b) => b.vencido - a.vencido || b.aberto - a.aberto);
  return {
    hoje,
    totalAberto: lista.reduce((s, p) => s + p.aberto, 0),
    totalVencido: lista.reduce((s, p) => s + p.vencido, 0),
    buckets,
    pessoas: lista,
  };
}

function dentro(dataIso, de, ate) {
  const d = new Date(dataIso);
  return !Number.isNaN(d.getTime()) && d >= de && d <= ate;
}

// Fluxo de caixa: mensalidades, eventos, serviços avulsos e despesas.
export function fluxoCaixa(store, { inicio, fim, agora = new Date() } = {}) {
  const ate = fim ? parseDate(fim, { endOfDay: true }) : agora;
  const de = inicio ? parseDate(inicio) : new Date(ate.getFullYear(), ate.getMonth(), 1);
  const receitas = [];

  for (const c of store.charges || []) {
    if (c.status !== 'PAGO' || !c.pagoEm || !dentro(c.pagoEm, de, ate)) continue;
    receitas.push({
      id: c.id, origem: 'MENSALIDADE',
      descricao: `Mensalidade ${c.competencia || ''}`.trim(),
      personId: c.personId || null, valor: Number(c.valor || 0),
      pagoEm: c.pagoEm, forma: c.forma || null,
    });
  }
  for (const p of store.eventParticipants || []) {
    if (!p.pago || !p.pagoEm || !dentro(p.pagoEm, de, ate)) continue;
    const valor = Number(p.valorPago || 0);
    if (valor <= 0) continue;
    const evento = (store.socialEvents || []).find((e) => e.id === p.eventId);
    receitas.push({
      id: p.id, origem: 'EVENTO',
      descricao: `Evento ${evento?.nome || ''}`.trim(),
      personId: p.personId || null, valor,
      pagoEm: p.pagoEm, forma: p.formaPagamento || null,
    });
  }
  for (const s of store.serviceCharges || []) {
    if (s.status !== 'PAGO' || !s.pagoEm || !dentro(s.pagoEm, de, ate)) continue;
    receitas.push({
      id: s.id, origem: 'SERVICO', descricao: s.descricao || 'Serviço',
      personId: s.personId || null, valor: Number(s.valor || 0),
      pagoEm: s.pagoEm, forma: s.forma || null,
    });
  }

  const despesas = (store.expenses || []).filter((e) => dentro(e.data, de, ate));
  const totalReceitas = receitas.reduce((s, c) => s + Number(c.valor || 0), 0);
  const totalDespesas = despesas.reduce((s, e) => s + Number(e.valor || 0), 0);

  const porCategoria = new Map();
  for (const e of despesas) {
    const k = e.categoria || 'Outros';
    const row = porCategoria.get(k) || { categoria: k, total: 0, quantidade: 0 };
    row.total += Number(e.valor || 0);
    row.quantidade += 1;
    porCategoria.set(k, row);
  }
  const porOrigem = new Map();
  for (const r of receitas) {
    const k = r.origem;
    const row = porOrigem.get(k) || { origem: k, total: 0, quantidade: 0 };
    row.total += Number(r.valor || 0);
    row.quantidade += 1;
    porOrigem.set(k, row);
  }
  const porDia = new Map();
  for (const c of receitas) {
    const k = localDayKey(new Date(c.pagoEm));
    const row = porDia.get(k) || { dia: k, receitas: 0, despesas: 0 };
    row.receitas += Number(c.valor || 0);
    porDia.set(k, row);
  }
  for (const e of despesas) {
    const k = localDayKey(new Date(`${e.data}T12:00:00`));
    const row = porDia.get(k) || { dia: k, receitas: 0, despesas: 0 };
    row.despesas += Number(e.valor || 0);
    porDia.set(k, row);
  }
  const totalPorOrigem = (origem) => (porOrigem.get(origem)?.total || 0);
  return {
    periodo: { inicio: de.toISOString(), fim: ate.toISOString() },
    totalReceitas, totalDespesas, saldo: totalReceitas - totalDespesas,
    totais: {
      mensalidades: totalPorOrigem('MENSALIDADE'),
      eventos: totalPorOrigem('EVENTO'),
      servicos: totalPorOrigem('SERVICO'),
    },
    receitas: receitas.sort((a, b) => String(b.pagoEm).localeCompare(String(a.pagoEm))),
    despesas,
    porCategoria: [...porCategoria.values()].sort((a, b) => b.total - a.total),
    porOrigem: [...porOrigem.values()].sort((a, b) => b.total - a.total),
    porDia: [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}
