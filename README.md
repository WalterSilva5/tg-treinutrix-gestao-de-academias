# wsi-topdata-catraca-painel

Sistema de gestão de academia com controle de acesso integrado a catracas:
alunos, planos, frequência, recepção e catraca **Topdata Fit 4** — com suporte
também a outras catracas Topdata (Revolution 4, Box 4, PNE 4), leitor facial e
controladores HTTP genéricos.

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
- `front/` — PWA instalável com tema claro (identidade Treinutrix: laranja `#f97316`,
  teal `#14b8a6`, canvas `#fafaf9`, fonte Inter). Login por perfil, menu lateral e
  painel de gestão com KPIs, tabelas e rodapé Treinutrix.
  Servido pela própria API: um único endereço IP local, ex. `http://192.168.0.10:3001`.
  QR code na recepção aponta para esse endereço.
- `backups/` — snapshots JSON (retidos 7, ignorados no git). Ver `docs/PAINEL-SISTEMA.md`.
- `data/photos/` — fotos de cadastro (fora do git; entram no backup). Aluno vê só a própria.
- `prisma/` — modelo de dados de referência para portar ao MySQL/Prisma do `treina.ai-api`.
- `docs/` — plano, contratos, drivers de catraca e roteiros de teste.

## Rodar no Linux (sem catraca)

```bash
node --version            # >= 18
node --test api/test/     # testes do motor de decisão
node api/src/server.js    # API em http://localhost:3001
node edge-catraca/src/edge.js  # edge em http://localhost:3002
# abrir http://localhost:3001 no navegador (o PWA é servido pela API)
```

Instalação na academia (Windows/Linux, IP local, boot automático,
multi-unidades): ver `docs/INSTALACAO.md` — guia passo a passo para agente de IA.

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

1. Ler `docs/HANDOFF-WINDOWS.md` (estado atual e backlog priorizado).
2. Rodar `scripts\iniciar-painel.cmd` e depois `scripts\verificar.cmd`.
3. Implementar `EasyInnerReal` + servidor WebSocket do facial em C#, conforme
   `edge-catraca/dotnet-adapter/README.md` e `docs/SDK-*-MAPEAMENTO.md`.
4. Ligar o driver real no edge, mantendo o mesmo contrato de `simulators.js`.
5. Seguir o roteiro de bancada em `docs/CONTRATOS-HARDWARE.md`.

Agentes de IA: ler `AGENTS.md` antes de alterar o código.

## SDK oficial

- EasyInner modo On-line mapeado em `docs/SDK-EASYINNER-MAPEAMENTO.md` e
  `edge-catraca/dotnet-adapter/EasyInnerReal.cs` (fonte: exemplo C# oficial).
- DLL, instaladores e manuais do Portal do Integrador não são commitados.

## Licença

Business Source License 1.1 — ver `LICENSE`. Uso não-produtivo livre; produção exige licença comercial do mantenedor. Converte-se para Apache-2.0 em 2030-11-20.
