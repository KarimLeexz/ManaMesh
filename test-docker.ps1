# Docker Deployment Test Script
# Tests the Docker build locally before Railway deployment

Write-Host "🐋 Testing Docker Build for ManaMesh..." -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "1. Checking Docker..." -ForegroundColor Yellow
$dockerRunning = docker info 2>$null
if (-not $dockerRunning) {
    Write-Host "❌ Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}
Write-Host "✓ Docker is running" -ForegroundColor Green
Write-Host ""

# Build the Docker image
Write-Host "2. Building Docker image..." -ForegroundColor Yellow
Write-Host "   This may take a few minutes..." -ForegroundColor Gray
docker build -t manamesh:test .
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Docker image built successfully" -ForegroundColor Green
Write-Host ""

# Test the image
Write-Host "3. Testing Docker image..." -ForegroundColor Yellow
Write-Host "   Starting container on port 8080..." -ForegroundColor Gray
$containerId = docker run -d -p 8080:8000 `
    -e CARD_DATABASE_PATH=card_features.pkl `
    manamesh:test

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to start container" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Container started: $containerId" -ForegroundColor Green
Write-Host ""

# Wait for startup
Write-Host "4. Waiting for application to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Check logs
Write-Host ""
Write-Host "📝 Container logs:" -ForegroundColor Cyan
docker logs $containerId

# Test health endpoint
Write-Host ""
Write-Host "5. Testing health endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:8080/health" -TimeoutSec 10
    Write-Host "✓ Health check passed!" -ForegroundColor Green
    Write-Host "   Status: $($response.status)" -ForegroundColor Gray
    Write-Host "   Database: $($response.database_loaded)" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "⚠️  Health check failed: $_" -ForegroundColor Yellow
    Write-Host "   Check logs above for errors" -ForegroundColor Gray
}

# Show running info
Write-Host "🎉 Docker test complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Container is running. You can:" -ForegroundColor Cyan
Write-Host "  - Test API: http://localhost:8080/docs" -ForegroundColor White
Write-Host "  - View logs: docker logs $containerId" -ForegroundColor White
Write-Host "  - Stop container: docker stop $containerId" -ForegroundColor White
Write-Host "  - Remove container: docker rm $containerId" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop and cleanup, or close this window to keep running." -ForegroundColor Gray

# Keep script running
try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
} finally {
    # Cleanup on Ctrl+C
    Write-Host ""
    Write-Host "🧹 Cleaning up..." -ForegroundColor Yellow
    docker stop $containerId | Out-Null
    docker rm $containerId | Out-Null
    Write-Host "✓ Container stopped and removed" -ForegroundColor Green
}
