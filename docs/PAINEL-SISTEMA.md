# Painel Sistema — backup, máquina local e notificações

Base de padrões: `wsi-invest-ai` (`back/src/modules/admin` overview,
`alerts` regras + dedup + `alertEvent`, `scheduler` cron, `scripts/backup.sh`).

## Endpoints

| Rota | Origem do padrão |
|------|------------------|
| `GET /api/system` | `health` + `admin/overview`: hostname, plataforma, IPs locais, contadores, `lastBackupAt` |
| `GET /api/notifications` | `alerts/list` |
| `POST /api/notifications/evaluate` | `alerts/evaluate` (aqui sem tenant) |
| `POST /api/notifications/:id/ack` | baixa manual com `por` (responsável) |
| `POST /api/backup`, `GET /api/backup`, `POST /api/backup/restore` | `scripts/backup.sh` (snapshot + retenção `BACKUP_KEEP=7`) |

## Regras de notificação (`api/src/notify.js`)

1. **BACKUP** — sem backup há 24h (`BACKUP_INTERVAL_MS`, env `NOTIFY_INTERVAL_MS` p/ scheduler).
2. **DISPOSITIVO** — sem heartbeat há 10 min (`DEVICE_STALE_MS`).
3. **SINCRONISMO** — itens `PENDING` na fila.
4. **INATIVACAO** — plano vencido há 90 dias: marca `ativo=false` sozinho, enfileira
   `UPSERT` no leitor e avisa (reativação é manual no card Pessoas).
5. **METRICAS** — resumo diário (eventos allow/deny, pessoas, dispositivos), chave `digest:AAAA-MM-DD`.

Dedup por `key`: pendente com mesma chave não duplica. Baixa exige responsável;
resolvida não reabre (novo ciclo gera nova chave — ex. digest do dia seguinte).

## Backup (`api/src/backup.js`)

Snapshot JSON do store em `backups/painel_<iso>.json`, retenção dos 7 mais
recentes. `BACKUP_DIR` via env (testes usam tmp; produção: disco externo/rede).
Restore valida o nome (`painel_*.json`, anti path-traversal) e o schema (`v:1`).

## PWA — aba Sistema (perfil gerência)

- **Servidor local:** mostra o endereço para o celular (`http://IP:3001`) + todos
  os IPs da máquina, uptime, contadores.
- **Backup:** botão backup agora, lista com restaurar (confirmação).
- **Notificações:** polling a cada 60s na aba, badge de pendentes, botão
  "Verificar agora", baixa manual com nome do responsável.

## Portabilidade

- `GET /api/system` → `AdminController/overview` no NestJS.
- `notify.js` → `AlertsService` com `alertRule/alertEvent` no Prisma + `@Cron`.
- `backup.js` → `scripts/backup.sh` (SQLite `.backup`) já existente no padrão.
