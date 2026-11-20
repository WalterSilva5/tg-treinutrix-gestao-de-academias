// Construtores dos payloads WebSocket do leitor facial.
// Formatos extraídos do exemplo oficial C# (EnviarUsuario, EnviarFoto,
// ExcluirUsuario, ValidaAcesso). Sem dependências, roda em Linux e Windows.
// O transporte WS real (servidor) entra depois; o JSON já é o oficial.

// backupnum: 50 = foto, 0 = todos-sem-foto (record "0")
export function buildSetUserinfo({ enrollid, name, fotoBase64 = null, card = 0, admin = 0, enable = true }) {
  if (fotoBase64) {
    return { cmd: 'setuserinfo', enrollid, name, backupnum: 50, record: fotoBase64, card, admin, enable };
  }
  return { cmd: 'setuserinfo', enrollid, name, backupnum: 0, record: '0', card, admin, enable };
}

export function buildDeleteUser(enrollid) {
  return { cmd: 'deleteuser', enrollid, backupnum: 13 };
}

// Resposta a {"cmd":"sendlog", ...} do leitor.
export function buildAccessAnswer({ sn, access, enrollid, message, date = new Date() }) {
  const pad = (n) => String(n).padStart(2, '0');
  const cloudtime = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return { ret: 'sendlog', result: true, sn, access, enrollid, cloudtime, message };
}

// Parse mínimo de mensagem do leitor (cmd sendlog/senduser/reg).
export function parseReaderMessage(json) {
  if (json.cmd === 'sendlog') {
    const rec = json.record && json.record[0];
    return { tipo: 'ACESSO', sn: json.sn, enrollid: rec?.enrollid, dataHora: rec?.dataHora, online: undefined };
  }
  if (json.cmd === 'senduser') {
    return { tipo: 'USUARIO', backupnum: json.backupnum, enrollid: json.enrollid, name: json.name };
  }
  if (json.cmd === 'reg') {
    return { tipo: 'REGISTRO', sn: json.sn };
  }
  return { tipo: 'DESCONHECIDO', raw: json };
}
