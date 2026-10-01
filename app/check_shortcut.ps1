$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = $ws.CreateShortcut($desktop + '\근무시간 계산기.lnk')
Write-Output ("target=" + $lnk.TargetPath)
Write-Output ("icon=" + $lnk.IconLocation)
Write-Output ("workdir=" + $lnk.WorkingDirectory)
Write-Output ("exists=" + (Test-Path $lnk.TargetPath))
