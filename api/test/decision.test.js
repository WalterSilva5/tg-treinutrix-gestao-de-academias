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

test('janela que atravessa a meia-noite', () => {
  const rule = { deviceId: 'd1', diasSemana: 127, horaIni: '22:00', horaFim: '02:00' };
  const dentro = decideAccess({ person: personOk, rules: [rule], deviceId: 'd1', at: new Date('2026-11-18T23:30:00'), score: 0.9 });
  assert.equal(dentro.allow, true);
  const madrugada = decideAccess({ person: personOk, rules: [rule], deviceId: 'd1', at: new Date('2026-11-18T01:30:00'), score: 0.9 });
  assert.equal(madrugada.allow, true);
  const fora = decideAccess({ person: personOk, rules: [rule], deviceId: 'd1', at: new Date('2026-11-18T12:00:00'), score: 0.9 });
  assert.equal(fora.motivo, 'HORA_NAO_PERMITIDA');
});

test('validade em data pura vale até o fim do dia local', () => {
  const p = { ...personOk, validadeFim: '2026-11-20' };
  const ultimoDia = decideAccess({ person: p, rules: [SEG_SEX_6_23], deviceId: 'dev_fit4_01', at: new Date(2026, 10, 20, 22, 0, 0), score: 0.9 });
  assert.equal(ultimoDia.allow, true);
  const depois = decideAccess({ person: p, rules: [SEG_SEX_6_23], deviceId: 'dev_fit4_01', at: new Date(2026, 10, 21, 0, 1, 0), score: 0.9 });
  assert.equal(depois.motivo, 'FORA_VALIDADE');
});

test('cartão/senha não dependem de score facial', () => {
  const at = new Date('2026-11-18T10:00:00');
  const r = decideAccess({ person: personOk, rules: [SEG_SEX_6_23], deviceId: 'dev_fit4_01', at, metodo: 'CARTAO' });
  assert.equal(r.allow, true);
});

test('facial sem score falha fechado', () => {
  const at = new Date('2026-11-18T10:00:00');
  const r = decideAccess({ person: personOk, rules: [SEG_SEX_6_23], deviceId: 'dev_fit4_01', at, metodo: 'FACIAL' });
  assert.equal(r.motivo, 'SCORE_BAIXO');
});

test('regra mal configurada nega com motivo próprio', () => {
  const at = new Date('2026-11-18T10:00:00');
  const r = decideAccess({
    person: personOk, deviceId: 'dev_fit4_01', at, score: 0.9,
    rules: [{ deviceId: 'dev_fit4_01', diasSemana: 999, horaIni: 'x', horaFim: 'y' }],
  });
  assert.equal(r.motivo, 'REGRA_INVALIDA');
});

test('duas janelas no mesmo dia: qualquer uma libera', () => {
  const at = new Date('2026-11-18T14:00:00');
  const r = decideAccess({
    person: personOk, deviceId: 'd1', at, score: 0.9,
    rules: [
      { deviceId: 'd1', diasSemana: 62, horaIni: '06:00', horaFim: '10:00' },
      { deviceId: 'd1', diasSemana: 62, horaIni: '13:00', horaFim: '22:00' },
    ],
  });
  assert.equal(r.allow, true);
});
