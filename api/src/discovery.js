// Descoberta e teste de catracas/controladores na rede local, sem dependências.
// Só varre faixas privadas e no máximo um /24 por vez, com concorrência limitada,
// para não gerar tráfego excessivo na rede da academia.
import net from 'node:net';
import os from 'node:os';

const PRIVADAS = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function ipValido(ip) {
  const m = IPV4.exec(String(ip || '').trim());
  if (!m) return false;
  return m.slice(1).every((n) => Number(n) >= 0 && Number(n) <= 255);
}

export function ipPrivado(ip) {
  return ipValido(ip) && PRIVADAS.some((re) => re.test(String(ip).trim()));
}

// Interfaces IPv4 privadas da máquina (para sugerir a faixa a varrer).
export function redesLocais() {
  const out = [];
  for (const [nome, lista] of Object.entries(os.networkInterfaces())) {
    for (const info of lista || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (!ipPrivado(info.address)) continue;
      const partes = info.address.split('.');
      out.push({
        interface: nome,
        ip: info.address,
        cidr: `${partes[0]}.${partes[1]}.${partes[2]}.0/24`,
      });
    }
  }
  // Prefere 192.168.x (rede típica de academia) e depois 10.x.
  return out.sort((a, b) => {
    const peso = (r) => (r.cidr.startsWith('192.168.') ? 0 : r.cidr.startsWith('10.') ? 1 : 2);
    return peso(a) - peso(b) || a.cidr.localeCompare(b.cidr);
  });
}

// Aceita "192.168.0.0/24" (somente /24), "192.168.0." ou "192.168.0.10".
export function normalizarSubnet(valor) {
  const s = String(valor || '').trim();
  if (!s) return null;
  if (s.endsWith('.')) return `${s}0/24`;
  if (s.includes('/')) {
    const [base, bits] = s.split('/');
    if (bits !== '24' || !ipValido(base)) return null;
    return `${base.replace(/\.\d+$/, '.0')}/24`;
  }
  if (ipValido(s)) return `${s.replace(/\.\d+$/, '.0')}/24`;
  return null;
}

export function hostsDaSubnet(subnet) {
  const norm = normalizarSubnet(subnet);
  if (!norm) throw new Error('subnet inválida (use A.B.C.0/24)');
  const base = norm.split('/')[0].split('.').slice(0, 3).join('.');
  if (!ipPrivado(`${base}.1`)) throw new Error('só é permitido varrer faixas privadas');
  const hosts = [];
  for (let i = 1; i <= 254; i += 1) hosts.push(`${base}.${i}`);
  return hosts;
}

// Testa uma porta TCP. Nunca rejeita: devolve { ok, latencyMs, error }.
export function probarTcp(host, porta, timeoutMs = Number(process.env.PROBE_TIMEOUT_MS || 700)) {
  const inicio = Date.now();
  return new Promise((resolve) => {
    let pronto = false;
    const socket = net.createConnection({ host, port: Number(porta) });
    const fim = (ok, error) => {
      if (pronto) return;
      pronto = true;
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - inicio, error: error || null });
    };
    socket.setTimeout(Math.max(100, Math.min(5000, timeoutMs)));
    socket.once('connect', () => fim(true));
    socket.once('timeout', () => fim(false, 'timeout'));
    socket.once('error', (e) => fim(false, e.code || 'erro'));
  });
}

// Varre uma lista de hosts/portas com concorrência fixa.
export async function varrerHosts(hosts, portas, { timeoutMs = 700, concorrencia = 64 } = {}) {
  const alvos = [];
  for (const host of hosts) for (const porta of portas) alvos.push({ host, porta: Number(porta) });
  const abertos = [];
  let idx = 0;

  async function trabalhador() {
    while (idx < alvos.length) {
      const alvo = alvos[idx++];
      const r = await probarTcp(alvo.host, alvo.porta, timeoutMs);
      if (r.ok) abertos.push({ ip: alvo.host, porta: alvo.porta, latencyMs: r.latencyMs });
    }
  }

  const n = Math.max(1, Math.min(concorrencia, alvos.length));
  await Promise.all(Array.from({ length: n }, trabalhador));
  abertos.sort((a, b) => a.ip.localeCompare(b.ip) || a.porta - b.porta);
  return abertos;
}

// Varredura completa de um /24. `portas` é limitado a 4 para evitar abuso.
export async function descobrirCatracas({
  subnet, portas = [3570, 3000], timeoutMs = 700, concorrencia = 64,
} = {}) {
  const hosts = hostsDaSubnet(subnet);
  const lista = [...new Set(portas.map(Number).filter((p) => Number.isInteger(p) && p > 0 && p <= 65535))].slice(0, 4);
  if (lista.length === 0) throw new Error('informe ao menos uma porta válida');
  const abertos = await varrerHosts(hosts, lista, { timeoutMs, concorrencia });
  // Hosts com mais de uma porta aberta viram um único resultado.
  const porIp = new Map();
  for (const r of abertos) {
    const atual = porIp.get(r.ip);
    if (!atual) porIp.set(r.ip, { ip: r.ip, portas: [r.porta], latencyMs: r.latencyMs });
    else atual.portas.push(r.porta);
  }
  return {
    subnet: normalizarSubnet(subnet),
    portas: lista,
    hostsVarridos: hosts.length,
    encontrados: [...porIp.values()],
  };
}
