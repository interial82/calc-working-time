# 근무시간 계산기 바탕화면 바로가기 생성
# 자기 위치 기준 동적 경로: 이 스크립트는 app\ 폴더에 있고,
#   BAT  = 상위 폴더의 '근무시간 계산기.bat'
#   ICON = 이 폴더의 app.ico
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$root    = Split-Path -Parent $here
$bat     = Join-Path $root '근무시간 계산기.bat'
$icon    = Join-Path $here 'app.ico'

if (-not (Test-Path $bat))  { Write-Output ("FAIL: bat not found: " + $bat);  exit 1 }
if (-not (Test-Path $icon)) { Write-Output ("FAIL: icon not found: " + $icon); exit 1 }

$ws      = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop '근무시간 계산기.lnk'
$sc      = $ws.CreateShortcut($lnkPath)
$sc.TargetPath       = $bat
$sc.WorkingDirectory = $here
$sc.IconLocation     = ($icon + ',0')
$sc.Description      = '근무시간 계산기 실행'
$sc.Save()

# 저장 후 실제 반영 확인 (아이콘 경로 포함)
$chk = $ws.CreateShortcut($lnkPath)
Write-Output ("created: " + $lnkPath)
Write-Output ("target=" + $chk.TargetPath)
Write-Output ("workdir=" + $chk.WorkingDirectory)
Write-Output ("icon=" + $chk.IconLocation)

# 아이콘 캐시 갱신 (shell32 notify)
Add-Type -Namespace Win32 -Name SH -MemberDefinition '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, int uFlags, System.IntPtr dwItem1, System.IntPtr dwItem2);' -ErrorAction SilentlyContinue
[Win32.SH]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)  # SHCNE_ASSOCCHANGED
Write-Output "icon cache refreshed"
