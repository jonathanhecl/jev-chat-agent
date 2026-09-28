#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# Check .env exists
if [ ! -f .env ]; then
  echo "No .env found. Creating from .env.example..."
  cp .env.example .env
  echo "Please edit .env with your credentials before running again."
  exit 1
fi

# Install dependencies if needed
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

# Run the bot
echo "Starting jev-chat-agent..."
npm start
