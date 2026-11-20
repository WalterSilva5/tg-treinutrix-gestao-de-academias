param(
  [switch]$X86
)

# Compila a ponte com o csc.exe que já vem no Windows (sem NuGet/projeto).
# Uso:
#   powershell -ExecutionPolicy Bypass -File build.ps1
#   powershell -ExecutionPolicy Bypass -File build.ps1 -X86   # DLL 32 bits
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$candidatos = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v3.5\csc.exe"
)
$csc = $candidatos | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
  throw 'csc.exe nao encontrado. Instale o .NET Framework 3.5/4.x (Windows Features).'
}

$plataforma = if ($X86) { 'x86' } else { 'anycpu' }
Write-Host "Compilando com $csc ($plataforma)..."
& $csc /nologo /target:exe "/platform:$plataforma" /out:EasyInnerBridge.exe EasyInnerBridge.cs
if ($LASTEXITCODE -ne 0) { throw "csc falhou com codigo $LASTEXITCODE" }
Write-Host "OK: $PSScriptRoot\EasyInnerBridge.exe"
