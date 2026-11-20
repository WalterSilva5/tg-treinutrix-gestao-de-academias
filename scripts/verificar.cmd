@echo off
setlocal
cd /d "%~dp0.."

echo === Verificacao do ambiente ===
where node >nul 2>nul || (echo [ERRO] Node.js nao encontrado & exit /b 1)
node --version

echo.
echo === Testes automatizados ===
call node --test api/test/
if errorlevel 1 (
  echo [ERRO] Testes falharam. Corrija antes de instalar.
  exit /b 1
)

echo.
echo === Servicos ===
curl -s -m 3 http://localhost:3001/health || echo [aviso] API nao respondeu na 3001
echo.
curl -s -m 3 http://localhost:3002/health || echo [aviso] Edge nao respondeu na 3002
echo.

echo === IP da maquina (use no celular) ===
ipconfig | findstr /i "IPv4"

echo.
echo Concluido.
pause
