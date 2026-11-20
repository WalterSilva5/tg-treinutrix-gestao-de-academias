# Eventos e sorteios/premiações

Módulo de relacionamento da academia: eventos com inscrições abertas para
**alunos, visitantes e pessoas externas** e sorteios **configuráveis,
programáveis e desabilitáveis**. Tudo local, no SQLite, sem serviço externo.

> Não confundir com os **eventos de acesso** da catraca (`GET /api/events`).
> Aqui os eventos são a agenda da academia (`/api/eventos`).

## 1. Eventos

Campos: nome, descrição, local, início, fim, capacidade (opcional), aceita
visitantes, inscrições abertas e ativo.

Participante pode ser:

| Tipo | Como entra | Precisa ser aluno? |
|------|------------|--------------------|
| `ALUNO` | informando matrícula/id/cartão | sim (cadastro existente) |
| `VISITANTE` | cadastro de visitante já existente | não |
| `EXTERNO` | nome + contato/documento, sem cadastro | **não** |

- Capacidade conta apenas inscrições não canceladas.
- Check-in muda o status para `PRESENTE`; cancelar mantém o histórico.
- Remover a inscrição apaga só a inscrição (não afeta o cadastro da pessoa).
- Excluir o evento remove as inscrições junto (gerência).

## 2. Sorteios

Cada sorteio tem:

| Campo | Efeito |
|-------|--------|
| `publico` | quem concorre: novas matrículas, alunos ativos, alunos em dia, visitantes, participantes de um evento ou todos |
| `entradasBase` | entradas por participante (1 a 20) |
| `bonusEmDia` | entradas extras para mensalidade em dia |
| `bonusEvento` | entradas extras para quem participou do evento escolhido |
| `inicio` / `fim` | período (usado por “novas matrículas”) |
| `sorteioEm` | data/hora do sorteio automático (opcional) |
| `ativo` | habilita/desabilita sem apagar |
| `status` | `ATIVA`, `PAUSADA` ou `SORTEADA` |

### Exemplos prontos

- **Matrícula da sorte:** público `MATRICULAS`, período = campanha, 1 entrada.
- **Pagamento da sorte:** público `ALUNOS_EM_DIA`, 1 entrada (quem está em dia).
- **Roleta da mensalidade em dia:** público `ALUNOS_EM_DIA`, bônus por tempo de
  casa não existe ainda; use `entradasBase` e `bonusEmDia`.
- **Sorteio de evento:** público `EVENTO` + evento; externos concorrem.
- **Todos:** público `TODOS` (pessoas ativas cadastradas).

### Como o ganhador é escolhido

- O servidor calcula a lista elegível no momento do sorteio.
- Sorteio ponderado com `crypto.randomInt` (não usa `Math.random`).
- O cliente (roleta) **não decide** nada: a API retorna o ganhador e a animação
  apenas revela o resultado.
- Ficam registrados: ganhador, entradas, total de participantes, data e uma
  notificação `SORTEIO` no painel.
- “Reiniciar” limpa o ganhador e volta para `ATIVA`; “Entregar” registra quem
  entregou o prêmio e quando.

### Programação automática

- `sorteioEm` no passado + `ativo` + `status ATIVA` → o scheduler da API
  (`RAFFLE_INTERVAL_MS`, padrão 60 s) realiza o sorteio sozinho e notifica.
- Sem `sorteioEm`, o sorteio é manual (botão **Roleta**).
- Desabilitado (`ativo:false`) nunca é sorteado, nem pelo scheduler.
- Erros (ex.: sem elegíveis) ficam em `ultimoErro` e não travam os demais.

## 3. Exportação

`GET /api/eventos/:id/export.csv` e `.pdf` (equipe autenticada).

- CSV com BOM e separador `;` (abre no Excel pt-BR), colunas: nome, tipo,
  matrícula, documento, contato, status, check-in, inscrito em.
- PDF A4 gerado sem biblioteca externa, com cabeçalho do evento, lista numerada
  e paginação.
- Ambos excluem inscrições canceladas.

## 4. Endpoints

| Método | Rota | Permissão |
|--------|------|-----------|
| GET/POST | `/api/eventos` | equipe |
| GET/PATCH | `/api/eventos/:id` | equipe |
| DELETE | `/api/eventos/:id` | gerência |
| POST | `/api/eventos/:id/participantes` | equipe |
| PATCH/DELETE | `/api/eventos/:id/participantes/:pid` | equipe |
| GET | `/api/eventos/:id/export.csv` · `.pdf` | equipe |
| GET | `/api/sorteios` | equipe |
| POST | `/api/sorteios` | gerência |
| GET/PATCH/DELETE | `/api/sorteios/:id` | GET equipe; alterar gerência |
| GET | `/api/sorteios/:id/elegiveis` | equipe |
| POST | `/api/sorteios/:id/sortear` | gerência |
| POST | `/api/sorteios/:id/reset` | gerência |
| POST | `/api/sorteios/:id/entregar` | gerência |

## 5. Interface

- **Eventos:** lista, criação, detalhe com inscrição de aluno ou externo,
  check-in, cancelamento e botões CSV/PDF.
- **Sorteios:** lista com elegíveis e status, criação com público/pesos/datas,
  habilitar/desabilitar, roleta animada, reiniciar, entregar e excluir.
- Recepção vê **Eventos**; **Sorteios** é exclusivo da gerência.

## 6. Privacidade e limites

- Exportações contêm dados pessoais (nome, contato, documento): guardar com
  cuidado e definir retenção.
- Participantes externos não viram alunos automaticamente; se quiserem acesso
  à catraca, faça o cadastro normal em **Pessoas**.
- Elegibilidade usa validade do plano (não integra gateway de pagamento); um
  financeiro externo pode atualizar `validadeFim` para refletir pagamento.
- Sorteio é auditável pelo ganhador/notificação, mas ainda não guarda um
  histórico de todas as execuções (reset apaga o resultado anterior).
