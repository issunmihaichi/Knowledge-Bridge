$ErrorActionPreference = "Stop"

$executable = (Resolve-Path "app/src-tauri/target/release/knowledge-bridge.exe").Path
$outputDirectory = Join-Path $env:GITHUB_WORKSPACE "artifacts"
$outputPath = Join-Path $outputDirectory "knowledge-bridge-startup.png"
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$process = Start-Process -FilePath $executable -PassThru

try {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    $process.Refresh()
    if ($process.HasExited) {
      throw "Knowledge Bridge exited before its main window appeared."
    }
    if ($process.MainWindowHandle -ne 0) {
      break
    }
  }

  if ($process.MainWindowHandle -eq 0) {
    throw "Knowledge Bridge did not expose a main window within 30 seconds."
  }

  Add-Type -AssemblyName System.Drawing
  Add-Type @"
using System;
using System.Runtime.InteropServices;

public struct WindowRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}

public static class WindowCapture {
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr handle, out WindowRect rect);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr handle);
}
"@

  $rect = New-Object WindowRect
  $width = 0
  $height = 0
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ([WindowCapture]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) {
      $width = $rect.Right - $rect.Left
      $height = $rect.Bottom - $rect.Top
      if ($width -ge 640 -and $height -ge 480) {
        break
      }
    }
    Start-Sleep -Seconds 1
    $process.Refresh()
    if ($process.HasExited) {
      throw "Knowledge Bridge exited before its main window reached a visible size."
    }
  }

  if ($width -lt 640 -or $height -lt 480) {
    throw "Knowledge Bridge remained hidden at ${width}x${height} after startup."
  }

  [WindowCapture]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 2

  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $graphics.Dispose()
  }

  $sampleCount = 0
  $darkSampleCount = 0
  for ($y = 0; $y -lt $height; $y += 20) {
    for ($x = 0; $x -lt $width; $x += 20) {
      $pixel = $bitmap.GetPixel($x, $y)
      $sampleCount++
      if (($pixel.R + $pixel.G + $pixel.B) -lt 75) {
        $darkSampleCount++
      }
    }
  }

  $bitmap.Dispose()
  $darkRatio = $darkSampleCount / $sampleCount
  Write-Output ("Startup screenshot: {0} ({1}x{2}), dark pixel ratio: {3:P1}" -f $outputPath, $width, $height, $darkRatio)

  if ($darkRatio -gt 0.75) {
    throw "The startup window is predominantly black."
  }
}
finally {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
}
