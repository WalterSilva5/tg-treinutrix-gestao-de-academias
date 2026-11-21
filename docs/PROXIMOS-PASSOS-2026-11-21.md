# Próximos passos — 2026-11-21

Lista priorizada a partir do estado atual. O plano completo está em
`docs/PLANO-COMPLETO.md`; a bancada da catraca em
`docs/VALIDACOES-PENDENTES.md`.

## Base atual

- Commit `c7409a6`; 142 testes passando.
- SQLite, serviço Windows, painel/PWA e edge simulado em operação.
- Planos, mensalidades, relatórios financeiros, eventos e sorteios prontos.
- Catraca/leitor reais: código pronto, **falta validação física**.

## Entregue nesta rodada (2026-11-21)

- [x] Aging 30/60/90 por aluno, com contato e atalho de WhatsApp.
- [x] Trancamento (N dias), retomada e cancelamento com motivo.
- [x] Lista de risco de evasão no dashboard.
- [x] Despesas por categoria e fluxo de caixa (receitas - despesas).
- [x] Aulas com capacidade, reserva pelo PWA, lista de espera, promoção
      automática, check-in por código e cancelamento.
- [x] Histórico de contatos de cobrança/retenção no cadastro.
- [x] 156 testes verdes (classes, risco, aging, fluxo, trancamento e HTTP).

Ainda pendente deste bloco: backup offsite, 2FA e a validação física da
catraca. O restante segue a ordem abaixo.

## Prioridade 0 — agora (1 a 2 semanas)

### 1. Cobrança e inadimplência ativa (feito)
- [ ] Relatório **aging** (30/60/90 dias) por aluno.
- [ ] Modelos de mensagem de vencimento/atraso.
- [ ] Botão “copiar link WhatsApp” com texto pronto (sem API).
- [ ] Registrar contato de cobrança no cadastro (data, canal, responsável).
- [ ] Filtro “promessas de pagamento”.

**Aceite:** gerência vê quem está atrasado, há quanto tempo e consegue cobrar
em 1 clique. **Esforço:** baixo.

### 2. Trancamento e cancelamento de plano (feito)
- [ ] Trancar assinatura por N dias (motivo, início/fim).
- [ ] Retomar automaticamente após o período.
- [ ] Cancelar com motivo e data de saída.
- [ ] Refletir no acesso (`validadeFim`) e no financeiro.
- [ ] Relatório de trancamentos/cancelamentos.

**Aceite:** trancar não apaga histórico; retomada reativa validade. **Esforço:** baixo/médio.

### 3. Risco de churn e retenção (feito)
- [ ] Lista: sem visita há 14/30 dias, plano vencendo, primeira semana sem retorno.
- [ ] Tarefa de contato com responsável, resultado e próxima ação.
- [ ] Marcar como “recuperado” ou “perdido”.
- [ ] Indicador de retenção no dashboard.

**Aceite:** recepção trabalha uma lista diária e vê o resultado. **Esforço:** médio.

### 4. Segurança de gestão
- [ ] 2FA (TOTP) para gerência.
- [ ] Permissões granulares (financeiro, alunos, catraca, sorteios).
- [ ] Sessões ativas e revogação por usuário.
- [ ] Alerta de login de novo dispositivo.

**Aceite:** gerência sem 2FA não acessa financeiro. **Esforço:** médio.

### 5. Backup e continuidade
- [ ] Backup offsite (pasta de rede/nuvem) automático.
- [ ] Teste de restore trimestral documentado.
- [ ] Alerta se o backup falhar.

**Aceite:** restore em máquina limpa sem perda. **Esforço:** baixo.

### 6. Bancada da catraca (bloqueado por hardware)
- [ ] Executar D0–D5 de `docs/PLANO-EXECUCAO.md`.
- [ ] Validar giro, leitor, sync, offline e reconexão.
- [ ] Registrar evidências.

**Aceite:** `docs/VALIDACOES-PENDENTES.md` assinado.

## Prioridade 1 — próximo (2 a 6 semanas)

### 7. Aulas coletivas e agenda (feito)
- [ ] Grade semanal (funcional, spinning, lutas), professor, sala e capacidade.
- [ ] Reserva pelo PWA, lista de espera e cancelamento.
- [ ] Check-in na aula e controle de no-show.
- [ ] Aulas experimentais com link público.

**Aceite:** aluno reserva e recepção vê a lista; vaga libera para a espera.

### 8. PWA do aluno — autoatendimento
- [ ] Carteirinha digital/QR.
- [ ] Faturas e pagamento Pix (gateway).
- [ ] Agendamento de aulas e histórico.
- [ ] Solicitar trancamento/cancelamento.
- [ ] Atualizar dados/foto e consentimento LGPD.

**Aceite:** aluno resolve mensalidade e agenda sem ligar para a recepção.

### 9. Fluxo de caixa e despesas (feito)
- [ ] Cadastro de despesas por categoria/fornecedor.
- [ ] Entradas automáticas das mensalidades pagas.
- [ ] DRE simplificado e saldo do mês.
- [ ] Exportação CSV/PDF.

**Aceite:** gerência fecha o mês com receita, despesa e saldo.

### 10. Comissões e metas
- [ ] Metas por professor/recepção.
- [ ] Regras de comissão (percentual/fixo por venda ou retenção).
- [ ] Relatório de comissão por período.

**Aceite:** fechamento de comissão sem planilha paralela.

### 11. Catraca: visitante e anti-passback
- [ ] Pré-cadastro de visitante por link/QR (validade 1 dia).
- [ ] Anti-passback configurável por equipamento.
- [ ] Painel de ocupação em tempo real.
- [ ] Múltiplas catracas como serviço (`docs/MULTI-CATRACA.md`).

### 12. Relatórios agendados
- [ ] Envio diário/semanal por e-mail (financeiro, frequência, churn).
- [ ] Alertas de meta e de queda de frequência.
- [ ] Exportação programada para pasta de rede.

## Prioridade 2 — depois (1 a 3 meses)

- [ ] Avaliação física (peso, medidas, fotos, evolução).
- [ ] Ficha de treino e integração/SSO com **Treinutrix**.
- [ ] Leads, aula experimental e conversão em aluno.
- [ ] Campanhas de reativação, cupons e NPS.
- [ ] Indicação de aluno com recompensa.
- [ ] Multi-unidade consolidada (uma API central).
- [ ] Runtime Prisma/MySQL (`docs/PORTABILIDADE.md`).
- [ ] NF-e/recibo fiscal e gateway de pagamento.
- [ ] App/PWA push notifications.
- [ ] Portal LGPD (exportar/excluir dados do titular).

## Decisões necessárias antes de começar

| Decisão | Impacto |
|---------|---------|
| WhatsApp: link manual × API oficial | custo e automação |
| Gateway Pix/cartão/boleto | cobrança automática |
| Push: PWA × app nativo | alcance e custo |
| Treinutrix: integração × treino próprio | escopo de treino |
| Preço/regras de trancamento | financeiro e acesso |
| Política de retenção de dados | LGPD |

## Ordem sugerida para as próximas entregas

1. **Aging + lembretes + contato de cobrança** (resultado rápido).
2. **Trancamento/cancelamento** (retenção e financeiro).
3. **Lista de churn + tarefas** (retenção).
4. **Aulas/reservas** (diferencial competitivo).
5. **PWA pagamentos/agendamento**.
6. **Fluxo de caixa/despesas**.
7. **Bancada da catraca** quando o hardware estiver disponível.
8. **2FA/backup offsite** em paralelo.

## Lacunas conhecidas das entregas acima

- Aulas: sem recorrência automática, sem bloqueio por plano e sem no-show.
- Retenção: sem marcação de recuperado/perdido nem tarefa com prazo.
- Contato: WhatsApp é link manual, sem envio automático.
- Fluxo: sem exportação CSV/PDF e sem DRE completo.
- Trancamento: retomada é manual (não existe agendamento automático).
- Backup offsite, 2FA, gateway/Pix, NF-e, push e multiunidade continuam abertos.

## Definição de pronto (cada item)

- [ ] Regra de negócio na API, testada.
- [ ] Tela no painel/PWA.
- [ ] Permissões corretas.
- [ ] Auditoria da ação.
- [ ] Documentação e backup/restore preservados.
- [ ] `node --test` verde e smoke do fluxo.
