# SDK Leitor Facial — mapeamento WebSocket

Fonte: exemplo oficial C# "SDK Leitor Facial" (.NET 8, `WebSocketSharp`).

## Topologia (importante)

**Seu software é o servidor WebSocket. O leitor conecta em você.**
Classe `FacialReaderConnection : WebSocketBehavior` no exemplo. Cada leitor
abre uma conexão com o servidor e envia JSON com chave `cmd` ou `ret`.

## Mensagens leitor → software

| `cmd` | Significado | Ação do software |
|-------|-------------|------------------|
| `reg` | registro do leitor (`sn`) | memorizar `sn` do equipamento |
| `sendlog` | solicitação de acesso, `record[0]` com data/hora + matrícula | validar regras e responder `ValidaAcesso` |
| `senduser` | retorno de dados do usuário, `backupnum` indica o tipo | processar conforme `backupnum` |

`backupnum` no `senduser`: `50` foto, `11` cartão, `10` senha, `0` todos.

`sendlog` com `record` vazio deve ser ignorado (não derrubar a conexão).
Registro é on-line se `|dataHora - agora| <= 7s`, senão off-line.

## Mensagens software → leitor

Cadastro (`EnviarUsuario` / `EnviarFoto`):

```json
{ "cmd": "setuserinfo", "enrollid": 123, "name": "Nome",
  "backupnum": 50, "record": "<base64 jpeg 800x800>",
  "card": 0, "admin": 0, "enable": true }
```

- `enrollid` (long, até 12 dígitos) = id do usuário = **número do cartão**
  que o facial repassa à catraca via conexão física.
- `backupnum` foto = `50`; sem foto = `TodosDados` com `record: "0"`.
- `card`: se matrícula > 8 dígitos ou fora do padrão Wiegand, enviar `0`
  (validação `validarWiegand` no exemplo; conversão WG26→WG10 quando aplicável).
- Foto: JPEG redimensionado para 800x800 antes do base64
  (`Utils.FormatarImagemPadraoLeitor(foto, 800, 800, ...)`).

Exclusão:

```json
{ "cmd": "deleteuser", "enrollid": 123, "backupnum": 13 }
```

Resposta a acesso (`ValidaAcesso`):

```json
{ "ret": "sendlog", "result": true, "sn": "<serial>",
  "access": true, "enrollid": 123,
  "cloudtime": "2026-11-20 12:00:00", "message": "Acesso liberado." }
```

Após processar `senduser`, responder comando OK (`ResponderComandoOK("senduser")`).

## Fluxo completo Facial + Inner (oficial)

1. **Cadastro (WS):** software → leitor: `setuserinfo` com foto + `enrollid`.
2. **Acesso:** leitor reconhece → envia `enrollid` à catraca (físico) →
   catraca repassa via `ReceberDadosOnLine` (EasyInner) → software valida em
   `POST /api/identification` → `LiberarCatraca*` ou mensagem de negado.
3. **Catraca Easy (sem Inner):** o próprio leitor libera; confirmação de giro
   via WS, não via DLL.

## Regras do exemplo

- `cmd`/`backupnum` desconhecidos: logar e ignorar, nunca fechar a conexão.
- Requisitos do exemplo: Windows + .NET Core 3.1 (exemplo atual em net8.0).
- DLLs/manuais do Portal não são commitados.
