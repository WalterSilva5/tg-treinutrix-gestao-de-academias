// Servidor WebSocket mínimo (RFC 6455) sem dependências.
// O leitor facial é o CLIENTE: ele conecta neste servidor. Implementamos só o
// subconjunto necessário (texto, ping/pong, close) para não puxar biblioteca.
import http from 'node:http';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 4 * 1024 * 1024; // foto 150KB em base64 + margem
const TEXT = 0x1;
const BINARY = 0x2;
const CLOSE = 0x8;
const PING = 0x9;
const PONG = 0xa;

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

export class WsConnection extends EventEmitter {
  constructor(socket, { remote = '', maxPayload = MAX_PAYLOAD } = {}) {
    super();
    this.socket = socket;
    this.remote = remote;
    this.maxPayload = maxPayload;
    this.aberto = true;
    this.isAlive = true;
    this.buf = Buffer.alloc(0);
    this.fragOpcode = null;
    this.frags = [];
    this.fragLen = 0;

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', (e) => this._encerrar('error', e));
    socket.on('close', () => this._encerrar('close'));
  }

  send(value) {
    if (!this.aberto) return false;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    this._write(TEXT, Buffer.from(text, 'utf8'));
    return true;
  }

  sendBinary(buf) {
    if (!this.aberto) return false;
    this._write(BINARY, Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    return true;
  }

  ping() {
    this._write(PING, Buffer.alloc(0));
  }

  close(code = 1000, motivo = '') {
    if (!this.aberto) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(motivo));
    payload.writeUInt16BE(code, 0);
    payload.write(motivo, 2);
    this._write(CLOSE, payload);
    this.socket.end();
  }

  terminate() {
    this.socket.destroy();
  }

  _write(opcode, payload) {
    if (!this.aberto || !this.socket.writable) return;
    try {
      this.socket.write(encodeFrame(opcode, payload));
    } catch (e) {
      this._encerrar('error', e);
    }
  }

  _encerrar(evento, arg) {
    if (!this.aberto) return;
    this.aberto = false;
    this.emit('fechar', arg);
    this.emit(evento === 'error' ? 'erro' : 'close', arg);
  }

  _falha(codigo, motivo) {
    this.close(codigo, motivo);
    this._encerrar('error', new Error(motivo));
  }

  _onData(chunk) {
    if (!this.aberto) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;

    while (this.aberto) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const opcode = b0 & 0x0f;
      const mascarado = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (rsv !== 0) return this._falha(1002, 'extensão não suportada');
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) return this._falha(1009, 'mensagem grande');
        len = Number(big);
        offset = 10;
      }
      if (len > this.maxPayload) return this._falha(1009, 'mensagem grande');

      const controle = opcode >= CLOSE;
      if (controle && (!fin || len > 125)) return this._falha(1002, 'frame de controle inválido');
      if (!mascarado) return this._falha(1002, 'cliente deve mascarar os frames');

      const total = offset + 4 + len;
      if (this.buf.length < total) return;

      const mascara = this.buf.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(this.buf.subarray(offset, offset + len));
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mascara[i % 4];
      this.buf = this.buf.subarray(total);

      if (opcode === CLOSE) {
        this.close(1000);
        return this.socket.end();
      }
      if (opcode === PING) { this._write(PONG, payload); continue; }
      if (opcode === PONG) { this.isAlive = true; continue; }

      if (opcode === TEXT || opcode === BINARY) {
        if (this.fragOpcode) return this._falha(1002, 'fragmentação inválida');
        if (fin) this._entregar(opcode, payload);
        else { this.fragOpcode = opcode; this.frags = [payload]; this.fragLen = len; }
        continue;
      }
      if (opcode === 0x0) {
        if (!this.fragOpcode) return this._falha(1002, 'continuação sem início');
        this.fragLen += len;
        if (this.fragLen > this.maxPayload) return this._falha(1009, 'mensagem grande');
        this.frags.push(payload);
        if (fin) {
          const completo = Buffer.concat(this.frags);
          const tipo = this.fragOpcode;
          this.fragOpcode = null;
          this.frags = [];
          this.fragLen = 0;
          this._entregar(tipo, completo);
        }
        continue;
      }
      return this._falha(1002, `opcode ${opcode} não suportado`);
    }
  }

  _entregar(opcode, payload) {
    this.isAlive = true;
    if (opcode === BINARY) {
      this.emit('binario', payload);
      return;
    }
    const texto = payload.toString('utf8');
    let json = null;
    try { json = JSON.parse(texto); } catch { /* mensagem não-JSON */ }
    this.emit('mensagem', texto, json);
  }
}

export class WsServer extends EventEmitter {
  constructor({ port = 0, host = '0.0.0.0', path = null, maxPayload = MAX_PAYLOAD, heartbeatMs = 30000 } = {}) {
    super();
    this.port = Number(port);
    this.host = host;
    this.path = path;
    this.maxPayload = maxPayload;
    this.heartbeatMs = heartbeatMs;
    this.conexoes = new Set();
    this.heartbeat = null;
    this.http = http.createServer((req, res) => {
      res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8', Upgrade: 'websocket' });
      res.end('Este endereço fala WebSocket.\n');
    });
    this.http.on('upgrade', (req, socket) => this._upgrade(req, socket));
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.port, this.host, () => {
        this.http.off('error', reject);
        this.port = this.http.address().port;
        if (this.heartbeatMs > 0) {
          this.heartbeat = setInterval(() => this._checarVivos(), this.heartbeatMs);
          this.heartbeat.unref();
        }
        resolve(this.port);
      });
    });
  }

  async close() {
    clearInterval(this.heartbeat);
    for (const conn of this.conexoes) conn.terminate();
    this.conexoes.clear();
    await new Promise((resolve) => this.http.close(resolve));
  }

  get conexoesAtivas() {
    return this.conexoes.size;
  }

  _checarVivos() {
    for (const conn of this.conexoes) {
      if (!conn.isAlive) { conn.terminate(); this.conexoes.delete(conn); continue; }
      conn.isAlive = false;
      conn.ping();
    }
  }

  _upgrade(req, socket) {
    const caminho = (req.url || '/').split('?')[0];
    if (this.path && caminho !== this.path) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    const chave = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (upgrade !== 'websocket' || !chave) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const aceite = crypto.createHash('sha1').update(chave + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${aceite}\r\n\r\n`
    );

    const conn = new WsConnection(socket, { remote: socket.remoteAddress || '', maxPayload: this.maxPayload });
    this.conexoes.add(conn);
    conn.on('close', () => this.conexoes.delete(conn));
    this.emit('conexao', conn, req);
  }
}
