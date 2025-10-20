# WARNING: This script WILL rewrite git history and FORCE PUSH. Run only with explicit consent.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\git_history_scrub.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoPath = (Get-Location).ProviderPath
$backupPath = Join-Path (Split-Path $repoPath -Parent) ("vevo-backup-" + (Get-Date -Format 'yyyyMMddHHmmss') + ".git")

Write-Host "Repository root: $repoPath"
Write-Host "Creating a mirror backup at: $backupPath ..."

git clone --mirror $repoPath $backupPath
if ($LASTEXITCODE -ne 0) { Write-Host "Mirror clone failed. Aborting."; exit 1 }

# Prepare replace-text file for git-filter-repo
$replaceFile = Join-Path $env:TEMP "vevo_replace_text.txt"
@"
# regex:pattern==>replacement
regex:sk-or-[A-Za-z0-9_-]{16,}==>[REDACTED]
regex:sk-[A-Za-z0-9_-]{16,}==>[REDACTED]
regex:AIza[0-9A-Za-z_-]{35,}==>[REDACTED]
regex:PKXRBR[A-Za-z0-9_-]{10,}==>[REDACTED]
regex:([A-Za-z0-9_-]{20,})==>[REDACTED]
"@ | Out-File -Encoding utf8 $replaceFile

$didRewrite = $false

try {
    Write-Host "Attempting git-filter-repo..."
    git filter-repo --version > $null 2>&1
    Write-Host "git-filter-repo found. Running filter-repo to remove [REDACTED_FILENAME] and replace keys..."
    git filter-repo --replace-text $replaceFile --invert-paths --path [REDACTED_FILENAME]
    if ($LASTEXITCODE -ne 0) { throw "git-filter-repo failed" }
    $didRewrite = $true
    Write-Host "git-filter-repo completed successfully."
} catch {
    Write-Host "git-filter-repo not available or failed: $($_.Exception.Message)"
    try {
        Write-Host "Attempting BFG fallback..."
        $bfgJar = Join-Path $env:TEMP "bfg.jar"
        if (-not (Test-Path $bfgJar)) {
            Write-Host "Downloading BFG jar..."
            Invoke-WebRequest -Uri "https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar" -OutFile $bfgJar
        }
        $bareMirror = Join-Path $env:TEMP ("vevo_bare_" + [System.Guid]::NewGuid().ToString() + ".git")
        git clone --mirror $repoPath $bareMirror
        Write-Host "Running BFG to delete [REDACTED_FILENAME]..."
        java -jar $bfgJar --delete-files [REDACTED_FILENAME] $bareMirror
        Push-Location $bareMirror
        git reflog expire --expire=now --all
        git gc --prune=now --aggressive
        Pop-Location
        $didRewrite = $true
        Write-Host "BFG run complete."
    } catch {
        Write-Host "BFG not available or failed: $($_.Exception.Message)"
    }
}

if (-not $didRewrite) {
    Write-Host "No automatic scrubbing tool succeeded. Aborting. Install git-filter-repo and re-run."; exit 1
}

Write-Host "Pausing 8 seconds before force-push to origin (CTRL+C to abort)..."
Start-Sleep -Seconds 8

try {
    git push --force --all origin
    git push --force --tags origin
    Write-Host "Force-push completed."
} catch {
    Write-Host "Force-push failed: $($_.Exception.Message)"
    exit 1
}

try {
    git reflog expire --expire=now --all
    git gc --prune=now --aggressive
    Write-Host "Local git garbage collection complete."
} catch {
    Write-Host "git gc failed: $($_.Exception.Message)"
}

Write-Host "Done. Backup mirror: $backupPath"
Write-Host "IMPORTANT: All collaborators must re-clone the repository. Rotate/revoke any exposed keys immediately."
