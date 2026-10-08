Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$shots = "E:\ai app\game-translator\tests\shots"
function Capture($name) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
  $bmp.Save("$shots\$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Set-Location "E:\ai app\game-translator"
Start-Process -FilePath "dist\win-unpacked\game-translator.exe"
Start-Sleep -Seconds 6

$wsh = New-Object -ComObject WScript.Shell
$wsh.SendKeys("^%4")
Start-Sleep -Seconds 60
Capture "fix6-full-60s"
Start-Sleep -Seconds 60
Capture "fix7-full-120s"
Start-Sleep -Seconds 60
Capture "fix8-full-180s"

Get-Process game-translator -ErrorAction SilentlyContinue | Stop-Process -Force
"DONE"
