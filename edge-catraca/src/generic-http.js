// Driver genérico para controladores/catracas de outras marcas que exponham
// uma API HTTP na rede local (relé TCP/HTTP, porta giratória, controlador).
// Contrato: POST <endpoint> com { action, direction, device } e HTTP 2xx.

export class GenericHttpPlaca {
  constructor(deviceId, endpoint) {
    this.deviceId = deviceId;
    this.endpoint = endpoint;
  }

  async liberar(direcao = 'IN') {
    if (!this.endpoint) throw new Error('endpoint não configurado');
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open', direction: direcao, device: this.deviceId }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`controlador respondeu ${res.status}`);
    return { ok: true, giroCompletado: true };
  }

  async mensagem(texto) {
    console.log(`[placa:${this.deviceId}] mensagem (drivers HTTP não exibem): ${texto}`);
    return { ok: true };
  }
}
