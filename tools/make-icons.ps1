# 生成 iOS 主屏图标（apple-touch-icon 必须是不透明的方形 PNG）。
# 用 System.Drawing 直接画：字体与配色与页头 logo 一致（品牌粉底 + 白色 EQ）。
Add-Type -AssemblyName System.Drawing

function New-Icon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  # iOS 自己会加圆角，这里铺满（不透明，符合 apple-touch-icon 要求）
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#c9305f'))

  $fontSize = [float]($size * 0.46)
  $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.DrawString('EQ', $font, $brush, $rect, $fmt)

  $g.Dispose(); $font.Dispose(); $brush.Dispose(); $fmt.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "  $path  $size x $size"
}

New-Icon 180 'src\app\apple-icon.png'
New-Icon 512 'public\icon-512.png'
