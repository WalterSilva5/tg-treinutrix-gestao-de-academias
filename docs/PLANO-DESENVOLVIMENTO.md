# Plano de desenvolvimento (sem estimativa de tempo)

## Ordem

1. `prisma/schema.access.prisma` — fundir no `treina.ai-api` quando for portar.
2. `api/` — CRUD + motor `decideAccess` + fila sync. Validar com `node --test api/test/`.
3. `edge-catraca/src/` — heartbeat + `/sim/identify` contra simuladores.
4. `front/index.html` — painel operador contra API local.
5. `edge-catraca/dotnet-adapter/` — implementar no Windows com SDK real, mesmo contrato.

## Regra de ouro

Nenhuma regra de negócio importa DLL ou WebSocket. Tudo passa por
`decideAccess` + `POST /api/identification`. O hardware é detalhe do edge.

## Drivers de equipamento

`docs/DRIVERS-CATRACA.md` define o contrato. Drivers suportados hoje:
`topdata_easyinner` (Fit 4, Revolution 4, Box 4, PNE 4), `topdata_facial_ws`
(leitor facial), `generic_http` (outras marcas com API HTTP) e `simulator`.
Trocar de catraca não altera regras, eventos ou relatórios.

## Portabilidade treina.ai-api

| Aqui | Lá |
|------|----|
| `decision.js` | `back/src/modules/access-decision/` |
| rotas `server.js` | controllers `access-person/device/event` |
| `schema.access.prisma` | merge no `schema.prisma` + SQL manual |
| `front/index.html` | `front/src/app/pages/access-*` |
| fila sync em memória | Bull + Redis (`access-sync`) |
