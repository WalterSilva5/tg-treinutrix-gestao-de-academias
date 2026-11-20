// Frequência por DIAS distintos, não por número de passagens.
// O aluno pode entrar e sair várias vezes no mesmo dia; conta como 1 dia.

export function diasFrequentados(events, personId, now = new Date()) {
  const dias = new Set();
  for (const e of events) {
    if (e.personId !== personId) continue;
    if (e.decisao !== 'ALLOW') continue;
    dias.add(String(e.timestamp).slice(0, 10));
  }
  const lista = [...dias].sort();
  const mes = now.toISOString().slice(0, 7);
  const limite30 = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  return {
    personId,
    totalDias: lista.length,
    diasNoMes: lista.filter((d) => d.startsWith(mes)).length,
    ultimos30: lista.filter((d) => d >= limite30).length,
    dias: lista,
  };
}

// Alunos distintos que frequentaram em um dia (para KPIs e gráfico).
export function alunosNoDia(events, diaISO) {
  const set = new Set();
  for (const e of events) {
    if (e.decisao !== 'ALLOW' || !e.personId) continue;
    if (String(e.timestamp).slice(0, 10) === diaISO) set.add(e.personId);
  }
  return set.size;
}
