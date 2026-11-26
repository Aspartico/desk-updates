@echo off
where node >nul 2>nul || (echo Serve Node.js. Installalo con: winget install OpenJS.NodeJS.LTS & pause & exit /b 1)
node "%~dp0installa.mjs" %*
node "%~dp0catalogo.mjs" --mostra
pause
