// Backup em snapshot JSON do store (equivalente local do scripts/backup.sh
// do wsi-invest-ai, adaptado: lá é SQLite .backup, aqui o store em memória).
// Retenção configurável; restore com validação do nome do arquivo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHOTO_DIR } from './photos.js';

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
  // Fotos ficam em pasta própria ao lado do JSON do mesmo snapshot.
  const photoDest = path.join(BACKUP_DIR, `photos-${stamp}`);
  if (fs.existsSync(PHOTO_DIR)) fs.cpSync(PHOTO_DIR, photoDest, { recursive: true });
  // Retenção: mantém os N snapshots mais recentes (JSON + fotos).
  const all = listBackups().map((b) => b.file).sort();
  for (const old of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) {
    fs.rmSync(path.join(BACKUP_DIR, old), { force: true });
    const oldStamp = old.replace(/^painel_/, '').replace(/\.json$/, '');
    fs.rmSync(path.join(BACKUP_DIR, `photos-${oldStamp}`), { recursive: true, force: true });
  }
  return { file, at: data.at, photos: fs.existsSync(photoDest) };
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
  if (!store.meta.nextEnrollid) {
    const maxEnroll = Math.max(1000, ...[...store.persons.values()].map((p) => Number(p.enrollid) || 0));
    store.meta.nextEnrollid = maxEnroll + 1;
  }
  // Devolve as fotos do snapshot, quando existirem.
  const stamp = path.basename(file).replace(/^painel_/, '').replace(/\.json$/, '');
  const photoSrc = path.join(BACKUP_DIR, `photos-${stamp}`);
  if (fs.existsSync(photoSrc)) {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    fs.cpSync(photoSrc, PHOTO_DIR, { recursive: true });
  }
  return { file, at: data.at };
}
