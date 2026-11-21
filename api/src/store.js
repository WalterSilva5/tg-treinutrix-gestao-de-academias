// Store em memória + persistência SQLite (api/src/persist.js).
// Tipos: ALUNO (mensalidade), PERSONAL (credencial com validade, sem mensalidade),
// VISITANTE (avulso/dia, validade curta).

import { hashPassword } from './auth.js';

export const TIPOS_PESSOA = ['ALUNO', 'PERSONAL', 'VISITANTE'];
export const METODOS = ['FACIAL', 'CARTAO', 'SENHA', 'MANUAL'];

// Regra padrão criada junto com o cadastro: libera todos os dias, o dia inteiro.
// A validade do plano/ativo e o horário por equipamento continuam valendo.
export const DEFAULT_RULE = { diasSemana: 127, horaIni: '00:00', horaFim: '23:59' };

export const store = {
  persons: new Map(),
  devices: new Map(),
  users: new Map(), // operadores: { id, nome, login, senhaHash, perfil: recepcao|gerencia }
  rules: [], // { personId, deviceId, diasSemana, horaIni, horaFim }
  events: [], // eventos de ACESSO da catraca
  socialEvents: [], // eventos/agenda (participantes podem ser visitantes)
  eventParticipants: [], // { id, eventId, personId|null, nome, tipo, documento, contato, status, checkinAt }
  raffles: [], // sorteios/premiações programáveis
  raffleDraws: [], // histórico/auditoria de cada sorteio realizado
  imports: [], // histórico de importações de cadastros
  audit: [], // trilha de auditoria de ações administrativas
  unknownFaces: [], // rostos não reconhecidos capturados pelo leitor
  syncQueue: [], // { id, personId, deviceId, operacao, status, tentativas, payload }
  notifications: [], // { id, key, tipo, titulo, detalhe, createdAt, resolvida, resolvidaPor, resolvidaEm }
  meta: { lastBackupAt: null, nextEnrollid: 1001, dedup: {} },
};

let seq = 1;
export function nextId(prefix) {
  return `${prefix}_${Date.now()}_${seq++}`;
}

// Garante uma regra por dispositivo para a pessoa (idempotente).
export function ensureRules(store, personId, devices = [...store.devices.values()]) {
  let created = 0;
  for (const d of devices) {
    const exists = store.rules.some((r) => r.personId === personId && r.deviceId === d.id);
    if (exists) continue;
    store.rules.push({ personId, deviceId: d.id, ...DEFAULT_RULE });
    created += 1;
  }
  return created;
}

export function seed() {
  if (store.devices.size > 0) return;
  const d1 = { id: 'dev_fit4_01', nome: 'Catraca Fit 4 - Entrada', fabricante: 'Topdata', modelo: 'Fit 4', driver: 'topdata_easyinner', ip: '192.168.0.100', porta: 3570, endpoint: null, tipo: 'FIT4', online: false, lastSeen: null };
  store.devices.set(d1.id, d1);

  // SEED_DEMO=0 instala sem alunos de demonstração (produção).
  if (process.env.SEED_DEMO !== '0') {
    const p1 = { id: 'per_demo_01', nome: 'Visitante Demo', matricula: 'V001', tipo: 'VISITANTE', treinutrix: null, enrollid: 1001, ativo: true, validadeIni: null, validadeFim: null, foto: null, senhaHash: hashPassword('V001') };
    store.persons.set(p1.id, p1);
    store.rules.push({ personId: p1.id, deviceId: d1.id, diasSemana: 62, horaIni: '06:00', horaFim: '23:00' });
    const pt = { id: 'per_personal_01', nome: 'Personal Demo', matricula: 'P001', tipo: 'PERSONAL', treinutrix: null, enrollid: 1002, ativo: true, validadeIni: null, validadeFim: null, foto: null, senhaHash: hashPassword('P001') };
    store.persons.set(pt.id, pt);
    store.rules.push({ personId: pt.id, deviceId: d1.id, diasSemana: 127, horaIni: '05:00', horaFim: '23:59' });
    store.meta.nextEnrollid = Math.max(store.meta.nextEnrollid || 1001, 1003);
  }
  if (store.users.size > 0) return;
  const senha = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log('[seed] SEED_ADMIN_PASSWORD não definido — usando admin/admin123 (troque na instalação).');
  }
  store.users.set('usr_admin', {
    id: 'usr_admin', nome: 'Administrador', login: process.env.SEED_ADMIN_LOGIN || 'admin',
    senhaHash: hashPassword(senha), perfil: 'gerencia', tokenVersion: 0,
    mustChangePassword: process.env.SEED_ADMIN_MUST_CHANGE === '1',
  });
}
