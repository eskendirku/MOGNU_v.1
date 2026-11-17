@echo off
title M.O.G.N.U. - Motor Optimization, Geometry & Nine-dot Unifier
cd /d "%~dp0"
echo Starting M.O.G.N.U. (SIGMA 2.0 EVO)...
start cmd /k "npm run dev"
timeout /t 2 /nobreak >nul
start http://localhost:5173
