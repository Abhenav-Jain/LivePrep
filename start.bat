@echo off
title OmniCopilot Live Launcher
echo ========================================================
echo       Starting OmniCopilot Live (Backend + Frontend)
echo ========================================================
echo.

:: Check if virtualenv exists
if not exist "%~dp0backend\.venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found in backend\.venv
    echo Please run setup first.
    pause
    exit /b 1
)

:: Start Backend Server
echo [1/2] Starting Backend FastAPI Server on http://localhost:8000 ...
start "OmniCopilot Live - Backend" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\python.exe app.py"

:: Wait 2 seconds
timeout /t 2 /nobreak >nul

:: Start Frontend Server
echo [2/2] Starting Frontend Vite Dev Server on http://localhost:3000 ...
start "OmniCopilot Live - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo ========================================================
echo OmniCopilot Live is starting up!
echo Frontend: http://localhost:3000
echo Backend API & WS: http://localhost:8000
echo ========================================================
echo.
pause
