// Cliente WebSocket mínimo para os testes: faz o handshake e fala frames
// mascarados como um leitor real faria.
import net from 'node:net';
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function mascara(payload) {
  const chave = crypto.randomBytes(4);
  const out = Buffer.from(payload);
  for (let i = 0; i < out.length; i += 1) out[i] ^= chave[i % 4];
  return { chave, out };
}

function frame(opcode, payload, { fin = true } = {}) {
  const { chave, out } = mascara(payload);
  const len = out.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = (fin ? 0x80 : 0) | opcode;
  return Buffer.concat([header, chave, out]);
}

export async function conectar(port, { host = '127.0.0.1', path = '/', key = null } = {}) {
  const socket = net.createConnection({ host, port });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  const chave = key || crypto.randomBytes(16).toString('base64');
  socket.write(
    `GET ${path} HTTP/1.1\r\n`
    + `Host: ${host}:${port}\r\n`
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Key: ${chave}\r\n`
    + 'Sec-WebSocket-Version: 13\r\n\r\n'
  );

  let buf = Buffer.alloc(0);
  const mensagens = [];
  const esperando = [];
  const binarios = [];
  let fechado = false;

  const entregar = (msg) => {
    mensagens.push(msg);
    for (let i = esperando.length - 1; i >= 0; i -= 1) {
      const w = esperando[i];
      let ok = false;
      try { ok = w.predicado(msg); } catch { ok = false; }
      if (ok) { esperando.splice(i, 1); clearTimeout(w.timer); w.resolve(msg); }
    }
  };

  function consumir() {
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      if (buf.length < offset + len) return;
      const payload = Buffer.from(buf.subarray(offset, offset + len));
      buf = buf.subarray(offset + len);
      if (opcode === 0x1 && fin) {
        let json = null;
        const texto = payload.toString('utf8');
        try { json = JSON.parse(texto); } catch { /* não-JSON */ }
        entregar({ texto, json });
      } else if (opcode === 0x2) {
        binarios.push(payload);
      } else if (opcode === 0x9) {
        socket.write(frame(0xa, payload));
      }
    }
  }

  const handshake = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout no handshake')), 3000);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const fim = buf.indexOf('\r\n\r\n');
      if (fim < 0) return;
      const cabecalho = buf.subarray(0, fim).toString('latin1');
      buf = buf.subarray(fim + 4);
      socket.off('data', onData);
      clearTimeout(timer);
      const status = Number((/^HTTP\/1\.1 (\d+)/.exec(cabecalho) || [])[1]);
      const aceite = (/sec-websocket-accept:\s*(\S+)/i.exec(cabecalho) || [])[1];
      const esperado = crypto.createHash('sha1').update(chave + GUID).digest('base64');
      if (status !== 101 || aceite !== esperado) {
        reject(new Error(`handshake recusado (status ${status})`));
        return;
      }
      socket.on('data', (c) => { buf = Buffer.concat([buf, c]); consumir(); });
      consumir();
      resolve();
    };
    socket.on('data', onData);
    socket.on('error', reject);
  });

  await handshake;

  return {
    socket,
    mensagens,
    binarios,
    enviar(valor) { socket.write(frame(0x1, Buffer.from(typeof valor === 'string' ? valor : JSON.stringify(valor)))); },
    enviarFragmentado(partes) {
      partes.forEach((p, i) => {
        const opcode = i === 0 ? 0x1 : 0x0;
        socket.write(frame(opcode, Buffer.from(p), { fin: i === partes.length - 1 }));
      });
    },
    enviarBruto(buffer) { socket.write(buffer); },
    fechar() { socket.destroy(); fechado = true; },
    get fechado() { return fechado; },
    esperar(predicado, { timeoutMs = 3000, desde = 0 } = {}) {
      for (let i = desde; i < mensagens.length; i += 1) {
        if (predicado(mensagens[i])) return Promise.resolve(mensagens[i]);
      }
      return new Promise((resolve, reject) => {
        const w = { predicado, resolve };
        w.timer = setTimeout(() => {
          const idx = esperando.indexOf(w);
          if (idx >= 0) esperando.splice(idx, 1);
          reject(new Error('timeout esperando mensagem'));
        }, timeoutMs);
        esperando.push(w);
      });
    },
  };
}
