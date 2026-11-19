# Installs the NSIS installer silently into the user's profile, runs the smoke test on the installed program,
# then uninstalls it. Usage: powershell -File smoke-installer.ps1 -Setup <...-setup.exe> -OutDir <folder>
param([Parameter(Mandatory = $true)][string]$Setup, [Parameter(Mandatory = $true)][string]$OutDir)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$script:failed = 0
$script:passed = 0
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
function Step([string]$Name, [scriptblock]$Body) {
  try { & $Body; $script:passed++; Write-Host "  ok    $Name" }
  catch { $script:failed++; Write-Host "  FAIL  $Name`n        $($_ | Out-String)" }
}

Write-Host "installer: $Setup ($((Get-Item $Setup).Length) bytes)"
$installDir = $null
$exe = $null

Step 'silent install (/S) into the user profile' {
  $p = Start-Process -FilePath $Setup -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "installer exit code $($p.ExitCode)" }
  Start-Sleep -Seconds 3
  # The installer must not leave a running agent behind in silent mode; stop one if it did.
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^dopadam' } | ForEach-Object { Write-Host "  (a $($_.ProcessName) process was started by the installer; stopping it)"; $_ | Stop-Process -Force }
  $candidates = @("$env:LOCALAPPDATA\DopaDam", "$env:LOCALAPPDATA\Programs\DopaDam")
  $script:installDir = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $script:installDir) {
    Get-ChildItem $env:LOCALAPPDATA -Directory | ForEach-Object { Write-Host "  LOCALAPPDATA: $($_.Name)" }
    throw 'no install folder under LOCALAPPDATA'
  }
  Get-ChildItem $script:installDir -Recurse | ForEach-Object { Write-Host "  $($_.FullName.Substring($script:installDir.Length)) ($($_.Length))" }
  $script:exe = Get-ChildItem $script:installDir -Filter *.exe | Where-Object { $_.Name -notmatch '^uninstall' } | Select-Object -First 1 -ExpandProperty FullName
  if (-not $script:exe) { throw 'no program in the install folder' }
  Write-Host "  installed program: $($script:exe)"
}

Step 'Start menu shortcut and uninstall entry exist' {
  $lnk = Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter 'DopaDam*.lnk' -ErrorAction SilentlyContinue
  if (-not $lnk) { throw 'no Start menu shortcut' }
  Write-Host "  shortcut: $($lnk[0].FullName)"
  $key = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like 'DopaDam*' }
  if (-not $key) { throw 'no uninstall registry entry' }
  Write-Host "  uninstall entry: $($key[0].PSChildName)"
}

if ($script:exe) {
  & node (Join-Path $here 'smoke.mjs') $script:exe $OutDir
  $smokeCode = $LASTEXITCODE
  Step 'smoke test on the installed program' { if ($smokeCode -ne 0) { throw "smoke.mjs exited with $smokeCode" } }
}

# A failed smoke test can leave the installed agent running; it would block the uninstall and take over later tests (single instance).
$left = Get-Process dopadam -ErrorAction SilentlyContinue
if ($left) { Write-Host "  stopping $($left.Count) dopadam process(es) left running"; $left | Stop-Process -Force; Start-Sleep -Seconds 2 }

Step 'silent uninstall removes the program' {
  if (-not $script:installDir) { throw 'nothing was installed' }
  $un = Join-Path $script:installDir 'uninstall.exe'
  if (-not (Test-Path $un)) { throw 'no uninstall.exe' }
  Start-Process -FilePath $un -ArgumentList '/S' -Wait
  $deadline = (Get-Date).AddSeconds(40)
  while ((Test-Path $script:exe) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
  if (Test-Path $script:exe) { throw 'the program is still there after uninstalling' }
}

Write-Host "`ninstaller: $script:passed passed, $script:failed failed"
if ($script:failed -gt 0) { exit 1 }
