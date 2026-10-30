@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo TwinEval AI - Local AI Engine
echo ================================================
echo.
echo This computer will run its OWN Ollama + Python AI engine.
echo The central TwinEval server can be on another computer.
echo.

where ollama >nul 2>nul
if errorlevel 1 (
  echo Ollama was not found. Install Ollama first.
  pause
  exit /b 1
)

if not exist .venv\Scripts\python.exe (
  echo Creating Python virtual environment...
  py -3 -m venv .venv 2>nul || python -m venv .venv
  if errorlevel 1 goto :error
)

call .venv\Scripts\python.exe -m pip install -r ai-engine\requirements.txt
if errorlevel 1 goto :error

set AI_SERVICE_HOST=127.0.0.1
set AI_SERVICE_PORT=8000
if not defined AI_TEXT_MODEL set AI_TEXT_MODEL=qwen3:4b-instruct
if not defined AI_VISION_MODEL set AI_VISION_MODEL=gemma3:4b
if not defined OLLAMA_ANSWER_KEY_TIMEOUT_SECONDS set OLLAMA_ANSWER_KEY_TIMEOUT_SECONDS=240

echo.
echo Checking Ollama model...
ollama list

echo.
echo Ensuring the text-generation model is installed...
ollama pull %AI_TEXT_MODEL%
if errorlevel 1 goto :error

echo.
echo Starting local AI engine on http://127.0.0.1:8000 ...
call .venv\Scripts\python.exe ai-engine\ai_server.py
exit /b %errorlevel%

:error
echo.
echo Local AI setup failed. Check the message above.
pause
exit /b 1
