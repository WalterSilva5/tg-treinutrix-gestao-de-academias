// Regras de eventos/sorteios e exportação CSV/PDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  elegiveis, sortear, normalizarEvento, normalizarSorteio, novaInscricao, pessoaEmDia,
  promoverEspera, gerarRecorrencias, eventoPorToken, novoEvento, sortearVarios,
} from '../src/social.js';
import { eventoParaCsv, eventoParaPdf, eventosParaCsv, eventosParaPdf } from '../src/report.js';

const agora = new Date('2026-11-20T12:00:00-03:00');
const futuro = '2027-12-31';
const passado = '2026-01-31';

function pessoa(id, nome, tipo, extra = {}) {
  return { id, nome, matricula: `M-${id}`, tipo, ativo: true, validadeFim: futuro, criadoEm: '2026-11-01T10:00:00-03:00', ...extra };
}

function lojaBase() {
  const persons = new Map();
  persons.set('a1', pessoa('a1', 'Ana em dia', 'ALUNO'));
  persons.set('a2', pessoa('a2', 'Beto vencido', 'ALUNO', { validadeFim: passado }));
  persons.set('a3', pessoa('a3', 'Caio inativo', 'ALUNO', { ativo: false }));
  persons.set('v1', pessoa('v1', 'Visitante', 'VISITANTE', { validadeFim: null }));
  persons.set('old', pessoa('old', 'Aluno antigo', 'ALUNO', { criadoEm: '2025-01-10T10:00:00-03:00' }));
  return {
    persons,
    eventParticipants: [
      { id: 'p1', eventId: 'ev1', personId: 'a1', nome: 'Ana em dia', tipo: 'ALUNO', status: 'PRESENTE' },
      { id: 'p2', eventId: 'ev1', personId: null, nome: 'Externo', tipo: 'EXTERNO', status: 'INSCRITO' },
      { id: 'p3', eventId: 'ev1', personId: 'a2', nome: 'Beto vencido', tipo: 'ALUNO', status: 'CANCELADO' },
    ],
    socialEvents: [],
    devices: new Map(),
    rules: [],
    syncQueue: [],
    notifications: [],
    meta: {},
  };
}

function sorteio(extra = {}) {
  return {
    id: 's1', nome: 'Teste', premio: 'Prêmio', publico: 'ALUNOS_EM_DIA',
    eventId: null, inicio: null, fim: null, sorteioEm: null, ativo: true, status: 'ATIVA',
    entradasBase: 1, bonusEmDia: 0, bonusEvento: 0, exigirEmDia: false, ...extra,
  };
}

test('pessoa em dia considera ativo e validade', () => {
  assert.equal(pessoaEmDia(pessoa('x', 'X', 'ALUNO'), agora), true);
  assert.equal(pessoaEmDia(pessoa('x', 'X', 'ALUNO', { validadeFim: passado }), agora), false);
  assert.equal(pessoaEmDia(pessoa('x', 'X', 'ALUNO', { ativo: false }), agora), false);
  assert.equal(pessoaEmDia(pessoa('x', 'X', 'VISITANTE', { validadeFim: passado }), agora), true);
});

test('elegíveis por público e bônus de mensalidade em dia', () => {
  const store = lojaBase();
  const emDia = elegiveis(store, sorteio(), agora);
  assert.deepEqual(emDia.participantes.map((p) => p.nome), ['Ana em dia', 'Aluno antigo']);

  const todos = elegiveis(store, sorteio({ publico: 'ALUNOS', exigirEmDia: true }), agora);
  assert.deepEqual(todos.participantes.map((p) => p.nome), ['Ana em dia', 'Aluno antigo']);

  const comBonus = elegiveis(store, sorteio({ publico: 'ALUNOS', bonusEmDia: 2 }), agora);
  assert.equal(comBonus.participantes.find((p) => p.nome === 'Ana em dia').entradas, 3);
  assert.equal(comBonus.participantes.find((p) => p.nome === 'Beto vencido').entradas, 1);

  const visitantes = elegiveis(store, sorteio({ publico: 'VISITANTES' }), agora);
  assert.deepEqual(visitantes.participantes.map((p) => p.nome), ['Visitante']);
});

test('matrícula da sorte filtra pela data de cadastro', () => {
  const store = lojaBase();
  const r = elegiveis(store, sorteio({
    publico: 'MATRICULAS', inicio: '2026-11-01', fim: '2026-11-30',
  }), agora);
  assert.deepEqual(r.participantes.map((p) => p.nome), ['Ana em dia', 'Beto vencido']);
  assert.equal(r.participantes.some((p) => p.nome === 'Aluno antigo'), false);
});

test('sorteio de evento inclui externo e ignora cancelado', () => {
  const store = lojaBase();
  const r = elegiveis(store, sorteio({ publico: 'EVENTO', eventId: 'ev1', bonusEmDia: 1 }), agora);
  assert.deepEqual(r.participantes.map((p) => p.nome), ['Ana em dia', 'Externo']);
  assert.equal(r.participantes[0].entradas, 2); // base 1 + em dia 1
  assert.equal(r.participantes[1].entradas, 1);
});

test('sorteio ponderado respeita entradas e é determinístico com randomInt', () => {
  const store = lojaBase();
  const s = sorteio({ publico: 'ALUNOS', entradasBase: 1, bonusEmDia: 3 });
  // Ana=4 entradas, Beto=1, antigo=1 (Caio inativo não entra) => total 6
  assert.equal(elegiveis(store, s, agora).totalEntradas, 9);
  assert.equal(sortear(store, s, { agora, randomInt: () => 0 }).vencedor.nome, 'Ana em dia');
  assert.equal(sortear(store, s, { agora, randomInt: () => 3 }).vencedor.nome, 'Ana em dia');
  assert.equal(sortear(store, s, { agora, randomInt: () => 4 }).vencedor.nome, 'Beto vencido');
  assert.equal(sortear(store, s, { agora, randomInt: () => 5 }).vencedor.nome, 'Aluno antigo');
  assert.equal(sortear(store, s, { agora, randomInt: () => 8 }).vencedor.nome, 'Aluno antigo');
});

test('sem elegíveis o sorteio falha', () => {
  const store = lojaBase();
  const s = sorteio({ publico: 'ALUNOS_EM_DIA', inicio: '2030-01-01', fim: '2030-01-02', publico: 'MATRICULAS' });
  assert.throws(() => sortear(store, s, { agora, randomInt: () => 0 }), /sem participantes/);
});

test('validação de evento e inscrição', () => {
  assert.throws(() => normalizarEvento({ inicio: '2026-12-01' }), /nome/);
  assert.throws(() => normalizarEvento({ nome: 'X' }), /início/);
  const ev = normalizarEvento({ nome: 'Aula', inicio: '2026-12-01T19:00', fim: '2026-12-01T21:00' });
  assert.equal(ev.nome, 'Aula');
  assert.equal(new Date(ev.inicio).getHours(), 19);

  const store = lojaBase();
  store.socialEvents.push({ id: 'ev1', nome: 'Aula', ativo: true, inscricoesAbertas: true, permiteVisitantes: true, capacidade: 2, inicio: '2026-12-01T19:00:00.000Z' });
  assert.throws(() => novaInscricao(store, 'ev1', { nome: 'Externo' }), /já inscrito/);
  assert.throws(() => novaInscricao(store, 'ev1', { personId: 'a1' }), /já inscrito/);

  store.eventParticipants = [];
  assert.throws(() => novaInscricao(store, 'ev1', { personId: 'naoexiste' }), /não encontrada/);
  const p = novaInscricao(store, 'ev1', { nome: 'Novo externo', contato: '11 9999' });
  assert.equal(p.tipo, 'EXTERNO');
  assert.equal(p.status, 'INSCRITO');
});

test('validação de sorteio', () => {
  assert.throws(() => normalizarSorteio({}), /nome/);
  assert.throws(() => normalizarSorteio({ nome: 'X', publico: 'EVENTO' }), /evento/);
  assert.throws(() => normalizarSorteio({ nome: 'X', publico: 'FOO' }), /público/);
  const s = normalizarSorteio({ nome: 'X', publico: 'ALUNOS', entradasBase: 2, bonusEmDia: 1 });
  assert.equal(s.status, 'ATIVA');
  assert.equal(s.entradasBase, 2);
});

const evento = {
  nome: 'Aulão de verão', inicio: '2026-12-01T19:00:00.000Z', local: 'Sala 1',
  capacidade: 50, descricao: 'Evento com acentuação: ação, coração & cia.',
};
const participantes = [
  { nome: 'Ana Silva', tipo: 'ALUNO', matricula: 'M1', status: 'PRESENTE', checkinAt: '2026-12-01T19:10:00.000Z', criadoEm: '2026-11-20T10:00:00.000Z' },
  { nome: 'João "Jota" Externo', tipo: 'EXTERNO', contato: '(11) 9999', status: 'INSCRITO', criadoEm: '2026-11-21T10:00:00.000Z' },
];

test('CSV tem cabeçalho, BOM e escapa aspas', () => {
  const csv = eventoParaCsv(evento, participantes);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /Nome;Tipo;Matrícula;Documento;Contato;Status/);
  assert.match(csv, /Ana Silva;ALUNO;M1/);
  assert.match(csv, /"João ""Jota"" Externo"/);
  assert.ok(csv.endsWith('\r\n'));
});

test('PDF é válido, pagina e contém o evento', () => {
  const pdf = eventoParaPdf(evento, participantes, { geradoEm: new Date('2026-11-20T12:00:00Z') });
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
  assert.match(pdf.subarray(-20).toString('latin1'), /%%EOF/);
  const texto = pdf.toString('latin1');
  assert.match(texto, /Aulão de verão/);
  assert.match(texto, /Lista de participantes/);
  assert.match(texto, /João "Jota" Externo/);
  assert.match(texto, /Pagina 1 de 1/);
});

test('PDF pagina listas grandes', () => {
  const muitos = Array.from({ length: 120 }, (_, i) => ({
    nome: `Participante ${i + 1}`, tipo: i % 2 ? 'ALUNO' : 'EXTERNO', status: 'INSCRITO',
  }));
  const pdf = eventoParaPdf(evento, muitos);
  const texto = pdf.toString('latin1');
  const paginas = Number((/\/Count (\d+)/.exec(texto) || [])[1]);
  assert.ok(paginas >= 2);
  assert.match(texto, /Pagina 1 de [2-9]/);
});


test('lista de espera promove o pr?ximo quando abre vaga', () => {
  const store = lojaBase();
  store.socialEvents.push({ id: 'ev1', nome: 'Aula', ativo: true, inscricoesAbertas: true, permiteVisitantes: true, listaEspera: true, capacidade: 1, inicio: '2026-12-01T19:00:00.000Z' });
  store.eventParticipants = [];
  const a = novaInscricao(store, 'ev1', { nome: 'Primeiro' });
  store.eventParticipants.push(a);
  const b = novaInscricao(store, 'ev1', { nome: 'Segundo' });
  store.eventParticipants.push(b);
  assert.equal(a.status, 'INSCRITO');
  assert.equal(b.status, 'ESPERA');
  a.status = 'CANCELADO';
  const promovido = promoverEspera(store, 'ev1');
  assert.equal(promovido.nome, 'Segundo');
  assert.equal(promovido.status, 'INSCRITO');
});

test('recorr?ncia semanal e mensal gera datas e tokens novos', () => {
  const base = {
    id: 'evo1', nome: 'Aula', inicio: '2026-11-02T19:00:00.000Z', fim: '2026-11-02T20:00:00.000Z',
    local: 'Sala', capacidade: 10, permiteVisitantes: true, listaEspera: true,
    inscricoesAbertas: true, ativo: true, publicToken: 'abc',
  };
  const semanal = gerarRecorrencias(base, { tipo: 'SEMANAL', vezes: 2 });
  assert.equal(semanal.length, 2);
  assert.equal(semanal[0].inicio, '2026-11-09T19:00:00.000Z');
  assert.equal(semanal[1].inicio, '2026-11-16T19:00:00.000Z');
  assert.notEqual(semanal[0].publicToken, base.publicToken);
  assert.equal(semanal[0].serieId, 'evo1');

  const mensal = gerarRecorrencias(base, { tipo: 'MENSAL', vezes: 1 });
  assert.equal(mensal[0].inicio.slice(0, 7), '2026-12');
  assert.throws(() => gerarRecorrencias(base, { tipo: 'DIARIA', vezes: 1 }), /SEMANAL/);
});

test('novo evento cria token p?blico e c?digo de inscri??o ?nico', () => {
  const ev = novoEvento({ nome: 'Teste', inicio: '2026-12-01T19:00' });
  assert.match(ev.publicToken, /^[0-9a-f]{16}$/);
  const store = lojaBase();
  store.socialEvents.push({ ...ev, capacidade: 10, permiteVisitantes: true, listaEspera: true, inscricoesAbertas: true, ativo: true });
  const a = novaInscricao(store, ev.id, { nome: 'A' });
  const b = novaInscricao(store, ev.id, { nome: 'B' });
  assert.match(a.codigo, /^[0-9A-F]{6}$/);
  assert.notEqual(a.codigo, b.codigo);
  assert.equal(eventoPorToken(store, ev.publicToken).id, ev.id);
  assert.equal(eventoPorToken(store, 'naoexiste'), null);
});

test('evento aceita valor e lista de espera configur?veis', () => {
  const ev = normalizarEvento({ nome: 'Pago', inicio: '2026-12-01T19:00', valor: 35.5, listaEspera: false });
  assert.equal(ev.valor, 35.5);
  assert.equal(ev.listaEspera, false);
});

test('relat?rio de eventos exporta CSV e PDF', () => {
  const eventos = [
    { nome: 'Aula A', inicio: '2026-12-01T19:00:00.000Z', local: 'Sala 1', capacidade: 10, inscritos: 8, presentes: 6, espera: 2, receita: 120, ativo: true, inscricoesAbertas: true },
    { nome: 'Aula B', inicio: '2026-12-02T19:00:00.000Z', local: 'Sala 2', capacidade: 20, inscritos: 5, presentes: 4, espera: 0, receita: 0, ativo: false },
  ];
  const csv = eventosParaCsv(eventos);
  assert.match(csv, /Evento;In.cio;Local/);
  assert.match(csv, /Aula A/);
  assert.match(csv, /120,00/);
  const pdf = eventosParaPdf(eventos, { inicio: '2026-12-01', fim: '2026-12-31' });
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
  assert.match(pdf.toString('latin1'), /Relat.rio de eventos/);
  assert.match(pdf.toString('latin1'), /Aula A/);
});


test('multiplos ganhadores sem repetir, exclusao e estoque', () => {
  const store = lojaBase();
  const s = sorteio({ publico: 'TODOS', entradasBase: 1, ganhadoresQtd: 3 });
  const out = sortearVarios(store, s, { agora, randomInt: () => 0 });
  assert.equal(out.vencedores.length, 3);
  assert.equal(new Set(out.vencedores.map((v) => v.nome)).size, 3);
  assert.equal(sortearVarios(store, { ...s, excluidos: ['a1'] }, { agora, randomInt: () => 0 })
    .vencedores.some((v) => v.personId === 'a1'), false);
  assert.equal(sortearVarios(store, { ...s, estoquePremios: 1, ganhadoresQtd: 3 }, { agora, randomInt: () => 0 })
    .vencedores.length, 1);
});
