import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAccess } from '../src/decision.js';

const SEG_SEX_6_23 = { deviceId: 'dev_fit4_01', diasSemana: 62, horaIni: '06:00', horaFim: '23:00' };
const personOk = { id: 'p1', ativo: true, validadeIni: null, validadeFim: null };

test('libera dentro do horário em dia útil', () => {
  const at = new Date('2026-11-18T10:00:00'); // quarta
  const r = decideAccess({ person: personOk, rules: [SEG_SEX_6_23], deviceId: 'dev_fit4_01', at, score: 0.95 });
  assert.equal(r.allow, true);
});

test('nega fora do horário', () => {
  const at = new Date('2026-11-18T23:30:00');
  const r = decideAccess({ person: personOk, rules: [SEG_SEX_6_23], deviceId: 'dev_fit4_01', at, score: 0.95 });
  assert.equal(r.allow, false);
  assert.equal(r.motivo, 'HORA_NAO_PERMITIDA');
});

test('nega domingo', () => {
  const at = new Date('2026-11-22T10:00:00'); // domingo
  const r = decideAccess({ person: personOk, rules: [SEG_SEX_6_23], deviceId: 'dev_fit4_01', at, score: 0.95 });
  assert.equal(r.allow, false);
  assert.equal(r.motivo, 'DIA_NAO_PERMITIDO');
});

test('nega pessoa inativa', () => {
  const at = new Date('2026-11-18T10:00:00');
  const r = decideAccess({ person: { ...personOk, ativo: false }, rules: [SEG_SEX_6_23], deviceId: 'dev_fit4_01', at, score: 0.99 });
  assert.equal(r.allow, false);
  assert.equal(r.motivo, 'PESSOA_INATIVA');
});

test('nega score baixo', () => {
  const at = new Date('2026-11-18T10:00:00');
  const r = decideAccess({ person: personOk, rules: [SEG_SEX_6_23], deviceId: 'dev_fit4_01', at, score: 0.4 });
  assert.equal(r.allow, false);
  assert.equal(r.motivo, 'SCORE_BAIXO');
});
