#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "================================================"
echo "TwinEval AI - Central Server"
echo "================================================"
echo
echo "This computer hosts the lightweight Node.js server and shared SQLite data."
echo "Ollama/AI is NOT started here. Each client computer runs its own AI engine."
echo

if [ ! -d node_modules ]; then
  echo "Installing Node.js dependencies..."
  npm install
fi

npm run setup
npm start
