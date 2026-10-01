@echo off
REM Double-click to build and start Senson. See README.txt.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-senson.ps1"
if errorlevel 1 (
  echo.
  echo Setup failed. If downloads or scripts are blocked, follow "Manual setup" in README.txt.
  pause
  exit /b 1
)
start "" "%~dp0Senson\Senson.exe"
