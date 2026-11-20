@echo off
setlocal
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\servico.ps1 status %*
if "%~1"=="" pause
