# Contratos de hardware (estáveis, não mudar sem versionar)

## POST /api/identification (edge → API)

```json
{ "device_id": "dev_fit4_01", "person_id": "per_demo_01", "score": 0.95, "direcao": "IN", "timestamp": "2026-11-20T12:00:00Z" }
```

Resposta:

```json
{ "allow": true, "motivo": "OK", "display_msg": "Acesso liberado." }
```

Motivos de negação: `PESSOA_NAO_ENCONTRADA, PESSOA_INATIVA, FORA_VALIDADE, SCORE_BAIXO, SEM_REGRA, DIA_NAO_PERMITIDO, HORA_NAO_PERMITIDA`.

## Edge (placa)

- `liberar(direcao)` → libera giro e retorna `{ ok, giroCompletado }`.
- `mensagem(texto)` → escreve no display.
- Implementação simulada em `edge-catraca/src/simulators.js`, real em C# no Windows.

## Origem do evento facial

- Facial **integrado ao Inner** (Fit 4 linha Inner): o reconhecimento chega como
  cartão no polling `ReceberDadosOnLine` — ver `docs/SDK-EASYINNER-MAPEAMENTO.md`.
- Leitor facial **avulso / linha Easy**: usa o SDK do Leitor Facial via WebSocket
  (SDK diferente, exemplos C#/.NET no Portal do Integrador). O edge converte para
  o mesmo `POST /api/identification`.

## Fotos

Padrão de cadastro: JPEG frontal, mínimo 480x640, menor que 200KB, fundo claro.
Validar no upload para reduzir falso-negativo no leitor facial.
