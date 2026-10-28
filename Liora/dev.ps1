param(
    [int]$BackendPort = 8787,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$webDirectory = Join-Path $projectRoot 'web'
$runtimeDirectory = Join-Path $projectRoot '.runtime.local\dev'
$backendUrl = "http://127.0.0.1:$BackendPort"
$frontendUrl = "http://127.0.0.1:$FrontendPort"
$startedProcesses = @()
$previousApi = $env:LIORA_API
$previousConfig = $env:LIORA_CONFIG
$previousSkills = $env:LIORA_SKILL_DIR

function Test-Endpoint([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -Headers @{ Accept = 'text/html' } -UseBasicParsing -TimeoutSec 5
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Wait-Endpoint([string]$Url, [System.Diagnostics.Process]$Process) {
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            throw "A service exited. See the logs in $runtimeDirectory"
        }
        if (Test-Endpoint $Url) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Timed out waiting for $Url. See the logs in $runtimeDirectory"
}

try {
    foreach ($command in @('go', 'node', 'npm.cmd')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "Missing $command. Install Go 1.26.3+ and Node.js 22.12+ first."
        }
    }
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $rsbuild = Join-Path $webDirectory 'node_modules\@rsbuild\core\bin\rsbuild.js'
    if (-not (Test-Path -LiteralPath $rsbuild)) {
        Write-Host '[dev] Installing frontend dependencies...'
        Push-Location $webDirectory
        try {
            & npm.cmd ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        } finally { Pop-Location }
    }

    if (Test-Endpoint "$backendUrl/api/health") {
        Write-Host "[dev] Reusing backend: $backendUrl"
    } else {
        Write-Host '[dev] Building backend...'
        $binary = Join-Path $runtimeDirectory 'liora.exe'
        Push-Location $projectRoot
        try {
            & go build -o $binary ./cmd/liora
            if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
        } finally { Pop-Location }
        if (-not $env:LIORA_CONFIG) { $env:LIORA_CONFIG = Join-Path $projectRoot 'config.json' }
        if (-not $env:LIORA_SKILL_DIR) { $env:LIORA_SKILL_DIR = Join-Path $projectRoot 'skills' }
        $backend = Start-Process -FilePath $binary -WorkingDirectory $projectRoot `
            -ArgumentList @('-addr', "127.0.0.1:$BackendPort", '-data', ('"' + (Join-Path $projectRoot 'data') + '"'), '-key-dir', ('"' + $projectRoot + '"')) `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $runtimeDirectory 'backend.out.log') `
            -RedirectStandardError (Join-Path $runtimeDirectory 'backend.err.log')
        $startedProcesses += $backend
        Wait-Endpoint "$backendUrl/api/health" $backend
    }

    if (Test-Endpoint "$frontendUrl/login") {
        Write-Host "[dev] Reusing frontend: $frontendUrl"
    } else {
        $env:LIORA_API = $backendUrl
        $frontend = Start-Process -FilePath (Get-Command node).Source -WorkingDirectory $webDirectory `
            -ArgumentList @(('"' + $rsbuild + '"'), 'dev', '--port', $FrontendPort) `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $runtimeDirectory 'frontend.out.log') `
            -RedirectStandardError (Join-Path $runtimeDirectory 'frontend.err.log')
        $startedProcesses += $frontend
        Wait-Endpoint "$frontendUrl/login" $frontend
    }

    Write-Host ""
    Write-Host "[dev] Ready: $frontendUrl" -ForegroundColor Green
    Write-Host "[dev] Backend: $backendUrl"
    Write-Host "[dev] Logs: $runtimeDirectory"
    if ($startedProcesses.Count -eq 0) { return }
    Write-Host '[dev] Press Ctrl+C to stop services started by this command.'
    while ($true) {
        foreach ($service in $startedProcesses) {
            if ($service.HasExited) { throw "A service exited. See the logs in $runtimeDirectory" }
        }
        Start-Sleep -Seconds 1
    }
} catch {
    Write-Host "[dev] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    foreach ($service in $startedProcesses) {
        if (-not $service.HasExited) { Stop-Process -Id $service.Id -ErrorAction SilentlyContinue }
    }
    $env:LIORA_API = $previousApi
    $env:LIORA_CONFIG = $previousConfig
    $env:LIORA_SKILL_DIR = $previousSkills
}
