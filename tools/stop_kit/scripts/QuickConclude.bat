@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0conclude.ps1" -ProjectPath "C:\Users\tfiel\bff-suite" -OutDir "%USERPROFILE%\Desktop\STOP_Packages"
endlocal
