# Adaptador real Windows (.NET) — SDK EasyInner modo On-line

Equivalente em produção de `edge-catraca/src/simulators.js`. Roda **só no Windows**:
`EasyInner.dll` é nativa x86/x64, exige `.NET Framework 3.5` e DLL registrada.

## Fonte

Exemplo oficial Topdata "SDK Inner Acesso Online" (C#), Portal do Integrador:
página `Download do SDK para Catracas e Coletores da Linha Inner – SDK EasyInner`.
Assinaturas em `EasyInnerReal.cs` copiadas de `C#/COM/EasyInner.cs` do exemplo
(subconjunto do modo On-line; o SDK completo tem 231 funções).

## Sequência de inicialização (igual ao exemplo)

1. `DefinirTipoConexao(2)` — porta fixa.
2. `DefinirIP(<ip da catraca>)` — **só quando `--ip` é passado** (versões do SDK
   com TCP por IP).
3. `DefinirPadraoCartao(PADRAO_LIVRE)`.
4. `ConfigurarInnerOnLine()`.
5. `AbrirPortaComunicacao(porta)`.
6. Teste de conexão: `ReceberRelogio(numero, ...)`.
7. `ReceberVersaoFirmware(...)` → `EnviarRelogio(...)` com data/hora atual.
8. `EnviarFormasEntradasOnLine(...)` → `EnviarMensagemPadraoOnLine(...)`.
9. Loop de polling (ver `docs/SDK-EASYINNER-MAPEAMENTO.md`).

O PC que roda o bridge precisa estar **na mesma faixa da catraca** (ex.:
catraca `192.168.0.100` → PC `192.168.0.10/24`). Porta TCP comum: `3000` ou
`3570`; confirme no menu de rede do equipamento e use `--porta-inner`.

```bat
EasyInnerBridge.exe --port 5011 --inner 1 --ip 192.168.0.100 --porta-inner 3000
```

## Ponto de integração com este projeto

No exemplo, a decisão de acesso está em `PassosAcesso.LiberarAcesso(cartao)`
(consulta a grid da UI — simulação). Aqui ela é substituída por:

```
cartao do polling → POST /api/identification → { allow }
allow=true  → LiberarCatracaEntrada/Saida/DoisSentidos + mensagem
allow=false → EnviarMensagemPadraoOnLine(" ACESSO NEGADO!") + AcionarBipLongo
```

## Regras

- Nunca commitar `EasyInner.dll`, instaladores ou PDFs do Portal se a licença Topdata proibir.
- Logar todo retorno da DLL com código + timestamp para replay contra o simulador.
- Facial integrado ao Inner chega como cartão no polling. Leitor facial avulso
  (linha Easy) usa o SDK do Leitor Facial via WebSocket — SDK diferente.
