// Auth local zero-dep: scrypt para senhas, HMAC-SHA256 para tokens.
// Equivale ao auth JWT do treina.ai-api; na portabilidade trocar por Passport/JWT.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Segredo fixo: usa AUTH_SECRET ou cria data/auth.secret (fora do git) para que
// os tokens sobrevivam ao reinício sem exigir variável de ambiente.
function carregarSegredo() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dir = process.env.DATA_DIR || path.join(raiz, 'data');
  const arquivo = process.env.AUTH_SECRET_FILE || path.join(dir, 'auth.secret');
  try {
    const salvo = fs.readFileSync(arquivo, 'utf8').trim();
    if (salvo.length >= 32) return salvo;
  } catch { /* ainda não existe */ }
  const novo = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, novo, { mode: 0o600 });
    console.log('[auth] segredo criado em', arquivo);
  } catch (e) {
    console.log('[auth] não foi possível gravar o segredo:', e.message);
  }
  return novo;
}

const SECRET = carregarSegredo();

export const TOKEN_TTL_MS = 12 * 3600 * 1000;

export function hashPassword(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(senha, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || !/^[0-9a-f]{32}$/.test(parts[1]) || !/^[0-9a-f]{128}$/.test(parts[2])) return false;
  const [, salt, hash] = parts;
  const calc = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(hash, 'hex'));
}

function b64url(o) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

export function issueToken({ sub, perfil, nome }, ttlMs = TOKEN_TTL_MS) {
  const body = b64url({ sub, perfil, nome, exp: Date.now() + ttlMs });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

// Login em dois diretórios: operadores (store.users, por login) e pessoas
// (store.persons, aluno entra com matrícula + senha; inicial = matrícula).
export function authenticate(store, login, senha) {
  const l = String(login || '').trim();
  for (const u of store.users.values()) {
    if (u.login === l && verifyPassword(senha, u.senhaHash)) {
      return { sub: u.id, perfil: u.perfil, nome: u.nome };
    }
  }
  for (const p of store.persons.values()) {
    if ((p.matricula === l || p.id === l) && verifyPassword(senha, p.senhaHash || '')) {
      return { sub: p.id, perfil: 'aluno', nome: p.nome };
    }
  }
  return null;
}
