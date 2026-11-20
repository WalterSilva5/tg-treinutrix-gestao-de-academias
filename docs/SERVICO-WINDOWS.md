# Operação no Windows — serviço, logs, rede e restore

Guia da Fase 1: manter o painel rodando sozinho, com logs, rede estável e
procedimento de restauração testado. Sem Docker, sem NSSM.

## 1. Instalar como serviço (Agendador de Tarefas)

Execute **uma vez**, no usuário que vai operar a academia:

```bat
scripts\instalar-servico.cmd
```

O script cria duas tarefas que iniciam no logon do usuário:

| Tarefa | Processo | Porta |
|--------|----------|-------|
| `PainelCatracaAPI` | `node scripts/servico.js api` | 3001 |
| `PainelCatracaEdge` | `node scripts/servico.js edge` | 3002 |

O supervisor (`scripts/servico.js`) mantém o processo vivo, grava log com
rotação e reinicia em 3 s (até 30 s de backoff) se o processo cair.

Comandos:

```bat
scripts\status-servico.cmd     :: estado das tarefas + health
scripts\parar-servico.cmd      :: para as tarefas e libera as portas
scripts\iniciar-servico.cmd    :: inicia de novo
scripts\remover-servico.cmd    :: remove as tarefas
```

Se a política da máquina exigir iniciar antes do logon, crie as tarefas como
SYSTEM (`/RU SYSTEM`) com o Agendador; o restante do fluxo é igual.

## 2. Logs e rotação

- Pasta: `logs/` (fora do git).
- `logs/api.log` e `logs/edge.log`, com prefixo de data/hora e origem.
- Rotação em `LOG_MAX_BYTES` (padrão 5 MB), mantendo `LOG_KEEP` (padrão 5):
  `api.log`, `api.log.1`, … `api.log.5`.
- O supervisor também registra quedas e reinícios.

## 3. Rede: IP fixo e firewall

1. Reserve o IP da máquina no roteador (DHCP) ou configure IP fixo.
2. Libere as portas (executar como **Administrador**):

```bat
scripts\liberar-firewall.cmd
```

Portas: `3001` (painel/API), `3002` (edge), `3003` (WebSocket do facial).

3. Confirme de outro celular/PC na mesma rede:

```powershell
curl http://IP-DA-MAQUINA:3001/health
curl http://IP-DA-MAQUINA:3002/health
```

## 4. Health consolidado

Com um usuário da equipe:

```powershell
$t = (Invoke-RestMethod -Method Post http://localhost:3001/api/auth/login `
  -ContentType application/json -Body '{"login":"admin","senha":"SUA_SENHA"}').token
Invoke-RestMethod http://localhost:3001/api/health -Headers @{ Authorization = "Bearer $t" } |
  ConvertTo-Json -Depth 4
```

Mostra: versão, commit, uptime, banco SQLite (arquivo/tamanho), contadores,
fila de sync, notificações e o health do edge. O `/health` público continua
leve (ok/storage/versão/commit).

## 5. Restore em instalação limpa

O teste automatizado `api/test/restore-clean.test.js` cobre este fluxo:
banco vazio → backup JSON + fotos de outro diretório → restore → login,
cadastros, eventos, sorteios e foto.

Procedimento manual:

1. Em **Sistema → Backup**, gere um backup e copie `backups/painel_*.json`,
   `backups/photos-*` e, se quiser, `painel_*.db` para um pendrive.
2. Em uma instalação nova (outra pasta/máquina), suba a API uma vez para criar
   `data/` e o admin.
3. Copie os arquivos para a pasta `backups/` da instalação nova.
4. Entre como gerência → **Sistema → Backup → Restaurar** e escolha o arquivo.
5. Confirme: pessoas, fotos, eventos de acesso, eventos da agenda, sorteios e
   configuração de catracas.
6. Reinicie o serviço e confirme que o restore persistiu no SQLite.

## 6. Rotina recomendada

- Diária: conferir `status-servico.cmd` e a fila de sincronização.
- Semanal: baixar um backup para fora da máquina.
- Mensal: testar restore em pasta limpa (seção 5).
- Após atualizar o código: `node --test`, reiniciar as tarefas e conferir
  `/api/health`.

## 7. Problemas comuns

| Sintoma | Ação |
|---------|------|
| Tarefa `Running` mas porta fechada | ver `logs/api.log`; pode ser porta ocupada |
| `EADDRINUSE` no log | outro processo na 3001/3002; usar `parar-servico.cmd` |
| Reinício em loop | ver o erro no log; o backoff chega a 30 s |
| Celular não abre | IP fixo, mesma rede e `liberar-firewall.cmd` |
| Log gigante | ajustar `LOG_MAX_BYTES`/`LOG_KEEP` no ambiente do serviço |
