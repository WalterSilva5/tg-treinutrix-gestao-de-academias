// PolÃ­tica de retenÃ§Ã£o (LGPD): funÃ§Ã£o pura, sem I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarRetencao } from '../src/retention.js';

const agora = new Date('2026-11-20T12:00:00Z');
const antigo = '2024-01-01T10:00:00.000Z';
const recente = '2026-11-01T10:00:00.000Z';

function loja() {
  return {
    events: [
      { id: 'e_old', timestamp: antigo },
      { id: 'e_new', timestamp: recente },
    ],
    eventParticipants: [
      { id: 'p_old', eventId: 'ev_old', personId: null, nome: 'Externo Antigo', contato: '11 9', documento: '123', criadoEm: antigo },
      { id: 'p_new', eventId: 'ev_old', personId: null, nome: 'Externo Novo', contato: '11 8', criadoEm: recente },
      { id: 'p_aluno', eventId: 'ev_old', personId: 'a1', nome: 'Aluno', criadoEm: antigo },
    ],
    socialEvents: [
      { id: 'ev_old', nome: 'Antigo', inicio: antigo, fim: antigo },
      { id: 'ev_new', nome: 'Novo', inicio: recente, fim: null },
    ],
    persons: new Map([
      ['a1', { id: 'a1', ativo: true, foto: { updatedAt: antigo } }],
      ['a2', { id: 'a2', ativo: false, foto: { updatedAt: antigo } }],
      ['a3', { id: 'a3', ativo: false, foto: { updatedAt: recente } }],
    ]),
  };
}

test('remove eventos antigos, anonimiza externos e lista fotos antigas de inativos', () => {
  const store = loja();
  const r = aplicarRetencao(store, { agora, eventosDias: 365, externosDias: 365, socialDias: 0, fotosDias: 365 });
  assert.equal(r.eventosRemovidos, 1);
  assert.deepEqual(store.events.map((e) => e.id), ['e_new']);
  assert.equal(r.externosAnonimizados, 1);
  const antigoP = store.eventParticipants.find((p) => p.id === 'p_old');
  assert.equal(antigoP.nome, 'Participante removido');
  assert.equal(antigoP.contato, '');
  assert.equal(antigoP.documento, '');
  assert.equal(store.eventParticipants.find((p) => p.id === 'p_new').nome, 'Externo Novo');
  assert.equal(store.eventParticipants.find((p) => p.id === 'p_aluno').nome, 'Aluno');
  assert.deepEqual(r.fotosParaRemover, ['a2']);
});

test('eventos sociais antigos sÃ£o removidos com participantes', () => {
  const store = loja();
  const r = aplicarRetencao(store, { agora, eventosDias: 0, externosDias: 0, socialDias: 365, fotosDias: 0 });
  assert.equal(r.eventosSociaisRemovidos, 1);
  assert.equal(r.participantesRemovidos, 3);
  assert.deepEqual(store.socialEvents.map((e) => e.id), ['ev_new']);
});

test('zero desliga a retenÃ§Ã£o e nÃ£o altera nada', () => {
  const store = loja();
  const r = aplicarRetencao(store, { agora, eventosDias: 0, externosDias: 0, socialDias: 0, fotosDias: 0 });
  assert.equal(r.eventosRemovidos, 0);
  assert.equal(r.externosAnonimizados, 0);
  assert.equal(r.fotosParaRemover.length, 0);
  assert.equal(store.events.length, 2);
  assert.equal(store.eventParticipants[0].nome, 'Externo Antigo');
});

