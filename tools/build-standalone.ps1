<#
.SYNOPSIS
  Compiles the readiness component into one self-contained HTML file.

.DESCRIPTION
  A fallback for machines with no Node toolchain. React and Babel are pulled
  from CDN and the JSX is transpiled in the browser at load time. Slower to
  start than the Vite build and it needs network access on first load - prefer
  `npm run dev` when Node is available.

  The output is not a double-click file. The page reads its data from
  PP_Readiness_Database.xlsx at runtime and browsers refuse to fetch a local
  file from a file:// page, so the folder has to be served over http. The
  workbook is copied next to the HTML here; serve them with tools\serve.ps1.
#>
param(
  [string]$Src = (Join-Path $PSScriptRoot "..\src\components\ComponentReadinessCheck.jsx"),
  [string]$Out = (Join-Path $PSScriptRoot "..\standalone\index.html")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Src)) { throw "component not found: $Src" }
$jsx = Get-Content -Raw -LiteralPath $Src -Encoding UTF8

# React is a global from the UMD build here, not a module import.
$jsx = [regex]::Replace(
  $jsx,
  '(?m)^\s*import\s+React\s*,\s*\{([^}]*)\}\s*from\s*["'']react["''];?\s*$',
  'const {$1} = React;'
)
$jsx = [regex]::Replace($jsx, '(?m)^\s*import\s+React\s+from\s*["'']react["''];?\s*$', '')

# No module system in the page, so the default export keyword has to go.
$jsx = [regex]::Replace($jsx, '(?m)^\s*export\s+default\s+function\s', 'function ')

# -match is case-insensitive and \s matches a newline, so a comment line that says
# only "EXPORT" used to trip this. Require a space or tab and a following token, which
# real module syntax always has.
if ($jsx -cmatch '(?m)^\s*(import|export)[ \t]+\S') {
  throw "module syntax still present after rewrite - the standalone build only supports a single self-contained component"
}
if ($jsx -match '</script') {
  throw "source contains a literal </script>, which would terminate the inline script block early"
}

$head = @'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PPC Dashboard</title>
<style>
  html, body { margin: 0; padding: 0; background: #EDF1F4; }
  #boot {
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 32px; color: #52646F;
  }
  #boot b { color: #b00; }
  #boot pre { white-space: pre-wrap; font-size: 12px; color: #b00; }
</style>
<script crossorigin="anonymous" src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script crossorigin="anonymous" src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script crossorigin="anonymous" src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/8.0.4/babel.min.js"></script>
</head>
<body>
<div id="root"><div id="boot">Compiling the component in the browser, one moment...</div></div>
<script>
  // A blank page is the worst failure mode, so surface anything that throws.
  window.addEventListener("error", function (e) {
    var b = document.getElementById("boot");
    if (b) {
      b.innerHTML = "<b>Failed to start.</b><pre></pre>";
      b.querySelector("pre").textContent = ((e.error && e.error.stack) || e.message || e.error) + "";
    }
  });

  // Babel 8's react preset defaults to the automatic runtime, which emits an
  // `import` the browser cannot evaluate outside a module. Classic gives
  // React.createElement instead.
  Babel.registerPreset("react-classic", {
    presets: [[Babel.availablePresets["react"], { runtime: "classic" }]],
  });
</script>
<script type="text/babel" data-presets="react-classic">
'@

$tail = @'

const el = document.getElementById("root");
el.innerHTML = "";
ReactDOM.createRoot(el).render(React.createElement(ComponentReadinessCheck));
</script>
</body>
</html>
'@

$outDir = Split-Path -Parent $Out
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

$html = $head + "`n" + $jsx + $tail
[System.IO.File]::WriteAllText($Out, $html, (New-Object System.Text.UTF8Encoding $false))

$full = (Resolve-Path -LiteralPath $Out).Path
"wrote {0} ({1:N0} bytes)" -f $full, (Get-Item -LiteralPath $full).Length

# The page fetches the workbook at runtime, so it has to travel with the HTML.
$book = Join-Path $PSScriptRoot "..\public\PP_Readiness_Database.xlsx"
if (Test-Path -LiteralPath $book) {
  Copy-Item -LiteralPath $book -Destination (Join-Path $outDir "PP_Readiness_Database.xlsx") -Force
  "copied PP_Readiness_Database.xlsx alongside it"
} else {
  Write-Warning "public\PP_Readiness_Database.xlsx is missing - build it with tools\build-workbook.ps1, or the page will not start"
}

"serve it with: powershell -ExecutionPolicy Bypass -File tools\serve.ps1"
