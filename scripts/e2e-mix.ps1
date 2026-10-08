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

Start-Process notepad
Start-Sleep -Seconds 2
$sample = Get-Content "$shots\sample.txt" -Encoding UTF8 -Raw
Set-Clipboard $sample.Trim()
$wsh = New-Object -ComObject WScript.Shell
$wsh.SendKeys("^v")
Start-Sleep -Seconds 1

# First text replace translation (hotkey 1)
$wsh.SendKeys("^%1")
Start-Sleep -Seconds 25
Capture "mix1-text-before"

# Fullscreen screenshot translation (hotkey 4)
$wsh.SendKeys("^%4")
Start-Sleep -Seconds 45
Capture "mix2-fullshot"

# Back to notepad, text replace translation again
$wsh.AppActivate("Untitled - Notepad") | Out-Null
Start-Sleep -Seconds 1
$wsh.SendKeys("^a")
Start-Sleep -Seconds 1
$wsh.SendKeys("^%1")
Start-Sleep -Seconds 30
Capture "mix3-text-after"

Get-Process game-translator -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force
"DONE"
