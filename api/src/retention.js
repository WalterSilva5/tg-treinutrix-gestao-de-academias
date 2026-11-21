// Política de retenção de dados (LGPD). Função pura: devolve o que deve ser
// removido; o servidor apaga arquivos de foto e persiste.
const DIA = 24 * 3600 * 1000;

export function aplicarRetencao(store, {
  agora = new Date(),
  eventosDias = 365,
  externosDias = 365,
  socialDias = 0,
  fotosDias = 0,
  unknownDias = 0,
} = {}) {
  const corte = (dias) => new Date(agora.getTime() - dias * DIA);
  const resultado = {
    eventosRemovidos: 0, externosAnonimizados: 0, eventosSociaisRemovidos: 0,
    participantesRemovidos: 0, fotosParaRemover: [], rostosParaRemover: [],
  };

  if (eventosDias > 0) {
    const limite = corte(eventosDias);
    const antes = store.events.length;
    store.events = store.events.filter((e) => {
      const d = new Date(e.timestamp);
      return Number.isNaN(d.getTime()) || d >= limite;
    });
    resultado.eventosRemovidos = antes - store.events.length;
  }

  if (externosDias > 0) {
    const limite = corte(externosDias);
    for (const p of store.eventParticipants || []) {
      if (p.personId || p.anonimizadoEm) continue;
      const d = new Date(p.criadoEm || p.checkinAt || 0);
      if (Number.isNaN(d.getTime()) || d >= limite) continue;
      p.nome = 'Participante removido';
      p.contato = '';
      p.documento = '';
      p.anonimizadoEm = agora.toISOString();
      resultado.externosAnonimizados += 1;
    }
  }

  if (socialDias > 0) {
    const limite = corte(socialDias);
    const remover = new Set();
    for (const e of store.socialEvents || []) {
      const fim = new Date(e.fim || e.inicio);
      if (!Number.isNaN(fim.getTime()) && fim < limite) remover.add(e.id);
    }
    if (remover.size > 0) {
      const antes = (store.socialEvents || []).length;
      store.socialEvents = store.socialEvents.filter((e) => !remover.has(e.id));
      const participantesAntes = (store.eventParticipants || []).length;
      store.eventParticipants = store.eventParticipants.filter((p) => !remover.has(p.eventId));
      resultado.eventosSociaisRemovidos = antes - store.socialEvents.length;
      resultado.participantesRemovidos = participantesAntes - store.eventParticipants.length;
    }
  }

  if (fotosDias > 0) {
    const limite = corte(fotosDias);
    for (const p of store.persons.values()) {
      if (p.ativo !== false || !p.foto) continue;
      const quando = new Date(p.foto.updatedAt || p.criadoEm || 0);
      if (!Number.isNaN(quando.getTime()) && quando < limite) {
        resultado.fotosParaRemover.push(p.id);
      }
    }
  }

  if (unknownDias > 0) {
    const limite = corte(unknownDias);
    for (const u of store.unknownFaces || []) {
      const d = new Date(u.at);
      if (!Number.isNaN(d.getTime()) && d < limite) resultado.rostosParaRemover.push(u.id);
    }
  }

  return resultado;
}
