@echo off
rem Copyright 2026 interial82
rem 
rem Licensed under the Apache License, Version 2.0 (the "License");
rem you may not use this file except in compliance with the License.
rem You may obtain a copy of the License at
rem 
rem     http://www.apache.org/licenses/LICENSE-2.0
rem 
rem Unless required by applicable law or agreed to in writing, software
rem distributed under the License is distributed on an "AS IS" BASIS,
rem WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
rem See the License for the specific language governing permissions and
rem limitations under the License.
rem 근무시간 계산기 실행자 (PowerShell 내장, Python 불필요)
rem 실행하면 서버가 뜨고 페이지(http://127.0.0.1:8737/)가 자동으로 열립니다.
rem 서버 종료: 작업 표시줄의 검은 창 닫기 (또는 작업 관리자에서 powershell 종료)
cd /d "%~dp0app"
start "WorkToastServer" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "toast_server.ps1"
exit /b
