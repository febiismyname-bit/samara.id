@echo off
chcp 65001 >nul
title SAMARA
cd /d "%~dp0"
echo ========================================
echo   SAMARA - Server Lokal
echo ========================================
echo.
echo Menjalankan server...
echo Buka browser: http://127.0.0.1:8000
echo.
python server.py
echo.
echo Server berhenti. Tekan tombol apa pun untuk menutup jendela.
pause >nul
