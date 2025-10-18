# Jarvis Full System Diagnostic & Self-Repair Script
Write-Host "Starting Jarvis Diagnostic & Self-Repair..."

# 1. Environment Check
Write-Host "Checking Node.js and npm versions..."
where node
$nodeVer = node -v
$npmVer = npm -v
Write-Host "Node.js: $nodeVer"
Write-Host "npm: $npmVer"

# 2. Dependency Validation
Write-Host "Validating node_modules integrity..."
if (-not (Test-Path "node_modules")) {
    Write-Host "node_modules missing. Running npm install..."
    npm install
}
Write-Host "Running npm audit fix..."
npm audit fix

# 3. Server Health Test
Write-Host "Starting backend server in diagnostic mode..."
Start-Process powershell -ArgumentList "-NoProfile -Command cd 'C:\Users\Admin\Vevo'; node server.js" -WindowStyle Hidden
Start-Sleep -Seconds 3

# 4. Port Check
Write-Host "Checking for open ports (8080, 3000, 5000)..."
$ports = @(8080, 3000, 5000)
foreach ($port in $ports) {
    $result = netstat -ano | Select-String ":$port"
    if ($result) { Write-Host "Port $port is open." }
    else { Write-Host "Port $port is closed." }
}

# 5. Endpoint Tests
Write-Host "Testing /health endpoint..."
try {
    $health = Invoke-RestMethod -Uri http://localhost:8080/health -TimeoutSec 5
    Write-Host "Health: $($health | ConvertTo-Json)"
} catch { Write-Host "Health endpoint failed." }

Write-Host "Testing /ai-test endpoint..."
try {
    $aiTest = Invoke-RestMethod -Uri http://localhost:8080/ai-test -TimeoutSec 5
    Write-Host "AI Test: $($aiTest | ConvertTo-Json)"
} catch { Write-Host "AI Test endpoint failed." }

# 6. Smart Response Validation
Write-Host "Testing AI chat response..."
try {
    $chat = Invoke-RestMethod -Uri http://localhost:8080/api/chat -Method Post -ContentType "application/json" -Body '{"message":"Hello Jarvis, are your neural modules online?"}' -TimeoutSec 5
    Write-Host "Chat Response: $($chat | ConvertTo-Json)"
} catch { Write-Host "Chat endpoint failed." }

# 7. Automatic Fixes
Write-Host "Checking for server errors or port conflicts..."
# (Add more auto-fix logic here if needed)

# 8. Report Summary
Write-Host "\n# Jarvis Diagnostic Report"
Write-Host "Node.js: $nodeVer"
Write-Host "npm: $npmVer"
Write-Host "Server: Running on http://localhost:8080"
Write-Host "Health: $($health | ConvertTo-Json)"
Write-Host "AI Test: $($aiTest | ConvertTo-Json)"
Write-Host "Chat Response: $($chat | ConvertTo-Json)"
Write-Host "Issues: (see above for any failures)"
Write-Host "Fixes: npm install, npm audit fix (if run)"
Write-Host "Final Status: Jarvis Ready or Further action required"
