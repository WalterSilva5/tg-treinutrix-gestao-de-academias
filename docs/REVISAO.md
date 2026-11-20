# Revisão técnica — 20/11/2026

Revisão do código e da arquitetura do painel, feita sobre a `main` (commit
`1af3f96`) com execução local da API/edge, testes automatizados e provas de
falha nos fluxos de acesso.

## Resumo executivo

O desenho é coerente: motor de decisão puro, contratos HTTP estáveis,
simuladores no lugar do hardware e documentação de SDK acima da média para um
MVP. Para o que o README promete **instalar numa academia** (seção 6 do
`INSTALACAO.md`), porém, a versão encontrada não fechava o ciclo principal:

| Antes | Efeito prático |
| --- | --- |
| Store só em memória | reiniciar o PC apagava cadastros, senhas, regras e histórico |
| Cadastro não criava regra e não havia API/UI de regras | todo aluno novo levava `SEM_REGRA` (nunca entrava) |
| `POST /api/identification` filtrava regra por `personId` comparando com `enrollid` | até quem tinha regra era negado quando o `person_id` vinha do cartão |
| Fila de sync sem ack e sem worker no edge | ficava `PENDING` para sempre, notificação eterna |
| Liberação manual só gravava evento | não abria a catraca |
| API sem tratamento global de erro | uma URL malformada (`/api/persons/%/photo`) derrubava o processo |
| `POST /api/persons` aceitava `id` do cliente | sobrescrevia cadastro existente, senha e foto |

Todos os itens acima foram corrigidos nesta rodada, com testes. O restante
deste documento separa o que mudou, os riscos que continuam abertos e a
avaliação de arquitetura.

## O que foi corrigido

### 1. Persistência (P0)
- Novo `api/src/persist.js` + `api/src/state.js`:
  - `data/state.json` (cadastros, usuários, regras, fila, notificações) com
    escrita atômica (`tmp` + `rename`) e salvamento em lote (`PERSIST_INTERVAL_MS`).
  - `data/events.jsonl` append-only para o histórico de acessos, com
    compactação a cada 5 mil eventos e leitura limitada a `EVENT_MAX`.
- `bootstrap()` carrega o estado antes do seed; arquivo corrompido é renomeado
  para inspeção em vez de apagado.
- `SIGINT`/`SIGTERM` salvam o que estiver pendente.
- Backup/restore passaram a usar o mesmo serializador (`state.js`), então
  backup e persistência não divergem.
- Testes: `api/test/persist.test.js` e `api/test/http.test.js`.

### 2. Regra de acesso por equipamento (P0)
- `POST /api/persons` cria regra padrão (`diasSemana:127`, `00:00–23:59`) em
  todos os dispositivos (`ensureRules`). Validade, `ativo` e horário continuam
  valendo; o padrão só evita o `SEM_REGRA` silencioso.
- Novos endpoints:
  - `GET /api/rules?personId=`
  - `GET|PUT /api/persons/:id/rules`
- Validação de `diasSemana` (0–127) e `HH:MM`.
- UI: botão **Horário** no card Pessoas (aplica a janela a todos os
  equipamentos) e botão **Validade** (renovar/remover vencimento).
- O filtro do motor agora usa o `person.id` resolvido, então `person_id`
  pode vir como id interno, matrícula ou `enrollid` (contrato do facial).

### 3. Robustez da API (P0)
- `handle()` converte qualquer exceção em resposta JSON; a API não cai mais
  por `decodeURIComponent` inválido, hash corrompido ou `savePhoto` recusando id.
- `readBody` com limite (`MAX_BODY_BYTES`, 2 MB) e `413` explícito.
- `verifyPassword` valida o formato do hash antes do `timingSafeEqual`.
- Login com limite de tentativas por IP (`LOGIN_MAX_FAILS`/`LOGIN_WINDOW_MS`, `429`).
- `POST /api/persons`: id só com `[A-Za-z0-9_-]`, `409` em id/matrícula/enrollid
  duplicados; `enrollid` imutável no `PATCH`.
- CORS desligado por padrão (o PWA é same-origin); `CORS_ORIGIN` reativa.
- `DELETE /api/persons/:id` (só gerência): remove foto e regras, enfileira
  `deleteuser` no leitor e preserva o histórico de eventos.
- URLs malformadas retornam `400` e a API segue saudável.

### 4. Sincronização com o leitor (P0)
- `sync.js`: payload com `enable` (inativo no leitor), `backupnum` e URL da foto;
  `enqueueSync` reaproveita o item `PENDING` da pessoa+dispositivo (sem spam);
  `enqueueDelete`; `ackSync`.
- `GET /api/sync?device_id=&status=&limit=` e `POST /api/sync/:id/ack`.
- Edge ganhou o worker `sincronizarPendentes()`: baixa a foto, monta
  `setuserinfo`/`deleteuser` (`facial-ws.js`) e confirma `SENT`/`ERROR`.
- Inativação automática passa a enfileirar com `enable:false`.
- Teste cobre dedupe da fila e baixa.

### 5. Liberação manual de verdade (P0)
- `POST /api/release` grava o evento e chama `POST /open` no edge
  (`EDGE_URL`, timeout de 1,5 s). Resposta informa `forwarded`; a UI mostra
  "Acesso liberado" ou "Catraca não confirmou a abertura".
- Edge `/open` abre o giro (`LiberarCatraca*` no adaptador real) e aceita
  `X-Edge-Token` quando `EDGE_TOKEN` está definido.

### 6. Motor de decisão (P0/P1)
- Falha fechada: facial sem `score` agora nega (`SCORE_BAIXO`); cartão/senha
  usam `metodo` (ou `mode` 2/3/8) e não dependem de score.
- `validadeFim` em data pura vale até `23:59:59.999` local (antes vencia à
  meia-noite UTC, bloqueando um dia antes no Brasil).
- Janela que atravessa a meia-noite (ex.: 22:00–02:00) e múltiplas janelas
  no mesmo dia.
- Regra mal configurada nega com `REGRA_INVALIDA` (antes podia liberar).
- `logindex` idempotente: retry do leitor não duplica evento.
- `timestamp` do evento respeita o horário enviado pelo edge (fila offline).
- Eventos antigos podados (`EVENT_MAX`, 50 mil).

### 7. Operação e notificações (P1)
- "Hoje" e digest usam o dia local do servidor (antes UTC: KPIs e digest
  viravam às 21h de Brasília).
- Cooldown por chave: depois da baixa, backup não reavisa por 24 h,
  dispositivo por 30 min, sync por 6 h, inativação por 30 dias.
- `presentes` deixa de contar quem já saiu (`direcao=OUT`).
- `ultimasEntradas` no overview lista só `ALLOW`.
- Edge: login/sync/heartbeat não derrubam o processo; API fora do ar =
  decisão `API_OFFLINE` (fecha, não abre) e mensagem no display.
- Simulador `/sim/*` é desativado com `USE_REAL_HARDWARE=1`.
- `DEVICE_ID` do edge chega ao simulador (antes era fixo em `dev_fit4_01`).

## Riscos que continuam abertos

### P1 — antes de virar produção
1. **Store continua single-node.** JSON local resolve o reboot, não substitui
   o MySQL/Prisma nem permite duas instâncias. O port para `treina.ai-api`
   continua sendo o caminho (ver `PLANO-DESENVOLVIMENTO.md`).
2. **Hardware real não implementado.** `EasyInnerReal.cs` tem só assinaturas;
   falta o wrapper C# chamável pelo edge, o servidor WebSocket do facial e o
   polling `ReceberDadosOnLine`. Com `USE_REAL_HARDWARE=1` o edge avisa e
   segue em simulador — não está pronto para a catraca.
3. **Sem fallback offline.** `server_verify=1` + API fora = academia parada.
   O modo 2 (automático) ou cache local de regras não foram implementados.
4. **Conta de serviço é gerência.** O edge loga como `admin`: heartbeat e
   identificação exigem perfil de operador. Criar perfil `dispositivo` com
   escopo mínimo (device/heartbeat/sync/identification) antes de produção.
5. **Backup automático.** Só existe lembrete/notificação; não há job diário
   nem verificação de restore. O snapshot manual é o único caminho hoje.
6. **Fotos/LGPD.** Falta registro de consentimento, prazo de retenção e
   trilha de auditoria de quem viu a foto. A exclusão já existe.
7. **Token em URL e `localStorage`.** Necessário para `<img>`; tokens de 12 h
   sem revogação. Em LAN é aceitável, mas exige HTTPS se sair da rede local.
8. **Senha inicial = matrícula**, sem troca obrigatória no primeiro acesso.
9. **Anti-passback e direção.** O leitor manda `mode/inout`; o edge ainda não
   propaga `OUT` do log real; "presentes" é estimativa.
10. **UI aplica horário a todos os equipamentos.** Falta editor por catraca
    (a API já aceita lista por `deviceId`).

### P2 — evolução
- Refatorar `server.js` (todas as rotas no mesmo arquivo, ~700 linhas) em
  módulos `domain/`, `http/routes/`, `infra/`, mantendo o `createServer`
  exportado que já permite os testes HTTP.
- OpenAPI/contrato versionado para os endpoints.
- Editar/excluir operadores (hoje só cria).
- QR code gerado pelo painel (hoje é passo manual do guia).
- Exportação/arquivamento de eventos e relatórios (CSV existe na UI).
- Calendário de feriados e janelas por período (ex.: férias).
- Observabilidade: logs estruturados, `/health` com disco/edge, métricas.
- Testes do edge com API fake e teste de foto de ponta a ponta.
- Multi-unidade com tenancy (hoje: uma instalação por unidade).

## Avaliação de arquitetura

Pontos fortes:
- `decision.js` é puro e testável; ótimo ponto de partida para o NestJS.
- Contratos de hardware separados (`facial-ws.js`, `CONTRATOS-HARDWARE.md`).
- Simuladores com o mesmo contrato dos adaptadores reais.
- Zero dependências no núcleo, o que simplifica a instalação na academia.

Riscos estruturais:
- **Store como singleton de módulo** (`store.js`) acopla testes, persistência
  e rotas. O port para Prisma deve trocar isso por repositórios injetados.
- **API e edge compartilham a mesma fila por HTTP**: correto para o MVP, mas
  sem idempotência de transporte (só `logindex`) e sem backoff/limite de
  tentativas. Em produção, usar Bull/Redis e dead-letter (já previsto no plano).
- **Edge monolítico**: heartbeat, sync e HTTP no mesmo processo; se o sync
  travar, o heartbeat para junto. Separar timers ou usar fila local.
- **PWA em um HTML de 60 KB** com handlers inline: rápido de iterar, difícil
  de evoluir. No port, páginas Angular `access-*` resolvem.
- **Documentação e código já divergiam** (ex.: "edge baixa a foto" e "fila
  sincroniza" estavam descritos, mas não implementados). A revisão alinhou
  os dois lados; vale manter um teste de contrato para cada promessa.

## Como validar

```bash
node --test                      # 66 testes (unitários + HTTP + persistência)
node api/src/server.js           # API em :3001 (cria data/state.json no 1º boot)
node edge-catraca/src/edge.js    # edge em :3002, sincroniza a fila a cada 30 s
```

Fluxo feliz (o que estava quebrado e agora fecha):

```bash
# login
curl -s -X POST localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","senha":"admin123"}'

# cadastro (cria regra padrão automaticamente)
curl -s -X POST localhost:3001/api/persons \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"nome":"Ana","tipo":"ALUNO"}'
# -> enrollid 1003, matricula M1003

# identificação pelo cartão/enrollid (contrato do facial)
curl -s -X POST localhost:3001/api/identification \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_id":"dev_fit4_01","person_id":"1003","metodo":"CARTAO"}'
# -> {"allow":true,"motivo":"OK"}

# liberação manual abre o giro no edge
curl -s -X POST localhost:3001/api/release \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_id":"dev_fit4_01"}'
# -> {"allow":true,"forwarded":true,...}
```

Reiniciar a API e repetir o login do aluno comprova a persistência
(`data/state.json` + `data/events.jsonl`).
