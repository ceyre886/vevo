Write-Host "Starting Full Node.js Diagnostic & Auto-Repair..." -ForegroundColor Cyan
Write-Host "----------------------------------------------------"

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "Please run this PowerShell as Administrator!" -ForegroundColor Yellow
    exit
}

# 2️⃣ Detect existing Node installation
try {
    $nodeVersion = node -v 2>$null
    $npmVersion = npm -v 2>$null
    if ($nodeVersion) {
        Write-Host "Node.js detected: $nodeVersion"
        Write-Host "npm detected: $npmVersion"
    } else {
        Write-Host "Node.js not detected."
    }
} catch {
    Write-Host "Node.js not found."
}

# 3️⃣ Clean npm cache and folders
Write-Host "Cleaning old npm cache and paths..." -ForegroundColor Cyan
npm cache clean --force | Out-Null
Remove-Item "$env:AppData\npm" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:AppData\npm-cache" -Recurse -Force -ErrorAction SilentlyContinue

# 4️⃣ Uninstall any existing Node via Winget
Write-Host "Searching for existing Node.js installation..." -ForegroundColor Cyan
$pkg = winget list --id OpenJS.NodeJS.LTS -q
if ($pkg) {
    Write-Host "Uninstalling old Node.js (LTS)..." -ForegroundColor Yellow
    winget uninstall --id OpenJS.NodeJS.LTS --silent
}
$pkg2 = winget list --id OpenJS.NodeJS -q
if ($pkg2) {
    Write-Host "Uninstalling old Node.js..." -ForegroundColor Yellow
    winget uninstall --id OpenJS.NodeJS --silent
}

# 5️⃣ Reinstall latest Node LTS
Write-Host "Installing latest Node.js LTS..." -ForegroundColor Cyan
winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements

# 6️⃣ Verify installation
Write-Host "Verifying installation..." -ForegroundColor Cyan
$env:Path += ";C:\Program Files\nodejs"
[Environment]::SetEnvironmentVariable("Path", $env:Path, [EnvironmentVariableTarget]::Machine)
$nodeVersion = node -v
$npmVersion = npm -v
Write-Host "✅ Node.js version: $nodeVersion"
Write-Host "✅ npm version: $npmVersion"

# 7️⃣ Fix global npm permissions
Write-Host "Fixing npm global directory permissions..." -ForegroundColor Cyan
npm config set prefix "$env:UserProfile\.npm-global"
$npmGlobal = "$env:UserProfile\.npm-global\bin"
$env:Path += ";$npmGlobal"
[Environment]::SetEnvironmentVariable("Path", $env:Path, [EnvironmentVariableTarget]::User)

# 8️⃣ Create and run Node test file
Write-Host "Running test-node.js..." -ForegroundColor Cyan
Set-Location $env:UserProfile
$testFile = "test-node.js"
@"
console.log("✅ Node.js is running fine!");
console.log("Node version:", process.version);
console.log("Platform:", process.platform);
console.log("Environment test successful!");
"@ | Out-File -Encoding utf8 $testFile
node $testFile

# 9️⃣ Optional: try to rebuild project if found
$projectDir = Join-Path (Get-Location) "Documents\AIProject"
if (Test-Path $projectDir) {
    Write-Host "Found AI project folder — reinstalling dependencies..." -ForegroundColor Cyan
    Set-Location $projectDir
    Remove-Item node_modules -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item package-lock.json -Force -ErrorAction SilentlyContinue
    npm install
    if (Test-Path "server.js") {
    Write-Host "Testing server.js launch..." -ForegroundColor Cyan
        node server.js
    } else {
    Write-Host "server.js not found in $projectDir"
    }
}

Write-Host "Node.js Environment Successfully Tested and Repaired!" -ForegroundColor Green
Write-Host "If you still see errors, restart your PC and rerun this script once."
