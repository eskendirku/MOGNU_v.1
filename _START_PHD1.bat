@echo off
cd /d "%~dp0"
start cmd /k "npm run dev"
timeout /t 2 /nobreak >nul
start http://localhost:5173
