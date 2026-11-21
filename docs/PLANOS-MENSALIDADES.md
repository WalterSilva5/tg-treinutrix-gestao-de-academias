# Planos e mensalidades

## 1. Cadastro da pessoa

Além dos campos obrigatórios (`nome`, `tipo`), o cadastro aceita **opcionais**:
`cpf`, `telefone`, `email`, `nascimento`, `endereco`, `bairro`, `cidade`,
`cep`, `observacoes`, `objetivo`, `peso` (kg), `problemasSaude` e
`necessidadesEspeciais`.

- Nenhum campo opcional bloqueia o cadastro.
- CPF é guardado apenas com dígitos quando informado (sem validar dígito).
- Também entram na importação por CSV/JSON (colunas de mesmo nome ou mapeadas).

## 2. Planos

Campos:

| Campo | Exemplo | Regra |
|-------|---------|-------|
| `nome` | “3x semana” | obrigatório |
| `categoria` | `PRINCIPAL` / `COMPLEMENTAR` | define o papel |
| `valor` | `120.00` | mensalidade |
| `diasPorSemana` | `3` | **0 = livre**; limita dias distintos, não entradas |
| `diasSemana` | `127` | máscara dom=1 seg=2 ter=4 qua=8 qui=16 sex=32 sáb=64 |
| `duracaoMeses` | `1` | vigência da assinatura |
| `diaVencimento` | `10` | vencimento das cobranças |
| `ativo` | `true` | plano disponível para contratar |

Exemplos:

- **3x na semana:** `valor 100`, `diasPorSemana 3`, `diasSemana 127`.
- **Semana toda:** `valor 150`, `diasPorSemana 0`, `diasSemana 127`.
- **Funcional (complementar):** `valor 50`, `diasPorSemana 1`, `diasSemana 127`.
- **Só seg/qua/sex:** `diasPorSemana 3`, `diasSemana 2+8+32 = 42`.

## 3. Assinatura e complementos

- Uma pessoa pode ter **um plano principal ativo** e **vários complementares**.
- Contratar outro principal substitui o anterior (histórico preservado).
- A vigência (`inicio` + `duracaoMeses`) define a validade do cadastro
  (`validadeFim`) enquanto a assinatura estiver ativa.
- O limite semanal é a **soma** dos `diasPorSemana`; se qualquer plano for
  livre (`0`), o limite fica livre.
- A máscara de dias é a **união** dos planos (principal + complementares).

## 4. Regra de acesso (importante)

- **Não existe limite de entradas por dia.**
- O plano limita **dias distintos na semana**:
  - segunda entrada no mesmo dia continua liberada;
  - ao atingir o limite de dias distintos, o próximo dia novo é negado com
    `LIMITE_DIAS_SEMANA`;
  - na semana seguinte o contador zera.
- Horários e dias do equipamento (regras por catraca) continuam valendo em
  conjunto com o plano.
- Sem plano contratado, vale apenas a regra de horário/validade tradicional.

## 5. Mensalidades

Cada assinatura gera **uma cobrança por mês de vigência**:

```json
{ "competencia": "2026-11", "vencimento": "2026-11-10", "valor": 100,
  "status": "PENDENTE", "pagoEm": null, "pagoPor": null, "forma": null }
```

- `PENDENTE`, `PAGO`, `ATRASADO` (vencimento passado) e `CANCELADO`.
- `POST /api/charges/:id/pagar` registra quem recebeu, forma e observação.
- `POST /api/charges/gerar` cria as cobranças do mês para assinaturas ativas
  (idempotente por assinatura + competência).
- O pagamento **não altera** o limite de dias; a validade vem da assinatura.
  A recepção pode cancelar/renovar o plano conforme a política da academia.

## 6. Trancamento e cancelamento

- **Trancar** (`POST /api/persons/:id/plano/:subId/trancar` com `{ dias, motivo }`):
  - status passa a `TRANCADA` e `validadeFim` fica nula (acesso bloqueado);
  - o fim da assinatura é **estendido** pelos dias parados na retomada;
  - `dias` entre 1 e 365; motivo opcional.
- **Retomar** (`POST .../retomar`): status volta a `ATIVA`, soma os dias
  trancados ao `fim` e recalcula a validade.
- **Cancelar** (`DELETE /api/persons/:id/plano/:subId`): status `CANCELADA`,
  limpa a validade e preserva histórico (`canceladoEm`, `motivoCancelamento`).
- Trancamento/cancelamento **não apagam** cobranças já geradas; a recepção
  decide sobre isenção/ajuste manual.
- Toda ação gera auditoria (`PLANO_TRANCADO`, `PLANO_RETOMADO`,
  `PLANO_CANCELADO`).

## 7. Contatos de cobrança

- `GET/POST /api/persons/:id/contatos` guarda histórico de contato:
  `canal`, `resultado`, `observacao`, `promessaEm`, `por` e `em`.
- A lista de aging mostra o botão **Contato** e o atalho **WhatsApp**
  (`wa.me`, sem API oficial) com mensagem pronta.

## 8. Endpoints

| Método | Rota |
|--------|------|
| GET/POST | `/api/plans` |
| PATCH/DELETE | `/api/plans/:id` |
| GET/POST | `/api/persons/:id/plano` |
| DELETE | `/api/persons/:id/plano/:subId` |
| POST | `/api/persons/:id/plano/:subId/trancar` · `/api/persons/:id/plano/:subId/retomar` |
| GET/POST | `/api/persons/:id/contatos` |
| GET | `/api/charges?personId=&competencia=&status=` |
| POST | `/api/charges/:id/pagar` · `/api/charges/gerar` · `/api/charges/:id/cancelar` |

## 9. Interface

- **Sistema → Planos de mensalidade:** criar/editar/desativar planos.
- **Alunos → Pessoas:** botão **Plano** abre o menu contratar/trancar/
  retomar/cancelar; **Dados** edita os campos opcionais.
- **Sistema → Mensalidades:** gerar o mês, filtrar, registrar pagamento.
- **Sistema → Inadimplência (aging):** ver quem cobrar, contatar e abrir
  WhatsApp.
- **Meu acesso (aluno):** plano atual, dias/semana e mensalidades em aberto.

## 10. LGPD

- CPF/telefone/endereço são dados pessoais: acesso restrito à equipe e retenção
  conforme política da academia.
- Objetivo, peso, problemas de saúde e necessidades especiais são **dados de
  saúde/sensíveis**: restrinja o acesso, não use como critério de bloqueio de
  acesso e inclua na política de retenção/eliminação.
- Não use os campos opcionais como pré-requisito de acesso; eles existem para
  contato, cobrança e relacionamento.
