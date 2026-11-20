// Descoberta/teste de catracas: funções puras + probe TCP real em loopback.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  ipValido, ipPrivado, normalizarSubnet, hostsDaSubnet, probarTcp, varrerHosts, descobrirCatracas,
} from '../src/discovery.js';

test('valida IPv4 e faixas privadas', () => {
  assert.equal(ipValido('192.168.0.100'), true);
  assert.equal(ipValido('192.168.0.999'), false);
  assert.equal(ipPrivado('192.168.1.10'), true);
  assert.equal(ipPrivado('10.0.0.5'), true);
  assert.equal(ipPrivado('172.16.0.1'), true);
  assert.equal(ipPrivado('8.8.8.8'), false);
});

test('normaliza subnet /24 e lista 254 hosts', () => {
  assert.equal(normalizarSubnet('192.168.0.0/24'), '192.168.0.0/24');
  assert.equal(normalizarSubnet('192.168.0.100'), '192.168.0.0/24');
  assert.equal(normalizarSubnet('192.168.0.'), '192.168.0.0/24');
  assert.equal(normalizarSubnet('192.168.0.0/16'), null);
  const hosts = hostsDaSubnet('192.168.0.0/24');
  assert.equal(hosts.length, 254);
  assert.equal(hosts[0], '192.168.0.1');
  assert.equal(hosts[253], '192.168.0.254');
  assert.throws(() => hostsDaSubnet('8.8.8.0/24'), /privadas/);
});

test('probe TCP acerta porta aberta e erra porta fechada', async () => {
  const srv = net.createServer((s) => s.end());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  const aberto = await probarTcp('127.0.0.1', porta, 800);
  assert.equal(aberto.ok, true);
  await new Promise((r) => srv.close(r));
  const fechado = await probarTcp('127.0.0.1', porta, 500);
  assert.equal(fechado.ok, false);
});

test('varredura de hosts acha a porta aberta', async () => {
  const srv = net.createServer((s) => s.end());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  const achados = await varrerHosts(['127.0.0.1', '127.0.0.2'], [porta], { timeoutMs: 400, concorrencia: 2 });
  await new Promise((r) => srv.close(r));
  assert.deepEqual(achados.map((a) => a.ip), ['127.0.0.1']);
  assert.equal(achados[0].porta, porta);
});

test('descobrir recusa faixa pública e porta inválida', async () => {
  await assert.rejects(() => descobrirCatracas({ subnet: '8.8.8.0/24' }), /privadas/);
  assert.equal((await descobrirCatracas({ subnet: '192.168.0.0/24', portas: [0] }).catch((e) => e)).message, 'informe ao menos uma porta válida');
});
