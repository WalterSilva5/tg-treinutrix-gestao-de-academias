// Valida o gerador de QR do front (front/qr.js) sem navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'front', 'qr.js');
const sandbox = { self: {}, TextEncoder };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
const QR = sandbox.self.QR;

// Formato conhecido: nível M, máscara 0..7 (ISO/IEC 18004)
const FORMATO_M = [
  '101010000010010', '101000100100101', '101111001111100', '101101101001011',
  '100010111111001', '100000011001110', '100111110010111', '100101010100000',
];

test('escolhe versão mínima e tamanho correto', () => {
  const qr = QR.qrMatrix('http://192.168.1.7:3001');
  assert.equal(qr.version, 2);
  assert.equal(qr.size, 25);
  assert.equal(qr.modules.length, 25);
});

test('padrões de localização nos três cantos', () => {
  const { modules: m, size } = QR.qrMatrix('http://192.168.1.7:3001');
  const cantos = [[0, 0], [0, size - 7], [size - 7, 0]];
  for (const [r, c] of cantos) {
    assert.equal(m[r][c], 1, 'borda externa');
    assert.equal(m[r + 1][c + 1], 0, 'anel interno claro');
    assert.equal(m[r + 3][c + 3], 1, 'centro escuro');
  }
});

test('timing pattern alterna na linha e coluna 6', () => {
  const { modules: m, size } = QR.qrMatrix('http://192.168.1.7:3001');
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0 ? 1 : 0);
    assert.equal(m[i][6], i % 2 === 0 ? 1 : 0);
  }
});

test('bits de formato batem com a tabela oficial em todas as máscaras', () => {
  for (let mask = 0; mask < 8; mask++) {
    const qr = QR.qrMatrix('treinutrix.com', mask);
    const size = qr.size;
    let bits = 0;
    for (let i = 14; i >= 0; i--) {
      let v;
      if (i < 6) v = qr.modules[i][8];
      else if (i < 8) v = qr.modules[i + 1][8];
      else v = qr.modules[size - 15 + i][8];
      bits = (bits << 1) | v;
    }
    assert.equal(bits.toString(2).padStart(15, '0'), FORMATO_M[mask], `máscara ${mask}`);
  }
});

test('determinístico e rejeita conteúdo grande demais', () => {
  const a = QR.qrMatrix('http://192.168.1.7:3001');
  const b = QR.qrMatrix('http://192.168.1.7:3001');
  assert.deepEqual(a, b);
  assert.throws(() => QR.qrMatrix('x'.repeat(300)), /grande demais/);
});
