# scripts/install-nssm-service.ps1
# Installs NSSM (Non-Sucking Service Manager) and configures Ngrok1CSyncService as a persistent Windows Service

$ErrorActionPreference = "Continue"
$ServiceName = "Ngrok1CSyncService"
$Domain = "wreath-paddling-precook.ngrok-free.dev"
$Port = "8080"
$WorkspaceDir = (Get-Item .).FullName
$NgrokPath = Join-Path $WorkspaceDir "ngrok.exe"

if (-not (Test-Path $NgrokPath)) {
    $ngrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue
    if ($ngrokCmd) {
        $NgrokPath = $ngrokCmd.Source
    }
}

Write-Host "[SETUP] Ngrok Path: $NgrokPath" -ForegroundColor Cyan

$ToolsDir = Join-Path $WorkspaceDir "tools"
if (-not (Test-Path $ToolsDir)) {
    New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null
}

$NssmExe = Join-Path $ToolsDir "nssm.exe"

if (-not (Test-Path $NssmExe)) {
    Write-Host "[NSSM] Downloading NSSM..." -ForegroundColor Cyan
    $ZipPath = Join-Path $ToolsDir "nssm.zip"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $ZipPath -UseBasicParsing
        Expand-Archive -Path $ZipPath -DestinationPath $ToolsDir -Force
        
        $FoundNssm = Get-ChildItem -Path $ToolsDir -Recurse -Filter "nssm.exe" | Where-Object { $_.FullName -like "*win64*" } | Select-Object -First 1
        if (-not $FoundNssm) {
            $FoundNssm = Get-ChildItem -Path $ToolsDir -Recurse -Filter "nssm.exe" | Select-Object -First 1
        }
        if ($FoundNssm) {
            Copy-Item -Path $FoundNssm.FullName -Destination $NssmExe -Force
            Write-Host "[NSSM] Successfully extracted NSSM to $NssmExe" -ForegroundColor Green
        }
    } catch {
        Write-Host "[NSSM] Download warning: $_" -ForegroundColor Yellow
    }
}

# Stop and remove existing service if present
Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
if (Test-Path $NssmExe) {
    & $NssmExe remove $ServiceName confirm 2>&1 | Out-Null
}

# Register service using NSSM
if (Test-Path $NssmExe) {
    Write-Host "[NSSM] Registering $ServiceName service with NSSM..." -ForegroundColor Green
    & $NssmExe install $ServiceName "$NgrokPath" "http --url=$Domain $Port"
    & $NssmExe set $ServiceName AppDirectory "$WorkspaceDir"
    & $NssmExe set $ServiceName Start SERVICE_AUTO_START
    & $NssmExe set $ServiceName AppExit Default Restart
    & $NssmExe set $ServiceName AppRestartDelay 2000
} else {
    Write-Host "[SERVICE] Registering with sc.exe..." -ForegroundColor Yellow
    & sc.exe create $ServiceName binPath= "\"$NgrokPath\" http --url=$Domain $Port" start= auto
}

# Set Failure Recovery to Restart immediately
Write-Host "[SERVICE] Configuring failure recovery parameters..." -ForegroundColor Cyan
& sc.exe failure $ServiceName reset= 86400 actions= restart/1000/restart/2000/restart/5000

# Start Service
Write-Host "[SERVICE] Starting $ServiceName..." -ForegroundColor Green
Start-Service -Name $ServiceName -ErrorAction SilentlyContinue

$Service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($Service) {
    Write-Host "[SUCCESS] Service '$ServiceName' Status: $($Service.Status)" -ForegroundColor Green
}
