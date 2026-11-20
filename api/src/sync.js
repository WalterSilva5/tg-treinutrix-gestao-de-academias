// Fila de sincronização de cadastros com o leitor facial.
// O payload é leve: o edge baixa a foto pela API e monta o `record` base64
// (backupnum 50) antes de enviar o setuserinfo. `enable:false` inativa o
// usuário no leitor (não apaga o rosto).
import { nextId } from './store.js';

export function syncPayload(person) {
  return {
    cmd: 'setuserinfo',
    enrollid: person.enrollid,
    name: person.nome,
    enable: person.ativo !== false,
    backupnum: person.foto ? 50 : 0,
    foto: person.foto ? `/api/persons/${encodeURIComponent(person.id)}/photo` : null,
  };
}

function upsertPending(store, personId, deviceId, operacao, payload) {
  const now = new Date().toISOString();
  const existing = store.syncQueue.find(
    (s) => s.personId === personId && s.deviceId === deviceId && s.status === 'PENDING'
  );
  if (existing) {
    existing.operacao = operacao;
    existing.payload = payload;
    existing.atualizadoEm = now;
    return existing;
  }
  const item = {
    id: nextId('sync'), personId, deviceId, operacao, status: 'PENDING', tentativas: 0,
    payload, createdAt: now, atualizadoEm: now,
  };
  store.syncQueue.push(item);
  return item;
}

// Enfileira o cadastro para todos os dispositivos. Chamadas repetidas para a
// mesma pessoa+dispositivo reaproveitam o item pendente (sem spam na fila).
export function enqueueSync(store, person) {
  for (const d of store.devices.values()) {
    upsertPending(store, person.id, d.id, 'UPSERT', syncPayload(person));
  }
}

// Remoção no leitor (LGPD / cadastro excluído).
export function enqueueDelete(store, personId, enrollid) {
  for (const d of store.devices.values()) {
    upsertPending(store, personId, d.id, 'DELETE', { cmd: 'deleteuser', enrollid });
  }
}

// Baixa do edge: marca SENT/ERROR e conta a tentativa.
export function ackSync(store, id, status = 'SENT', erro = null) {
  const item = store.syncQueue.find((s) => s.id === id);
  if (!item) return null;
  if (status !== 'SENT' && status !== 'ERROR') return null;
  item.status = status;
  item.tentativas += 1;
  item.atualizadoEm = new Date().toISOString();
  item.erro = status === 'ERROR' ? String(erro || 'erro no leitor') : null;
  return item;
}
