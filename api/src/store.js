// Store em memória. Trocar por Prisma/MySQL na portabilidade sem mudar o contrato.
// Tipos: ALUNO (mensalidade), PERSONAL (credencial com validade, sem mensalidade),
// VISITANTE (avulso/dia, validade curta).

import { hashPassword } from './auth.js';

export const TIPOS_PESSOA = ['ALUNO', 'PERSONAL', 'VISITANTE'];

export const store = {
  persons: new Map(),
  devices: new Map(),
  users: new Map(), // operadores: { id, nome, login, senhaHash, perfil: recepcao|gerencia }
  rules: [], // { personId, deviceId, diasSemana, horaIni, horaFim }
  events: [], // { id, deviceId, personId, timestamp, direcao, metodo, score, decisao, motivo }
  syncQueue: [], // { id, personId, deviceId, operacao, status, tentativas }
  notifications: [], // { id, key, tipo, titulo, detalhe, createdAt, resolvida, resolvidaPor, resolvidaEm }
  meta: { lastBackupAt: null, nextEnrollid: 1001 },
};

let seq = 1;
export function nextId(prefix) {
  return `${prefix}_${Date.now()}_${seq++}`;
}

export function seed() {
  if (store.devices.size > 0) return;
  const d1 = { id: 'dev_fit4_01', nome: 'Catraca Fit 4 - Entrada', fabricante: 'Topdata', modelo: 'Fit 4', driver: 'topdata_easyinner', ip: '192.168.0.100', porta: 3570, endpoint: null, tipo: 'FIT4', online: false, lastSeen: null };
  store.devices.set(d1.id, d1);
  const p1 = { id: 'per_demo_01', nome: 'Visitante Demo', matricula: 'V001', tipo: 'VISITANTE', treinutrix: null, enrollid: 1001, ativo: true, validadeIni: null, validadeFim: null, foto: null, senhaHash: hashPassword('V001') };
  store.persons.set(p1.id, p1);
  store.rules.push({ personId: p1.id, deviceId: d1.id, diasSemana: 62, horaIni: '06:00', horaFim: '23:00' });
  const pt = { id: 'per_personal_01', nome: 'Personal Demo', matricula: 'P001', tipo: 'PERSONAL', treinutrix: null, enrollid: 1002, ativo: true, validadeIni: null, validadeFim: null, foto: null, senhaHash: hashPassword('P001') };
  store.persons.set(pt.id, pt);
  store.rules.push({ personId: pt.id, deviceId: d1.id, diasSemana: 127, horaIni: '05:00', horaFim: '23:59' });
  store.meta.nextEnrollid = Math.max(store.meta.nextEnrollid || 1001, 1003);
  if (store.users.size > 0) return;
  store.users.set('usr_admin', {
    id: 'usr_admin', nome: 'Administrador', login: process.env.SEED_ADMIN_LOGIN || 'admin',
    senhaHash: hashPassword(process.env.SEED_ADMIN_PASSWORD || 'admin123'), perfil: 'gerencia',
  });
}
