#!/usr/bin/env pwsh
# Build feature database for ManaMesh

Write-Host "🎴 ManaMesh - Building Card Recognition Database" -ForegroundColor Cyan
Write-Host ""

# Activate virtual environment
if (Test-Path ".venv\Scripts\Activate.ps1") {
    Write-Host "📦 Activating virtual environment..." -ForegroundColor Yellow
    & .venv\Scripts\Activate.ps1
} else {
    Write-Host "❌ Virtual environment not found. Please run setup first." -ForegroundColor Red
    exit 1
}

# Run the build script
Write-Host "🚀 Starting database build..." -ForegroundColor Green
Write-Host "   This will take SEVERAL HOURS (likely 8-12 hours)" -ForegroundColor Yellow
Write-Host "   Progress will be saved every 1000 cards" -ForegroundColor Yellow
Write-Host ""

python backend/build_database.py

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Database build complete!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
}
