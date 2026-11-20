import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, issueToken, verifyToken, authenticate } from '../src/auth.js';

test('hash e verificação de senha', () => {
  const h = hashPassword('segredo123');
  assert.ok(verifyPassword('segredo123', h));
  assert.equal(verifyPassword('errada', h), false);
  assert.equal(verifyPassword('x', null), false);
});

test('token válido, adulterado e expirado', () => {
  const t = issueToken({ sub: 'u1', perfil: 'gerencia', nome: 'A' });
  const p = verifyToken(t);
  assert.equal(p.sub, 'u1');
  assert.equal(p.perfil, 'gerencia');
  assert.equal(verifyToken(t.slice(0, -2) + 'xx'), null);
  const exp = issueToken({ sub: 'u1', perfil: 'gerencia', nome: 'A' }, -1000);
  assert.equal(verifyToken(exp), null);
  assert.equal(verifyToken('lixo'), null);
});

function fakeStore() {
  return {
    users: new Map([['u1', { id: 'u1', nome: 'Ger', login: 'ger', senhaHash: hashPassword('g123'), perfil: 'gerencia' }]]),
    persons: new Map([['p1', { id: 'p1', nome: 'Aluno', matricula: 'A1', senhaHash: hashPassword('A1') }]]),
  };
}

test('login operador, aluno e falhas', () => {
  const s = fakeStore();
  assert.deepEqual(authenticate(s, 'ger', 'g123'), { sub: 'u1', perfil: 'gerencia', nome: 'Ger' });
  assert.deepEqual(authenticate(s, 'A1', 'A1'), { sub: 'p1', perfil: 'aluno', nome: 'Aluno' });
  assert.equal(authenticate(s, 'ger', 'errada'), null);
  assert.equal(authenticate(s, 'ninguem', 'x'), null);
});
