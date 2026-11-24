# Instalador Windows — TG Treinutrix

Wizard `.exe` para leigos: duplo clique, Avançar, Abrir.

## O que o instalador faz

* Copia para `C:\Program Files\Treinutrix\`: `api/`, `edge-catraca/`, `front/`, `scripts/`, `prisma/`, `package.json` e o **Node 22 portátil** (`runtime/node.exe` — sem exigir Node pré-instalado).
* Cria `data/`, `data/photos/`, `backups/`, `logs/` com permissão de escrita.
* Gera `data/auth.secret` na primeira instalação (mesma lógica de `scripts/iniciar-painel.cmd`).
* Libera `TCP 3001-3003` no Firewall (API/edge/facial).
* Registra `PainelCatracaAPI` e `PainelCatracaEdge` no Agendador de Tarefas (logon) usando o Node embarcado e `scripts/servico.js` (logs com rotação em `logs/`).
* Cria atalhos no Menu Iniciar e opcional na Área de Trabalho apontando para `http://localhost:3001`.
* Inicia os serviços na hora para validação imediata.

Na desinstalação: para as tarefas, remove a regra de firewall e **pergunta** se deve manter `data/` e `backups/` (evita apagar cadastros/fotos por engano).

> DLLs Topdata (`EasyInner.dll`) **nunca** entram no instalador — são instaladas pelo instalador oficial do Portal do Integrador e registradas com `regsvr32` conforme `docs/INSTALACAO.md`.

## Gerar o .exe

Pré-requisito único na máquina de build: **Inno Setup 6.3+** (https://jrsoftware.org/isdl.php) com `ISCC.exe` no PATH.

```powershell
# na raiz do repo
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
# ou sem rodar testes:
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 -SkipTests
```

O script:

1. Valida `node --version >=22` e roda `node --test` (portão).
2. Lê `package.json:version` → `TREINUTRIX_VERSION` (nome do `.exe`).
3. Baixa `node-v22.14.0-win-x64.zip` de `nodejs.org` e extrai `installer/runtime/node.exe` se ainda não existir (para build offline, basta colocar o `node.exe` lá manualmente).
4. Chama `ISCC.exe installer/treinutrix.iss` → `dist/installer/Treinutrix-Setup-<versao>.exe`.

## Testar

1. Em VM Windows 10/11 limpa, duplo clique no `.exe` gerado.
2. Marque "Iniciar automaticamente" e "Liberar no Firewall".
3. Ao final marque "Abrir o painel agora" → `http://localhost:3001` com `admin` / `admin123`.
4. Valide em `cmd` na pasta instalada:
   ```
   scripts\verificar.cmd
   scripts\status-servico.cmd
   curl http://localhost:3001/health
   curl http://localhost:3002/health
   ```

## Assinatura (opcional, recomendado)

Para evitar alerta do SmartScreen em máquinas sem prévia confiança:

```powershell
signtool sign /fd SHA256 /a /tr http://timestamp.digicert.com /td SHA256 dist\installer\Treinutrix-Setup-*.exe
```

## Personalização

* Porta/firewall: edite `[Tasks] firewall` e as linhas `netsh` em `treinutrix.iss`.
* Autostart: desmarque a task `autostart` no wizard ou remova depois com `scripts\remover-servico.cmd`.
* Instalação silenciosa: `Treinutrix-Setup-*.exe /SILENT` ou `/VERYSILENT`.
