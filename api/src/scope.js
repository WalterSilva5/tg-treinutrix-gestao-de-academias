// Escopo de visibilidade por perfil. Aluno vê apenas o próprio cadastro e os
// próprios acessos; dados operacionais (dispositivos, sistema, backup) são da equipe.

export function visiblePersons(all, user) {
  if (!user) return [];
  if (user.perfil === 'aluno') return all.filter((p) => p.id === user.sub);
  return all;
}

export function visibleEvents(all, user) {
  if (!user) return [];
  if (user.perfil === 'aluno') return all.filter((e) => e.personId === user.sub);
  return all;
}

export function canSeeOperations(user) {
  return Boolean(user) && (user.perfil === 'recepcao' || user.perfil === 'gerencia');
}
