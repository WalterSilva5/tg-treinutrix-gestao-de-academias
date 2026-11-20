// Store em memória. Trocar por Prisma/MySQL na portabilidade sem mudar o contrato.

export const store = {
  persons: new Map(),
  devices: new Map(),
  rules: [], // { personId, deviceId, diasSemana, horaIni, horaFim }
  events: [], // { id, deviceId, personId, timestamp, direcao, metodo, score, decisao, motivo }
  syncQueue: [], // { id, personId, deviceId, operacao, status, tentativas }
};

let seq = 1;
export function nextId(prefix) {
  return `${prefix}_${Date.now()}_${seq++}`;
}

export function seed() {
  if (store.devices.size > 0) return;
  const d1 = { id: 'dev_fit4_01', nome: 'Catraca Fit 4 - Entrada', ip: '192.168.0.100', porta: 3570, tipo: 'FIT4', online: false, lastSeen: null };
  store.devices.set(d1.id, d1);
  const p1 = { id: 'per_demo_01', nome: 'Visitante Demo', matricula: 'V001', ativo: true, validadeIni: null, validadeFim: null };
  store.persons.set(p1.id, p1);
  store.rules.push({ personId: p1.id, deviceId: d1.id, diasSemana: 62, horaIni: '06:00', horaFim: '23:00' });
}
