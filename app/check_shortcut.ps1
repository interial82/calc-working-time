$ws = New-Object -ComObject WScript.Shell
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
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = $ws.CreateShortcut($desktop + '\근무시간 계산기.lnk')
Write-Output ("target=" + $lnk.TargetPath)
Write-Output ("icon=" + $lnk.IconLocation)
Write-Output ("workdir=" + $lnk.WorkingDirectory)
Write-Output ("exists=" + (Test-Path $lnk.TargetPath))
