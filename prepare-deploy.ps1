# ManaMesh - Prepare for Deployment
# This script builds the card database and prepares everything for deployment

Write-Host "🃏 ManaMesh - Deployment Preparation" -ForegroundColor Cyan
Write-Host ""

# Check if virtual environment is activated
if (-not $env:VIRTUAL_ENV) {
    Write-Host "⚠️  Virtual environment not activated. Activating now..." -ForegroundColor Yellow
    & "$PSScriptRoot\.venv\Scripts\Activate.ps1"
}

# Check if card database already exists
if (Test-Path "$PSScriptRoot\card_hashes.pkl") {
    Write-Host "✓ Card database already exists!" -ForegroundColor Green
    $size = (Get-Item "$PSScriptRoot\card_hashes.pkl").Length / 1MB
    Write-Host "  Size: $([math]::Round($size, 2)) MB" -ForegroundColor Gray
    Write-Host ""
    
    $rebuild = Read-Host "Do you want to rebuild it? (y/N)"
    if ($rebuild -ne "y" -and $rebuild -ne "Y") {
        Write-Host "✓ Skipping database build" -ForegroundColor Green
        Write-Host ""
        Write-Host "Ready for deployment! Next steps:" -ForegroundColor Cyan
        Write-Host "1. Edit frontend/config.js with your Render backend URL" -ForegroundColor White
        Write-Host "2. Run: git add ." -ForegroundColor White
        Write-Host "3. Run: git commit -m 'Prepare for deployment'" -ForegroundColor White
        Write-Host "4. Run: git push origin master" -ForegroundColor White
        exit 0
    }
    Write-Host ""
}

# Build the database
Write-Host "🔨 Building card database..." -ForegroundColor Cyan
Write-Host "This will take 30-60 minutes. Please be patient!" -ForegroundColor Yellow
Write-Host ""
Write-Host "Started at: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

& python backend/build_database.py

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Card database built successfully!" -ForegroundColor Green
    Write-Host "Completed at: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Gray
    
    if (Test-Path "$PSScriptRoot\card_hashes.pkl") {
        $size = (Get-Item "$PSScriptRoot\card_hashes.pkl").Length / 1MB
        Write-Host "Database size: $([math]::Round($size, 2)) MB" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "📋 Next steps for deployment:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Edit frontend/config.js with your Render backend URL" -ForegroundColor White
    Write-Host "   Example: window.MANAMESH_API_URL = 'https://your-app.onrender.com';" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. Commit and push to GitHub:" -ForegroundColor White
    Write-Host "   git add ." -ForegroundColor Gray
    Write-Host "   git commit -m 'Add card database for deployment'" -ForegroundColor Gray
    Write-Host "   git push origin master" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. Deploy backend to Render (see DEPLOY-CHECKLIST.md)" -ForegroundColor White
    Write-Host ""
    Write-Host "4. Enable GitHub Pages in repo settings" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Database build failed!" -ForegroundColor Red
    Write-Host "Check the error messages above." -ForegroundColor Yellow
    exit 1
}
