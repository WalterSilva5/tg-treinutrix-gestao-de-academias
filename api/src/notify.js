// Notificações operacionais com confirmação manual.
// Inspirado no módulo alerts do wsi-invest-ai: regras avaliadas
// periodicamente, janela de dedup (não duplica pendente com mesma chave),
// baixa manual obrigatória (ack com responsável).
import { nextId } from './store.js';

export const BACKUP_INTERVAL_MS = 24 * 3600 * 1000;
export const DEVICE_STALE_MS = 10 * 60 * 1000;
// 3 meses de plano vencido => inativação automática (90 dias).
export const AUTO_INACTIVE_MS = 90 * 24 * 3600 * 1000;

function pendente(store, key) {
  return store.notifications.find((n) => n.key === key && !n.resolvida);
}

function criar(store, { key, tipo, titulo, detalhe, now }) {
  if (pendente(store, key)) return null; // dedup
  const n = {
    id: nextId('ntf'), key, tipo, titulo, detalhe,
    createdAt: now.toISOString(), resolvida: false,
    resolvidaPor: null, resolvidaEm: null,
  };
  store.notifications.push(n);
  return n;
}

// Avalia regras e cria notificações. Retorna as criadas.
export function evaluateNotifications(store, now = new Date()) {
  const criadas = [];

  // 1. Lembrete de backup (base: scripts/backup.sh + alerts/evaluate do wsi-invest-ai)
  const last = store.meta.lastBackupAt ? new Date(store.meta.lastBackupAt) : null;
  if (!last || now - last > BACKUP_INTERVAL_MS) {
    const n = criar(store, {
      key: 'backup-reminder', tipo: 'BACKUP',
      titulo: 'Fazer backup dos dados',
      detalhe: last ? `Último backup há mais de 24h (${last.toISOString()}).` : 'Nenhum backup realizado ainda.',
      now,
    });
    if (n) criadas.push(n);
  }

  // 2. Dispositivo sem contato
  for (const d of store.devices.values()) {
    const seen = d.lastSeen ? new Date(d.lastSeen) : null;
    if (!seen || now - seen > DEVICE_STALE_MS) {
      const n = criar(store, {
        key: `device-offline:${d.id}`, tipo: 'DISPOSITIVO',
        titulo: `Sem contato: ${d.nome}`,
        detalhe: seen ? `Último contato ${seen.toISOString()}.` : 'Nunca enviou heartbeat.',
        now,
      });
      if (n) criadas.push(n);
    }
  }

  // 3. Fila de sincronização encalhada
  const pend = store.syncQueue.filter((s) => s.status === 'PENDING');
  if (pend.length > 0) {
    const n = criar(store, {
      key: 'sync-pending', tipo: 'SINCRONISMO',
      titulo: `${pend.length} item(ns) na fila de sincronização`,
      detalhe: 'Cadastros ainda não confirmados no leitor. Verifique a aba Operação.',
      now,
    });
    if (n) criadas.push(n);
  }

  // 4. Inativação automática: 3 meses de plano vencido (ativo=false + sync).
  for (const p of store.persons.values()) {
    if (p.ativo !== false && p.validadeFim && now - new Date(p.validadeFim) > AUTO_INACTIVE_MS) {
      p.ativo = false;
      for (const d of store.devices.values()) {
        store.syncQueue.push({ id: nextId('sync'), personId: p.id, deviceId: d.id, operacao: 'UPSERT', status: 'PENDING', tentativas: 0 });
      }
      const n = criar(store, {
        key: `auto-inactive:${p.id}`, tipo: 'INATIVACAO',
        titulo: `Inativado automaticamente: ${p.nome}`,
        detalhe: `Plano vencido há mais de 3 meses (até ${p.validadeFim}). Reative manualmente se voltar.`,
        now,
      });
      if (n) criadas.push(n);
    }
  }

  // 5. Resumo diário de métricas (overview estilo admin/overview do wsi-invest-ai)
  const dia = now.toISOString().slice(0, 10);
  const evs = store.events.filter((e) => e.timestamp.slice(0, 10) === dia);
  const ok = evs.filter((e) => e.decisao === 'ALLOW').length;
  const neg = evs.filter((e) => e.decisao === 'DENY').length;
  const inad = listInadimplentes(store, now);
  const n = criar(store, {
    key: `digest:${dia}`, tipo: 'METRICAS',
    titulo: `Resumo do dia ${dia}`,
    detalhe: `${evs.length} eventos (${ok} liberados, ${neg} negados). ${store.persons.size} pessoas, ${inad.length} inadimplente(s) — inativos excluídos.`,
    now,
  });
  if (n) criadas.push(n);

  return criadas;
}

// Baixa manual: exige responsável. Retorna null se já resolvida/inexistente.
export function ackNotification(store, id, por) {
  const n = store.notifications.find((x) => x.id === id);
  if (!n || n.resolvida) return null;
  n.resolvida = true;
  n.resolvidaPor = por || 'operador';
  n.resolvidaEm = new Date().toISOString();
  return n;
}

// Inadimplência = plano vencido (validadeFim passada). Inativo não conta:
// aluno pausado/transferido some das métricas de atraso sem ser deletado.
export function listInadimplentes(store, now = new Date()) {
  return [...store.persons.values()].filter(
    (p) => p.ativo !== false && p.validadeFim && new Date(p.validadeFim) < now
  );
}
