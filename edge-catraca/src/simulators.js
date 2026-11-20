// Simuladores com o MESMO contrato dos adaptadores reais.
// Quando USE_REAL_HARDWARE=1 no Windows, trocar pelas classes de dotnet-adapter sem mudar o edge.

export class SimulatedPlaca {
  constructor(deviceId) { this.deviceId = deviceId; }
  async liberar(direcao = 'IN') {
    console.log(`[placa:${this.deviceId}] giro liberado (${direcao})`);
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true, giroCompletado: true };
  }
  async mensagem(texto) {
    console.log(`[placa:${this.deviceId}] display: ${texto}`);
    return { ok: true };
  }
}

export class SimulatedFacial {
  // Gera evento de identificação fake para teste sem hardware.
  async simularIdentificacao(personId, score = 0.95) {
    return { device_id: 'dev_fit4_01', person_id: personId, score, direcao: 'IN', timestamp: new Date().toISOString() };
  }
}
