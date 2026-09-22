<#
.SYNOPSIS
  Builds the Excel database the dashboard reads at runtime.

.DESCRIPTION
  Turns data/dataset.json into a multi-sheet .xlsx via Excel automation. Nested
  structures are flattened into ordinary tables so the workbook can be edited by
  hand: bills of material become parent/alternative/component rows, production
  versions one row each, and the child collections on subcontracting and purchase
  orders get their own sheets keyed back to the parent document.

  The workbook describes itself. A _Schema sheet records, for every sheet, which
  dataset it carries, how the loader should reassemble it, and the key and type
  behind each column heading. The browser loader reads _Schema first and decodes
  everything else from it, so the column layout only has to be right here.

  Output goes to public/ (served at the site root by Vite) and is copied into
  standalone/ next to the single file build.

  data/dataset.json is a seed, not a mirror. It holds the figures the workbook
  was first built from and is never written back to, so running this after
  editing the workbook in Excel discards those edits and returns the data to
  its starting state. That is the only way to get back to a clean copy, and the
  reason to be deliberate about running it.
#>
param(
  [string]$In  = (Join-Path $PSScriptRoot "..\data\dataset.json"),
  [string]$Out = (Join-Path $PSScriptRoot "..\public\PP_Readiness_Database.xlsx"),
  [string]$CopyTo = (Join-Path $PSScriptRoot "..\standalone\PP_Readiness_Database.xlsx")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $In)) { throw "seed not found: $In" }
$data = Get-Content -Raw -LiteralPath $In -Encoding UTF8 | ConvertFrom-Json

# Column: heading, the property name the component expects, and a type so the
# loader can coerce. s = string, n = number, b = boolean.
function Col([string]$Header, [string]$Key, [string]$Type) {
  [pscustomobject]@{ Header = $Header; Key = $Key; Type = $Type }
}

function Props($o) { $o.PSObject.Properties }

# --- flatteners ----------------------------------------------------------

function Expand-Dict($obj, [string]$KeyName) {
  foreach ($p in Props $obj) {
    $row = [ordered]@{ $KeyName = $p.Name }
    foreach ($q in Props $p.Value) { $row[$q.Name] = $q.Value }
    [pscustomobject]$row
  }
}

function Expand-Bom($boms) {
  foreach ($mat in Props $boms) {
    foreach ($alt in Props $mat.Value) {
      foreach ($c in $alt.Value) {
        [pscustomobject]@{ material = $mat.Name; alt = $alt.Name; code = $c.code; qty = $c.qty; scrap = $c.scrap }
      }
    }
  }
}

function Expand-ProdVersions($pv) {
  foreach ($mat in Props $pv) {
    foreach ($v in $mat.Value) {
      $row = [ordered]@{ material = $mat.Name }
      foreach ($q in Props $v) { $row[$q.Name] = $q.Value }
      [pscustomobject]$row
    }
  }
}

function Expand-Transit($t) {
  foreach ($p in Props $t) {
    $bits = $p.Name -split "-"
    [pscustomobject]@{ from = $bits[0]; to = $bits[1]; days = $p.Value }
  }
}

function Expand-Consumption($rows) {
  foreach ($r in $rows) {
    $row = [ordered]@{ m = $r.m; p = $r.p }
    for ($i = 0; $i -lt 12; $i++) { $row["t$($i + 1)"] = $r.total[$i] }
    for ($i = 0; $i -lt 12; $i++) { $row["u$($i + 1)"] = $r.unplanned[$i] }
    [pscustomobject]$row
  }
}

function Expand-Children($parents, [string]$Field) {
  foreach ($p in $parents) {
    foreach ($c in $p.$Field) {
      $row = [ordered]@{ doc = $p.doc; item = $p.item }
      foreach ($q in Props $c) { $row[$q.Name] = $q.Value }
      [pscustomobject]$row
    }
  }
}

function Without($rows, [string[]]$Drop) {
  foreach ($r in $rows) {
    $row = [ordered]@{}
    foreach ($q in Props $r) { if ($Drop -notcontains $q.Name) { $row[$q.Name] = $q.Value } }
    [pscustomobject]$row
  }
}

function With-JoinedStatus($rows) {
  foreach ($r in $rows) {
    $row = [ordered]@{}
    foreach ($q in Props $r) {
      if ($q.Name -eq "status") { $row["status"] = ($q.Value -join " ") } else { $row[$q.Name] = $q.Value }
    }
    [pscustomobject]$row
  }
}

$consCols = @(Col "Material" "m" "s"; Col "Plant" "p" "s")
for ($i = 1; $i -le 12; $i++) { $consCols += Col ("Total{0:00}" -f $i) "t$i" "n" }
for ($i = 1; $i -le 12; $i++) { $consCols += Col ("Unplanned{0:00}" -f $i) "u$i" "n" }

# --- sheet specification -------------------------------------------------
# Shape tells the loader how to put the table back together.

$spec = @(
  @{ Sheet = "Plants"; Dataset = "PLANTS"; Shape = "rows"; Rows = $data.PLANTS; Columns = @(
      Col "Plant" "id" "s"; Col "Name" "name" "s"; Col "Region" "region" "s") }

  @{ Sheet = "Transit"; Dataset = "TRANSIT"; Shape = "transit"; Rows = (Expand-Transit $data.TRANSIT); Columns = @(
      Col "FromPlant" "from" "s"; Col "ToPlant" "to" "s"; Col "TransitDays" "days" "n") }

  @{ Sheet = "StorageLocations"; Dataset = "SLOCS"; Shape = "rows"; Rows = $data.SLOCS; Columns = @(
      Col "Code" "code" "s"; Col "Name" "name" "s"; Col "Type" "type" "s"
      Col "CountedByDefault" "defaultIn" "b"; Col "EffortToRelease" "effort" "n"; Col "Note" "note" "s") }

  @{ Sheet = "Materials"; Dataset = "MATERIALS"; Shape = "dict"; Rows = (Expand-Dict $data.MATERIALS "code"); Columns = @(
      Col "Material" "code" "s"; Col "Description" "desc" "s"; Col "UoM" "uom" "s"
      Col "LeadTimeDays" "lead" "n"; Col "Procurement" "proc" "s"; Col "MRPController" "mrp" "s") }

  @{ Sheet = "BOM"; Dataset = "BOMS"; Shape = "bom"; Rows = (Expand-Bom $data.BOMS); Columns = @(
      Col "Material" "material" "s"; Col "Alternative" "alt" "s"; Col "Component" "code" "s"
      Col "QuantityPer" "qty" "n"; Col "ScrapPct" "scrap" "n") }

  @{ Sheet = "ProductionVersions"; Dataset = "PROD_VERSIONS"; Shape = "prodver"; Rows = (Expand-ProdVersions $data.PROD_VERSIONS); Columns = @(
      Col "Material" "material" "s"; Col "Version" "version" "s"; Col "Description" "text" "s"
      Col "WorkCentre" "wc" "s"; Col "HoursPerUnit" "hoursPer" "n"; Col "BOMAlternative" "bom" "s"
      Col "BOMUsage" "bomUsage" "s"; Col "Routing" "routing" "s"; Col "Counter" "counter" "s"
      Col "Line" "line" "s"; Col "LotSizeFrom" "lotFrom" "n"; Col "LotSizeTo" "lotTo" "n"
      Col "ValidFromOffset" "validFrom" "n"; Col "ValidToOffset" "validTo" "n"; Col "Locked" "locked" "b") }

  @{ Sheet = "FinishedGoods"; Dataset = "FINISHED_GOODS"; Shape = "rows"; Rows = $data.FINISHED_GOODS; Columns = @(
      Col "Material" "code" "s"; Col "Plant" "plant" "s"; Col "DefaultQty" "defaultQty" "n") }

  @{ Sheet = "Stock"; Dataset = "STOCK"; Shape = "rows"; Rows = $data.STOCK; Columns = @(
      Col "Material" "m" "s"; Col "Plant" "p" "s"; Col "StorageLocation" "s" "s"; Col "Quantity" "q" "n") }

  @{ Sheet = "MRPData"; Dataset = "MRP_DATA"; Shape = "rows"; Rows = $data.MRP_DATA; Columns = @(
      Col "Material" "m" "s"; Col "Plant" "p" "s"; Col "MarginKey" "marginKey" "s"
      Col "SafetyStock" "safety" "n"; Col "ReorderPoint" "reorder" "n"
      Col "MRPType" "mrpType" "s"; Col "LotSizeKey" "lotSize" "s") }

  @{ Sheet = "WorkCentres"; Dataset = "WORK_CENTRES"; Shape = "rows"; Rows = $data.WORK_CENTRES; Columns = @(
      Col "WorkCentre" "id" "s"; Col "Description" "desc" "s"; Col "Plant" "plant" "s"
      Col "Shifts" "shifts" "n"; Col "GrossHoursPerWeek" "grossPerWeek" "n"; Col "Utilisation" "util" "n") }

  @{ Sheet = "OrderStatus"; Dataset = "ORDER_STATUS"; Shape = "dict"; Rows = (Expand-Dict $data.ORDER_STATUS "code"); Columns = @(
      Col "Status" "code" "s"; Col "Meaning" "name" "s"; Col "Tone" "tone" "s") }

  @{ Sheet = "ProductionOrders"; Dataset = "PROD_ORDERS"; Shape = "prodorders"; Rows = (With-JoinedStatus $data.PROD_ORDERS); Columns = @(
      Col "Order" "order" "s"; Col "WorkCentre" "wc" "s"; Col "HoursPerUnit" "hoursPer" "n"
      Col "Plant" "plant" "s"; Col "Material" "material" "s"; Col "OrderType" "type" "s"
      Col "MRPController" "mrp" "s"; Col "Quantity" "qty" "n"; Col "Delivered" "delivered" "n"
      Col "Confirmed" "confirmed" "n"; Col "CreatedOffset" "createdOffset" "n"
      Col "StartOffset" "startOffset" "n"; Col "FinishOffset" "finishOffset" "n"
      Col "Mode" "mode" "s"; Col "CreatedBy" "createdBy" "s"; Col "StatusCodes" "status" "s") }

  @{ Sheet = "PlannedOrders"; Dataset = "PLANNED_ORDERS"; Shape = "rows"; Rows = $data.PLANNED_ORDERS; Columns = @(
      Col "PlannedOrder" "order" "s"; Col "Material" "m" "s"; Col "Plant" "p" "s"
      Col "Quantity" "qty" "n"; Col "StartOffset" "startOffset" "n"; Col "FinishOffset" "finishOffset" "n"
      Col "Firmed" "firmed" "b"; Col "WorkCentre" "wc" "s"; Col "HoursPerUnit" "hoursPer" "n"
      Col "OpeningOffset" "opening" "n") }

  @{ Sheet = "SalesOrders"; Dataset = "SALES_ORDERS"; Shape = "rows"; Rows = $data.SALES_ORDERS; Columns = @(
      Col "SalesOrder" "doc" "s"; Col "Item" "item" "s"; Col "Route" "route" "s"
      Col "ShipPoint" "shipPoint" "s"; Col "TransitDays" "transit" "n"; Col "Customer" "customer" "s"
      Col "SoldTo" "soldTo" "s"; Col "Material" "m" "s"; Col "Plant" "p" "s"
      Col "Quantity" "qty" "n"; Col "Confirmed" "confirmed" "n"; Col "RequestedOffset" "reqOffset" "n") }

  @{ Sheet = "ShipPoints"; Dataset = "SHIP_POINTS"; Shape = "rows"; Rows = $data.SHIP_POINTS; Columns = @(
      Col "ShipPoint" "id" "s"; Col "Description" "desc" "s"; Col "Plant" "plant" "s"
      Col "PickPackDays" "pickPack" "n"; Col "LoadingDays" "loading" "n") }

  @{ Sheet = "SchedulingMargin"; Dataset = "SCHED_MARGIN"; Shape = "rows"; Rows = $data.SCHED_MARGIN; Columns = @(
      Col "MarginKey" "key" "s"; Col "Description" "desc" "s"; Col "FloatBeforeDays" "floatBefore" "n"
      Col "FloatAfterDays" "floatAfter" "n"; Col "OpeningPeriodDays" "opening" "n") }

  @{ Sheet = "PIR"; Dataset = "PIR"; Shape = "rows"; Rows = $data.PIR; Columns = @(
      Col "Material" "m" "s"; Col "Plant" "p" "s"; Col "Version" "version" "s"
      Col "Offset" "offset" "n"; Col "Quantity" "qty" "n"; Col "Withdrawn" "withdrawn" "n") }

  @{ Sheet = "Batches"; Dataset = "BATCHES"; Shape = "rows"; Rows = $data.BATCHES; Columns = @(
      Col "Material" "m" "s"; Col "Plant" "p" "s"; Col "StorageLocation" "sloc" "s"
      Col "Batch" "batch" "s"; Col "Quantity" "qty" "n"; Col "Status" "status" "s"
      Col "MfgOffset" "mfgOffset" "n"; Col "ExpiryOffset" "expOffset" "n"; Col "VendorBatch" "vendorBatch" "s") }

  @{ Sheet = "BatchManaged"; Dataset = "BATCH_MANAGED"; Shape = "list"; Rows = ($data.BATCH_MANAGED | ForEach-Object { [pscustomobject]@{ value = $_ } }); Columns = @(
      Col "Material" "value" "s") }

  @{ Sheet = "Consumption"; Dataset = "CONSUMPTION"; Shape = "consumption"; Rows = (Expand-Consumption $data.CONSUMPTION); Columns = $consCols }

  @{ Sheet = "Deliveries"; Dataset = "DELIVERIES"; Shape = "rows"; Rows = $data.DELIVERIES; Columns = @(
      Col "Delivery" "doc" "s"; Col "Item" "item" "s"; Col "Material" "m" "s"; Col "Plant" "p" "s"
      Col "Quantity" "qty" "n"; Col "Offset" "offset" "n"; Col "SalesOrder" "so" "s"
      Col "Customer" "customer" "s"; Col "GoodsIssued" "gi" "b") }

  @{ Sheet = "MovementTypes"; Dataset = "MVT_TYPES"; Shape = "dict"; Rows = (Expand-Dict $data.MVT_TYPES "code"); Columns = @(
      Col "MovementType" "code" "s"; Col "Text" "text" "s"; Col "Effect" "effect" "s") }

  @{ Sheet = "GoodsMovements"; Dataset = "GOODS_MVT"; Shape = "rows"; Rows = $data.GOODS_MVT; Columns = @(
      Col "Document" "doc" "s"; Col "Item" "item" "s"; Col "Plant" "p" "s"; Col "Offset" "offset" "n"
      Col "MovementType" "mvt" "s"; Col "Reference" "ref" "s"; Col "ReferenceType" "refType" "s"
      Col "Material" "m" "s"; Col "Quantity" "qty" "n"; Col "StorageLocation" "sloc" "s"; Col "PostedBy" "user" "s") }

  @{ Sheet = "Reservations"; Dataset = "RESERVATIONS"; Shape = "rows"; Rows = $data.RESERVATIONS; Columns = @(
      Col "Reservation" "id" "s"; Col "Material" "m" "s"; Col "Plant" "p" "s"; Col "Order" "order" "s"
      Col "Type" "type" "s"; Col "RequiredQty" "reqQty" "n"; Col "Withdrawn" "withdrawn" "n"
      Col "Offset" "offset" "n"; Col "FinalIssue" "finalIssue" "b") }

  @{ Sheet = "Subcontracting"; Dataset = "SUBCON"; Shape = "rows"; Rows = (Without $data.SUBCON @("provided")); Columns = @(
      Col "Document" "doc" "s"; Col "Item" "item" "s"; Col "Plant" "plant" "s"; Col "Vendor" "vendor" "s"
      Col "VendorCode" "vendorCode" "s"; Col "Material" "material" "s"; Col "Quantity" "q" "n"
      Col "Received" "received" "n"; Col "CreatedOffset" "createdOffset" "n"; Col "DueOffset" "offset" "n"
      Col "Mode" "mode" "s"; Col "CreatedBy" "createdBy" "s"; Col "Service" "service" "s") }

  @{ Sheet = "SubconProvided"; Dataset = "SUBCON"; Shape = "child:provided"; Rows = (Expand-Children $data.SUBCON "provided"); Columns = @(
      Col "Document" "doc" "s"; Col "Item" "item" "s"; Col "Component" "code" "s"
      Col "QuantityProvided" "qty" "n"; Col "Consumed" "consumed" "n") }

  @{ Sheet = "PurchaseOrders"; Dataset = "SUPPLY"; Shape = "rows"; Rows = (Without $data.SUPPLY @("pegged")); Columns = @(
      Col "Document" "doc" "s"; Col "Item" "item" "s"; Col "DocType" "type" "s"; Col "Material" "m" "s"
      Col "Plant" "p" "s"; Col "Vendor" "vendor" "s"; Col "VendorCode" "vendorCode" "s"
      Col "Quantity" "q" "n"; Col "Received" "received" "n"; Col "CreatedOffset" "createdOffset" "n"
      Col "DueOffset" "offset" "n"; Col "Mode" "mode" "s"; Col "CreatedBy" "createdBy" "s") }

  @{ Sheet = "PurchaseOrderPegging"; Dataset = "SUPPLY"; Shape = "child:pegged"; Rows = (Expand-Children $data.SUPPLY "pegged"); Columns = @(
      Col "Document" "doc" "s"; Col "Item" "item" "s"; Col "Order" "order" "s"
      Col "PeggedQty" "qty" "n"; Col "MRPRun" "run" "s") }
)

# --- write the workbook --------------------------------------------------

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $wb = $excel.Workbooks.Add()
  while ($wb.Sheets.Count -gt 1) { $wb.Sheets.Item($wb.Sheets.Count).Delete() }

  $index = 0
  foreach ($s in $spec) {
    $index++
    if ($index -eq 1) { $ws = $wb.Sheets.Item(1) }
    else { $ws = $wb.Sheets.Add([System.Reflection.Missing]::Value, $wb.Sheets.Item($wb.Sheets.Count)) }
    $ws.Name = $s.Sheet

    $cols = @($s.Columns)
    $rows = @($s.Rows)
    $nCols = $cols.Count
    $nRows = $rows.Count

    $grid = New-Object 'object[,]' ($nRows + 1), $nCols
    for ($c = 0; $c -lt $nCols; $c++) { $grid[0, $c] = $cols[$c].Header }

    for ($r = 0; $r -lt $nRows; $r++) {
      for ($c = 0; $c -lt $nCols; $c++) {
        $v = $rows[$r].($cols[$c].Key)
        if ($null -eq $v) { $grid[($r + 1), $c] = $null }
        elseif ($cols[$c].Type -eq "b") { $grid[($r + 1), $c] = [bool]$v }
        elseif ($cols[$c].Type -eq "n") { $grid[($r + 1), $c] = [double]$v }
        else { $grid[($r + 1), $c] = [string]$v }
      }
    }

    # Text columns are formatted before the write so codes like 1000 and 0001
    # stay strings instead of being read back as numbers.
    for ($c = 0; $c -lt $nCols; $c++) {
      if ($cols[$c].Type -eq "s") { $ws.Columns.Item($c + 1).NumberFormat = "@" }
    }

    $target = $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item($nRows + 1, $nCols))
    $target.Value2 = $grid

    $head = $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item(1, $nCols))
    $head.Font.Bold = $true
    $head.Interior.Color = 15132390
    $ws.Range("A2").Select() | Out-Null
    $excel.ActiveWindow.FreezePanes = $true
    $ws.Columns.Item("A:$([char](64 + [Math]::Min($nCols, 26)))").AutoFit() | Out-Null

    "  {0,-24} {1,5} rows x {2,2} cols" -f $s.Sheet, $nRows, $nCols
  }

  # The self-describing sheet the loader reads first.
  $ws = $wb.Sheets.Add([System.Reflection.Missing]::Value, $wb.Sheets.Item($wb.Sheets.Count))
  $ws.Name = "_Schema"
  $schemaRows = New-Object System.Collections.Generic.List[object]
  foreach ($s in $spec) {
    $ord = 0
    foreach ($c in @($s.Columns)) {
      $ord++
      $schemaRows.Add([pscustomobject]@{
        Sheet = $s.Sheet; Dataset = $s.Dataset; Shape = $s.Shape
        Ordinal = $ord; Header = $c.Header; Key = $c.Key; Type = $c.Type
      })
    }
  }
  $schemaCols = @("Sheet", "Dataset", "Shape", "Ordinal", "Header", "Key", "Type")
  $grid = New-Object 'object[,]' ($schemaRows.Count + 1), $schemaCols.Count
  for ($c = 0; $c -lt $schemaCols.Count; $c++) { $grid[0, $c] = $schemaCols[$c] }
  for ($r = 0; $r -lt $schemaRows.Count; $r++) {
    for ($c = 0; $c -lt $schemaCols.Count; $c++) {
      $grid[($r + 1), $c] = $schemaRows[$r].($schemaCols[$c])
    }
  }
  $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item($schemaRows.Count + 1, $schemaCols.Count)).Value2 = $grid
  $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item(1, $schemaCols.Count)).Font.Bold = $true
  $ws.Columns.Item("A:G").AutoFit() | Out-Null
  "  {0,-24} {1,5} rows x {2,2} cols" -f "_Schema", $schemaRows.Count, $schemaCols.Count

  $wb.Sheets.Item(1).Activate()

  $outDir = Split-Path -Parent $Out
  if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
  $abs = [System.IO.Path]::GetFullPath($Out)
  if (Test-Path -LiteralPath $abs) { Remove-Item -LiteralPath $abs -Force }

  $wb.SaveAs($abs, 51)   # 51 = xlOpenXMLWorkbook
  $wb.Close($false)
}
finally {
  $excel.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [GC]::Collect()
}

$full = (Resolve-Path -LiteralPath $Out).Path
"wrote {0} ({1:N0} bytes)" -f $full, (Get-Item -LiteralPath $full).Length

if ($CopyTo) {
  $copyDir = Split-Path -Parent $CopyTo
  if (-not (Test-Path -LiteralPath $copyDir)) { New-Item -ItemType Directory -Force -Path $copyDir | Out-Null }
  Copy-Item -LiteralPath $full -Destination $CopyTo -Force
  "copied to {0}" -f (Resolve-Path -LiteralPath $CopyTo).Path
}
