// Ponte TCP com o bridge C# que fala com a EasyInner.dll (Windows).
// Protocolo: JSON por linha (NDJSON). O bridge faz o polling da catraca e
// empurra os eventos; aqui só decidimos e mandamos liberar/mensagem.
import net from 'node:net';

export class EasyInnerReal {
  constructor({
    host = process.env.EASYINNER_HOST || '127.0.0.1',
    port = Number(process.env.EASYINNER_PORT || 5011),
    deviceId,
    onIdentificacao,
    onStatus,
    reconnectMs = Number(process.env.EASYINNER_RECONNECT_MS || 5000),
    commandTimeoutMs = Number(process.env.EASYINNER_CMD_TIMEOUT_MS || 5000),
    pingMs = Number(process.env.EASYINNER_PING_MS || 15000),
    log = console.log,
  } = {}) {
    this.host = host;
    this.port = port;
    this.deviceId = deviceId;
    this.onIdentificacao = onIdentificacao;
    this.onStatus = onStatus;
    this.reconnectMs = reconnectMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.pingMs = pingMs;
    this.log = log;

    this.socket = null;
    this.conectado = false;
    this.parado = false;
    this.buf = '';
    this.seq = 0;
    this.pendentes = new Map();
    this.reconexao = null;
    this.ping = null;
    this.ultimoErro = null;
  }

  start() {
    this.parado = false;
    this._conectar();
    return this;
  }

  async stop() {
    this.parado = true;
    clearTimeout(this.reconexao);
    clearInterval(this.ping);
    this._rejeitarPendentes(new Error('catraca desligada'));
    if (this.socket) this.socket.destroy();
    this.socket = null;
    this.conectado = false;
  }

  // Libera o giro. Rejeita se o bridge estiver fora do ar.
  liberar(direcao = 'IN') {
    return this._comando({ cmd: 'liberar', direcao: direcao === 'OUT' ? 'OUT' : 'IN' });
  }

  mensagem(texto) {
    return this._comando({ cmd: 'mensagem', texto: String(texto ?? '').slice(0, 64) });
  }

  pingar() {
    return this._comando({ cmd: 'ping' });
  }

  status() {
    return {
      conectado: this.conectado,
      host: this.host,
      porta: this.port,
      ultimoErro: this.ultimoErro || null,
      pendentes: this.pendentes.size,
    };
  }

  _comando(payload, { timeoutMs = this.commandTimeoutMs } = {}) {
    if (!this.conectado || !this.socket || this.socket.destroyed) {
      return Promise.reject(new Error('catraca desconectada (bridge EasyInner fora do ar)'));
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        reject(new Error(`timeout no comando ${payload.cmd}`));
      }, timeoutMs);
      timer.unref?.();
      this.pendentes.set(id, { resolve, reject, timer });
      this._enviar({ id, ...payload });
    });
  }

  _conectar() {
    if (this.parado) return;
    clearTimeout(this.reconexao);
    const socket = net.createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setNoDelay(true);

    socket.on('connect', () => {
      this.conectado = true;
      this.ultimoErro = null;
      this.log(`[inner] bridge conectado em ${this.host}:${this.port}`);
      this.onStatus?.({ conectado: true });
      clearInterval(this.ping);
      this.ping = setInterval(() => {
        this.pingar().catch(() => {});
      }, this.pingMs);
      this.ping.unref?.();
    });

    socket.on('data', (chunk) => this._dados(chunk));

    socket.on('error', (e) => {
      // ECONNREFUSED é o caso normal enquanto o bridge não subiu: loga uma vez.
      if (this.ultimoErro !== e.code) this.log(`[inner] bridge indisponível (${e.code || e.message})`);
      this.ultimoErro = e.code || e.message;
    });

    socket.on('close', () => {
      const estava = this.conectado;
      this.conectado = false;
      clearInterval(this.ping);
      this._rejeitarPendentes(new Error('bridge EasyInner desconectado'));
      if (estava) {
        this.log('[inner] bridge desconectado');
        this.onStatus?.({ conectado: false });
      }
      if (!this.parado) this.reconexao = setTimeout(() => this._conectar(), this.reconnectMs);
      this.reconexao?.unref?.();
    });
  }

  _enviar(obj) {
    if (!this.socket || this.socket.destroyed) return false;
    this.socket.write(`${JSON.stringify(obj)}\n`);
    return true;
  }

  _dados(chunk) {
    this.buf += chunk;
    if (this.buf.length > 1024 * 1024) {
      this.log('[inner] linha grande demais, descartando buffer');
      this.buf = '';
      return;
    }
    let idx = this.buf.indexOf('\n');
    while (idx >= 0) {
      const linha = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (linha) this._linha(linha);
      idx = this.buf.indexOf('\n');
    }
  }

  _linha(linha) {
    let msg;
    try { msg = JSON.parse(linha); } catch {
      this.log('[inner] resposta inválida do bridge');
      return;
    }

    if (msg.evento === 'cartao') {
      const evt = {
        device_id: this.deviceId,
        person_id: String(msg.cartao ?? ''),
        metodo: 'CARTAO',
        direcao: msg.direcao === 'OUT' ? 'OUT' : 'IN',
        timestamp: msg.dataHora || undefined,
      };
      Promise.resolve()
        .then(() => this.onIdentificacao?.(evt, msg))
        .catch((e) => this.log('[inner] falha ao tratar evento:', e.message));
      return;
    }

    if (msg.evento === 'status') {
      this.log(`[inner] catraca ${msg.conectado ? 'conectada' : 'desconectada'}${msg.erro ? `: ${msg.erro}` : ''}`);
      this.onStatus?.(msg);
      return;
    }

    if (msg.id !== undefined) {
      const pendente = this.pendentes.get(msg.id);
      if (!pendente) return;
      clearTimeout(pendente.timer);
      this.pendentes.delete(msg.id);
      if (msg.ok === false) pendente.reject(new Error(msg.erro || 'bridge recusou o comando'));
      else pendente.resolve(msg);
      return;
    }

    this.log('[inner] mensagem desconhecida do bridge');
  }

  _rejeitarPendentes(erro) {
    for (const { timer, reject } of this.pendentes.values()) {
      clearTimeout(timer);
      reject(erro);
    }
    this.pendentes.clear();
  }
}
