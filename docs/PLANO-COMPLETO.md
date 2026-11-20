# Plano completo — implementar todas as solicitações

**Data:** 2026-11-20
**Base:** commit `fc0abb6` (SQLite + eventos/sorteios + catraca + admin)
**Objetivo:** consolidar tudo que foi pedido, marcar o que já está pronto, o que
está parcial e o que falta, e definir a ordem de execução com critérios de
aceite. Este documento substitui a leitura solta de `PROXIMOS-PASSOS` e
`HANDOFF-WINDOWS` para o escopo atual.

> Regra deste plano: **nada é considerado pronto sem teste automatizado e, no
> caso de hardware, sem evidência de bancada** (`docs/VALIDACOES-PENDENTES.md`).

## 1. Matriz de solicitações

| # | Solicitação | Estado | O que falta |
|---|-------------|--------|-------------|
| 1 | Revisar código/arquitetura/plano e continuar | ✅ feito | manter `docs/REVISAO.md` atualizado |
| 2 | `git pull` / integrar remote | ✅ feito | push (aguardando autorização) |
| 3 | Subir a aplicação acessível na rede | 🟡 parcial | serviço automático, IP fixo, firewall, logs persistentes |
| 4 | Suportar catraca real | 🟡 parcial | validar bridge/leitor na bancada; offline; multi-catraca |
| 5 | IP `192.168.001.100` / menu da catraca | ✅ orientado | executar a mudança de rede na bancada |
| 6 | “Todas as funcionalidades pendentes” | 🟡 parcial | ver §3 (offline, relatórios, multi-device, Prisma etc.) |
| 7 | Doc `validacoes_pendentes.md` | ✅ feito | executar o roteiro no ambiente real |
| 8 | Cadastro de catracas no painel Sistema | ✅ feito | diagnóstico ao vivo e edição sem reiniciar edge |
| 9 | SQLite por padrão, sem Docker | ✅ feito | manutenção/compactação e teste de restore em máquina limpa |
| 10 | Importar cadastros sem biometria | 🟡 parcial | XLSX não (zero-dep), fotos, upsert, histórico, rollback |
| 11 | Scripts `.bat`/`.sh` para restaurar admin | ✅ feito | teste do modo offline e serviço |
| 12 | Sorteios/premiações + eventos + PDF/CSV | 🟡 parcial | edição na UI, auditoria, relatórios, inscrição pública |
| 13 | Este plano | ✅ feito | executar as fases abaixo |

Legenda: ✅ pronto · 🟡 parcial · ⛔ bloqueado por hardware/terceiros.

## 2. O que já está implementado (não refazer)

- Persistência **SQLite** (`data/painel.db`), migração do JSON, backup do `.db`.
- Revisão P0: erros HTTP, body limit, rate limit de login, regras padrão,
  sync com ack, liberação manual real, motor fail-closed, fuso local.
- Adaptadores reais: bridge C# EasyInner (`--ip`), cliente TCP NDJSON e
  servidor WebSocket do facial (`reg`/`sendlog`/`setuserinfo`/`deleteuser`).
- Cadastro/edição/exclusão/teste/detecção de catraca na aba **Sistema**.
- Importação CSV/JSON com prévia, deduplicação e relatório por linha.
- Eventos com participantes alunos/visitantes/externos, check-in e export
  **CSV/PDF**.
- Sorteios com público/pesos, agendamento, roleta, reset e entrega.
- Scripts `scripts/restaurar-admin.bat|.sh` + rota loopback de recuperação.
- 105 testes passando.

## 3. Lacunas por área

### 3.1 Operação local (Windows, sem Docker)

- [ ] Instalar como **serviço** (Agendador de Tarefas ou NSSM) para API e edge.
- [ ] IP fixo/reserva DHCP documentado e firewall liberando 3001/3002/3003.
- [ ] Logs em arquivo com rotação (hoje vão para `%TEMP%` quando iniciados
  manualmente).
- [ ] Health consolidado: versão, commit, uptime, banco, edge, fila.
- [ ] Rotina de restore em máquina limpa (não só no mesmo diretório).
- [ ] Script único `scripts/instalar-servico.cmd` e `scripts/parar-servico.cmd`.

### 3.2 Catraca/leitor real

- [ ] Validar `DefinirIP`, `PADRAO_LIVRE`, `origem` de saída e porta TCP
  (3000 × 3570) conforme `docs/VALIDACOES-PENDENTES.md`.
- [ ] Fallback automático de porta e tentativa sem `DefinirIP` quando a DLL não
  exportar a função.
- [ ] Diagnóstico por equipamento na API (`GET /api/devices/:id/diagnostics`):
  online, latência, último erro, versão do bridge.
- [ ] Recarregar IP/porta do cadastro sem reiniciar o edge (ou comando
  “reiniciar bridge” no painel).
- [ ] Modo offline do leitor: `server_verify: 2`, `setdevlock` e replay de
  `getalllog` com idempotência.
- [ ] `senduser` (cadastro feito no leitor) importado para a API.
- [ ] Foto de rosto desconhecido (`sendlog` com `image`) salva e notificada.
- [ ] `setuserlock`/`setdevlock` para restringir horário no próprio leitor.
- [ ] Múltiplas catracas por unidade: uma instância de edge por `DEVICE_ID`,
  heartbeat e sync independentes, documentação de portas.
- [ ] Autenticação/TLS no WebSocket do leitor (hoje é rede local aberta).

### 3.3 Eventos

- [ ] Editar e cancelar evento pela UI (API PATCH/DELETE já existem).
- [ ] Duplicar evento e criar eventos recorrentes (semanal/mensal).
- [ ] Lista de espera quando a capacidade enche.
- [ ] Inscrição pública por link/QR (sem login), com token por evento.
- [ ] Check-in por QR/código do participante.
- [ ] Importar participantes em lote (CSV) e promover externo para aluno.
- [ ] Relatório de **todos** os eventos por período (CSV/PDF), não só um.
- [ ] Notificações de evento (lotação, lembrete, lista de presença).
- [ ] Taxa/inscrição paga (opcional; sem gateway, apenas controle manual).

### 3.4 Sorteios/premiações

- [ ] Editar sorteio pela UI (hoje só cria/reseta).
- [ ] Prévia de elegíveis antes de salvar a campanha.
- [ ] Histórico/auditoria de sorteios (tabela `raffle_draws`), em vez de o
  reset apagar o resultado anterior.
- [ ] Múltiplos ganhadores/prêmios por campanha e estoque de prêmios.
- [ ] Lista de exclusão manual (ex.: funcionários, inadimplentes específicos).
- [ ] Trava contra sorteio concorrente (duas abas/recepções).
- [ ] Fuso/data do agendamento explícito na UI e confirmação antes do automático.
- [ ] Tela pública de sorteio (modo TV) e exportação do resultado (CSV/PDF).
- [ ] Critério real de “pagamento da sorte”: registrar pagamentos ou usar
  `validadeFim` (documentar a escolha).
- [ ] Notificação ao ganhador (hoje só notificação interna no painel).

### 3.5 Importação de cadastros

- [ ] Mapeamento de colunas na UI (nomes diferentes por sistema de origem).
- [ ] Modo `upsert` (atualizar existente) além de “ignorar duplicado”.
- [ ] Importar foto por URL/caminho ou pacote ZIP (respeitando LGPD).
- [ ] Histórico de importações e download do relatório de erros.
- [ ] Transação/rollback: hoje grava linha a linha; falha no meio deixa parcial.
- [ ] Limite maior/streaming para bases grandes (hoje 5000 linhas/2 MB).
- [ ] XLSX: **não** sem dependência; manter CSV/JSON e documentar conversão.

### 3.6 Relatórios e PWA

- [ ] Relatórios por período: frequência, inadimplência, picos, eventos,
  sorteios (CSV/PDF).
- [ ] Exportação de eventos e sorteios com filtros.
- [ ] PWA do aluno: plano, frequência, link Treinutrix, inscrição em eventos.
- [ ] Painel de ocupação em tempo real e histórico.

### 3.7 Segurança, LGPD e qualidade

- [ ] Rate limit em descoberta, importação e exportações.
- [ ] Sessão em cookie HttpOnly (hoje token em `localStorage`) ou mitigar XSS.
- [ ] Revogação de sessão e troca de senha obrigatória no primeiro acesso.
- [ ] Retenção automática de fotos, eventos e dados de externos.
- [ ] Auditoria de ações administrativas (quem sorteou, excluiu, importou).
- [ ] Testes E2E de navegador (login → evento → sorteio → exportar).
- [ ] Validar PDF em visualizador real (hoje teste só verifica assinatura).

### 3.8 Portabilidade/multi-unidade

- [ ] Portar API para NestJS/Prisma no `treina.ai-api` (contratos HTTP mantidos).
- [ ] Centralização multi-unidade e sincronização entre lojas.
- [ ] Migração SQLite → MySQL sem quebrar backup/restore.

## 4. Fases de execução

### Fase 1 — Fechar a operação local (1–2 dias)

1. Scripts de serviço Windows + documentação de IP/firewall.
2. Logs com rotação e health consolidado.
3. Teste de restore em diretório/máquina limpa.
4. E2E navegador do fluxo atual.

**Aceite:** reiniciar o PC e abrir o painel pelo celular sem comando manual;
backup restaurado em pasta limpa.

### Fase 2 — Completar eventos (2–3 dias)

1. Editar/cancelar/duplicar na UI.
2. Inscrição pública (link/QR) e check-in por QR.
3. Lista de espera e importação de participantes.
4. Relatório de todos os eventos.

**Aceite:** criar evento, divulgar link, externo se inscrever sem login, check-in
por QR, exportar CSV/PDF do período.

### Fase 3 — Completar sorteios (2–3 dias)

1. Editar na UI + prévia de elegíveis.
2. Auditoria `raffle_draws` e múltiplos ganhadores.
3. Trava de concorrência e confirmação do agendamento.
4. Exportação do resultado e tela pública.

**Aceite:** sortear duas vezes sem apagar histórico; duas abas não sorteiam em
duplicidade; resultado exportável.

### Fase 4 — Importação robusta (1–2 dias)

1. Mapeamento de colunas e `upsert`.
2. Rollback/transação e relatório de erros.
3. Fotos opcionais e histórico.

**Aceite:** importar 1000 linhas com 3 erros, receber relatório, nenhum cadastro
parcial; repetir a importação sem duplicar.

### Fase 5 — Hardware real (bancada; 1–2 dias + dependências)

1. Executar `docs/VALIDACOES-PENDENTES.md`.
2. Corrigir bridge conforme firmware/DLL.
3. Offline, diagnóstico, foto de desconhecido, `senduser`.
4. Múltiplas catracas.

**Aceite:** giro liberado e negado reais, leitor cadastrando/reconhecendo,
reconexão automática, evidências registradas.

### Fase 6 — Segurança/operação (2 dias)

1. Rate limits e auditoria.
2. Cookie HttpOnly / CSP.
3. Retenção LGPD.
4. Testes E2E.

**Aceite:** checklist de segurança sem itens abertos; sessão não vaza em XSS
básico; dados expiram conforme política.

### Fase 7 — Relatórios, PWA e portabilidade (3–5 dias)

1. Relatórios por período.
2. PWA do aluno com eventos/frequência.
3. Prisma/MySQL e multi-unidade (se ainda fizer sentido).

**Aceite:** relatórios conferem com os eventos; aluno vê o próprio histórico;
contratos HTTP preservados na portabilidade.

## 5. Ordem recomendada

```
Fase 1 → Fase 2 → Fase 3 → Fase 4 → (Fase 5 em paralelo quando houver bancada)
       → Fase 6 → Fase 7
```

Motivo: Fase 1 estabiliza o que já existe; 2–4 são evolução funcional sem
hardware; 5 depende da catraca física; 6–7 são endurecimento e futuro.

## 6. Testes por fase

| Fase | Teste mínimo |
|------|--------------|
| 1 | `node --test`, E2E navegador, restore em pasta limpa, reboot |
| 2 | HTTP de evento/inscrição/check-in/export + E2E link público |
| 3 | unitário de sorteio (randomInt injetado) + concorrência + auditoria |
| 4 | importação 1000 linhas, rollback, upsert, relatório |
| 5 | roteiro de bancada com evidência (log/print/evento) |
| 6 | rate limit, CSP/cookie, retenção, auditoria |
| 7 | relatórios × dados, PWA aluno, contratos da portabilidade |

Comando padrão: `node --test` (não usar `node --test api/test/` no Node 24).

## 7. Riscos e decisões

| Risco | Mitigação |
|-------|-----------|
| Sem hardware para validar | fases 1–4 não dependem dele; Fase 5 só com bancada |
| DLL/firmware divergir do exemplo | bridge configurável (`--ip`, portas, origem, padrão) |
| Zero dependências | CSV/JSON em vez de XLSX; PDF próprio; sem gateway |
| Token em `localStorage` | Fase 6 migra para cookie HttpOnly/CSP |
| SQLite concorrente | WAL + uma instância de API por instalação |
| Reset de sorteio apagar histórico | Fase 3 adiciona `raffle_draws` |
| Importação parcial | Fase 4 adiciona transação/rollback |

## 8. Definição de pronto (todo o plano)

1. Todos os checkboxes das fases marcados com evidência.
2. `node --test` verde e E2E de navegador.
3. Hardware validado na bancada (Fase 5) ou explicitamente fora de escopo.
4. Backup/restore testado em máquina limpa.
5. Documentação (`README`, `INSTALACAO`, `PAINEL-SISTEMA`,
   `SORTEIOS-E-EVENTOS`, `VALIDACOES-PENDENTES`) sem contradições.
6. Nenhum dado sensível no git; retenção LGPD definida.
7. Tag de release e checklist de go-live assinado.

## 9. Situação do repositório

- Branch `main`, commit `fc0abb6`.
- Sem push (aguardando autorização).
- App local rodando em `http://192.168.1.14:3001` (API) e `:3002` (edge simulado).
- Banco: `data/painel.db`.
- Próximo passo sugerido: **Fase 1** (serviço + E2E + restore), que não depende
  da catraca física.
