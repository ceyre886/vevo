# Securely prompt for API keys and write a .env file with restricted ACL
# Run this locally in PowerShell. Do NOT paste keys into chat.

param()

function Read-SecureInput([string]$prompt) {
    $secure = Read-Host -AsSecureString -Prompt $prompt
    return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

Write-Host "This script will create a .env file in the project root with secure ACLs."
$envPath = Join-Path -Path (Get-Location) -ChildPath ".env"

$openRouter = Read-SecureInput "OPENROUTER_API_KEY_1 (optional)"
$openRouter2 = Read-SecureInput "OPENROUTER_API_KEY_2 (optional)"
$hf = Read-SecureInput "HF_API_KEY_1 (optional)"
$google = Read-SecureInput "GOOGLE_API_KEY_1 (optional)"

# Minimal cleaning: remove BOM and whitespace
function CleanKey([string]$k) {
    if (-not $k) { return '' }
    $k = $k.Trim()
    return $k -replace "^\uFEFF", ''
}

$lines = @()
if (CleanKey $openRouter) { $lines += "OPENROUTER_API_KEY_1=$(CleanKey $openRouter)" }
if (CleanKey $openRouter2) { $lines += "OPENROUTER_API_KEY_2=$(CleanKey $openRouter2)" }
if (CleanKey $hf) { $lines += "HF_API_KEY_1=$(CleanKey $hf)" }
if (CleanKey $google) { $lines += "GOOGLE_API_KEY_1=$(CleanKey $google)" }

if (-not $lines) {
    Write-Host "No keys provided. Exiting without writing .env"; exit 0
}

# Write file
Set-Content -Path $envPath -Value ($lines -join "`n") -NoNewline

# Restrict permissions: only current user
$acl = Get-Acl $envPath
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($env:USERNAME, "FullControl", "Allow")
$acl.SetAccessRule($rule)
Set-Acl -Path $envPath -AclObject $acl

Write-Host ".env written to $envPath with restricted ACL. Please rotate any exposed keys immediately if they were shared in public."
