// Aulas/agenda e reservas com lista de espera.
import crypto from 'node:crypto';
import { nextId } from './store.js';
import { parseDate, endOfDay } from './time.js';

function inteiro(v, min, max, padrao) {
  if (v === undefined || v === null || v === '') return padrao;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`valor entre ${min} e ${max}`);
  return n;
}

export function normalizarAula(b, base = {}) {
  const nome = String(b.nome ?? base.nome ?? '').trim();
  if (!nome) throw new Error('nome da aula é obrigatório');
  const inicio = b.inicio !== undefined ? parseDate(b.inicio) : (base.inicio ? new Date(base.inicio) : null);
  if (!inicio) throw new Error('início é obrigatório');
  const fim = b.fim !== undefined ? parseDate(b.fim, { endOfDay: true }) : (base.fim ? new Date(base.fim) : null);
  if (fim && fim < inicio) throw new Error('fim antes do início');
  return {
    nome,
    professor: String(b.professor ?? base.professor ?? '').trim().slice(0, 120),
    sala: String(b.sala ?? base.sala ?? '').trim().slice(0, 120),
    inicio: inicio.toISOString(),
    fim: fim ? fim.toISOString() : null,
    capacidade: inteiro(b.capacidade, 0, 1000, base.capacidade ?? 0) || null,
    ativo: b.ativo !== undefined ? b.ativo !== false : (base.ativo !== false),
    observacoes: String(b.observacoes ?? base.observacoes ?? '').trim().slice(0, 500),
  };
}

export function novaAula(b) {
  return { id: nextId('aula'), ...normalizarAula(b), criadoEm: new Date().toISOString() };
}

function code() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function ativos(store, sessionId) {
  return (store.classBookings || []).filter(
    (b) => b.sessionId === sessionId && (b.status === 'RESERVADO' || b.status === 'PRESENTE'),
  ).length;
}

export function reservarAula(store, sessionId, personId) {
  const aula = (store.classSessions || []).find((a) => a.id === sessionId);
  if (!aula || aula.ativo === false) throw new Error('aula não encontrada ou inativa');
  if (!store.persons.get(personId)) throw new Error('pessoa não encontrada');
  if (new Date(aula.fim || aula.inicio) < new Date()) throw new Error('aula já encerrada');
  const existente = store.classBookings.find(
    (b) => b.sessionId === sessionId && b.personId === personId && b.status !== 'CANCELADO',
  );
  if (existente) throw new Error('já reservado nesta aula');
  const lotada = aula.capacidade && ativos(store, sessionId) >= aula.capacidade;
  const reserva = {
    id: nextId('res'), sessionId, personId,
    status: lotada ? 'ESPERA' : 'RESERVADO',
    codigo: code(), criadoEm: new Date().toISOString(), checkinAt: null,
  };
  store.classBookings.push(reserva);
  return reserva;
}

export function cancelarReserva(store, reserva) {
  if (!reserva || reserva.status === 'CANCELADO') return null;
  reserva.status = 'CANCELADO';
  reserva.canceladoEm = new Date().toISOString();
  const proximo = (store.classBookings || []).find((b) => b.sessionId === reserva.sessionId && b.status === 'ESPERA');
  if (proximo) { proximo.status = 'RESERVADO'; proximo.promovidoEm = new Date().toISOString(); }
  return reserva;
}

export function checkinAula(store, sessionId, codigo) {
  const c = String(codigo || '').trim().toUpperCase();
  const reserva = store.classBookings.find(
    (b) => b.sessionId === sessionId && String(b.codigo).toUpperCase() === c && b.status !== 'CANCELADO',
  );
  if (!reserva) throw new Error('código não encontrado');
  reserva.status = 'PRESENTE';
  reserva.checkinAt = new Date().toISOString();
  return reserva;
}
