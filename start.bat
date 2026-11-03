@echo off
title LivePrep Multimodal Agent Launcher
echo ========================================================
echo       Starting LivePrep (Backend + Frontend)
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
start "LivePrep - Backend" cmd /k "cd /d "%~dp0backend" && .\.venv\Scripts\python.exe app.py"

:: Wait 2 seconds reliably
ping 127.0.0.1 -n 3 >nul

:: Start Frontend Server
echo [2/2] Starting Frontend Vite Dev Server on http://localhost:3000 ...
start "LivePrep - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo ========================================================
echo LivePrep is starting up!
echo Frontend: http://localhost:3000
echo Backend API & WS: http://localhost:8000
echo ========================================================
echo.
