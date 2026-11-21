# Retenção e risco de evasão

Lista diária para a recepção agir antes de perder o aluno.

## 1. Como o risco é calculado

`GET /api/retention/risks?dias=14` (operação/gerência) avalia cada pessoa
`ALUNO` ativa e soma pontos:

| Sinal | Pontos |
|-------|--------|
| nunca frequentou (cadastro há ≥ 14 dias) | 35 |
| sem visita há ≥ `dias` (padrão 14) | 10 + 5 por período de 5 dias, até 40 |
| plano vencido | 30 |
| plano vence em até 7 dias | 20 |
| sem plano ativo e sem validade | 15 |

Quem soma **20 ou mais** entra na lista, ordenada por pontos e depois por dias
sem visita. A resposta inclui nome, matrícula, telefone, última visita, dias
sem visita, `validadeFim`, `diasParaVencer`, planos e motivos.

## 2. Ações de contato

- `GET/POST /api/persons/:id/contatos` registra canal (`WHATSAPP`, telefone,
  presencial etc.), resultado, observação, promessa de pagamento e responsável.
- O painel oferece **Contato** (registro) e **WhatsApp** (link `wa.me` com
  mensagem pronta, sem API oficial).
- Não há ainda marcação de "recuperado/perdido" nem tarefa com prazo; o
  histórico fica no cadastro.

## 3. Interface

- **Dashboard → Risco de evasão:** oito principais casos com atalhos de
  contato.
- **Financeiro → Inadimplência (aging):** cruza dívida com contato de cobrança.

## 4. Privacidade

- A lista é restrita à equipe (não aparece no PWA do aluno).
- Telefone só é usado para contato; respeite opt-out e a política de retenção
  (`docs/SEGURANCA-LGPD.md`).
- O endpoint não retorna CPF nem endereço.
