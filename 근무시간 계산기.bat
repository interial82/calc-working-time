@echo off
rem 근무시간 계산기 실행자 (PowerShell 내장, Python 불필요)
rem 실행하면 서버가 뜨고 페이지(http://127.0.0.1:8737/)가 자동으로 열립니다.
rem 서버 종료: 작업 표시줄의 검은 창 닫기 (또는 작업 관리자에서 powershell 종료)
cd /d "%~dp0app"
start "WorkToastServer" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "toast_server.ps1"
exit /b
