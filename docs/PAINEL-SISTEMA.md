# Painel Sistema — backup, máquina local e notificações

Login e senha (ver `api/src/auth.js`): hash scrypt, token HMAC 12h. Primeiro
operador via `SEED_ADMIN_LOGIN/SEED_ADMIN_PASSWORD` (padrão admin/admin123 —
trocar na instalação). Aluno entra com matrícula + senha (inicial = matrícula).
Gerência gerencia operadores em `GET/POST /api/users`; troca de senha em
`POST /api/auth/change-password`. Edge usa conta de serviço
(`EDGE_LOGIN/EDGE_PASSWORD`).

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

Snapshot JSON do store em `backups/painel_<iso>.json` mais a pasta
`photos-<iso>/` com as fotos do cadastro. Retenção dos 7 mais recentes.
`BACKUP_DIR` via env (testes usam tmp; produção: disco externo/rede).
Restore valida o nome (`painel_*.json`, anti path-traversal) e o schema (`v:1`),
e devolve as fotos do snapshot quando a pasta existir.

## Fotos (`api/src/photos.js`)

- Armazenadas em disco (`PHOTO_DIR`, padrão `data/photos/`), fora do git.
- Validação por assinatura real do arquivo (JPEG/PNG/WebP) e limite `PHOTO_MAX_BYTES`.
- `POST /api/persons/:id/photo` — operação ou o próprio aluno; `GET` aceita `?t=<token>`
  para funcionar em `<img>`; `DELETE` só operação.
- Resposta da pessoa traz `foto: { ext, mime, bytes, updatedAt }` e `enrollid` numérico.
- A fila de sincronização leva `setuserinfo` com `backupnum 50` e a URL da foto,
  que o edge baixa para enviar ao leitor facial.

## Interface (PWA)

- Tema claro padrão com alternância para escuro (botão na barra lateral, persistido).
- Avisos em toast (não bloqueiam a tela) para cadastro, renovação, backup e erros.
- Dashboard com KPIs, gráfico dos últimos 7 dias e lista de **presentes agora**.
- Busca por nome/matrícula/Treinutrix e filtros por tipo/situação na lista de pessoas.
- Renovação rápida de plano (+30 e +90 dias) direto na linha da pessoa.

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
- `backup.js` → `scripts/backup.sh` (SQLite `.backup`) já existente no padrão.
