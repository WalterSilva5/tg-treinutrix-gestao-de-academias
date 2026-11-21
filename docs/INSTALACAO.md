# Instalação — guia para agente de IA

Objetivo: deixar API + edge + PWA rodando no PC da academia (Windows) ou em
servidor Linux, acessível pelos celulares na mesma rede. Sem DNS, sem exposição
externa.

> Convenção: comandos em bloco `cmd`/`bash` são para execução literal pelo
> agente. Após cada etapa há um **check** com saída esperada.

## 1. Pré-requisitos

| Item | Academia (Windows, com catraca) | Servidor alternativo (Linux) |
| --- | --- | --- |
| SO | Windows 10/11 64-bit | qualquer distro atual |
| Node.js | >= 22 (https://nodejs.org, LTS; `node:sqlite` nativo) | >= 22 via gerenciador de pacotes |
| Rede | IP fixo + mesma sub-rede da catraca | IP fixo na LAN |
| Hardware real | EasyInner.dll registrada + SDK facial | não (só simuladores) |
| Portas livres | 3001 (API/PWA), 3002 (edge) | idem |
| Fuso horário | correto (o painel usa o relógio local) | idem |

Check Node:

```cmd
node --version
```

Esperado: `v18+` ou `v2x`.

## 2. Obter o código

```cmd
git clone https://github.com/WalterSilva5/wsi-topdata-catraca-painel.git
cd wsi-topdata-catraca-painel
```

Sem git: baixar o ZIP do repositório e extrair.

## 3. Configurar antes do primeiro boot (produção)

Defina no ambiente (ou use `.env.example` como referência):

| Var | Produção |
| --- | --- |
| `SEED_ADMIN_PASSWORD` | senha forte — sem isso o padrão `admin123` é usado e logado |
| `AUTH_SECRET` | segredo longo e fixo (tokens invalidam ao reiniciar sem ele) |
| `EDGE_LOGIN`/`EDGE_PASSWORD` | conta de serviço do edge (hoje precisa ser gerência) |
| `SEED_DEMO` | `0` para não criar alunos de demonstração |
| `DATA_DIR` (ou `DATA_FILE`/`EVENTS_FILE`) | disco confiável/externo; o padrão é `./data` |
| `BACKUP_DIR` | disco externo/rede |
| `EDGE_URL` | URL do edge vista pela API (`http://localhost:3002` por padrão) |
| `EDGE_TOKEN` | opcional: protege `POST /open` no edge |

Windows (`cmd`), antes de iniciar:

```cmd
set API_PORT=3001
set AUTH_SECRET=troque-por-um-segredo-longo
set SEED_ADMIN_PASSWORD=troque-esta-senha
set SEED_DEMO=0
set EDGE_PASSWORD=troque-esta-senha
```

Linux (`bash`):

```bash
export API_PORT=3001 AUTH_SECRET=troque-por-um-segredo-longo \
       SEED_ADMIN_PASSWORD=troque-esta-senha SEED_DEMO=0 \
       EDGE_PASSWORD=troque-esta-senha
```

## 4. Subir API + edge (validação manual)

Windows (`cmd`):

```cmd
start "painel-api" node api\src\server.js
set EDGE_PORT=3002
set API_URL=http://localhost:3001
start "painel-edge" node edge-catraca\src\edge.js
```

Linux (`bash`):

```bash
node api/src/server.js &
EDGE_PORT=3002 API_URL=http://localhost:3001 node edge-catraca/src/edge.js &
```

Checks (qualquer SO):

```bash
curl http://localhost:3001/health
# {"ok":true}
curl http://localhost:3002/health
# {"ok":true,"device":"dev_fit4_01","mode":"SIMULADO","api":"ok"}
```

Fluxo de ponta a ponta (cadastro → regra → decisão → sync → liberação):

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","senha":"SUA_SENHA"}' | python -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -s -X POST http://localhost:3001/api/persons \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"nome":"Aluno Teste","tipo":"ALUNO"}'
# -> enrollid/matrícula; já cria a regra padrão

curl -s -X POST http://localhost:3001/api/identification \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_id":"dev_fit4_01","person_id":"ENROLLID_DO_CADASTRO","metodo":"CARTAO"}'
# -> {"allow":true,"motivo":"OK"}
```

O primeiro boot cria o banco SQLite em `data/painel.db` (e migra automaticamente
um `state.json`/`events.jsonl` antigo, se existir). Reinicie a API e repita o
login: cadastros e eventos devem continuar lá. Não é necessário Docker: o banco
é um arquivo local e entra no backup.

## 5. Testes automatizados

```bash
node --test
```

Esperado: `fail 0` (o número de testes cresce com o projeto). Cobre motor de
decisão, autenticação, regras, fila, notificações, persistência e HTTP.

## 6. Rede local: IP fixo + acesso mobile

> Instalação como serviço, firewall, logs e restore: `docs/SERVICO-WINDOWS.md`.

1. Fixar IP do PC (ex.: `192.168.1.10`): painel de rede do SO ou reserva DHCP.
2. Liberar firewall:
   - Windows: permitir entrada TCP 3001 e 3002 (ou o `node.exe`).
   - Linux: `sudo ufw allow 3001,3002/tcp`.
3. Descobrir o IP a divulgar:

```bash
curl -s http://localhost:3001/api/system
```

   Usar o primeiro endereço de `ips[]`. PWA: `http://<IP>:3001`.
4. Gerar QR code com a URL e fixar na recepção.
5. No celular (mesmo Wi-Fi): abrir o IP, "Adicionar à tela inicial".

> O PWA fala com a API na mesma origem. Não habilite `CORS_ORIGIN` a menos que
> sirva o front em outra origem.

## 7. Subir junto com o PC (produção)

Windows — Agendador de Tarefas (recomendado, sem dependência extra):

1. Agendador de Tarefas → Criar Tarefa → "Ao iniciar" + "com privilégios mais altos".
2. Ação 1: `node.exe` args `C:\caminho\api\src\server.js`, com as variáveis da seção 3.
3. Ação 2: `node.exe` args `...\edge-catraca\src\edge.js`, com `EDGE_PORT=3002`,
   `API_URL=http://localhost:3001` e `EDGE_LOGIN/EDGE_PASSWORD`.
4. Reiniciar e repetir os checks da seção 4.

Alternativa: NSSM (serviço Windows) com os mesmos comandos e envs.

Linux — systemd (`/etc/systemd/system/painel-api.service`):

```ini
[Unit]
Description=Painel Catraca API
After=network.target

[Service]
WorkingDirectory=/opt/wsi-topdata-catraca-painel
Environment=API_PORT=3001
Environment=AUTH_SECRET=troque-por-um-segredo-longo
Environment=SEED_ADMIN_PASSWORD=troque-esta-senha
Environment=SEED_DEMO=0
Environment=DATA_DIR=/var/lib/painel
Environment=BACKUP_DIR=/var/backups/painel
ExecStart=/usr/bin/node api/src/server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Repetir para o edge (`EDGE_PORT=3002`, `API_URL=http://localhost:3001`,
`EDGE_LOGIN/EDGE_PASSWORD`). Ativar:
`sudo systemctl enable --now painel-api painel-edge`.

## 8. Backups em produção

- Definir `BACKUP_DIR` para disco externo/rede (padrão: `backups/` do repo).
- Cada backup gera o JSON do estado **e** a pasta `photos-<stamp>` com as fotos.
- A aba Sistema lembra backup a cada 24h, mas o backup é manual: agende
  `POST /api/backup` (cron/Agendador) ou copie `data/` e `backups/` diariamente.
- Retenção padrão: 7 (`BACKUP_KEEP`).
- **Teste o restore** antes de confiar: aba Sistema → Restaurar (gerência) ou
  `POST /api/backup/restore` com `{"file":"painel_....json"}`.

## 8.1 Fotos e LGPD

- Fotos ficam em `data/photos/` (ou `PHOTO_DIR`), fora do git, e aparecem no painel.
- São dado biométrico sensível: coletar com consentimento registrado, limitar acesso
  (aluno vê só a própria; operação vê todas) e permitir exclusão
  (`DELETE /api/persons/:id/photo` ou exclusão do cadastro pela gerência).
- O leitor facial recebe a foto no cadastro (`setuserinfo`, `backupnum 50`); o edge
  baixa a imagem pela API e converte para base64.
- Ao desligar um aluno, avalie excluir a foto depois do prazo de retenção definido
  pela academia. Eventos históricos não contêm biometria.

## 8. Com catraca real (Windows e outras marcas)

1. Obter no Portal do Integrador Topdata: instalador das DLLs + SDK EasyInner + SDK Leitor Facial.
2. Instalar DLLs (instalador ou `regsvr32`) — ver `edge-catraca/dotnet-adapter/README.md`.
3. Compilar a ponte: `powershell -ExecutionPolicy Bypass -File edge-catraca/dotnet-adapter/build.ps1`
   (use `-X86` se a `EasyInner.dll` for 32 bits).
4. Configurar o leitor: IP do servidor no leitor, modo online (`setdevinfo.server_verify=1`),
   responder `reg` (obrigatório). O edge já hospeda o WebSocket do facial.
5. Subir o edge com `USE_REAL_HARDWARE=1` (desativa `/sim/*`; a catraca usa o
   bridge em `127.0.0.1:5011`) e testar o caminho completo na bancada
   (`docs/CONTRATOS-HARDWARE.md`).

### Outras catracas e controladores

- Catálogo em `GET /api/device-catalog`; cadastro de novas catracas em
  **Operação → Catracas e controladores** (drivers: `topdata_easyinner`,
  `topdata_facial_ws`, `generic_http`, `simulator`).
- Controlador de outra marca com API HTTP: driver `generic_http` no edge,
  apontando `DEVICE_ENDPOINT=http://<ip>:<porta>/open`.
- Marca com SDK proprietário: criar driver no edge seguindo `docs/DRIVERS-CATRACA.md`.
- O restante do sistema (regras, alunos, relatórios) não muda ao trocar de equipamento.

## 9. Multi-academia (outras unidades)

Repetir seções 1–8 em cada unidade (uma instalação por rede local). Regras:

- Um `DEVICE_ID` por catraca; `API_URL` do edge aponta para a API da mesma unidade.
- Não compartilhar `backups/` nem `data/` entre unidades; cada uma tem o seu.
- Futuro centralizado (treina.ai-api): trocar a persistência JSON por Prisma/MySQL
  e apontar todas as unidades para a mesma API — contratos HTTP não mudam.

## 11. Solução de problemas

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| `curl :3001` recusa | API não subiu / porta ocupada | ver log, trocar `API_PORT` |
| Celular não abre | Wi-Fi diferente, firewall, IP mudou | mesmo SSID, liberar 3001, refazer seção 6 |
| Edge `API fora do ar` | `API_URL` errado | exportar `API_URL=http://<IP-API>:3001` |
| Notificação device-offline | sem heartbeat | subir edge, check `:3002/health` |
| `SEM_REGRA` na decisão | pessoa sem regra no equipamento | aba Sistema → Horário (ou `PUT .../rules`) |
| `DEVICE_NAO_ENCONTRADO` | `DEVICE_ID`/`device_id` divergente | conferir `GET /api/devices` e env do edge |
| "Catraca não confirmou a abertura" | `EDGE_URL` errado, edge parado, `EDGE_TOKEN` | conferir `:3002/health` e env da API |
| Login `429` | 5 tentativas erradas em 5 min | aguardar ou reiniciar a API |
| Senha do admin perdida | precisa voltar ao padrão | `scripts\restaurar-admin.bat` (Windows) ou `bash scripts/restaurar-admin.sh` |
| Dados sumiram após reiniciar | `DATA_FILE` em pasta volátil/perdida | conferir `DATA_DIR` e permissões |
| `fail > 0` nos testes | código alterado | corrigir antes de levar à academia |

## 12. Variáveis de ambiente (resumo)

| Var | Default | Onde |
| --- | --- | --- |
| `API_PORT` | 3001 | API |
| `EDGE_PORT` | 3002 | edge |
| `API_URL` | http://localhost:3001 | edge |
| `EDGE_URL` | http://localhost:3002 | API |
| `EDGE_TOKEN` | vazio | edge |
| `DEVICE_ID` | dev_fit4_01 | edge |
| `SYNC_INTERVAL_MS` | 30000 | edge |
| `USE_REAL_HARDWARE` | 0 | edge |
| `DATA_DIR` | ./data | API |
| `DB_FILE` | ./data/painel.db | API — banco SQLite (arquivo local) |
| `DATA_FILE` / `EVENTS_FILE` | legado | API — só para migração do formato antigo |
| `PERSIST_INTERVAL_MS` | 3000 | API |
| `EVENT_MAX` | 50000 | API |
| `BACKUP_INTERVAL_HOURS` | 24 | API — 0 desliga o backup automático |
| `BACKUP_DIR` | ./backups | API |
| `BACKUP_KEEP` | 7 | API |
| `PHOTO_DIR` | ./data/photos | API — fora do git; incluir no backup |
| `PHOTO_MAX_BYTES` | 409600 | API — limite por foto |
| `MIN_SCORE` | 0.7 | API — score mínimo facial |
| `SEED_ADMIN_MUST_CHANGE` | 0 | API — exige troca no primeiro login do admin |
| `COOKIE_SECURE` | 0 | API — 1 atrás de HTTPS |
| `RETENTION_EVENT_DAYS` | 365 | API — retenção de eventos de acesso |
| `RETENTION_EXTERNAL_DAYS` | 365 | API — anonimiza externos antigos |
| `RETENTION_PHOTO_DAYS` | 0 | API — fotos de inativos (0 desliga) |
| `NOTIFY_INTERVAL_MS` | 300000 | API |
| `AUTH_SECRET` | aleatório (reinício invalida tokens) | API — defina um fixo em produção |
| `SEED_ADMIN_LOGIN` / `SEED_ADMIN_PASSWORD` | admin / admin123 | API — primeiro operador |
| `SEED_DEMO` | 1 | API |
| `LOGIN_MAX_FAILS` / `LOGIN_WINDOW_MS` | 5 / 300000 | API |
| `MAX_BODY_BYTES` | 2097152 | API |
| `CORS_ORIGIN` | vazio | API — só se o front estiver em outra origem |
| `EDGE_LOGIN` / `EDGE_PASSWORD` | admin / admin123 | edge — conta de serviço (operador) |
| `DEVICE_DRIVER` | simulator (easyinner com `USE_REAL_HARDWARE=1`) | edge - `simulator` \| `generic_http` \| `easyinner` \| `topdata_facial_ws` |
| `EASYINNER_AUTOSTART` | 1 (Windows) | edge - sobe o bridge C# usando IP/porta do cadastro |
| `EASYINNER_PORT` / `EASYINNER_INNER_PORT` | 5011 / 3000 | edge - porta local do bridge / porta TCP da catraca |
| `FACIAL_WS_PORT` | 3003 | edge - porta do servidor WebSocket do leitor |
| `DEVICE_ENDPOINT` | - | edge - URL do controlador quando `generic_http` |
