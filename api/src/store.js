// Store em memória. Trocar por Prisma/MySQL na portabilidade sem mudar o contrato.
// Tipos: ALUNO (mensalidade), PERSONAL (credencial com validade, sem mensalidade),
// VISITANTE (avulso/dia, validade curta).

export const TIPOS_PESSOA = ['ALUNO', 'PERSONAL', 'VISITANTE'];

export const store = {
  persons: new Map(),
  devices: new Map(),
  rules: [], // { personId, deviceId, diasSemana, horaIni, horaFim }
  events: [], // { id, deviceId, personId, timestamp, direcao, metodo, score, decisao, motivo }
  syncQueue: [], // { id, personId, deviceId, operacao, status, tentativas }
  notifications: [], // { id, key, tipo, titulo, detalhe, createdAt, resolvida, resolvidaPor, resolvidaEm }
  meta: { lastBackupAt: null },
};

let seq = 1;
export function nextId(prefix) {
  return `${prefix}_${Date.now()}_${seq++}`;
}

export function seed() {
  if (store.devices.size > 0) return;
  const d1 = { id: 'dev_fit4_01', nome: 'Catraca Fit 4 - Entrada', ip: '192.168.0.100', porta: 3570, tipo: 'FIT4', online: false, lastSeen: null };
  store.devices.set(d1.id, d1);
  const p1 = { id: 'per_demo_01', nome: 'Visitante Demo', matricula: 'V001', tipo: 'VISITANTE', ativo: true, validadeIni: null, validadeFim: null };
  store.persons.set(p1.id, p1);
  store.rules.push({ personId: p1.id, deviceId: d1.id, diasSemana: 62, horaIni: '06:00', horaFim: '23:00' });
  const pt = { id: 'per_personal_01', nome: 'Personal Demo', matricula: 'P001', tipo: 'PERSONAL', ativo: true, validadeIni: null, validadeFim: null };
  store.persons.set(pt.id, pt);
  store.rules.push({ personId: pt.id, deviceId: d1.id, diasSemana: 127, horaIni: '05:00', horaFim: '23:59' });
}
