@echo off
title RFIG Dashboard
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is niet gevonden. Installeer Node.js 24 LTS via https://nodejs.org en probeer opnieuw.
  pause
  exit /b 1
)
if not exist "%USERPROFILE%\Documents\RFIG - Secrets\.env" if not exist ".env" (
  echo Geen .env gevonden in "%USERPROFILE%\Documents\RFIG - Secrets". Het dashboard start in DEMO-modus.
)
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3010"
echo RFIG Dashboard draait. Sluit dit venster om te stoppen.
node --disable-warning=ExperimentalWarning src\server.js
pause
