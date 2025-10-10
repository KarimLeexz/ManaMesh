# ManaMesh - Update Database
# Quick shortcut to check for and update with new cards

Write-Host "🔄 Updating Card Database..." -ForegroundColor Cyan

# Activate virtual environment
& "$PSScriptRoot\.venv\Scripts\Activate.ps1"

# Check for updates first
Write-Host ""
Write-Host "Checking for new cards..." -ForegroundColor Yellow
& python backend\update_database.py --check-only

# Ask if user wants to proceed
Write-Host ""
$response = Read-Host "Do you want to update? (y/n)"
if ($response -eq 'y' -or $response -eq 'Y') {
    & python backend\update_database.py
} else {
    Write-Host "Update cancelled." -ForegroundColor Yellow
}
