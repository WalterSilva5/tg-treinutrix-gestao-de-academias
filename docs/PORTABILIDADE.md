# Portabilidade e multi-unidade

## Estado atual (runtime)

- Runtime **zero-dependência**: API Node + `node:sqlite` (`data/painel.db`).
- O modelo relacional de referência está em `prisma/schema.access.prisma`.
- Não há Docker no ambiente; backup é arquivo local + JSON.

## Exportar os dados para migração

```bash
GET /api/export/dados        # gerência; JSON completo (serialize)
GET /api/backup              # lista snapshots
POST /api/backup             # gera snapshot + .db + fotos
```

O JSON de `/api/export/dados` contém pessoas, dispositivos, usuários, regras,
eventos de acesso, agenda/participantes, sorteios/histórico, importações,
auditoria e meta. Fotos ficam em `data/photos/` (ou no snapshot de backup).

## Portar para Prisma/MySQL (treina.ai-api)

1. Copie os models `Access*` de `prisma/schema.access.prisma` para o schema do
   `treina.ai-api` e rode `prisma migrate`.
2. Implemente repositórios NestJS equivalentes às funções de:
   - `api/src/store.js` + `persist.js` (SQLite → Prisma)
   - `api/src/decision.js` (puro; copiar sem alteração)
   - `api/src/social.js` (eventos/sorteios)
   - `api/src/reports.js` (relatórios)
3. Mantenha os **contratos HTTP** de `docs/CONTRATOS-HARDWARE.md` e
   `docs/SORTEIOS-E-EVENTOS.md`; o edge não precisa mudar.
4. Migre os dados com `/api/export/dados` + script de carga (ou `prisma db seed`).
5. Fotos: copie `data/photos/` para storage equivalente; mantenha a mesma
   convenção `<personId>.<ext>`.
6. Faça o corte com o edge apontando para a nova API; valide sync, decisão e
   relatórios antes de desligar a instalação local.

## Multi-unidade

A instalação atual é **uma unidade por rede local**. Para várias unidades:

- Opção A (recomendada no curto prazo): uma instância por unidade, com backup
  local; consolidar relatórios depois.
- Opção B: API central com `unidadeId` em pessoas, dispositivos, eventos e
  sorteios; edge de cada loja aponta para a central; exige isolamento por
  unidade (escopo/tenant) e cuidado com fuso/horário.
- Não compartilhe `data/` entre unidades; cada uma tem banco e fotos próprios.

## Checklist de migração

- [ ] Schema Prisma aplicado e migrations versionadas.
- [ ] Export completo + fotos copiadas.
- [ ] Script de importação com contagem por tabela.
- [ ] Contratos HTTP preservados (`/api/identification`, `/open`, sync).
- [ ] Edge apontando para a nova API e testado na bancada.
- [ ] Backup/restore da nova base validado.
- [ ] Retenção LGPD e auditoria ativas na nova stack.
