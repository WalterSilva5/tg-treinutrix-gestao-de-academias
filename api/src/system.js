// Info da máquina local para o painel Sistema. Zero dependências.
import os from 'node:os';

export function getSystemInfo() {
  const ips = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) ips.push({ iface, address: a.address });
    }
  }
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    node: process.version,
    ips,
    uptimeMin: Math.round(process.uptime() / 60),
    memMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    time: new Date().toISOString(),
  };
}
