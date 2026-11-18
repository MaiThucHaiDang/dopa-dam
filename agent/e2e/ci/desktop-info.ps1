# Prints what kind of desktop this machine has (for the CI log).
Add-Type -AssemblyName System.Windows.Forms
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
"screen $($b.Width)x$($b.Height), monitors: $([System.Windows.Forms.Screen]::AllScreens.Count)"
"user $env:USERNAME, session name '$env:SESSIONNAME', UserInteractive: $([Environment]::UserInteractive)"
Get-Process explorer -ErrorAction SilentlyContinue | Select-Object Id, SessionId | Format-Table | Out-String
(Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture | Format-List | Out-String)
Get-Command notepad.exe -ErrorAction SilentlyContinue | Select-Object Source | Format-List | Out-String
