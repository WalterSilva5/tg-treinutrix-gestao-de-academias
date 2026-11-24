; TG Treinutrix - Instalador Windows
; Inno Setup 6 - https://jrsoftware.org/isinfo.php
; Gera um wizard .exe que instala API + Edge + PWA sem exigir Node pré-instalado.
; Build: powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
; Requer: ISCC.exe no PATH (instale Inno Setup 6) e Node 22 no build.

#define MyAppName "TG Treinutrix"
#define MyAppId "TG.Treinutrix"
#define MyAppVersion GetEnv("TREINUTRIX_VERSION")
#if MyAppVersion == ""
  #define MyAppVersion "0.1.0"
#endif
#define MyAppPublisher "Treinutrix"
#define MyAppURL "https://github.com/WalterSilva5/tg-treinutrix-gestao-de-academias"

[Setup]
AppId={{#MyAppId}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\Treinutrix
DefaultGroupName=Treinutrix
DisableProgramGroupPage=yes
OutputDir=..\dist\installer
OutputBaseFilename=Treinutrix-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\front\icon.svg
UninstallDisplayIcon={app}\runtime\node.exe
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
VersionInfoVersion={#MyAppVersion}
VersionInfoDescription=Instalador TG Treinutrix - Gestao de academias
LicenseFile=..\LICENSE
InfoBeforeFile=..\README.md
CloseApplications=yes
RestartApplications=no
; Mantem dados do usuario ao desinstalar (data/ e backups/ são preservados até confirmação)
AppCopyright=Business Source License 1.1

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Area de Trabalho"; GroupDescription: "Atalhos:"; Flags: unchecked
Name: "autostart"; Description: "Iniciar automaticamente ao ligar o PC (recomendado)"; GroupDescription: "Inicializacao:"; Flags: checkedonce
Name: "firewall"; Description: "Liberar portas 3001-3003 no Firewall do Windows"; GroupDescription: "Rede:"; Flags: checkedonce

[Files]
; Runtime Node 22 portátil (baixado por build-installer.ps1 para installer\runtime\node.exe)
Source: "runtime\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
; App — lista explícita para não levar .git/data/logs/backups/node_modules
Source: "..\api\*"; DestDir: "{app}\api"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\edge-catraca\*"; DestDir: "{app}\edge-catraca"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\front\*"; DestDir: "{app}\front"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\prisma\*"; DestDir: "{app}\prisma"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
; Exclui do payload (não empacotar mesmo se existir no stage)
; DLLs Topdata nunca entram no instalador (licenciamento)
Source: "..\.env.example"; DestDir: "{app}"; Flags: ignoreversion; Permissions: users-modify

[Dirs]
Name: "{app}\data"; Permissions: users-modify
Name: "{app}\data\photos"; Permissions: users-modify
Name: "{app}\backups"; Permissions: users-modify
Name: "{app}\logs"; Permissions: users-modify

[Icons]
Name: "{group}\Treinutrix - Painel"; Filename: "http://localhost:3001"; IconFilename: "{app}\front\icon.svg"
Name: "{group}\Treinutrix - Verificar instalacao"; Filename: "{app}\scripts\verificar.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\runtime\node.exe"
Name: "{group}\Treinutrix - Parar servicos"; Filename: "{app}\scripts\parar-servico.cmd"; WorkingDir: "{app}"
Name: "{group}\Treinutrix - Desinstalar"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Treinutrix"; Filename: "http://localhost:3001"; IconFilename: "{app}\front\icon.svg"; Tasks: desktopicon

[Run]
; 1. Gera data\auth.secret se não existir (mesma lógica de scripts\iniciar-painel.cmd:19)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""if(-not (Test-Path '{app}\data\auth.secret')){{ $s=[guid]::NewGuid().ToString('N'); Set-Content -Path '{app}\data\auth.secret' -Value $s -Encoding ascii; Write-Host 'auth.secret criado' }}"""; Flags: runhidden; StatusMsg: "Configurando..."
; 2. Firewall (equivale a scripts\liberar-firewall.cmd:12)
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""TG Treinutrix"""; Flags: runhidden; Tasks: firewall; StatusMsg: "Liberando portas no firewall..."
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""TG Treinutrix"" dir=in action=allow protocol=TCP localport=3001-3003 profile=private,domain"; Flags: runhidden; Tasks: firewall
; 3. Instala tarefas agendadas PainelCatracaAPI / PainelCatracaEdge (scripts\servico.ps1:28)
;    Usa o node embarcado, não o do PATH, para não depender de instalação prévia.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$node='{app}\runtime\node.exe'; $raiz='{app}'; $tasks=@(@{{N='PainelCatracaAPI';T='api';P=3001}},@{{N='PainelCatracaEdge';T='edge';P=3002}}); New-Item -ItemType Directory -Force (Join-Path $raiz 'logs')|Out-Null; foreach($t in $tasks){{ $args2='\"'+(Join-Path $raiz 'scripts\servico.js')+'\" '+$t.T; $a=New-ScheduledTaskAction -Execute $node -Argument $args2 -WorkingDirectory $raiz; $tr=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; $st=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero); Register-ScheduledTask -TaskName $t.N -Action $a -Trigger $tr -Settings $st -Description 'Treinutrix - supervisor com logs e reinicio' -Force|Out-Null; Start-ScheduledTask -TaskName $t.N }}"""; Flags: runhidden; Tasks: autostart; StatusMsg: "Registrando inicializacao automatica..."
; 4. Inicia agora mesmo (sem esperar logon) para validação imediata
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$node='{app}\runtime\node.exe'; $raiz='{app}'; foreach($t in @('api','edge')){{ Start-Process -FilePath $node -ArgumentList (Join-Path $raiz ""scripts\servico.js $t"") -WorkingDirectory $raiz -WindowStyle Hidden }}; Start-Sleep 3; try{{ Invoke-RestMethod http://127.0.0.1:3001/health -TimeoutSec 5 | Out-Null; Write-Host 'API OK' }}catch{{ Write-Host 'API ainda iniciando' }}"""; Flags: runhidden; StatusMsg: "Iniciando servicos..."
; 5. Abre o painel no navegador ao final
Filename: "http://localhost:3001"; Description: "Abrir o painel agora"; Flags: postinstall nowait skipifsilent

[UninstallRun]
; Para tarefas e remove regra de firewall; dados são preservados
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""foreach($n in @('PainelCatracaAPI','PainelCatracaEdge')){{ try{{ Stop-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue }}catch{{}} }}"""; Flags: runhidden
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""TG Treinutrix"""; Flags: runhidden

[UninstallDelete]
; Não apaga data/ nem backups/ automaticamente — usuário decide na desinstalação
; (Inno pergunta se deve remover arquivos adicionais)

[Code]
function InitializeUninstall(): Boolean;
var
  V: string;
begin
  // Pergunta se deve apagar dados (evita perda de cadastros/fotos)
  if MsgBox('Manter os dados da academia (cadastros, fotos e backups em data/ e backups/)?' + #13#10 + 'Escolha NAO para apagar tudo.', mbConfirmation, MB_YESNO) = IDYES then
  begin
    // Mantém — nada a fazer
  end
  else
  begin
    DelTree(ExpandConstant('{app}\data'), True, True, True);
    DelTree(ExpandConstant('{app}\backups'), True, True, True);
    DelTree(ExpandConstant('{app}\logs'), True, True, True);
  end;
  Result := True;
end;
