// Lista de risco de evasão para a recepção trabalhar.
import { parseDate, localDayKey } from './time.js';
import { planosAtivos } from './plans.js';

export function riscosRetencao(store, {
  agora = new Date(), diasSemVisita = 14, diasVencimento = 7, diasNovato = 14,
} = {}) {
  const hoje = localDayKey(agora);
  const risco = [];

  for (const p of store.persons.values()) {
    if (p.ativo === false) continue;
    if ((p.tipo || 'ALUNO') !== 'ALUNO') continue;

    const eventos = (store.events || []).filter((e) => e.personId === p.id && e.decisao === 'ALLOW');
    const ultimo = eventos.length ? new Date(eventos[eventos.length - 1].timestamp) : null;
    const dias = ultimo ? Math.floor((agora - ultimo) / (24 * 3600 * 1000)) : null;

    const motivos = [];
    let pontos = 0;
    if (!ultimo) {
      const criado = parseDate(p.criadoEm);
      if (criado && (agora - criado) / (24 * 3600 * 1000) >= diasNovato) {
        motivos.push('nunca frequentou');
        pontos += 35;
      }
    } else if (dias >= diasSemVisita) {
      motivos.push(`sem visitar há ${dias} dia(s)`);
      pontos += Math.min(40, 10 + Math.floor(dias / 5) * 5);
    }

    const validade = parseDate(p.validadeFim, { endOfDay: true });
    let diasParaVencer = null;
    if (validade) {
      diasParaVencer = Math.ceil((validade - agora) / (24 * 3600 * 1000));
      if (diasParaVencer <= diasVencimento) {
        motivos.push(diasParaVencer < 0 ? 'plano vencido' : `plano vence em ${diasParaVencer} dia(s)`);
        pontos += diasParaVencer < 0 ? 30 : 20;
      }
    }

    const planos = planosAtivos(store, p.id, agora);
    if (planos.length === 0 && !validade) {
      motivos.push('sem plano ativo');
      pontos += 15;
    }

    if (pontos >= 20) {
      risco.push({
        personId: p.id, nome: p.nome, matricula: p.matricula, telefone: p.telefone || '',
        ultimaVisita: ultimo ? ultimo.toISOString() : null,
        diasSemVisita: dias,
        validadeFim: p.validadeFim || null,
        diasParaVencer,
        planos: planos.map((x) => x.nome),
        motivos,
        pontos: Math.min(100, pontos),
      });
    }
  }

  risco.sort((a, b) => b.pontos - a.pontos || (b.diasSemVisita || 0) - (a.diasSemVisita || 0));
  return { hoje, total: risco.length, pessoas: risco };
}
