import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PHOTO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-fotos-'));
process.env.PHOTO_MAX_BYTES = '2048';
const photos = await import('../src/photos.js');

// JPEG mínimo válido (assinatura + bytes)
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

function dataUrl(buf, mime = 'image/jpeg') {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

test('parse aceita data URL e base64 puro', () => {
  const a = photos.parsePhoto(dataUrl(jpeg));
  assert.equal(a.mime, 'image/jpeg');
  const b = photos.parsePhoto(jpeg.toString('base64'));
  assert.equal(b.buffer.length, jpeg.length);
  assert.equal(photos.parsePhoto(''), null);
  assert.equal(photos.parsePhoto('não é base64 !!!'), null);
});

test('valida assinatura real do arquivo', () => {
  assert.equal(photos.validatePhoto({ mime: 'image/jpeg', buffer: jpeg }).ok, true);
  const fake = Buffer.from('GIF89a texto qualquer');
  const r = photos.validatePhoto({ mime: 'image/jpeg', buffer: fake });
  assert.equal(r.ok, false);
  assert.match(r.error, /formato inválido/);
});

test('rejeita foto acima do limite', () => {
  const big = Buffer.concat([jpeg, Buffer.alloc(3000)]);
  const r = photos.validatePhoto({ mime: 'image/jpeg', buffer: big });
  assert.equal(r.ok, false);
  assert.match(r.error, /maior que/);
});

test('salva, lê e remove a foto', () => {
  const saved = photos.savePhoto('per_1', jpeg, 'jpg');
  assert.equal(saved, 'per_1.jpg');
  const read = photos.readPhoto('per_1', 'jpg');
  assert.equal(read.mime, 'image/jpeg');
  assert.deepEqual(read.buffer, jpeg);
  photos.deletePhoto('per_1');
  assert.equal(photos.readPhoto('per_1', 'jpg'), null);
});

test('id inválido não escapa do diretório', () => {
  assert.throws(() => photos.savePhoto('../evil', jpeg, 'jpg'), /id inválido/);
  assert.equal(photos.photoCount(), 0);
});
