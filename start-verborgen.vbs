' Start het RFIG Dashboard onzichtbaar op de achtergrond (gebruikt door de taak bij inloggen).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder(dir & "\data")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
sh.Run "cmd /c node --disable-warning=ExperimentalWarning src\server.js >> data\server.log 2>&1", 0, False
