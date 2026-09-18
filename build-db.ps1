#!/usr/bin/env pwsh
# Build the card index for ManaMesh (downloads card images from Scryfall)

Write-Host "🎴 ManaMesh - Building Card Recognition Index" -ForegroundColor Cyan
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
Write-Host "🚀 Starting index build..." -ForegroundColor Green
Write-Host "   Downloads about 60,000 card images; expect roughly 30-90 minutes" -ForegroundColor Yellow
Write-Host "   Safe to interrupt: run this script again to resume" -ForegroundColor Yellow
Write-Host ""

python backend/build_index.py @args

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Index build complete! Start the server with .\start.ps1" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
}
