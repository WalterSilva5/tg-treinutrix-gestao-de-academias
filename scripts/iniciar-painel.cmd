@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo ============================================
echo  Academia - Gestao de acesso
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale o Node 22 LTS: https://nodejs.org
  pause
  exit /b 1
)

if not exist "data" mkdir "data"

rem Segredo de autenticacao: gera uma vez e reutiliza (nao commitar).
if not exist "data\auth.secret" (
  for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"`) do set "AUTH_SECRET=%%s"
  > "data\auth.secret" echo !AUTH_SECRET!
  echo [ok] Segredo de autenticacao criado em data\auth.secret
) else (
  set /p AUTH_SECRET=<"data\auth.secret"
)

if not defined API_PORT set API_PORT=3001
if not defined EDGE_PORT set EDGE_PORT=3002
if not defined BACKUP_DIR set BACKUP_DIR=%~dp0..\backups
if not defined PHOTO_DIR set PHOTO_DIR=%~dp0..\data\photos

echo.
echo API  : http://localhost:%API_PORT%
echo Edge : http://localhost:%EDGE_PORT%
echo.
echo Para acessar no celular use o IP desta maquina na mesma rede Wi-Fi.
echo Feche as janelas que abrirem para encerrar os servicos.
echo.

start "Academia API" cmd /k "node api\src\server.js"
timeout /t 2 /nobreak >nul
start "Academia Edge" cmd /k "node edge-catraca\src\edge.js"

echo Servicos iniciados. Verifique:
echo   curl http://localhost:%API_PORT%/health
echo   curl http://localhost:%EDGE_PORT%/health
echo.
pause
