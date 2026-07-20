# Publish clean extension folder to GitHub
# Usage (PowerShell):
#   $env:GITHUB_TOKEN = "ghp_xxx"   # create a fine-grained or classic token with repo scope
#   .\scripts\publish.ps1 -Owner yourname -Repo anti-sedentary-assistant
#
# Security: do NOT paste the token into chat or commit it.

param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [string]$Repo = "anti-sedentary-assistant",
  [string]$Visibility = "public",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $env:GITHUB_TOKEN) {
  Write-Error "Set env GITHUB_TOKEN first (repo scope). Example: `$env:GITHUB_TOKEN = 'ghp_...'"
}

# Patch PROJECT_REPO in constants.js for this publish
$constPath = Join-Path $Root "src\shared\constants.js"
$constText = Get-Content $constPath -Raw -Encoding UTF8
$repoFull = "$Owner/$Repo"
$constText = $constText -replace "YOUR_GITHUB_USERNAME/anti-sedentary-assistant", $repoFull
Set-Content -Path $constPath -Value $constText -Encoding UTF8 -NoNewline

# Init git if needed
if (-not (Test-Path (Join-Path $Root ".git"))) {
  git init
  git branch -M $Branch
}

# Stage only extension source (repo root is extension/)
git add -A
# Ensure secrets never staged
git reset -- .gh_token 2>$null
git status

git config user.email 2>$null | Out-Null
if (-not (git config user.email)) {
  git config user.email "noreply@users.noreply.github.com"
  git config user.name $Owner
}

git commit -m "chore: publish anti-sedentary micro-motion assistant v1.2.0" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Nothing new to commit (or commit failed). Continuing..."
}

$headers = @{
  Authorization = "token $($env:GITHUB_TOKEN)"
  Accept        = "application/vnd.github+json"
  "User-Agent"  = "anti-sedentary-publish-script"
}

# Create repo if missing
try {
  $existing = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Owner/$Repo" -Method Get
  Write-Host "Repo exists: $($existing.html_url)"
} catch {
  Write-Host "Creating repo $Owner/$Repo ($Visibility)..."
  $body = @{
    name        = $Repo
    description = "Lightweight MV3 Chrome/Edge extension: sit-break + micro-motion reminders. Privacy-first, local-only."
    homepage    = "https://github.com/$Owner/$Repo"
    private     = ($Visibility -ne "public")
    has_issues  = $true
    has_wiki    = $false
    auto_init   = $false
  } | ConvertTo-Json
  $created = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/user/repos" -Method Post -Body $body -ContentType "application/json"
  Write-Host "Created: $($created.html_url)"
}

$remoteUrl = "https://$($env:GITHUB_TOKEN)@github.com/$Owner/$Repo.git"
git remote remove origin 2>$null
git remote add origin "https://github.com/$Owner/$Repo.git"

# Push using token via extraheader (avoids token in remote URL permanent config)
git -c "http.https://github.com/.extraheader=AUTHORIZATION: token $($env:GITHUB_TOKEN)" push -u origin $Branch --force

Write-Host ""
Write-Host "Done: https://github.com/$Owner/$Repo"
Write-Host "Then clear token from this shell: Remove-Item Env:GITHUB_TOKEN"
Write-Host "IMPORTANT: revoke the token on GitHub if it was ever pasted into chat."
