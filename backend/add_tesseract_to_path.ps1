# Add Tesseract-OCR to Windows PATH
# Run this script as Administrator

$tesseractPath = "C:\Program Files\Tesseract-OCR"

# Check if Tesseract exists
if (-not (Test-Path $tesseractPath)) {
    Write-Host "Error: Tesseract not found at $tesseractPath" -ForegroundColor Red
    Write-Host "Please verify Tesseract is installed at this location" -ForegroundColor Yellow
    exit 1
}

# Get current PATH
$currentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")

# Check if already in PATH
if ($currentPath -like "*$tesseractPath*") {
    Write-Host "Tesseract is already in PATH!" -ForegroundColor Green
    exit 0
}

# Add to PATH
try {
    $newPath = $currentPath + ";" + $tesseractPath
    [Environment]::SetEnvironmentVariable("Path", $newPath, "Machine")
    Write-Host "Successfully added Tesseract to PATH!" -ForegroundColor Green
    Write-Host ""
    Write-Host "IMPORTANT: Restart your terminal for changes to take effect!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To verify, run: tesseract --version" -ForegroundColor Cyan
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "This script needs Administrator privileges." -ForegroundColor Yellow
    Write-Host "Please run PowerShell as Administrator and try again." -ForegroundColor Yellow
    exit 1
}
