# Instalação — guia para agente de IA

Objetivo: deixar API + edge + PWA rodando no PC da academia (Windows) ou em
servidor Linux, acessível pelos celulares na mesma rede. Sem DNS, sem exposição
externa.

> Convenção: comandos em bloco `cmd`/`bash` são para execução literal pelo
> agente. Após cada etapa há um **check** com saída esperada.

## 1. Pré-requisitos

| Item | Academia (Windows, com catraca) | Servidor alternativo (Linux) |
|------|----------------------------------|-------------------------------|
| SO | Windows 10/11 64-bit | qualquer distro atual |
| Node.js | >= 18 (https://nodejs.org, LTS) | >= 18 via gerenciador de pacotes |
| Rede | IP fixo + mesma sub-rede da catraca | IP fixo na LAN |
| Hardware real | EasyInner.dll registrada + SDK facial | não (só simuladores) |
| Portas livres | 3001 (API/PWA), 3002 (edge) | idem |

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

## 3. Subir API + edge (validação manual)

Primeiro acesso: login `admin` / senha `admin123` (troque em seguida na aba
Sistema → Operadores, ou via botão Trocar senha). Para produção, defina antes
de subir: `SEED_ADMIN_LOGIN`, `SEED_ADMIN_PASSWORD`, `AUTH_SECRET` e
`EDGE_LOGIN`/`EDGE_PASSWORD` iguais ao operador do edge.

Windows (`cmd`):

```cmd
set API_PORT=3001
start "painel-api" node api\src\server.js
set EDGE_PORT=3002
start "painel-edge" node edge-catraca\src\edge.js
```

Linux (`bash`):

```bash
API_PORT=3001 node api/src/server.js &
EDGE_PORT=3002 node edge-catraca/src/edge.js &
```

Checks (qualquer SO):

```bash
curl http://localhost:3001/health
# {"ok":true}
curl http://localhost:3002/health
# {"ok":true,"device":"dev_fit4_01","mode":"SIMULADO"}
curl http://localhost:3001/api/system
# JSON com hostname, ips[], counts{}
```

Teste de fluxo (liberação simulada):

```bash
curl -X POST http://localhost:3002/sim/identify ^
  -H "Content-Type: application/json" ^
  -d "{\"person_id\":\"per_personal_01\",\"score\":0.95}"
# decisao.allow = true
```

## 4. Testes automatizados

```bash
node --test api/test/
```

Esperado: `pass 28, fail 0` (o número cresce com o projeto; o que importa é `fail 0`).

## 5. Rede local: IP fixo + acesso mobile

1. Fixar IP do PC (ex.: `192.168.1.10`): painel de rede do SO ou reserva DHCP no roteador.
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

## 6. Subir junto com o PC (produção)

Windows — Agendador de Tarefas (recomendado, sem dependência extra):

1. Agendador de Tarefas → Criar Tarefa → "Ao iniciar" + "com privilégios mais altos".
2. Ação 1: `node.exe` args `C:\caminho\api\src\server.js`, com variável `API_PORT=3001`.
3. Ação 2: `node.exe` args `...\edge-catraca\src\edge.js`, com `EDGE_PORT=3002` e `API_URL=http://localhost:3001`.
4. Reiniciar e repetir os checks da seção 3.

Alternativa: NSSM (serviço Windows) com os mesmos comandos e envs.

Linux — systemd (`/etc/systemd/system/painel-api.service`):

```ini
[Unit]
Description=Painel Catraca API
After=network.target

[Service]
WorkingDirectory=/opt/wsi-topdata-catraca-painel
Environment=API_PORT=3001
Environment=BACKUP_DIR=/var/backups/painel
ExecStart=/usr/bin/node api/src/server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Repetir para o edge (`EDGE_PORT=3002`, `API_URL=http://localhost:3001`).
Ativar: `sudo systemctl enable --now painel-api painel-edge`.

## 7. Backups em produção

- Definir `BACKUP_DIR` para disco externo/rede (padrão: `backups/` do repo, ignorado no git).
- A aba Sistema lembra backup a cada 24h via notificação; retenção padrão: 7 arquivos (`BACKUP_KEEP`).
- Check: `GET /api/backup` lista; `POST /api/backup` gera na hora.

## 8. Com catraca real (Windows)

1. Obter no Portal do Integrador Topdata: instalador das DLLs + SDK EasyInner + SDK Leitor Facial.
2. Instalar DLLs (instalador ou `regsvr32`) — ver `edge-catraca/dotnet-adapter/README.md`.
3. Implementar `EasyInnerReal`/`FacialReal` em C# conforme `docs/SDK-EASYINNER-MAPEAMENTO.md` e `docs/SDK-FACIAL-MAPEAMENTO.md`.
4. Configurar o leitor: IP do servidor no leitor, modo online (`setdevinfo.server_verify=1`), responder `reg` (obrigatório).
5. Roteiro de bancada: `docs/CONTRATOS-HARDWARE.md` + checklist do `docs/PLANO-DESENVOLVIMENTO.md`.

## 9. Multi-academia (outras unidades)

Repetir seções 1–6 em cada unidade (uma instalação por rede local). Regras:

- Um `DEVICE_ID` por catraca; `API_URL` do edge aponta para a API da mesma unidade.
- Não compartilhar `backups/` entre unidades; cada uma tem o seu.
- Futuro centralizado (treina.ai-api): trocar store em memória por Prisma/MySQL e apontar todas as unidades para a mesma API — contratos HTTP não mudam.

## 10. Solução de problemas

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| `curl :3001` recusa | API não subiu / porta ocupada | ver log, trocar `API_PORT` |
| Celular não abre | Wi-Fi diferente, firewall, IP mudou | mesmo SSID, liberar 3001, refazer seção 5 |
| Edge `API fora do ar` | `API_URL` errado | exportar `API_URL=http://<IP-API>:3001` |
| Notificação device-offline | sem heartbeat | subir edge, check `:3002/health` |
| `fail > 0` nos testes | código alterado | corrigir antes de levar à academia |

## 11. Variáveis de ambiente (resumo)

| Var | Default | Onde |
|-----|---------|------|
| `API_PORT` | 3001 | API |
| `EDGE_PORT` | 3002 | edge |
| `API_URL` | http://localhost:3001 | edge |
| `DEVICE_ID` | dev_fit4_01 | edge |
| `BACKUP_DIR` | ./backups | API |
| `BACKUP_KEEP` | 7 | API |
| `NOTIFY_INTERVAL_MS` | 300000 | API |
| `AUTH_SECRET` | aleatório (reinício invalida tokens) | API — defina um fixo em produção |
| `SEED_ADMIN_LOGIN` / `SEED_ADMIN_PASSWORD` | admin / admin123 | API — primeiro operador |
| `EDGE_LOGIN` / `EDGE_PASSWORD` | admin / admin123 | edge — conta de serviço (operador) |
