// Planos, assinaturas e mensalidades. Regra central: o plano limita dias
// distintos por semana, nunca a quantidade de entradas no mesmo dia.
import { nextId } from './store.js';
import {
  parseDate, endOfDay, localDayKey, startOfWeek, addMonths, endOfMonth,
} from './time.js';

export const CATEGORIAS_PLANO = ['PRINCIPAL', 'COMPLEMENTAR'];

function inteiro(valor, min, max, padrao) {
  if (valor === undefined || valor === null || valor === '') return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`valor deve ser inteiro entre ${min} e ${max}`);
  return n;
}

export function normalizarPlano(b, base = {}) {
  const nome = String(b.nome ?? base.nome ?? '').trim();
  if (!nome) throw new Error('nome do plano é obrigatório');
  const categoria = String(b.categoria ?? base.categoria ?? 'PRINCIPAL').toUpperCase();
  if (!CATEGORIAS_PLANO.includes(categoria)) throw new Error('categoria inválida');
  const valor = b.valor !== undefined ? Number(b.valor) : Number(base.valor || 0);
  if (!Number.isFinite(valor) || valor < 0) throw new Error('valor inválido');
  return {
    nome,
    descricao: String(b.descricao ?? base.descricao ?? '').trim().slice(0, 300),
    categoria,
    valor: Math.round(valor * 100) / 100,
    diasSemana: inteiro(b.diasSemana, 0, 127, base.diasSemana ?? 127),
    diasPorSemana: inteiro(b.diasPorSemana, 0, 7, base.diasPorSemana ?? 0), // 0 = livre
    duracaoMeses: inteiro(b.duracaoMeses, 1, 24, base.duracaoMeses ?? 1),
    diaVencimento: inteiro(b.diaVencimento, 1, 28, base.diaVencimento ?? 10),
    ativo: b.ativo !== undefined ? b.ativo !== false : (base.ativo !== false),
  };
}

export function novoPlano(b) {
  return { id: nextId('pln'), ...normalizarPlano(b), criadoEm: new Date().toISOString() };
}

export function planosAtivos(store, personId, at = new Date()) {
  const assinaturas = (store.subscriptions || []).filter((s) => {
    if (s.personId !== personId || s.status !== 'ATIVA') return false;
    const ini = parseDate(s.inicio);
    const fim = parseDate(s.fim, { endOfDay: true });
    return (!ini || ini <= at) && (!fim || fim >= at);
  });
  const planos = [];
  for (const s of assinaturas) {
    const plano = (store.plans || []).find((p) => p.id === s.planId);
    if (plano && plano.ativo !== false) planos.push({ ...plano, assinaturaId: s.id, valorContratado: s.valor });
  }
  return planos;
}

// 0 = ilimitado; principal + complementares somam dias extras.
export function limiteSemanal(planos) {
  if (!planos || planos.length === 0) return 0;
  if (planos.some((p) => Number(p.diasPorSemana) === 0)) return 0;
  return Math.min(7, planos.reduce((s, p) => s + (Number(p.diasPorSemana) || 0), 0));
}

export function mascaraSemanal(planos) {
  if (!planos || planos.length === 0) return 127;
  return planos.reduce((mask, p) => mask | (Number(p.diasSemana) || 0), 0) || 127;
}

export function usoDaSemana(store, personId, at = new Date()) {
  const inicio = startOfWeek(at);
  const dias = new Set();
  for (const e of store.events || []) {
    if (e.personId !== personId || e.decisao !== 'ALLOW') continue;
    const d = new Date(e.timestamp);
    if (Number.isNaN(d.getTime()) || d < inicio || d > at) continue;
    dias.add(localDayKey(d));
  }
  const hoje = localDayKey(at);
  return { diasUsadosSemana: dias.size, hojeJaUsado: dias.has(hoje), dias: [...dias] };
}

function competenciaDe(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function criarCobranca(store, { personId, subscriptionId, plano, competencia, inicioMes, inicio, agora }) {
  let venc = new Date(inicioMes.getFullYear(), inicioMes.getMonth(), plano.diaVencimento || 10);
  if (inicio && venc < new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate())) {
    venc = addMonths(venc, 1);
  }
  const vencimento = `${venc.getFullYear()}-${String(venc.getMonth() + 1).padStart(2, '0')}-${String(venc.getDate()).padStart(2, '0')}`;
  const status = endOfDay(venc) < agora ? 'ATRASADO' : 'PENDENTE';
  const charge = {
    id: nextId('cob'), personId, subscriptionId, planId: plano.id,
    competencia, valor: plano.valor, vencimento, status,
    pagoEm: null, pagoPor: null, forma: null, observacao: null,
    criadoEm: agora.toISOString(),
  };
  store.charges.push(charge);
  return charge;
}

export function criarAssinatura(store, personId, plano, {
  inicio, meses, agora = new Date(), por = 'operador',
} = {}) {
  const pessoa = store.persons.get(personId);
  if (!pessoa) throw new Error('pessoa não encontrada');
  if (!plano || plano.ativo === false) throw new Error('plano inválido');
  const ini = inicio ? parseDate(inicio) : new Date(agora);
  if (!ini) throw new Error('início inválido');
  const duracao = Math.max(1, Math.min(24, Number(meses) || plano.duracaoMeses || 1));
  const fim = new Date(addMonths(ini, duracao).getTime() - 1);

  if (plano.categoria === 'PRINCIPAL') {
    for (const s of store.subscriptions) {
      if (s.personId === personId && s.status === 'ATIVA' && s.tipo === 'PRINCIPAL') {
        s.status = 'SUBSTITUIDA';
        s.atualizadoEm = agora.toISOString();
      }
    }
  }
  const assinatura = {
    id: nextId('sub'), personId, planId: plano.id, planoNome: plano.nome,
    tipo: plano.categoria, valor: plano.valor,
    inicio: ini.toISOString(), fim: fim.toISOString(),
    status: 'ATIVA', criadoEm: agora.toISOString(), criadoPor: por,
  };
  store.subscriptions.push(assinatura);

  // Uma cobrança por mês de vigência.
  for (let n = 0; n < duracao; n += 1) {
    const mes = addMonths(new Date(ini.getFullYear(), ini.getMonth(), 1), n);
    criarCobranca(store, {
      personId, subscriptionId: assinatura.id, plano,
      competencia: competenciaDe(mes), inicioMes: mes, inicio: ini, agora,
    });
  }

  recalcularValidade(store, pessoa, agora);
  return assinatura;
}

export function recalcularValidade(store, pessoa, agora = new Date()) {
  const ativas = (store.subscriptions || []).filter((s) => {
    if (s.personId !== pessoa.id || s.status !== 'ATIVA') return false;
    const fim = parseDate(s.fim, { endOfDay: true });
    return !fim || fim >= agora;
  });
  if (ativas.length === 0) {
    if ((store.subscriptions || []).some((s) => s.personId === pessoa.id)) pessoa.validadeFim = null;
    return;
  }
  const maior = ativas
    .map((s) => parseDate(s.fim, { endOfDay: true }))
    .filter(Boolean)
    .sort((a, b) => b - a)[0];
  if (maior) pessoa.validadeFim = maior.toISOString();
}

export function cancelarAssinatura(store, assinatura, { motivo = '', agora = new Date() } = {}) {
  if (!assinatura || assinatura.status !== 'ATIVA') return null;
  assinatura.status = 'CANCELADA';
  assinatura.canceladoEm = agora.toISOString();
  assinatura.motivoCancelamento = String(motivo || '').slice(0, 200);
  const pessoa = store.persons.get(assinatura.personId);
  if (pessoa) recalcularValidade(store, pessoa, agora);
  return assinatura;
}

// Trancamento: pausa o acesso e estende o fim da assinatura pelos dias parados.
export function trancarAssinatura(store, assinatura, { dias = 30, motivo = '', agora = new Date() } = {}) {
  if (!assinatura || assinatura.status !== 'ATIVA') return null;
  const total = Math.max(1, Math.min(365, Number(dias) || 30));
  assinatura.status = 'TRANCADA';
  assinatura.trancadoEm = agora.toISOString();
  assinatura.trancadoAte = new Date(agora.getTime() + total * 24 * 3600 * 1000).toISOString();
  assinatura.diasTrancados = total;
  assinatura.motivoTrancamento = String(motivo || '').slice(0, 200);
  const pessoa = store.persons.get(assinatura.personId);
  if (pessoa) recalcularValidade(store, pessoa, agora);
  return assinatura;
}

export function retomarAssinatura(store, assinatura, { agora = new Date() } = {}) {
  if (!assinatura || assinatura.status !== 'TRANCADA') return null;
  const dias = Math.max(0, Number(assinatura.diasTrancados) || 0);
  assinatura.fim = new Date(new Date(assinatura.fim).getTime() + dias * 24 * 3600 * 1000).toISOString();
  assinatura.status = 'ATIVA';
  assinatura.retomadoEm = agora.toISOString();
  const pessoa = store.persons.get(assinatura.personId);
  if (pessoa) recalcularValidade(store, pessoa, agora);
  return assinatura;
}

export function gerarCobrancasMes(store, competencia, { agora = new Date() } = {}) {
  const alvo = String(competencia || competenciaDe(agora));
  const [ano, mes] = alvo.split('-').map(Number);
  if (!ano || !mes || mes < 1 || mes > 12) throw new Error('competência inválida (AAAA-MM)');
  const criadas = [];
  for (const s of store.subscriptions || []) {
    if (s.status !== 'ATIVA') continue;
    const ini = parseDate(s.inicio);
    const fim = parseDate(s.fim, { endOfDay: true });
    const mesIni = new Date(ano, mes - 1, 1);
    const mesFim = endOfMonth(mesIni);
    if ((ini && ini > mesFim) || (fim && fim < mesIni)) continue;
    const plano = (store.plans || []).find((p) => p.id === s.planId);
    if (!plano) continue;
    const existe = store.charges.some((c) => c.subscriptionId === s.id && c.competencia === alvo);
    if (existe) continue;
    criadas.push(criarCobranca(store, {
      personId: s.personId, subscriptionId: s.id, plano,
      competencia: alvo, inicioMes: mesIni, agora,
    }));
  }
  return criadas;
}
