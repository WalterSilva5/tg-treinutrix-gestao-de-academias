import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVERS, catalogo, normalizarDevice, driverValido } from '../src/devices.js';

test('catálogo cobre Topdata, HTTP genérico e simulador', () => {
  const ids = catalogo().map((d) => d.id);
  assert.ok(ids.includes('topdata_easyinner'));
  assert.ok(ids.includes('topdata_facial_ws'));
  assert.ok(ids.includes('generic_http'));
  assert.ok(ids.includes('simulator'));
  assert.deepEqual(DRIVERS.topdata_easyinner.modelos.includes('Fit 4'), true);
});

test('normaliza catraca Topdata', () => {
  const r = normalizarDevice({ nome: 'Entrada', driver: 'topdata_easyinner', ip: '192.168.0.100' });
  assert.equal(r.ok, true);
  assert.equal(r.device.modelo, 'Fit 4');
  assert.equal(r.device.porta, 3570);
});

test('controlador HTTP ganha endpoint padrão', () => {
  const r = normalizarDevice({ nome: 'Porta', driver: 'generic_http', ip: '10.0.0.9', porta: 8080 });
  assert.equal(r.ok, true);
  assert.equal(r.device.endpoint, 'http://10.0.0.9:8080/open');
});

test('simulador não exige IP', () => {
  const r = normalizarDevice({ nome: 'Teste', driver: 'simulator' });
  assert.equal(r.ok, true);
});

test('rejeita driver desconhecido, nome vazio e falta de IP', () => {
  assert.equal(normalizarDevice({ nome: 'X', driver: 'foo', ip: '1.2.3.4' }).ok, false);
  assert.equal(normalizarDevice({ nome: '', ip: '1.2.3.4' }).ok, false);
  assert.equal(normalizarDevice({ nome: 'X', driver: 'generic_http' }).ok, false);
  assert.equal(driverValido('topdata_easyinner'), true);
  assert.equal(driverValido('nope'), false);
});
