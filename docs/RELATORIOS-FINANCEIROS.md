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

## 4. Interface

- **Relatórios → Financeiro** (gerência):
  - seletor de mês;
  - KPIs, tabelas por competência, plano, forma e devedores;
  - botões **CSV** e **PDF**.
- **Sistema → Mensalidades** continua sendo a operação do dia a dia
  (gerar mês, registrar pagamento).

## 5. Regras e limitações

- O pagamento registrado **não altera** automaticamente o limite de dias nem a
  validade; quem controla isso é a assinatura do plano (ou ajuste manual).
- Cobranças canceladas não entram em previsto/aberto.
- Relatório é financeiro, não contábil/fiscal; não substitui nota fiscal.
- Dados de CPF/telefone não aparecem no relatório financeiro (só nome/matrícula).
