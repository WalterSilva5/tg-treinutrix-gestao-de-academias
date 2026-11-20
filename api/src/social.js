// Domínio de eventos (agenda) e sorteios/premiações. Sem I/O: o servidor e os
// testes usam estas funções puras. Participantes de evento podem ser alunos,
// visitantes cadastrados ou pessoas externas (sem cadastro na academia).
import crypto from 'node:crypto';
import { nextId } from './store.js';
import { parseDate, startOfDay, endOfDay } from './time.js';

export const PUBLICOS = {
  MATRICULAS: 'Novas matrículas no período',
  ALUNOS: 'Todos os alunos ativos',
  ALUNOS_EM_DIA: 'Alunos ativos com mensalidade em dia',
  VISITANTES: 'Visitantes ativos',
  EVENTO: 'Participantes de um evento',
  TODOS: 'Todas as pessoas ativas',
};

export const STATUS_PARTICIPANTE = ['INSCRITO', 'PRESENTE', 'CANCELADO'];
export const STATUS_SORTEIO = ['ATIVA', 'PAUSADA', 'SORTEADA'];

function inteiro(valor, min, max, padrao) {
  if (valor === undefined || valor === null || valor === '') return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`valor deve ser inteiro entre ${min} e ${max}`);
  return n;
}

function dataOuNull(valor, fimDoDia = false) {
  if (valor === undefined || valor === null || valor === '') return null;
  const d = parseDate(valor, { endOfDay: fimDoDia });
  if (!d) throw new Error('data inválida');
  return d;
}

// Aluno em dia = ativo e sem plano vencido. Sem validade = sem vencimento.
export function pessoaEmDia(pessoa, agora = new Date()) {
  if (!pessoa || pessoa.ativo === false) return false;
  if ((pessoa.tipo || 'ALUNO') !== 'ALUNO') return true;
  if (!pessoa.validadeFim) return true;
  const fim = parseDate(pessoa.validadeFim, { endOfDay: true });
  return Boolean(fim) && fim >= agora;
}

export function normalizarEvento(b, base = {}) {
  const nome = String(b.nome ?? base.nome ?? '').trim();
  if (!nome) throw new Error('nome do evento é obrigatório');
  const inicio = b.inicio !== undefined ? dataOuNull(b.inicio) : (base.inicio ? new Date(base.inicio) : null);
  if (!inicio) throw new Error('data de início é obrigatória');
  const fim = b.fim !== undefined ? dataOuNull(b.fim, true) : (base.fim ? new Date(base.fim) : null);
  if (fim && fim < inicio) throw new Error('fim não pode ser antes do início');
  return {
    nome,
    descricao: String(b.descricao ?? base.descricao ?? '').trim().slice(0, 1000),
    local: String(b.local ?? base.local ?? '').trim().slice(0, 200),
    inicio: inicio.toISOString(),
    fim: fim ? fim.toISOString() : null,
    capacidade: b.capacidade !== undefined ? inteiro(b.capacidade, 0, 100000, 0) || null : (base.capacidade ?? null),
    permiteVisitantes: b.permiteVisitantes !== undefined ? b.permiteVisitantes !== false : (base.permiteVisitantes !== false),
    inscricoesAbertas: b.inscricoesAbertas !== undefined ? b.inscricoesAbertas !== false : (base.inscricoesAbertas !== false),
    ativo: b.ativo !== undefined ? b.ativo !== false : (base.ativo !== false),
  };
}

export function normalizarSorteio(b, base = {}) {
  const nome = String(b.nome ?? base.nome ?? '').trim();
  if (!nome) throw new Error('nome do sorteio é obrigatório');
  const publico = String(b.publico ?? base.publico ?? 'ALUNOS_EM_DIA').toUpperCase();
  if (!PUBLICOS[publico]) throw new Error('público inválido');
  const eventId = b.eventId !== undefined ? (String(b.eventId).trim() || null) : (base.eventId || null);
  if (publico === 'EVENTO' && !eventId) throw new Error('escolha o evento do sorteio');
  const inicio = b.inicio !== undefined ? dataOuNull(b.inicio) : (base.inicio ? new Date(base.inicio) : null);
  const fim = b.fim !== undefined ? dataOuNull(b.fim, true) : (base.fim ? new Date(base.fim) : null);
  if (fim && inicio && fim < inicio) throw new Error('fim não pode ser antes do início');
  const sorteioEm = b.sorteioEm !== undefined ? dataOuNull(b.sorteioEm, true) : (base.sorteioEm ? new Date(base.sorteioEm) : null);
  const status = String(b.status ?? base.status ?? 'ATIVA').toUpperCase();
  if (!STATUS_SORTEIO.includes(status)) throw new Error('status inválido');
  return {
    nome,
    premio: String(b.premio ?? base.premio ?? '').trim().slice(0, 200),
    descricao: String(b.descricao ?? base.descricao ?? '').trim().slice(0, 1000),
    publico,
    eventId,
    inicio: inicio ? inicio.toISOString() : null,
    fim: fim ? fim.toISOString() : null,
    sorteioEm: sorteioEm ? sorteioEm.toISOString() : null,
    ativo: b.ativo !== undefined ? b.ativo !== false : (base.ativo !== false),
    status,
    entradasBase: inteiro(b.entradasBase, 1, 20, base.entradasBase ?? 1),
    bonusEmDia: inteiro(b.bonusEmDia, 0, 20, base.bonusEmDia ?? 0),
    bonusEvento: inteiro(b.bonusEvento, 0, 20, base.bonusEvento ?? 0),
    exigirEmDia: b.exigirEmDia !== undefined ? b.exigirEmDia !== false : (base.exigirEmDia === true),
  };
}

// Lista elegível + peso de cada participante. Determinístico (ordem de cadastro).
export function elegiveis(store, sorteio, agora = new Date()) {
  const base = Math.max(1, Number(sorteio.entradasBase) || 1);
  const bonusEmDia = Math.max(0, Number(sorteio.bonusEmDia) || 0);
  const bonusEvento = Math.max(0, Number(sorteio.bonusEvento) || 0);
  const participantes = [];
  const vistos = new Set();

  const adicionar = ({ chave, nome, matricula, personId = null, participantId = null, origem, pessoa = null, entradas }) => {
    if (vistos.has(chave)) return;
    vistos.add(chave);
    let total = Math.max(0, Number(entradas) || 0);
    if (pessoa) {
      if (bonusEmDia > 0 && pessoaEmDia(pessoa, agora)) total += bonusEmDia;
      if (bonusEvento > 0 && sorteio.eventId) {
        const presente = store.eventParticipants.some(
          (p) => p.eventId === sorteio.eventId && p.personId === pessoa.id && p.status !== 'CANCELADO',
        );
        if (presente) total += bonusEvento;
      }
    }
    total = Math.min(100, total);
    if (total <= 0) return;
    participantes.push({ chave, nome, matricula, personId, participantId, origem, entradas: total });
  };

  if (sorteio.publico === 'EVENTO') {
    for (const p of store.eventParticipants) {
      if (p.eventId !== sorteio.eventId || p.status === 'CANCELADO') continue;
      const pessoa = p.personId ? store.persons.get(p.personId) : null;
      adicionar({
        chave: `evt:${p.id}`, nome: p.nome, matricula: pessoa ? pessoa.matricula : null,
        personId: p.personId || null, participantId: p.id, origem: p.tipo || 'EXTERNO',
        pessoa, entradas: base,
      });
    }
  } else {
    for (const p of store.persons.values()) {
      if (p.ativo === false) continue;
      const tipo = p.tipo || 'ALUNO';
      if (sorteio.publico === 'ALUNOS' || sorteio.publico === 'ALUNOS_EM_DIA' || sorteio.publico === 'MATRICULAS') {
        if (tipo !== 'ALUNO') continue;
        if (sorteio.publico === 'ALUNOS_EM_DIA' || sorteio.exigirEmDia) {
          if (!pessoaEmDia(p, agora)) continue;
        }
        if (sorteio.publico === 'MATRICULAS') {
          const criado = parseDate(p.criadoEm);
          if (!criado) continue;
          if (sorteio.inicio && criado < startOfDay(new Date(sorteio.inicio))) continue;
          if (sorteio.fim && criado > endOfDay(new Date(sorteio.fim))) continue;
        }
      } else if (sorteio.publico === 'VISITANTES') {
        if (tipo !== 'VISITANTE') continue;
      } else if (sorteio.publico === 'TODOS') {
        if (sorteio.exigirEmDia && !pessoaEmDia(p, agora)) continue;
      } else {
        continue;
      }
      adicionar({
        chave: `p:${p.id}`, nome: p.nome, matricula: p.matricula,
        personId: p.id, origem: tipo, pessoa: p, entradas: base,
      });
    }
  }

  const totalEntradas = participantes.reduce((s, p) => s + p.entradas, 0);
  return { participantes, totalEntradas };
}

// Sorteia com peso. `randomInt(max)` é injetável para testes determinísticos.
export function sortear(store, sorteio, { agora = new Date(), randomInt = crypto.randomInt } = {}) {
  const { participantes, totalEntradas } = elegiveis(store, sorteio, agora);
  if (participantes.length === 0 || totalEntradas <= 0) {
    throw new Error('sem participantes elegíveis para este sorteio');
  }
  let alvo = randomInt(totalEntradas);
  let escolhido = participantes[participantes.length - 1];
  for (const p of participantes) {
    if (alvo < p.entradas) { escolhido = p; break; }
    alvo -= p.entradas;
  }
  const vencedor = {
    nome: escolhido.nome,
    matricula: escolhido.matricula || null,
    personId: escolhido.personId,
    participantId: escolhido.participantId,
    origem: escolhido.origem,
    entradas: escolhido.entradas,
    sorteadoEm: agora.toISOString(),
  };
  return { vencedor, totalParticipantes: participantes.length, totalEntradas, participantes };
}

export function novoEvento(b) {
  return {
    id: nextId('evo'),
    ...normalizarEvento(b),
    criadoEm: new Date().toISOString(),
  };
}

export function novaInscricao(store, eventId, b) {
  const evento = store.socialEvents.find((e) => e.id === eventId);
  if (!evento) throw new Error('evento não encontrado');
  if (!evento.ativo) throw new Error('evento inativo');
  if (!evento.inscricoesAbertas) throw new Error('inscrições fechadas');

  const personId = b.personId ? String(b.personId) : null;
  const pessoa = personId ? store.persons.get(personId) : null;
  if (personId && !pessoa) throw new Error('pessoa não encontrada');
  if (!pessoa && !evento.permiteVisitantes) throw new Error('evento não aceita visitantes');
  const nome = pessoa ? pessoa.nome : String(b.nome || '').trim();
  if (!nome) throw new Error('nome do participante é obrigatório');
  const contato = String(b.contato || '').trim().slice(0, 120);
  const documento = String(b.documento || '').trim().slice(0, 60);

  const jaInscrito = store.eventParticipants.find((p) => {
    if (p.eventId !== eventId || p.status === 'CANCELADO') return false;
    if (pessoa) return p.personId === pessoa.id;
    if (documento && p.documento) return p.documento === documento;
    return p.nome.toLowerCase() === nome.toLowerCase() && String(p.contato || '') === contato;
  });
  if (jaInscrito) throw new Error('participante já inscrito neste evento');

  const ativos = store.eventParticipants.filter((p) => p.eventId === eventId && p.status !== 'CANCELADO').length;
  if (evento.capacidade && ativos >= evento.capacidade) throw new Error('capacidade do evento esgotada');

  return {
    id: nextId('par'),
    eventId,
    personId: pessoa ? pessoa.id : null,
    nome,
    tipo: pessoa ? (pessoa.tipo || 'ALUNO') : 'EXTERNO',
    matricula: pessoa ? pessoa.matricula : null,
    documento,
    contato,
    status: b.status && STATUS_PARTICIPANTE.includes(String(b.status).toUpperCase())
      ? String(b.status).toUpperCase() : 'INSCRITO',
    checkinAt: null,
    criadoEm: new Date().toISOString(),
  };
}
