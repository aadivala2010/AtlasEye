@echo off
rem Atlas Eye — one-click local start. Installs dependencies on first run, then opens the dev server.
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install || (pause & exit /b 1)
)

rem Open the browser a few seconds after the server starts listening.
start "" /b cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:3000"
call npm run dev
pause
