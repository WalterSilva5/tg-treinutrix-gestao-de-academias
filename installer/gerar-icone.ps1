Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 64, 64
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$orange = [System.Drawing.Color]::FromArgb(249, 115, 22)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 14
$path.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
$path.AddArc(64 - $r * 2, 0, $r * 2, $r * 2, 270, 90)
$path.AddArc(64 - $r * 2, 64 - $r * 2, $r * 2, $r * 2, 0, 90)
$path.AddArc(0, 64 - $r * 2, $r * 2, $r * 2, 90, 90)
$path.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush($orange)), $path)

$branco = [System.Drawing.Brushes]::White
$g.FillRectangle($branco, 10, 25, 5, 14)
$g.FillRectangle($branco, 49, 25, 5, 14)
$g.FillRectangle($branco, 15, 21, 7, 22)
$g.FillRectangle($branco, 42, 21, 7, 22)
$g.FillRectangle($branco, 21, 29, 22, 6)

$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = [System.IO.File]::Create((Join-Path $PSScriptRoot 'treinutrix.ico'))
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$g.Dispose()
$bmp.Dispose()
Write-Host 'icon gerado'
