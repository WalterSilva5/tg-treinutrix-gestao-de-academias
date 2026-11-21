// Relatórios agregados por período. Função pura sobre o store.
import { parseDate, localDayKey } from './time.js';

export function relatorioGeral(store, { inicio, fim, agora = new Date() } = {}) {
  const ate = fim ? parseDate(fim, { endOfDay: true }) : agora;
  const de = inicio ? parseDate(inicio) : new Date(ate.getTime() - 30 * 24 * 3600 * 1000);
  const dentro = (iso) => {
    const d = new Date(iso);
    return !Number.isNaN(d.getTime()) && d >= de && d <= ate;
  };

  const eventos = (store.events || []).filter((e) => dentro(e.timestamp));
  const allow = eventos.filter((e) => e.decisao === 'ALLOW');
  const deny = eventos.filter((e) => e.decisao === 'DENY');

  const porDia = new Map();
  const porHora = Array.from({ length: 24 }, () => ({ total: 0, liberados: 0, negados: 0 }));
  const pessoas = new Map();
  for (const e of eventos) {
    const dia = localDayKey(new Date(e.timestamp));
    const d = porDia.get(dia) || { dia, total: 0, liberados: 0, negados: 0, pessoas: new Set() };
    d.total += 1;
    if (e.decisao === 'ALLOW') d.liberados += 1;
    if (e.decisao === 'DENY') d.negados += 1;
    if (e.personId) d.pessoas.add(e.personId);
    porDia.set(dia, d);
    const hora = new Date(e.timestamp).getHours();
    porHora[hora].total += 1;
    if (e.decisao === 'ALLOW') porHora[hora].liberados += 1;
    if (e.decisao === 'DENY') porHora[hora].negados += 1;
    if (e.personId && e.decisao === 'ALLOW') {
      const p = store.persons.get(e.personId);
      const atual = pessoas.get(e.personId) || { personId: e.personId, nome: p?.nome || e.personId, matricula: p?.matricula || '', acessos: 0, dias: new Set() };
      atual.acessos += 1;
      atual.dias.add(dia);
      pessoas.set(e.personId, atual);
    }
  }

  const porDiaLista = [...porDia.values()]
    .map((d) => ({ ...d, pessoas: d.pessoas.size }))
    .sort((a, b) => a.dia.localeCompare(b.dia));

  const topPessoas = [...pessoas.values()]
    .map((p) => ({ ...p, dias: p.dias.size }))
    .sort((a, b) => b.acessos - a.acessos || a.nome.localeCompare(b.nome))
    .slice(0, 10);

  const novos = [...store.persons.values()].filter((p) => dentro(p.criadoEm));
  const inadimplentes = [...store.persons.values()].filter((p) => {
    if ((p.tipo || 'ALUNO') !== 'ALUNO' || p.ativo === false) return false;
    const v = parseDate(p.validadeFim, { endOfDay: true });
    return Boolean(v) && v < ate;
  });

  const eventosSociais = (store.socialEvents || [])
    .filter((e) => dentro(e.inicio))
    .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
    .map((e) => {
      const ps = (store.eventParticipants || []).filter((p) => p.eventId === e.id && p.status !== 'CANCELADO');
      return {
        id: e.id, nome: e.nome, inicio: e.inicio, local: e.local || '',
        inscritos: ps.filter((p) => p.status !== 'ESPERA').length,
        presentes: ps.filter((p) => p.status === 'PRESENTE').length,
        espera: ps.filter((p) => p.status === 'ESPERA').length,
        receita: ps.reduce((s, p) => s + Number(p.valorPago || 0), 0),
      };
    });

  const sorteios = (store.raffleDraws || [])
    .filter((d) => dentro(d.sorteadoEm))
    .map((d) => ({
      id: d.id, nome: d.raffleNome, premio: d.premio || '', sorteadoEm: d.sorteadoEm,
      automatico: Boolean(d.automatico), por: d.por || '',
      vencedores: (d.vencedores || []).map((v) => v.nome),
      participantes: d.totalParticipantes || 0,
    }));

  return {
    periodo: { inicio: de.toISOString(), fim: ate.toISOString() },
    kpis: {
      eventos: eventos.length,
      liberados: allow.length,
      negados: deny.length,
      pessoasUnicas: new Set(eventos.map((e) => e.personId).filter(Boolean)).size,
      novos: novos.length,
      inadimplentes: inadimplentes.length,
      eventosSociais: eventosSociais.length,
      sorteios: sorteios.length,
    },
    porDia: porDiaLista,
    porHora,
    topPessoas,
    novos: novos.map((p) => ({ id: p.id, nome: p.nome, matricula: p.matricula, criadoEm: p.criadoEm })),
    inadimplentes: inadimplentes.map((p) => ({ id: p.id, nome: p.nome, matricula: p.matricula, validadeFim: p.validadeFim })),
    eventosSociais,
    sorteios,
  };
}
