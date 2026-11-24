#Requires -Version 5.1
<#
.SYNOPSIS
  Gera o instalador Treinutrix-Setup-*.exe via Inno Setup 6.

.DESCRIPTION
  1. Valida Node >=22 e roda `node --test` (portão do AGENTS.md).
  2. Lê versão de package.json e exporta TREINUTRIX_VERSION.
  3. Baixa Node 22 LTS portable (x64) para installer\runtime\node.exe se ausente.
  4. Chama ISCC.exe em installer\treinutrix.iss -> dist\installer\*.exe

.Uso:
  powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
  powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 -SkipTests
  powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 -NodeVersion 22.14.0

.Requisitos:
  - Inno Setup 6 com ISCC.exe no PATH (https://jrsoftware.org/isdl.php)
  - PowerShell 5.1+ e acesso a nodejs.org para baixar o runtime (ou deixe installer\runtime\node.exe pronto)
#>
param(
  [switch]$SkipTests,
  [string]$NodeVersion = "22.14.0",
  [string]$IsccPath = ""
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

# Garante TLS 1.2 no Windows PowerShell 5.1 antes de baixar o runtime.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch { }

function Fail($msg) { Write-Host "[ERRO] $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "[ok] $msg" -ForegroundColor Green }

# 1. Node local
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Fail "Node.js não encontrado no PATH. Instale Node 22 LTS: https://nodejs.org" }
$ver = & node --version 2>$null
Write-Host "Node: $ver ($($nodeCmd.Source))"
$major = [int](($ver -replace '^v','') -split '\.')[0]
if ($major -lt 22) { Fail "Node >=22 obrigatório. Encontrado $ver" }

# 2. Versão do app
$pkg = Get-Content (Join-Path $raiz "package.json") -Raw | ConvertFrom-Json
$versao = $pkg.version
if (-not $versao) { $versao = "0.1.0" }
$env:TREINUTRIX_VERSION = $versao
Ok "Versão: $versao"

# 3. Testes (portão)
if (-not $SkipTests) {
  Write-Host "`n== node --test ==" -ForegroundColor Cyan
  & node --test
  if ($LASTEXITCODE -ne 0) { Fail "Testes falharam (exit $LASTEXITCODE). Corrija antes de gerar o instalador." }
  Ok "Testes OK"
} else {
  Write-Host "[aviso] Testes pulados (-SkipTests)" -ForegroundColor Yellow
}

# 4. Runtime embarcado
$runtimeDir = Join-Path $raiz "installer\runtime"
$nodeExe = Join-Path $runtimeDir "node.exe"
if (-not (Test-Path $nodeExe)) {
  Write-Host "`n== Baixando Node $NodeVersion (x64) ==" -ForegroundColor Cyan
  New-Item -ItemType Directory -Force $runtimeDir | Out-Null
  $zipUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
  $zipPath = Join-Path $env:TEMP "node-v$NodeVersion-win-x64.zip"
  $extractDir = Join-Path $env:TEMP "node-v$NodeVersion-win-x64"
  Write-Host "GET $zipUrl"
  try {
    # Tenta curl/wget nativo do PowerShell
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
  } catch {
    Fail "Falha ao baixar ${zipUrl}: $($_.Exception.Message) — baixe manualmente e coloque node.exe em installer\runtime\node.exe"
  }
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  Expand-Archive -Path $zipPath -DestinationPath $env:TEMP -Force
  $src = Join-Path $extractDir "node.exe"
  if (-not (Test-Path $src)) { Fail "node.exe não encontrado no ZIP extraído ($extractDir)" }
  Copy-Item $src $nodeExe -Force
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
  Ok "Runtime salvo em $nodeExe"
  # Valida que o binário embarcado também é >=22
  $embVer = & $nodeExe --version
  Write-Host "Runtime embarcado: $embVer"
} else {
  $embVer = & $nodeExe --version 2>$null
  Ok "Runtime já existe: $nodeExe ($embVer)"
}

# 5. ISCC
if ($IsccPath -eq "") {
  $iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($iscc) { $IsccPath = $iscc.Source }
  else {
    $candidatos = @(
      "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
      "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )
    foreach ($c in $candidatos) { if (Test-Path $c) { $IsccPath = $c; break } }
  }
}
if (-not $IsccPath -or -not (Test-Path $IsccPath)) {
  Fail "ISCC.exe não encontrado. Instale Inno Setup 6: https://jrsoftware.org/isdl.php e garanta ISCC.exe no PATH."
}
Write-Host "`nISCC: $IsccPath" -ForegroundColor Cyan

# 6. Compila
$iss = Join-Path $raiz "installer\treinutrix.iss"
if (-not (Test-Path $iss)) { Fail "Arquivo ISS não encontrado: $iss" }

$outDir = Join-Path $raiz "dist\installer"
New-Item -ItemType Directory -Force $outDir | Out-Null

Write-Host "`n== Compilando instalador ==" -ForegroundColor Cyan
& $IsccPath $iss
if ($LASTEXITCODE -ne 0) { Fail "ISCC falhou (exit $LASTEXITCODE)" }

$exe = Get-ChildItem $outDir -Filter "Treinutrix-Setup-*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { Fail "Instalador não gerado em $outDir" }

$tamanhoMb = [math]::Round($exe.Length / 1MB, 1)
Ok "Instalador: $($exe.FullName) - $tamanhoMb MB"
Write-Host @"

Próximos passos:
  1. Teste em VM Windows limpa: duplo clique em $($exe.Name) > Avançar > Instalar
  2. Verifique: http://localhost:3001 (admin/admin123) e scripts\verificar.cmd
  3. Para assinar o .exe (evita SmartScreen): signtool sign /fd SHA256 /a $($exe.FullName)

O desinstalador preserva data\ e backups\ por padrão (pergunta ao remover).
"@
