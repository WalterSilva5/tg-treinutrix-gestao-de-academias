// Simuladores com o MESMO contrato dos adaptadores reais.
// Quando USE_REAL_HARDWARE=1 no Windows, trocar pelas classes de dotnet-adapter
// sem mudar o edge.

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
  constructor(deviceId) { this.deviceId = deviceId; }
  // Contrato do adaptador real: envia um comando JSON ao leitor (WebSocket).
  async enviarComando(cmd) {
    const alvo = cmd.enrollid ?? cmd.cmd;
    console.log(`[facial:${this.deviceId}] ${cmd.cmd} ${alvo}${cmd.enable === false ? ' (inativo)' : ''}`);
    return { ok: true, cmd: cmd.cmd };
  }
  // Gera evento de identificação fake para teste sem hardware.
  async simularIdentificacao(personId, score = 0.95, { direcao = 'IN', mode = 8 } = {}) {
    return {
      device_id: this.deviceId, person_id: personId, score, direcao, mode, metodo: mode === 8 ? 'FACIAL' : undefined,
      timestamp: new Date().toISOString(),
    };
  }
}
