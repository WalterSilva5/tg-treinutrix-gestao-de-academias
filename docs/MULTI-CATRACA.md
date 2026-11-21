# Múltiplas catracas na mesma unidade

Cada catraca tem seu próprio `DEVICE_ID` no cadastro (**Sistema → Catracas**) e
uma instância de edge com porta própria. A API continua única.

## Exemplo (duas catracas)

```powershell
# Entrada (padrão)
$env:DEVICE_ID='dev_fit4_01'; $env:EDGE_PORT='3002'; node edge-catraca/src/edge.js

# Saída (outra janela/serviço)
$env:DEVICE_ID='dev_fit4_02'; $env:EDGE_PORT='3012'; node edge-catraca/src/edge.js
```

- A API enfileira sync para **todos** os dispositivos cadastrados; cada edge
  consome apenas o seu (`GET /api/sync?device_id=...`).
- Heartbeat e diagnóstico são por `DEVICE_ID`.
- O leitor facial do edge 1 não atende o edge 2; cada leitor aponta para o IP/porta
  do seu edge (`FACIAL_WS_PORT`, padrão 3003; use 3013 no segundo).
- Liberação manual da API usa o `device_id` do evento/seleção.

## Serviço no Windows

Crie tarefas adicionais `PainelCatracaEdge2` apontando para
`node scripts/servico.js edge` com `DEVICE_ID`/`EDGE_PORT` do segundo
equipamento. O `scripts/servico.ps1` atual instala duas tarefas (API + edge);
para mais catracas, duplique a definição ou use `schtasks` com as variáveis.

## TLS no WebSocket do leitor

O edge fala WS em rede local. Para TLS:

1. Coloque um proxy reverso (Caddy/nginx) com certificado na frente da porta do
   edge (3003).
2. Configure o leitor para `wss://` e a porta do proxy.
3. O bridge EasyInner continua TCP local; não precisa TLS.

Sem certificado, mantenha o leitor na VLAN da academia e libere apenas as portas
necessárias.
