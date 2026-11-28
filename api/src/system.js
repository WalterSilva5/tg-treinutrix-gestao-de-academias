// Info da máquina local para o painel Sistema. Zero dependências.
import os from 'node:os';
import dgram from 'node:dgram';
import { execFileSync } from 'node:child_process';

// IP da rota padrão (o que a rede realmente usa). No Windows, lê a tabela de
// rotas; em outros sistemas, consulta a rota com um connect UDP (sem enviar).
function ipPrimario() {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('route', ['print', '0.0.0.0'], {
        encoding: 'utf8', windowsHide: true, timeout: 2000,
      });
      for (const linha of out.split(/\r?\n/)) {
        const m = linha.trim().match(/^0\.0\.0\.0\s+0\.0\.0\.0\s+\S+\s+(\d+\.\d+\.\d+\.\d+)\s+/);
        if (m) return m[1];
      }
    } catch { /* usa o fallback abaixo */ }
  }
  const sock = dgram.createSocket('udp4');
  try {
    sock.connect(53, '8.8.8.8');
    return sock.address().address;
  } catch {
    return null;
  } finally {
    try { sock.close(); } catch { /* já fechado */ }
  }
}

const VIRTUAL = /vEthernet|WSL|Default Switch|VirtualBox|VMware|Hyper-V|Loopback|Bluetooth|Wi-Fi Direct|Fortinet|VPN/i;

export function getSystemInfo() {
  const ips = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) ips.push({ iface, address: a.address });
    }
  }

  const principal = ipPrimario();
  const nota = (x) => {
    if (x.address === principal && !VIRTUAL.test(x.iface)) return -2;
    if (VIRTUAL.test(x.iface)) return 1;
    return 0;
  };
  ips.sort((a, b) => nota(a) - nota(b) || a.iface.localeCompare(b.iface));

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    node: process.version,
    ips: ips.map((x, i) => ({ ...x, primary: i === 0 })),
    uptimeMin: Math.round(process.uptime() / 60),
    memMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    time: new Date().toISOString(),
  };
}
