// Datas e horários no fuso local do servidor.
// Regra: dados do painel usam o relógio do PC da academia (defina o TZ do SO
// na instalação). Datas "AAAA-MM-DD" (sem hora) valem o dia inteiro local:
// início = 00:00:00.000 e fim = 23:59:59.999.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDateOnly(value) {
  return DATE_ONLY.test(String(value ?? '').trim());
}

// Devolve Date ou null (valor inválido). endOfDay só afeta "AAAA-MM-DD".
export function parseDate(value, { endOfDay = false } = {}) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value);
  const s = String(value).trim();
  const m = DATE_ONLY.exec(s);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    return endOfDay
      ? new Date(year, month - 1, day, 23, 59, 59, 999)
      : new Date(year, month - 1, day, 0, 0, 0, 0);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDay(date = new Date()) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function endOfDay(date = new Date()) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}
