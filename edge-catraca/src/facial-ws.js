// Construtores dos payloads WebSocket do leitor facial.
// Formatos do manual oficial ("Comandos do Leitor Facial" + "Manual WebSocket
// Facial") e do exemplo C#. Sem dependências, roda em Linux e Windows.
// O transporte WS real (servidor) entra depois; o JSON já é o oficial.

// ---- Enums oficiais ----
export const BackupNum = { TodosDados: 0, Senha: 10, Cartao: 11, Foto: 50, Todos: 13 };
export const ModoAutenticacao = { Desconhecido: 1, Senha: 2, Cartao: 3, Facial: 8 };
export const ENROLLID_DESCONHECIDO = 99999999;

// Resposta OBRIGATÓRIA ao {"cmd":"reg"} — sem ela o leitor reenvia reg e a
// comunicação é perdida. cloudtime: "yyyy-MM-dd HH:mm:ss".
export function buildRegAnswer(date = new Date()) {
  return { ret: 'reg', result: true, cloudtime: formatCloudTime(date) };
}

export function formatCloudTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// backupnum: 50 = com foto (record base64), 0 = sem foto (record "0")
export function buildSetUserinfo({ enrollid, name, fotoBase64 = null, card = 0, pwd = 0, admin = 0, enable = true }) {
  if (fotoBase64) {
    return { cmd: 'setuserinfo', enrollid, name, backupnum: BackupNum.Foto, record: fotoBase64, card, pwd, admin, enable };
  }
  return { cmd: 'setuserinfo', enrollid, name, backupnum: BackupNum.TodosDados, record: '0', card, pwd, admin, enable };
}

// backupnum 13 = Todos (conforme exemplo oficial ExcluirUsuario).
export function buildDeleteUser(enrollid) {
  return { cmd: 'deleteuser', enrollid, backupnum: BackupNum.Todos };
}

// server_verify: 0 offline, 1 online, 2 automático. Para este projeto: 1.
export function buildSetDevinfo({ server_verify = 1, ...extra } = {}) {
  return { cmd: 'setdevinfo', server_verify, ...extra };
}

export function buildGetUserList(stn = true) {
  return { cmd: 'getuserlist', stn };
}

export function buildEnableDevice(enable = true) {
  return { cmd: enable ? 'enabledevice' : 'disabledevice' };
}

// Resposta ao {"cmd":"sendlog"} no modo online. Sempre responder, mesmo em
// falha de processamento (access:false), senão a liberação trava.
export function buildAccessAnswer({ access, message, date = new Date() }) {
  return { ret: 'sendlog', result: true, cloudtime: formatCloudTime(date), message, access };
}

// Parse de mensagem do leitor. Formato oficial do sendlog:
// {cmd,sn,count,logindex,record:[{enrollid,name,time,mode,inout,event,image?}]}
export function parseReaderMessage(json) {
  if (json.cmd === 'reg') {
    return { tipo: 'REGISTRO', sn: json.sn, devinfo: json.devinfo };
  }
  if (json.cmd === 'sendlog') {
    const rec = json.record && json.record[0];
    if (!rec) return { tipo: 'ACESSO_VAZIO', sn: json.sn };
    return {
      tipo: 'ACESSO', sn: json.sn, count: json.count, logindex: json.logindex,
      enrollid: rec.enrollid, name: rec.name, time: rec.time,
      mode: rec.mode, inout: rec.inout, event: rec.event, image: rec.image,
      desconhecido: rec.enrollid === ENROLLID_DESCONHECIDO,
    };
  }
  if (json.cmd === 'senduser') {
    return { tipo: 'USUARIO', sn: json.sn, backupnum: json.backupnum, enrollid: json.enrollid, name: json.name };
  }
  return { tipo: 'DESCONHECIDO', raw: json };
}
