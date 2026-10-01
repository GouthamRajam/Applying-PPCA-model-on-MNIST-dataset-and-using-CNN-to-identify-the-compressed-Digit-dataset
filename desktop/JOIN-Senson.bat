@echo off
rem Joins the 5 downloaded parts into Senson-win-x64.zip and unzips it.
cd /d "%~dp0"
for %%i in (0 1 2 3 4) do if not exist "Senson-win-x64.zip.part%%i" (echo Missing Senson-win-x64.zip.part%%i - put all 5 parts in this folder. & pause & exit /b 1)
copy /b Senson-win-x64.zip.part0+Senson-win-x64.zip.part1+Senson-win-x64.zip.part2+Senson-win-x64.zip.part3+Senson-win-x64.zip.part4 Senson-win-x64.zip >nul
echo Joined. Unzipping...
powershell -NoProfile -Command "Expand-Archive -Force -Path Senson-win-x64.zip -DestinationPath ."
if exist "Senson\Senson.exe" (echo Done. Starting Senson... & start "" "Senson\Senson.exe") else (echo Unzip failed - right-click Senson-win-x64.zip and choose Extract All.)
pause
