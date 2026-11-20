@echo off
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo Execute este script como Administrador.
  pause
  exit /b 1
)
echo Liberando portas 3001-3003 no firewall (perfis private/domain)...
netsh advfirewall firewall delete rule name="Painel Catraca" >nul 2>&1
netsh advfirewall firewall add rule name="Painel Catraca" dir=in action=allow protocol=TCP localport=3001-3003 profile=private,domain
if errorlevel 1 (
  echo Falha ao criar a regra.
  pause
  exit /b 1
)
echo OK. Portas 3001 (API), 3002 (edge) e 3003 (facial) liberadas.
pause
