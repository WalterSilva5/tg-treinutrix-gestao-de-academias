// Edge de borda. Roda em Linux (simulado) e Windows (real via dotnet-adapter).
// Responsabilidades: heartbeat, receber identificação, consultar API, liberar placa.
import http from 'node:http';
import { SimulatedPlaca, SimulatedFacial } from './simulators.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const EDGE_PORT = Number(process.env.EDGE_PORT || 3002);
const DEVICE_ID = process.env.DEVICE_ID || 'dev_fit4_01';

const placa = new SimulatedPlaca(DEVICE_ID);
const facial = new SimulatedFacial();

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

async function heartbeat() {
  try {
    await postJson(`${API_URL}/api/devices/${DEVICE_ID}/heartbeat`, {});
  } catch (e) {
    console.log('[edge] API fora do ar, tentando de novo em 15s');
  }
}
setInterval(heartbeat, 15000);
heartbeat();

async function handleIdentification(evt) {
  const decisao = await postJson(`${API_URL}/api/identification`, evt);
  console.log('[edge] decisão:', decisao);
  if (decisao.allow) {
    await placa.mensagem('Acesso liberado');
    await placa.liberar(evt.direcao || 'IN');
  } else {
    await placa.mensagem(decisao.display_msg || 'Acesso negado');
  }
  return decisao;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, device: DEVICE_ID, mode: 'SIMULADO' }));
  }
  if (req.method === 'POST' && url.pathname === '/sim/identify') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const b = raw ? JSON.parse(raw) : {};
      const evt = await facial.simularIdentificacao(b.person_id || 'per_demo_01', b.score ?? 0.95);
      const decisao = await handleIdentification(evt);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ evento: evt, decisao }));
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(EDGE_PORT, () => console.log(`Edge simulado em http://localhost:${EDGE_PORT} (device ${DEVICE_ID})`));
