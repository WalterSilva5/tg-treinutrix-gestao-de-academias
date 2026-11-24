param(
  [string]$Raiz = (Split-Path -Parent $PSScriptRoot),
  [string]$Node = '',
  [switch]$Autostart,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if (-not $Node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $cmd) { throw 'node.exe não encontrado. Informe -Node com o caminho do runtime.' }
  $Node = $cmd.Source
}
if (-not (Test-Path $Node)) { throw "node.exe não encontrado em $Node" }

$servico = Join-Path $Raiz 'scripts\servico.js'
if (-not (Test-Path $servico)) { throw "scripts\servico.js não encontrado em $Raiz" }

if (-not $DryRun) { New-Item -ItemType Directory -Force (Join-Path $Raiz 'logs') | Out-Null }
$q = [char]34
$tarefas = @(
  @{ Nome = 'PainelCatracaAPI'; Tipo = 'api' },
  @{ Nome = 'PainelCatracaEdge'; Tipo = 'edge' }
)

foreach ($t in $tarefas) {
  $argumentos = $q + $servico + $q + ' ' + $t.Tipo
  if ($DryRun) {
    Write-Host "[dry-run] $($t.Nome) autostart=$([bool]$Autostart) node=$Node args=$argumentos"
    continue
  }
  $acao = New-ScheduledTaskAction -Execute $Node -Argument $argumentos -WorkingDirectory $Raiz
  $config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
  if ($Autostart) {
    $gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    Register-ScheduledTask -TaskName $t.Nome -Action $acao -Trigger $gatilho -Settings $config `
      -Description 'TG Treinutrix - supervisor com logs e reinicio' -Force | Out-Null
  } else {
    Register-ScheduledTask -TaskName $t.Nome -Action $acao -Settings $config `
      -Description 'TG Treinutrix - supervisor com logs e reinicio' -Force | Out-Null
  }
  Start-ScheduledTask -TaskName $t.Nome
  Write-Host "Tarefa iniciada: $($t.Nome)"
}
