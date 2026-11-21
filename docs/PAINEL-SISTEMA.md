# Painel Sistema — operação, backup, persistência e notificações

Login e senha (`api/src/auth.js`): hash scrypt, token HMAC 12 h, limite de
tentativas por IP (5 em 5 min). Primeiro operador via
`SEED_ADMIN_LOGIN/SEED_ADMIN_PASSWORD` (padrão admin/admin123 — trocar na
instalação). Aluno entra com matrícula + senha (inicial = matrícula). Gerência
gerencia operadores em `GET/POST /api/users`; troca de senha em
`POST /api/auth/change-password`. Edge usa conta de serviço
(`EDGE_LOGIN/EDGE_PASSWORD`).

Base de padrões: `wsi-invest-ai` (`back/src/modules/admin` overview,
`alerts` regras + dedup + `alertEvent`, `scheduler` cron, `scripts/backup.sh`).

## Persistência (`api/src/persist.js`)

- `data/painel.db` — **SQLite** (`node:sqlite`, sem Docker). Guarda cadastros,
  senhas, operadores, regras, fila, notificações e eventos. Snapshot do estado
  pequeno + tabela de eventos com índices por data e pessoa.
- Escrita do snapshot a cada `PERSIST_INTERVAL_MS` (3 s); eventos são inseridos
  no mesmo instante em que acontecem.
- Poda automática em `EVENT_MAX` (50 mil) e compactação a cada `EVENT_COMPACT_EVERY`.
- `DATA_DIR`/`DB_FILE` apontam para disco externo/rede.
- Banco corrompido é renomeado (`painel.db.corrupt-<ts>`, com `-wal`/`-shm`) em
  vez de apagado; a API sobe com o seed e avisa no log.
- **Migração:** no primeiro boot sem banco, um `data/state.json` +
  `data/events.jsonl` antigo é importado e renomeado para `.migrado-<ts>`.
- O backup copia o snapshot JSON, o arquivo `.db` e a pasta de fotos; o restore
  reidrata o store e substitui a tabela de eventos.

## Cadastro e detecção de catracas

- **Sistema → Catracas e controladores**: cadastrar, editar, excluir, testar a
  conexão TCP (`POST /api/devices/:id/test`) e **detectar na rede**
  (`POST /api/devices/discover`, varre um /24 privado nas portas 3570/3000).
- O edge lê o cadastro (`GET /api/devices`) e, no Windows com driver
  `easyinner`, sobe o bridge C# já com IP/porta do equipamento
  (`EASYINNER_AUTOSTART=0` desliga).
- Detecção só é permitida para gerência e faixas privadas (/24), com intervalo
  mínimo entre varreduras (`DISCOVER_MIN_MS`).

## Importação de cadastros (sem biometria)

- **Sistema → Importar cadastros** aceita CSV (`nome;matricula;tipo;enrollid;
  validadeFim;treinutrix;ativo`) ou JSON (lista ou `{ pessoas: [...] }`).
- `POST /api/persons/import` com `confirmar:false` faz prévia; `true` grava.
  Deduplica por matrícula/enrollid, ignora repetidos, reporta erros por linha e
  limita 5000 linhas.
- Não importa foto nem template facial: o cadastro nasce sem biometria e a foto
  é enviada depois em **Pessoas → Foto** (o sync manda `setuserinfo` ao leitor).

## Endpoints

| Rota | Origem do padrão |
| --- | --- |
| `GET /api/system` | `health` + `admin/overview`: hostname, plataforma, IPs locais, contadores, `lastBackupAt` |
| `GET /api/overview` | `admin/overview`: KPIs do dia (fuso local), últimas entradas, inadimplentes, dispositivos |
| `GET /api/rules?personId=` · `GET|PUT /api/persons/:id/rules` | regras de horário por equipamento |
| `DELETE /api/persons/:id` | exclusão (LGPD) — só gerência; remove foto/regras e envia `deleteuser` |
| `GET /api/sync` · `POST /api/sync/:id/ack` | fila do leitor (edge confirma `SENT`/`ERROR`) |
| `GET/POST /api/eventos` · `.../participantes` · `.../export.csv|pdf` | agenda, inscrições e exportação |
| `POST /api/eventos/:id/checkin` · `/duplicar` · `/recorrencia` · `/token` | check-in por código, cópia, recorrência e link público |
| `GET/POST /api/public/eventos/:token` | inscrição pública sem login |
| `GET /api/relatorios/eventos[.csv|.pdf]` | relatório de eventos por período |
| `GET /api/relatorios/geral[.csv|.pdf]` | frequência, inadimplência, agenda e sorteios |
| `GET /api/me/eventos` · `POST .../inscrever` · `DELETE .../inscricao` | eventos do aluno |
| `GET /api/export/dados` | exportação completa para migração |
| `GET/POST /api/sorteios` · `.../elegiveis` · `.../sortear` | sorteios programáveis e roleta |
| `GET /api/sorteios/:id/historico` · `.../resultado.csv|pdf` | auditoria e exportação do resultado |
| `GET /api/public/sorteios/:token` | tela pública do sorteio |
| `GET /api/device-catalog` · `POST/PATCH/DELETE /api/devices` | catálogo e cadastro de catracas |
| `POST /api/devices/:id/test` · `POST /api/devices/discover` | teste TCP e detecção na rede |
| `POST /api/persons/import` | importação em lote (prévia/confirmação) |
| `GET /api/imports` · `.../relatorio.csv` | histórico e relatório de importações |
| `GET /api/audit` | trilha de auditoria (gerência) |
| `GET/POST /api/plans` · `PATCH/DELETE /api/plans/:id` | planos de mensalidade |
| `GET/POST /api/persons/:id/plano` · `DELETE .../:subId` | assinatura principal/complementar |
| `GET /api/charges` · `POST .../pagar` · `/gerar` · `/cancelar` | mensalidades |
| `POST /api/auth/logout` · `POST /api/auth/change-password` | encerra/invalida sessão e troca senha |
| `POST /api/release` | liberação manual: evento + `POST /open` no edge |
| `GET /api/notifications` | `alerts/list` |
| `POST /api/notifications/evaluate` | `alerts/evaluate` (aqui sem tenant) |
| `POST /api/notifications/:id/ack` | baixa manual com `por` (responsável) |
| `POST /api/backup`, `GET /api/backup`, `POST /api/backup/restore` | `scripts/backup.sh` (snapshot + retenção `BACKUP_KEEP=7`) |

## Regras de notificação (`api/src/notify.js`)

1. **BACKUP** — sem backup há 24h (`BACKUP_INTERVAL_MS`, env `NOTIFY_INTERVAL_MS` p/ scheduler).
2. **DISPOSITIVO** — sem heartbeat há 10 min (`DEVICE_STALE_MS`).
3. **SINCRONISMO** — itens `PENDING` na fila.
4. **INATIVACAO** — plano vencido há 90 dias: marca `ativo=false` sozinho,
   enfileira `UPSERT` com `enable:false` no leitor e avisa (reativação manual).
5. **METRICAS** — resumo diário (eventos allow/deny, pessoas, dispositivos),
   chave `digest:AAAA-MM-DD` no **dia local**.

Dedup por `key`: pendente com mesma chave não duplica. Depois da baixa existe
cooldown por tipo (backup 24h, dispositivo 30min, sincronismo 6h, inativação
30 dias), senão o scheduler de 5 min recriaria a notificação e geraria fadiga.
`ack` exige responsável.

## Backup (`api/src/backup.js`)

Snapshot JSON do store em `backups/painel_<iso>.json` mais a pasta
`photos-<iso>/` com as fotos do cadastro. Retenção dos 7 mais recentes.
`BACKUP_DIR` via env (testes usam tmp; produção: disco externo/rede).
Restore valida o nome (`painel_*.json`, anti path-traversal) e o schema (`v:1`),
devolve as fotos do snapshot e regrava o `events.jsonl`.

O lembrete de backup é só uma notificação; **agende** `POST /api/backup` (cron
ou Agendador de Tarefas) e teste o restore periodicamente.

## Fotos (`api/src/photos.js`)

- Armazenadas em disco (`PHOTO_DIR`, padrão `data/photos/`), fora do git.
- Validação por assinatura real do arquivo (JPEG/PNG/WebP) e limite `PHOTO_MAX_BYTES`.
- `POST /api/persons/:id/photo` — operação ou o próprio aluno; `GET` aceita `?t=<token>`
  para funcionar em `<img>`; `DELETE` só operação.
- Resposta da pessoa traz `foto: { ext, mime, bytes, updatedAt }` e `enrollid` numérico.
- A fila de sincronização leva `setuserinfo` com `backupnum 50` e a URL da foto;
  o edge baixa, converte para base64 e envia ao leitor facial.

## Interface (PWA)

- Tema claro padrão com alternância para escuro (botão na barra lateral, persistido).
- Avisos em toast (não bloqueiam a tela) para cadastro, renovação, backup e erros.
- Dashboard com KPIs, gráfico dos últimos 7 dias e lista de **presentes agora**.
- **Frequência por dias distintos**: várias entradas no mesmo dia contam como 1
  dia (`GET /api/frequency`, `api/src/frequency.js`). Eventos ficam como auditoria.
- Busca por nome/matrícula/Treinutrix e filtros por tipo/situação na lista de pessoas.
- Renovação rápida de plano (+30 e +90 dias) direto na linha da pessoa.
- **Pessoas:** Horário (janela de acesso), Validade (renovar/remover),
  Vincular Treinutrix, Foto, Inativar/Reativar e Excluir (gerência).

## Compartilhar acesso (link + QR)
- Botão **Compartilhar acesso** no topo (equipe) e no cartão do servidor em Sistema.
- Modal mostra o endereço da rede local (`http://IP:porta`), seletor de IP quando a
  máquina tem mais de um, **Copiar link** e **Baixar QR** (PNG).
- QR gerado no navegador por `front/qr.js` (byte mode, correção M, versões 1–10),
  sem chamada a serviço externo — funciona em rede isolada.
- Validado por testes (`api/test/qr.test.js`) e decodificado com `zbarimg`.

## PWA — aba Sistema (perfil gerência)
- **Servidor local:** mostra o endereço para o celular (`http://IP:3001`) + todos
  os IPs da máquina, uptime, contadores.
- **Backup:** botão backup agora, lista com restaurar (confirmação).
- **Notificações:** polling a cada 60s na aba, badge de pendentes, botão
  "Verificar agora", baixa manual com nome do responsável.

## Portabilidade

- `GET /api/system` → `AdminController/overview` no NestJS.
- `notify.js` → `AlertsService` com `alertRule/alertEvent` no Prisma + `@Cron`.
- `backup.js` → `scripts/backup.sh` (dump do MySQL) já existente no padrão.
- `persist.js` → repositórios Prisma; `sync.js` → Bull/Redis.
