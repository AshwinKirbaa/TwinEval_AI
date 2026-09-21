@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo TwinEval AI - Central Server
echo ================================================

echo.
echo This computer hosts the lightweight Node.js server and shared SQLite data.
echo Ollama/AI is NOT started here. Each client computer runs its own AI engine.
echo.

if not exist node_modules (
  echo Installing Node.js dependencies...
  call npm install
  if errorlevel 1 goto :error
)

call npm run setup
if errorlevel 1 goto :error

call npm start
exit /b %errorlevel%

:error
echo.
echo Setup/start failed. Check the message above.
pause
exit /b 1
