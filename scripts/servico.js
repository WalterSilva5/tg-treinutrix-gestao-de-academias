// Supervisor local da API/edge: mantém o processo vivo, grava logs com rotação
// e reinicia em caso de queda. Sem dependências e sem Docker.
//
// Uso:
//   node scripts/servico.js api
//   node scripts/servico.js edge
//   node scripts/servico.js api --once    (não reinicia; útil para testes)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const alvo = String(process.argv[2] || '').toLowerCase();
const umaVez = process.argv.includes('--once');
const LOG_DIR = process.env.LOG_DIR || path.join(RAIZ, 'logs');
const MAX_BYTES = Number(process.env.LOG_MAX_BYTES || 5 * 1024 * 1024);
const KEEP = Number(process.env.LOG_KEEP || 5);
const REINICIO_MS = Number(process.env.SERVICE_RESTART_MS || 3000);

const ALVOS = {
  api: { script: path.join(RAIZ, 'api', 'src', 'server.js'), nome: 'api' },
  edge: { script: path.join(RAIZ, 'edge-catraca', 'src', 'edge.js'), nome: 'edge' },
};

if (!ALVOS[alvo]) {
  console.error('Uso: node scripts/servico.js api|edge [--once]');
  process.exit(1);
}

const cfg = ALVOS[alvo];
fs.mkdirSync(LOG_DIR, { recursive: true });
const arquivoLog = path.join(LOG_DIR, `${cfg.nome}.log`);

function rotacionar() {
  const tamanho = fs.existsSync(arquivoLog) ? fs.statSync(arquivoLog).size : 0;
  if (tamanho < MAX_BYTES) return false;
  for (let i = KEEP - 1; i >= 1; i -= 1) {
    const de = `${arquivoLog}.${i}`;
    const para = `${arquivoLog}.${i + 1}`;
    if (fs.existsSync(de)) {
      try { fs.renameSync(de, para); } catch { /* arquivo em uso */ }
    }
  }
  try { fs.renameSync(arquivoLog, `${arquivoLog}.1`); } catch { /* segue anexando */ }
  return true;
}

let stream = fs.createWriteStream(arquivoLog, { flags: 'a' });
let tamanhoLog = fs.existsSync(arquivoLog) ? fs.statSync(arquivoLog).size : 0;
let filho = null;
let parando = false;
let tentativas = 0;

function escrever(prefixo, pedaco) {
  const texto = String(pedaco);
  for (const linha of texto.split(/\r?\n/)) {
    if (!linha.trim()) continue;
    const bytes = Buffer.byteLength(linha) + 1;
    if (tamanhoLog + bytes > MAX_BYTES) {
      rotacionar();
      try { stream.end(); } catch { /* já fechado */ }
      stream = fs.createWriteStream(arquivoLog, { flags: 'a' });
      tamanhoLog = 0;
    }
    stream.write(`${new Date().toISOString()} [${prefixo}] ${linha}\n`);
    tamanhoLog += bytes + 30;
  }
}

function iniciar() {
  if (parando) return;
  const ambiente = { ...process.env };
  // Garante caminhos absolutos quando o serviço roda de outro diretório.
  ambiente.PAINEL_ROOT = RAIZ;
  filho = spawn(process.execPath, [cfg.script], {
    cwd: RAIZ,
    env: ambiente,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(`[servico] ${cfg.nome} iniciado (pid ${filho.pid})`);
  filho.stdout.on('data', (d) => escrever(cfg.nome, d));
  filho.stderr.on('data', (d) => escrever(`${cfg.nome}:err`, d));
  filho.on('error', (e) => escrever(`${cfg.nome}:err`, `falha ao iniciar: ${e.message}`));
  filho.on('exit', (code, sinal) => {
    filho = null;
    if (parando) return;
    escrever(`${cfg.nome}:err`, `saiu com código ${code ?? sinal}`);
    if (umaVez) process.exit(code || 1);
    tentativas += 1;
    const espera = Math.min(30000, REINICIO_MS * tentativas);
    console.log(`[servico] reiniciando em ${espera} ms`);
    setTimeout(iniciar, espera);
  });
  setTimeout(() => { tentativas = 0; }, 60000).unref();
}

function encerrar(sinal) {
  parando = true;
  console.log(`[servico] recebido ${sinal}, encerrando ${cfg.nome}`);
  if (filho) {
    try { filho.kill('SIGTERM'); } catch { /* já saiu */ }
    setTimeout(() => { try { filho?.kill('SIGKILL'); } catch {} }, 5000).unref();
  }
  setTimeout(() => { try { stream.end(); } catch {} process.exit(0); }, 800).unref();
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('uncaughtException', (e) => escrever(`${cfg.nome}:err`, `uncaught: ${e.stack || e.message}`));
process.on('unhandledRejection', (e) => escrever(`${cfg.nome}:err`, `unhandled: ${e?.stack || e}`));

escrever('servico', `iniciando ${cfg.nome} em ${RAIZ}`);
iniciar();
