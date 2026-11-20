# Eventos e sorteios/premiações

Módulo de relacionamento da academia: eventos com inscrições abertas para
**alunos, visitantes e pessoas externas** e sorteios **configuráveis,
programáveis e desabilitáveis**. Tudo local, no SQLite, sem serviço externo.

> Não confundir com os **eventos de acesso** da catraca (`GET /api/events`).
> Aqui os eventos são a agenda da academia (`/api/eventos`).

## 1. Eventos

Campos: nome, descrição, local, início, fim, capacidade (opcional), valor,
aceita visitantes, lista de espera, inscrições abertas e ativo.

Participante pode ser:

| Tipo | Como entra | Precisa ser aluno? |
|------|------------|--------------------|
| `ALUNO` | informando matrícula/id/cartão | sim (cadastro existente) |
| `VISITANTE` | cadastro de visitante já existente | não |
| `EXTERNO` | nome + contato/documento, sem cadastro | **não** |

- Capacidade conta apenas inscrições `INSCRITO`/`PRESENTE`; ao lotar, novos
  entram como `ESPERA` e são promovidos automaticamente quando abre vaga.
- Check-in por botão ou por **código curto** (o participante recebe um código
  de 6 caracteres, com QR, na inscrição pública).
- Cancelar mantém o histórico; remover apaga a inscrição e promove a espera.
- Editar, duplicar, repetir (semanal/mensal) e cancelar (desmarcar “ativo”) pelo
  painel. Excluir é só gerência.
- Valor opcional (R$): o pagamento é registrado manualmente na recepção
  (`Pago`/`Desfazer`), sem gateway.

## 1.1 Inscrição pública (link + QR)

- Cada evento tem um `publicToken`; o botão **Link/QR** mostra
  `http://IP:3001/e/<token>` e o QR para divulgar.
- A página `/e/<token>` é pública (sem login): mostra data, local, vagas e
  valor, e inscreve visitantes/externos.
- Limite por IP (`PUBLIC_MAX_HITS`/`PUBLIC_WINDOW_MS`) e bloqueio quando as
  inscrições estão fechadas ou o evento foi cancelado.
- **Gerar novo link** invalida o anterior.
- Participante externo pode ser promovido a aluno/visitante depois
  (`Virar aluno`), criando cadastro, regra e sync com a catraca.

## 1.2 Relatórios de eventos

- `GET /api/relatorios/eventos?inicio=&fim=` (JSON), `.csv` e `.pdf`.
- Colunas: evento, início, local, capacidade, inscritos, presentes, espera,
  receita e situação.
- Exportação individual do evento continua em `.../export.csv|pdf`.


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
| `agendamentoConfirmado` | exige confirmação explícita ao agendar |
| `ganhadoresQtd` | quantidade de ganhadores (1 a 50) |
| `estoquePremios` | limita o número de ganhadores ao estoque |
| `excluidos` | ids de pessoas fora do sorteio |
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
- Sorteio ponderado com `crypto.randomInt` (não usa `Math.random`), **sem repetir**
  vencedor quando há vários ganhadores.
- O cliente (roleta) **não decide** nada: a API retorna o(s) ganhador(es) e a
  animação apenas revela o resultado.
- Ficam registrados no histórico (`raffleDraws`): ganhador(es), entradas, total
  de participantes, data, se foi automático e quem operou.
- “Reiniciar” limpa o resultado atual, mas **não apaga o histórico**;
  “Entregar” registra quem entregou o prêmio e quando (por ganhador).
- Exclusões (`excluidos`) tiram a pessoa da lista elegível.
- Trava em memória impede dois sorteios simultâneos do mesmo sorteio.
- Um sorteio já realizado só é repetido com `forcar:true` (a UI usa Reiniciar).

### Programação automática

- `sorteioEm` no passado + `ativo` + `status ATIVA` → o scheduler da API
  (`RAFFLE_INTERVAL_MS`, padrão 60 s) realiza o sorteio sozinho e notifica.
- Ao informar `sorteioEm`, a API exige `agendamentoConfirmado:true` (a UI mostra
  um diálogo de confirmação).
- Sem `sorteioEm`, o sorteio é manual (botão **Roleta**).
- Desabilitado (`ativo:false`) nunca é sorteado, nem pelo scheduler.
- Erros (ex.: sem elegíveis) ficam em `ultimoErro` e não travam os demais.

### Tela pública e exportação

- `GET /api/public/sorteios/:token` (sem login) mostra nome, prêmio, status,
  elegíveis e ganhadores — sem dados sensíveis.
- Página `/s/<token>` para TV/projetor, atualizando a cada 5 s.
- `GET /api/sorteios/:id/resultado.csv|pdf` exporta o resultado.
- `GET /api/sorteios/:id/historico` lista todas as execuções (auditoria).

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
| POST | `/api/eventos/:id/duplicar` · `/recorrencia` · `/token` | equipe/gerência |
| POST | `/api/eventos/:id/participantes` · `/participantes/import` | equipe |
| PATCH/DELETE | `/api/eventos/:id/participantes/:pid` | equipe |
| POST | `/api/eventos/:id/participantes/:pid/promover` | equipe |
| POST | `/api/eventos/:id/checkin` | equipe |
| GET | `/api/eventos/:id/export.csv` · `.pdf` | equipe |
| GET | `/api/relatorios/eventos[.csv|.pdf]` | equipe |
| GET/POST | `/api/public/eventos/:token` · `/participantes` | público (link) |
| GET | `/api/sorteios` | equipe |
| POST | `/api/sorteios` | gerência |
| GET/PATCH/DELETE | `/api/sorteios/:id` | GET equipe; alterar gerência |
| GET | `/api/sorteios/:id/elegiveis` · `/historico` | equipe |
| POST | `/api/sorteios/:id/sortear` · `/reset` · `/entregar` | gerência |
| GET | `/api/sorteios/:id/resultado.csv` · `.pdf` | equipe |
| POST | `/api/sorteios/:id/token` | gerência |
| GET | `/api/public/sorteios/:token` | público (tela) |

## 5. Interface

- **Eventos:** lista, criação/edição, duplicar/repetir, link público com QR,
  inscrição de aluno ou externo, importação CSV, check-in por código,
  pagamento manual, cancelamento e exportação CSV/PDF.
- **Relatório por período:** totais de inscritos, presentes, espera e receita.
- **Sorteios:** lista com elegíveis/status, criação e **edição** com público,
  pesos, ganhadores, estoque e datas; prévia de elegíveis, histórico, exclusão
  de pessoa, link da **tela pública**, roleta animada, exportação CSV/PDF,
  entrega, reinício e exclusão.
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
