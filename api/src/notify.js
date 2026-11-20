// Notificações operacionais com confirmação manual.
// Inspirado no módulo alerts do wsi-invest-ai: regras avaliadas
// periodicamente, janela de dedup (não duplica pendente com mesma chave),
// baixa manual obrigatória (ack com responsável) e cooldown por chave para
// não recriar a mesma notificação a cada ciclo depois da baixa.
import { nextId, TIPOS_PESSOA } from './store.js';
import { enqueueSync } from './sync.js';
import { localDayKey, parseDate } from './time.js';

export const BACKUP_INTERVAL_MS = 24 * 3600 * 1000;
export const DEVICE_STALE_MS = 10 * 60 * 1000;
// 3 meses de plano vencido => inativação automática (90 dias).
export const AUTO_INACTIVE_MS = 90 * 24 * 3600 * 1000;

// Cooldown por tipo: depois da baixa, a mesma condição só volta a avisar
// depois desse tempo (evita fadiga de notificação com scheduler de 5 min).
const COOLDOWN_MS = {
  BACKUP: BACKUP_INTERVAL_MS,
  DISPOSITIVO: 30 * 60 * 1000,
  SINCRONISMO: 6 * 3600 * 1000,
  INATIVACAO: 30 * 24 * 3600 * 1000,
  METRICAS: BACKUP_INTERVAL_MS,
};

function criar(store, { key, tipo, titulo, detalhe, now }) {
  const recent = store.notifications.find((n) => {
    if (n.key !== key) return false;
    if (!n.resolvida) return true; // pendente: dedup
    const when = n.resolvidaEm || n.createdAt;
    const cooldown = COOLDOWN_MS[tipo] ?? BACKUP_INTERVAL_MS;
    return now - new Date(when) < cooldown;
  });
  if (recent) return null;
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
  store.notifications = store.notifications || [];
  store.syncQueue = store.syncQueue || [];

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

  // 4. Inativação automática: 3 meses de plano/credencial vencida (ativo=false + sync).
  // Vale para ALUNO e PERSONAL; VISITANTE é avulso descartável e não gera aviso.
  for (const p of store.persons.values()) {
    const tipo = p.tipo || 'ALUNO';
    if (tipo !== 'ALUNO' && tipo !== 'PERSONAL') continue;
    const fim = parseDate(p.validadeFim, { endOfDay: true });
    if (p.ativo !== false && fim && now - fim > AUTO_INACTIVE_MS) {
      p.ativo = false;
      enqueueSync(store, p);
      const n = criar(store, {
        key: `auto-inactive:${p.id}`, tipo: 'INATIVACAO',
        titulo: `Inativado automaticamente: ${p.nome}`,
        detalhe: `Plano vencido há mais de 3 meses (até ${localDayKey(fim)}). Reative manualmente se voltar.`,
        now,
      });
      if (n) criadas.push(n);
    }
  }

  // 5. Resumo diário de métricas (overview estilo admin/overview do wsi-invest-ai)
  const dia = localDayKey(now);
  const evs = store.events.filter((e) => localDayKey(new Date(e.timestamp)) === dia);
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

// Inadimplência = ALUNO com plano vencido. PERSONAL tem credencial com validade
// própria (sem mensalidade) e VISITANTE é avulso: nenhum dos dois entra no atraso.
export function listInadimplentes(store, now = new Date()) {
  return [...store.persons.values()].filter((p) => {
    if ((p.tipo || 'ALUNO') !== 'ALUNO' || p.ativo === false) return false;
    const fim = parseDate(p.validadeFim, { endOfDay: true });
    return Boolean(fim) && fim < now;
  });
}
