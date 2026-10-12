# Builds the Android app: .\android\build.ps1 [gradle tasks...]   (default: test + release APK)
#
# Java tools on Windows cannot read command-line paths with non-ASCII letters (e.g. "D:\Hoc" with a
# diacritic), so the build runs from a temporary drive letter that points at the repository.
param([Parameter(ValueFromRemainingArguments = $true)][string[]] $Tasks)

$ErrorActionPreference = 'Stop'
if (-not $Tasks -or $Tasks.Count -eq 0) { $Tasks = @('testDebugUnitTest', 'assembleRelease') }

$repo = Split-Path -Parent $PSScriptRoot
if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem "$env:LOCALAPPDATA\Programs\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue |
        Where-Object Name -like 'jdk-17*' | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}

$used = (Get-PSDrive -PSProvider FileSystem).Name
$letter = [char[]]('PQRSTUVWXYZ') | Where-Object { $used -notcontains [string]$_ } | Select-Object -First 1
if (-not $letter) { throw 'No free drive letter for the temporary build drive.' }

subst "${letter}:" $repo
try {
    Push-Location "${letter}:\android"
    & .\gradlew.bat @Tasks
    $code = $LASTEXITCODE
}
finally {
    Pop-Location
    subst "${letter}:" /d
}
if ($code -eq 0) {
    $apk = Join-Path $repo 'android\app\build\outputs\apk'
    Write-Host "Build OK. APKs in $apk"
}
exit $code
