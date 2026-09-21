#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "================================================"
echo "TwinEval AI - Local AI Engine"
echo "================================================"
echo
echo "This computer will run its OWN Ollama + Python AI engine."
echo "The central TwinEval server can be on another computer."
echo

command -v ollama >/dev/null 2>&1 || { echo "Ollama was not found. Install Ollama first."; exit 1; }

if [ ! -x .venv/bin/python ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
fi

.venv/bin/python -m pip install -r ai-engine/requirements.txt
export AI_SERVICE_HOST=127.0.0.1
export AI_SERVICE_PORT=8000
export AI_ENGINE_MODEL=gemma3:4b

echo
echo "Checking Ollama model..."
ollama list

echo
echo "Starting local AI engine on http://127.0.0.1:8000 ..."
exec .venv/bin/python ai-engine/ai_server.py
