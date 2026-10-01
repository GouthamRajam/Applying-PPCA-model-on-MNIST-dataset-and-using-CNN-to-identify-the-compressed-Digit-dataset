# Builds .\Senson\Senson.exe from the Electron runtime and the Senson files in .\senson-app
# Needs internet once (downloads Electron 33.2.1 from GitHub). No admin rights needed.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$v = '33.2.1'
$zip = "electron-v$v-win32-x64.zip"
if (-not (Test-Path $zip)) {
  Write-Host 'Downloading Electron runtime (about 110 MB)...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/electron/electron/releases/download/v$v/$zip" -OutFile $zip
}
if (Test-Path 'Senson') { Remove-Item -Recurse -Force 'Senson' }
Expand-Archive -Path $zip -DestinationPath 'Senson'
Rename-Item -Path 'Senson\electron.exe' -NewName 'Senson.exe'
Remove-Item -Force -ErrorAction SilentlyContinue 'Senson\resources\default_app.asar'
Copy-Item -Recurse -Path 'senson-app' -Destination 'Senson\resources\app'
Copy-Item -Path 'README.txt' -Destination 'Senson\README.txt'
Write-Host ''
Write-Host 'Done. Start Senson with: Senson\Senson.exe'
