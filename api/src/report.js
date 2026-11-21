// Exportação de eventos em CSV e PDF, sem dependências.
// PDF mínimo (A4, Helvetica/WinAnsi) gerado à mão: suficiente para listas de
// presença/inscrição impressas na recepção.
import { parseDate } from './time.js';

const A4 = { largura: 595, altura: 842, margem: 42 };
const MAX_CHARS = 92;

function limparArquivo(nome) {
  return String(nome || 'evento')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'evento';
}

export function nomeArquivoEvento(evento, extensao) {
  return `evento-${limparArquivo(evento && evento.nome)}.${extensao}`;
}

function csvCelula(valor) {
  const s = String(valor ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvTabela(headers, linhas) {
  return `\uFEFF${[headers, ...linhas].map((l) => l.map(csvCelula).join(';')).join('\r\n')}\r\n`;
}

export function eventoParaCsv(evento, participantes) {
  const linhas = [
    ['Nome', 'Tipo', 'Matrícula', 'Documento', 'Contato', 'Status', 'Código', 'Pago', 'Valor pago', 'Check-in', 'Inscrito em'],
    ...participantes.map((p) => [
      p.nome, p.tipo || '', p.matricula || '', p.documento || '', p.contato || '',
      p.status || 'INSCRITO', p.codigo || '', p.pago ? 'sim' : 'não',
      Number(p.valorPago || 0).toFixed(2).replace('.', ','),
      p.checkinAt ? new Date(p.checkinAt).toLocaleString('pt-BR') : '',
      p.criadoEm ? new Date(p.criadoEm).toLocaleString('pt-BR') : '',
    ]),
  ];
  return `\uFEFF${linhas.map((l) => l.map(csvCelula).join(';')).join('\r\n')}\r\n`;
}

// ---------- PDF ----------
const ACENTOS = {
  '—': '-', '–': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...', '•': '-',
};

function winAnsi(texto) {
  let out = '';
  for (const ch of String(texto ?? '')) {
    const code = ch.codePointAt(0);
    if (ch === '\n' || ch === '\r') { out += ' '; continue; }
    if (code <= 255) { out += ch; continue; }
    out += ACENTOS[ch] ?? '?';
  }
  return out;
}

function escaparPdf(texto) {
  return winAnsi(texto).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function quebrar(texto, max = MAX_CHARS) {
  const palavras = String(texto ?? '').split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (const palavra of palavras) {
    if (!atual) { atual = palavra; continue; }
    if (`${atual} ${palavra}`.length <= max) atual += ` ${palavra}`;
    else { linhas.push(atual); atual = palavra; }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

function formatarData(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pt-BR');
}

export function eventoParaPdf(evento, participantes, { geradoEm = new Date() } = {}) {  const paginas = [];
  let pagina = [];
  let y = A4.altura - A4.margem;

  const novaPagina = (continuacao = false) => {
    pagina = [];
    paginas.push(pagina);
    y = A4.altura - A4.margem;
    if (continuacao) {
      pagina.push(`BT /F2 11 Tf ${A4.margem} ${y} Td (${escaparPdf(`${evento.nome} - continuacao`)}) Tj ET`);
      y -= 24;
    }
  };
  const escrever = (texto, { size = 10, bold = false, x = A4.margem, espaco = 14 } = {}) => {
    if (y < A4.margem + 30) novaPagina(true);
    pagina.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${escaparPdf(texto)}) Tj ET`);
    y -= espaco;
  };
  const paragrafo = (texto, opts = {}) => {
    for (const linha of quebrar(texto, opts.max ?? MAX_CHARS)) escrever(linha, opts);
  };

  novaPagina(false);
  escrever(evento.nome || 'Evento', { size: 18, bold: true, espaco: 24 });
  paragrafo(`Data: ${formatarData(evento.inicio)}${evento.fim ? ` a ${formatarData(evento.fim)}` : ''}`, { size: 10 });
  if (evento.local) paragrafo(`Local: ${evento.local}`);
  paragrafo(`Participantes: ${participantes.length}${evento.capacidade ? ` de ${evento.capacidade}` : ''}`
    + `  |  Gerado em: ${geradoEm.toLocaleString('pt-BR')}`, { size: 9 });
  if (evento.descricao) { y -= 4; paragrafo(evento.descricao, { size: 9, max: 100 }); }
  y -= 10;
  escrever('Lista de participantes', { size: 13, bold: true, espaco: 20 });
  escrever('Nº  Nome / tipo / matrícula / contato                  Status', { size: 9, bold: true, espaco: 16 });

  if (participantes.length === 0) {
    escrever('Nenhum participante inscrito.', { size: 10 });
  }
  participantes.forEach((p, i) => {
    const detalhe = [
      p.nome,
      p.tipo || '',
      p.matricula ? `mat. ${p.matricula}` : '',
      p.documento ? `doc. ${p.documento}` : '',
      p.contato || '',
      p.status || 'INSCRITO',
      p.codigo ? `cod. ${p.codigo}` : '',
      p.pago ? `pago R$ ${Number(p.valorPago || 0).toFixed(2).replace('.', ',')}` : '',
      p.checkinAt ? `check-in ${formatarData(p.checkinAt)}` : '',
    ].filter(Boolean).join(' - ');
    paragrafo(`${String(i + 1).padStart(3, '0')}  ${detalhe}`, { size: 9, max: 96, espaco: 13 });
  });

  // Rodapé com número da página em cada página.
  paginas.forEach((linhas, i) => {
    linhas.push(`BT /F1 8 Tf ${A4.largura - A4.margem - 60} ${A4.margem - 16} Td (Pagina ${i + 1} de ${paginas.length}) Tj ET`);
  });

  return montarPdf(paginas);
}

function montarPdf(paginas) {  const n = paginas.length;
  const idPagina = (i) => 5 + i;
  const idConteudo = (i) => 5 + n + i;
  const objetos = [];

  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[2] = `<< /Type /Pages /Kids [${paginas.map((_, i) => `${idPagina(i)} 0 R`).join(' ')}] /Count ${n} >>`;
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objetos[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  paginas.forEach((linhas, i) => {
    objetos[idPagina(i)] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.largura} ${A4.altura}] `
      + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idConteudo(i)} 0 R >>`;
    const stream = `${linhas.join('\n')}\n`;
    objetos[idConteudo(i)] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`;
  });

  const partes = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let offset = partes[0].length;
  for (let i = 1; i < objetos.length; i += 1) {
    if (!objetos[i]) continue;
    offsets[i] = offset;
    const corpo = Buffer.from(`${i} 0 obj\n${objetos[i]}\nendobj\n`, 'latin1');
    partes.push(corpo);
    offset += corpo.length;
  }
  const xref = [`xref\n0 ${objetos.length}\n`, '0000000000 65535 f \n'];
  for (let i = 1; i < objetos.length; i += 1) {
    xref.push(`${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`);
  }
  const rodape = `trailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  partes.push(Buffer.from(xref.join('') + rodape, 'latin1'));
  return Buffer.concat(partes);
}

// ---------- relatório de vários eventos ----------
export function eventosParaCsv(eventos) {
  const linhas = [
    ['Evento', 'Início', 'Local', 'Capacidade', 'Inscritos', 'Presentes', 'Espera', 'Receita', 'Situação'],
    ...eventos.map((e) => [
      e.nome, e.inicio ? new Date(e.inicio).toLocaleString('pt-BR') : '', e.local || '',
      e.capacidade || '', e.inscritos ?? 0, e.presentes ?? 0, e.espera ?? 0,
      Number(e.receita || 0).toFixed(2).replace('.', ','),
      e.ativo === false ? 'CANCELADO' : e.inscricoesAbertas === false ? 'INSCRIÇÕES FECHADAS' : 'ATIVO',
    ]),
  ];
  return `\uFEFF${linhas.map((l) => l.map(csvCelula).join(';')).join('\r\n')}\r\n`;
}

function pdfDeLinhas(titulo, subtitulo, linhas, { geradoEm = new Date() } = {}) {
  const paginas = [];
  let pagina = [];
  let y = A4.altura - A4.margem;
  const novaPagina = (continuacao = false) => {
    pagina = [];
    paginas.push(pagina);
    y = A4.altura - A4.margem;
    if (continuacao) {
      pagina.push(`BT /F2 11 Tf ${A4.margem} ${y} Td (${escaparPdf(`${titulo} - continuacao`)}) Tj ET`);
      y -= 24;
    }
  };
  const escrever = (texto, { size = 10, bold = false, espaco = 14 } = {}) => {
    if (y < A4.margem + 30) novaPagina(true);
    pagina.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${A4.margem} ${y} Td (${escaparPdf(texto)}) Tj ET`);
    y -= espaco;
  };
  novaPagina(false);
  escrever(titulo, { size: 18, bold: true, espaco: 24 });
  if (subtitulo) escrever(subtitulo, { size: 10, espaco: 18 });
  escrever(`Gerado em: ${geradoEm.toLocaleString('pt-BR')}`, { size: 9, espaco: 20 });
  for (const linha of linhas) {
    for (const pedaco of quebrar(linha, 96)) escrever(pedaco, { size: 9, espaco: 13 });
  }
  paginas.forEach((p, i) => {
    p.push(`BT /F1 8 Tf ${A4.largura - A4.margem - 60} ${A4.margem - 16} Td (Pagina ${i + 1} de ${paginas.length}) Tj ET`);
  });
  return montarPdf(paginas);
}

export function sorteioParaCsv(sorteio) {
  const vencedores = Array.isArray(sorteio.vencedores) && sorteio.vencedores.length
    ? sorteio.vencedores : (sorteio.vencedor ? [sorteio.vencedor] : []);
  const linhas = [
    ['Sorteio', 'Prêmio', 'Ganhador', 'Matrícula', 'Entradas', 'Sorteado em', 'Entregue', 'Por'],
    ...vencedores.map((v) => [
      sorteio.nome, sorteio.premio || '', v.nome, v.matricula || '', v.entradas ?? '',
      v.sorteadoEm ? new Date(v.sorteadoEm).toLocaleString('pt-BR') : '',
      v.entrega && v.entrega.entregue ? 'sim' : 'não', v.entrega?.por || '',
    ]),
  ];
  return `\uFEFF${linhas.map((l) => l.map(csvCelula).join(';')).join('\r\n')}\r\n`;
}

export function sorteioParaPdf(sorteio, { geradoEm = new Date() } = {}) {
  const vencedores = Array.isArray(sorteio.vencedores) && sorteio.vencedores.length
    ? sorteio.vencedores : (sorteio.vencedor ? [sorteio.vencedor] : []);
  const linhas = [
    `Sorteio: ${sorteio.nome}`,
    `Prêmio: ${sorteio.premio || 'não informado'}`,
    `Status: ${sorteio.status}${sorteio.sorteadoEm ? ` em ${new Date(sorteio.sorteadoEm).toLocaleString('pt-BR')}` : ''}`,
    `Participantes elegíveis: ${sorteio.totalParticipantes ?? '-'} · entradas: ${sorteio.totalEntradas ?? '-'}`,
    '',
    'Ganhadores:',
    ...vencedores.map((v, i) => `${i + 1}. ${v.nome}${v.matricula ? ` (${v.matricula})` : ''}`
      + ` - ${v.entradas} entrada(s)` + (v.entrega?.entregue ? ' - prêmio entregue' : ' - pendente de entrega')),
  ];
  return pdfDeLinhas('Resultado do sorteio', sorteio.nome, linhas, { geradoEm });
}

export function eventosParaPdf(eventos, { inicio, fim, geradoEm = new Date() } = {}) {
  const de = inicio ? parseDate(inicio) : null;
  const ate = fim ? parseDate(fim, { endOfDay: true }) : null;
  const periodo = de || ate
    ? `Período: ${de ? de.toLocaleDateString('pt-BR') : 'início'} a ${ate ? ate.toLocaleDateString('pt-BR') : 'hoje'}`
    : 'Todos os eventos';
  const linhas = eventos.map((e, i) => {
    const data = e.inicio ? new Date(e.inicio).toLocaleString('pt-BR') : '-';
    return `${String(i + 1).padStart(3, '0')}  ${e.nome} - ${data} - ${e.local || 'sem local'}`
      + ` - ${e.inscritos ?? 0} inscrito(s), ${e.presentes ?? 0} presente(s), ${e.espera ?? 0} na espera`;
  });
  return pdfDeLinhas('Relatório de eventos', periodo, linhas, { geradoEm });
}
