# ManaMesh - Build Database
# Quick shortcut to activate venv and build the card database

Write-Host "🔨 Building Card Database..." -ForegroundColor Cyan
Write-Host "This will take 30-90 minutes. Let it run overnight!" -ForegroundColor Yellow
Write-Host ""

# Activate virtual environment
& "$PSScriptRoot\.venv\Scripts\Activate.ps1"

# Build database
& python backend\build_database.py
