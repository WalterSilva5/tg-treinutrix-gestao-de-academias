# Plano de execução — 2026-11-21

Documento de acompanhamento do que falta para colocar a academia em operação
real. O histórico completo de solicitações e lacunas está em
`docs/PLANO-COMPLETO.md`; o roteiro técnico da catraca está em
`docs/VALIDACOES-PENDENTES.md`.

## 1. Snapshot atual

| Item | Estado |
|------|--------|
| Código | commit `532518f` (branch `main`, sem push) |
| Testes | 130 passando (`node --test`) |
| Persistência | SQLite `data/painel.db` (sem Docker) |
| API/edge | tarefas `PainelCatracaAPI` e `PainelCatracaEdge` rodando |
| Painel | `http://192.168.1.14:3001` (rede local) |
| Edge | `http://192.168.1.14:3002` (simulado) |
| Catraca real | **não validada** — próxima etapa |
| Backup | manual + automático diário; restore coberto por teste |

## 2. Fases do projeto

| Fase | Entrega | Estado |
|------|---------|--------|
| 1 | Serviço Windows, logs, health, restore | ✅ |
| 2 | Eventos completos (link público, espera, check-in) | ✅ |
| 3 | Sorteios (edição, auditoria, múltiplos, tela pública) | ✅ |
| 4 | Importação (mapeamento, upsert, atômica, fotos) | ✅ |
| 5 | Catraca/leitor reais | 🟡 avançada; falta bancada |
| 6 | Segurança/LGPD (cookie, CSP, auditoria, retenção) | ✅ |
| 7 | Relatórios, PWA do aluno, portabilidade | ✅ |

## 3. Objetivo imediato: fechar a Fase 5

### 3.1 Pré-requisitos de bancada

- [ ] Catraca Topdata (modelo e firmware anotados).
- [ ] Leitor facial e fonte/cabo.
- [ ] `EasyInner.dll` + SDK do Portal do Integrador instalados.
- [ ] PC do edge na mesma sub-rede da catraca (ou IP da catraca ajustado).
- [ ] Porta TCP da catraca confirmada (3000 × 3570).
- [ ] Backup recente e `node --test` verde antes de começar.
- [ ] `docs/VALIDACOES-PENDENTES.md` impresso/aberto.

### 3.2 Cronograma sugerido (bancada)

| Dia | Foco | Critério para avançar |
|-----|------|------------------------|
| D0 | Rede, DLL, `build.ps1`, bridge `--ip` | `/hardware` mostra `catraca.conectado:true` |
| D1 | Leitor facial (`reg`, `setdevinfo`, `sendlog`) | leitor conecta e responde `access` |
| D2 | Cadastro + sync + reconhecimento | aluno cadastrado aparece no leitor e libera |
| D3 | Matriz de decisão (ativo, vencido, horário, score) | 5 cenários com evento correto |
| D4 | Resiliência (queda/reconexão/24h) | reconecta sozinho e mantém fila |
| D5 | Evidências e go/no-go | checklist assinado |

### 3.3 Comandos de referência

```powershell
# bridge
cd edge-catraca\dotnet-adapter
powershell -ExecutionPolicy Bypass -File build.ps1   # -X86 se DLL 32 bits
.\EasyInnerBridge.exe --port 5011 --inner 1 --ip 192.168.0.100 --porta-inner 3000

# edge real (parar o serviço simulado antes)
cmd /c scripts\parar-servico.cmd
$env:USE_REAL_HARDWARE='1'
$env:EDGE_TOKEN='um-token-forte'
node edge-catraca/src/edge.js

# diagnóstico
curl http://localhost:3002/hardware
# painel: Sistema -> Catracas -> Diagnóstico / Reiniciar bridge
```

### 3.4 Evidências a registrar

| Teste | Evidência |
|-------|-----------|
| Bridge on-line | log `[bridge] EasyInner on-line` + `/hardware` |
| `reg` do facial | log `[facial] registrado sn=...` |
| Sync com foto | fila `SENT` + usuário no leitor |
| ALLOW | evento no painel + giro |
| DENY vencido | evento `FORA_VALIDADE` |
| DENY horário | evento `HORA_NAO_PERMITIDA` |
| Manual | giro + evento `MANUAL_OPERADOR` |
| 24 h | sem travar polling/reconexão |

## 4. Decisões pendentes (precisam da academia)

| Decisão | Opções | Impacto |
|---------|--------|---------|
| IP da catraca/PC | manter `192.168.0.x` × mudar para `192.168.1.x` | rede/edge |
| Porta da catraca | 3000 × 3570 | bridge |
| Papel do leitor | facial avulso × integrado à catraca | fluxo de acesso |
| Retenção de fotos | 6 meses × 1 ano × enquanto ativo | LGPD/backup |
| Go-live | piloto 1 semana × direto | risco operacional |

## 5. Plano de go-live

1. **Piloto assistido (1 semana):** catraca em paralelo ao processo atual;
   conferir eventos, presença e fila diariamente.
2. **Treinamento:** recepção (liberação manual, visitante, renovação, inativar),
   gerência (sorteios, importação, relatórios, auditoria).
3. **Rotina:** backup diário para fora da máquina; conferir notificações;
   revisar rostos desconhecidos.
4. **Segurança:** trocar `admin123`, senhas iniciais dos alunos, definir
   `COOKIE_SECURE` se houver HTTPS e revisar firewall.
5. **Aceite final:** checklist de `docs/VALIDACOES-PENDENTES.md` + restore
   testado + recepção operando sem suporte.

## 6. Backlog após o go-live (não bloqueante)

- [ ] Modo offline do leitor (`setdevlock`/`getalllog`).
- [ ] TLS no WebSocket do facial via proxy.
- [ ] Múltiplas catracas como serviço no Windows (`docs/MULTI-CATRACA.md`).
- [ ] Relatórios agendados/exportação automática.
- [ ] Portar runtime para NestJS/Prisma/MySQL (`docs/PORTABILIDADE.md`).
- [ ] Multi-unidade centralizada.
- [ ] Notificação ao ganhador por WhatsApp/e-mail (se contratado).

## 7. Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| DLL/firmware divergir do exemplo | bridge configurável; validar no D0 |
| Rede isolada/porta errada | diagnóstico TCP + fallback 3000/3570 |
| Leitor não responder ao `reg` | conferir IP/porta e modo online; log do edge |
| API cair durante acesso | edge falha fechado e avisa no display |
| Perda de dados | SQLite + backup diário + restore testado |
| Foto/rosto desconhecido | retenção de 30 dias e acesso restrito |

## 8. Definição de pronto (projeto)

- [ ] Catraca libera e nega nos cenários reais.
- [ ] Leitor cadastra/reconhece e sincroniza.
- [ ] Reinício preserva dados; backup/restore validado.
- [ ] Recepção treinada e senhas padrão alteradas.
- [ ] Evidências da bancada anexadas ao repositório/registro da academia.
- [ ] Tag de release e push autorizado.

## 9. Próxima ação

Assim que a catraca estiver acessível: executar a seção 3.2 (D0) e registrar o
resultado no quadro da seção 3.4. Sem hardware, o sistema permanece em modo
simulado e todas as demais funções continuam operacionais.
