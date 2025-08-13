param(
  [string]$ProjectPath = "$PSScriptRoot\..\..\..",
  [string]$OutDir      = "$PSScriptRoot\..\..\STOP_Packages",
  [string]$PackageName = "BFF_STOP_Package"
)
$ProjectPath = (Resolve-Path $ProjectPath).Path
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir  = (Resolve-Path $OutDir).Path
$stamp   = Get-Date -Format "yyyyMMdd-HHmmss"
$pkgDir  = Join-Path $OutDir "$PackageName-$stamp"

# Build package folder
New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null

# What to include (add/remove lines as you like)
$include = @(
  "trey-suite",
  "supabase\functions",
  ".github\workflows\pages.yml"
)

foreach($item in $include){
  $src = Join-Path $ProjectPath $item
  if(Test-Path $src){
    $dst = Join-Path $pkgDir $item
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    if((Get-Item $src).PSIsContainer){ Copy-Item $src $dst -Recurse -Force }
    else { Copy-Item $src $dst -Force }
  }
}

# Logs
$logsDir = Join-Path $pkgDir "_logs"; New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
try {
  Push-Location $ProjectPath
  "== git status ==", (git status 2>&1), "`n== last 10 commits ==", (git log -n 10 --oneline 2>&1) |
    Out-File (Join-Path $logsDir "git.txt") -Encoding utf8
} catch {} finally { Pop-Location | Out-Null }

# Protocol & templates
$proto = Join-Path $pkgDir "protocol\SESSION_CONCLUDE_PROTOCOL.txt"
New-Item -ItemType Directory -Force -Path (Split-Path $proto) | Out-Null
"Paste your session conclude checklist here (placeholder)." | Out-File $proto -Encoding utf8
"Session,Next Steps,Owner,Due,Notes" | Out-File (Join-Path $pkgDir "templates\Progress_TimeCost.csv") -Encoding utf8
"# Transcript Log`n" | Out-File (Join-Path $pkgDir "templates\Transcript_Log.md") -Encoding utf8

# Zip it
$zip = Join-Path $OutDir "$PackageName-$stamp.zip"
Compress-Archive -Path "$pkgDir\*" -DestinationPath $zip -Force
Write-Host "Packaged -> $zip" -ForegroundColor Green
