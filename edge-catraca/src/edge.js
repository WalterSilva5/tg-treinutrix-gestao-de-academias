// Edge de borda. Roda em Linux (simulado) e Windows (real).
// Responsabilidades: heartbeat, sincronizar cadastros com o leitor, receber
// identificação, consultar a API e liberar a placa.
//
// Hardware real (USE_REAL_HARDWARE=1):
//   - catraca EasyInner -> bridge C# em edge-catraca/dotnet-adapter (TCP NDJSON)
//   - leitor facial     -> este processo é o servidor WebSocket do leitor
// Sem hardware, usa os simuladores e expõe /sim/*.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulatedPlaca, SimulatedFacial } from './simulators.js';
import { EasyInnerReal } from './easyinner.js';
import { FacialReal } from './facial-real.js';
import { GenericHttpPlaca } from './generic-http.js';
import { buildSetUserinfo, buildDeleteUser, buildSetDevinfo } from './facial-ws.js';

const API_URL = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');
const EDGE_PORT = Number(process.env.EDGE_PORT || 3002);
const DEVICE_ID = process.env.DEVICE_ID || 'dev_fit4_01';
const CARTAO_DEVICE_ID = process.env.CARTAO_DEVICE_ID || DEVICE_ID;
const FACIAL_DEVICE_ID = process.env.FACIAL_DEVICE_ID || DEVICE_ID;
const USE_REAL = process.env.USE_REAL_HARDWARE === '1';
// simulator | generic_http | easyinner (ou topdata_easyinner) | topdata_facial_ws
const DEVICE_DRIVER = process.env.DEVICE_DRIVER || (USE_REAL ? 'easyinner' : 'simulator');
const DEVICE_DRIVER_EXPLICIT = Boolean(process.env.DEVICE_DRIVER);
const DEVICE_ENDPOINT = process.env.DEVICE_ENDPOINT || '';
const DRIVER_EASYINNER = DEVICE_DRIVER === 'easyinner' || DEVICE_DRIVER === 'topdata_easyinner';
const DRIVER_HTTP = DEVICE_DRIVER === 'generic_http';
const FACIAL_REAL = USE_REAL || DEVICE_DRIVER === 'topdata_facial_ws';
const HARDWARE_REAL = USE_REAL || DRIVER_EASYINNER || DRIVER_HTTP || FACIAL_REAL;
const SYNC_ENABLED = process.env.SYNC_ENABLED !== '0';
const EDGE_TOKEN = process.env.EDGE_TOKEN || '';
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 30000);
const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 5000);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EASYINNER_BRIDGE_PORT = Number(process.env.EASYINNER_PORT || 5011);
const AUTOSTART_BRIDGE = process.env.EASYINNER_AUTOSTART !== '0';
// Conta de serviço do edge (operador). Padrão = admin seed; troque via env.
const EDGE_LOGIN = process.env.EDGE_LOGIN || process.env.SEED_ADMIN_LOGIN || 'admin';
const EDGE_PASSWORD = process.env.EDGE_PASSWORD || process.env.SEED_ADMIN_PASSWORD || 'admin123';

let edgeToken = null;
let ultimoErro = null;

function logErro(msg) {
  if (msg !== ultimoErro) console.log('[edge]', msg);
  ultimoErro = msg;
}
function logOk() { ultimoErro = null; }

async function edgeLogin() {
  try {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: EDGE_LOGIN, senha: EDGE_PASSWORD }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) { logErro(`login falhou (${res.status})`); return false; }
    edgeToken = (await res.json()).token;
    logOk();
    return true;
  } catch {
    logErro('API fora do ar no login');
    return false;
  }
}

async function request(method, path, body, retry = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (edgeToken) headers.Authorization = `Bearer ${edgeToken}`;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (res.status === 401 && retry) {
    if (await edgeLogin()) return request(method, path, body, false);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch { /* resposta não-JSON */ }
  if (!res.ok) throw new Error(`API ${res.status}: ${(json && json.error) || text.slice(0, 120)}`);
  logOk();
  return json || {};
}

const postJson = (path, body) => request('POST', path, body);
const getJson = (path) => request('GET', path);

async function heartbeat() {
  try {
    await postJson(`/api/devices/${encodeURIComponent(DEVICE_ID)}/heartbeat`, {});
  } catch {
    logErro('API fora do ar, tentando de novo em 15s');
  }
}

// Configuração do equipamento vem da API (cadastro em Sistema → Catracas).
let deviceConfig = null;
async function carregarDeviceConfig() {
  try {
    const lista = await getJson('/api/devices');
    deviceConfig = (Array.isArray(lista) ? lista : []).find((d) => d.id === DEVICE_ID) || null;
    if (deviceConfig) {
      console.log(`[edge] equipamento ${DEVICE_ID}: ${deviceConfig.driver} ${deviceConfig.ip}:${deviceConfig.porta}`);
      if (deviceConfig.driver && !DEVICE_DRIVER_EXPLICIT) {
        console.log(`[edge] dica: cadastro usa driver ${deviceConfig.driver}; edge está em ${DEVICE_DRIVER}`);
      }
    } else {
      console.log(`[edge] equipamento ${DEVICE_ID} não cadastrado na API`);
    }
  } catch (e) {
    logErro(`config do equipamento indisponível (${e.message})`);
  }
}

// Em Windows com driver EasyInner, sobe a ponte usando IP/porta do cadastro.
let bridge = null;
function iniciarBridge() {
  if (!DRIVER_EASYINNER || !AUTOSTART_BRIDGE || process.platform !== 'win32' || bridge) return;
  const exe = path.join(HERE, '..', 'dotnet-adapter', 'EasyInnerBridge.exe');
  if (!existsSync(exe)) {
    console.log('[edge] bridge não encontrado; rode build.ps1 ou inicie manualmente');
    return;
  }
  const portaInner = Number(deviceConfig?.porta || process.env.EASYINNER_INNER_PORT || 3000);
  const ip = deviceConfig?.ip || process.env.EASYINNER_IP || '';
  const args = [
    '--port', String(EASYINNER_BRIDGE_PORT),
    '--inner', String(process.env.EASYINNER_INNER || 1),
    '--porta-inner', String(portaInner),
  ];
  if (ip) args.push('--ip', ip);
  if (process.env.EASYINNER_ORIGEM_SAIDA) args.push('--origem-saida', process.env.EASYINNER_ORIGEM_SAIDA);
  if (process.env.EASYINNER_PADRAO_CARTAO) args.push('--padrao-cartao', process.env.EASYINNER_PADRAO_CARTAO);

  bridge = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  bridge.stdout.setEncoding('utf8');
  bridge.stdout.on('data', (txt) => {
    for (const linha of String(txt).split('\n')) if (linha.trim()) console.log('[bridge]', linha.trim());
  });
  bridge.stderr.setEncoding('utf8');
  bridge.stderr.on('data', (txt) => console.log('[bridge] erro:', String(txt).trim()));
  bridge.on('exit', (code) => { console.log('[bridge] encerrou', code); bridge = null; });
  console.log(`[edge] bridge iniciado (${ip || 'sem ip'}:${portaInner})`);
}

function pararBridge() {
  if (!bridge) return false;
  const pid = bridge.pid;
  try { bridge.kill(); } catch { /* já saiu */ }
  bridge = null;
  console.log(`[edge] bridge encerrado (pid ${pid})`);
  return true;
}

async function reiniciarBridge() {
  pararBridge();
  if (!DRIVER_EASYINNER || !AUTOSTART_BRIDGE || process.platform !== 'win32') {
    return { ok: false, motivo: 'autostart do bridge desligado' };
  }
  await new Promise((r) => setTimeout(r, 800));
  iniciarBridge();
  return { ok: Boolean(bridge), pid: bridge?.pid || null };
}

// ---------------------------------------------------------------------------
// hardware: real ou simulado
// ---------------------------------------------------------------------------
async function decidir(evt) {
  try {
    return await postJson('/api/identification', evt);
  } catch (e) {
    // API fora do ar: falha fechada (não abre) e avisa no display.
    console.error('[edge] decisão indisponível:', e.message);
    return { allow: false, motivo: 'API_OFFLINE', display_msg: 'Sistema indisponível.' };
  }
}

let placa;
let facial;

if (DRIVER_HTTP) {
  if (!DEVICE_ENDPOINT) {
    console.error('[edge] DEVICE_DRIVER=generic_http exige DEVICE_ENDPOINT');
    process.exit(1);
  }
  placa = new GenericHttpPlaca(CARTAO_DEVICE_ID, DEVICE_ENDPOINT);
} else if (DRIVER_EASYINNER) {
  placa = new EasyInnerReal({
    deviceId: CARTAO_DEVICE_ID,
    onIdentificacao: (evt) => handleIdentification(evt),
    onStatus: (st) => console.log(`[edge] catraca ${st.conectado ? 'ok' : 'offline'}`),
  });
} else {
  placa = new SimulatedPlaca(CARTAO_DEVICE_ID);
}

if (FACIAL_REAL) {
  facial = new FacialReal({
    deviceId: FACIAL_DEVICE_ID,
    // No facial quem mostra a mensagem é o campo `message` da resposta online.
    onAccess: (evt) => decidir(evt),
    onSendUser: (u) => postJson('/api/facial/users', {
      device_id: FACIAL_DEVICE_ID, enrollid: u.enrollid, name: u.name, card: u.card,
    }).catch((e) => console.log('[edge] senduser não refletido na API:', e.message)),
    onUnknown: (u) => postJson('/api/facial/unknown', {
      device_id: FACIAL_DEVICE_ID, image: u.image, timestamp: u.timestamp,
    }).catch((e) => console.log('[edge] rosto desconhecido não enviado:', e.message)),
  });
} else {
  facial = new SimulatedFacial(FACIAL_DEVICE_ID);
}

// ---------------------------------------------------------------------------
// sincronização de cadastros com o leitor facial
// ---------------------------------------------------------------------------
async function baixarFoto(url) {
  if (!url) return null;
  const res = await fetch(`${API_URL}${url}`, {
    headers: edgeToken ? { Authorization: `Bearer ${edgeToken}` } : {},
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`foto ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

async function sincronizarItem(item) {
  const payload = item.payload || {};
  if (item.operacao === 'DELETE') {
    await facial.enviarComando(buildDeleteUser(payload.enrollid));
    return;
  }
  const fotoBase64 = payload.foto ? await baixarFoto(payload.foto) : null;
  await facial.enviarComando(buildSetUserinfo({
    enrollid: payload.enrollid,
    name: payload.name,
    fotoBase64,
    enable: payload.enable !== false,
  }));
}

async function sincronizarPendentes() {
  if (!SYNC_ENABLED) return;
  if (FACIAL_REAL && !facial.conectado) {
    logErro('leitor facial desconectado, sync adiado');
    return;
  }
  try {
    const list = await getJson(`/api/sync?device_id=${encodeURIComponent(FACIAL_DEVICE_ID)}&status=PENDING&limit=20`);
    for (const item of Array.isArray(list) ? list : []) {
      try {
        await sincronizarItem(item);
        await postJson(`/api/sync/${encodeURIComponent(item.id)}/ack`, { status: 'SENT' });
      } catch (e) {
        console.log('[edge] sync falhou', item.id, e.message);
        try { await postJson(`/api/sync/${encodeURIComponent(item.id)}/ack`, { status: 'ERROR', erro: e.message }); } catch {}
      }
    }
  } catch (e) {
    logErro(`sync indisponível (${e.message})`);
  }
}

// ---------------------------------------------------------------------------
// decisão de acesso
// ---------------------------------------------------------------------------
// Decide e atua na placa (eventos de cartão/simulador). Para o facial real a
// atuação é a resposta online (`access`), por isso ele chama só `decidir`.
async function handleIdentification(evt) {
  const decisao = await decidir(evt);
  console.log('[edge] decisão:', decisao.motivo, decisao.allow ? 'ALLOW' : 'DENY');
  try {
    if (decisao.allow) {
      await placa.mensagem('Acesso liberado');
      await placa.liberar(evt.direcao || 'IN');
    } else {
      await placa.mensagem(decisao.display_msg || 'Acesso negado');
    }
  } catch (e) {
    console.log('[edge] falha ao atuar na placa:', e.message);
  }
  return decisao;
}

function lerJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      raw += c;
      if (raw.length > 1024 * 1024) { done = true; reject(new Error('corpo grande')); req.destroy(); }
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        device: DEVICE_ID,
        mode: HARDWARE_REAL ? 'REAL' : 'SIMULADO',
        driver: DEVICE_DRIVER,
        api: ultimoErro ? 'indisponivel' : 'ok',
        facial: facial.conectado === undefined ? 'simulado' : (facial.conectado ? 'conectado' : 'desconectado'),
        catraca: placa.conectado === undefined ? 'simulado' : (placa.conectado ? 'conectado' : 'desconectado'),
      });
    }

    // Diagnóstico do hardware para o painel/API.
    if (req.method === 'GET' && url.pathname === '/hardware') {
      return json(res, 200, {
        device: DEVICE_ID,
        driver: DEVICE_DRIVER,
        mode: HARDWARE_REAL ? 'REAL' : 'SIMULADO',
        config: deviceConfig ? {
          id: deviceConfig.id, ip: deviceConfig.ip, porta: deviceConfig.porta, driver: deviceConfig.driver,
        } : null,
        facial: facial.status ? facial.status() : { modo: 'simulado' },
        catraca: placa.status ? placa.status() : { modo: 'simulado' },
        bridge: bridge ? { pid: bridge.pid, porta: EASYINNER_BRIDGE_PORT, ip: deviceConfig?.ip || null } : null,
        ultimoErro,
      });
    }

    if (req.method === 'POST' && url.pathname === '/hardware/restart') {
      if (EDGE_TOKEN && req.headers['x-edge-token'] !== EDGE_TOKEN) return json(res, 401, { error: 'não autorizado' });
      const r = await reiniciarBridge();
      return json(res, r.ok ? 200 : 409, r);
    }

    // Abre o giro a pedido da API (liberação manual do operador).
    if (req.method === 'POST' && url.pathname === '/open') {
      if (EDGE_TOKEN && req.headers['x-edge-token'] !== EDGE_TOKEN) return json(res, 401, { error: 'não autorizado' });
      const b = await lerJson(req);
      if (b.device_id && b.device_id !== DEVICE_ID && b.device_id !== CARTAO_DEVICE_ID) {
        return json(res, 404, { error: 'device_not_found' });
      }
      try {
        await placa.mensagem('Liberado pela recepção');
        const out = await placa.liberar(b.direcao === 'OUT' ? 'OUT' : 'IN');
        return json(res, 200, { ok: true, ...out });
      } catch (e) {
        return json(res, 502, { ok: false, error: e.message });
      }
    }

    // Simulador de leitor: só existe sem hardware real.
    if (url.pathname.startsWith('/sim/') && HARDWARE_REAL) {
      return json(res, 404, { error: 'simulador desativado (hardware real configurado)' });
    }
    if (url.pathname.startsWith('/sim/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    if (req.method === 'POST' && url.pathname === '/sim/identify') {
      const b = await lerJson(req);
      const evt = await facial.simularIdentificacao(b.person_id || 'per_demo_01', b.score ?? 0.95, {
        direcao: b.direcao === 'OUT' ? 'OUT' : 'IN',
        mode: Number(b.mode || 8),
      });
      evt.device_id = FACIAL_DEVICE_ID;
      const decisao = await handleIdentification(evt);
      return json(res, 200, { evento: evt, decisao });
    }

    return json(res, 404, { error: 'not_found' });
  } catch (e) {
    console.log('[edge] erro na requisição:', e.message);
    if (!res.headersSent) return json(res, 400, { error: e.message });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
await edgeLogin();
await carregarDeviceConfig();
heartbeat();
setInterval(heartbeat, 15000).unref();

iniciarBridge();
if (DRIVER_EASYINNER) placa.start();
if (FACIAL_REAL) {
  try {
    await facial.start();
  } catch (e) {
    console.log('[edge] não foi possível abrir o WebSocket facial:', e.message);
  }
} else {
  // Configura o leitor simulado em modo online.
  facial.enviarComando(buildSetDevinfo({ server_verify: 1 })).catch(() => {});
}

sincronizarPendentes();
setInterval(sincronizarPendentes, SYNC_INTERVAL_MS).unref();

server.listen(EDGE_PORT, () => console.log(`Edge em http://localhost:${EDGE_PORT} (device ${DEVICE_ID}, driver ${DEVICE_DRIVER}, ${HARDWARE_REAL ? 'REAL' : 'SIMULADO'})`));

async function encerrar() {
  console.log('[edge] encerrando...');
  server.close();
  if (bridge) { try { bridge.kill(); } catch {} }
  try { await facial.stop?.(); } catch {}
  try { await placa.stop?.(); } catch {}
  process.exit(0);
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
