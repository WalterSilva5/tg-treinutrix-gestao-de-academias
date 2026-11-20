# SDK Leitor Facial — mapeamento WebSocket

Fontes: "Manual WebSocket Facial", "Comandos do Leitor Facial" e exemplo C#
(.NET 8, `WebSocketSharp`). Implementação de referência em
`edge-catraca/src/facial-ws.js`.

## Topologia

**Seu software é o servidor WebSocket. O leitor (cliente) conecta em você.**
Handshake obrigatório:

1. Configurar o IP do servidor no leitor; ele tenta conectar periodicamente.
2. Leitor envia `{"cmd":"reg","sn","devinfo":{...}}`.
3. Servidor **deve** responder `{"ret":"reg","result":true,"cloudtime"}` —
   sem isso o leitor reenvia `reg` e a comunicação é perdida.
4. Eventos represados no off-line chegam logo após a resposta do `reg`.

Envio e recebimento são **independentes**: `sendlog` pode chegar enquanto você
envia comandos. Respostas (`ret`) são correlacionadas no listener.

## Modos de operação (`setdevinfo.server_verify`)

| Valor | Modo | Comportamento |
|-------|------|---------------|
| 0 | Offline | leitor decide sozinho; `sendlog` é só aviso |
| 1 | Online | **usar neste projeto**: app responde `access:true/false` |
| 2 | Automático | alterna online/offline (fallback) |

No offline é possível enviar tabelas de horário ao leitor (`setdevlock`).

## Eventos leitor → software

**`sendlog`** — toda detecção de rosto, cadastrado ou não:

```json
{ "cmd": "sendlog", "sn": "1234567890", "count": 1, "logindex": 0,
  "record": [{ "enrollid": 300, "name": "Nome", "time": "2026-11-20 12:00:00",
               "mode": 8, "inout": 0, "event": 0 }] }
```

- `mode`: 2 senha, 3 cartão, 8 facial, 1 desconhecido.
- Desconhecido: `enrollid` 99999999, `event` 2, com `image` base64.
- `record` vazio: ignorar, nunca derrubar a conexão.
- Resposta **sempre** exigida no online (mesmo em falha interna):

```json
{ "ret": "sendlog", "result": true, "cloudtime": "2026-11-20 12:00:00",
  "message": "Texto exibido no leitor", "access": false }
```

**`senduser`** — cadastro feito no próprio leitor (`backupnum`: 50 foto,
11 cartão, 10 senha, 0 todos). Responder `{"ret":"senduser","result":...}`.

## Comandos software → leitor

| Comando | Uso no projeto |
|---------|----------------|
| `setuserinfo` | cadastrar/atualizar (foto `backupnum` 50 + base64, sem foto `backupnum` 0 + `record` "0") |
| `deleteuser` | remover (`backupnum` 13 = Todos, conforme exemplo; doc cita 0/10/11/50 por dado) |
| `setdevinfo` | `server_verify: 1`, volume, `verifymode`, `stranger_lock` etc. |
| `setuserlock` | restrição por usuário (`weekzone` + vigência, `verifymode` 0/2/3/8/9/10/11/14) |
| `setdevlock` | `cardformat`, `dayzone` (até 8, 5 seções), `weekzone` (até 8) |
| `getuserlist` | auditoria: `stn:true` primeira página, `stn:false` próximas até `to == count` |
| `getuserinfo` | detalhe por `enrollid` (`backupnum` 0 todos / 10 senha / 13 sem foto / 50 foto) |
| `getalllog` / `cleanlog` | exportar com `stn/from/to`, limpar logs |
| `enabledevice` / `disabledevice` | pausar/retomar validação sem cortar comandos |
| `cleanuser` | **cuidado**: apaga todos os usuários; exigir confirmação |

## Cadastro de foto

- Ideal oficial (FAQ): **480x640 px**, até **150KB**.
- Exemplo envia JPEG 800x800 em base64 (`record`); `card` segue validação
  Wiegand (fora do padrão → `0`).
- `enrollid` (long, até 12 dígitos) = número do cartão repassado à catraca.

## Fluxo Facial + Inner (oficial)

1. **Cadastro (WS):** `setuserinfo` com foto + `enrollid`.
2. **Acesso:** leitor → catraca (físico) → `ReceberDadosOnLine` (EasyInner) →
   `POST /api/identification` → `LiberarCatraca*` ou negado.
3. **Catraca Easy:** o próprio leitor libera; sem DLL.
