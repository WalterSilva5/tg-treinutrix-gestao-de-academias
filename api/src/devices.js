// Catálogo de catracas/controladores suportados e validação de cadastro.
// O driver é o contrato de integração; a marca/modelo é só apresentação.

export const DRIVERS = {
  topdata_easyinner: {
    nome: 'Topdata EasyInner (DLL)',
    fabricante: 'Topdata',
    modelos: ['Fit 4', 'Revolution 4', 'Box 4', 'PNE 4'],
    requisitos: 'Windows + EasyInner.dll (Portal do Integrador)',
    transporte: 'TCP/IP + DLL',
    facial: 'Leitor facial integrado ou via SDK Facial (WebSocket)',
  },
  topdata_facial_ws: {
    nome: 'Topdata Leitor Facial (WebSocket)',
    fabricante: 'Topdata',
    modelos: ['Leitor Facial F4', 'T4', 'T4-50k'],
    requisitos: 'Windows ou Linux; servidor WebSocket',
    transporte: 'WebSocket',
    facial: 'Cadastro de fotos e evento de reconhecimento',
  },
  generic_http: {
    nome: 'Controlador HTTP genérico',
    fabricante: 'Compatível',
    modelos: ['Relé TCP/HTTP', 'Controlador de acesso HTTP', 'Porta giratória com API'],
    requisitos: 'Endpoint HTTP na rede local',
    transporte: 'HTTP (POST /open)',
    facial: 'Qualquer leitor que envie o identificador ao controlador',
  },
  simulator: {
    nome: 'Simulador (sem hardware)',
    fabricante: '—',
    modelos: ['Ambiente de testes'],
    requisitos: 'Nenhum',
    transporte: 'Local',
    facial: 'Evento simulado',
  },
};

export const DRIVER_PADRAO = 'topdata_easyinner';

export function driverValido(driver) {
  return Object.hasOwn(DRIVERS, driver);
}

export function catalogo() {
  return Object.entries(DRIVERS).map(([id, d]) => ({ id, ...d }));
}

// Valida e normaliza o cadastro de uma catraca/controlador.
export function normalizarDevice(input) {
  const driver = String(input.driver || DRIVER_PADRAO);
  if (!driverValido(driver)) return { ok: false, error: 'driver não suportado' };
  const nome = String(input.nome || '').trim();
  if (!nome) return { ok: false, error: 'nome é obrigatório' };
  const modelo = String(input.modelo || DRIVERS[driver].modelos[0]).trim();
  const ip = String(input.ip || '').trim();
  const porta = Number(input.porta) || (driver === 'generic_http' ? 80 : 3570);
  if (driver !== 'simulator' && !ip) return { ok: false, error: 'informe o IP do equipamento' };
  const endpoint = input.endpoint
    ? String(input.endpoint).trim()
    : (driver === 'generic_http' ? `http://${ip}:${porta}/open` : null);
  return {
    ok: true,
    device: {
      nome, driver, modelo,
      fabricante: String(input.fabricante || DRIVERS[driver].fabricante).trim(),
      ip: ip || '127.0.0.1',
      porta,
      endpoint,
    },
  };
}
