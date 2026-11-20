# Handoff — continuação no Windows

Documento para o agente que vai assumir a implementação no PC da academia.
Leia junto com `AGENTS.md` e `docs/INSTALACAO.md`.

## 1. O que já está pronto

| Área | Estado |
|------|--------|
| Login/senha (scrypt + token HMAC), perfis aluno/recepção/gerência | pronto |
| CRUD de pessoas (aluno, personal, visitante), foto, vínculo Treinutrix | pronto |
| Regras de acesso: ativo, validade, dia/horário, score | pronto |
| Inativação automática após 3 meses vencido | pronto |
| Inadimplência (só aluno, inativos fora) | pronto |
| Catálogo de catracas/drivers + cadastro de equipamento | pronto |
| Eventos, presença, gráfico 7 dias, CSV | pronto |
| Notificações com baixa manual + scheduler | pronto |
| Backup JSON + pasta de fotos + restore | pronto |
| PWA (link + QR), tema claro/escuro, toasts, busca, renovação | pronto |
| Simuladores de placa e facial | pronto |
| Contratos SDK Topdata mapeados | pronto (docs) |

## 2. O que ainda falta (backlog priorizado)

### P0 — sem isso não opera de verdade

1. **Persistência real.** O store é em memória: reiniciar perde tudo.
   Opções: SQLite (`node:sqlite` no Node 22+ ou `better-sqlite3` com aprovação)
   ou portar para o Prisma/MySQL do `treina.ai-api` (`prisma/schema.access.prisma`).
   Recomendado para a academia: **SQLite local** + backup do arquivo.
   Critério de aceite: reiniciar o serviço e manter pessoas, eventos e fotos.

2. **Driver EasyInner real (Windows).**
   Implementar em C# o equivalente a `edge-catraca/dotnet-adapter/EasyInnerReal.cs`
   seguindo `docs/SDK-EASYINNER-MAPEAMENTO.md`:
   conectar → firmware → relógio → configurar entradas → polling →
   `POST /api/identification` → liberar/negar. Critério: um giro real liberado
   e um negado, com evento aparecendo no painel.

3. **Servidor WebSocket do leitor facial.**
   Implementar o lado servidor (`reg`, `sendlog`, `senduser`) conforme
   `docs/SDK-FACIAL-MAPEAMENTO.md`, usando `edge-catraca/src/facial-ws.js`
   para montar/parsear mensagens. Critério: leitor conecta, recebe `reg`,
   envia `sendlog` e recebe `access`.

4. **Consumidor da fila de sincronização.**
   `GET /api/sync` já lista pendências com `payload` (`setuserinfo`,
   `enrollid`, `backupnum`, URL da foto). O edge deve consumir, buscar a foto
   e **marcar como SENT/ERROR**. Hoje só a API enfileira.
   Critério: cadastrar aluno no painel e ele aparecer no leitor.

### P1 — operação confiável

5. Heartbeat por dispositivo (hoje o edge usa `dev_fit4_01` fixo). Ler o `id`
   do device do `/api/devices` ou de configuração e enviar por equipamento.
6. Direção de saída (`OUT`) para presença correta; hoje só entrada.
7. `AUTH_SECRET` fixo em produção (sem isso, tokens invalidam ao reiniciar).
8. Rate limit simples no login (tentativas por IP/login).
9. Modo offline do leitor (`server_verify: 2`) com sincronização posterior via `getalllog`.

### P2 — evolução

10. Portar a API para NestJS/Prisma no `treina.ai-api` (contratos HTTP não mudam).
11. Relatórios por período com filtro e exportação.
12. Aplicativo/ PWA do aluno com plano, frequência e Treinutrix.
13. Multi-unidade (uma instalação por academia; futuro centralizado).

## 3. Instalação no Windows (resumo)

1. Instalar Node.js 22 LTS e Git.
2. `git clone https://github.com/WalterSilva5/wsi-topdata-catraca-painel.git`
3. `scripts\iniciar-painel.cmd` (cria `data\auth.secret` no primeiro run).
4. Liberar firewall TCP 3001 e 3002.
5. Abrir `http://<IP-da-máquina>:3001`, entrar com `admin` / `admin123` e trocar a senha.
6. Verificar: `curl http://localhost:3001/health` e `curl http://localhost:3002/health`.
7. Rodar `node --test api/test/` antes de qualquer alteração.

## 4. Contratos que não devem mudar sem versionar

- `POST /api/identification` → `{ allow, motivo, display_msg }`
- Motivos: `PESSOA_NAO_ENCONTRADA, PESSOA_INATIVA, FORA_VALIDADE, SCORE_BAIXO,
  SEM_REGRA, DIA_NAO_PERMITIDO, HORA_NAO_PERMITIDA, MANUAL_OPERADOR`
- `setuserinfo` / `sendlog` / `reg` conforme `docs/SDK-FACIAL-MAPEAMENTO.md`
- `liberar(direcao)` / `mensagem(texto)` no edge.

## 5. Armadilhas conhecidas

- `EasyInner.dll` é x86/x64 e exige registro (`regsvr32`) ou instalador oficial.
- Thread única no polling da DLL: não chamar de múltiplas threads.
- A foto precisa ser JPEG 480×640 e ≤150 KB para o leitor; o front já comprime.
- O `enrollid` enviado ao facial é o número do cartão; não use string.
- `POST /api/persons/:id/photo?...` com token só funciona para a própria foto do aluno.
- O PWA é network-first: se o painel parecer antigo, Ctrl+Shift+R.
- Backup em `backups/` inclui pasta `photos-<stamp>`; testar o restore.

## 6. Definição de pronto

- `node --test api/test/` sem falhas.
- Fluxo real na bancada: cadastro com foto → aparece no leitor →
  reconhecimento → decisão → giro liberado → evento no painel.
- Negado por plano vencido também testado.
- Reinício do serviço preserva dados (após P0-1).
- Backup e restore validados com fotos.
