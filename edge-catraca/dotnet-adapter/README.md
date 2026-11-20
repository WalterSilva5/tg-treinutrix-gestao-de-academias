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
2. `DefinirPadraoCartao(PADRAO_LIVRE)`.
3. `ConfigurarInnerOnLine()`.
4. `AbrirPortaComunicacao(porta)`.
5. Teste de conexão: `ReceberRelogio(numero, ...)`.
6. `ReceberVersaoFirmware(...)` → `EnviarRelogio(...)` com data/hora atual.
7. `EnviarFormasEntradasOnLine(...)` → `EnviarMensagemPadraoOnLine(...)`.
8. Loop de polling (ver `docs/SDK-EASYINNER-MAPEAMENTO.md`).

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
