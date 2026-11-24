param(
  [ValidateSet('instalar', 'remover', 'iniciar', 'parar', 'status')]
  [string]$Acao = 'status',
  [int]$ApiPort = 3001,
  [int]$EdgePort = 3002
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
$node = if ($nodeCmd) { $nodeCmd.Source }
  elseif (Test-Path (Join-Path $raiz 'runtime\node.exe')) { Join-Path $raiz 'runtime\node.exe' }
  else { $null }
$tarefas = @(
  @{ Nome = 'PainelCatracaAPI'; Tipo = 'api'; Porta = $ApiPort },
  @{ Nome = 'PainelCatracaEdge'; Tipo = 'edge'; Porta = $EdgePort }
)

function Parar-Portas {
  foreach ($porta in @($ApiPort, $EdgePort)) {
    try {
      $pids = Get-NetTCPConnection -State Listen -LocalPort $porta -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($procId in $pids) {
        if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
      }
    } catch { }
  }
}

function Instalar {
  if (-not $node) { throw 'node.exe não encontrado. Instale Node 22 ou use uma instalação com runtime embarcado.' }
  New-Item -ItemType Directory -Force (Join-Path $raiz 'logs') | Out-Null
  foreach ($t in $tarefas) {
    $argumentos = "`"$($raiz)\scripts\servico.js`" $($t.Tipo)"
    $acao = New-ScheduledTaskAction -Execute $node -Argument $argumentos -WorkingDirectory $raiz
    $gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $t.Nome -Action $acao -Trigger $gatilho -Settings $config `
      -Description 'Painel de acesso da academia (supervisor com logs e reinício)' -Force | Out-Null
    Write-Host "Tarefa criada: $($t.Nome) (porta $($t.Porta))"
  }
  Iniciar
}

function Remover {
  Parar
  foreach ($t in $tarefas) {
    try { Unregister-ScheduledTask -TaskName $t.Nome -Confirm:$false } catch { }
    Write-Host "Tarefa removida: $($t.Nome)"
  }
}

function Iniciar {
  foreach ($t in $tarefas) {
    try { Start-ScheduledTask -TaskName $t.Nome; Write-Host "Iniciada: $($t.Nome)" }
    catch { Write-Warning "Falha ao iniciar $($t.Nome): $($_.Exception.Message)" }
  }
  Start-Sleep -Seconds 3
  Status
}

function Parar {
  foreach ($t in $tarefas) {
    try { Stop-ScheduledTask -TaskName $t.Nome } catch { }
  }
  Start-Sleep -Milliseconds 800
  Parar-Portas
  Write-Host 'Serviços parados.'
}

function Status {
  foreach ($t in $tarefas) {
    try {
      $estado = (Get-ScheduledTask -TaskName $t.Nome -ErrorAction Stop).State
      Write-Host ("{0}: {1}" -f $t.Nome, $estado)
    } catch {
      Write-Host ("{0}: não instalada" -f $t.Nome)
    }
  }
  foreach ($par in @(@('API', $ApiPort), @('Edge', $EdgePort))) {
    $url = "http://127.0.0.1:$($par[1])/health"
    try {
      $r = Invoke-RestMethod -Uri $url -TimeoutSec 3
      Write-Host ("{0}: OK {1}" -f $par[0], ($r | ConvertTo-Json -Compress))
    } catch {
      Write-Host ("{0}: sem resposta em {1}" -f $par[0], $url)
    }
  }
  $log = Join-Path $raiz 'logs'
  if (Test-Path $log) {
    Get-ChildItem $log -File | Sort-Object LastWriteTime -Descending |
      Select-Object -First 4 Name, Length, LastWriteTime | Format-Table -AutoSize
  }
}

switch ($Acao) {
  'instalar' { Instalar }
  'remover'  { Remover }
  'iniciar'  { Iniciar }
  'parar'    { Parar }
  'status'   { Status }
}
