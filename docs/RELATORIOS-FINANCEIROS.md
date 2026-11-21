# Relatórios financeiros

Relatórios de mensalidades por período, com visão de **competência** e **caixa**.
Disponíveis para gerência no painel e por API (JSON, CSV e PDF).

## 1. Conceitos

- **Previsto:** soma das cobranças cuja `competencia` está no período.
- **Recebido:** soma das cobranças com `pagoEm` dentro do período (regime de
  caixa, independente da competência).
- **Em aberto:** cobranças `PENDENTE`/`ATRASADO` da competência do período.
- **Vencido:** em aberto com vencimento anterior a hoje (ou status `ATRASADO`).
- **Taxa de recebimento:** recebido ÷ previsto (pode passar de 100% quando há
  recebimento de competências anteriores).
- **Devedores:** pessoas com cobranças em aberto/vencidas no período.

## 2. Visões

| Visão | Conteúdo |
|-------|----------|
| Resumo | previsto, recebido, aberto, vencido, taxa, cobranças, devedores |
| Por competência | previsto/recebido/aberto/vencido de cada mês |
| Por plano | quantidade, previsto, recebido e aberto por plano |
| Por forma | pagamentos e total por pix/dinheiro/cartão etc. |
| Devedores | nome, matrícula, cobranças, aberto e vencido |

## 3. API

```http
GET /api/relatorios/financeiro?inicio=2026-11-01&fim=2026-11-30
GET /api/relatorios/financeiro.csv?inicio=...&fim=...
GET /api/relatorios/financeiro.pdf?inicio=...&fim=...
```

- Somente **gerência**.
- Sem `inicio`, usa o primeiro dia do mês de `fim`/hoje.
- CSV com BOM/`;` (Excel pt-BR) e PDF A4.
- Exemplo de resposta:

```json
{
  "periodo": { "inicio": "...", "fim": "...", "competencias": ["2026-11"] },
  "kpis": { "previsto": 350, "recebido": 300, "emAberto": 50, "vencido": 0,
            "taxaRecebimento": 85.7, "cobrancas": 3, "pagas": 2, "devedores": 1 },
  "porCompetencia": [ { "competencia": "2026-11", "previsto": 350, "recebido": 300, "aberto": 50, "vencido": 0 } ],
  "porPlano": [ { "plano": "3x semana", "previsto": 300, "recebido": 300, "aberto": 0 } ],
  "porForma": [ { "forma": "pix", "quantidade": 2, "total": 300 } ],
  "devedores": [ { "nome": "Ana", "matricula": "A1", "aberto": 50, "vencido": 0 } ]
}
```

## 5. Inadimplência por idade (aging)

`GET /api/financeiro/aging` (gerência) agrupa cobranças `PENDENTE`/`ATRASADO`:

| Faixa | Critério |
|-------|----------|
| `aVencer` | vencimento hoje ou no futuro |
| `d1_30` | 1 a 30 dias de atraso |
| `d31_60` | 31 a 60 dias |
| `d61_90` | 61 a 90 dias |
| `d90` | mais de 90 dias |

Resposta: `totalAberto`, `totalVencido`, `buckets` e `pessoas` (nome,
matrícula, telefone, cobranças, aberto, vencido, `maisAntigo` e pior faixa).
Cobranças canceladas são ignoradas.

## 6. Fluxo de caixa e despesas

- Despesas: `GET/POST /api/expenses` e `PATCH/DELETE /api/expenses/:id`
  (gerência). Campos: `data`, `valor`, `descricao`, `categoria`, `fornecedor`.
- `GET /api/financeiro/fluxo?inicio=&fim=` soma:
  - receitas = cobranças `PAGO` com `pagoEm` no período;
  - despesas = lançamentos com `data` no período;
  - `saldo = receitas − despesas`, além de `porCategoria` e `porDia`.
- O padrão do período é o mês corrente.
- Indicadores no painel: **Sistema → Despesas e fluxo de caixa**.
- Exportação CSV/PDF do fluxo ainda não existe; use a tela ou a API JSON.

## 7. Interface

- **Relatórios → Financeiro** (gerência):
  - seletor de mês;
  - KPIs, tabelas por competência, plano, forma e devedores;
  - botões **CSV** e **PDF**.
- **Sistema → Inadimplência (aging):** faixas, devedores e ações de contato.
- **Sistema → Despesas e fluxo de caixa:** lançar/editar/excluir despesas e
  acompanhar receitas, despesas e saldo do mês.
- **Sistema → Mensalidades** continua sendo a operação do dia a dia
  (gerar mês, registrar pagamento).

## 8. Regras e limitações

- O pagamento registrado **não altera** automaticamente o limite de dias nem a
  validade; quem controla isso é a assinatura do plano (ou ajuste manual).
- Cobranças canceladas não entram em previsto/aberto.
- Relatório é financeiro, não contábil/fiscal; não substitui nota fiscal.
- Dados de CPF/telefone não aparecem no relatório financeiro (só nome/matrícula).
