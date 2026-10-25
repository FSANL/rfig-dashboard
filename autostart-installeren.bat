@echo off
cd /d "%~dp0"
echo Dit zorgt dat het RFIG Dashboard start zodra je inlogt op Windows (geen beheerdersrechten nodig).
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP%\RFIG Dashboard.vbs"
> "%LAUNCHER%" echo CreateObject("WScript.Shell").Run "wscript.exe ""%~dp0start-verborgen.vbs""", 0, False
if not exist "%LAUNCHER%" (echo Aanmaken mislukt. & pause & exit /b 1)
echo.
echo Klaar. Het dashboard start voortaan automatisch na inloggen: http://localhost:3010
echo Het dashboard wordt nu ook direct op de achtergrond gestart.
wscript.exe "%~dp0start-verborgen.vbs"
echo Verwijderen kan met autostart-verwijderen.bat
pause
