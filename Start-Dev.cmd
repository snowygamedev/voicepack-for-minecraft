@echo off
rem ---------------------------------------------------------------------------
rem  Double-click this to launch VoicePack in development mode.
rem
rem  Equivalent to `npm run dev`, but it also finds Node if it isn't on PATH,
rem  installs dependencies on a fresh clone, and keeps the window open when
rem  something fails so the error is actually readable.
rem
rem  The filename has no space on purpose: "Start Dev.cmd" typed at a prompt is
rem  parsed as the START built-in plus an argument, and fails with a baffling
rem  "cannot find Dev.cmd".
rem ---------------------------------------------------------------------------
setlocal
title VoicePack - dev

rem Run from this file's folder, whatever directory the shell started in.
cd /d "%~dp0"

rem Electron-based editors export ELECTRON_RUN_AS_NODE for their helper
rem processes. Inheriting it makes Electron boot as plain Node and die with a
rem confusing "Cannot read properties of undefined (reading 'isPackaged')".
rem scripts/dev.mjs strips it too; clearing it here keeps the whole window sane.
set "ELECTRON_RUN_AS_NODE="

where node >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
  ) else (
    echo.
    echo   Node.js was not found.
    echo.
    echo   Install the LTS version from https://nodejs.org
    echo   then double-click this file again.
    echo.
    pause
    exit /b 1
  )
)

if not exist "node_modules\" (
  echo.
  echo   First run - installing dependencies.
  echo   This takes a minute or two and only happens once.
  echo.
  call npm install
  if errorlevel 1 goto failed
)

echo.
echo   Starting VoicePack...
echo   The app window will open shortly. Edits to the UI reload instantly.
echo.
echo   Press Ctrl+C or close this window to stop.
echo.

call npm run dev
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo   ---------------------------------------------------------------
echo    Something went wrong. The error above explains what.
echo   ---------------------------------------------------------------
echo.
pause
exit /b 1
