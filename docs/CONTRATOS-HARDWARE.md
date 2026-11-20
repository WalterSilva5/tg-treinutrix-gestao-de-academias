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

## Fotos

Padrão de cadastro: JPEG frontal, mínimo 480x640, menor que 200KB, fundo claro.
Validar no upload para reduzir falso-negativo no leitor facial.
