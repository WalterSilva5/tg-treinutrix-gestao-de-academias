// Motor de decisão puro. Sem I/O, sem hardware. Mesma lógica vai para o NestJS.
// diasSemana: bitmask dom=1 seg=2 ter=4 qua=8 qui=16 sex=32 sab=64 (ex: seg-sex = 62)

export function weekdayBit(date) {
  const jsDay = date.getDay(); // 0 dom .. 6 sab
  return 1 << jsDay;
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// person: { id, ativo, validadeIni?, validadeFim? }
// rules: [{ deviceId, diasSemana, horaIni, horaFim }]
// input: { person, rules, deviceId, at: Date, score?, minScore? }
export function decideAccess({ person, rules, deviceId, at, score = 1, minScore = 0.7 }) {
  if (!person) return deny('PESSOA_NAO_ENCONTRADA', 'Acesso negado.');
  if (person.ativo === false) return deny('PESSOA_INATIVA', 'Cadastro inativo.');
  if (person.validadeIni && at < new Date(person.validadeIni)) return deny('FORA_VALIDADE', 'Fora da validade.');
  if (person.validadeFim && at > new Date(person.validadeFim)) return deny('FORA_VALIDADE', 'Cadastro vencido.');
  if (score < minScore) return deny('SCORE_BAIXO', 'Rosto não confirmado.');

  const rule = (rules || []).find((r) => r.deviceId === deviceId);
  if (!rule) return deny('SEM_REGRA', 'Sem permissão neste equipamento.');

  const bit = weekdayBit(at);
  if ((rule.diasSemana & bit) === 0) return deny('DIA_NAO_PERMITIDO', 'Fora do dia permitido.');

  const nowMin = at.getHours() * 60 + at.getMinutes();
  if (nowMin < toMinutes(rule.horaIni) || nowMin > toMinutes(rule.horaFim)) {
    return deny('HORA_NAO_PERMITIDA', 'Fora do horário permitido.');
  }

  return { allow: true, motivo: 'OK', display_msg: 'Acesso liberado.' };
}

function deny(motivo, display_msg) {
  return { allow: false, motivo, display_msg };
}
