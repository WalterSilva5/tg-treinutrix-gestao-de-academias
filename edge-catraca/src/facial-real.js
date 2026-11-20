// Adaptador real do leitor facial (linha Easy) via WebSocket.
// O leitor conecta neste processo; aqui respondemos o handshake `reg`, o
// `sendlog` (online) e os `ret` dos comandos de cadastro.
import { WsServer } from './ws-server.js';
import {
  buildRegAnswer, buildSetDevinfo, buildAccessAnswer, parseReaderMessage,
} from './facial-ws.js';

const METODO_MODE = { 2: 'SENHA', 3: 'CARTAO', 8: 'FACIAL' };

function truncar(texto, max = 64) {
  const s = String(texto ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function direcaoDeInout(inout) {
  return Number(inout) === 1 ? 'OUT' : 'IN';
}

export class FacialReal {
  // onAccess(evt) -> Promise<{allow, display_msg}> decide o acesso.
  constructor({
    port = Number(process.env.FACIAL_WS_PORT || 3003),
    host = process.env.FACIAL_WS_HOST || '0.0.0.0',
    deviceId,
    onAccess,
    accessTimeoutMs = Number(process.env.FACIAL_ACCESS_TIMEOUT_MS || 4000),
    commandTimeoutMs = Number(process.env.FACIAL_CMD_TIMEOUT_MS || 15000),
    scoreConfiavel = Number(process.env.FACIAL_SCORE || 1),
    log = console.log,
  } = {}) {
    this.port = port;
    this.host = host;
    this.deviceId = deviceId;
    this.onAccess = onAccess;
    this.accessTimeoutMs = accessTimeoutMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.scoreConfiavel = scoreConfiavel;
    this.log = log;
    this.server = null;
    this.leitor = null;
    this.sn = null;
    this.pendentes = [];
  }

  async start() {
    this.server = new WsServer({ port: this.port, host: this.host, heartbeatMs: 30000 });
    this.server.on('conexao', (conn, req) => this._conectar(conn, req));
    this.port = await this.server.listen();
    this.log(`[facial] WebSocket ouvindo em ${this.host}:${this.port}`);
    return this.port;
  }

  async stop() {
    this._rejeitarPendentes(new Error('leitor facial desligado'));
    if (this.server) await this.server.close();
    this.server = null;
    this.leitor = null;
  }

  get conectado() {
    return Boolean(this.leitor && this.leitor.aberto);
  }

  // Envia um comando (`buildSetUserinfo`, `buildDeleteUser`, ...) e espera o
  // `ret` correspondente. Rejeita se o leitor não estiver conectado.
  enviarComando(cmd, { timeoutMs = this.commandTimeoutMs } = {}) {
    if (!this.conectado) return Promise.reject(new Error('leitor facial desconectado'));
    if (!cmd || typeof cmd !== 'object' || !cmd.cmd) {
      return Promise.reject(new Error('comando facial inválido'));
    }
    return new Promise((resolve, reject) => {
      const pendente = { cmd: cmd.cmd, resolve, reject, timer: null };
      pendente.timer = setTimeout(() => {
        this.pendentes = this.pendentes.filter((p) => p !== pendente);
        reject(new Error(`timeout no comando ${cmd.cmd}`));
      }, timeoutMs);
      pendente.timer.unref?.();
      this.pendentes.push(pendente);
      if (!this.leitor.send(cmd)) {
        clearTimeout(pendente.timer);
        this.pendentes = this.pendentes.filter((p) => p !== pendente);
        reject(new Error('falha ao enviar comando ao leitor'));
      }
    });
  }

  _conectar(conn, req) {
    this.leitor = conn;
    this.log(`[facial] leitor conectado de ${req?.socket?.remoteAddress || conn.remote}`);
    conn.on('mensagem', (texto, json) => this._mensagem(conn, texto, json));
    conn.on('erro', (e) => this.log('[facial] erro de conexão:', e?.message || e));
    conn.on('close', () => {
      if (this.leitor !== conn) return;
      this.leitor = null;
      this.sn = null;
      this._rejeitarPendentes(new Error('leitor facial desconectado'));
      this.log('[facial] leitor desconectado');
    });
  }

  async _mensagem(conn, texto, json) {
    if (!json) {
      this.log('[facial] mensagem não-JSON ignorada');
      return;
    }

    if (json.ret) return this._ack(json);

    if (json.cmd === 'reg') {
      if (json.sn) this.sn = String(json.sn);
      conn.send(buildRegAnswer());
      this.log(`[facial] registrado sn=${this.sn || '?'}`);
      // Coloca o leitor em modo online (a decisão é nossa).
      conn.send(buildSetDevinfo({ server_verify: 1 }));
      return;
    }

    if (json.cmd === 'sendlog') {
      const msg = parseReaderMessage(json);
      if (msg.tipo !== 'ACESSO') {
        // record vazio: nunca deixar o leitor sem resposta.
        conn.send(buildAccessAnswer({ access: false, message: 'Evento sem identificação.' }));
        return;
      }
      const decisao = await this._decidir(msg, json);
      conn.send(buildAccessAnswer({
        access: decisao.allow === true,
        message: truncar(decisao.display_msg || (decisao.allow ? 'Acesso liberado.' : 'Acesso negado.')),
      }));
      return;
    }

    if (json.cmd === 'senduser') {
      // Cadastro feito no próprio leitor; por enquanto só confirmamos.
      conn.send({ ret: 'senduser', result: true });
      this.log(`[facial] cadastro local recebido enrollid=${json.enrollid}`);
      return;
    }

    this.log(`[facial] comando não tratado: ${json.cmd || texto.slice(0, 40)}`);
  }

  async _decidir(msg, bruto) {
    // O leitor só manda `sendlog` de rosto cadastrado depois de reconhecer a
    // pessoa; para o motor da API isso equivale a score máximo. Se o firmware
    // enviar um score real em `score`, ele prevalece.
    const score = Number.isFinite(Number(msg.score)) ? Number(msg.score) : this.scoreConfiavel;
    const evt = {
      device_id: this.deviceId,
      person_id: String(msg.enrollid),
      metodo: METODO_MODE[Number(msg.mode)] || 'FACIAL',
      score,
      direcao: direcaoDeInout(msg.inout),
      timestamp: msg.time,
      logindex: msg.logindex,
    };
    if (msg.desconhecido) {
      return { allow: false, motivo: 'PESSOA_NAO_ENCONTRADA', display_msg: 'Rosto não cadastrado.' };
    }
    if (!this.onAccess) return { allow: false, motivo: 'SEM_MOTOR', display_msg: 'Sistema indisponível.' };
    try {
      const decisao = await this._comTimeout(
        this.onAccess(evt, bruto),
        this.accessTimeoutMs,
        { allow: false, motivo: 'TIMEOUT', display_msg: 'Sistema indisponível.' },
      );
      return decisao || { allow: false, motivo: 'SEM_RESPOSTA', display_msg: 'Acesso negado.' };
    } catch (e) {
      this.log('[facial] falha ao decidir:', e.message);
      return { allow: false, motivo: 'API_OFFLINE', display_msg: 'Sistema indisponível.' };
    }
  }

  // Resolve a promessa ou devolve o fallback após `ms` (sem deixar timer solto).
  _comTimeout(promessa, ms, fallback) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(fallback), ms);
      timer.unref?.();
      promessa.then(
        (valor) => { clearTimeout(timer); resolve(valor); },
        (erro) => { clearTimeout(timer); reject(erro); },
      );
    });
  }

  _ack(json) {
    const idx = this.pendentes.findIndex((p) => p.cmd === json.ret);
    if (idx < 0) return;
    const [pendente] = this.pendentes.splice(idx, 1);
    clearTimeout(pendente.timer);
    if (json.result === false) {
      pendente.reject(new Error(`leitor recusou ${json.ret}`));
      return;
    }
    pendente.resolve({ ok: true, ...json });
  }

  _rejeitarPendentes(erro) {
    for (const pendente of this.pendentes) {
      clearTimeout(pendente.timer);
      pendente.reject(erro);
    }
    this.pendentes = [];
  }
}
