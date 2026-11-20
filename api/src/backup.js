// Backup em snapshot JSON do store (equivalente local do scripts/backup.sh
// do wsi-invest-ai, adaptado: lá é SQLite .backup, aqui o store em memória).
// Retenção configurável; restore com validação do nome do arquivo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKUP_DIR = process.env.BACKUP_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backups');
export const BACKUP_KEEP = Number(process.env.BACKUP_KEEP || 7);

function snapshot(store) {
  return {
    v: 1,
    at: new Date().toISOString(),
    persons: [...store.persons.values()],
    devices: [...store.devices.values()],
    users: [...store.users.values()],
    rules: store.rules,
    events: store.events,
    syncQueue: store.syncQueue,
    notifications: store.notifications,
    meta: store.meta,
  };
}

export function doBackup(store) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `painel_${stamp}.json`;
  const data = snapshot(store);
  fs.writeFileSync(path.join(BACKUP_DIR, file), JSON.stringify(data));
  store.meta.lastBackupAt = data.at;
  // Retenção: mantém os N mais recentes
  const all = listBackups().map((b) => b.file).sort();
  for (const old of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
  }
  return { file, at: data.at };
}

export function listBackups() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('painel_') && f.endsWith('.json'))
    .map((f) => ({ file: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size }))
    .sort((a, b) => (a.file < b.file ? 1 : -1));
}

export function doRestore(store, file) {
  if (!/^painel_[\w\-:.]+\.json$/.test(file)) throw new Error('arquivo inválido');
  const full = path.join(BACKUP_DIR, path.basename(file));
  const data = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (data.v !== 1 || !Array.isArray(data.persons)) throw new Error('backup incompatível');
  store.persons = new Map(data.persons.map((p) => [p.id, p]));
  store.devices = new Map(data.devices.map((d) => [d.id, d]));
  store.users = new Map((data.users || []).map((u) => [u.id, u]));
  store.rules = data.rules || [];
  store.events = data.events || [];
  store.syncQueue = data.syncQueue || [];
  store.notifications = data.notifications || [];
  store.meta = data.meta || { lastBackupAt: null };
  return { file, at: data.at };
}
