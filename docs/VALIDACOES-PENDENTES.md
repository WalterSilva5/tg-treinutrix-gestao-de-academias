# Validações pendentes — ambiente com catraca real

Roteiro para executar **na bancada/academia**, com a catraca, o leitor facial e a
DLL oficiais. Tudo que está aqui foi implementado no código, mas ainda **não foi
validado em hardware físico**. Cada item tem comando, resultado esperado e o que
investigar quando falhar.

> Regra: não marcar como concluído sem evidência (log, print ou evento no painel).
> Se um item falhar, pare e registre antes de seguir para o próximo.

## 0. Antes de começar

- [ ] Fazer backup e guardar fora da máquina (`Sistema → Backup`).
- [ ] Anotar a versão do código: `git log --oneline -1`.
- [ ] Confirmar que os testes estão verdes: `node --test` (não usar `node --test api/test/`).
- [ ] Trocar a senha do `admin` e criar os operadores reais.
- [ ] Definir `AUTH_SECRET` fixo (ou confirmar que `data/auth.secret` foi criado).

## 1. Inventário da bancada

| Item | Valor |
|------|-------|
| Modelo da catraca | |
| Número de série | |
| Firmware da catraca | |
| Versão da `EasyInner.dll` | |
| IP / máscara / gateway da catraca | |
| Porta TCP da catraca | `3000` ou `3570` |
| Modelo/serial do leitor facial | |
| Firmware do leitor | |
| IP do PC do edge | |
| Sistema operacional do PC | |

## 2. Rede (mesma faixa)

A catraca e o PC precisam estar na **mesma sub-rede**. Exemplo: catraca
`192.168.0.100/24` → PC `192.168.0.10/24`.

```powershell
ipconfig
ping 192.168.0.100
Test-NetConnection 192.168.0.100 -Port 3000   # e/ou 3570
```

- [ ] `ping` responde.
- [ ] A porta TCP da catraca aparece como `TcpTestSucceeded : True`.
- [ ] Firewall do Windows libera TCP `3001`, `3002` e `3003` (rede privada).

Se não responder: cabo/switch, IP fora da faixa, VLAN diferente ou porta errada.
Não avance para a DLL sem essa etapa.

## 3. Bridge C# / `EasyInner.dll`

### 3.1 Compilar

```powershell
cd edge-catraca\dotnet-adapter
powershell -ExecutionPolicy Bypass -File build.ps1
# se a DLL for 32 bits:
powershell -ExecutionPolicy Bypass -File build.ps1 -X86
```

- [ ] `EasyInnerBridge.exe` gerado sem erro.
- [ ] Bitness do EXE igual à da DLL (x86 × x64). Erro `BadImageFormatException`
      indica incompatibilidade.

### 3.2 Sanidade sem hardware (protocolo)

```powershell
.\EasyInnerBridge.exe --simulate --port 5011
```

Em outro terminal, o edge em modo simulador deve conectar e o `/health` mostrar
`catraca: "simulado"`. Serve só para conferir o protocolo NDJSON.

### 3.3 Catraca real

```powershell
.\EasyInnerBridge.exe --port 5011 --inner 1 --ip 192.168.0.100 --porta-inner 3000
```

Esperado no console:

```
PORTA 5011
[bridge] ouvindo em 127.0.0.1:5011
[bridge] EasyInner on-line (inner 1, porta 3000)
```

- [ ] Bridge abriu a porta e ficou em `on-line`.
- [ ] Edge conectou (`[inner] bridge conectado`).
- [ ] `/health` do edge mostra `catraca: "conectado"`.

Falhas comuns:

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| `DllNotFoundException` | DLL não instalada/registrada | instalar do Portal do Integrador; `regsvr32` se necessário |
| `BadImageFormatException` | DLL x86 em processo x64 (ou vice-versa) | recompilar com `-X86` ou usar DLL compatível |
| `DefinirTipoConexao=2` | porta/ driver não abriu | conferir porta e se não há outro programa usando |
| `DefinirIP` `EntryPointNotFound` | versão do SDK sem essa função | rodar **sem** `--ip` ou ajustar a assinatura conforme o exemplo oficial |
| `AbrirPortaComunicacao(3000)=2` | porta errada ou IP inacessível | testar `3570` e revisar a rede |
| `ReceberRelogio=...` | conexão abriu mas não há resposta | conferir IP/porta e firmware; ver `PingOnLine` |
| Nenhum evento no polling | formato de cartão/origem diferente | validar `--padrao-cartao` e `--origem-saida` |

### 3.4 Suposições do SDK a confirmar
- [ ] `DefinirIP(string)` existe nesta versão da DLL e é necessário para TCP.
- [ ] Valor de `PADRAO_LIVRE` usada em `--padrao-cartao` (default `1`).
- [ ] `ReceberDadosOnLine`: `Origem` de saída é `2` (default de `--origem-saida`).
- [ ] `Cartao` chega como número do cartão/enrollid esperado, sem zeros à esquerda.
- [ ] `LiberarCatracaEntrada/Saida` abrem o giro correto (entrada × saída).
- [ ] `EnviarMensagemPadraoOnLine` exibe a mensagem no display.
- [ ] Repetição de `LiberarCatraca*` não trava o polling.

## 3.5 Já automatizado (validar na bancada)

- Diagnóstico: `GET /api/devices/:id/diagnostics` (TCP + `/hardware` do edge).
- Reinício do bridge pelo painel (`POST /api/devices/:id/restart`).
- Fallback automático de porta (`--porta-inner`, 3000, 3570) e tolerância a DLL
  sem `DefinirIP`.
- `senduser` do leitor cria cadastro na API; rosto desconhecido é salvo e
  listado em **Operação → Rostos desconhecidos** (retenção 30 dias).
- Múltiplas catracas: uma instância de edge por `DEVICE_ID`/`EDGE_PORT`;
  heartbeat e sync independentes (ver `docs/MULTI-CATRACA.md`).

## 4. Edge em modo real

Parar o edge atual e subir:

```powershell
$env:USE_REAL_HARDWARE='1'
$env:EDGE_TOKEN='um-token-forte'
$env:DEVICE_ID='dev_fit4_01'
$env:FACIAL_WS_PORT='3003'
node edge-catraca/src/edge.js
```

- [ ] Log `driver easyinner, REAL`.
- [ ] `/health` (`http://localhost:3002/health`) com `catraca: "conectado"`.
- [ ] `/sim/*` retorna 404 (simulador desativado).
- [ ] Edge reconecta sozinho após derrubar/subir o bridge.

## 5. Leitor facial (WebSocket)

No menu do leitor, configurar o **IP do servidor** (PC do edge) e a porta
`3003`. O leitor é o cliente; o edge é o servidor.

- [ ] Leitor conecta e envia `{"cmd":"reg","sn":...}`.
- [ ] Edge responde `{"ret":"reg","result":true,"cloudtime":...}`.
- [ ] Leitor recebe `setdevinfo` com `server_verify: 1` (modo online).
- [ ] Log `[facial] leitor conectado` e `/health` com `facial: "conectado"`.
- [ ] Sem a resposta do `reg`, o leitor **não** deve ficar reenviando (se ficar, a resposta não chegou).

Teste de reconhecimento:

- [ ] Rosto cadastrado → `sendlog` com `enrollid`, `mode: 8`, `inout`/`time`.
- [ ] Edge responde `access: true` e o leitor libera.
- [ ] Rosto desconhecido (`enrollid 99999999`) → `access: false`.

## 6. Cadastro e sincronização (sem biometria vinda de outro sistema)

A importação em lote **não traz foto nem template facial**. O cadastro é criado
sem biometria e a foto pode ser enviada depois.

- [ ] Criar/importar uma pessoa **sem foto**.
- [ ] Fila de sync vai para `SENT` (leitor recebe `setuserinfo` sem foto).
- [ ] Enviar a foto pelo painel (`Pessoas → Foto`).
- [ ] Novo item de sync é gerado e o leitor recebe `backupnum: 50` com a foto.
- [ ] Rosto passa a ser reconhecido depois do cadastro no leitor.

Se o leitor exigir cadastro presencial do rosto, registrar no inventário que a
foto enviada pelo sistema não foi suficiente para aquele firmware.

## 7. Matriz de decisão (executar uma vez cada)

| Cenário | Resultado esperado | OK |
|---------|--------------------|----|
| Ativo, dentro da validade e do horário | `ALLOW / OK`, giro libera | [ ] |
| Cadastro inativo | `DENY / PESSOA_INATIVA` | [ ] |
| Plano vencido | `DENY / FORA_VALIDADE` | [ ] |
| Fora do dia permitido | `DENY / DIA_NAO_PERMITIDO` | [ ] |
| Fora do horário | `DENY / HORA_NAO_PERMITIDA` | [ ] |
| Rosto com score baixo | `DENY / SCORE_BAIXO` | [ ] |
| Rosto não cadastrado | `DENY / PESSOA_NAO_ENCONTRADA` | [ ] |
| Equipamento não cadastrado | `DENY / DEVICE_NAO_ENCONTRADO` | [ ] |
| Liberação manual pela recepção | giro abre + evento `MANUAL_OPERADOR` | [ ] |
| API fora do ar | **não abre** (`API_OFFLINE`) e mostra aviso | [ ] |

Conferir em **Operação → Eventos**: horário, pessoa, método, decisão e motivo.

## 8. Direção, presença e saída

- [ ] Entrada gera evento `IN` e pessoa em **Presentes agora**.
- [ ] Saída (quando a catraca/leitor informar `inout=1`) gera `OUT` e remove dos presentes.
- [ ] Ajustar `--origem-saida` se a direção vier invertida.

## 9. Resiliência e operação

- [ ] Reiniciar o edge: bridge reconecta, leitor reconecta, sync pendente continua.
- [ ] Reiniciar a API: edge continua tentando e volta sozinho; dados persistem.
- [ ] Derrubar o cabo da catraca por 1 min: bridge marca offline, volta a conectar.
- [ ] Deixar rodando 24 h: sem vazamento de memória, sem travar o polling.
- [ ] Backup agendado/ manual contém `state.json`, fotos e eventos.
- [ ] Restore em uma máquina limpa devolve cadastros e fotos.

## 10. Segurança e LGPD

- [ ] Senha padrão `admin123` trocada.
- [ ] `AUTH_SECRET` fixo (ou `data/auth.secret` presente) — tokens sobrevivem ao reinício.
- [ ] `EDGE_TOKEN` definido e o `/open` rejeita requisição sem token.
- [ ] Consentimento de biometria registrado por pessoa.
- [ ] Prazo de retenção de foto definido e exclusão testada (`Excluir` remove foto e leitor).

## 11. Registro de evidências

| Data | Teste | Resultado | Evidência (log/print) | Responsável |
|------|-------|-----------|------------------------|-------------|
| | Rede/ping | | | |
| | Bridge on-line | | | |
| | `reg` do facial | | | |
| | Sync com foto | | | |
| | ALLOW | | | |
| | DENY vencido | | | |
| | DENY horário | | | |
| | Manual | | | |
| | 24 h | | | |

## 12. Critério para go-live

1. Rede estável e portas confirmadas.
2. Bridge e leitor reconectam sozinhos.
3. Libera e nega corretamente nos 5 cenários principais.
4. Eventos aparecem no painel com motivo certo.
5. Backup/restore validado com fotos.
6. Recepção treinada e senha padrão alterada.

## 13. Rollback

```powershell
# parar os processos do edge/bridge (Ctrl+C ou Stop-Process)
# restaurar o último backup pelo painel: Sistema → Backup → Restaurar
git log --oneline -5   # identificar a versão anterior
```

## 14. O que ainda não está coberto

Itens conhecidos que este roteiro **não** valida (e continuam pendentes):

- [ ] Portar a API para SQLite/Prisma (hoje a persistência é JSON + JSONL).
- [ ] Modo offline do leitor (`server_verify: 2` + `getalllog`) e regras locais (`setdevlock`).
- [ ] `senduser` (cadastro feito no próprio leitor) sincronizando de volta para a API.
- [ ] Captura/armazenamento da foto de rosto desconhecido.
- [ ] Múltiplas catracas por unidade com heartbeats independentes.
- [ ] Relatórios por período com exportação.
- [ ] Centralização multi-unidade no `treina.ai-api`.
