<#
.SYNOPSIS
  Builds one self-contained HTML file that runs with no server and no network.

.DESCRIPTION
  The ordinary standalone build needs both: it pulls React and Babel from a CDN
  and fetches the workbook over http. This build removes both dependencies.

    - The JSX is compiled to plain JavaScript once, here, using Babel running in
      a headless browser. The output file carries no compiler.
    - React and ReactDOM are downloaded once and cached under tools\vendor, then
      inlined.
    - The data is embedded as JSON in the shape the app already uses, so there is
      no workbook to fetch and no spreadsheet reader to load.
    - The webfont import is stripped, so nothing reaches for the network at all.

  Building it needs a network connection and the local server running (Babel and
  the React bundles are fetched at build time). Opening the result does not:
  double-click it, or mail it to someone, and it works offline.

  The data in the file is a snapshot. Editing the workbook afterwards does not
  change it - rebuild to pick up new figures.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\build-offline.ps1
  powershell -ExecutionPolicy Bypass -File tools\build-offline.ps1 -Port 5174
#>
param(
  [string]$Src = (Join-Path $PSScriptRoot "..\src\components\ComponentReadinessCheck.jsx"),
  [string]$Data = (Join-Path $PSScriptRoot "..\data\dataset.json"),
  [string]$Out = (Join-Path $PSScriptRoot "..\standalone\PPC-Dashboard-offline.html"),
  [int]$Port = 5174
)

$ErrorActionPreference = "Stop"

function Find-Edge {
  foreach ($p in @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )) { if (Test-Path -LiteralPath $p) { return $p } }
  throw "Microsoft Edge not found - it is used to run Babel once at build time"
}

if (-not (Test-Path -LiteralPath $Src)) { throw "component not found: $Src" }
if (-not (Test-Path -LiteralPath $Data)) { throw "data not found: $Data - run tools\make-dataset.ps1 first" }

$edge = Find-Edge
$root = Split-Path -Parent (Split-Path -Parent $Src)   # ..\src
$proj = Split-Path -Parent $root
$serveDir = Join-Path $proj "standalone"
if (-not (Test-Path -LiteralPath $serveDir)) { New-Item -ItemType Directory -Force -Path $serveDir | Out-Null }

# ---------- 1. the component, rewritten the same way the standalone build does ----------
$jsx = [System.IO.File]::ReadAllText((Resolve-Path $Src).Path, [System.Text.Encoding]::UTF8)
$jsx = [regex]::Replace($jsx,
  '(?m)^\s*import\s+React\s*,\s*\{([^}]*)\}\s*from\s*["'']react["''];?\s*$', 'const {$1} = React;')
$jsx = [regex]::Replace($jsx, '(?m)^\s*import\s+React\s+from\s*["'']react["''];?\s*$', '')
$jsx = [regex]::Replace($jsx, '(?m)^\s*export\s+default\s+function\s', 'function ')

if ($jsx -cmatch '(?m)^\s*(import|export)[ \t]+\S') {
  throw "module syntax still present after rewrite"
}
if ($jsx -match '</script') {
  throw "source contains a literal </script>, which would break the inline blocks"
}

# nothing should reach for a webfont in a file meant to work offline
$jsx = [regex]::Replace($jsx, "(?m)^@import url\('https://fonts\.googleapis\.com[^\r\n]*$", "")

"component: {0:N0} chars" -f $jsx.Length

# ---------- 2. compile the JSX with Babel, in a browser, once ----------
$compilerPage = Join-Path $serveDir "__compile.html"
$head = @'
<!doctype html><html><head><meta charset="utf-8"><title>compiling</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/8.0.4/babel.min.js"></script>
</head><body>
<script type="text/plain" id="src">
'@
$mid = @'
</script>
<script type="text/plain" id="out"></script>
<script>
  try {
    Babel.registerPreset("react-classic", {
      presets: [[Babel.availablePresets["react"], { runtime: "classic" }]],
    });
    var code = Babel.transform(document.getElementById("src").textContent,
      { presets: ["react-classic"], compact: false, comments: false }).code;
    document.getElementById("out").textContent = code;
    document.title = "OK " + code.length;
  } catch (e) {
    document.title = "ERR " + (e && e.message);
  }
</script>
</body></html>
'@
[System.IO.File]::WriteAllText($compilerPage, $head + $jsx + $mid, (New-Object System.Text.UTF8Encoding $false))

$profile = Join-Path $env:TEMP "ppc-offline-build"
$dump = Join-Path $env:TEMP "ppc-compiled.html"
& $edge --headless=new --disable-gpu --no-first-run --user-data-dir="$profile" `
  --virtual-time-budget=45000 --dump-dom "http://localhost:$Port/__compile.html" |
  Out-File -FilePath $dump -Encoding utf8

Remove-Item -LiteralPath $compilerPage -Force -ErrorAction SilentlyContinue

$dom = [System.IO.File]::ReadAllText($dump, [System.Text.Encoding]::UTF8)
$titleMatch = [regex]::Match($dom, '<title>([^<]*)</title>')
$title = if ($titleMatch.Success) { $titleMatch.Groups[1].Value } else { "(no title)" }
if ($title -notlike "OK *") {
  throw "Babel did not compile the component: $title`nIs the local server running on port $Port? Start it with tools\serve.ps1 -Port $Port"
}
"babel:     $title"

$startTag = [regex]::Match($dom, '<script[^>]*id="out"[^>]*>')
if (-not $startTag.Success) { throw "compiled output block not found in the dumped page" }
$from = $startTag.Index + $startTag.Length
$to = $dom.IndexOf('</script>', $from)
if ($to -lt 0) { throw "compiled output block was not closed" }
$compiled = $dom.Substring($from, $to - $from)
Remove-Item -LiteralPath $dump -Force -ErrorAction SilentlyContinue

# The dumped DOM is HTML; a raw-text script keeps its content verbatim, but the
# ampersand forms are decoded here anyway so nothing survives double-escaped.
$compiled = $compiled.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')
"compiled:  {0:N0} chars" -f $compiled.Length
if ($compiled.Length -lt 100000) { throw "compiled output looks too small - something went wrong" }

# ---------- 3. React, cached locally so a rebuild does not need the CDN ----------
$vendor = Join-Path $PSScriptRoot "vendor"
if (-not (Test-Path -LiteralPath $vendor)) { New-Item -ItemType Directory -Force -Path $vendor | Out-Null }
$libs = @(
  @{ file = "react.production.min.js";     url = "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js" },
  @{ file = "react-dom.production.min.js"; url = "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js" }
)
$libText = @{}
foreach ($l in $libs) {
  $path = Join-Path $vendor $l.file
  if (-not (Test-Path -LiteralPath $path)) {
    Invoke-WebRequest -Uri $l.url -OutFile $path -UseBasicParsing -TimeoutSec 60
    "fetched:   $($l.file)"
  } else {
    "cached:    $($l.file)"
  }
  $libText[$l.file] = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

# ---------- 4. the data, inlined ----------
$json = [System.IO.File]::ReadAllText((Resolve-Path $Data).Path, [System.Text.Encoding]::UTF8)
# "<" only ever appears inside strings in this JSON, so escaping it keeps the
# document valid and makes a stray </script> impossible
$json = $json.Replace('<', '\u003c')
"data:      {0:N0} chars" -f $json.Length

# ---------- 5. assemble ----------
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append(@'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PPC Dashboard</title>
<style>
  html, body { margin: 0; padding: 0; background: #EDF1F4; }
  #boot { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 32px; color: #52646F; }
  #boot b { color: #b00; }
  #boot pre { white-space: pre-wrap; font-size: 12px; color: #b00; }
</style>
</head>
<body>
<div id="root"><div id="boot">Starting, one moment...</div></div>
<script>
  window.addEventListener("error", function (e) {
    var b = document.getElementById("boot");
    if (b) {
      b.innerHTML = "<b>Failed to start.</b><pre></pre>";
      b.querySelector("pre").textContent = ((e.error && e.error.stack) || e.message || e.error) + "";
    }
  });
</script>
<script>
'@)
[void]$sb.AppendLine($libText["react.production.min.js"])
[void]$sb.AppendLine('</script>')
[void]$sb.AppendLine('<script>')
[void]$sb.AppendLine($libText["react-dom.production.min.js"])
[void]$sb.AppendLine('</script>')
[void]$sb.AppendLine('<script>')
[void]$sb.Append('window.__PPC_DATA__ = ')
[void]$sb.Append($json)
[void]$sb.AppendLine(';')
[void]$sb.AppendLine('</script>')
[void]$sb.AppendLine('<script>')
[void]$sb.AppendLine($compiled)
[void]$sb.AppendLine(@'
var el = document.getElementById("root");
el.innerHTML = "";
ReactDOM.createRoot(el).render(React.createElement(ComponentReadinessCheck));
'@)
[void]$sb.AppendLine('</script>')
[void]$sb.AppendLine('</body></html>')

$outDir = Split-Path -Parent $Out
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
[System.IO.File]::WriteAllText($Out, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))

$full = (Resolve-Path -LiteralPath $Out).Path
""
"wrote {0}" -f $full
"      {0:N0} bytes ({1:N1} MB)" -f (Get-Item $full).Length, ((Get-Item $full).Length / 1MB)
"      no server, no network - double-click to open"
