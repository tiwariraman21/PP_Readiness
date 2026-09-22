<#
.SYNOPSIS
  Serves the standalone build over http.

.DESCRIPTION
  The page reads PP_Readiness_Database.xlsx with fetch, and a browser will not
  let a file:// page read a local file, so the standalone build has to be served
  rather than opened. This is a small static server for machines with no Node
  and no Python - it needs nothing but PowerShell.

  Listening on http://localhost:<port>/ does not require an elevated prompt;
  binding a wildcard host would, which is why the prefix is localhost only.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\serve.ps1
  powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8080
#>
param(
  [string]$Root = (Join-Path $PSScriptRoot "..\standalone"),
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"

$Root = [System.IO.Path]::GetFullPath($Root)
if (-not (Test-Path -LiteralPath $Root)) {
  throw "nothing to serve at $Root - run tools\build-standalone.ps1 first"
}
if (-not (Test-Path -LiteralPath (Join-Path $Root "index.html"))) {
  throw "no index.html in $Root - run tools\build-standalone.ps1 first"
}
if (-not (Test-Path -LiteralPath (Join-Path $Root "PP_Readiness_Database.xlsx"))) {
  Write-Warning "PP_Readiness_Database.xlsx is missing from $Root - the page will not start. Build it with tools\build-workbook.ps1."
}

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".xlsx" = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".ico"  = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
  $listener.Start()
} catch {
  throw "could not listen on port $Port - something else may already be using it. Try -Port 8080."
}

"serving $Root"
"  http://localhost:$Port/"
"press Ctrl+C to stop"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }

    $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))

    # Keep requests inside the served folder.
    if ($full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ctype = $types[$ext]
      if (-not $ctype) { $ctype = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ctx.Response.ContentType = $ctype
      # The workbook is meant to be edited while the server is up.
      $ctx.Response.Headers.Add("Cache-Control", "no-store")
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 not found: $rel")
      $ctx.Response.ContentType = "text/plain; charset=utf-8"
      $ctx.Response.ContentLength64 = $msg.Length
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.OutputStream.Close()
  }
}
finally {
  $listener.Stop()
  $listener.Close()
}
