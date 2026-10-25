@echo off
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\RFIG Dashboard.vbs" 2>nul
schtasks /Delete /TN "RFIG Dashboard" /F >nul 2>nul
echo Automatisch starten is uitgezet.
pause
