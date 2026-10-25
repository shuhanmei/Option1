@echo off
cd /d "%~dp0"
set "LOCAL_NODE="
for /d %%D in ("%~dp0work\runtime\node-v22.*-win-x64") do if exist "%%~D\node.exe" set "LOCAL_NODE=%%~D"
if defined LOCAL_NODE set "PATH=%LOCAL_NODE%;%PATH%"
node scripts/check-node.mjs
if errorlevel 1 goto failed
if not exist node_modules\vite\bin\vite.js (
  call npm ci
  if errorlevel 1 goto failed
)
call npm run dev -- --open
if errorlevel 1 goto failed
exit /b 0
:failed
pause
exit /b 1
