@echo off
cd /d "%~dp0"
echo Dit maakt een taak aan die het RFIG Dashboard start zodra je inlogt op Windows.
schtasks /Create /TN "RFIG Dashboard" /SC ONLOGON /TR "wscript.exe \"%~dp0start-verborgen.vbs\"" /RL LIMITED /F
if errorlevel 1 (echo Aanmaken mislukt. & pause & exit /b 1)
echo.
echo Klaar. Het dashboard start voortaan automatisch na inloggen: http://localhost:3010
echo Verwijderen kan met autostart-verwijderen.bat
pause
