// Motor de decisão puro. Sem I/O, sem hardware. Mesma lógica vai para o NestJS.
// diasSemana: bitmask dom=1 seg=2 ter=4 qua=8 qui=16 sex=32 sab=64 (ex: seg-sex = 62)
// Regra de falha: na dúvida, nega (fail-closed).
import { parseDate, minutesOfDay } from './time.js';

export function weekdayBit(date) {
  const jsDay = date.getDay(); // 0 dom .. 6 sab
  return 1 << jsDay;
}

// "HH:MM" -> minutos. NaN quando o formato é inválido (regra inválida = ignorada).
export function toMinutes(hhmm) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? '').trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function ruleIsValid(rule) {
  return Boolean(rule)
    && Number.isInteger(rule.diasSemana) && rule.diasSemana >= 0 && rule.diasSemana <= 127
    && !Number.isNaN(toMinutes(rule.horaIni)) && !Number.isNaN(toMinutes(rule.horaFim));
}

export function ruleMatches(rule, at) {
  if (!ruleIsValid(rule)) return false;
  if ((rule.diasSemana & weekdayBit(at)) === 0) return false;
  const now = minutesOfDay(at);
  const ini = toMinutes(rule.horaIni);
  const fim = toMinutes(rule.horaFim);
  // Janela que atravessa a meia-noite (ex.: 22:00 às 02:00).
  if (fim < ini) return now >= ini || now <= fim;
  return now >= ini && now <= fim;
}

// person: { id, ativo, validadeIni?, validadeFim? }
// rules: [{ deviceId, diasSemana, horaIni, horaFim }]
// input: { person, rules, deviceId, at, score?, minScore?, metodo? }
// metodo: FACIAL (exige score) | CARTAO | SENHA | MANUAL (não avaliam score)
export function decideAccess({
  person, rules, deviceId, at = new Date(), score,
  minScore = Number(process.env.MIN_SCORE || 0.7), metodo = 'FACIAL',
  planos = [], diasUsadosSemana = 0, hojeJaUsado = false,
}) {
  if (!person) return deny('PESSOA_NAO_ENCONTRADA', 'Acesso negado.');

  const when = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date();

  if (person.ativo === false) return deny('PESSOA_INATIVA', 'Cadastro inativo.');

  if (person.validadeIni) {
    const ini = parseDate(person.validadeIni);
    if (!ini) return deny('FORA_VALIDADE', 'Validade inválida.');
    if (when < ini) return deny('FORA_VALIDADE', 'Fora da validade.');
  }
  if (person.validadeFim) {
    // Data sem hora vale até o fim do dia local (evita bloquear 1 dia antes).
    const fim = parseDate(person.validadeFim, { endOfDay: true });
    if (!fim) return deny('FORA_VALIDADE', 'Validade inválida.');
    if (when > fim) return deny('FORA_VALIDADE', 'Cadastro vencido.');
  }

  if (String(metodo).toUpperCase() === 'FACIAL' && !(Number(score) >= minScore)) {
    return deny('SCORE_BAIXO', 'Rosto não confirmado.');
  }

  // Plano: limita dias distintos na semana, nunca entradas no mesmo dia.
  if (Array.isArray(planos) && planos.length > 0) {
    const mascara = planos.reduce((m, p) => m | (Number(p.diasSemana) || 0), 0) || 127;
    if ((mascara & weekdayBit(when)) === 0) return deny('DIA_NAO_PERMITIDO', 'Fora dos dias do plano.');
    const ilimitado = planos.some((p) => Number(p.diasPorSemana) === 0);
    const limite = ilimitado ? 0 : Math.min(7, planos.reduce((s, p) => s + (Number(p.diasPorSemana) || 0), 0));
    if (limite > 0 && !hojeJaUsado && Number(diasUsadosSemana) >= limite) {
      return deny('LIMITE_DIAS_SEMANA', `Seu plano permite ${limite} dia(s) por semana.`);
    }
  }

  const doDevice = (rules || []).filter((r) => r.deviceId === deviceId);
  if (doDevice.length === 0) return deny('SEM_REGRA', 'Sem permissão neste equipamento.');
  if (!doDevice.some(ruleIsValid)) return deny('REGRA_INVALIDA', 'Horário mal configurado.');
  if (doDevice.some((r) => ruleMatches(r, when))) return { allow: true, motivo: 'OK', display_msg: 'Acesso liberado.' };

  // Diferencia dia x horário para o painel/operador entender a negativa.
  const today = doDevice.filter((r) => ruleIsValid(r) && (r.diasSemana & weekdayBit(when)) !== 0);
  if (today.length === 0) return deny('DIA_NAO_PERMITIDO', 'Fora do dia permitido.');
  return deny('HORA_NAO_PERMITIDA', 'Fora do horário permitido.');
}

function deny(motivo, display_msg) {
  return { allow: false, motivo, display_msg };
}
