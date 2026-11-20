@echo off
setlocal
cd /d "%~dp0.."
echo Restaurando o administrador padrao...
node scripts\restaurar-admin.js %*
set CODIGO=%ERRORLEVEL%
if not "%CODIGO%"=="0" (
  echo.
  echo Nao foi possivel restaurar. Veja a mensagem acima.
)
if "%~1"=="" pause
exit /b %CODIGO%
