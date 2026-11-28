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
AppId={#MyAppId}
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
SetupIconFile=treinutrix.ico
UninstallDisplayIcon={app}\treinutrix.ico
PrivilegesRequired=admin
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
Source: "treinutrix.ico"; DestDir: "{app}"; Flags: ignoreversion
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
Name: "{group}\Treinutrix - Painel"; Filename: "http://localhost:3001"; IconFilename: "{app}\treinutrix.ico"
Name: "{group}\Treinutrix - Verificar instalacao"; Filename: "{app}\scripts\verificar.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\treinutrix.ico"
Name: "{group}\Treinutrix - Parar servicos"; Filename: "{app}\scripts\parar-servico.cmd"; WorkingDir: "{app}"
Name: "{group}\Treinutrix - Desinstalar"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Treinutrix"; Filename: "http://localhost:3001"; IconFilename: "{app}\treinutrix.ico"; Tasks: desktopicon

[Run]
; 2. Firewall (equivale a scripts\liberar-firewall.cmd:12)
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""TG Treinutrix"""; Flags: runhidden; Tasks: firewall; StatusMsg: "Liberando portas no firewall..."
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""TG Treinutrix"" dir=in action=allow protocol=TCP localport=3001-3003 profile=any"; Flags: runhidden; Tasks: firewall
; 3. Registra as tarefas agendadas (sempre) e inicia agora.
;    Com autostart, cria também o gatilho de logon; sem ele, a tarefa fica
;    registrada para poder ser parada/removida corretamente na desinstalação.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\instalar-tarefas.ps1"" -Raiz ""{app}"" -Node ""{app}\runtime\node.exe"" -Autostart"; Flags: runhidden; Tasks: autostart; StatusMsg: "Registrando e iniciando serviços..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\instalar-tarefas.ps1"" -Raiz ""{app}"" -Node ""{app}\runtime\node.exe"""; Flags: runhidden; Tasks: not autostart; StatusMsg: "Iniciando serviços..."
; 5. Abre o painel no navegador ao final
Filename: "http://localhost:3001"; Description: "Abrir o painel agora"; Flags: postinstall nowait skipifsilent shellexec

[UninstallRun]
; Para tarefas e processos nas portas antes de remover arquivos/dados.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\servico.ps1"" parar"; Flags: runhidden; RunOnceId: "PararServicos"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""foreach($n in @('PainelCatracaAPI','PainelCatracaEdge')){{ try{{ Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue }}catch{{}} }}"""; Flags: runhidden; RunOnceId: "RemoverTarefas"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""TG Treinutrix"""; Flags: runhidden; RunOnceId: "RemoverFirewall"

[UninstallDelete]
; Não apaga data/ nem backups/ automaticamente — usuário decide na desinstalação
; (Inno pergunta se deve remover arquivos adicionais)

[Code]
var
  ApagarDados: Boolean;

function InitializeUninstall(): Boolean;
begin
  // Pergunta se deve apagar dados (evita perda de cadastros/fotos).
  // Em desinstalação silenciosa, mantém os dados por segurança.
  if UninstallSilent then
    ApagarDados := False
  else
    ApagarDados := MsgBox('Manter os dados da academia (cadastros, fotos e backups em data/ e backups/)?' + #13#10 + 'Escolha NAO para apagar tudo.', mbConfirmation, MB_YESNO) = IDNO;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  // Só apaga depois que [UninstallRun] parou as tarefas, evitando arquivo em uso.
  if (CurUninstallStep = usPostUninstall) and ApagarDados then
  begin
    DelTree(ExpandConstant('{app}\data'), True, True, True);
    DelTree(ExpandConstant('{app}\backups'), True, True, True);
    DelTree(ExpandConstant('{app}\logs'), True, True, True);
  end;
end;
