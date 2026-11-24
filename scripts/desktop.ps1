param([ValidateSet('start', 'stop')][string]$Action = 'start', [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pidFile = Join-Path $root 'data/server.pid'
$entry = Join-Path $root 'server/index.js'
$mutex = New-Object System.Threading.Mutex($false, 'Local\QuizHubDesktopLauncher')
$locked = $false
try {
    $locked = $mutex.WaitOne(30000)
    if (-not $locked) { throw 'Quiz Hub is busy. Please try again.' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    Push-Location $root
    try {
        $portText = & $node --env-file-if-exists=.env -p 'process.env.PORT || 3100'
        if ($LASTEXITCODE -ne 0) { throw 'Unable to read server configuration.' }
        $port = [int]$portText
    } finally { Pop-Location }
    $url = "http://localhost:$port"
    $owned = $null
    if (Test-Path $pidFile) {
        $serverPid = 0
        if ([int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$serverPid)) {
            $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid"
            if ($candidate -and $candidate.Name -eq 'node.exe' -and $candidate.CommandLine.Contains($entry)) { $owned = $candidate }
        }
    }
    if ($Action -eq 'stop') {
        if ($owned) { Stop-Process -Id $owned.ProcessId -Force }
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        if (-not $NoBrowser) {
            $shell = New-Object -ComObject WScript.Shell
            $null = $shell.Popup('Quiz Hub da dung. Ban co the dong tab trinh duyet.', 5, 'Quiz Hub', 64)
        }
    } else {
        $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0 -and -not $owned) {
            throw "Port $port is already in use. Stop the existing server before using this shortcut."
        }
        if (-not $owned) {
            $null = New-Item -ItemType Directory -Path (Join-Path $root 'data') -Force
            $process = Start-Process -FilePath $node -ArgumentList @('--env-file-if-exists=.env', ('"' + $entry + '"')) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'data/server.log') -RedirectStandardError (Join-Path $root 'data/server-error.log') -PassThru
            Set-Content -LiteralPath $pidFile -Value $process.Id
        }
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            try {
                $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
                if ($health.status -eq 'ok') { $ready = $true; break }
            } catch { }
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) { throw 'Server did not start. See data/server-error.log for details.' }
        if (-not $NoBrowser) { Start-Process $url }
    }
} catch {
    if ($NoBrowser) { throw }
    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.Popup($_.Exception.Message, 0, 'Quiz Hub', 16)
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
