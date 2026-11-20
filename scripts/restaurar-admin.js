#!/usr/bin/env node
// Restaura o usuário administrador padrão.
// - Com a API rodando: usa a rota local /api/auth/recover-admin (loopback),
//   atualizando memória e SQLite na hora.
// - Com a API parada: abre o SQLite, reescreve o admin e encerra.
//
// Uso:
//   node scripts/restaurar-admin.js
//   node scripts/restaurar-admin.js --login admin --senha admin123
//   node scripts/restaurar-admin.js --offline
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function opcao(nome, padrao) {
  const i = args.indexOf(nome);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : padrao;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Restaura o administrador padrão.

  --login <login>   login do admin (padrão: ${process.env.SEED_ADMIN_LOGIN || 'admin'})
  --senha <senha>   nova senha (padrão: ${process.env.SEED_ADMIN_PASSWORD || 'admin123'})
  --url <url>       API local (padrão: http://127.0.0.1:${process.env.API_PORT || 3001})
  --offline         não tenta a API; grava direto no SQLite (API deve estar parada)
`);
  process.exit(0);
}

const login = String(opcao('--login', process.env.SEED_ADMIN_LOGIN || 'admin')).trim() || 'admin';
const senha = String(opcao('--senha', process.env.SEED_ADMIN_PASSWORD || 'admin123'));
const url = String(opcao('--url', `http://127.0.0.1:${process.env.API_PORT || 3001}`)).replace(/\/$/, '');
const offline = args.includes('--offline');

if (senha.length < 4) {
  console.error('Senha curta: use ao menos 4 caracteres.');
  process.exit(1);
}

async function pelaApi() {
  const res = await fetch(`${url}/api/auth/recover-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, senha }),
    signal: AbortSignal.timeout(4000),
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* não-JSON */ }
  if (!res.ok) throw new Error((json && json.error) || `API ${res.status}: ${texto.slice(0, 120)}`);
  return json;
}

async function peloBanco() {
  const { store, seed } = await import('../api/src/store.js');
  const { hashPassword } = await import('../api/src/auth.js');
  const { loadState, saveNow, closeDb, DB_FILE } = await import('../api/src/persist.js');
  loadState(store);
  seed();
  let admin = [...store.users.values()].find((u) => u.login === login)
    || store.users.get('usr_admin')
    || [...store.users.values()].find((u) => u.perfil === 'gerencia');
  if (!admin) {
    admin = { id: 'usr_admin', nome: 'Administrador', login };
    store.users.set(admin.id, admin);
  }
  admin.login = login;
  admin.nome = admin.nome || 'Administrador';
  admin.perfil = 'gerencia';
  admin.senhaHash = hashPassword(senha);
  saveNow(store);
  closeDb();
  return { ok: true, login, banco: DB_FILE };
}

try {
  if (!offline) {
    try {
      const r = await pelaApi();
      console.log(`OK: administrador restaurado pela API. Login: ${r.login}`);
      console.log('Entre no painel com a nova senha.');
      process.exit(0);
    } catch (e) {
      console.log(`API local indisponível (${e.message}). Tentando direto no banco…`);
    }
  }
  const r = await peloBanco();
  console.log(`OK: administrador restaurado no banco (${r.banco}).`);
  console.log(`Login: ${r.login}`);
  console.log('Se a API estiver rodando, reinicie-a para carregar a alteração.');
} catch (e) {
  console.error('Falha ao restaurar o administrador:', e.message);
  process.exit(1);
}
