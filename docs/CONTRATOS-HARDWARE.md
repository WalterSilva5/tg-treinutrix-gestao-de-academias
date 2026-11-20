# Contratos de hardware (estáveis, não mudar sem versionar)

## POST /api/identification (edge → API)

```json
{
  "device_id": "dev_fit4_01",
  "person_id": "1002",
  "metodo": "FACIAL",
  "score": 0.95,
  "direcao": "IN",
  "timestamp": "2026-11-20T12:00:00Z",
  "logindex": 124
}
```

- `person_id` aceita **id interno, matrícula ou `enrollid`** (número do cartão).
  O edge deve enviar o `enrollid` lido no leitor/catraca.
- `metodo`: `FACIAL` (exige `score`), `CARTAO`, `SENHA` ou `MANUAL`. Também
  aceita `mode` do SDK (2 senha, 3 cartão, 8 facial) quando `metodo` falta.
- `logindex` é idempotente: reenvio do mesmo log/equipamento devolve a mesma
  decisão e **não** duplica evento.
- `timestamp` é opcional; quando ausente a API usa o relógio do servidor.
- `direcao` aceita `IN` (default) e `OUT`.

Resposta:

```json
{ "allow": true, "motivo": "OK", "display_msg": "Acesso liberado." }
```

Motivos de negação: `PESSOA_NAO_ENCONTRADA, PESSOA_INATIVA, FORA_VALIDADE,
SCORE_BAIXO, SEM_REGRA, REGRA_INVALIDA, DIA_NAO_PERMITIDO, HORA_NAO_PERMITIDA,
DEVICE_NAO_ENCONTRADO`. O edge trata como negação qualquer `allow` diferente de
`true` (inclui `API_OFFLINE`, gerado no próprio edge).

## POST /open (API → edge)

Chamado por `POST /api/release` (liberação manual do operador). Header
`X-Edge-Token` quando `EDGE_TOKEN` está definido.

```json
{ "device_id": "dev_fit4_01", "direcao": "IN" }
```

Resposta: `{ "ok": true, "giroCompletado": true }`. A API devolve
`forwarded:true/false` conforme o edge respondeu.

## Fila de sincronização (API → edge)

- `GET /api/sync?device_id=X&status=PENDING&limit=20` — ordem cronológica.
- `POST /api/sync/:id/ack` com `{ "status": "SENT" | "ERROR", "erro": "..." }`.

Payload `UPSERT` (`payload` do item):

```json
{
  "cmd": "setuserinfo",
  "enrollid": 1002,
  "name": "Ana",
  "enable": true,
  "backupnum": 50,
  "foto": "/api/persons/per_x/photo"
}
```

O edge baixa a foto (Bearer), converte para base64 e envia
`buildSetUserinfo` (`facial-ws.js`) ao leitor. `enable:false` inativa o usuário
sem apagar o rosto. `operacao: DELETE` envia `buildDeleteUser`.

## Edge (placa)

- `liberar(direcao)` → libera giro e retorna `{ ok, giroCompletado }`.
- `mensagem(texto)` → escreve no display.
- Implementação simulada em `edge-catraca/src/simulators.js`, real em C# no
  Windows. Com `USE_REAL_HARDWARE=1` os endpoints `/sim/*` são desativados.

## Origem do evento facial (fluxo oficial)

Duas SDKs, dois momentos (artigo oficial "Como Funciona o Fluxo..."):

1. **Cadastro (WS, SDK Leitor Facial):** software é o **servidor** WebSocket,
   leitor conecta em você. Envio `setuserinfo` com foto + `enrollid`
   (ver `docs/SDK-FACIAL-MAPEAMENTO.md`). `enrollid` = número do cartão.
2. **Acesso (TCP, SDK EasyInner):** leitor reconhece e envia o `enrollid` à
   catraca (físico) → polling `ReceberDadosOnLine` entrega o cartão →
   `POST /api/identification` decide → `LiberarCatraca*` ou negado.
   Ver `docs/SDK-EASYINNER-MAPEAMENTO.md`.

## Fotos

Padrão de cadastro: JPEG frontal, mínimo 480x640, menor que 200KB, fundo claro.
O painel comprime para até 480x640/150KB e a API valida a assinatura real
(JPEG/PNG/WebP) e o limite `PHOTO_MAX_BYTES`. Validar no upload para reduzir
falso-negativo no leitor facial.
