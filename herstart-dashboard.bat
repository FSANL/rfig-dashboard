@echo off
cd /d "%~dp0"
echo RFIG Dashboard herstarten (nodig na een update van de bestanden)...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*src\server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 2 /nobreak >nul
wscript.exe "%~dp0start-verborgen.vbs"
echo Klaar. Open over enkele seconden http://localhost:3010
pause
