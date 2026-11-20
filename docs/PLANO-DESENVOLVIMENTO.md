# Plano de desenvolvimento (sem estimativa de tempo)

## Situação (20/11/2026)

| # | Etapa | Estado |
| --- | --- | --- |
| 1 | `prisma/schema.access.prisma` de referência | pronto (falta portar) |
| 2 | API: CRUD, motor, regras, fila, persistência, backup | pronto |
| 3 | Edge: heartbeat, sync da fila, `/sim/identify`, `/open` | pronto (simulado) |
| 4 | PWA: painéis, cadastro, horário/validade, backup, notificações | pronto |
| 5 | Adaptador real Windows (EasyInner + Facial) | **pendente** |

Testes: `node --test` (unitários + HTTP + persistência). Revisão completa em
`docs/REVISAO.md`.

## Ordem daqui para frente

1. **Persistência definitiva** — portar o store JSON para MySQL/Prisma do
   `treina.ai-api` (models em `prisma/schema.access.prisma`), com fila
   Bull/Redis e dead-letter para `AccessSyncQueue`.
2. **Adaptador real Windows** — completar `EasyInnerReal` (wrapper chamável),
   `FacialReal` (servidor WebSocket com `reg`/`sendlog`/`senduser`) e o polling
   `ReceberDadosOnLine`; validar com `USE_REAL_HARDWARE=1`.
3. **Resiliência offline** — `server_verify=2` ou cache local de regras para a
   academia não parar quando a API cair.
4. **Perfil de dispositivo** — conta de serviço com escopo mínimo para o edge
   (hoje usa gerência).
5. **Operação** — backup agendado + teste de restore, HTTPS na LAN, revisão
   LGPD (consentimento e retenção de fotos), anti-passback com `OUT`.
6. **Evolução de produto** — horário por equipamento na UI, QR code no painel,
   relatórios, edição de operadores, calendário de feriados.

## Regra de ouro

Nenhuma regra de negócio importa DLL ou WebSocket. Tudo passa por
`decideAccess` + `POST /api/identification`. O hardware é detalhe do edge.
O payload da fila (`sync.js`) e o contrato do leitor (`facial-ws.js`) devem
andar juntos — qualquer mudança precisa de teste.

## Portabilidade treina.ai-api

| Aqui | Lá |
| --- | --- |
| `decision.js` | `back/src/modules/access-decision/` |
| rotas `server.js` | controllers `access-person/device/event/rule` |
| `schema.access.prisma` | merge no `schema.prisma` + SQL manual |
| `front/index.html` | `front/src/app/pages/access-*` |
| `sync.js` + fila em memória | Bull + Redis (`access-sync`) |
| `persist.js` (JSON) | repositórios Prisma |
| `notify.js` | `AlertsService` + `@Cron` |
| `backup.js` | `scripts/backup.sh` (dump do MySQL) |
