@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js 22.13 tro len de chay trang.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Dang cai dat lan dau...
  call npm install
  if errorlevel 1 (
    echo Cai dat khong thanh cong.
    pause
    exit /b 1
  )
)

echo Dang mo Lap Gallery tai http://localhost:3000/
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:3000/'"
call npm run dev
