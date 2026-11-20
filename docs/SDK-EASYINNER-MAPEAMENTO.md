# SDK EasyInner — mapeamento modo On-line

Fonte: exemplo oficial C# "SDK Inner Acesso Online" + `C#/COM/EasyInner.cs`.

## Máquina de estados (ordem do exemplo)

```
CONECTAR → testa via ReceberRelogio
IDENTIFICAR_INNER → ReceberVersaoFirmware
ENVIAR_DATA_HORA → EnviarRelogio(now)
MUDANCA_AUTO_ONLINE_OFFLINE
CONFIGURAR_ENTRADAS_ONLINE → EnviarFormasEntradasOnLine
ENVIAR_MSG_PADRAO → EnviarMensagemPadraoOnLine
POLLING (loop)
  ├─ evento → VALIDAR_ACESSO → [PONTO DO INTEGRADOR]
  │             ├─ negado → ENVIAR_MSG_ACESSO_NEGADO + BipLongo → AGUARDA_TEMPO_MENSAGEM (2s)
  │             └─ liberado → LIBERA_GIRO_CATRACA → MONITORA_GIRO_CATRACA
  └─ sem evento há 3s → PING_ONLINE (PingOnLine); 3 falhas → RECONECTAR
```

## Funções usadas no caminho feliz

| Passo | Função | Retorno OK |
|-------|--------|------------|
| Tipo conexão | `DefinirTipoConexao(2)` | 0 |
| Padrão cartão | `DefinirPadraoCartao(PADRAO_LIVRE)` | 0 |
| Modo | `ConfigurarInnerOnLine()` | 0 |
| Abrir | `AbrirPortaComunicacao(porta)` | 0 |
| Teste | `ReceberRelogio(num, ref ...)` | 0 |
| Versão | `ReceberVersaoFirmware(num, ref ...)` | 0 |
| Relógio | `EnviarRelogio(num, dia, mes, ano, ...)` | 0 |
| Entradas | `EnviarFormasEntradasOnLine(num, qtdDig, eco, forma, tempo, cursor)` | 0 |
| Msg padrão | `EnviarMensagemPadraoOnLine(num, exibirData, texto)` | 0 |
| Polling | `ReceberDadosOnLine(num, ref origem, ref compl, cartao, ref ...)` | 0 = evento |
| Liberar | `LiberarCatracaEntrada/Saida/DoisSentidos(num)` (+ variantes `Invertida`) | 0 |
| Negar | `EnviarMensagemPadraoOnLine(num, 1, " ACESSO NEGADO!")` + `AcionarBipLongo(num)` | 0 |
| Keep-alive | `PingOnLine(num)` | 0 |

Códigos: `RET_COMANDO_OK = 0`, `ERRO = 1`, `PORTA_NAO_ABERTA = 2`, `PORTA_JA_ABERTA = 3`.

## Observações

- `ReceberDadosOnLine` preenche `Origem/Complemento/Cartao + data/hora`. Evento com
  complemento `TECLA_FUNCAO/TECLA_ANULA` ou cartão vazio (sem teclado ativo) é ignorado.
- O exemplo completo (Delphi/C#/Java) cobre off-line, biometria e listas; para o MVP
  on-line com facial integrado, o subconjunto acima basta.
- Requisitos do exemplo: Windows + .NET Framework 3.5.
