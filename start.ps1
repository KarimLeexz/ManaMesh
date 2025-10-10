# ManaMesh - Start Development Server
# Quick shortcut to activate venv and start the server

Write-Host "🃏 Starting ManaMesh..." -ForegroundColor Cyan

# Activate virtual environment
& "$PSScriptRoot\.venv\Scripts\Activate.ps1"

# Start the server
& python backend\main.py
