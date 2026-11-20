# E2E de operação — checklist executado

Execução manual no navegador interno em **2026-11-20**, com a API em
`http://localhost:3001` e o edge simulado em `:3002`.

## Fluxo verificado

- [x] Login `admin` / senha atual → painel abre.
- [x] Menu mostra **Início, Operação, Eventos, Sorteios, Sistema**.
- [x] Console do navegador sem erros após navegar por todas as abas.
- [x] **Sistema → Catracas**: lista, botões Testar/Editar/Excluir, campo de
  detecção e formulário de cadastro presentes.
- [x] **Sistema → Importar cadastros**: input CSV/JSON, prévia e confirmação.
- [x] **Eventos**: criar/editar/cancelar/duplicar e repetir (semanal/mensal).
- [x] **Eventos**: inscrever externo, lista de espera, check-in por código,
  pagamento manual e importação CSV de participantes.
- [x] **Eventos**: link público `/e/<token>` com QR, sem login.
- [x] **Eventos**: relatório por período em CSV/PDF.
- [x] **Sorteios**: criar sorteio de evento, abrir roleta, girar e ver ganhador;
  resultado exibido e lista atualizada.
- [x] **Sorteios**: editar, prévia de elegíveis, múltiplos ganhadores, histórico,
  exclusão de pessoa, exportação e tela pública `/s/<token>`.
- [x] Aba **Sistema → Banco** mostrando `sqlite`.
- [x] `/api/health` com `edge.ok=true` e contadores.
- [x] Reinício do processo da API pelo supervisor: volta em ~3 s.
- [x] Restore em diretório limpo coberto por `api/test/restore-clean.test.js`.

## Observações

- Dados de teste (evento/sorteio “UI”) foram removidos depois.
- O teste de firewall não foi executado nesta máquina por falta de elevação;
  o script `scripts/liberar-firewall.cmd` deve ser rodado como administrador.
- O teste físico da catraca continua em `docs/VALIDACOES-PENDENTES.md`.
