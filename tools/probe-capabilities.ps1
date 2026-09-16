<#
  probe-capabilities.ps1 — 实测本机对各素材格式的解析能力

  不猜、不假设：对 .sources 里的真实文件跑一遍解析，打印可解析性结论。
  用途：回答「PDF / DOCX / DOC / MP3 到底能不能解析」，以及给 L2/L3 抽取管线定路线。

  用法：
    pwsh -File tools/probe-capabilities.ps1
    pwsh -File tools/probe-capabilities.ps1 -Root <素材目录>
#>
param(
  [string]$Root = (Join-Path $PSScriptRoot '..\.sources\CET6-Resources')
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- 工具定位 ----------
$Poppler = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\poppler-25.07.0\Library\bin'
$Pdftotext = Join-Path $Poppler 'pdftotext.exe'
$Pdftoppm  = Join-Path $Poppler 'pdftoppm.exe'
$Pdfinfo   = Join-Path $Poppler 'pdfinfo.exe'

function Find-First([string[]]$Paths) {
  foreach ($p in $Paths) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}
$Unzip = Find-First @(
  "$env:LOCALAPPDATA\hermes\git\usr\bin\unzip.exe",
  "$env:ProgramFiles\Git\usr\bin\unzip.exe",
  'C:\Program Files\Git\usr\bin\unzip.exe'
)
$Word = Find-First @(
  "$env:ProgramFiles\Microsoft Office\root\Office16\WINWORD.EXE",
  "${env:ProgramFiles(x86)}\Microsoft Office\root\Office16\WINWORD.EXE"
)
$Ffprobe = (Get-Command ffprobe -ErrorAction SilentlyContinue)?.Source

$script:rows = @()
function Record($fmt, $verdict, $detail) {
  $script:rows += [pscustomobject]@{ 格式 = $fmt; 结论 = $verdict; 证据 = $detail }
  "{0,-10} {1,-6} {2}" -f $fmt, $verdict, $detail
}

function Get-FirstFile([string]$Pattern) {
  if (-not (Test-Path $Root)) { return $null }
  Get-ChildItem $Root -Recurse -File -Filter $Pattern -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -gt 1000 } | Sort-Object Length -Descending | Select-Object -First 1
}

# 按 pdf-textability.json 的判定挑样本，避免「挑到最大体积的恰好是扫描件」这种假阴性
function Get-PdfByVerdict([string]$Verdict) {
  $rep = Join-Path (Split-Path $PSScriptRoot -Parent) 'docs\pdf-textability.json'
  if (Test-Path $rep) {
    $j = Get-Content $rep -Raw -Encoding UTF8 | ConvertFrom-Json
    $hit = $j.files | Where-Object { $_.verdict -eq $Verdict -and $_.kind -eq 'paper' } | Select-Object -First 1
    if ($hit) {
      $abs = Join-Path $Root ($hit.rel -replace '/', '\')
      if (Test-Path $abs) { return Get-Item $abs }
    }
  }
  return Get-FirstFile '*.pdf'
}

if (-not (Test-Path $Root)) { Write-Host "✗ 素材目录不存在：$Root" -ForegroundColor Red; exit 1 }
Write-Host "素材目录：$Root`n"

# ============================================================
Write-Host "═══ 1. PDF（文本版）═══" -ForegroundColor Cyan
$pdf = Get-PdfByVerdict 'text'
if ($pdf) {
  $tmp = [System.IO.Path]::GetTempFileName()
  & $Pdftotext -q -layout "$($pdf.FullName)" $tmp 2>$null
  $txt = if (Test-Path $tmp) { Get-Content $tmp -Raw -Encoding UTF8 } else { '' }
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  $chars = if ($txt) { $txt.Length } else { 0 }
  $pages = (& $Pdfinfo "$($pdf.FullName)" 2>$null | Select-String '^Pages:') -replace 'Pages:\s*',''
  Record 'PDF文本' $(if ($chars -gt 1000) { '✅' } else { '❌' }) "$($pdf.Name) → $chars 字 / $pages 页"
} else { Record 'PDF文本' '❌' '无样本' }

# ============================================================
Write-Host "`n═══ 2. PDF（扫描版 → 渲染成图）═══" -ForegroundColor Cyan
$scan = Get-PdfByVerdict 'scanned'
if ($scan) {
  $out = Join-Path $env:TEMP ("probe_" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  & $Pdftoppm -png -r 200 -f 1 -l 1 "$($scan.FullName)" (Join-Path $out 'p') 2>$null
  $png = Get-ChildItem $out -Filter '*.png' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($png) {
    Record 'PDF扫描' '✅' "$($png.Name) → $([math]::Round($png.Length/1KB,0))KB PNG @200DPI（可交给多模态）"
  } else {
    Record 'PDF扫描' '❌' 'pdftoppm 未产出图片'
  }
  Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
} else { Record 'PDF扫描' '❌' '无样本' }

# ============================================================
Write-Host "`n═══ 3. DOCX（zip + document.xml）═══" -ForegroundColor Cyan
$docx = Get-FirstFile '*.docx'
if ($docx -and $Unzip) {
  $xml = & $Unzip -p "$($docx.FullName)" 'word/document.xml' 2>$null | Out-String
  $plain = ($xml -replace '</w:p>', "`n" -replace '<[^>]+>', '') -replace '&amp;','&' -replace '&lt;','<' -replace '&gt;','>'
  $chars = $plain.Trim().Length
  Record 'DOCX' $(if ($chars -gt 500) { '✅' } else { '❌' }) "$($docx.Name) → $chars 字（纯 unzip 零依赖）"
} elseif (-not $Unzip) { Record 'DOCX' '❌' 'unzip 未找到' } else { Record 'DOCX' '❌' '无样本' }

# ============================================================
Write-Host "`n═══ 4. DOC / RTF（老二进制，需 Word COM）═══" -ForegroundColor Cyan
$doc = Get-ChildItem $Root -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in '.doc', '.rtf' -and $_.Length -gt 10000 } |
  Sort-Object Length -Descending | Select-Object -First 1
if ($doc) {
  if ($Word) {
    $tmpTxt = [System.IO.Path]::GetTempFileName() + '.txt'
    try {
      $wd = New-Object -ComObject Word.Application
      $wd.Visible = $false
      $wd.DisplayAlerts = 0
      $d = $wd.Documents.Open($doc.FullName, $false, $true, $false)
      $d.SaveAs2($tmpTxt, 2)   # wdFormatText
      $d.Close(0)
      $wd.Quit()
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wd) | Out-Null
      $chars = if (Test-Path $tmpTxt) { (Get-Content $tmpTxt -Raw -Encoding Default).Length } else { 0 }
      Record 'DOC/RTF' $(if ($chars -gt 500) { '✅' } else { '⚠' }) "$($doc.Name) → $chars 字（Word COM 转换）"
    } catch {
      Record 'DOC/RTF' '❌' "$($doc.Name) → Word COM 失败：$($_.Exception.Message)"
    } finally { Remove-Item $tmpTxt -Force -ErrorAction SilentlyContinue }
  } else {
    Record 'DOC/RTF' '❌' '无 Word/LibreOffice，.doc 无法文本化'
  }
} else { Record 'DOC/RTF' '❌' '无样本' }

# ============================================================
Write-Host "`n═══ 5. MP3（ffprobe 元数据）═══" -ForegroundColor Cyan
$mp3 = Get-ChildItem $Root -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -match '^\.mp3$' } | Sort-Object Length -Descending | Select-Object -First 2
if ($mp3 -and $Ffprobe) {
  foreach ($m in $mp3) {
    $j = & $Ffprobe -v quiet -print_format json -show_format "$($m.FullName)" 2>$null | Out-String
    $o = $j | ConvertFrom-Json
    $dur = [double]$o.format.duration
    Record 'MP3' '✅' "$($m.Name) → $([math]::Round($dur/60,1)) 分钟 / $([math]::Round($m.Length/1MB,1))MB"
  }
} elseif (-not $Ffprobe) { Record 'MP3' '❌' 'ffprobe 未找到' } else { Record 'MP3' '❌' '无样本' }

# ============================================================
Write-Host "`n═══ 6. MP3 → 文字（听力原文/字幕，可选能力）═══" -ForegroundColor Cyan
$whisper = Get-Command whisper -ErrorAction SilentlyContinue
$pyW = python -c "import importlib.util as u;print('yes' if u.find_spec('faster_whisper') or u.find_spec('whisper') else 'no')" 2>$null
if ($whisper -or $pyW -eq 'yes') {
  Record 'MP3转写' '✅' 'whisper 可用'
} else {
  Record 'MP3转写' '⚠' '本机无 whisper/tesseract —— 需要时改用多模态模型直接听，或 pip 装 faster-whisper'
}

# ============================================================
Write-Host "`n═══ 7. 扫描 PDF → 文字（本地 OCR）═══" -ForegroundColor Cyan
$tess = Get-Command tesseract -ErrorAction SilentlyContinue
if ($tess) { Record '本地OCR' '✅' "tesseract $($tess.Source)" }
else { Record '本地OCR' '⚠' '未装 tesseract —— 扫描件改走多模态模型（本方案既定路线）' }

# ============================================================
Write-Host "`n" 
Write-Host "═══ 结论 ═══" -ForegroundColor Green
$script:rows | Format-Table -AutoSize -Wrap

Write-Host "工具链：" -ForegroundColor Green
"  poppler 25.07.0  : pdftotext / pdftoppm / pdfinfo / pdfimages / pdftocairo / pdffonts"
"  Microsoft Word   : $($Word ?? '未找到')"
"  unzip            : $($Unzip ?? '未找到')"
"  ffprobe/ffmpeg   : $($Ffprobe ?? '未找到')"
