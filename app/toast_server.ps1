# 근무시간 계산기 — Windows 토스트 실행자 (PowerShell 내장, Python 불필요)
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
# - 로컬 HTTP 서버 (127.0.0.1:8737): 브라우저가 /toast 요청을 보내면 Windows 우하단 토스트 표시
# - 창 최소화 상태에서도 토스트는 시스템 레벨이라 정상 표시
# - 브라우저 탭이 닫혀 /ping이 4분간 없으면 자동 종료 (상주 안 함)
# 요구사항: Windows 10/11 (기본 내장 PowerShell 5.1)
# ※ 이 파일은 UTF-8 BOM 인코딩이어야 합니다 (PowerShell 5.1 호환).

$Port = 8737
$IdleExitSec = 240
$LogFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "toast_server.log"

function Log([string]$msg) {
  try {
    Add-Content -Path $LogFile -Value ((Get-Date).ToString("HH:mm:ss") + " " + $msg) -Encoding UTF8
  } catch {}
}

$png = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]

function Show-Toast([string]$title, [string]$body) {
  try {
    $tmpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $texts = $tmpl.GetElementsByTagName("text")
    $texts.Item(0).AppendChild($tmpl.CreateTextNode($title)) | Out-Null
    $texts.Item(1).AppendChild($tmpl.CreateTextNode($body)) | Out-Null
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("근무시간 계산기")
    $toast = [Windows.UI.Notifications.ToastNotification]::new($tmpl)
    try {
      $toast.Data.Duration = [Windows.UI.Notifications.ToastDuration]::Long
    } catch {
      # Duration 타입 로드 실패 시 기본 지속시간으로 표시 (토스트 자체는 발동)
    }
    $notifier.Show($toast)
    return $true
  } catch {
    Log ("toast error: " + $_.Exception.Message)
    return $false
  }
}

function Parse-Query([string]$q) {
  $map = @{}
  foreach ($pair in $q.TrimStart('?').Split('&')) {
    if (-not $pair) { continue }
    $kv = $pair.Split('=', 2)
    $key = [Uri]::UnescapeDataString($kv[0])
    $val = if ($kv.Length -gt 1) { [Uri]::UnescapeDataString($kv[1]) } else { "" }
    $map[$key] = $val
  }
  return $map
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$started = $true
try {
  $listener.Start()
} catch {
  $started = $false
}

if (-not $started) {
  # 포트 충돌: 이미 실행 중인 서버인지 확인 (ping 성공이면 그 서버로 페이지 열기)
  try {
    $probe = New-Object System.Net.WebClient
    $probe.DownloadString("http://127.0.0.1:$Port/ping") | Out-Null
    Log "existing server alive -> open page, exit"
    Start-Process "http://127.0.0.1:$Port/"
    exit 0
  } catch {
    Log ("start failed: " + $_.Exception.Message)
    exit 1
  }
}
Log ("listening: http://127.0.0.1:" + $Port + "/")

# 페이지 자동 접속: 서버가 서빙하는 http 주소로 열기
# (file:// 로 열면 Chrome/Edge의 로컬 네트워크 차단으로 비컨이 막힘 → 반드시 http:// 사용)
try {
  Start-Process "http://127.0.0.1:$Port/"
  Log ("opened page: http://127.0.0.1:" + $Port + "/")
} catch {
  Log "open page failed"
}

$lastPing = Get-Date
$peers = @{}   # 클라이언트 id -> @{t;u} (타 브라우저 열림 감지용)
$script:focusReq = ""   # 포커스 요청된 대상 클라이언트 id (peers.js 응답 시 1회 전달)

# 창 최전면 활성화용 Win32 API (목록 행 클릭 → 해당 탭이 있는 창 foreground)
if (-not ('Win32Focus.Win32' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
namespace Win32Focus {
  public class Win32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  }
}
"@
}
function Activate-AppWindow() {
  $found = New-Object System.Collections.ArrayList
  $cb = [Win32Focus.Win32+EnumWindowsProc]{
    param($h, $l)
    if ([Win32Focus.Win32]::IsWindowVisible($h)) {
      $len = [Win32Focus.Win32]::GetWindowTextLength($h)
      if ($len -gt 0) {
        $sb = New-Object System.Text.StringBuilder($len + 1)
        [void][Win32Focus.Win32]::GetWindowText($h, $sb, $sb.Capacity)
        if ($sb.ToString() -like "*근무시간 계산기*") { [void]$found.Add($h) }
      }
    }
    return $true
  }
  [void][Win32Focus.Win32]::EnumWindows($cb, [IntPtr]::Zero)
  if ($found.Count -eq 0) { return $false }
  # foreground lock 우회: ALT 키 이벤트 1회
  [Win32Focus.Win32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [Win32Focus.Win32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  foreach ($h in $found) {
    [void][Win32Focus.Win32]::ShowWindow($h, 9)   # SW_RESTORE (최소화된 창 복원)
    [void][Win32Focus.Win32]::SetForegroundWindow($h)
  }
  return $true
}
# BeginGetContext는 항상 단 1개만 미완료 상태로 유지 (타임아웃 시 버리면 http.sys에 요청이 갇힘)
$ar = $listener.BeginGetContext($null, $null)
while ($listener.IsListening) {
  if ($ar.AsyncWaitHandle.WaitOne(30000)) {
    try {
      $ctx = $listener.EndGetContext($ar)
    } catch {
      $ar = $listener.BeginGetContext($null, $null)
      continue
    }
    $lastPing = Get-Date
    $path = $ctx.Request.Url.AbsolutePath
    $method = $ctx.Request.HttpMethod
    $code = 200
    if ($method -eq "POST" -and $path -eq "/backup") {
      # 자동 백업 미러: 요청 본문을 backup_auto.txt에 원자적 저장
      try {
        $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream)
        $body = $reader.ReadToEnd()
        $reader.Close()
        if ($body.Length -gt 10) {
          $bakFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "backup_auto.txt"
          $tmp = $bakFile + ".tmp"
          [System.IO.File]::WriteAllText($tmp, $body, [System.Text.Encoding]::UTF8)
          Move-Item -Force $tmp $bakFile
          Log ("backup_auto.txt updated (" + $body.Length + " bytes)")
          # 일 1회 스냅샷: app\snapshot\backup_YYYY-MM-DD.txt (당일 최초 저장 시에만), 30일 초과분 정리
          try {
            $dir = Split-Path -Parent $MyInvocation.MyCommand.Path
            $snapDir = Join-Path $dir "snapshot"
            if (-not (Test-Path $snapDir)) { New-Item -ItemType Directory -Path $snapDir | Out-Null }
            $snap = Join-Path $snapDir ("backup_" + (Get-Date).ToString("yyyy-MM-dd") + ".txt")
            if (-not (Test-Path $snap)) {
              Copy-Item $bakFile $snap
              Log ("daily snapshot: snapshot\" + (Split-Path $snap -Leaf))
              Show-Toast "근무시간 계산기" ("일일 스냅샷 생성: backup_" + (Get-Date).ToString("yyyy-MM-dd") + ".txt") | Out-Null
            }
            foreach ($f in Get-ChildItem (Join-Path $snapDir "backup_*.txt")) {
              if ((Get-Date) - $f.LastWriteTime -gt (New-TimeSpan -Days 30)) {
                Remove-Item $f.FullName
                Log ("snapshot pruned: " + $f.Name)
              }
            }
          } catch { Log ("snapshot failed: " + $_.Exception.Message) }
        }
      } catch {
        Log ("backup write failed: " + $_.Exception.Message)
        $code = 500
      }
    } elseif ($path -eq "/backup") {
      # 자동 백업 파일 반환 (브라우저 변경 시 공유 저장소): GET /backup → backup_auto.txt
      try {
        $bakFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "backup_auto.txt"
        if (Test-Path $bakFile) {
          $bytes = [System.IO.File]::ReadAllBytes($bakFile)
          $ctx.Response.ContentType = "text/plain; charset=utf-8"
          $ctx.Response.ContentLength64 = $bytes.Length
          $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
          Log "backup served (file:// origin sync)"
        } else { $code = 404 }
      } catch { $code = 500 }
    } elseif ($path -eq "/backup.js") {
      # JSONP: file:// 페이지는 fetch가 차단되므로 script 태그로 읽는다 (CORS 대상 아님)
      try {
        $bakFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "backup_auto.txt"
        if (Test-Path $bakFile) {
          $json = [System.IO.File]::ReadAllText($bakFile, [System.Text.Encoding]::UTF8)
          $js = "window.__serverBackup=" + $json + ";"
          $bytes = [System.Text.Encoding]::UTF8.GetBytes($js)
          $ctx.Response.ContentType = "text/javascript; charset=utf-8"
          $ctx.Response.ContentLength64 = $bytes.Length
          $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
          Log "backup.js served"
        } else { $code = 404 }
      } catch { $code = 500 }
    } elseif ($path -eq "/peers-leave") {
      # 탭 종료 beacon: 해당 클라이언트 즉시 제거
      $q = Parse-Query $ctx.Request.Url.Query
      $id = if ($q.ContainsKey("id")) { $q["id"] } else { "" }
      if ($id -and $script:peers.ContainsKey($id)) {
        $script:peers.Remove($id)
        Log ("peer left: " + $id)
      }
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("ok")
      $ctx.Response.ContentType = "text/plain; charset=utf-8"
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } elseif ($path -eq "/focus") {
      # 목록 행 클릭: 대상 탭이 있는 브라우저 창을 최전면으로 (창 제목 '근무시간 계산기' 검색)
      $ok = Activate-AppWindow
      Log ("focus request -> activate=" + $ok)
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("ok")
      $ctx.Response.ContentType = "text/plain; charset=utf-8"
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } elseif ($path -eq "/peers.js") {
      # 클라이언트 등록 + 다른 클라이언트 목록 반환 (타 브라우저/탭 열림 감지)
      $q = Parse-Query $ctx.Request.Url.Query
      $id = if ($q.ContainsKey("id")) { $q["id"] } else { "" }
      $u  = if ($q.ContainsKey("u"))  { $q["u"]  } else { "" }
      if ($id) { $script:peers[$id] = @{ t=(Get-Date); u=$u } }
      $now = Get-Date
      $items = New-Object System.Collections.ArrayList
      foreach ($k in @($script:peers.Keys)) {
        if (($now - $script:peers[$k].t).TotalSeconds -gt 45) { $script:peers.Remove($k) }
        elseif ($k -ne $id) {
          $age = [int]($now - $script:peers[$k].t).TotalSeconds
          [void]$items.Add('{"u":' + (ConvertTo-Json $script:peers[$k].u) + ',"age":' + $age + '}')
        }
      }
      $js = "window.__peers=" + $items.Count + ";window.__peersInfo=[" + ($items -join ",") + "];"
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($js)
      $ctx.Response.ContentType = "text/javascript; charset=utf-8"
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } elseif ($path -eq "/snapshots.js") {
      # 스냅샷 목록 (JSONP): app\snapshot\backup_*.txt
      try {
        $snapDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "snapshot"
        $items = New-Object System.Collections.ArrayList
        if (Test-Path $snapDir) {
          foreach ($f in (Get-ChildItem (Join-Path $snapDir "backup_*.txt") | Sort-Object Name -Descending)) {
            $d = $f.BaseName -replace "^backup_",""
            [void]$items.Add('{"d":"' + $d + '","kb":' + ([math]::Round($f.Length/1024,1)) + '}')
          }
        }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("window.__snapshots=[" + ($items -join ",") + "];")
        $ctx.Response.ContentType = "text/javascript; charset=utf-8"
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } catch { $code = 500 }
    } elseif ($path -eq "/snapshot.js") {
      # 특정 스냅샷 내용 (JSONP): /snapshot.js?d=YYYY-MM-DD
      $q = Parse-Query $ctx.Request.Url.Query
      $d = if ($q.ContainsKey("d")) { $q["d"] } else { "" }
      $snapFile = Join-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "snapshot") ("backup_" + $d + ".txt")
      if ($d -notmatch '^\d{4}-\d{2}-\d{2}$' -or -not (Test-Path $snapFile)) {
        $code = 404
      } else {
        $json = [System.IO.File]::ReadAllText($snapFile, [System.Text.Encoding]::UTF8)
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("window.__snapshotData=" + $json + ";")
        $ctx.Response.ContentType = "text/javascript; charset=utf-8"
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        Log ("snapshot served: " + $d)
      }
    } elseif ($path -eq "/shortcut") {
      # 바탕화면 바로가기 생성 (app.ico 사용)
      try {
        $ps1 = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "make_shortcut.ps1"
        if (Test-Path $ps1) {
          & powershell -NoProfile -ExecutionPolicy Bypass -File $ps1 | Out-Null
          Log "shortcut created"
          Show-Toast "근무시간 계산기" "바탕화면 바로가기를 생성했습니다." | Out-Null
        } else { $code = 404 }
      } catch { Log ("shortcut failed: " + $_.Exception.Message); $code = 500 }
    } elseif ($path -eq "/help.js") {
      # README.md 내용 (JSONP): 앱 내 도움말 모달 표시용
      try {
        $mdFile = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "README.md"
        if (Test-Path $mdFile) {
          $md = [System.IO.File]::ReadAllText($mdFile, [System.Text.Encoding]::UTF8)
          $json = ConvertTo-Json $md   # ConvertTo-Json이 역슬래시/개행 자동 이스케이프
          $json = $json.Replace('</', '<\/')
          $bytes = [System.Text.Encoding]::UTF8.GetBytes("window.__helpMd=" + $json + ";")
          $ctx.Response.ContentType = "text/javascript; charset=utf-8"
          $ctx.Response.ContentLength64 = $bytes.Length
          $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else { $code = 404 }
      } catch { $code = 500 }
    } elseif ($path -eq "/toast") {
      $q = Parse-Query $ctx.Request.Url.Query
      $title = if ($q.ContainsKey("title")) { $q["title"] } else { "근무 알림" }
      $body  = if ($q.ContainsKey("body"))  { $q["body"] }  else { "" }
      $ok = Show-Toast $title $body
      if (-not $ok) { $code = 500 }
      Log ("toast ok=" + $ok + " " + $title)
    } elseif ($path -eq "/ping") {
      # ping 도달 기록 (1분 간격 스로틀) — 브라우저 연결 확인용
      if (-not $script:lastPingLog -or ((Get-Date) - $script:lastPingLog).TotalSeconds -gt 60) {
        $script:lastPingLog = Get-Date
        Log "ping from browser"
      }
    } elseif ($path -eq "/") {
      # 서버가 index.html 직접 서빙 (http://127.0.0.1:8737/ )
    } else {
      $code = 404
    }
    try {
      $ctx.Response.StatusCode = $code
      $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
      # file:// (index.html 직접 실행) 페이지의 localhost 접근 허용 (Chrome Private Network Access)
      $ctx.Response.Headers.Add("Access-Control-Allow-Private-Network", "true")
      $ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      $ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
      if ($method -eq "OPTIONS") {
        $ctx.Response.StatusCode = 204
        $ctx.Response.Close()
        $ar = $listener.BeginGetContext($null, $null)
        continue
      }
      if ($path -eq "/") {
        # 서버가 index.html 직접 서빙 (http://127.0.0.1:8737/ )
        $htmlFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "index.html"
        $bytes = [System.IO.File]::ReadAllBytes($htmlFile)
        $ctx.Response.ContentType = "text/html; charset=utf-8"
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $ctx.Response.ContentType = "image/png"
        $ctx.Response.ContentLength64 = $png.Length
        $ctx.Response.OutputStream.Write($png, 0, $png.Length)
      }
      $ctx.Response.Close()
    } catch {}
    $ar = $listener.BeginGetContext($null, $null)
  } else {
    # 30초 무통신마다 점검: 최근 활동(탭 heartbeat) 후 90초 초과면 자동 종료
    if (((Get-Date) - $lastPing).TotalSeconds -gt 90) {
      Log ("no browser activity 90s -> auto exit (last activity " + $lastPing.ToString("HH:mm:ss") + ")")
      Show-Toast "근무시간 계산기" "브라우저 연결이 없어 서버를 자동 종료합니다." | Out-Null
      break
    }
    continue
  }
}
$listener.Close()
