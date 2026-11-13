<#
.SYNOPSIS
Verifies portable Windows release artifacts and smoke-tests OcarinaAtlas.exe outside the repository.
#>
param(
    [string]$ZipPath = "release/OcarinaAtlas-Windows-x64.zip",
    [string]$StagingDir = "release/OcarinaAtlas-Windows-x64",
    [int]$Port = 34567,
    [string]$WorkDir = ""
)

$ErrorActionPreference = "Stop"

$expected = @(
    (Join-Path $StagingDir "OcarinaAtlas.exe"),
    (Join-Path $StagingDir "runtime/node.exe"),
    (Join-Path $StagingDir "app/standalone-server.mjs"),
    (Join-Path $StagingDir "app/dist/client"),
    (Join-Path $StagingDir "app/dist/server/server.js"),
    $ZipPath
)

foreach ($item in $expected) {
    if (-not (Test-Path $item)) {
        throw "Missing expected build artifact: $item"
    }
}

$resolvedZip = (Resolve-Path $ZipPath).Path
if ([string]::IsNullOrWhiteSpace($WorkDir)) {
    $baseTemp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
    $WorkDir = Join-Path $baseTemp ("ocarina-atlas-smoke-" + [System.Guid]::NewGuid().ToString("N"))
}

if (Test-Path $WorkDir) {
    Remove-Item -Recurse -Force $WorkDir
}
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

$proc = $null
try {
    Expand-Archive -Path $resolvedZip -DestinationPath $WorkDir -Force
    $exePath = Join-Path $WorkDir "OcarinaAtlas-Windows-x64/OcarinaAtlas.exe"
    if (-not (Test-Path $exePath)) {
        throw "Extracted ZIP is missing OcarinaAtlas-Windows-x64/OcarinaAtlas.exe at $exePath"
    }

    Write-Host "Starting OcarinaAtlas.exe smoke test on 127.0.0.1:$Port ..."
    $proc = Start-Process -FilePath $exePath `
        -ArgumentList @("--port", "$Port", "--no-browser", "--auto-start", "--minimized") `
        -WorkingDirectory (Split-Path -Parent $exePath) `
        -PassThru

    $rootUrl = "http://127.0.0.1:$Port/"
    $apiUrl = "http://127.0.0.1:$Port/api/lichii/state"
    $deadline = (Get-Date).AddSeconds(30)
    $ready = $false
    $lastError = $null

    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) {
            throw "OcarinaAtlas.exe exited prematurely with exit code $($proc.ExitCode)"
        }
        try {
            $pageResp = Invoke-WebRequest -Uri $rootUrl -UseBasicParsing -TimeoutSec 3
            $apiResp = Invoke-WebRequest -Uri $apiUrl -UseBasicParsing -TimeoutSec 3
            if ($pageResp.StatusCode -eq 200 -and $apiResp.StatusCode -eq 200) {
                $payload = $apiResp.Content | ConvertFrom-Json
                $props = $payload.PSObject.Properties.Name
                foreach ($requiredProp in @("connected", "emulatorRunning", "source")) {
                    if ($props -notcontains $requiredProp) {
                        throw "Telemetry JSON missing '$requiredProp': $($apiResp.Content)"
                    }
                }
                Write-Host "Smoke test HTTP 200 OK; telemetry source=$($payload.source) connected=$($payload.connected)"
                $ready = $true
                break
            }
        }
        catch {
            $lastError = $_
            Start-Sleep -Milliseconds 500
        }
    }

    if (-not $ready) {
        throw "Timed out waiting for OcarinaAtlas.exe HTTP endpoints on port ${Port}: $lastError"
    }
}
finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        $proc.WaitForExit(5000) | Out-Null
    }

    # Verify the Windows Job Object cleaned up the child node.exe server and released the port.
    $portClosed = $false
    for ($i = 0; $i -lt 20; $i++) {
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
            $connected = $iar.AsyncWaitHandle.WaitOne(150, $false)
            if ($connected -and $client.Connected) {
                $client.EndConnect($iar)
                Start-Sleep -Milliseconds 250
            }
            else {
                $portClosed = $true
                break
            }
        }
        catch {
            $portClosed = $true
            break
        }
        finally {
            $client.Dispose()
        }
    }

    if (Test-Path $WorkDir) {
        Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue
    }

    if (-not $portClosed) {
        throw "Port $Port remained open after stopping OcarinaAtlas.exe (possible orphan node.exe process)."
    }

    Write-Host "Smoke test completed cleanly and port $Port closed via Job Object cleanup."
}
