@echo off
cd /d "%~dp0"
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
)
echo Starting Plane-Fo local server...
node server.js
pause
