@echo off
REM SCRIBE Forever - Auto-restarts forever
cd /d "C:\Users\User\OneDrive\Documents\PROFIT BRAIN\SCRIBE"

:restart
echo [%date% %time%] Starting SCRIBE... >> ..\..\logs\scribe-forever.log
start /b node.exe scribe.js
timeout /t 30 /nobreak >nul

:waitloop
timeout /t 10 /nobreak >nul
netstat -ano | findstr ":5004.*LISTENING" >nul
if %errorlevel% neq 0 (
    echo [%date% %time%] SCRIBE died, restarting... >> ..\..\logs\scribe-forever.log
    goto restart
)
goto waitloop