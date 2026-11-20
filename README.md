# wsi-topdata-catraca-painel

Sistema de gestão de academia com controle de acesso integrado a catracas:
alunos, planos, frequência, recepção e catraca **Topdata Fit 4** — com suporte
também a outras catracas Topdata (Revolution 4, Box 4, PNE 4), leitor facial e
controladores HTTP genéricos.

Desenvolvimento **sem catraca**: toda conversa com hardware passa por interfaces
+ simuladores. O teste físico entra só na validação final.

> Revisão técnica completa (achados, correções e pendências): `docs/REVISAO.md`.
> Plano consolidado de tudo que foi solicitado e ainda falta: `docs/PLANO-COMPLETO.md`.

## Recursos

- Catraca Topdata/leitor facial + controladores HTTP, com detecção na rede e
  teste de conexão.
- Cadastro de pessoas, planos, regras de horário e frequência por dias distintos.
- **Eventos** com inscrições de alunos, visitantes e externos, check-in e
  exportação **CSV/PDF**.
- **Sorteios/premiações** programáveis (matrícula da sorte, mensalidade em dia,
  participantes de evento) com roleta e entrega do prêmio.
- Importação de cadastros por CSV/JSON (sem biometria; foto depois).
- Backup automático, restauração, notificações e PWA na rede local.
- Persistência em **SQLite**, sem Docker.

## Arquitetura

```
front (HTML) <-> api (Node, :3001) <-> SQLite (data/painel.db)
                      ^                     + eventos na mesma base
                      | HTTP (heartbeat + sync + identificações + /open)
               edge-catraca (Node, :3002, simulado)
                /                    \
   Placa simulada            Facial simulado
   (EasyInnerReal no Windows, em `edge-catraca/dotnet-adapter/`)
```

- `api/` — API central + motor de decisão ALLOW/DENY + persistência local.
  Zero dependências, roda em Linux e Windows com Node 22+.
- `edge-catraca/` — serviço de borda: heartbeat, worker de sincronização da
  fila (envia `setuserinfo`/`deleteuser` ao leitor), decisão e abertura do giro.
  No Linux usa simuladores; no Windows usa os adaptadores reais (bridge
  EasyInner + servidor WebSocket do facial) sem mudar o motor.
- `front/` — PWA servido pela própria API (um único IP local, ex.
  `http://192.168.0.10:3001`), tema claro/escuro, login por perfil, KPIs,
  gráfico semanal, presentes agora, Horário/Validade por pessoa e
  compartilhamento por link/QR.
- `backups/` — snapshots JSON + fotos (retidos 7, ignorados no git). Ver
  `docs/PAINEL-SISTEMA.md`.
- `data/` — banco SQLite (`painel.db`), fotos (`data/photos/`) e segredo de
  autenticação (`data/auth.secret`). Fora do git; entra no backup. O formato
  antigo (`state.json` + `events.jsonl`) é migrado sozinho no primeiro boot.
- `prisma/` — modelo de dados de referência para portar ao MySQL/Prisma do
  `treina.ai-api`.
- `docs/` — plano, contratos, drivers de catraca, instalação e revisão.

## Rodar no Linux (sem catraca)

```bash
node --version                  # >= 22 (node:sqlite nativo)
node --test                     # testes (unitários + HTTP + persistência)
node api/src/server.js          # API em http://localhost:3001
node edge-catraca/src/edge.js   # edge em http://localhost:3002
# abrir http://localhost:3001 (o PWA é servido pela API)
```

Primeiro acesso: `admin` / `admin123` (defina `SEED_ADMIN_PASSWORD` antes de
subir em produção). O primeiro boot cria `data/painel.db`; reinícios preservam
cadastros, senhas, regras e eventos. Se perder a senha do administrador:
`scripts\restaurar-admin.bat` (Windows) ou `bash scripts/restaurar-admin.sh`.

Instalação na academia (Windows/Linux, IP local, boot automático, multi-unidades):
ver `docs/INSTALACAO.md` — guia passo a passo para agente de IA.

## Fluxo de acesso

1. Cadastro (`POST /api/persons`) cria pessoa + regra padrão em todos os
   equipamentos + item na fila de sync.
2. Edge baixa a foto, envia `setuserinfo` ao leitor (`backupnum 50` com foto) e
   confirma `SENT`/`ERROR` na fila.
3. Leitor reconhece o rosto, manda o `enrollid` à catraca; o edge chama
   `POST /api/identification` com `person_id`, `metodo`, `score`, `timestamp`
   e `logindex` (idempotente).
4. API resolve por id/matrícula/enrollid, aplica ativo + validade + horário +
   score e responde `{allow, motivo, display_msg}`.
5. `allow` → edge libera o giro; `deny` → mensagem no display.
6. `POST /api/release` (operação) registra a liberação manual e chama
   `POST /open` no edge para abrir o giro de verdade.

## Variáveis de ambiente

| Var | Default | Descrição |
| --- | --- | --- |
| `API_PORT` | 3001 | porta da API |
| `EDGE_PORT` | 3002 | porta do edge (e default do `EDGE_URL`) |
| `API_URL` | http://localhost:3001 | URL da API vista pelo edge |
| `EDGE_URL` | http://localhost:3002 | URL do edge vista pela API (liberação manual) |
| `EDGE_TOKEN` | vazio | token exigido pelo edge em `/open` |
| `DEVICE_ID` | dev_fit4_01 | catraca desta instalação de edge |
| `AUTH_SECRET` | aleatório | segredo dos tokens (fixe em produção) |
| `SEED_ADMIN_LOGIN/PASSWORD` | admin/admin123 | primeiro operador |
| `SEED_DEMO` | 1 | `0` instala sem alunos de demonstração |
| `DATA_DIR` / `DATA_FILE` / `EVENTS_FILE` | ./data | persistência (disco externo) |
| `PERSIST_INTERVAL_MS` | 3000 | intervalo de gravação do estado |
| `EVENT_MAX` | 50000 | eventos mantidos no SQLite (poda automática) |
| `BACKUP_DIR` / `BACKUP_KEEP` | ./backups / 7 | snapshots |
| `PHOTO_DIR` / `PHOTO_MAX_BYTES` | ./data/photos / 400 KB | fotos de cadastro |
| `MIN_SCORE` | 0.7 | score mínimo no método facial |
| `NOTIFY_INTERVAL_MS` | 300000 | ciclo do avaliador de notificações |
| `LOGIN_MAX_FAILS` / `LOGIN_WINDOW_MS` | 5 / 5 min | limite de tentativas por IP |
| `MAX_BODY_BYTES` | 2 MB | limite de corpo HTTP |
| `CORS_ORIGIN` | vazio | só preencha se o PWA rodar em outra origem |
| `USE_REAL_HARDWARE` | 0 | 1 desativa os simuladores (`/sim/*`) |
| `SYNC_INTERVAL_MS` | 30000 | ciclo do worker de sync do edge |

## Endpoints principais

| Rota | Perfil | Uso |
| --- | --- | --- |
| `POST /api/auth/login` · `POST /api/auth/change-password` | público/autenticado | sessão (scrypt + HMAC 12 h) |
| `GET/POST /api/persons` · `PATCH/DELETE /api/persons/:id` | equipe / gerência (delete) | cadastro |
| `GET/PUT /api/persons/:id/rules` · `GET /api/rules` | equipe | horário por equipamento |
| `GET/POST /api/persons/:id/photo` · `DELETE` | próprio/equipe | foto (LGPD) |
| `GET/POST /api/devices` · `POST /api/devices/:id/heartbeat` | equipe | catracas |
| `GET /api/sync` · `POST /api/sync/:id/ack` | equipe | fila do leitor |
| `POST /api/identification` · `POST /api/release` | equipe/edge | motor de acesso + manual |
| `GET /api/overview` · `GET /api/system` | equipe | painéis |
| `GET/POST /api/notifications` · `POST .../evaluate` · `POST .../:id/ack` | equipe | alertas |
| `GET/POST /api/backup` · `POST /api/backup/restore` | equipe / gerência | snapshots |

## Portar para o treina.ai-api

- `prisma/schema.access.prisma` → fundir models em `back/prisma/schema.prisma`,
  gerar client, aplicar SQL manual.
- `api/src/decision.js` → `back/src/modules/access-decision/` (já é puro).
- `api/src/sync.js` → fila Bull (`access-sync`) com ack/erro e retry.
- Rotas de `api/src/server.js` → controllers NestJS (`access-person`,
  `access-device`, `access-event`, `access-rule`).
- `front/index.html` → páginas Angular em `front/src/app/pages/access-*`.

## No Windows com catraca

1. Ler `docs/PROXIMOS-PASSOS.md` (ordem de execução) e `docs/HANDOFF-WINDOWS.md`
   (estado atual e backlog priorizado). Roteiro de bancada:
   `docs/VALIDACOES-PENDENTES.md`.
2. Instalar como serviço: `scripts\instalar-servico.cmd` (logs em `logs/`,
   health em `/api/health`). Ver `docs/SERVICO-WINDOWS.md`.
3. Rodar `scripts\liberar-firewall.cmd` como administrador (3001–3003).
4. Compilar a ponte da catraca: `powershell -ExecutionPolicy Bypass -File
   edge-catraca\dotnet-adapter\build.ps1`.
5. Subir o edge com `USE_REAL_HARDWARE=1` (bridge EasyInner + servidor WebSocket
   do facial, conforme `edge-catraca/dotnet-adapter/README.md` e
   `docs/SDK-*-MAPEAMENTO.md`).
6. Outras marcas com API HTTP: `DEVICE_DRIVER=generic_http` e `DEVICE_ENDPOINT`.
7. Seguir o roteiro de bancada em `docs/CONTRATOS-HARDWARE.md`.

Agentes de IA: ler `AGENTS.md` antes de alterar o código.

## SDK oficial

- EasyInner modo On-line mapeado em `docs/SDK-EASYINNER-MAPEAMENTO.md` e
  `edge-catraca/dotnet-adapter/EasyInnerReal.cs` (fonte: exemplo C# oficial).
- DLL, instaladores e manuais do Portal do Integrador não são commitados.

## Licença

Business Source License 1.1 — ver `LICENSE`. Uso não-produtivo livre; produção
exige licença comercial do mantenedor. Converte-se para Apache-2.0 em 2030-11-20.
