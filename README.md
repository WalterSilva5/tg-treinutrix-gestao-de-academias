# wsi-topdata-catraca-painel

Painel de controle de acesso para catraca Topdata Fit 4 com leitor facial.

Desenvolvimento **sem catraca**: toda conversa com hardware passa por interfaces + simuladores. O teste físico entra só na validação final.

## Arquitetura

```
front (HTML) <-> api (Node, :3001) <-> store em memória
                      ^
                      | HTTP (heartbeat + identificações)
               edge-catraca (Node, :3002, simulado)
                /                    \
   Placa simulada            Facial simulado
   (EasyInnerReal no Windows, em `edge-catraca/dotnet-adapter/`)
```

- `api/` — API central + motor de decisão ALLOW/DENY. Zero dependências, roda em Linux e Windows com Node 18+.
- `edge-catraca/` — serviço de borda. No Linux usa simuladores. No Windows troca pelos adaptadores reais sem mudar o motor.
- `front/` — painel operador estático, sem build.
- `prisma/` — modelo de dados de referência para portar ao MySQL/Prisma do `treina.ai-api`.
- `docs/` — plano, contratos e roteiros de teste.

## Rodar no Linux (sem catraca)

```bash
node --version            # >= 18
node --test api/test/     # testes do motor de decisão
node api/src/server.js    # API em http://localhost:3001
node edge-catraca/src/edge.js  # edge em http://localhost:3002
# abrir front/index.html no navegador
```

Variáveis de ambiente:

| Var | Default | Descrição |
|-----|---------|-----------|
| `API_PORT` | 3001 | porta da API |
| `EDGE_PORT` | 3002 | porta do edge |
| `API_URL` | http://localhost:3001 | URL da API vista pelo edge |

## Portar para o treina.ai-api

- `prisma/schema.access.prisma` → fundir models em `back/prisma/schema.prisma`, gerar client, aplicar SQL manual.
- `api/src/decision.js` → `back/src/modules/access-decision/`.
- Rotas de `api/src/server.js` → controllers NestJS (`access-person`, `access-device`, `access-event`).
- `front/index.html` → páginas Angular em `front/src/app/pages/access-*`.

## No Windows com catraca

1. Ler `edge-catraca/dotnet-adapter/README.md`.
2. Implementar `EasyInnerReal` + `FacialReal` em C# conforme SDK do Portal de Integradores Topdata.
3. Ligar com `USE_REAL_HARDWARE=1`, manter o mesmo contrato de `simulators.js`.
4. Seguir `docs/TESTE-COM-CATRACA.md` (a criar na bancada).

## Licença

Business Source License 1.1 — ver `LICENSE`. Uso não-produtivo livre; produção exige licença comercial do mantenedor. Converte-se para Apache-2.0 em 2030-11-20.
