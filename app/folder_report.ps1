# 폴더 스냅샷 리포트: 최상위/BAT 잔여물 점검 + app\ 파일 목록
# Copyright 2026 interial82
# 
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# 
#     http://www.apache.org/licenses/LICENSE-2.0
# 
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File folder_report.ps1
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$app  = Join-Path $root "app"
$out  = Join-Path $app "folder_report.txt"

$lines = New-Object System.Collections.ArrayList
[void]$lines.Add("근무시간 계산기 폴더 스냅샷 리포트")
[void]$lines.Add("생성: " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"))
[void]$lines.Add("")
[void]$lines.Add("=== 최상위 (" + $root + ") ===")
foreach ($f in Get-ChildItem $root -File) {
  [void]$lines.Add(("{0,-30} {1,8} bytes  {2}" -f $f.Name, $f.Length, $f.LastWriteTime.ToString("MM-dd HH:mm")))
}
[void]$lines.Add("")
[void]$lines.Add("=== app\ ===")
foreach ($f in Get-ChildItem $app -File) {
  [void]$lines.Add(("{0,-30} {1,8} bytes  {2}" -f $f.Name, $f.Length, $f.LastWriteTime.ToString("MM-dd HH:mm")))
}
[void]$lines.Add("")
[void]$lines.Add("=== 잔여물 점검 ===")
# 이동 전 최상위에 있던 파일들이 최상위에 남아 있으면 경고
$staleTop = @("index.html","toast_server.ps1","backup_auto.txt","toast_server.log","README.md","start_toast_server.bat","toast_server.py","check.js")
$warn = 0
foreach ($n in $staleTop) {
  if (Test-Path (Join-Path $root $n)) {
    [void]$lines.Add("경고: 최상위에 구 파일 잔여 -> " + $n)
    $warn++
  }
}
if ($warn -eq 0) { [void]$lines.Add("최상위 구 파일 잔여: 없음 (BAT 하나만 정상)") }
# BAT 정상 여부
$bat = Get-ChildItem $root -Filter *.bat
if ($bat.Count -eq 1) { [void]$lines.Add("BAT: 정상 1개 -> " + $bat[0].Name) }
else { [void]$lines.Add("경고: BAT 개수 = " + $bat.Count) }
# 필수 파일 존재
foreach ($n in @("index.html","toast_server.ps1","backup_auto.txt")) {
  if (-not (Test-Path (Join-Path $app $n))) { [void]$lines.Add("경고: app\" + $n + " 없음") }
}
# 스냅샷 목록 (app\snapshot\)
$snapDir = Join-Path $app "snapshot"
if (Test-Path $snapDir) {
  $snap = Get-ChildItem $snapDir -Filter "backup_*.txt"
  [void]$lines.Add("일일 스냅샷 (app\snapshot\): " + (($snap | ForEach-Object { $_.Name }) -join ", "))
} else {
  [void]$lines.Add("일일 스냅샷 폴더 없음 (app\snapshot\)")
}
$text = $lines -join "`r`n"
[System.IO.File]::WriteAllText($out, $text, [System.Text.Encoding]::UTF8)
Write-Output $text
Write-Output ("saved: " + $out)
