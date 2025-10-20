<#
Auto-finish script for Vevo repository (PowerShell v5.1)
Performs safe repo hygiene, pushes branches, creates PRs (or opens PR pages), restarts server, runs quick endpoint checks, and tails logs.
Run this from the project root: PowerShell -NoProfile -ExecutionPolicy Bypass -File .\scripts\auto_finish.ps1
WARNING: This script will attempt to push branches to the configured remote and start a server process locally.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = "C:\Users\Admin\Vevo"
Set-Location $repo
Write-Host "Working in: $repo"

# 1) Ensure .env is not tracked and .gitignore contains .env
try {
    git checkout -B fix/remove-committed-env
} catch {
    Write-Host "Failed to checkout/create branch fix/remove-committed-env: $_"
}

if (Test-Path .env) {
    try { git rm --cached .env -f; Write-Host "Removed .env from index" } catch { Write-Host "git rm .env failed or .env not tracked: $_" }
} else {
    Write-Host ".env file not present in repo root"
}

if (-not (Test-Path .gitignore)) { "# auto-generated" | Out-File .gitignore -Encoding utf8 }
$gitignoreHas = $false
try { $gitignoreHas = Select-String -Path .gitignore -Pattern '^\s*\.env\s*$' -Quiet -ErrorAction SilentlyContinue } catch {}
if (-not $gitignoreHas) { Add-Content -Path .gitignore -Value ".env"; Write-Host "Added .env to .gitignore" } else { Write-Host ".env already in .gitignore" }

# Commit .gitignore and removal
try {
    git add .gitignore
    try { git add . } catch { Write-Host "git add . failed: $_" }
    try { git commit -m "chore: remove committed .env from index and add to .gitignore" -a; Write-Host "Committed cleanup changes" } catch { Write-Host "No changes to commit or commit failed: $_" }
} catch {
    Write-Host "No changes to commit or commit failed: $_"
}

# Push cleanup branch
try {
    git push -u origin fix/remove-committed-env
    Write-Host "Pushed branch fix/remove-committed-env to origin"
} catch {
    Write-Host "Failed to push fix/remove-committed-env: $_"
}

# 2) Ensure feature branch is pushed
try {
    git fetch origin
    git checkout feature/coris-trading-learning
    git pull --rebase origin feature/coris-trading-learning
    git push -u origin feature/coris-trading-learning
    Write-Host "Ensured feature/coris-trading-learning is pushed"
} catch {
    Write-Host "Problem ensuring feature branch pushed: $_"
}

# 3) Try to create PRs via gh; fall back to opening URLs in browser
$prFeatureUrl = "https://github.com/ceyre886/vevo/pull/new/feature/coris-trading-learning"
$prCleanupUrl = "https://github.com/ceyre886/vevo/pull/new/fix/remove-committed-env"

function Try-GHCreate($branch,$title,$body,$base="main") {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { return $false }
    try {
        & gh pr create --repo ceyre886/vevo --base $base --head $branch --title $title --body $body
        if ($LASTEXITCODE -eq 0) { return $true } else { return $false }
    } catch {
        return $false
    }
}

$created = $false
$created = Try-GHCreate "feature/coris-trading-learning" "CORIs + Trading + Continuous Learning" "Implements CORIs primitives, trading primitives, dashboard, and continuous learning infrastructure. Please run CI and review logs." 
if (-not $created) { Write-Host "Opening PR page for feature branch in browser..."; Start-Process $prFeatureUrl }

$created = Try-GHCreate "fix/remove-committed-env" "chore: remove committed .env" "Remove .env from tracked files and add to .gitignore." 
if (-not $created) { Write-Host "Opening PR page for cleanup branch in browser..."; Start-Process $prCleanupUrl }

# 4) Restart server safely: stop node processes and jobs, then start Vevo in a background job
try {
    Get-Job | Where-Object { $_.Name -eq 'VevoServer' -or $_.State -eq 'Running' } | Stop-Job -Force -ErrorAction SilentlyContinue
} catch {}
try { Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}

Write-Host "Starting server in background job 'VevoServer'"
Start-Job -Name VevoServer -ScriptBlock { Set-Location 'C:\Users\Admin\Vevo'; node server.js } | Out-Null
Start-Sleep -Seconds 4

# 5) Helper to call endpoints
function Invoke-Api($path, $method='Get', $body=$null) {
    try {
        if ($method -eq 'Get') {
            $r = Invoke-RestMethod -Method Get -Uri "http://localhost:9090$path" -ErrorAction Stop
        } else {
            $r = Invoke-RestMethod -Method Post -Uri "http://localhost:9090$path" -Body ($body | ConvertTo-Json -Depth 6) -ContentType 'application/json' -ErrorAction Stop
        }
        Write-Host "\n== $path RESPONSE =="; $r | ConvertTo-Json -Depth 6
    } catch {
        Write-Host ("ERROR calling {0}: {1}" -f $path, $_.Exception.Message)
    }
}

Invoke-Api '/api/system-status'
Invoke-Api '/api/test-persona'
Invoke-Api '/api/test-keys'
# Run a learning cycle (may fail if no valid key)
Invoke-Api '/api/review-learn' 'Post' @{}

# 6) Tail logs (print last 200 lines)
Write-Host "\n--- Last lines of learning.log ---"
if (Test-Path .\logs\learning.log) { Get-Content -Path .\logs\learning.log -Tail 200 } else { Write-Host "No learning.log found" }
Write-Host "\n--- Last lines of errors.log ---"
if (Test-Path .\logs\errors.log) { Get-Content -Path .\logs\errors.log -Tail 200 } else { Write-Host "No errors.log found" }

Write-Host "\nAuto-finish script complete. Please review opened PR pages in your browser and rotate any compromised keys immediately."
