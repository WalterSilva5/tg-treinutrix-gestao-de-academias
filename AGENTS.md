# AGENTS.md — guia para agentes neste repositório

Sistema de gestão de academia com controle de acesso (catraca Topdata + outras).
Leia `docs/HANDOFF-WINDOWS.md` antes de implementar qualquer coisa.

## Stack

- Node.js >= 18 (recomendado 22 LTS), **sem dependências externas**.
- API: `node:http` puro, store em memória, autenticação própria (scrypt + HMAC).
- Front: HTML/CSS/JS único em `front/index.html` + `front/qr.js`, PWA.
- Edge: serviço local que fala com o hardware (`edge-catraca/`).
- Testes: `node --test` (nativo).

## Comandos

```bash
node --test api/test/                 # testes (obrigatório antes de entregar)
node api/src/server.js                # API + PWA em http://localhost:3001
node edge-catraca/src/edge.js         # edge em http://localhost:3002
```

Windows:

```bat
scripts\iniciar-painel.cmd
```

## Onde está cada coisa

| Área | Caminho |
|------|---------|
| Regra de decisão de acesso | `api/src/decision.js` |
| Rotas HTTP + auth | `api/src/server.js` |
| Cadastro/validação de catracas | `api/src/devices.js` |
| Fotos (disco) | `api/src/photos.js` |
| Notificações e inativação | `api/src/notify.js` |
| Backup/restore | `api/src/backup.js` |
| Escopo por perfil | `api/src/scope.js` |
| Drivers de hardware | `edge-catraca/src/*` |
| Contratos SDK Topdata | `docs/SDK-*.md` |
| Backlog do handoff | `docs/HANDOFF-WINDOWS.md` |

## Convenções

- Comentários no código explicam comportamento; não citam tarefa/plano.
- Texto de interface em português; código e nomes técnicos em inglês.
- Toda regra de negócio fica na API; o edge **nunca** decide acesso.
- Toda mudança de comportamento exige teste em `api/test/`.
- Front e API andam juntos: campo novo no store → expor na API → exibir no PWA.

## Proibições

- **Nunca commitar** `EasyInner.dll`, instaladores ou PDFs do Portal Topdata.
- Nunca guardar segredo (`AUTH_SECRET`, senhas) no git — use `data/auth.secret` ou variável de ambiente.
- Não alterar `tesouraria-api` nem outros projetos; este repo é isolado.
- Não rodar `npm install` para adicionar dependência sem aprovação: o projeto é zero-dep por decisão.

## Credenciais de desenvolvimento

- Operador inicial: `admin` / `admin123` (criado só com store vazio; trocar sempre).
- Aluno: matrícula + senha inicial igual à matrícula.
