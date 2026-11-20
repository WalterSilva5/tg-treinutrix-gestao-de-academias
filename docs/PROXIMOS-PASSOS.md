# Próximos passos

Roadmap de execução, em ordem. Cada item tem **como validar** — se a validação
não passar, não avance. Contexto completo em `docs/HANDOFF-WINDOWS.md`.

## Fase 1 — Colocar no ar no Windows (operação assistida)

- [ ] Instalar Node.js 22 LTS e Git na máquina da academia.
- [ ] Clonar o repositório e rodar `scripts\iniciar-painel.cmd`.
- [ ] Rodar `scripts\verificar.cmd` (testes + health + IP).
- [ ] Fixar IP da máquina (reserva DHCP no roteador) e liberar TCP 3001/3002.
- [ ] Entrar em `http://<IP>:3001` com `admin` / `admin123` e **trocar a senha**.
- [ ] Criar operadores reais em **Sistema → Operadores**.
- [ ] Fazer o primeiro backup e guardar fora da máquina.
- [ ] Configurar início automático (Agendador de Tarefas ou NSSM).
- [ ] Imprimir o QR de acesso (**Compartilhar acesso**) e colar na recepção.

**Validação:** reiniciar o PC e conseguir abrir o painel pelo celular sem
intervenção manual.

## Fase 2 — Persistência (bloqueante para uso real)

Hoje os dados vivem em memória e somem ao reiniciar.

- [ ] Escolher SQLite local (`node:sqlite` no Node 22+).
- [ ] Criar camada de repositório substituindo `api/src/store.js` sem mudar as rotas.
- [ ] Migrar `persons`, `devices`, `users`, `rules`, `events`, `syncQueue`,
      `notifications` e `meta`.
- [ ] Incluir o arquivo do banco no backup (`api/src/backup.js`).
- [ ] Teste de reinício: criar pessoa, reiniciar, conferir que continua lá.

**Validação:** `node --test api/test/` verde + reinício preservando cadastros e eventos.

## Fase 3 — Catraca real (EasyInner)

- [ ] Baixar DLLs e exemplos no Portal do Integrador.
- [ ] Registrar a DLL (`regsvr32` ou instalador) e validar com o exemplo oficial.
- [ ] Implementar `EasyInnerReal` em C# (`edge-catraca/dotnet-adapter/`).
- [ ] Ligar no edge mantendo o contrato `liberar(direcao)` / `mensagem(texto)`.
- [ ] Configurar IP e porta da catraca no cadastro de equipamento.
- [ ] Testar: identificação liberada, negada por plano vencido e negada por horário.
- [ ] Ajustar heartbeat para o `id` do equipamento cadastrado.

**Validação de bancada:** um giro liberado e um negado, os dois aparecendo em
**Operação → Eventos** com motivo correto.

## Fase 4 — Leitor facial

- [ ] Implementar servidor WebSocket no edge (`reg`, `sendlog`, `senduser`).
- [ ] Responder `reg` sempre (senão o leitor desconecta).
- [ ] Consumir `GET /api/sync`, enviar `setuserinfo` e marcar `SENT`/`ERROR`.
- [ ] Enviar foto (buscar em `/api/persons/:id/photo`) no `backupnum: 50`.
- [ ] Configurar `server_verify: 1` no leitor.
- [ ] Testar cadastro de 3 pessoas e reconhecimento das 3.

**Validação:** cadastrar aluno no painel → aparece no leitor → rosto libera o giro.

## Fase 5 — Piloto e rotina

- [ ] Rodar 1 semana em paralelo com o processo atual.
- [ ] Conferir diariamente: eventos, presentes, fila de sincronização.
- [ ] Treinar a recepção: liberação manual, visitante, renovação, inativar.
- [ ] Definir rotina: backup diário, quem confere notificações, prazo de retenção de foto.
- [ ] Registrar consentimento de uso da biometria (LGPD).
- [ ] Ajustar horários/planos conforme a operação real.

**Validação:** recepção opera um dia inteiro sem suporte técnico.

## Fase 6 — Evolução

- [ ] Relatórios por período (frequência, inadimplência, picos).
- [ ] PWA do aluno com plano, frequência e link Treinutrix.
- [ ] Múltiplas catracas na mesma unidade (entrada/saída).
- [ ] Portar a API para NestJS/Prisma no `treina.ai-api`.
- [ ] Centralização multi-unidade.

## Decisões pendentes

| Decisão | Opções | Impacto |
|---------|--------|---------|
| Banco local | SQLite × portar Prisma/MySQL | define Fase 2 |
| Retenção de fotos | 6 meses × 1 ano × enquanto ativo | LGPD e backup |
| Quem aprova reativação | gerência × recepção | regra de negócio |
| Catracas por unidade | 1 × 2 (entrada/saída) | direção `OUT` |

## Critério de go-live

1. Reinício não perde dados.
2. Catraca libera e nega corretamente.
3. Facial cadastra e reconhece.
4. Backup restaurável com fotos.
5. Recepção treinada e senha padrão alterada.
