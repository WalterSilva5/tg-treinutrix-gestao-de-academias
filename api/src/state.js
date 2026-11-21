// Serialização do store em memória. Usado pelo backup e pela persistência
// automática (data/state.json), para que os dois formatos nunca divirjam.

export const STATE_VERSION = 1;

export function serialize(store, at = new Date()) {
  return {
    v: STATE_VERSION,
    at: at.toISOString(),
    persons: [...store.persons.values()],
    devices: [...store.devices.values()],
    users: [...store.users.values()],
    rules: store.rules,
    events: store.events,
    socialEvents: store.socialEvents || [],
    eventParticipants: store.eventParticipants || [],
    raffles: store.raffles || [],
    raffleDraws: store.raffleDraws || [],
    imports: store.imports || [],
    audit: store.audit || [],
    unknownFaces: store.unknownFaces || [],
    plans: store.plans || [],
    subscriptions: store.subscriptions || [],
    charges: store.charges || [],
    syncQueue: store.syncQueue,
    notifications: store.notifications,
    meta: store.meta,
  };
}

// Substitui o conteúdo do store pelos dados validados. Lança erro se o
// formato não for compatível (restore/persistência nunca sobrescreve no escuro).
export function hydrate(store, data) {
  if (!data || data.v !== STATE_VERSION) throw new Error('estado incompatível');
  for (const k of ['persons', 'devices', 'users', 'rules', 'events', 'syncQueue', 'notifications', 'socialEvents', 'eventParticipants', 'raffles', 'raffleDraws', 'imports', 'audit', 'unknownFaces', 'plans', 'subscriptions', 'charges']) {
    if (data[k] !== undefined && !Array.isArray(data[k])) throw new Error(`estado corrompido: ${k}`);
  }
  if (!Array.isArray(data.persons) || !Array.isArray(data.devices)) throw new Error('estado incompatível');
  if (!Array.isArray(data.users)) throw new Error('estado incompatível: users');

  store.persons = new Map(data.persons.map((p) => [p.id, p]));
  store.devices = new Map(data.devices.map((d) => [d.id, d]));
  store.users = new Map(data.users.map((u) => [u.id, u]));
  store.rules = data.rules || [];
  store.events = data.events || [];
  store.socialEvents = data.socialEvents || [];
  store.eventParticipants = data.eventParticipants || [];
  store.raffles = data.raffles || [];
  store.raffleDraws = data.raffleDraws || [];
  store.imports = data.imports || [];
  store.audit = data.audit || [];
  store.unknownFaces = data.unknownFaces || [];
  store.plans = data.plans || [];
  store.subscriptions = data.subscriptions || [];
  store.charges = data.charges || [];
  store.syncQueue = data.syncQueue || [];
  store.notifications = data.notifications || [];
  store.meta = data.meta || { lastBackupAt: null };

  if (!store.meta.nextEnrollid) {
    const maxEnroll = Math.max(1000, ...[...store.persons.values()].map((p) => Number(p.enrollid) || 0));
    store.meta.nextEnrollid = maxEnroll + 1;
  }
  return store;
}
