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

- `data/state.json` — cadastros, senhas, operadores, regras, fila e
  notificações. Escrita atômica (`tmp` + `rename`) a cada
  `PERSIST_INTERVAL_MS` (3 s) e no desligamento.
- `data/events.jsonl` — histórico de acessos append-only, com compactação a
  cada 5 mil eventos e limite `EVENT_MAX` (50 mil).
- `DATA_DIR`/`DATA_FILE`/`EVENTS_FILE` apontam para disco externo/rede.
- Arquivo corrompido é renomeado (`state.json.corrupt-<ts>`) em vez de apagado;
  a API sobe com o seed e avisa no log.
- O backup (`backup.js`) usa o mesmo serializador, então o snapshot é
  equivalente ao estado persistido.

## Endpoints

| Rota | Origem do padrão |
| --- | --- |
| `GET /api/system` | `health` + `admin/overview`: hostname, plataforma, IPs locais, contadores, `lastBackupAt` |
| `GET /api/overview` | `admin/overview`: KPIs do dia (fuso local), últimas entradas, inadimplentes, dispositivos |
| `GET /api/rules?personId=` · `GET|PUT /api/persons/:id/rules` | regras de horário por equipamento |
| `DELETE /api/persons/:id` | exclusão (LGPD) — só gerência; remove foto/regras e envia `deleteuser` |
| `GET /api/sync` · `POST /api/sync/:id/ack` | fila do leitor (edge confirma `SENT`/`ERROR`) |
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
