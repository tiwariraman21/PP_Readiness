<#
.SYNOPSIS
  Generates the demo master and transactional data into data/dataset.json.

.DESCRIPTION
  Builds a plant network, a material master of roughly 100 finished goods and
  sub-assemblies plus the raw materials they depend on, multi-level bills of
  material, and a year of transactional history behind them: sales orders,
  deliveries, production and planned orders, purchasing, subcontracting,
  reservations, goods movements, batches and twelve months of consumption.

  Everything is generated from a fixed seed, so re-running it reproduces the same
  dataset byte for byte. Change $Seed to get a different but equally coherent one.

  Offsets are days relative to "today" at load time, which is how the dashboard
  reads dates. Negative is history, positive is the plan.

  After this, run tools\build-workbook.ps1 to turn the JSON into the workbook the
  dashboard actually reads.
#>
param(
  [string]$Out = (Join-Path $PSScriptRoot "..\data\dataset.json"),
  [int64]$Seed = 20260910
)

$ErrorActionPreference = "Stop"

# ---------- deterministic randomness ----------
$script:seed = $Seed
function Rnd {
  $script:seed = ($script:seed * 1103515245 + 12345) % 2147483648
  if ($script:seed -lt 0) { $script:seed += 2147483648 }
  return $script:seed / 2147483648.0
}
function RInt([int]$min, [int]$max) {
  if ($max -le $min) { return $min }
  return $min + [int][Math]::Floor((Rnd) * ($max - $min + 1))
}
function Pick($arr) { return $arr[(RInt 0 ($arr.Count - 1))] }
function Chance([double]$p) { return (Rnd) -lt $p }
function R1([double]$v) { return [Math]::Round($v, 1) }

# ---------- plants ----------
# NOTE: PowerShell variable names are case-insensitive, so this must not be
# called $plants - $PLANTS below would silently overwrite it and strip the prefix.
$plantDefs = @(
  @{ id = "1000"; name = "Pune";       region = "West";    pre = "PUN" },
  @{ id = "1100"; name = "Chakan";     region = "West";    pre = "CHK" },
  @{ id = "1200"; name = "Chennai";    region = "South";   pre = "CHE" },
  @{ id = "1300"; name = "Pithampur";  region = "Central"; pre = "PIT" }
)
$plantIds = $plantDefs | ForEach-Object { $_.id }

$PLANTS = @($plantDefs | ForEach-Object { [ordered]@{ id = $_.id; name = $_.name; region = $_.region } })

# road distance in days, symmetric
$transitDays = @{ "1000-1100" = 1; "1000-1200" = 4; "1000-1300" = 2; "1100-1200" = 4; "1100-1300" = 2; "1200-1300" = 5 }
$TRANSIT = [ordered]@{}
foreach ($a in $plantIds) {
  foreach ($b in $plantIds) {
    if ($a -eq $b) { continue }
    $k = if ($transitDays.ContainsKey("$a-$b")) { "$a-$b" } else { "$b-$a" }
    $TRANSIT["$a-$b"] = $transitDays[$k]
  }
}

$SLOCS = @(
  [ordered]@{ code = "RM01"; name = "Raw material store";     type = "Unrestricted";        defaultIn = $true;  effort = 0; note = "" },
  [ordered]@{ code = "PR01"; name = "Production supply area"; type = "Unrestricted";        defaultIn = $true;  effort = 0; note = "" },
  [ordered]@{ code = "QI01"; name = "Quality inspection";     type = "Quality hold";        defaultIn = $false; effort = 2; note = "Needs usage decision from QA before issue" },
  [ordered]@{ code = "SC01"; name = "Subcontract staging";    type = "Staged for dispatch"; defaultIn = $false; effort = 3; note = "Staged at the plant for dispatch to a subcontractor, not yet sent" },
  [ordered]@{ code = "IT01"; name = "In transit";             type = "In transit";          defaultIn = $false; effort = 4; note = "Post goods receipt on arrival to make issuable" },
  [ordered]@{ code = "BL01"; name = "Blocked stock";          type = "Blocked";             defaultIn = $false; effort = 5; note = "Blocked - needs QA release or scrap decision" }
)

$SHIP_POINTS = @($plantDefs | ForEach-Object {
  [ordered]@{ id = $_.id; desc = "$($_.name) despatch"; plant = $_.id; pickPack = (RInt 1 2); loading = 1 }
})

$SCHED_MARGIN = @(
  [ordered]@{ key = "001"; desc = "Standard assembly";  floatBefore = 1; floatAfter = 2; opening = 5 },
  [ordered]@{ key = "002"; desc = "Long lead assembly"; floatBefore = 2; floatAfter = 3; opening = 10 },
  [ordered]@{ key = "003"; desc = "Fast turnaround";    floatBefore = 0; floatAfter = 1; opening = 3 }
)

$ORDER_STATUS = [ordered]@{
  CRTD = [ordered]@{ name = "Created, not yet released"; tone = "neutral" }
  REL  = [ordered]@{ name = "Released to the shop floor"; tone = "go" }
  PRT  = [ordered]@{ name = "Shop papers printed"; tone = "neutral" }
  MSPT = [ordered]@{ name = "Missing parts"; tone = "stop" }
  PCNF = [ordered]@{ name = "Partially confirmed"; tone = "signal" }
  CNF  = [ordered]@{ name = "Confirmed"; tone = "signal" }
  PDLV = [ordered]@{ name = "Partially delivered"; tone = "signal" }
  DLV  = [ordered]@{ name = "Delivered"; tone = "go" }
  GMPS = [ordered]@{ name = "Goods movement posted"; tone = "neutral" }
  TECO = [ordered]@{ name = "Technically completed"; tone = "neutral" }
}

$MVT_TYPES = [ordered]@{
  "101" = [ordered]@{ text = "Goods receipt"; effect = "in" }
  "261" = [ordered]@{ text = "Goods issue for order"; effect = "out" }
  "262" = [ordered]@{ text = "Reversal of goods issue"; effect = "in" }
  "311" = [ordered]@{ text = "Transfer between storage locations"; effect = "move" }
  "541" = [ordered]@{ text = "Transfer to subcontractor"; effect = "out" }
  "543" = [ordered]@{ text = "Consumption at subcontractor"; effect = "out" }
  "601" = [ordered]@{ text = "Goods issue for delivery"; effect = "out" }
}

# ---------- material master ----------
$MATERIALS = [ordered]@{}
$fgList = @()   # @{ code; plant; family; hours; margin }
$sfgList = @()  # @{ code; tier }
$rmList = @()   # @{ code; cat }

function AddMat($code, $desc, $uom, $lead, $proc, $mrp) {
  $MATERIALS[$code] = [ordered]@{ desc = $desc; uom = $uom; lead = $lead; proc = $proc; mrp = $mrp }
}

# raw materials, by category
$rmCats = @(
  @{ pre = "RM-CAST";   n = 14; desc = "Casting";                 uom = "EA"; lead = @(18, 26); mrp = "B12" },
  @{ pre = "RM-SEAL";   n = 14; desc = "Seal kit";                uom = "EA"; lead = @(8, 16);  mrp = "B10" },
  @{ pre = "RM-BEAR";   n = 12; desc = "Bearing";                 uom = "EA"; lead = @(10, 20); mrp = "B10" },
  @{ pre = "RM-BOLT";   n = 10; desc = "Fastener set";            uom = "EA"; lead = @(5, 10);  mrp = "B10" },
  @{ pre = "RM-SHAFT";  n = 12; desc = "Shaft";                   uom = "EA"; lead = @(14, 24); mrp = "B12" },
  @{ pre = "RM-GEAR";   n = 14; desc = "Gear";                    uom = "EA"; lead = @(20, 32); mrp = "B12" },
  @{ pre = "RM-PLATE";  n = 10; desc = "Plate set";               uom = "EA"; lead = @(10, 18); mrp = "B11" },
  @{ pre = "RM-SPRING"; n = 8;  desc = "Spring";                  uom = "EA"; lead = @(6, 12);  mrp = "B10" },
  @{ pre = "RM-MOTOR";  n = 8;  desc = "Electric motor";          uom = "EA"; lead = @(30, 45); mrp = "B20" },
  @{ pre = "RM-PLC";    n = 8;  desc = "PLC module";              uom = "EA"; lead = @(35, 55); mrp = "B20" },
  @{ pre = "RM-CONT";   n = 8;  desc = "Contactor";               uom = "EA"; lead = @(15, 26); mrp = "B20" },
  @{ pre = "RM-WIRE";   n = 6;  desc = "Control wire";            uom = "M";  lead = @(6, 12);  mrp = "B20" },
  @{ pre = "RM-TERM";   n = 6;  desc = "Terminal block";          uom = "EA"; lead = @(8, 14);  mrp = "B20" },
  @{ pre = "RM-SENS";   n = 8;  desc = "Sensor";                  uom = "EA"; lead = @(12, 22); mrp = "B20" },
  @{ pre = "RM-FILT";   n = 8;  desc = "Filter element";          uom = "EA"; lead = @(7, 14);  mrp = "B11" },
  @{ pre = "RM-OIL";    n = 6;  desc = "Hydraulic oil";           uom = "L";  lead = @(5, 10);  mrp = "B11" },
  @{ pre = "RM-HOSE";   n = 6;  desc = "Hydraulic hose";          uom = "M";  lead = @(9, 16);  mrp = "B11" },
  @{ pre = "RM-VLVC";   n = 6;  desc = "Cartridge valve";         uom = "EA"; lead = @(16, 28); mrp = "B12" },
  @{ pre = "RM-ENCL";   n = 8;  desc = "Enclosure";               uom = "EA"; lead = @(12, 22); mrp = "B20" },
  @{ pre = "RM-FAST";   n = 8;  desc = "Machined fitting";        uom = "EA"; lead = @(8, 15);  mrp = "B11" }
)
foreach ($c in $rmCats) {
  for ($i = 1; $i -le $c.n; $i++) {
    $code = "{0}-{1:D3}" -f $c.pre, ($i * 7 + 10)
    $lead = RInt $c.lead[0] $c.lead[1]
    AddMat $code "$($c.desc) type $($i * 7 + 10)" $c.uom $lead "F" $c.mrp
    $rmList += @{ code = $code; cat = $c.pre }
  }
}

# sub-assemblies: tier 1 can contain tier 2, tier 2 is raw only
$sfgFams = @(
  @{ pre = "SA-HOUSING";  n = 5; desc = "Pump housing sub-assembly" },
  @{ pre = "SA-ROTOR";    n = 4; desc = "Rotor sub-assembly" },
  @{ pre = "SA-CASE";     n = 4; desc = "Gear case sub-assembly" },
  @{ pre = "SA-IMPELLER"; n = 3; desc = "Impeller sub-assembly" },
  @{ pre = "SA-VBODY";    n = 3; desc = "Valve body sub-assembly" },
  @{ pre = "SA-TANK";     n = 3; desc = "Reservoir tank sub-assembly" },
  @{ pre = "SA-STATOR";   n = 3; desc = "Stator sub-assembly" },
  @{ pre = "SA-PISTON";   n = 3; desc = "Piston sub-assembly" },
  @{ pre = "SA-MANIFOLD"; n = 3; desc = "Manifold sub-assembly" },
  @{ pre = "SA-CTRLBRD";  n = 3; desc = "Control board sub-assembly" },
  @{ pre = "SA-FRAME";    n = 3; desc = "Frame sub-assembly" },
  @{ pre = "SA-FILTHEAD"; n = 3; desc = "Filter head sub-assembly" }
)
$sfgIndex = 0
foreach ($f in $sfgFams) {
  for ($i = 1; $i -le $f.n; $i++) {
    $code = "{0}-{1:D2}" -f $f.pre, ($i * 5)
    $lead = RInt 3 8
    AddMat $code "$($f.desc), variant $($i * 5)" "EA" $lead "E" (Pick @("P01", "P02", "P03"))
    # last third of the list is the deeper tier
    $tier = if ($sfgIndex -ge 26) { 2 } else { 1 }
    $sfgList += @{ code = $code; tier = $tier }
    $sfgIndex++
  }
}

# finished goods
$fgFams = @(
  @{ pre = "FG-PUMP";  desc = "Hydraulic pump assembly HP";   sfg = @("SA-HOUSING", "SA-ROTOR", "SA-IMPELLER"); wc = "ASSY"; hours = @(5, 13) },
  @{ pre = "FG-GEAR";  desc = "Gearbox GB";                   sfg = @("SA-CASE", "SA-STATOR");                  wc = "GEAR"; hours = @(6, 14) },
  @{ pre = "FG-CTRL";  desc = "Control panel CP";             sfg = @("SA-CTRLBRD", "SA-FRAME");                wc = "PANEL"; hours = @(10, 22) },
  @{ pre = "FG-VALVE"; desc = "Directional control valve DV"; sfg = @("SA-VBODY", "SA-MANIFOLD");               wc = "ASSY"; hours = @(3, 7) },
  @{ pre = "FG-POWER"; desc = "Hydraulic power pack HPP";     sfg = @("SA-TANK", "SA-HOUSING", "SA-FRAME");     wc = "ASSY"; hours = @(12, 20) },
  @{ pre = "FG-GMOT";  desc = "Geared motor unit GM";         sfg = @("SA-CASE", "SA-STATOR");                  wc = "GEAR"; hours = @(9, 16) },
  @{ pre = "FG-SENS";  desc = "Sensor junction box SJ";       sfg = @("SA-CTRLBRD");                            wc = "PANEL"; hours = @(2, 5) },
  @{ pre = "FG-COMP";  desc = "Air compressor unit AC";       sfg = @("SA-PISTON", "SA-FRAME", "SA-STATOR");    wc = "ASSY"; hours = @(11, 19) },
  @{ pre = "FG-ACT";   desc = "Linear actuator LA";           sfg = @("SA-PISTON", "SA-MANIFOLD");              wc = "MACH"; hours = @(4, 9) },
  @{ pre = "FG-FILT";  desc = "Filtration unit FU";           sfg = @("SA-FILTHEAD", "SA-FRAME");               wc = "ASSY"; hours = @(5, 11) }
)
$fgIdx = 0
foreach ($f in $fgFams) {
  for ($v = 1; $v -le 6; $v++) {
    $num = 100 + ($v - 1) * 50
    $code = "{0}-{1}" -f $f.pre, $num
    $lead = RInt 7 18
    AddMat $code "$($f.desc)-$num" "EA" $lead "E" (Pick @("P01", "P02", "P03", "P04"))
    $fgList += @{
      code = $code; family = $f; plant = $plantIds[$fgIdx % $plantIds.Count]
      hours = R1 (RInt $f.hours[0] $f.hours[1]); margin = (Pick @("001", "002", "003"))
    }
    $fgIdx++
  }
}

# ---------- work centres ----------
$wcTypes = @(
  @{ suf = "ASSY-A"; desc = "Assembly line A"; gross = 400; util = 0.85; shifts = 2 },
  @{ suf = "ASSY-B"; desc = "Assembly line B"; gross = 240; util = 0.85; shifts = 1 },
  @{ suf = "MACH-1"; desc = "CNC machining cell 1"; gross = 400; util = 0.80; shifts = 2 },
  @{ suf = "MACH-2"; desc = "CNC machining cell 2"; gross = 240; util = 0.80; shifts = 1 },
  @{ suf = "GEAR-1"; desc = "Gear line 1"; gross = 320; util = 0.85; shifts = 2 },
  @{ suf = "PANEL-1"; desc = "Panel bench 1"; gross = 200; util = 0.90; shifts = 1 },
  @{ suf = "TEST-1"; desc = "Test bench"; gross = 160; util = 0.90; shifts = 1 }
)
$WORK_CENTRES = @()
$wcByPlantType = @{}
foreach ($p in $plantDefs) {
  foreach ($w in $wcTypes) {
    $prefix = [string]$p["pre"]
    if (-not $prefix) { throw "plant $($p.id) has no short prefix" }
    $id = $prefix + "-" + $w.suf
    $WORK_CENTRES += [ordered]@{
      id = $id; desc = "$($w.desc), $($p.name)"; plant = $p.id
      shifts = $w.shifts; grossPerWeek = $w.gross; util = $w.util
    }
    $key = "$($p.id)|$($w.suf.Split('-')[0])"
    if (-not $wcByPlantType.ContainsKey($key)) { $wcByPlantType[$key] = @() }
    $wcByPlantType[$key] += $id
  }
}
function WcFor($plantId, $type) {
  $key = "$plantId|$type"
  if ($wcByPlantType.ContainsKey($key)) { return (Pick $wcByPlantType[$key]) }
  return (Pick $wcByPlantType["$plantId|ASSY"])
}

# ---------- bills of material ----------
$rmByCat = @{}
foreach ($r in $rmList) {
  if (-not $rmByCat.ContainsKey($r.cat)) { $rmByCat[$r.cat] = @() }
  $rmByCat[$r.cat] += $r.code
}
$sfgByFam = @{}
foreach ($s in $sfgList) {
  $fam = ($s.code -split '-')[0] + "-" + ($s.code -split '-')[1]
  if (-not $sfgByFam.ContainsKey($fam)) { $sfgByFam[$fam] = @() }
  $sfgByFam[$fam] += $s.code
}
$tier2 = @($sfgList | Where-Object { $_.tier -eq 2 } | ForEach-Object { $_.code })

$BOMS = [ordered]@{}
function Comp($code, $qty, $scrap) { return [ordered]@{ code = $code; qty = $qty; scrap = $scrap } }

# sub-assembly bills
foreach ($s in $sfgList) {
  $parts = @()
  $cats = @()
  switch -Wildcard ($s.code) {
    "SA-HOUSING*"  { $cats = @("RM-CAST", "RM-SEAL", "RM-BOLT") }
    "SA-ROTOR*"    { $cats = @("RM-SHAFT", "RM-BEAR", "RM-FAST") }
    "SA-CASE*"     { $cats = @("RM-CAST", "RM-BOLT", "RM-SEAL") }
    "SA-IMPELLER*" { $cats = @("RM-CAST", "RM-FAST") }
    "SA-VBODY*"    { $cats = @("RM-CAST", "RM-VLVC", "RM-SEAL") }
    "SA-TANK*"     { $cats = @("RM-PLATE", "RM-SEAL", "RM-BOLT") }
    "SA-STATOR*"   { $cats = @("RM-MOTOR", "RM-WIRE", "RM-BEAR") }
    "SA-PISTON*"   { $cats = @("RM-SHAFT", "RM-SEAL", "RM-SPRING") }
    "SA-MANIFOLD*" { $cats = @("RM-CAST", "RM-VLVC", "RM-FAST") }
    "SA-CTRLBRD*"  { $cats = @("RM-PLC", "RM-TERM", "RM-WIRE") }
    "SA-FRAME*"    { $cats = @("RM-PLATE", "RM-BOLT", "RM-FAST") }
    "SA-FILTHEAD*" { $cats = @("RM-FILT", "RM-SEAL", "RM-FAST") }
    default        { $cats = @("RM-FAST", "RM-BOLT") }
  }
  foreach ($c in $cats) {
    $n = RInt 1 2
    for ($k = 0; $k -lt $n; $k++) {
      $code = Pick $rmByCat[$c]
      if ($parts | Where-Object { $_.code -eq $code }) { continue }
      $parts += Comp $code (RInt 1 8) (Pick @(0, 0, 2, 3, 5))
    }
  }
  # tier 1 sub-assemblies sometimes carry a deeper one, which is what gives the
  # explosion more than two levels to walk
  if ($s.tier -eq 1 -and (Chance 0.35)) {
    $parts += Comp (Pick $tier2) 1 0
  }
  $BOMS[$s.code] = [ordered]@{ "1" = @($parts) }
}

# finished good bills, some with a second alternative
foreach ($f in $fgList) {
  $mk = {
    param($swapFirst)
    $parts = @()
    foreach ($fam in $f.family.sfg) {
      $pool = $sfgByFam[$fam]
      $code = if ($swapFirst -and $pool.Count -gt 1) { $pool[1] } else { $pool[0] }
      $parts += Comp $code (RInt 1 2) 0
    }
    foreach ($c in @("RM-SEAL", "RM-BOLT", "RM-OIL", "RM-HOSE", "RM-FAST")) {
      if (Chance 0.7) { $parts += Comp (Pick $rmByCat[$c]) (RInt 1 6) (Pick @(0, 2, 5, 8)) }
    }
    return ,@($parts)
  }
  $alts = [ordered]@{ "1" = (& $mk $false) }
  if (Chance 0.35) { $alts["2"] = (& $mk $true) }
  $BOMS[$f.code] = $alts
}

# ---------- production versions ----------
$PROD_VERSIONS = [ordered]@{}
$routingSeq = 50000100
foreach ($f in $fgList) {
  $alts = @($BOMS[$f.code].Keys)
  $vers = @()
  $vi = 1
  foreach ($a in $alts) {
    $wc = WcFor $f.plant $f.family.wc
    $routingSeq += 7
    $vers += [ordered]@{
      version  = "{0:D4}" -f $vi
      text     = "$($f.family.desc) route $vi"
      wc       = $wc
      hoursPer = R1 ($f.hours * (1 + ($vi - 1) * 0.15))
      bom      = $a
      bomUsage = "1"
      routing  = "$routingSeq"
      counter  = "01"
      line     = ($WORK_CENTRES | Where-Object { $_.id -eq $wc } | Select-Object -First 1).desc
      lotFrom  = if ($vi -eq 1) { 1 } else { 25 }
      lotTo    = if ($vi -eq 1) { 9999 } else { 9999 }
      validFrom = -(RInt 200 600)
      validTo  = (RInt 200 400)
      locked   = ($vi -gt 1 -and (Chance 0.15))
    }
    $vi++
  }
  $PROD_VERSIONS[$f.code] = @($vers)
}

$FINISHED_GOODS = @($fgList | ForEach-Object {
  [ordered]@{ code = $_.code; plant = $_.plant; defaultQty = (Pick @(5, 8, 10, 12, 15, 20, 25, 30, 40, 50)) }
})

# ---------- where each material lives ----------
# a material is stocked at the plants that consume it, plus the odd extra
$usedAt = @{}   # code -> hashtable of plantId
function MarkUse($code, $plantId) {
  if (-not $usedAt.ContainsKey($code)) { $usedAt[$code] = @{} }
  $usedAt[$code][$plantId] = $true
}
function WalkBom($code, $plantId, $depth) {
  if ($depth -gt 4) { return }
  MarkUse $code $plantId
  if (-not $BOMS.Contains($code)) { return }
  foreach ($a in $BOMS[$code].Keys) {
    foreach ($c in $BOMS[$code][$a]) { WalkBom $c.code $plantId ($depth + 1) }
  }
}
foreach ($f in $fgList) { WalkBom $f.code $f.plant 0 }

# ---------- stock ----------
$STOCK = @()
$stockIndex = @{}
foreach ($code in $MATERIALS.Keys) {
  if (-not $usedAt.ContainsKey($code)) { continue }
  foreach ($p in $usedAt[$code].Keys) {
    $isFg = $code.StartsWith("FG-")
    $isSa = $code.StartsWith("SA-")
    # A third of the material/plant combinations are deliberately tight, so the
    # shortage, contention and coverage screens have something real to report.
    $tight = Chance 0.34
    $base = if ($tight) {
      if ($isFg -or $isSa) { RInt 0 4 } else { RInt 0 45 }
    } else {
      if ($isFg) { RInt 5 40 } elseif ($isSa) { RInt 4 60 } else { RInt 60 900 }
    }
    if ($base -le 0) { continue }
    $main = if ($isFg -or $isSa) { "PR01" } else { "RM01" }
    $STOCK += [ordered]@{ m = $code; p = $p; s = $main; q = $base }
    $stockIndex["$code|$p"] = $base
    # a slice of stock sits somewhere it cannot be issued from
    if (Chance 0.16) { $STOCK += [ordered]@{ m = $code; p = $p; s = "QI01"; q = (RInt 5 120) } }
    if (Chance 0.08) { $STOCK += [ordered]@{ m = $code; p = $p; s = "BL01"; q = (RInt 5 80) } }
    if (Chance 0.07) { $STOCK += [ordered]@{ m = $code; p = $p; s = "IT01"; q = (RInt 5 90) } }
    if (Chance 0.05) { $STOCK += [ordered]@{ m = $code; p = $p; s = "SC01"; q = (RInt 5 60) } }
  }
}

# ---------- MRP plant data ----------
$MRP_DATA = @()
foreach ($code in $MATERIALS.Keys) {
  if (-not $usedAt.ContainsKey($code)) { continue }
  foreach ($p in $usedAt[$code].Keys) {
    $fg = $fgList | Where-Object { $_.code -eq $code -and $_.plant -eq $p } | Select-Object -First 1
    $safety = if ($code.StartsWith("RM-")) { RInt 0 200 } else { RInt 0 20 }
    $row = [ordered]@{ m = $code; p = $p }
    if ($fg) { $row.marginKey = $fg.margin }
    $row.safety = $safety
    $row.reorder = [int]($safety * 1.6)
    $row.mrpType = if ($code.StartsWith("RM-")) { Pick @("PD", "VB") } else { "PD" }
    $row.lotSize = Pick @("EX", "FX", "HB")
    $MRP_DATA += $row
  }
}

# ---------- parties ----------
$customers = @(
  @{ n = "Shree Hydraulics, Nagpur"; c = "C-10041" }, @{ n = "Metro Equipment, Delhi"; c = "C-10088" },
  @{ n = "Kishore Distributors, Surat"; c = "C-10112" }, @{ n = "Deccan Machine Tools, Hubli"; c = "C-10150" },
  @{ n = "Bharat Fluid Power, Pune"; c = "C-10175" }, @{ n = "Western Gears, Kolhapur"; c = "C-10203" },
  @{ n = "Coromandel Controls, Chennai"; c = "C-10310" }, @{ n = "Southern Switchgear, Hosur"; c = "C-10344" },
  @{ n = "Nilgiri Instruments, Coimbatore"; c = "C-10388" }, @{ n = "Narmada Engineering, Indore"; c = "C-10412" },
  @{ n = "Sutlej Motors, Ludhiana"; c = "C-10455" }, @{ n = "Konkan Marine Works, Goa"; c = "C-10501" },
  @{ n = "Godavari Pumps, Nashik"; c = "C-10533" }, @{ n = "Malwa Agro Systems, Ujjain"; c = "C-10570" },
  @{ n = "Cauvery Textiles, Erode"; c = "C-10612" }, @{ n = "Vindhya Cement, Satna"; c = "C-10648" },
  @{ n = "Tapti Steel, Jalgaon"; c = "C-10677" }, @{ n = "Chambal Fertilisers, Kota"; c = "C-10704" },
  @{ n = "Krishna Sugar Mills, Sangli"; c = "C-10742" }, @{ n = "Mahi Auto Components, Vadodara"; c = "C-10788" },
  @{ n = "Palar Precision, Vellore"; c = "C-10810" }, @{ n = "Beas Hydro, Mandi"; c = "C-10855" },
  @{ n = "Sabarmati Plastics, Ahmedabad"; c = "C-10893" }, @{ n = "Periyar Rubber, Kochi"; c = "C-10921" },
  @{ n = "Yamuna Printing, Faridabad"; c = "C-10964" }
)
$vendors = @(
  @{ n = "Sanghvi Forge Pvt Ltd"; c = "V-10023" }, @{ n = "SKF India Ltd"; c = "V-10002" },
  @{ n = "Perfect Seals India"; c = "V-10188" }, @{ n = "Indo Lubricants"; c = "V-10310" },
  @{ n = "Hydac Filters India"; c = "V-10501" }, @{ n = "Precision Gears Pune"; c = "V-11002" },
  @{ n = "Siemens India Pvt Ltd"; c = "V-20011" }, @{ n = "Schneider Electric India"; c = "V-20044" },
  @{ n = "Phoenix Contact India"; c = "V-20090" }, @{ n = "Crompton Motors India"; c = "V-10801" },
  @{ n = "Danfoss Drives India"; c = "V-20120" }, @{ n = "Rittal India Pvt Ltd"; c = "V-20155" },
  @{ n = "Nashik Alloy Machining"; c = "V-10730" }, @{ n = "Bharat Spring Works"; c = "V-10758" },
  @{ n = "Pune Fabrication Industries"; c = "V-10766" }, @{ n = "Vane Tech Engineering"; c = "V-10450" },
  @{ n = "Kalyani Castings"; c = "V-10077" }, @{ n = "Gabriel Hoses Ltd"; c = "V-10345" },
  @{ n = "Tata Bearings"; c = "V-10014" }, @{ n = "Wipro Fluid Power"; c = "V-10620" }
)
$subVendors = @(
  @{ n = "Shreeji Machining Works"; c = "V-10620"; s = "Housing bore machining and facing" },
  @{ n = "Precision Machining Works"; c = "V-10655"; s = "Rotor balancing and shaft press fit" },
  @{ n = "Aditya Engineering"; c = "V-10702"; s = "Vane insertion and dynamic balancing" },
  @{ n = "Chakan Precision Tools"; c = "V-11080"; s = "Gear case boring" },
  @{ n = "Indore Heat Treat"; c = "V-11150"; s = "Case hardening and temper" },
  @{ n = "Chennai Surface Coat"; c = "V-11210"; s = "Hard chrome plating" }
)
$users = @("S. Jadhav", "M. Shinde", "A. Bhosale", "P. More", "K. Raman", "D. Rane", "R. Patil",
  "S. Deshpande", "A. Kulkarni", "R. Krishnan", "N. Iyer", "V. Chauhan")
$routes = @("IN0001", "IN0002", "IN0003", "IN0004", "IN0007", "IN0010", "IN0011", "IN0014")

function MrpRun($offset) {
  $d = (Get-Date).AddDays($offset)
  return "MRP run {0:dd MMM}" -f $d
}

# ---------- sales orders and deliveries ----------
$SALES_ORDERS = @()
$DELIVERIES = @()
$soSeq = 45000000
$dlvSeq = 80000000
for ($i = 0; $i -lt 420; $i++) {
  $f = Pick $fgList
  $cust = Pick $customers
  $soSeq += (RInt 1 4)
  $item = "{0:D2}" -f ((RInt 1 6) * 10)
  $req = RInt -355 80
  $qty = Pick @(2, 4, 5, 6, 8, 10, 12, 15, 18, 20, 24, 30, 36, 40)
  # older lines are fully confirmed; the forward book has gaps
  $confirmed = if ($req -lt 0) { $qty } elseif (Chance 0.7) { $qty } else { [int]($qty * (Pick @(0, 0.25, 0.5, 0.75))) }
  $SALES_ORDERS += [ordered]@{
    doc = "$soSeq"; item = $item; route = (Pick $routes); shipPoint = $f.plant
    transit = (RInt 1 6); customer = $cust.n; soldTo = $cust.c
    m = $f.code; p = $f.plant; qty = $qty; confirmed = $confirmed; reqOffset = $req
  }
  # anything wanted in the past has usually shipped
  if ($req -lt -5 -and (Chance 0.88)) {
    $dlvSeq += (RInt 1 3)
    $DELIVERIES += [ordered]@{
      doc = "$dlvSeq"; item = "10"; m = $f.code; p = $f.plant
      qty = $qty; offset = $req + (RInt -2 3); so = "$soSeq"
      customer = $cust.n; gi = $true
    }
  } elseif ($req -ge -5 -and $req -le 12 -and (Chance 0.4)) {
    $dlvSeq += (RInt 1 3)
    $DELIVERIES += [ordered]@{
      doc = "$dlvSeq"; item = "10"; m = $f.code; p = $f.plant
      qty = $qty; offset = $req; so = "$soSeq"; customer = $cust.n; gi = $false
    }
  }
}

# ---------- production orders ----------
$PROD_ORDERS = @()
$prdByPlant = @{}
foreach ($p in $plantIds) { $prdByPlant[$p] = 100000 + [int]$p }
for ($i = 0; $i -lt 260; $i++) {
  $f = Pick $fgList
  $pv = $PROD_VERSIONS[$f.code][0]
  $prdByPlant[$f.plant] += (RInt 1 5)
  $created = RInt -365 -3
  $start = $created + (RInt 3 20)
  $finish = $start + (RInt 2 14)
  $qty = Pick @(4, 6, 8, 10, 12, 15, 20, 25, 30)
  $status = @()
  $delivered = 0; $confirmed = 0
  if ($finish -lt -10) {
    $status = @("REL", "CNF", "DLV", "GMPS", "TECO"); $delivered = $qty; $confirmed = $qty
  } elseif ($finish -lt 0) {
    if (Chance 0.75) { $status = @("REL", "CNF", "DLV", "GMPS", "TECO"); $delivered = $qty; $confirmed = $qty }
    else { $status = @("REL", "PRT", "PCNF"); $confirmed = [int]($qty * 0.6) }
  } elseif ($start -lt 0) {
    $status = @("REL", "PRT")
    if (Chance 0.35) { $status += "MSPT" }
    if (Chance 0.4) { $status += "PCNF"; $confirmed = [int]($qty * 0.4) }
  } else {
    $status = if (Chance 0.5) { @("CRTD") } else { @("REL", "PRT") }
  }
  $PROD_ORDERS += [ordered]@{
    order = "PRD-$($prdByPlant[$f.plant])"; wc = $pv.wc; hoursPer = $pv.hoursPer
    plant = $f.plant; material = $f.code; type = "PP01"; mrp = $MATERIALS[$f.code].mrp
    qty = $qty; delivered = $delivered; confirmed = $confirmed
    createdOffset = $created; startOffset = $start; finishOffset = $finish
    mode = (Pick @("MRP", "MRP", "MRP", "Manual")); createdBy = (MrpRun $created)
    status = @($status)
  }
}

# ---------- planned orders ----------
$PLANNED_ORDERS = @()
$plafSeq = 123000
for ($i = 0; $i -lt 90; $i++) {
  $f = Pick $fgList
  $pv = $PROD_VERSIONS[$f.code][0]
  $plafSeq += (RInt 1 9)
  $start = RInt 2 55
  $PLANNED_ORDERS += [ordered]@{
    order = "{0:D10}" -f $plafSeq; m = $f.code; p = $f.plant
    qty = (Pick @(5, 10, 15, 20, 25, 30)); startOffset = $start
    finishOffset = $start + (RInt 4 16); firmed = (Chance 0.3)
    wc = $pv.wc; hoursPer = $pv.hoursPer; opening = $start - (RInt 3 12)
  }
}

# ---------- purchase orders and stock transfers ----------
$SUPPLY = @()
$poSeq = 4500000000
$stoSeq = 4700000000
# only materials that something actually consumes, so purchasing lines up with demand
$rmCodes = @($rmList | Where-Object { $usedAt.ContainsKey($_.code) } | ForEach-Object { $_.code })
for ($i = 0; $i -lt 420; $i++) {
  $code = Pick $rmCodes
  $p = Pick @($usedAt[$code].Keys)
  $isSto = Chance 0.12
  # Just over half the book is still open and lands inside or near the planning
  # horizon; the rest is last year's history, already received.
  if (Chance 0.55) {
    $due = RInt -25 55
    $created = $due - (RInt 12 70)
  } else {
    $created = RInt -350 -40
    $due = $created + (RInt 10 60)
  }
  $q = Pick @(20, 40, 50, 60, 100, 150, 200, 250, 400, 500, 800)
  $received = if ($due -lt -5) { $q } elseif ($due -lt 5 -and (Chance 0.5)) { [int]($q * 0.6) } else { 0 }
  $pegged = @()
  if ($received -lt $q -and (Chance 0.3)) {
    $cand = $PROD_ORDERS | Where-Object { $_.plant -eq $p } | Select-Object -First 1
    if ($cand) { $pegged = @([ordered]@{ order = $cand.order; qty = [int](($q - $received) * 0.4); run = (MrpRun -4) }) }
  }
  if ($isSto) {
    $other = Pick (@($plantIds | Where-Object { $_ -ne $p }))
    $stoSeq += (RInt 1 6)
    $SUPPLY += [ordered]@{
      doc = "$stoSeq"; item = "10"; type = "STO"; m = $code; p = $p
      vendor = "Plant $other"; vendorCode = $other
      q = $q; received = $received; createdOffset = $created; offset = $due
      mode = "MRP"; createdBy = (MrpRun $created); pegged = @($pegged)
    }
  } else {
    $v = Pick $vendors
    $poSeq += (RInt 1 6)
    $SUPPLY += [ordered]@{
      doc = "$poSeq"; item = (Pick @("10", "20", "30")); type = "PO"; m = $code; p = $p
      vendor = $v.n; vendorCode = $v.c
      q = $q; received = $received; createdOffset = $created; offset = $due
      mode = (Pick @("MRP", "MRP", "Manual")); createdBy = (MrpRun $created); pegged = @($pegged)
    }
  }
}

# ---------- subcontracting ----------
$SUBCON = @()
$scSeq = 4500900000
$sfgCodes = @($sfgList | Where-Object { $usedAt.ContainsKey($_.code) } | ForEach-Object { $_.code })
for ($i = 0; $i -lt 90; $i++) {
  $code = Pick $sfgCodes
  $p = Pick @($usedAt[$code].Keys)
  $v = Pick $subVendors
  $scSeq += (RInt 1 7)
  # over half still out at the vendor, which is what puts stock on the
  # subcontracting screen rather than leaving it empty
  if (Chance 0.6) {
    $due = RInt -15 45
    $created = $due - (RInt 14 50)
  } else {
    $created = RInt -300 -60
    $due = $created + (RInt 12 45)
  }
  $q = Pick @(10, 15, 20, 25, 30, 40)
  $received = if ($due -lt -3) { $q } elseif (Chance 0.4) { [int]($q * 0.7) } else { 0 }
  $prov = @()
  foreach ($c in $BOMS[$code]["1"]) {
    if ($c.code.StartsWith("SA-")) { continue }
    $need = [int]([Math]::Ceiling($q * $c.qty * 1.05))
    $prov += [ordered]@{ code = $c.code; qty = $need; consumed = [int]($need * ($received / [Math]::Max($q, 1))) }
  }
  $SUBCON += [ordered]@{
    doc = "$scSeq"; item = "10"; plant = $p; vendor = $v.n; vendorCode = $v.c
    material = $code; q = $q; received = $received
    createdOffset = $created; offset = $due
    mode = (Pick @("MRP", "Manual")); createdBy = (MrpRun $created); service = $v.s
    provided = @($prov)
  }
}

# ---------- reservations ----------
$RESERVATIONS = @()
$resSeq = 45000
$openOrders = @($PROD_ORDERS | Where-Object { -not ($_.status -contains "TECO") })
for ($i = 0; $i -lt 240; $i++) {
  if ($openOrders.Count -eq 0) { break }
  $o = Pick $openOrders
  $bom = $BOMS[$o.material]
  if (-not $bom) { continue }
  $parts = $bom[@($bom.Keys)[0]]
  $c = Pick $parts
  $resSeq += (RInt 1 4)
  $req = [int]([Math]::Ceiling($o.qty * $c.qty))
  $withdrawn = if ($o.status -contains "CNF") { $req } elseif ($o.status -contains "PCNF") { [int]($req * 0.5) } else { 0 }
  $RESERVATIONS += [ordered]@{
    id = "{0:D10}/{1:D4}" -f $resSeq, ((RInt 1 8) * 10)
    m = $c.code; p = $o.plant; order = $o.order; type = "Production order"
    reqQty = $req; withdrawn = $withdrawn; offset = $o.startOffset
    finalIssue = ($withdrawn -ge $req)
  }
}

# ---------- goods movements across the year ----------
$GOODS_MVT = @()
$mvtSeq = 4900000000
foreach ($o in $PROD_ORDERS) {
  if ($o.finishOffset -gt 5) { continue }
  $bom = $BOMS[$o.material]
  if (-not $bom) { continue }
  $parts = $bom[@($bom.Keys)[0]]
  foreach ($c in ($parts | Select-Object -First 3)) {
    if (-not (Chance 0.75)) { continue }
    $mvtSeq += (RInt 1 5)
    $GOODS_MVT += [ordered]@{
      doc = "$mvtSeq"; item = "1"; p = $o.plant; offset = $o.startOffset + (RInt 0 3)
      mvt = "261"; ref = $o.order; refType = "PRD"; m = $c.code
      qty = [int]([Math]::Ceiling($o.qty * $c.qty)); sloc = "RM01"; user = (Pick $users)
    }
  }
  if ($o.delivered -gt 0) {
    $mvtSeq += (RInt 1 5)
    $GOODS_MVT += [ordered]@{
      doc = "$mvtSeq"; item = "1"; p = $o.plant; offset = $o.finishOffset
      mvt = "101"; ref = $o.order; refType = "PRD"; m = $o.material
      qty = $o.delivered; sloc = "PR01"; user = (Pick $users)
    }
  }
}
foreach ($d in $DELIVERIES) {
  if (-not $d.gi) { continue }
  $mvtSeq += (RInt 1 5)
  $GOODS_MVT += [ordered]@{
    doc = "$mvtSeq"; item = "1"; p = $d.p; offset = $d.offset
    mvt = "601"; ref = $d.doc; refType = "SD"; m = $d.m
    qty = $d.qty; sloc = "PR01"; user = (Pick $users)
  }
}
foreach ($s in $SUPPLY) {
  if ($s.received -le 0) { continue }
  $mvtSeq += (RInt 1 5)
  $GOODS_MVT += [ordered]@{
    doc = "$mvtSeq"; item = "1"; p = $s.p; offset = $s.offset - (RInt 0 4)
    mvt = "101"; ref = $s.doc; refType = "PO"; m = $s.m
    qty = $s.received; sloc = "RM01"; user = (Pick $users)
  }
}
foreach ($s in $SUBCON) {
  foreach ($c in $s.provided) {
    $mvtSeq += (RInt 1 5)
    $GOODS_MVT += [ordered]@{
      doc = "$mvtSeq"; item = "1"; p = $s.plant; offset = $s.createdOffset
      mvt = "541"; ref = $s.doc; refType = "SC"; m = $c.code
      qty = $c.qty; sloc = "RM01"; user = (Pick $users)
    }
    if ($c.consumed -gt 0) {
      $mvtSeq += (RInt 1 5)
      $GOODS_MVT += [ordered]@{
        doc = "$mvtSeq"; item = "1"; p = $s.plant; offset = $s.offset - (RInt 0 5)
        mvt = "543"; ref = $s.doc; refType = "SC"; m = $c.code
        qty = $c.consumed; sloc = ""; user = (Pick $users)
      }
    }
  }
}

# ---------- batch managed stock ----------
$batchCandidates = @($rmList | Where-Object { $_.cat -in @("RM-SEAL", "RM-OIL", "RM-CAST", "RM-FILT", "RM-SPRING") } | ForEach-Object { $_.code })
$BATCH_MANAGED = @($batchCandidates | Select-Object -First 22)
$BATCHES = @()
foreach ($code in $BATCH_MANAGED) {
  if (-not $usedAt.ContainsKey($code)) { continue }
  foreach ($p in $usedAt[$code].Keys) {
    # batch quantities must add up to the storage location stock, or availability
    # disagrees with what the stock screen shows
    $rows = @($STOCK | Where-Object { $_.m -eq $code -and $_.p -eq $p })
    foreach ($r in $rows) {
      $left = $r.q
      $n = RInt 1 3
      for ($k = 1; $k -le $n; $k++) {
        $take = if ($k -eq $n) { $left } else { [int]($left / ($n - $k + 2)) }
        if ($take -le 0) { continue }
        $left -= $take
        $mfg = -(RInt 20 420)
        $BATCHES += [ordered]@{
          m = $code; p = $p; sloc = $r.s
          batch = "B{0}-{1}{2}" -f (RInt 2501 2612), ($code.Split('-')[-1]), ([char](64 + (RInt 1 26)))
          qty = $take
          status = if ($r.s -eq "QI01" -or $r.s -eq "BL01") { "restricted" } else { Pick @("unrestricted", "unrestricted", "unrestricted", "restricted") }
          mfgOffset = $mfg
          expOffset = if (Chance 0.55) { $mfg + (RInt 380 760) } else { $null }
          vendorBatch = "{0}-{1}" -f ($code.Split('-')[1]), (RInt 1000 9999)
        }
      }
    }
  }
}

# ---------- twelve months of consumption ----------
$CONSUMPTION = @()
foreach ($r in $rmList) {
  if (-not $usedAt.ContainsKey($r.code)) { continue }
  foreach ($p in $usedAt[$r.code].Keys) {
    if (-not (Chance 0.8)) { continue }
    $baseRate = RInt 8 400
    $trend = (Rnd) * 0.6 - 0.25          # -25% to +35% across the year
    $lumpy = Chance 0.22
    $dormant = Chance 0.06
    $total = @(); $unplanned = @()
    for ($m = 0; $m -lt 12; $m++) {
      $f = 1 + $trend * ($m / 11.0)
      $v = $baseRate * $f * (0.75 + (Rnd) * 0.5)
      if ($lumpy -and ($m % 3 -ne 0)) { $v = $v * 0.15 }
      if ($dormant -and $m -ge 6) { $v = 0 }
      if ($m -eq 11) { $v = $v * 0.55 }   # month in progress
      $tv = [int][Math]::Round($v)
      $total += $tv
      $unplanned += [int][Math]::Round($tv * ((Rnd) * 0.14))
    }
    $CONSUMPTION += [ordered]@{ m = $r.code; p = $p; total = @($total); unplanned = @($unplanned) }
  }
}

# ---------- planned independent requirements ----------
$PIR = @()
for ($i = 0; $i -lt 200; $i++) {
  $f = Pick $fgList
  $qty = Pick @(5, 8, 10, 12, 15, 20, 25)
  $PIR += [ordered]@{
    m = $f.code; p = $f.plant; version = "00"
    offset = (RInt 10 130); qty = $qty
    withdrawn = if (Chance 0.35) { [int]($qty * (Pick @(0.2, 0.4, 0.6))) } else { 0 }
  }
}

# ---------- assemble ----------
$data = [ordered]@{
  PLANTS = $PLANTS; TRANSIT = $TRANSIT; SLOCS = $SLOCS
  MATERIALS = $MATERIALS; BOMS = $BOMS; PROD_VERSIONS = $PROD_VERSIONS
  FINISHED_GOODS = $FINISHED_GOODS; STOCK = $STOCK; ORDER_STATUS = $ORDER_STATUS
  PROD_ORDERS = $PROD_ORDERS; MRP_DATA = $MRP_DATA; SALES_ORDERS = $SALES_ORDERS
  SHIP_POINTS = $SHIP_POINTS; SCHED_MARGIN = $SCHED_MARGIN; PIR = $PIR
  PLANNED_ORDERS = $PLANNED_ORDERS; WORK_CENTRES = $WORK_CENTRES; BATCHES = $BATCHES
  CONSUMPTION = $CONSUMPTION; DELIVERIES = $DELIVERIES; MVT_TYPES = $MVT_TYPES
  GOODS_MVT = $GOODS_MVT; RESERVATIONS = $RESERVATIONS; SUBCON = $SUBCON
  SUPPLY = $SUPPLY; BATCH_MANAGED = $BATCH_MANAGED
}

$outDir = Split-Path -Parent $Out
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$json = $data | ConvertTo-Json -Depth 40 -Compress
[System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding $false))

"{0,-16} {1}" -f "materials", $MATERIALS.Count
"{0,-16} {1}" -f "  finished", $fgList.Count
"{0,-16} {1}" -f "  sub-assy", $sfgList.Count
"{0,-16} {1}" -f "  raw", $rmList.Count
"{0,-16} {1}" -f "bills", $BOMS.Count
"{0,-16} {1}" -f "work centres", $WORK_CENTRES.Count
"{0,-16} {1}" -f "stock rows", $STOCK.Count
"{0,-16} {1}" -f "mrp rows", $MRP_DATA.Count
"{0,-16} {1}" -f "sales orders", $SALES_ORDERS.Count
"{0,-16} {1}" -f "deliveries", $DELIVERIES.Count
"{0,-16} {1}" -f "prod orders", $PROD_ORDERS.Count
"{0,-16} {1}" -f "planned", $PLANNED_ORDERS.Count
"{0,-16} {1}" -f "purchasing", $SUPPLY.Count
"{0,-16} {1}" -f "subcontract", $SUBCON.Count
"{0,-16} {1}" -f "reservations", $RESERVATIONS.Count
"{0,-16} {1}" -f "movements", $GOODS_MVT.Count
"{0,-16} {1}" -f "batches", $BATCHES.Count
"{0,-16} {1}" -f "consumption", $CONSUMPTION.Count
"{0,-16} {1}" -f "PIR", $PIR.Count
"wrote {0} ({1:N0} bytes)" -f (Resolve-Path $Out).Path, (Get-Item $Out).Length
