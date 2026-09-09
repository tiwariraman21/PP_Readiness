import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";

/* ============================================================
   MASTER DATA
   ============================================================ */

const PLANTS = [
  { id: "1000", name: "Pune", region: "West" },
  { id: "1100", name: "Chakan", region: "West" },
  { id: "1200", name: "Chennai", region: "South" },
];

// Inter-plant transit days (picking + freight)
const TRANSIT = {
  "1000-1100": 1, "1100-1000": 1,
  "1000-1200": 4, "1200-1000": 4,
  "1100-1200": 4, "1200-1100": 4,
};

const SLOCS = [
  { code: "RM01", name: "Raw material store", type: "Unrestricted", defaultIn: true,  effort: 0, note: "" },
  { code: "PR01", name: "Production supply area", type: "Unrestricted", defaultIn: true, effort: 0, note: "" },
  { code: "QI01", name: "Quality inspection", type: "Quality hold", defaultIn: false, effort: 2, note: "Needs usage decision from QA before issue" },
  { code: "SC01", name: "Subcontract staging", type: "Staged for dispatch", defaultIn: false, effort: 3, note: "Staged at the plant for dispatch to a subcontractor, not yet sent" },
  { code: "IT01", name: "In transit", type: "In transit", defaultIn: false, effort: 4, note: "Post goods receipt on arrival to make issuable" },
  { code: "BL01", name: "Blocked stock", type: "Blocked", defaultIn: false, effort: 5, note: "Blocked — needs QA release or scrap decision" },
];

const SLOC_BY_CODE = Object.fromEntries(SLOCS.map((s) => [s.code, s]));

// procurement: F = bought out, E = made in-house
const MATERIALS = {
  "FG-PUMP-100":   { desc: "Hydraulic pump assembly HP-100", uom: "EA", lead: 9,  proc: "E", mrp: "P01" },
  "FG-PUMP-200":   { desc: "Hydraulic pump assembly HP-200 twin rotor", uom: "EA", lead: 12, proc: "E", mrp: "P01" },
  "FG-GEAR-200":   { desc: "Gearbox GB-200", uom: "EA", lead: 8, proc: "E", mrp: "P01" },
  "FG-CTRL-300":   { desc: "Control panel CP-300", uom: "EA", lead: 11, proc: "E", mrp: "P02" },

  "SA-HOUSING-10": { desc: "Pump housing sub-assembly, cast", uom: "EA", lead: 6, proc: "E", mrp: "P01" },
  "SA-HOUSING-15": { desc: "Pump housing sub-assembly, fabricated", uom: "EA", lead: 5, proc: "E", mrp: "P01" },
  "SA-ROTOR-20":   { desc: "Rotor sub-assembly", uom: "EA", lead: 5, proc: "E", mrp: "P01" },
  "SA-IMPELLER-25":{ desc: "Impeller sub-assembly", uom: "EA", lead: 4, proc: "E", mrp: "P01" },
  "SA-CASE-30":    { desc: "Gear case sub-assembly", uom: "EA", lead: 6, proc: "E", mrp: "P01" },

  "RM-CAST-001":   { desc: "Cast iron housing blank", uom: "EA", lead: 21, proc: "F", mrp: "B12" },
  "RM-CAST-002":   { desc: "Gear case casting", uom: "EA", lead: 21, proc: "F", mrp: "B12" },
  "RM-SEAL-014":   { desc: "O-ring seal 40 mm NBR", uom: "EA", lead: 12, proc: "F", mrp: "B10" },
  "RM-BOLT-M8":    { desc: "Hex bolt M8 x 40 8.8", uom: "EA", lead: 7, proc: "F", mrp: "B10" },
  "RM-SHAFT-220":  { desc: "Drive shaft 220 mm EN8", uom: "EA", lead: 18, proc: "F", mrp: "B12" },
  "RM-BEAR-6204":  { desc: "Ball bearing 6204 2RS", uom: "EA", lead: 14, proc: "F", mrp: "B10" },
  "RM-KEY-08":     { desc: "Parallel key 8 x 7 x 30", uom: "EA", lead: 5, proc: "F", mrp: "B10" },
  "RM-IMP-BLANK-05": { desc: "Impeller blank, aluminium", uom: "EA", lead: 16, proc: "F", mrp: "B12" },
  "RM-VANE-06":    { desc: "Vane insert 6 mm", uom: "EA", lead: 11, proc: "F", mrp: "B10" },
  "RM-GASKET-88":  { desc: "Gasket 88 mm graphite", uom: "EA", lead: 10, proc: "F", mrp: "B10" },
  "RM-FABPLT-06":  { desc: "Housing plate set, laser cut 6 mm", uom: "EA", lead: 14, proc: "F", mrp: "B12" },
  "RM-SEAL-050":   { desc: "O-ring seal 50 mm NBR", uom: "EA", lead: 12, proc: "F", mrp: "B10" },
  "RM-WELD-WIRE":  { desc: "Welding wire 1.2 mm", uom: "KG", lead: 6, proc: "F", mrp: "B11" },
  "RM-CASE-MC":    { desc: "Gear case, machined bought-out", uom: "EA", lead: 24, proc: "F", mrp: "B12" },
  "RM-FILTER-25":  { desc: "Hydraulic filter cartridge 25 µ", uom: "EA", lead: 9, proc: "F", mrp: "B11" },
  "RM-PLATE-ID":   { desc: "Identification nameplate", uom: "EA", lead: 9, proc: "F", mrp: "B11" },
  "RM-OIL-SAE40":  { desc: "Hydraulic oil SAE 40", uom: "L",  lead: 7, proc: "F", mrp: "B11" },
  "RM-GEAR-Z28":   { desc: "Spur gear Z28 hardened", uom: "EA", lead: 25, proc: "F", mrp: "B12" },
  "RM-ENCL-400":   { desc: "Enclosure 400 x 300 IP65", uom: "EA", lead: 16, proc: "F", mrp: "B20" },
  "RM-PLC-S71":    { desc: "PLC module S7-1200 CPU", uom: "EA", lead: 45, proc: "F", mrp: "B20" },
  "RM-CONT-25A":   { desc: "Contactor 25 A 3-pole", uom: "EA", lead: 20, proc: "F", mrp: "B20" },
  "RM-WIRE-15":    { desc: "Control wire 1.5 sq mm", uom: "M",  lead: 8, proc: "F", mrp: "B20" },
  "RM-TERM-BLK":   { desc: "Terminal block 4 mm", uom: "EA", lead: 10, proc: "F", mrp: "B20" },
};

// parent -> components. scrap = component scrap %
/* Bills of material, keyed by material then BOM alternative.
   A finished good with more than one alternative is reached through a production version. */
const BOMS = {
  "FG-PUMP-100": {
    "1": [
      { code: "SA-HOUSING-10", qty: 1, scrap: 0 },
      { code: "SA-ROTOR-20", qty: 1, scrap: 0 },
      { code: "RM-GASKET-88", qty: 2, scrap: 8 },
      { code: "RM-FILTER-25", qty: 1, scrap: 0 },
      { code: "RM-PLATE-ID", qty: 1, scrap: 0 },
      { code: "RM-OIL-SAE40", qty: 1.5, scrap: 2 },
    ],
    "2": [
      { code: "SA-HOUSING-15", qty: 1, scrap: 0 },
      { code: "SA-ROTOR-20", qty: 1, scrap: 0 },
      { code: "RM-GASKET-88", qty: 2, scrap: 8 },
      { code: "RM-FILTER-25", qty: 1, scrap: 0 },
      { code: "RM-PLATE-ID", qty: 1, scrap: 0 },
      { code: "RM-OIL-SAE40", qty: 1.5, scrap: 2 },
    ],
  },
  "FG-PUMP-200": {
    "1": [
      { code: "SA-HOUSING-10", qty: 1, scrap: 0 },
      { code: "SA-ROTOR-20", qty: 2, scrap: 0 },
      { code: "RM-GASKET-88", qty: 3, scrap: 8 },
      { code: "RM-FILTER-25", qty: 2, scrap: 0 },
      { code: "RM-PLATE-ID", qty: 1, scrap: 0 },
      { code: "RM-OIL-SAE40", qty: 2.5, scrap: 2 },
    ],
  },
  "SA-HOUSING-10": {
    "1": [
      { code: "RM-CAST-001", qty: 1, scrap: 2 },
      { code: "RM-SEAL-014", qty: 2, scrap: 5 },
      { code: "RM-BOLT-M8", qty: 8, scrap: 3 },
    ],
  },
  "SA-HOUSING-15": {
    "1": [
      { code: "RM-FABPLT-06", qty: 1, scrap: 2 },
      { code: "RM-SEAL-050", qty: 2, scrap: 5 },
      { code: "RM-BOLT-M8", qty: 10, scrap: 3 },
      { code: "RM-WELD-WIRE", qty: 0.4, scrap: 5 },
    ],
  },
  "SA-ROTOR-20": {
    "1": [
      { code: "RM-SHAFT-220", qty: 1, scrap: 0 },
      { code: "SA-IMPELLER-25", qty: 1, scrap: 0 },
      { code: "RM-BEAR-6204", qty: 2, scrap: 0 },
      { code: "RM-KEY-08", qty: 1, scrap: 4 },
    ],
  },
  "SA-IMPELLER-25": {
    "1": [
      { code: "RM-IMP-BLANK-05", qty: 1, scrap: 3 },
      { code: "RM-VANE-06", qty: 6, scrap: 5 },
    ],
  },
  "FG-GEAR-200": {
    "1": [
      { code: "SA-CASE-30", qty: 1, scrap: 0 },
      { code: "RM-GEAR-Z28", qty: 2, scrap: 0 },
      { code: "RM-BEAR-6204", qty: 4, scrap: 0 },
      { code: "RM-SEAL-014", qty: 3, scrap: 5 },
      { code: "RM-OIL-SAE40", qty: 0.8, scrap: 2 },
    ],
    "2": [
      { code: "RM-CASE-MC", qty: 1, scrap: 0 },
      { code: "RM-GEAR-Z28", qty: 2, scrap: 0 },
      { code: "RM-BEAR-6204", qty: 4, scrap: 0 },
      { code: "RM-SEAL-014", qty: 3, scrap: 5 },
      { code: "RM-OIL-SAE40", qty: 0.8, scrap: 2 },
    ],
  },
  "SA-CASE-30": {
    "1": [
      { code: "RM-CAST-002", qty: 1, scrap: 2 },
      { code: "RM-BOLT-M8", qty: 12, scrap: 3 },
    ],
  },
  "FG-CTRL-300": {
    "1": [
      { code: "RM-ENCL-400", qty: 1, scrap: 0 },
      { code: "RM-PLC-S71", qty: 1, scrap: 0 },
      { code: "RM-CONT-25A", qty: 3, scrap: 0 },
      { code: "RM-WIRE-15", qty: 25, scrap: 6 },
      { code: "RM-TERM-BLK", qty: 40, scrap: 2 },
      { code: "RM-PLATE-ID", qty: 1, scrap: 0 },
    ],
  },
};

/* Which BOM alternative applies to a material, given the versions chosen for this run */
function componentsOf(code, rules) {
  const alts = BOMS[code];
  if (!alts) return null;
  const keys = Object.keys(alts);
  const chosen = (rules && rules.alts && rules.alts[code]) || keys[0];
  return alts[chosen] || alts[keys[0]];
}

const bomAlternatives = (code) => Object.keys(BOMS[code] || {});

const NAV_GROUPS = [
  { group: "Plan", items: [["run", "Planning run"], ["demand", "Demand and supply"], ["capacity", "Capacity"], ["flow", "Production vs dispatch"], ["sales", "Sales and delivery risk"]] },
  { group: "Readiness", items: [["components", "Components"], ["shortages", "Shortages"], ["contention", "Contention"], ["schedule", "Schedule"]] },
  { group: "Reference", items: [["stock", "Stock"], ["consumption", "Consumption history"], ["prod", "Production orders"], ["orders", "Purchase orders"], ["subcon", "Subcontracting"]] },
  { group: "Support", items: [["summary", "Summary"], ["analysis", "Planner analysis"], ["sap", "SAP mapping"]] },
];

/* Production versions. Each ties a BOM alternative to a routing, a line, a lot size
   range and a validity period. MRP picks the first version that is unlocked, valid on
   the date and covers the order quantity. */
const PROD_VERSIONS = {
  "FG-PUMP-100": [
    { version: "0001", text: "Cast housing, assembly line A", wc: "ASSY-A", hoursPer: 6.5, bom: "1", bomUsage: "1",
      routing: "50000123", counter: "01", line: "Assembly line A",
      lotFrom: 1, lotTo: 60, validFrom: -540, validTo: 240, locked: false },
    { version: "0002", text: "Fabricated housing, assembly line B", wc: "ASSY-B", hoursPer: 8, bom: "2", bomUsage: "1",
      routing: "50000188", counter: "01", line: "Assembly line B",
      lotFrom: 20, lotTo: 500, validFrom: -180, validTo: 400, locked: false },
  ],
  "FG-PUMP-200": [
    { version: "0001", text: "Twin rotor, assembly line A", wc: "ASSY-A", hoursPer: 11, bom: "1", bomUsage: "1",
      routing: "50000210", counter: "01", line: "Assembly line A",
      lotFrom: 1, lotTo: 9999, validFrom: -300, validTo: 400, locked: false },
  ],
  "FG-GEAR-200": [
    { version: "0001", text: "In-house cased, small lot", wc: "GEAR-01", hoursPer: 9, bom: "1", bomUsage: "1",
      routing: "50000301", counter: "01", line: "Gear line 1",
      lotFrom: 1, lotTo: 30, validFrom: -600, validTo: 300, locked: false },
    { version: "0002", text: "Bought-out case, large lot", wc: "GEAR-02", hoursPer: 6.5, bom: "2", bomUsage: "1",
      routing: "50000305", counter: "01", line: "Gear line 2",
      lotFrom: 31, lotTo: 9999, validFrom: -200, validTo: 300, locked: false },
  ],
  "FG-CTRL-300": [
    { version: "0001", text: "Panel build, bench 1", wc: "PANEL-01", hoursPer: 14, bom: "1", bomUsage: "1",
      routing: "50000410", counter: "01", line: "Panel bench 1",
      lotFrom: 1, lotTo: 9999, validFrom: -420, validTo: 300, locked: false },
    { version: "0002", text: "Panel build, bench 2", wc: "PANEL-02", hoursPer: 14, bom: "1", bomUsage: "1",
      routing: "50000415", counter: "01", line: "Panel bench 2",
      lotFrom: 1, lotTo: 9999, validFrom: -90, validTo: 300, locked: true },
  ],
};

/* Mirrors the selection MRP performs, and says plainly why a version was picked */
function selectVersion(material, qty, date, forced, t0) {
  const list = (PROD_VERSIONS[material] || []).map((v) => ({
    ...v,
    from: addDays(t0, v.validFrom),
    to: addDays(t0, v.validTo),
    inDate: date >= addDays(t0, v.validFrom) && date <= addDays(t0, v.validTo),
    inLot: qty >= v.lotFrom && qty <= v.lotTo,
  }));
  if (!list.length) return null;

  if (forced) {
    const f = list.find((v) => v.version === forced);
    if (f) {
      const problems = [];
      if (f.locked) problems.push("this version is locked for production");
      if (!f.inDate) problems.push("the need date falls outside its validity period");
      if (!f.inLot) problems.push(`the order quantity is outside its lot size range of ${f.lotFrom} to ${f.lotTo}`);
      return { ...f, list, manual: true,
        reason: "Chosen by the planner.",
        warn: problems.length ? `Chosen manually, but ${problems.join(", and ")}.` : null };
    }
  }

  const exact = list.filter((v) => !v.locked && v.inDate && v.inLot);
  if (exact.length) {
    return { ...exact[0], list,
      reason: exact.length > 1
        ? `First of ${exact.length} versions valid for this quantity and date.`
        : "The only version valid for this quantity and date.",
      warn: null };
  }
  const byDate = list.filter((v) => !v.locked && v.inDate);
  if (byDate.length) {
    return { ...byDate[0], list,
      reason: "No version covers this lot size, so the first one valid on the date is used.",
      warn: `Order quantity sits outside every version's lot size range. Check whether ${byDate[0].version} is the right route for ${qty}.` };
  }
  const unlocked = list.filter((v) => !v.locked);
  if (unlocked.length) {
    return { ...unlocked[0], list,
      reason: "No version is valid on the need date.",
      warn: "Every version is outside its validity period on this date. Master data needs extending before the order can be created." };
  }
  return { ...list[0], list,
    reason: "Every version is locked for production.",
    warn: "All production versions are locked. The order cannot be created until one is released." };
}

const FINISHED_GOODS = [
  { code: "FG-PUMP-100", plant: "1000", defaultQty: 40 },
  { code: "FG-PUMP-200", plant: "1000", defaultQty: 12 },
  { code: "FG-GEAR-200", plant: "1100", defaultQty: 25 },
  { code: "FG-CTRL-300", plant: "1200", defaultQty: 15 },
];

// material / plant / storage location / qty
const STOCK = [
  // ---- Pune 1000
  { m: "FG-PUMP-100",  p: "1000", s: "PR01", q: 18 },
  { m: "FG-PUMP-200",  p: "1000", s: "PR01", q: 2 },
  { m: "SA-HOUSING-10", p: "1000", s: "PR01", q: 12 },
  { m: "SA-ROTOR-20",   p: "1000", s: "PR01", q: 5 },
  { m: "SA-IMPELLER-25",p: "1000", s: "PR01", q: 8 },
  { m: "RM-IMP-BLANK-05", p: "1000", s: "RM01", q: 12 },
  { m: "RM-VANE-06",    p: "1000", s: "RM01", q: 90 },
  { m: "RM-VANE-06",    p: "1000", s: "QI01", q: 200 },
  { m: "RM-CAST-001",   p: "1000", s: "RM01", q: 45 },
  { m: "RM-SEAL-014",   p: "1000", s: "RM01", q: 30 },
  { m: "RM-SEAL-014",   p: "1000", s: "QI01", q: 40 },
  { m: "RM-BOLT-M8",    p: "1000", s: "RM01", q: 800 },
  { m: "RM-SHAFT-220",  p: "1000", s: "RM01", q: 20 },
  { m: "RM-BEAR-6204",  p: "1000", s: "RM01", q: 40 },
  { m: "RM-BEAR-6204",  p: "1000", s: "SC01", q: 25 },
  { m: "RM-KEY-08",     p: "1000", s: "RM01", q: 500 },
  { m: "RM-GASKET-88",  p: "1000", s: "RM01", q: 20 },
  { m: "SA-HOUSING-15", p: "1000", s: "PR01", q: 3 },
  { m: "RM-FABPLT-06",  p: "1000", s: "RM01", q: 60 },
  { m: "RM-SEAL-050",   p: "1000", s: "RM01", q: 220 },
  { m: "RM-WELD-WIRE",  p: "1000", s: "RM01", q: 25 },
  { m: "RM-FILTER-25",  p: "1000", s: "RM01", q: 15 },
  { m: "RM-PLATE-ID",   p: "1000", s: "RM01", q: 300 },
  { m: "RM-OIL-SAE40",  p: "1000", s: "RM01", q: 70 },
  { m: "RM-CONT-25A",   p: "1000", s: "RM01", q: 60 },
  { m: "RM-CAST-002",   p: "1000", s: "RM01", q: 10 },

  { doc: "4900011860", item: "1", p: "1000", offset: -26, mvt: "101", ref: "PRD-1000198", refType: "PRD", m: "FG-PUMP-100", qty: 16, sloc: "PR01", user: "S. Jadhav" },
  { doc: "4900011905", item: "1", p: "1000", offset: -19, mvt: "101", ref: "PRD-1000212", refType: "PRD", m: "FG-PUMP-100", qty: 12, sloc: "PR01", user: "S. Jadhav" },
  { doc: "4900011948", item: "1", p: "1000", offset: -12, mvt: "101", ref: "PRD-1000221", refType: "PRD", m: "FG-PUMP-200", qty: 6, sloc: "PR01", user: "M. Shinde" },
  { doc: "4900012004", item: "1", p: "1000", offset: -5, mvt: "101", ref: "PRD-1000229", refType: "PRD", m: "FG-PUMP-100", qty: 14, sloc: "PR01", user: "S. Jadhav" },
  { doc: "4900011865", item: "1", p: "1000", offset: -25, mvt: "601", ref: "80001201", refType: "SD", m: "FG-PUMP-100", qty: 14, sloc: "PR01", user: "A. Bhosale" },
  { doc: "4900011910", item: "1", p: "1000", offset: -18, mvt: "601", ref: "80001208", refType: "SD", m: "FG-PUMP-100", qty: 10, sloc: "PR01", user: "A. Bhosale" },
  { doc: "4900011960", item: "1", p: "1000", offset: -11, mvt: "601", ref: "80001222", refType: "SD", m: "FG-PUMP-200", qty: 5, sloc: "PR01", user: "A. Bhosale" },
  { doc: "4900012020", item: "1", p: "1000", offset: -4, mvt: "601", ref: "80001236", refType: "SD", m: "FG-PUMP-100", qty: 12, sloc: "PR01", user: "A. Bhosale" },

  // ---- Chakan 1100
  { m: "FG-GEAR-200",   p: "1100", s: "PR01", q: 22 },
  { m: "SA-CASE-30",    p: "1100", s: "PR01", q: 30 },
  { m: "RM-GEAR-Z28",   p: "1100", s: "RM01", q: 120 },
  { m: "RM-BEAR-6204",  p: "1100", s: "RM01", q: 260 },
  { m: "RM-SEAL-014",   p: "1100", s: "RM01", q: 200 },
  { m: "RM-OIL-SAE40",  p: "1100", s: "RM01", q: 80 },
  { m: "RM-BOLT-M8",    p: "1100", s: "RM01", q: 1500 },
  { m: "RM-CAST-002",   p: "1100", s: "RM01", q: 60 },
  { m: "RM-CASE-MC",    p: "1100", s: "RM01", q: 20 },
  { m: "RM-GASKET-88",  p: "1100", s: "BL01", q: 150 },
  { m: "RM-SHAFT-220",  p: "1100", s: "IT01", q: 30 },

  { doc: "4900011930", item: "1", p: "1100", offset: -16, mvt: "601", ref: "80001215", refType: "SD", m: "FG-GEAR-200", qty: 15, sloc: "PR01", user: "P. More" },
  { doc: "4900012040", item: "1", p: "1100", offset: -2, mvt: "601", ref: "80001243", refType: "SD", m: "FG-GEAR-200", qty: 8, sloc: "PR01", user: "P. More" },

  // ---- Chennai 1200
  { m: "FG-CTRL-300",   p: "1200", s: "PR01", q: 4 },
  { m: "RM-ENCL-400",   p: "1200", s: "RM01", q: 20 },
  { m: "RM-PLC-S71",    p: "1200", s: "RM01", q: 2 },
  { m: "RM-CONT-25A",   p: "1200", s: "RM01", q: 10 },
  { m: "RM-WIRE-15",    p: "1200", s: "RM01", q: 1200 },
  { m: "RM-TERM-BLK",   p: "1200", s: "RM01", q: 200 },
  { m: "RM-TERM-BLK",   p: "1200", s: "BL01", q: 500 },
];

/* System status codes as they appear on a production order */
const ORDER_STATUS = {
  CRTD: { name: "Created, not yet released", tone: "neutral" },
  REL:  { name: "Released to the shop floor", tone: "go" },
  PRT:  { name: "Shop papers printed", tone: "neutral" },
  MSPT: { name: "Missing parts", tone: "stop" },
  PCNF: { name: "Partially confirmed", tone: "signal" },
  CNF:  { name: "Confirmed", tone: "signal" },
  PDLV: { name: "Partially delivered", tone: "signal" },
  DLV:  { name: "Delivered", tone: "go" },
  GMPS: { name: "Goods movement posted", tone: "neutral" },
  TECO: { name: "Technically completed", tone: "neutral" },
};

/* Open production orders competing for the same components */
const PROD_ORDERS = [
  { order: "PRD-1000234", wc: "ASSY-A", hoursPer: 6.5, plant: "1000", material: "FG-PUMP-100", type: "PP01", mrp: "P01",
    qty: 10, delivered: 0, confirmed: 4,
    createdOffset: -18, startOffset: -2, finishOffset: 3,
    mode: "MRP", createdBy: "MRP run 20 Aug",
    status: ["REL", "PRT", "PCNF", "MSPT"] },

  { order: "PRD-1000239", wc: "ASSY-A", hoursPer: 6.5, plant: "1000", material: "FG-PUMP-100", type: "PP01", mrp: "P01",
    qty: 6, delivered: 0, confirmed: 0,
    createdOffset: -11, startOffset: 1, finishOffset: 5,
    mode: "MRP", createdBy: "MRP run 27 Aug",
    status: ["REL", "PRT"] },

  { order: "PRD-1000241", wc: "MACH-01", hoursPer: 1.2, plant: "1000", material: "SA-HOUSING-10", type: "PP01", mrp: "P01",
    qty: 48, delivered: 48, confirmed: 48,
    createdOffset: -16, startOffset: -8, finishOffset: -2,
    mode: "MRP", createdBy: "MRP run 22 Aug",
    status: ["REL", "CNF", "DLV", "GMPS", "TECO"] },

  { order: "PRD-1000255", wc: "MACH-01", hoursPer: 1.8, plant: "1000", material: "SA-IMPELLER-25", type: "PP01", mrp: "P01",
    qty: 10, delivered: 0, confirmed: 0,
    createdOffset: -4, startOffset: 18, finishOffset: 22,
    mode: "MRP", createdBy: "MRP run 03 Sep",
    status: ["CRTD"] },

  { order: "PRD-1000260", wc: "ASSY-A", hoursPer: 6.5, plant: "1000", material: "FG-PUMP-100", type: "PP01", mrp: "P01",
    qty: 6, delivered: 0, confirmed: 0,
    createdOffset: -7, startOffset: 0, finishOffset: 4,
    mode: "MRP", createdBy: "MRP run 31 Aug",
    status: ["REL", "PRT", "MSPT"] },

  { order: "PRD-1100045", wc: "GEAR-01", hoursPer: 9, plant: "1100", material: "FG-GEAR-200", type: "PP01", mrp: "P01",
    qty: 15, delivered: 15, confirmed: 15,
    createdOffset: -19, startOffset: -9, finishOffset: -5,
    mode: "MRP", createdBy: "MRP run 19 Aug",
    status: ["REL", "CNF", "DLV", "GMPS", "TECO"] },

  { order: "PRD-1200088", wc: "PANEL-01", hoursPer: 14, plant: "1200", material: "FG-CTRL-300", type: "PP01", mrp: "P02",
    qty: 6, delivered: 0, confirmed: 0,
    createdOffset: -10, startOffset: 2, finishOffset: 6,
    mode: "MRP", createdBy: "MRP run 28 Aug",
    status: ["REL", "PRT", "MSPT"] },

  { order: "PRD-1200091", wc: "PANEL-01", hoursPer: 14, plant: "1200", material: "FG-CTRL-300", type: "PP01", mrp: "P02",
    qty: 5, delivered: 0, confirmed: 0,
    createdOffset: -3, startOffset: 6, finishOffset: 10,
    mode: "Manual", createdBy: "K. Raman",
    status: ["CRTD"] },
];

/* MRP plant data — MARC. Safety stock is what the projected stock line is measured against. */
const MRP_DATA = [
  { m: "FG-PUMP-100", p: "1000", marginKey: "001", safety: 10, reorder: 15, mrpType: "PD", lotSize: "EX" },
  { m: "FG-PUMP-200", p: "1000", marginKey: "002", safety: 4, reorder: 6, mrpType: "PD", lotSize: "EX" },
  { m: "FG-GEAR-200", p: "1100", marginKey: "001", safety: 8, reorder: 12, mrpType: "PD", lotSize: "EX" },
  { m: "FG-CTRL-300", p: "1200", marginKey: "002", safety: 3, reorder: 5, mrpType: "PD", lotSize: "EX" },
  { m: "SA-HOUSING-10", p: "1000", safety: 10, reorder: 15, mrpType: "PD", lotSize: "FX" },
  { m: "SA-ROTOR-20", p: "1000", safety: 6, reorder: 10, mrpType: "PD", lotSize: "FX" },
  { m: "RM-BEAR-6204", p: "1000", safety: 60, reorder: 100, mrpType: "VB", lotSize: "HB" },
  { m: "RM-SEAL-014", p: "1000", safety: 40, reorder: 80, mrpType: "VB", lotSize: "HB" },
  { m: "RM-GASKET-88", p: "1000", safety: 50, reorder: 90, mrpType: "VB", lotSize: "HB" },
  { m: "RM-VANE-06", p: "1000", safety: 150, reorder: 250, mrpType: "VB", lotSize: "HB" },
  { m: "RM-PLC-S71", p: "1200", safety: 5, reorder: 8, mrpType: "PD", lotSize: "EX" },
  { m: "RM-CONT-25A", p: "1200", safety: 30, reorder: 50, mrpType: "VB", lotSize: "HB" },
];
const safetyOf = (m, p) => (MRP_DATA.find((r) => r.m === m && r.p === p) || {}).safety || 0;
const mrpDataOf = (m, p) => MRP_DATA.find((r) => r.m === m && r.p === p) || null;
const marginKeyOf = (m, p) => (mrpDataOf(m, p) || {}).marginKey || "001";

/* Sales order schedule lines — VBAP / VBEP. This is the demand the plant is judged on. */
const SALES_ORDERS = [
  { doc: "45000871", item: "10", route: "IN0004", shipPoint: "1000", transit: 3, customer: "Shree Hydraulics, Nagpur", soldTo: "C-10041", m: "FG-PUMP-100", p: "1000", qty: 24, confirmed: 24, reqOffset: 12 },
  { doc: "45000874", item: "20", route: "IN0007", shipPoint: "1000", transit: 5, customer: "Metro Equipment, Delhi", soldTo: "C-10088", m: "FG-PUMP-100", p: "1000", qty: 18, confirmed: 18, reqOffset: 19 },
  { doc: "45000878", item: "10", route: "IN0003", shipPoint: "1000", transit: 2, customer: "Kishore Distributors, Surat", soldTo: "C-10112", m: "FG-PUMP-100", p: "1000", qty: 15, confirmed: 10, reqOffset: 26 },
  { doc: "45000880", item: "10", route: "IN0002", shipPoint: "1000", transit: 2, customer: "Deccan Machine Tools, Hubli", soldTo: "C-10150", m: "FG-PUMP-200", p: "1000", qty: 8, confirmed: 8, reqOffset: 20 },
  { doc: "45000883", item: "30", route: "IN0004", shipPoint: "1000", transit: 3, customer: "Shree Hydraulics, Nagpur", soldTo: "C-10041", m: "FG-PUMP-200", p: "1000", qty: 6, confirmed: 6, reqOffset: 33 },
  { doc: "45000886", item: "10", route: "IN0001", shipPoint: "1100", transit: 1, customer: "Western Gears, Kolhapur", soldTo: "C-10203", m: "FG-GEAR-200", p: "1100", qty: 20, confirmed: 20, reqOffset: 16 },
  { doc: "45000889", item: "20", route: "IN0007", shipPoint: "1100", transit: 5, customer: "Metro Equipment, Delhi", soldTo: "C-10088", m: "FG-GEAR-200", p: "1100", qty: 14, confirmed: 14, reqOffset: 30 },
  { doc: "45000892", item: "10", route: "IN0010", shipPoint: "1200", transit: 1, customer: "Coromandel Controls, Chennai", soldTo: "C-10310", m: "FG-CTRL-300", p: "1200", qty: 10, confirmed: 6, reqOffset: 18 },
  { doc: "45000895", item: "10", route: "IN0011", shipPoint: "1200", transit: 2, customer: "Southern Switchgear, Hosur", soldTo: "C-10344", m: "FG-CTRL-300", p: "1200", qty: 8, confirmed: 0, reqOffset: 25 },
  { doc: "45000898", item: "20", route: "IN0010", shipPoint: "1200", transit: 1, customer: "Coromandel Controls, Chennai", soldTo: "C-10310", m: "FG-CTRL-300", p: "1200", qty: 6, confirmed: 0, reqOffset: 40 },
];

/* Shipping points — TVST. Loading and pick/pack time sit between the plant and the truck. */
const SHIP_POINTS = [
  { id: "1000", desc: "Pune despatch", plant: "1000", pickPack: 1, loading: 1 },
  { id: "1100", desc: "Chakan despatch", plant: "1100", pickPack: 1, loading: 1 },
  { id: "1200", desc: "Chennai despatch", plant: "1200", pickPack: 2, loading: 1 },
];

/* Scheduling margin keys — T436A, assigned on MARC-SFCPF. All values in working days. */
const SCHED_MARGIN = [
  { key: "001", desc: "Standard assembly", floatBefore: 1, floatAfter: 2, opening: 5 },
  { key: "002", desc: "Long lead assembly", floatBefore: 2, floatAfter: 3, opening: 10 },
  { key: "003", desc: "Fast turnaround", floatBefore: 0, floatAfter: 1, opening: 3 },
];
const marginOf = (key) => SCHED_MARGIN.find((m) => m.key === key) || SCHED_MARGIN[0];

/* Planned independent requirements — PBIM / PBED. Forecast that real orders consume. */
const PIR = [
  { m: "FG-PUMP-100", p: "1000", version: "00", offset: 21, qty: 12, withdrawn: 4 },
  { m: "FG-PUMP-100", p: "1000", version: "00", offset: 35, qty: 12, withdrawn: 0 },
  { m: "FG-PUMP-200", p: "1000", version: "00", offset: 28, qty: 5, withdrawn: 0 },
  { m: "FG-GEAR-200", p: "1100", version: "00", offset: 24, qty: 10, withdrawn: 2 },
  { m: "FG-GEAR-200", p: "1100", version: "00", offset: 38, qty: 10, withdrawn: 0 },
  { m: "FG-CTRL-300", p: "1200", version: "00", offset: 31, qty: 6, withdrawn: 0 },
];

/* Planned orders — PLAF. Not yet converted, and deleted by the next MRP run unless firmed. */
const PLANNED_ORDERS = [
  { order: "0000123456", m: "FG-PUMP-100", p: "1000", qty: 20, startOffset: 8, finishOffset: 17, firmed: false, wc: "ASSY-A", hoursPer: 6.5, opening: -2 },
  { order: "0000123461", m: "FG-PUMP-100", p: "1000", qty: 20, startOffset: 22, finishOffset: 31, firmed: false, wc: "ASSY-A", hoursPer: 6.5, opening: 12 },
  { order: "0000123470", m: "FG-PUMP-200", p: "1000", qty: 10, startOffset: 15, finishOffset: 26, firmed: true, wc: "ASSY-A", hoursPer: 11, opening: 4 },
  { order: "0000123488", m: "FG-GEAR-200", p: "1100", qty: 18, startOffset: 11, finishOffset: 20, firmed: false, wc: "GEAR-01", hoursPer: 9, opening: 2 },
  { order: "0000123495", m: "FG-CTRL-300", p: "1200", qty: 8, startOffset: 19, finishOffset: 33, firmed: false, wc: "PANEL-01", hoursPer: 14, opening: 5 },
  { order: "0000123502", m: "SA-ROTOR-20", p: "1000", qty: 30, startOffset: 9, finishOffset: 16, firmed: false, wc: "MACH-01", hoursPer: 1.5, opening: 3 },
];

/* Work centres and available capacity — CRHD / KAKO. Hours per week after utilisation. */
const WORK_CENTRES = [
  { id: "ASSY-A", desc: "Pump assembly line A", plant: "1000", shifts: 2, grossPerWeek: 400, util: 0.85 },
  { id: "ASSY-B", desc: "Pump assembly line B", plant: "1000", shifts: 1, grossPerWeek: 200, util: 0.85 },
  { id: "MACH-01", desc: "CNC machining cell", plant: "1000", shifts: 2, grossPerWeek: 400, util: 0.80 },
  { id: "TEST-01", desc: "Pump test bench", plant: "1000", shifts: 1, grossPerWeek: 160, util: 0.90 },
  { id: "GEAR-01", desc: "Gear line 1", plant: "1100", shifts: 2, grossPerWeek: 320, util: 0.85 },
  { id: "GEAR-02", desc: "Gear line 2", plant: "1100", shifts: 1, grossPerWeek: 200, util: 0.85 },
  { id: "PANEL-01", desc: "Panel bench 1", plant: "1200", shifts: 1, grossPerWeek: 160, util: 0.90 },
  { id: "PANEL-02", desc: "Panel bench 2", plant: "1200", shifts: 1, grossPerWeek: 160, util: 0.90 },
];
const wcCapacity = (w) => Math.round(w.grossPerWeek * w.util);

/* Batch stock — MCHB with shelf life and status from MCHA. Only materials flagged
   batch managed appear here, and their batch quantities must add up to the storage
   location stock above or availability will disagree with MMBE. */
const BATCH_MANAGED = new Set(["RM-SEAL-014", "RM-GASKET-88", "RM-OIL-SAE40", "RM-VANE-06", "RM-CAST-001"]);

const BATCHES = [
  // RM-SEAL-014 @1000 — RM01 30, QI01 40
  { m: "RM-SEAL-014", p: "1000", sloc: "RM01", batch: "B2508-014A", qty: 18, status: "unrestricted", mfgOffset: -390, expOffset: 160, vendorBatch: "NBR-8841" },
  { m: "RM-SEAL-014", p: "1000", sloc: "RM01", batch: "B2601-014C", qty: 12, status: "unrestricted", mfgOffset: -240, expOffset: 310, vendorBatch: "NBR-9102" },
  { m: "RM-SEAL-014", p: "1000", sloc: "QI01", batch: "B2606-014F", qty: 40, status: "restricted", mfgOffset: -60, expOffset: 490, vendorBatch: "NBR-9455" },
  // RM-GASKET-88 @1000 — RM01 20
  { m: "RM-GASKET-88", p: "1000", sloc: "RM01", batch: "B2503-088A", qty: 8, status: "unrestricted", mfgOffset: -560, expOffset: -20, vendorBatch: "GR-2231" },
  { m: "RM-GASKET-88", p: "1000", sloc: "RM01", batch: "B2602-088D", qty: 12, status: "unrestricted", mfgOffset: -210, expOffset: 340, vendorBatch: "GR-2670" },
  // RM-OIL-SAE40 @1000 — RM01 70
  { m: "RM-OIL-SAE40", p: "1000", sloc: "RM01", batch: "B2510-040B", qty: 25, status: "unrestricted", mfgOffset: -330, expOffset: 35, vendorBatch: "IL-4402" },
  { m: "RM-OIL-SAE40", p: "1000", sloc: "RM01", batch: "B2605-040E", qty: 45, status: "unrestricted", mfgOffset: -95, expOffset: 270, vendorBatch: "IL-4781" },
  // RM-VANE-06 @1000 — RM01 90, QI01 200
  { m: "RM-VANE-06", p: "1000", sloc: "RM01", batch: "B2604-006A", qty: 55, status: "unrestricted", mfgOffset: -120, expOffset: null, vendorBatch: "VT-1180" },
  { m: "RM-VANE-06", p: "1000", sloc: "RM01", batch: "B2607-006B", qty: 35, status: "unrestricted", mfgOffset: -45, expOffset: null, vendorBatch: "VT-1244" },
  { m: "RM-VANE-06", p: "1000", sloc: "QI01", batch: "B2608-006C", qty: 200, status: "restricted", mfgOffset: -20, expOffset: null, vendorBatch: "VT-1290" },
  // Chakan 1100 — a batch managed material must have every stock line batched
  { m: "RM-SEAL-014", p: "1100", sloc: "RM01", batch: "B2602-014J", qty: 120, status: "unrestricted", mfgOffset: -200, expOffset: 350, vendorBatch: "NBR-9188" },
  { m: "RM-SEAL-014", p: "1100", sloc: "RM01", batch: "B2607-014K", qty: 80, status: "unrestricted", mfgOffset: -50, expOffset: 500, vendorBatch: "NBR-9501" },
  { m: "RM-OIL-SAE40", p: "1100", sloc: "RM01", batch: "B2604-040H", qty: 80, status: "unrestricted", mfgOffset: -110, expOffset: 255, vendorBatch: "IL-4699" },
  { m: "RM-GASKET-88", p: "1100", sloc: "BL01", batch: "B2504-088B", qty: 150, status: "restricted", mfgOffset: -520, expOffset: 40, vendorBatch: "GR-2299" },
  // RM-CAST-001 @1000 — RM01 45
  { m: "RM-CAST-001", p: "1000", sloc: "RM01", batch: "B2512-001A", qty: 20, status: "restricted", mfgOffset: -280, expOffset: null, vendorBatch: "SF-7701" },
  { m: "RM-CAST-001", p: "1000", sloc: "RM01", batch: "B2606-001B", qty: 25, status: "unrestricted", mfgOffset: -70, expOffset: null, vendorBatch: "SF-8033" },
];

const batchKey = (b) => `${b.p}|${b.m}|${b.sloc}|${b.batch}`;

/* Batches a planner would not want counted without a decision first */
function defaultBatchExclusions() {
  const out = new Set();
  for (const b of BATCHES) if (b.status === "restricted" || (b.expOffset != null && b.expOffset < 0)) out.add(batchKey(b));
  return out;
}

/* Consumption history — MVER. Twelve monthly periods, oldest first, ending with the
   current month. "total" is everything issued; "unplanned" is the part issued without a
   production order behind it, which is the number worth watching. */
const CONSUMPTION = [
  { m: "RM-BEAR-6204", p: "1000", total: [186, 172, 205, 198, 221, 194, 210, 188, 202, 215, 196, 118], unplanned: [4, 2, 6, 3, 5, 2, 4, 3, 2, 6, 3, 2] },
  { m: "RM-SEAL-014",  p: "1000", total: [96, 104, 112, 118, 126, 131, 140, 148, 155, 162, 171, 96], unplanned: [2, 3, 2, 4, 3, 2, 5, 3, 4, 3, 5, 2] },
  { m: "RM-GASKET-88", p: "1000", total: [42, 168, 12, 195, 28, 8, 212, 34, 15, 188, 22, 96], unplanned: [1, 6, 0, 8, 1, 0, 9, 2, 0, 7, 1, 4] },
  { m: "RM-BOLT-M8",   p: "1000", total: [1820, 1760, 1910, 1845, 2010, 1880, 1925, 1790, 1860, 1975, 1830, 1120], unplanned: [96, 88, 142, 104, 168, 112, 155, 98, 126, 149, 108, 74] },
  { m: "RM-VANE-06",   p: "1000", total: [620, 655, 710, 690, 745, 702, 768, 725, 780, 812, 795, 470], unplanned: [78, 92, 116, 104, 138, 121, 152, 134, 161, 178, 172, 98] },
  { m: "RM-CAST-001",  p: "1000", total: [88, 82, 95, 91, 102, 94, 98, 86, 93, 101, 90, 54], unplanned: [2, 1, 3, 2, 4, 2, 3, 1, 2, 3, 2, 1] },
  { m: "RM-SHAFT-220", p: "1000", total: [84, 79, 92, 88, 98, 90, 95, 83, 90, 97, 87, 52], unplanned: [1, 1, 2, 1, 2, 1, 2, 1, 1, 2, 1, 1] },
  { m: "RM-OIL-SAE40", p: "1000", total: [128, 121, 140, 134, 149, 138, 145, 127, 137, 148, 133, 79], unplanned: [8, 6, 11, 9, 12, 10, 11, 7, 9, 12, 8, 5] },
  { m: "RM-FILTER-25", p: "1000", total: [84, 79, 92, 88, 98, 90, 95, 83, 90, 97, 87, 52], unplanned: [0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0] },
  { m: "RM-IMP-BLANK-05", p: "1000", total: [86, 80, 94, 89, 100, 92, 97, 85, 92, 99, 89, 53], unplanned: [2, 1, 3, 2, 3, 2, 2, 1, 2, 3, 2, 1] },
  { m: "RM-PLATE-ID",  p: "1000", total: [170, 161, 186, 178, 198, 184, 192, 169, 182, 196, 177, 105], unplanned: [3, 2, 4, 3, 4, 3, 4, 2, 3, 4, 3, 2] },
  { m: "RM-KEY-08",    p: "1000", total: [88, 40, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0], unplanned: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { m: "RM-GEAR-Z28",  p: "1100", total: [58, 62, 55, 68, 61, 70, 64, 59, 66, 72, 63, 38], unplanned: [1, 2, 1, 3, 1, 2, 2, 1, 2, 3, 1, 1] },
  { m: "RM-CAST-002",  p: "1100", total: [30, 32, 28, 35, 31, 36, 33, 30, 34, 37, 32, 19], unplanned: [1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0] },
  { m: "RM-PLC-S71",   p: "1200", total: [0, 8, 0, 0, 11, 0, 0, 9, 0, 0, 12, 0], unplanned: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { m: "RM-CONT-25A",  p: "1200", total: [36, 33, 39, 30, 42, 36, 33, 39, 36, 30, 42, 21], unplanned: [1, 0, 1, 0, 2, 1, 0, 1, 1, 0, 2, 0] },
  { m: "RM-TERM-BLK",  p: "1200", total: [480, 440, 520, 400, 560, 480, 440, 520, 480, 400, 560, 280], unplanned: [12, 8, 22, 10, 26, 14, 9, 21, 12, 8, 24, 6] },
  { m: "RM-WIRE-15",   p: "1200", total: [300, 275, 325, 250, 350, 300, 275, 325, 300, 250, 350, 175], unplanned: [18, 14, 24, 12, 28, 19, 15, 23, 17, 11, 27, 9] },
  { m: "RM-ENCL-400",  p: "1200", total: [22, 20, 19, 17, 16, 15, 14, 12, 11, 10, 9, 5], unplanned: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0] },
];

/* Outbound deliveries — LIKP / LIPS. Goods issue posted means it left the plant. */
const DELIVERIES = [
  { doc: "80001201", item: "10", m: "FG-PUMP-100", p: "1000", qty: 14, offset: -25, so: "45000840", customer: "Shree Hydraulics, Nagpur", gi: true },
  { doc: "80001208", item: "10", m: "FG-PUMP-100", p: "1000", qty: 10, offset: -18, so: "45000846", customer: "Metro Equipment, Delhi", gi: true },
  { doc: "80001215", item: "10", m: "FG-GEAR-200", p: "1100", qty: 15, offset: -16, so: "45000851", customer: "Western Gears, Kolhapur", gi: true },
  { doc: "80001222", item: "20", m: "FG-PUMP-200", p: "1000", qty: 5, offset: -11, so: "45000855", customer: "Deccan Machine Tools, Hubli", gi: true },
  { doc: "80001229", item: "10", m: "FG-CTRL-300", p: "1200", qty: 7, offset: -9, so: "45000858", customer: "Coromandel Controls, Chennai", gi: true },
  { doc: "80001236", item: "10", m: "FG-PUMP-100", p: "1000", qty: 12, offset: -4, so: "45000864", customer: "Kishore Distributors, Surat", gi: true },
  { doc: "80001243", item: "10", m: "FG-GEAR-200", p: "1100", qty: 8, offset: -2, so: "45000866", customer: "Metro Equipment, Delhi", gi: true },
  { doc: "80001250", item: "10", m: "FG-PUMP-100", p: "1000", qty: 9, offset: 2, so: "45000869", customer: "Shree Hydraulics, Nagpur", gi: false },
  { doc: "80001257", item: "10", m: "FG-CTRL-300", p: "1200", qty: 4, offset: 4, so: "45000870", customer: "Southern Switchgear, Hosur", gi: false },
];

const ORDER_BY_ID = Object.fromEntries(PROD_ORDERS.map((o) => [o.order, o]));
const isReleased = (id) => {
  const o = ORDER_BY_ID[id];
  return o ? o.status.includes("REL") : true;
};

/* Movement type catalogue */
const MVT_TYPES = {
  "101": { text: "Goods receipt", effect: "in" },
  "261": { text: "Goods issue for order", effect: "out" },
  "262": { text: "Reversal of goods issue", effect: "in" },
  "311": { text: "Transfer between storage locations", effect: "move" },
  "541": { text: "Transfer to subcontractor", effect: "out" },
  "543": { text: "Consumption at subcontractor", effect: "out" },
  "601": { text: "Goods issue for delivery", effect: "out" },
};

/* Posted component movements. offset is days from today. */
const GOODS_MVT = [
  // ---- Pune 1000
  { doc: "4900012090", item: "1", p: "1000", offset: -22, mvt: "101", ref: "4500011505", refType: "PO", m: "RM-FILTER-25", qty: 60, sloc: "RM01", user: "S. Jadhav" },
  { doc: "4900012100", item: "1", p: "1000", offset: -30, mvt: "101", ref: "4500011188", refType: "PO", m: "RM-BEAR-6204", qty: 160, sloc: "RM01", user: "S. Jadhav" },
  { doc: "4900012120", item: "1", p: "1000", offset: -25, mvt: "541", ref: "4500011688", refType: "SC", m: "RM-IMP-BLANK-05", qty: 16, sloc: "RM01", user: "D. Rane" },
  { doc: "4900012121", item: "1", p: "1000", offset: -25, mvt: "541", ref: "4500011688", refType: "SC", m: "RM-VANE-06", qty: 101, sloc: "RM01", user: "D. Rane" },
  { doc: "4900012141", item: "1", p: "1000", offset: -14, mvt: "541", ref: "4500011720", refType: "SC", m: "RM-CAST-001", qty: 26, sloc: "RM01", user: "D. Rane" },
  { doc: "4900012142", item: "1", p: "1000", offset: -14, mvt: "541", ref: "4500011720", refType: "SC", m: "RM-BOLT-M8", qty: 208, sloc: "RM01", user: "D. Rane" },
  { doc: "4900012180", item: "1", p: "1000", offset: -6, mvt: "261", ref: "PRD-1000241", refType: "PRD", m: "RM-BOLT-M8", qty: 400, sloc: "RM01", user: "S. Jadhav" },
  { doc: "4900012181", item: "1", p: "1000", offset: -6, mvt: "101", ref: "PRD-1000241", refType: "PRD", m: "SA-HOUSING-10", qty: 48, sloc: "PR01", user: "S. Jadhav" },
  { doc: "4900012194", item: "1", p: "1000", offset: -4, mvt: "261", ref: "PRD-1000234", refType: "PRD", m: "RM-BEAR-6204", qty: 12, sloc: "RM01", user: "M. Shinde" },
  { doc: "4900012196", item: "1", p: "1000", offset: -4, mvt: "262", ref: "PRD-1000234", refType: "PRD", m: "RM-BEAR-6204", qty: 2, sloc: "RM01", user: "M. Shinde" },
  { doc: "4900012205", item: "1", p: "1000", offset: -3, mvt: "261", ref: "PRD-1000239", refType: "PRD", m: "RM-SEAL-014", qty: 7, sloc: "RM01", user: "M. Shinde" },
  { doc: "4900012230", item: "1", p: "1000", offset: -6, mvt: "541", ref: "4500011745", refType: "SC", m: "RM-SHAFT-220", qty: 20, sloc: "RM01", user: "D. Rane" },
  { doc: "4900012231", item: "1", p: "1000", offset: -6, mvt: "541", ref: "4500011745", refType: "SC", m: "RM-BEAR-6204", qty: 40, sloc: "RM01", user: "D. Rane" },
  { doc: "4900012232", item: "1", p: "1000", offset: -6, mvt: "541", ref: "4500011745", refType: "SC", m: "RM-KEY-08", qty: 21, sloc: "RM01", user: "D. Rane" },
  { doc: "4900012250", item: "1", p: "1000", offset: -2, mvt: "543", ref: "4500011720", refType: "SC", m: "RM-CAST-001", qty: 20, sloc: "", user: "D. Rane" },
  { doc: "4900012251", item: "1", p: "1000", offset: -2, mvt: "543", ref: "4500011720", refType: "SC", m: "RM-BOLT-M8", qty: 165, sloc: "", user: "D. Rane" },
  { doc: "4900012252", item: "1", p: "1000", offset: -2, mvt: "101", ref: "4500011720", refType: "SC", m: "SA-HOUSING-10", qty: 20, sloc: "PR01", user: "D. Rane" },
  { doc: "4900012258", item: "1", p: "1000", offset: -1, mvt: "101", ref: "4500011399", refType: "PO", m: "RM-OIL-SAE40", qty: 200, sloc: "RM01", user: "S. Jadhav" },

  { doc: "4900011860", item: "1", p: "1000", offset: -26, mvt: "101", ref: "PRD-1000198", refType: "PRD", m: "FG-PUMP-100", qty: 16, sloc: "PR01", user: "S. Jadhav" },
  { doc: "4900011905", item: "1", p: "1000", offset: -19, mvt: "101", ref: "PRD-1000212", refType: "PRD", m: "FG-PUMP-100", qty: 12, sloc: "PR01", user: "S. Jadhav" },
  { doc: "4900011948", item: "1", p: "1000", offset: -12, mvt: "101", ref: "PRD-1000221", refType: "PRD", m: "FG-PUMP-200", qty: 6, sloc: "PR01", user: "M. Shinde" },
  { doc: "4900012004", item: "1", p: "1000", offset: -5, mvt: "101", ref: "PRD-1000229", refType: "PRD", m: "FG-PUMP-100", qty: 14, sloc: "PR01", user: "S. Jadhav" },
  { doc: "4900011865", item: "1", p: "1000", offset: -25, mvt: "601", ref: "80001201", refType: "SD", m: "FG-PUMP-100", qty: 14, sloc: "PR01", user: "A. Bhosale" },
  { doc: "4900011910", item: "1", p: "1000", offset: -18, mvt: "601", ref: "80001208", refType: "SD", m: "FG-PUMP-100", qty: 10, sloc: "PR01", user: "A. Bhosale" },
  { doc: "4900011960", item: "1", p: "1000", offset: -11, mvt: "601", ref: "80001222", refType: "SD", m: "FG-PUMP-200", qty: 5, sloc: "PR01", user: "A. Bhosale" },
  { doc: "4900012020", item: "1", p: "1000", offset: -4, mvt: "601", ref: "80001236", refType: "SD", m: "FG-PUMP-100", qty: 12, sloc: "PR01", user: "A. Bhosale" },

  // ---- Chakan 1100
  { doc: "4900011950", item: "1", p: "1100", offset: -30, mvt: "541", ref: "4500011540", refType: "SC", m: "RM-CAST-002", qty: 41, sloc: "RM01", user: "P. More" },
  { doc: "4900011951", item: "1", p: "1100", offset: -30, mvt: "541", ref: "4500011540", refType: "SC", m: "RM-BOLT-M8", qty: 492, sloc: "RM01", user: "P. More" },
  { doc: "4900011975", item: "1", p: "1100", offset: -6, mvt: "543", ref: "4500011540", refType: "SC", m: "RM-CAST-002", qty: 41, sloc: "", user: "P. More" },
  { doc: "4900011977", item: "1", p: "1100", offset: -6, mvt: "543", ref: "4500011540", refType: "SC", m: "RM-BOLT-M8", qty: 492, sloc: "", user: "P. More" },
  { doc: "4900011976", item: "1", p: "1100", offset: -6, mvt: "101", ref: "4500011540", refType: "SC", m: "SA-CASE-30", qty: 40, sloc: "PR01", user: "P. More" },
  { doc: "4900011990", item: "1", p: "1100", offset: -5, mvt: "261", ref: "PRD-1100045", refType: "PRD", m: "RM-GEAR-Z28", qty: 30, sloc: "RM01", user: "P. More" },
  { doc: "4900011991", item: "1", p: "1100", offset: -5, mvt: "101", ref: "PRD-1100045", refType: "PRD", m: "FG-GEAR-200", qty: 15, sloc: "PR01", user: "P. More" },

  { doc: "4900011930", item: "1", p: "1100", offset: -16, mvt: "601", ref: "80001215", refType: "SD", m: "FG-GEAR-200", qty: 15, sloc: "PR01", user: "P. More" },
  { doc: "4900012040", item: "1", p: "1100", offset: -2, mvt: "601", ref: "80001243", refType: "SD", m: "FG-GEAR-200", qty: 8, sloc: "PR01", user: "P. More" },

  // ---- Chennai 1200
  { doc: "4900011975", item: "1", p: "1200", offset: -14, mvt: "101", ref: "PRD-1200071", refType: "PRD", m: "FG-CTRL-300", qty: 9, sloc: "PR01", user: "K. Raman" },
  { doc: "4900011992", item: "1", p: "1200", offset: -9, mvt: "601", ref: "80001229", refType: "SD", m: "FG-CTRL-300", qty: 7, sloc: "PR01", user: "K. Raman" },
  { doc: "4900012310", item: "1", p: "1200", offset: -8, mvt: "101", ref: "4500011477", refType: "PO", m: "RM-TERM-BLK", qty: 400, sloc: "RM01", user: "K. Raman" },
];

/* Open reservations from earlier MRP runs and released orders.
   Open quantity = required − withdrawn, and nothing is open once final issue is set. */
const RESERVATIONS = [
  { id: "0000045201/0010", m: "RM-CAST-001", p: "1000", order: "PRD-1000260", type: "Production order", reqQty: 20, withdrawn: 0, offset: 4, finalIssue: false },
  { id: "0000045188/0030", m: "RM-BEAR-6204", p: "1000", order: "PRD-1000234", type: "Production order", reqQty: 20, withdrawn: 10, offset: 3, finalIssue: false },
  { id: "0000045190/0020", m: "RM-SEAL-014", p: "1000", order: "PRD-1000239", type: "Production order", reqQty: 12, withdrawn: 7, offset: 5, finalIssue: false },
  { id: "0000045176/0040", m: "RM-BOLT-M8", p: "1000", order: "PRD-1000241", type: "Production order", reqQty: 400, withdrawn: 400, offset: -2, finalIssue: true },
  { id: "0000045233/0010", m: "RM-VANE-06", p: "1000", order: "PRD-1000255", type: "Production order", reqQty: 60, withdrawn: 0, offset: 22, finalIssue: false },
  { id: "0000045201/0020", m: "SA-HOUSING-10", p: "1000", order: "PRD-1000260", type: "Production order", reqQty: 6, withdrawn: 0, offset: 4, finalIssue: false },
  { id: "0000045301/0010", m: "RM-WIRE-15", p: "1200", order: "PRD-1200088", type: "Production order", reqQty: 150, withdrawn: 0, offset: 6, finalIssue: false },
  { id: "0000045318/0010", m: "RM-CONT-25A", p: "1200", order: "PRD-1200091", type: "Production order", reqQty: 15, withdrawn: 0, offset: 8, finalIssue: false },
  { id: "0000045310/0010", m: "RM-GEAR-Z28", p: "1100", order: "PRD-1100045", type: "Production order", reqQty: 30, withdrawn: 30, offset: -5, finalIssue: true },
];

/* Subcontracting orders. The vendor returns "material"; the components under "provided"
   are our stock physically sitting at the vendor (special stock O) — owned but not issuable
   at the plant until recalled. */
const SUBCON = [
  { doc: "4500011720", item: "10", plant: "1000",
    vendor: "Shreeji Machining Works", vendorCode: "V-10620",
    material: "SA-HOUSING-10", q: 25, received: 20,
    createdOffset: -14, offset: 7, mode: "MRP", createdBy: "MRP run 24 Aug",
    service: "Housing bore machining and facing",
    provided: [
      { code: "RM-CAST-001", qty: 26, consumed: 20 },
      { code: "RM-BOLT-M8", qty: 208, consumed: 165 },
    ] },

  { doc: "4500011745", item: "10", plant: "1000",
    vendor: "Precision Machining Works", vendorCode: "V-10655",
    material: "SA-ROTOR-20", q: 20, received: 0,
    createdOffset: -6, offset: 19, mode: "Manual", createdBy: "A. Kulkarni",
    service: "Rotor balancing and shaft press fit",
    provided: [
      { code: "RM-SHAFT-220", qty: 20, consumed: 0 },
      { code: "RM-BEAR-6204", qty: 40, consumed: 0 },
      { code: "RM-KEY-08", qty: 21, consumed: 0 },
    ] },

  { doc: "4500011688", item: "20", plant: "1000",
    vendor: "Aditya Engineering", vendorCode: "V-10702",
    material: "SA-IMPELLER-25", q: 15, received: 0,
    createdOffset: -25, offset: -4, mode: "Manual", createdBy: "S. Deshpande",
    service: "Vane insertion and dynamic balancing",
    provided: [
      { code: "RM-IMP-BLANK-05", qty: 16, consumed: 0 },
      { code: "RM-VANE-06", qty: 101, consumed: 0 },
    ] },

  { doc: "4500011540", item: "10", plant: "1100",
    vendor: "Chakan Precision Tools", vendorCode: "V-11080",
    material: "SA-CASE-30", q: 40, received: 40,
    createdOffset: -30, offset: -6, mode: "MRP", createdBy: "MRP run 08 Aug",
    service: "Gear case boring",
    provided: [
      { code: "RM-CAST-002", qty: 41, consumed: 41 },
      { code: "RM-BOLT-M8", qty: 492, consumed: 492 },
    ] },
];

/* Open purchase orders and stock transfer orders.
   openQty = ordered − received. "pegged" records quantities a previous MRP run already
   assigned to other dependent requirements — that quantity is not free for this order. */
const SUPPLY = [
  { doc: "4500011234", item: "10", type: "PO", m: "RM-SHAFT-220", p: "1000",
    vendor: "Sanghvi Forge Pvt Ltd", vendorCode: "V-10023",
    q: 25, received: 0, createdOffset: -12, offset: 6,
    mode: "MRP", createdBy: "MRP run 26 Aug",
    pegged: [{ order: "PRD-1000234", qty: 8, run: "MRP run 04 Sep" }] },

  { doc: "4500011290", item: "10", type: "PO", m: "RM-GASKET-88", p: "1000",
    vendor: "Perfect Seals India", vendorCode: "V-10188",
    q: 100, received: 0, createdOffset: -9, offset: 18,
    mode: "MRP", createdBy: "MRP run 29 Aug",
    pegged: [{ order: "PRD-1000239", qty: 45, run: "MRP run 04 Sep" }] },

  { doc: "4700005512", item: "10", type: "STO", m: "RM-CAST-001", p: "1000",
    vendor: "Plant 1100 Chakan", vendorCode: "1100",
    q: 30, received: 0, createdOffset: -5, offset: 3,
    mode: "MRP", createdBy: "MRP run 02 Sep",
    pegged: [{ order: "PRD-1000260", qty: 20, run: "MRP run 04 Sep" }] },

  { doc: "4500011512", item: "20", type: "PO", m: "RM-VANE-06", p: "1000",
    vendor: "Vane Tech Engineering", vendorCode: "V-10450",
    q: 150, received: 0, createdOffset: -6, offset: 8,
    mode: "MRP", createdBy: "MRP run 01 Sep",
    pegged: [{ order: "PRD-1000255", qty: 120, run: "MRP run 04 Sep" }] },

  { doc: "4500011188", item: "10", type: "PO", m: "RM-BEAR-6204", p: "1000",
    vendor: "SKF India Ltd", vendorCode: "V-10002",
    q: 200, received: 160, createdOffset: -34, offset: 16,
    mode: "Manual", createdBy: "R. Patil",
    pegged: [] },

  { doc: "4500011399", item: "10", type: "PO", m: "RM-OIL-SAE40", p: "1000",
    vendor: "Indo Lubricants", vendorCode: "V-10310",
    q: 400, received: 200, createdOffset: -20, offset: 12,
    mode: "Manual", createdBy: "S. Deshpande",
    pegged: [] },

  { doc: "4500011505", item: "30", type: "PO", m: "RM-FILTER-25", p: "1000",
    vendor: "Hydac Filters India", vendorCode: "V-10501",
    q: 60, received: 60, createdOffset: -25, offset: -3,
    mode: "MRP", createdBy: "MRP run 13 Aug",
    pegged: [] },

  { doc: "4500011601", item: "10", type: "PO", m: "RM-GEAR-Z28", p: "1100",
    vendor: "Precision Gears Pune", vendorCode: "V-11002",
    q: 300, received: 0, createdOffset: -3, offset: 20,
    mode: "MRP", createdBy: "MRP run 04 Sep",
    pegged: [] },

  { doc: "4500011455", item: "10", type: "PO", m: "RM-PLC-S71", p: "1200",
    vendor: "Siemens India Pvt Ltd", vendorCode: "V-20011",
    q: 15, received: 0, createdOffset: -40, offset: 30,
    mode: "MRP", createdBy: "MRP run 29 Jul",
    pegged: [{ order: "PRD-1200091", qty: 5, run: "MRP run 03 Sep" }] },

  { doc: "4500011460", item: "10", type: "PO", m: "RM-CONT-25A", p: "1200",
    vendor: "Schneider Electric India", vendorCode: "V-20044",
    q: 50, received: 0, createdOffset: -15, offset: 22,
    mode: "MRP", createdBy: "MRP run 23 Aug",
    pegged: [] },

  { doc: "4500011477", item: "10", type: "PO", m: "RM-TERM-BLK", p: "1200",
    vendor: "Phoenix Contact India", vendorCode: "V-20090",
    q: 1000, received: 400, createdOffset: -18, offset: 14,
    mode: "Manual", createdBy: "R. Krishnan",
    pegged: [] },
];

/* ============================================================
   HELPERS
   ============================================================ */

const DAY = 86400000;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const diffDays = (a, b) => Math.round((a.getTime() - b.getTime()) / DAY);
const toISO = (d) => d.toISOString().slice(0, 10);
const fmtDate = (d) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const fmtDateLong = (d) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/* Manual entry means a code may not exist in the material master */
const matInfo = (code) =>
  MATERIALS[code] || { desc: "Not found in the material master", uom: "EA", lead: 0, proc: "F", mrp: "—", missing: true };

/* Anything with a bill of material can be planned, not just finished goods */
const MATERIAL_OPTIONS = Object.keys(BOMS)
  .map((code) => ({
    code,
    desc: matInfo(code).desc,
    kind: FINISHED_GOODS.some((f) => f.code === code) ? "finished good" : "sub-assembly",
  }))
  .sort((a, b) => (a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === "finished good" ? -1 : 1));

const isDiscrete = (uom) => uom === "EA" || uom === "PC";
const roundQty = (q, uom) => (isDiscrete(uom) ? Math.ceil(q - 1e-9) : Math.round(q * 100) / 100);
const fmtQty = (q, uom) =>
  isDiscrete(uom)
    ? Math.round(q).toLocaleString("en-IN")
    : (Math.round(q * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const transitDays = (from, to) => TRANSIT[`${from}-${to}`] ?? 5;

// how many days late a confirmed order can realistically be pulled in
const PULL_IN_WINDOW = 10;

/* ============================================================
   AVAILABILITY ENGINE
   ============================================================ */

/* ============================================================
   SAP MAPPING

   Every dataset above is demo data shaped the way this engine wants it. In a live
   build the shape comes from SAP. SAP_SOURCES declares where each field comes from,
   and SAP_ADAPTERS are the functions that turn SAP-shaped rows into the internal
   shape — replace the demo constants with adapter output and nothing else changes.
   ============================================================ */

const SAP_SOURCES = [
  {
    area: "Material master", cds: "I_Product · I_ProductPlant · I_ProductDescription",
    target: "MATERIALS",
    tables: [
      { t: "MARA", text: "General material data", key: "MATNR" },
      { t: "MARC", text: "Plant data for material", key: "MATNR, WERKS" },
      { t: "MAKT", text: "Material descriptions", key: "MATNR, SPRAS" },
    ],
    fields: [
      ["code", "MARA-MATNR", "Material number"],
      ["desc", "MAKT-MAKTX", "Description in the logon language"],
      ["uom", "MARA-MEINS", "Base unit of measure"],
      ["proc", "MARC-BESKZ", "Procurement type: E in-house, F external, X both"],
      ["lead", "MARC-PLIFZ / MARC-DZEIT", "Planned delivery time for bought parts, in-house production time for made parts"],
      ["mrp", "MARC-DISPO", "MRP controller"],
    ],
    read: "BAPI_MATERIAL_GET_DETAIL · OData API_PRODUCT_SRV",
    tcode: "MM03",
  },
  {
    area: "Bill of material", cds: "I_BillOfMaterial · I_BillOfMaterialItem · I_BOMHeaderBasic",
    target: "BOMS",
    tables: [
      { t: "MAST", text: "Material to BOM link", key: "MATNR, WERKS, STLAN, STLNR, STLAL" },
      { t: "STKO", text: "BOM header", key: "STLNR, STLAL, STKOZ" },
      { t: "STPO", text: "BOM item", key: "STLNR, STLKN, STPOZ" },
    ],
    fields: [
      ["alternative key", "MAST-STLAL", "BOM alternative — the key under each material in BOMS"],
      ["usage", "MAST-STLAN", "BOM usage, 1 for production"],
      ["code", "STPO-IDNRK", "Component material"],
      ["qty", "STPO-MENGE / STKO-BMENG", "Component quantity per base quantity of the header"],
      ["scrap", "STPO-AUSCH", "Component scrap percentage"],
      ["(filter)", "STPO-POSTP", "Item category — L stock item, N non-stock, T text. Only stock items are exploded"],
      ["(filter)", "STPO-DATUV / STKO-DATUV", "Valid-from date; explode with the order date"],
    ],
    read: "CS_BOM_EXPL_MAT_V2 for a full explosion, or read MAST/STPO level by level",
    tcode: "CS03, CS11, CS12",
  },
  {
    area: "Production version", cds: "I_ProductionVersion",
    target: "PROD_VERSIONS",
    tables: [
      { t: "MKAL", text: "Production versions for material", key: "MATNR, WERKS, VERID" },
      { t: "MKAL_MDV", text: "Version, line and lot size detail", key: "MATNR, WERKS, VERID" },
    ],
    fields: [
      ["version", "MKAL-VERID", "Production version"],
      ["text", "MKAL-TEXT1", "Version description"],
      ["bom", "MKAL-STLAL", "BOM alternative this version explodes"],
      ["bomUsage", "MKAL-STLAN", "BOM usage"],
      ["routing", "MKAL-PLNNR", "Task list group"],
      ["counter", "MKAL-PLNAL", "Group counter"],
      ["lotFrom / lotTo", "MKAL-BSTMI / MKAL-BSTMA", "Lot size range the version is valid for"],
      ["validFrom / validTo", "MKAL-ADATU / MKAL-BDATU", "Validity period"],
      ["locked", "MKAL-MKSP", "Lock indicator; a locked version is skipped by selection"],
      ["line", "MKAL-SERKZ / MKAL-PLNNR text", "Production line or task list description"],
    ],
    read: "BAPI_PRODVERS_GETLIST · OData API_PRODUCTION_VERSION",
    tcode: "C223, MM03 MRP 4 view",
  },
  {
    area: "Plants and storage locations", cds: "I_Plant · I_StorageLocation",
    target: "PLANTS, SLOCS",
    tables: [
      { t: "T001W", text: "Plants", key: "WERKS" },
      { t: "T001L", text: "Storage locations", key: "WERKS, LGORT" },
    ],
    fields: [
      ["id / name", "T001W-WERKS / T001W-NAME1", "Plant"],
      ["code / name", "T001L-LGORT / T001L-LGOBE", "Storage location"],
      ["type", "derived", "Stock type is not on T001L — classify by how the location is used, or read the stock category from MARD"],
    ],
    read: "Direct table read, small and static",
    tcode: "OX10, OX09",
  },
  {
    area: "Stock by storage location", cds: "I_MaterialStock · C_MaterialStockActualQuantity (MATDOC)",
    target: "STOCK",
    tables: [
      { t: "MARD", text: "Storage location stock", key: "MATNR, WERKS, LGORT" },
      { t: "MCHB", text: "Batch stock, if batch managed", key: "MATNR, WERKS, LGORT, CHARG" },
    ],
    fields: [
      ["q (unrestricted)", "MARD-LABST", "Unrestricted-use stock"],
      ["q (quality)", "MARD-INSME", "Stock in quality inspection"],
      ["q (blocked)", "MARD-SPEME", "Blocked stock"],
      ["q (restricted)", "MARD-EINME", "Restricted-use stock"],
      ["q (in transit)", "MARC-UMLMC / MSLB", "Stock in transfer between plants"],
    ],
    read: "BAPI_MATERIAL_AVAILABILITY for ATP · BAPI_MATERIAL_STOCK_REQ_LIST for the MD04 picture",
    tcode: "MMBE, MB52, MD04",
  },
  {
    area: "Batch stock",
    cds: "I_BatchStock · I_Batch · I_MaterialStock with Batch",
    target: "BATCHES, BATCH_MANAGED",
    tables: [
      { t: "MCHB", text: "Batch stock by storage location", key: "MATNR, WERKS, LGORT, CHARG" },
      { t: "MCHA", text: "Batch master by plant", key: "MATNR, WERKS, CHARG" },
      { t: "MCH1", text: "Batch master, cross plant", key: "MATNR, CHARG" },
      { t: "MARA", text: "Batch management indicator", key: "MATNR" },
    ],
    fields: [
      ["(is batch managed)", "MARA-XCHPF / MARC-XCHPF", "Only materials with this set have batch records; everything else stays at location level"],
      ["batch", "MCHB-CHARG", "Batch number"],
      ["qty", "MCHB-CLABS / CINSM / CSPEM", "Unrestricted, in inspection and blocked batch stock"],
      ["status", "MCHA-ZUSTD", "Batch status: unrestricted or restricted"],
      ["expOffset", "MCHA-VFDAT", "Shelf life expiry date"],
      ["mfgOffset", "MCHA-HSDAT", "Date of manufacture"],
      ["vendorBatch", "MCHA-LICHA", "Vendor batch number"],
    ],
    read: "BAPI_MATERIAL_AVAILABILITY at batch level, or read MCHB joined to MCHA",
    tcode: "MMBE, MB56, MSC3",
    note: "For a batch managed material the batch quantities must add up to MARD. If they do not, availability will disagree with MMBE. A material flagged batch managed with stock but no MCHB rows is an extract gap, not an empty store.",
  },
  {
    area: "Stock at subcontractor", cds: "I_MaterialStock with SpecialStockType = O",
    target: "SUBCON.provided",
    tables: [
      { t: "MSLB", text: "Special stock with vendor", key: "MATNR, WERKS, LIFNR, SOBKZ" },
    ],
    fields: [
      ["qty at vendor", "MSLB-LBLAB", "Unrestricted special stock held at the vendor"],
      ["vendor", "MSLB-LIFNR", "Vendor holding the stock"],
      ["special stock indicator", "MSLB-SOBKZ = O", "Material provided to vendor"],
    ],
    read: "Read MSLB per vendor, or the components tab of the subcontracting PO",
    tcode: "MBLB, ME2O",
  },
  {
    area: "Open reservations", cds: "I_ReservationDocumentItem",
    target: "RESERVATIONS",
    tables: [
      { t: "RESB", text: "Reservation and dependent requirements", key: "RSNUM, RSPOS, RSART" },
    ],
    fields: [
      ["id", "RESB-RSNUM / RESB-RSPOS", "Reservation number and item"],
      ["m / p", "RESB-MATNR / RESB-WERKS", "Material and plant"],
      ["reqQty", "RESB-BDMNG", "Requirement quantity"],
      ["withdrawn", "RESB-ENMNG", "Quantity already withdrawn"],
      ["offset", "RESB-BDTER", "Requirement date"],
      ["finalIssue", "RESB-KZEAR", "Final issue indicator — the item is closed"],
      ["order", "RESB-AUFNR", "Order the reservation belongs to"],
      ["(filter)", "RESB-XLOEK", "Deletion indicator — exclude deleted items"],
      ["(filter)", "RESB-XWAOK", "Goods movement allowed"],
    ],
    read: "BAPI_RESERVATION_GETDETAIL, or read RESB by MATNR and WERKS",
    tcode: "MB25, CO03 component overview",
  },
  {
    area: "Production orders and statuses", cds: "I_ManufacturingOrder · I_ManufacturingOrderItem · I_ManufacturingOrderStatus",
    target: "PROD_ORDERS",
    tables: [
      { t: "AUFK", text: "Order master", key: "AUFNR" },
      { t: "AFKO", text: "Order header, production", key: "AUFNR" },
      { t: "AFPO", text: "Order item", key: "AUFNR, POSNR" },
      { t: "JEST + TJ02T", text: "Object status and status texts", key: "OBJNR, STAT" },
      { t: "AFRU", text: "Confirmations", key: "RUECK, RMZHL" },
    ],
    fields: [
      ["order", "AUFK-AUFNR", "Order number"],
      ["type", "AUFK-AUART", "Order type"],
      ["plant", "AUFK-WERKS", "Plant"],
      ["createdOffset / createdBy", "AUFK-ERDAT / AUFK-ERNAM", "Creation date and user"],
      ["material", "AFKO-PLNBEZ", "Material being produced"],
      ["qty", "AFKO-GAMNG", "Total order quantity"],
      ["delivered", "AFPO-WEMNG", "Quantity delivered to stock"],
      ["confirmed", "AFRU-LMNGA (summed)", "Yield confirmed"],
      ["startOffset / finishOffset", "AFKO-GSTRP / AFKO-GLTRP", "Basic start and finish dates"],
      ["mrp", "AFKO-DISPO", "MRP controller"],
      ["status", "JEST-STAT via TJ02T-TXT04", "System statuses: CRTD, REL, PRT, MSPT, PCNF, CNF, DLV, GMPS, TECO. JEST-INACT = X means the status is not active"],
    ],
    read: "BAPI_PRODORD_GET_DETAIL · BAPI_PRODORD_GET_LIST · STATUS_READ for statuses",
    tcode: "CO03, COOIS, COHV",
  },
  {
    area: "Purchase orders and stock transfer orders", cds: "I_PurchaseOrderAPI01 · I_PurchaseOrderItemAPI01 · I_PurOrdScheduleLine · I_PurchaseOrderHistory",
    target: "SUPPLY",
    tables: [
      { t: "EKKO", text: "Purchasing document header", key: "EBELN" },
      { t: "EKPO", text: "Purchasing document item", key: "EBELN, EBELP" },
      { t: "EKET", text: "Schedule lines", key: "EBELN, EBELP, ETENR" },
      { t: "EKBE", text: "Purchase order history", key: "EBELN, EBELP, ZEKKN, VGABE" },
      { t: "LFA1", text: "Vendor master", key: "LIFNR" },
    ],
    fields: [
      ["doc / item", "EKPO-EBELN / EKPO-EBELP", "Document and item"],
      ["type", "EKKO-BSART", "Document type — distinguishes a PO from a UB stock transfer order"],
      ["vendor / vendorCode", "LFA1-NAME1 / EKKO-LIFNR", "Vendor. For an STO read the supplying plant from EKPO-RESWK"],
      ["createdOffset / createdBy", "EKKO-AEDAT / EKKO-ERNAM", "Creation date and user"],
      ["mode", "EKPO-ESTKZ", "Creation indicator: B from a purchase requisition raised by MRP, blank when entered manually"],
      ["q", "EKPO-MENGE", "Ordered quantity"],
      ["received", "EKBE-MENGE where VGABE = 1", "Goods receipt quantity, net of reversals via EKBE-SHKZG"],
      ["offset", "EKET-EINDT", "Delivery date on the schedule line"],
      ["pegged", "see MRP pegging below", "Not a PO field — comes from the requirement assignment"],
      ["(subcontracting)", "EKPO-PSTYP = 3", "Item category L: a subcontracting item"],
    ],
    read: "BAPI_PO_GETDETAIL1 · OData API_PURCHASEORDER_PROCESS_SRV",
    tcode: "ME23N, ME2M, ME2O, ME80FN",
  },
  {
    area: "MRP pegging", cds: "C_MRPMaterialStockRequirement · I_MRPMaterialFlow",
    target: "SUPPLY.pegged",
    tables: [
      { t: "MDPSX / MDEZX", text: "MRP list and stock requirements list, read into memory", key: "MATNR, WERKS" },
      { t: "MDKP", text: "MRP document header", key: "DTART, MATNR, PLWRK" },
    ],
    fields: [
      ["pegged.order", "MDPSX-DELNR / order report", "The requirement a receipt is assigned to"],
      ["pegged.qty", "MDPSX-MNG01", "Quantity assigned"],
      ["pegged.run", "MDKP-DSDAT", "Date of the MRP run that produced the assignment"],
    ],
    read: "BAPI_MATERIAL_STOCK_REQ_LIST returns the MD04 lines; the order report behind MD09 gives the pegged relationship",
    tcode: "MD04, MD05, MD09",
    note: "Pegging is not stored as a field on the purchase order. It is the result of the last MRP run and changes every run, so extract it with the same timestamp as the rest of the data.",
  },
  {
    area: "Sales orders",
    cds: "I_SalesOrderItem · I_SalesOrderScheduleLine · C_SalesOrderItemCube",
    target: "SALES_ORDERS",
    tables: [
      { t: "VBAK", text: "Sales document header", key: "VBELN" },
      { t: "VBAP", text: "Sales document item", key: "VBELN, POSNR" },
      { t: "VBEP", text: "Schedule lines", key: "VBELN, POSNR, ETENR" },
      { t: "VBBE", text: "Sales requirements", key: "MATNR, WERKS, VBELN" },
      { t: "KNA1", text: "Customer master", key: "KUNNR" },
    ],
    fields: [
      ["doc / item", "VBAP-VBELN / VBAP-POSNR", "Order and item"],
      ["m / p", "VBAP-MATNR / VBAP-WERKS", "Material and delivering plant"],
      ["qty", "VBEP-WMENG", "Requested quantity on the schedule line"],
      ["confirmed", "VBEP-BMENG", "Confirmed quantity after ATP"],
      ["reqOffset", "VBEP-EDATU / VBEP-MBDAT", "Requested delivery date, and material availability date"],
      ["customer / soldTo", "KNA1-NAME1 / VBAK-KUNNR", "Sold-to party"],
      ["(filter)", "VBUP-LFSTA", "Delivery status — exclude fully delivered items"],
    ],
    read: "BAPI_SALESORDER_GETLIST · OData API_SALES_ORDER_SRV",
    tcode: "VA03, VA05, CO09",
    note: "VBBE holds the open sales requirement MRP actually sees. Reading VBAP alone will include lines already delivered.",
  },
  {
    area: "Backward scheduling",
    cds: "I_Route · I_ShippingPoint · I_ProductPlant (SchedulingMarginKey)",
    target: "SHIP_POINTS, SCHED_MARGIN, backwardSchedule()",
    tables: [
      { t: "TVRO", text: "Route, holds transit time", key: "ROUTE" },
      { t: "TVST", text: "Shipping point, loading and pick/pack time", key: "VSTEL" },
      { t: "T436A", text: "Scheduling margin key", key: "WERKS, FHORI" },
      { t: "MARC", text: "Margin key and in-house time on the material", key: "MATNR, WERKS" },
      { t: "TFACD / TFACS", text: "Factory calendar", key: "IDENT" },
    ],
    fields: [
      ["transit", "TVRO-TRAZTD", "Transit time on the route determined for the ship-to party"],
      ["loading", "TVST-VSTEL loading time", "Loading time at the shipping point"],
      ["pickPack", "TVST-VSTEL pick/pack time", "Picking and packing time at the shipping point"],
      ["floatAfter", "T436A-SICHZ", "Float after production, the safety buffer before material availability"],
      ["floatBefore", "T436A-VORGZ", "Float before production, buffer between release and start"],
      ["opening", "T436A-EROEF", "Opening period — how early the planned order is created"],
      ["marginKey", "MARC-FHORI", "Scheduling margin key assigned to the material and plant"],
      ["inHouse", "MARC-DZEIT, or PLPO standard values", "Lot-size independent time, or the routing for a lot-dependent one"],
      ["(calendar)", "T001W-FABKL", "Factory calendar on the plant — replaces the weekday rule used here"],
    ],
    read: "Scheduling is done by SAP itself. Read the dates off the order: PLAF-PSTTR/PEDTR, AFKO-GSTRP/GLTRP, VBEP-MBDAT/WADAT",
    tcode: "OVLZ, OPU5, OPJK, MD04",
    note: "Prefer taking the scheduled dates off the planned or production order rather than recalculating them. Recalculating is only for lines that do not exist yet, which is exactly what this input screen does.",
  },
  {
    area: "Outbound deliveries",
    cds: "I_DeliveryDocument · I_DeliveryDocumentItem · I_OutbDeliveryItem",
    target: "DELIVERIES",
    tables: [
      { t: "LIKP", text: "Delivery header", key: "VBELN" },
      { t: "LIPS", text: "Delivery item", key: "VBELN, POSNR" },
      { t: "VBUK / VBUP", text: "Header and item status", key: "VBELN, POSNR" },
    ],
    fields: [
      ["doc / item", "LIPS-VBELN / LIPS-POSNR", "Delivery and item"],
      ["m / p", "LIPS-MATNR / LIPS-WERKS", "Material and issuing plant"],
      ["qty", "LIPS-LFIMG", "Delivery quantity"],
      ["offset", "LIKP-WADAT_IST / LIKP-WADAT", "Actual goods issue date, else the planned one"],
      ["gi", "VBUK-WBSTK = C", "Goods issue posted — the stock has left the plant"],
      ["so", "LIPS-VGBEL / LIPS-VGPOS", "Sales order and item the delivery came from"],
      ["customer", "LIKP-KUNNR via KNA1-NAME1", "Ship-to party"],
    ],
    read: "BAPI_OUTB_DELIVERY_GETLIST · OData API_OUTBOUND_DELIVERY_SRV",
    tcode: "VL03N, VL06O",
    note: "Dispatch on this screen is goods issue posted, movement type 601, not delivery creation. A delivery created but not issued is still sitting in the plant.",
  },
  {
    area: "Planned independent requirements",
    cds: "I_PlndIndepRqmt · I_PlndIndepRqmtItem",
    target: "PIR",
    tables: [
      { t: "PBIM", text: "Independent requirements by material", key: "MATNR, WERKS, BEDAE, VERSB" },
      { t: "PBED", text: "Independent requirement periods", key: "BDZEI" },
    ],
    fields: [
      ["m / p", "PBIM-MATNR / PBIM-WERKS", "Material and plant"],
      ["version", "PBIM-VERSB", "Requirements version; only active versions are relevant"],
      ["qty", "PBED-PLNMG", "Planned quantity for the period"],
      ["withdrawn", "PBED-VERBR", "Quantity already consumed by sales orders"],
      ["offset", "PBED-PDATU", "Requirement date"],
    ],
    read: "BAPI_REQUIREMENTS_GETDETAIL · OData API_PLND_INDEP_RQMT_SRV",
    tcode: "MD63, MD73",
    note: "Forecast still to be consumed is PLNMG minus VERBR. Adding the full PLNMG double counts demand that sales orders already cover.",
  },
  {
    area: "Planned orders",
    cds: "I_PlannedOrder",
    target: "PLANNED_ORDERS",
    tables: [
      { t: "PLAF", text: "Planned order", key: "PLNUM" },
    ],
    fields: [
      ["order", "PLAF-PLNUM", "Planned order number"],
      ["m / p", "PLAF-MATNR / PLAF-PLWRK", "Material and planning plant"],
      ["qty", "PLAF-GSMNG", "Total planned quantity"],
      ["startOffset / finishOffset", "PLAF-PSTTR / PLAF-PEDTR", "Order start and finish dates"],
      ["opening", "PLAF-PERTR", "Opening date — the day it must be converted to stay on time"],
      ["firmed", "PLAF-STLFX / PLAF-KZFIX", "Firming indicator; unfirmed orders are rebuilt by the next MRP run"],
      ["wc", "PLAF-VERID via MKAL", "Line comes from the production version on the planned order"],
    ],
    read: "BAPI_PLANNEDORDER_GET_DETAIL · OData API_PLANNED_ORDER",
    tcode: "MD04, MD12, MD16",
    note: "An unfirmed planned order whose opening date has passed is the single most common cause of a late order. It looks fine on MD04 until MRP deletes and re-creates it.",
  },
  {
    area: "Work centres and capacity",
    cds: "I_WorkCenter · I_WorkCenterCapacity · C_CapacityRequirement",
    target: "WORK_CENTRES",
    tables: [
      { t: "CRHD", text: "Work centre header", key: "OBJTY, OBJID" },
      { t: "CRCA", text: "Work centre to capacity link", key: "OBJTY, OBJID, KAPID" },
      { t: "KAKO", text: "Capacity header", key: "KAPID" },
      { t: "KBED", text: "Capacity requirements", key: "BEDID, KAPID" },
      { t: "AFVC / AFVV", text: "Order operation and quantities", key: "AUFPL, APLZL" },
    ],
    fields: [
      ["id / desc", "CRHD-ARBPL / CRTX-KTEXT", "Work centre and description"],
      ["plant", "CRHD-WERKS", "Plant"],
      ["grossPerWeek", "KAKO-BEGZT, ENDZT, PAUSE, AANZK", "Shift start, end, break and number of individual capacities"],
      ["util", "KAKO-NGRAD", "Capacity utilisation rate"],
      ["load", "KBED-KAPBED / AFVV-BEARZ", "Capacity requirement per operation, in the operation unit"],
      ["(off line)", "KAKO-KAPTPR shift sequence, or an available capacity version", "A work centre taken off line for maintenance or an unmanned shift. Marked by hand on the capacity screen here"],
      ["hoursPer", "AFVV-VGW01..VGW06 / PLPO", "Standard values on the routing operation"],
    ],
    read: "BAPI_WORKCENTER_GETLIST · CM01/CM50 evaluations · OData API_WORKCENTER",
    tcode: "CR03, CM01, CM50, CM25",
    note: "Available capacity is not a stored number. It is derived from the shift definition on KAKO less breaks, times the number of individual capacities, times the utilisation rate.",
  },
  {
    area: "Consumption history",
    cds: "I_MaterialConsumption · I_ProductConsumption · C_MaterialConsumptionQry",
    target: "CONSUMPTION",
    tables: [
      { t: "MVER", text: "Material consumption by period", key: "MATNR, WERKS, GJAHR, PERKZ" },
      { t: "MARC", text: "Period indicator and consumption relevance", key: "MATNR, WERKS" },
      { t: "MSEG", text: "The movements behind the totals", key: "MBLNR, MJAHR, ZEILE" },
    ],
    fields: [
      ["total[]", "MVER-GSV01 … GSV12", "Total consumption per period. Which index is which month depends on the fiscal year variant, not the calendar"],
      ["unplanned[]", "MVER-GSU01 … GSU12", "Unplanned consumption — issues with no order reference behind them"],
      ["(period type)", "MARC-PERKZ", "M monthly, W weekly, P posting period. The array length follows this"],
      ["(year)", "MVER-GJAHR", "One record per material, plant and year; twelve periods needs two records"],
      ["(detail)", "MSEG-BWART in 261, 262, 201, 543", "Movement level detail, retained for a shorter window than MVER"],
    ],
    read: "Read MVER directly, or I_MaterialConsumption on S/4HANA",
    tcode: "MM03 forecasting view, MC.9, MCBA",
    note: "MVER periods follow the fiscal year variant on the company code, so period 01 is not necessarily January. Map them through T009B before charting, or the history will be shifted.",
  },
  {
    area: "Goods movements", cds: "I_MaterialDocumentHeader · I_MaterialDocumentItem",
    target: "GOODS_MVT",
    tables: [
      { t: "MKPF", text: "Material document header", key: "MBLNR, MJAHR" },
      { t: "MSEG", text: "Material document item", key: "MBLNR, MJAHR, ZEILE" },
      { t: "T156T", text: "Movement type texts", key: "BWART, SPRAS" },
    ],
    fields: [
      ["doc / item", "MSEG-MBLNR / MSEG-ZEILE", "Material document and item"],
      ["offset", "MKPF-BUDAT", "Posting date"],
      ["user", "MKPF-USNAM", "User who posted"],
      ["mvt", "MSEG-BWART", "Movement type: 101 receipt, 261 issue to order, 262 reversal, 311 transfer, 541 to subcontractor, 543 consumption at subcontractor"],
      ["m / p / sloc", "MSEG-MATNR / WERKS / LGORT", "Material, plant, storage location"],
      ["qty", "MSEG-MENGE", "Quantity, with MSEG-SHKZG giving the sign: S debit, H credit"],
      ["ref", "MSEG-AUFNR / MSEG-EBELN", "Order or purchase order the movement is against"],
    ],
    read: "BAPI_MATERIAL_DOCUMENT_LIST · OData API_MATERIAL_DOCUMENT_SRV",
    tcode: "MB51, MIGO",
  },
];

/* Adapters. Each takes rows in SAP field names and returns the internal shape. */
const dayOffset = (d, today) => Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / DAY);

const SAP_ADAPTERS = {
  /* MARA + MARC + MAKT joined on MATNR (and WERKS for MARC) */
  materials(rows) {
    const out = {};
    for (const r of rows) {
      out[r.MATNR] = {
        desc: r.MAKTX,
        uom: r.MEINS,
        proc: r.BESKZ,
        lead: r.BESKZ === "E" ? Number(r.DZEIT || 0) : Number(r.PLIFZ || 0),
        mrp: r.DISPO,
      };
    }
    return out;
  },

  /* MAST joined to STPO. Only stock items (POSTP = L) are exploded. */
  boms(rows) {
    const out = {};
    for (const r of rows) {
      if (r.POSTP && r.POSTP !== "L") continue;
      const alt = String(r.STLAL || "1");
      out[r.MATNR] = out[r.MATNR] || {};
      out[r.MATNR][alt] = out[r.MATNR][alt] || [];
      out[r.MATNR][alt].push({
        code: r.IDNRK,
        qty: Number(r.MENGE) / Number(r.BMENG || 1),
        scrap: Number(r.AUSCH || 0),
      });
    }
    return out;
  },

  /* MKAL */
  productionVersions(rows, today) {
    const out = {};
    for (const r of rows) {
      out[r.MATNR] = out[r.MATNR] || [];
      out[r.MATNR].push({
        version: r.VERID,
        text: r.TEXT1,
        bom: String(r.STLAL || "1"),
        bomUsage: String(r.STLAN || "1"),
        routing: r.PLNNR,
        counter: r.PLNAL,
        line: r.LINE_TEXT || r.PLNNR,
        lotFrom: Number(r.BSTMI || 0),
        lotTo: Number(r.BSTMA || 9999999),
        validFrom: dayOffset(r.ADATU, today),
        validTo: dayOffset(r.BDATU, today),
        locked: r.MKSP === "X" || r.MKSP === "1",
      });
    }
    return out;
  },

  /* MARD, split into one row per stock category so exclusion works per location */
  stock(rows, slocOf) {
    const out = [];
    const push = (r, q, cat) => { if (Number(q) > 0) out.push({ m: r.MATNR, p: r.WERKS, s: slocOf ? slocOf(r.LGORT, cat) : r.LGORT, q: Number(q) }); };
    for (const r of rows) {
      push(r, r.LABST, "unrestricted");
      push(r, r.INSME, "quality");
      push(r, r.SPEME, "blocked");
      push(r, r.EINME, "restricted");
    }
    return out;
  },

  /* RESB. Deleted items and items with no open quantity are dropped by the engine. */
  reservations(rows, today) {
    return rows
      .filter((r) => r.XLOEK !== "X")
      .map((r) => ({
        id: `${r.RSNUM}/${String(r.RSPOS).padStart(4, "0")}`,
        m: r.MATNR,
        p: r.WERKS,
        order: r.AUFNR,
        type: "Production order",
        reqQty: Number(r.BDMNG || 0),
        withdrawn: Number(r.ENMNG || 0),
        offset: dayOffset(r.BDTER, today),
        finalIssue: r.KZEAR === "X",
      }));
  },

  /* AUFK + AFKO + AFPO, with active statuses from JEST/TJ02T already resolved to codes */
  productionOrders(rows, today) {
    return rows.map((r) => ({
      order: r.AUFNR,
      plant: r.WERKS,
      material: r.PLNBEZ,
      type: r.AUART,
      mrp: r.DISPO,
      qty: Number(r.GAMNG || 0),
      delivered: Number(r.WEMNG || 0),
      confirmed: Number(r.LMNGA || 0),
      createdOffset: dayOffset(r.ERDAT, today),
      startOffset: dayOffset(r.GSTRP, today),
      finishOffset: dayOffset(r.GLTRP, today),
      mode: r.ERNAM && /^(RMMRP|MRP)/i.test(r.ERNAM) ? "MRP" : "Manual",
      createdBy: r.ERNAM,
      status: r.STATUS || [],
    }));
  },

  /* EKKO + EKPO + EKET + EKBE + LFA1. Subcontracting items (PSTYP 3) are split out. */
  purchaseOrders(rows, today) {
    const po = [], sc = [];
    for (const r of rows) {
      const received = (r.HISTORY || [])
        .filter((h) => String(h.VGABE) === "1")
        .reduce((a, h) => a + (h.SHKZG === "H" ? -Number(h.MENGE) : Number(h.MENGE)), 0);
      const base = {
        doc: r.EBELN,
        item: String(r.EBELP),
        vendor: r.NAME1 || (r.RESWK ? `Plant ${r.RESWK}` : r.LIFNR),
        vendorCode: r.LIFNR || r.RESWK,
        q: Number(r.MENGE || 0),
        received,
        createdOffset: dayOffset(r.AEDAT, today),
        offset: dayOffset(r.EINDT, today),
        mode: r.ESTKZ === "B" ? "MRP" : "Manual",
        createdBy: r.ERNAM,
        pegged: r.PEGGED || [],
      };
      if (String(r.PSTYP) === "3") {
        sc.push({
          ...base,
          plant: r.WERKS,
          material: r.MATNR,
          service: r.TXZ01,
          provided: (r.COMPONENTS || []).map((c) => ({
            code: c.MATNR,
            qty: Number(c.BDMNG || 0),
            consumed: Number(c.ENMNG || 0),
          })),
        });
      } else {
        po.push({ ...base, type: r.BSART === "UB" ? "STO" : "PO", m: r.MATNR, p: r.WERKS });
      }
    }
    return { supply: po, subcon: sc };
  },

  /* MKPF + MSEG */
  goodsMovements(rows, today) {
    return rows.map((r) => ({
      doc: r.MBLNR,
      item: String(r.ZEILE),
      p: r.WERKS,
      offset: dayOffset(r.BUDAT, today),
      mvt: String(r.BWART),
      ref: r.AUFNR || r.EBELN || "",
      refType: r.AUFNR ? "PRD" : String(r.PSTYP) === "3" ? "SC" : "PO",
      m: r.MATNR,
      qty: Number(r.MENGE || 0),
      sloc: r.LGORT || "",
      user: r.USNAM,
    }));
  },
};

/* ============================================================
   SUMMARY

   Pulls one reading from every screen and ranks what is wrong. This is
   arithmetic, not narrative — the briefing written on top of it can be
   wrong or unavailable and the planner still has the numbers.
   ============================================================ */

const SEV = { critical: 0, warning: 1, watch: 2 };

function summarise({ programme, contended, projectionSet, capacityAll, risk, consumption, shopFloor, commitments, subcon, flow, t0, weeks }) {
  const issues = [];
  const add = (sev, area, screen, headline, detail) => issues.push({ sev, area, screen, headline, detail });
  /* One row per root cause, not one per material — a list of seven components with the
     same underlying problem is one finding, and the names belong in the detail. */
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const days = (n) => `${n} day${n === 1 ? "" : "s"}`;
  const group = (sev, area, screen, headline, items, tail) => {
    if (!items.length) return;
    const shown = items.slice(0, 6);
    add(sev, area, screen, headline,
      `${shown.join("; ")}${items.length > shown.length ? `; and ${items.length - shown.length} more` : ""}.${tail ? ` ${tail}` : ""}`);
  };

  // --- the run itself: always line by line, there are only ever a handful
  for (const L of programme.lines) {
    if (!L.master.ok) {
      add("critical", "Planning run", "run", `Line ${L.seq} cannot be exploded`,
        `${L.fg} ${L.master.known ? "has no bill of material" : "is not in the material master"}.`);
      continue;
    }
    const blocked = L.result.verdict === "blocked";
    const pastOrder = L.schedule && L.schedule.orderBy < t0;
    if (pastOrder || L.startsInPast || blocked) {
      const bits = [];
      if (pastOrder) bits.push(`the order had to be created by ${fmtDate(L.schedule.orderBy)} to deliver on ${fmtDate(L.delivery)}`);
      else if (L.startsInPast) bits.push(`production should have started ${fmtDate(L.needBy)}, ${diffDays(t0, L.needBy)} days ago`);
      if (blocked) {
        const c = L.result.critical;
        bits.push(`${L.result.lateLines.length} component${L.result.lateLines.length === 1 ? "" : "s"} cannot be covered in time${c ? `, with ${c.code} setting the kit date at ${fmtDate(L.result.fullKit)}` : ""}`);
      }
      add("critical", "Planning run", blocked ? "shortages" : "run",
        `Line ${L.seq} ${L.fg}${L.so ? ` for ${L.so.doc}/${L.so.item}` : ""} will not make its date`,
        `${bits.join(", and ").replace(/^./, (m) => m.toUpperCase())}. Either it starts late or the customer date moves.`);
    } else if (L.result.shortLines.length) {
      add("warning", "Planning run", "shortages", `Line ${L.seq} ${L.fg} is short but recoverable`,
        `${L.result.shortLines.length} components short, all closable by ${fmtDate(L.result.fullKit)} if the actions start now.`);
    }
    if (L.pv && L.pv.warn) add("warning", "Production version", "components", `Version issue on line ${L.seq}`, L.pv.warn);
  }

  // --- projected stock: finished goods individually, components rolled up
  const negFG = projectionSet.filter((d) => d.status === "late" && FINISHED_GOODS.some((f) => f.code === d.mat));
  const negComp = projectionSet.filter((d) => d.status === "late" && !FINISHED_GOODS.some((f) => f.code === d.mat));
  for (const d of negFG) {
    add("critical", "Demand and supply", "demand", `${d.mat} runs out in ${d.firstShort.label}`,
      `Projected stock reaches ${fmtQty(d.firstShort.closing, d.uom)} ${d.uom} at plant ${d.plant} in the week of ${d.firstShort.date}. Anything promised after that has nothing behind it.`);
  }
  group("warning", "Demand and supply", "demand",
    `${plural(negComp.length, "component goes", "components go")} negative inside the horizon`,
    negComp.map((d) => `${d.mat} from ${d.firstShort.label}`),
    "These are the same gaps the readiness check reports, seen across the whole horizon rather than one order.");
  group("watch", "Demand and supply", "demand",
    `${plural(projectionSet.filter((d) => d.status === "risk").length, "material drops", "materials drop")} under safety stock`,
    projectionSet.filter((d) => d.status === "risk").map((d) => `${d.mat} from ${d.firstBreach.label}`),
    "Covered, but with no buffer for a late receipt.");

  // --- capacity
  for (const c of capacityAll.filter((x) => x.unavailable && x.strandedHours > 0)) {
    add("critical", "Capacity", "capacity", `${c.id} is marked off line with work still booked on it`,
      `${c.strandedHours} hours of committed and planned work sit on a centre that has no available capacity. It has to move to another centre or the dates move.`);
  }
  for (const c of capacityAll.filter((x) => x.totalOver > 0 && !x.unavailable)) {
    add("warning", "Capacity", "capacity", `${c.id} is over capacity in ${c.overWeeks.map((w) => w.label).join(", ")}`,
      `${c.totalOver} hours beyond the ${c.avail} available, peaking at ${c.peak}%. ${c.drivers.length ? `Largest job is ${c.drivers[0].ref} (${c.drivers[0].material}, ${c.drivers[0].hours} h).` : ""}`);
  }

  // --- customers, worst first
  const late = [...risk.filter((r) => !r.covered)].sort((a, b) => (b.lateDays ?? 999) - (a.lateDays ?? 999));
  for (const r of late.slice(0, 4)) {
    add(r.lateDays === null || r.lateDays > 14 ? "critical" : "warning", "Delivery", "sales",
      `${r.doc}/${r.item} ${r.customer} will miss ${fmtDate(r.req)}`,
      `${fmtQty(r.qty, r.uom)} ${r.uom} of ${r.material}. ${r.expected ? `Achievable ${fmtDate(r.expected)}, ${r.lateDays} days late.` : "No date inside the horizon."} ${r.cause}.`);
  }
  if (late.length > 4) {
    group("warning", "Delivery", "sales", `${late.length - 4} further order lines will also miss their date`,
      late.slice(4).map((r) => `${r.doc}/${r.item} ${r.material} on ${fmtDate(r.req)}`));
  }

  // --- contention between lines
  const starved = contended.filter((c) => c.starved > 0);
  group("warning", "Contention", "contention",
    `${plural(starved.length, "shared component runs", "shared components run")} out before every line is covered`,
    starved.map((c) => `${c.code}, ${fmtQty(c.onHand, c.uom)} on hand against ${fmtQty(c.totalRequired, c.uom)} needed`),
    "Reordering the run changes who gets them.");

  // --- consumption: one row per kind of problem
  const exposed = consumption.filter((c) => c.exposed);
  group("warning", "Consumption", "consumption",
    `${plural(exposed.length, "component carries", "components carry")} less cover than the time it takes to replace`,
    exposed.map((c) => `${c.mat}, ${days(c.coverDays)} of cover against a ${c.lead} day lead time`),
    "A replenishment ordered today arrives after the stock runs out.");
  const dead = consumption.filter((c) => c.idle >= 3);
  for (const c of dead) {
    add("watch", "Consumption", "consumption", `${c.mat} has not moved for ${c.idle} months`,
      `${fmtQty(c.onHand, c.uom)} ${c.uom} sitting still. Check whether it is still in a live bill of material.`);
  }
  const settings = consumption.filter((c) => !c.exposed && c.idle < 3 && c.flags.length);
  group("watch", "Consumption", "consumption",
    `${plural(settings.length, "material has", "materials have")} usage that does not match the settings`,
    settings.map((c) => `${c.mat}: ${c.flags[0].text.replace(/\.$/, "")}`));

  // --- what is already late on the floor and in purchasing
  const mspt = shopFloor.orders.filter((o) => !o.complete && o.missingParts);
  group("warning", "Shop floor", "prod", `${mspt.length} order${mspt.length === 1 ? " is" : "s are"} flagged missing parts`,
    mspt.map((o) => `${o.order} (${o.material})`));
  const lateOrders = shopFloor.orders.filter((o) => o.late);
  group("warning", "Shop floor", "prod", `${lateOrders.length} order${lateOrders.length === 1 ? " is" : "s are"} past the finish date`,
    lateOrders.map((o) => `${o.order} due ${fmtDate(o.finish)}`));
  const seenDoc = new Set();
  const overdue = [];
  for (const x of commitments.supply.filter((s) => s.overdue)) {
    if (seenDoc.has(x.doc)) continue; seenDoc.add(x.doc);
    overdue.push(`${x.type === "SC" ? "subcontracting order " : ""}${x.doc} ${x.m} from ${x.vendor}, ${days(diffDays(t0, x.date))} late`);
  }
  for (const x of subcon.orders.filter((s) => s.overdue)) {
    if (seenDoc.has(x.doc)) continue; seenDoc.add(x.doc);
    overdue.push(`subcontracting order ${x.doc} at ${x.vendor}, ${days(diffDays(t0, x.date))} late`);
  }
  group("warning", "Purchasing", "orders", `${plural(overdue.length, "inbound order is", "inbound orders are")} overdue`, overdue,
    `Chase for a firm date before planning around ${overdue.length === 1 ? "it" : "any of them"}.`);
  const held = subcon.held.filter((v) => v.ageDays > 20);
  group("watch", "Subcontracting", "subcon", `${plural(held.length, "component line", "component lines")} held over 20 days at a vendor`,
    held.map((v) => `${fmtQty(v.qty, matInfo(v.code).uom)} ${v.code} at ${v.vendor} for ${v.ageDays} days`));

  // --- output against dispatch
  if (flow && flow.plannedShip > flow.plannedBuild) {
    add("warning", "Production vs dispatch", "flow", "Committed dispatches exceed planned production",
      `${fmtQty(flow.plannedShip, "EA")} committed against ${fmtQty(flow.plannedBuild, "EA")} planned. The gap of ${fmtQty(flow.plannedShip - flow.plannedBuild, "EA")} has to come out of stock.`);
  }

  issues.sort((a, b) => SEV[a.sev] - SEV[b.sev]);
  const counts = {
    critical: issues.filter((i) => i.sev === "critical").length,
    warning: issues.filter((i) => i.sev === "warning").length,
    watch: issues.filter((i) => i.sev === "watch").length,
  };

  const usable = programme.lines.filter((l) => l.master.ok);
  const stats = [
    { k: "Lines in the run", v: `${programme.lines.length}`, s: `${programme.plants.length} plant${programme.plants.length === 1 ? "" : "s"}`, screen: "run" },
    { k: "Buildable today", v: `${programme.totalBuildable} of ${programme.totalDemand}`, s: "across the whole run", screen: "run" },
    { k: "Whole run complete", v: programme.programmeKit > t0 ? fmtDate(programme.programmeKit) : "today", s: `${usable.filter((l) => l.result.verdict === "blocked").length} of ${usable.length} lines miss their date`, screen: "shortages" },
    { k: "Materials projected short", v: `${negFG.length + negComp.length}`, s: `of ${projectionSet.length} in scope`, screen: "demand" },
    { k: "Work centres over", v: `${capacityAll.filter((c) => c.totalOver > 0).length}`, s: `of ${capacityAll.length}${capacityAll.some((c) => c.unavailable) ? `, ${capacityAll.filter((c) => c.unavailable).length} off line` : `, peak ${Math.max(0, ...capacityAll.filter((c) => c.peak != null).map((c) => c.peak))}%`}`, screen: "capacity" },
    { k: "Order lines at risk", v: `${late.length}`, s: `of ${risk.length} in the horizon`, screen: "sales" },
    { k: "Shared components short", v: `${starved.length}`, s: `of ${contended.length} contended`, screen: "contention" },
    { k: "Consumption warnings", v: `${consumption.filter((c) => c.status !== "ok").length}`, s: `of ${consumption.length} with history`, screen: "consumption" },
  ];

  const worst = issues[0] || null;
  const state = counts.critical ? "blocked" : counts.warning ? "coverable" : "release";
  const headline =
    counts.critical ? `${counts.critical} thing${counts.critical === 1 ? "" : "s"} will break the plan unless someone acts today.`
    : counts.warning ? `Nothing is broken, but ${counts.warning} item${counts.warning === 1 ? " needs" : "s need"} attention this week.`
    : "The plan holds. Nothing needs a decision today.";

  return { issues, counts, stats, headline, state, worst };
}

/* ============================================================
   CONSUMPTION HISTORY

   What was actually issued, period by period. Useful for three things a
   planner cannot get from the forward view: whether safety stock matches
   real variability, whether material is leaving without an order behind
   it, and whether anything has stopped moving altogether.
   ============================================================ */

function monthsBack(t0, n = 12) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(t0.getFullYear(), t0.getMonth() - (n - 1 - i), 1);
    return {
      i, date: d, current: i === n - 1,
      label: d.toLocaleDateString("en-GB", { month: "short" }),
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    };
  });
}

function consumptionHistory(mat, plant, rules, slocSet, pool) {
  const rec = CONSUMPTION.find((c) => c.m === mat && c.p === plant);
  const months = monthsBack(rules.t0, 12);
  const uom = matInfo(mat).uom;
  if (!rec) return null;

  const periods = months.map((m, i) => {
    const total = rec.total[i] || 0;
    const unplanned = rec.unplanned[i] || 0;
    return { ...m, total, unplanned, planned: r3(total - unplanned) };
  });

  // the current month is part-complete, so it is excluded from the averages
  const closed = periods.filter((p) => !p.current);
  const vals = closed.map((p) => p.total);
  const sum = vals.reduce((a, v) => a + v, 0);
  const avg = Math.round((sum / Math.max(vals.length, 1)) * 10) / 10;
  const mean = avg || 1;
  const sd = Math.round(Math.sqrt(vals.reduce((a, v) => a + (v - avg) ** 2, 0) / Math.max(vals.length, 1)) * 10) / 10;
  const cv = Math.round((sd / mean) * 100) / 100;
  const peak = Math.max(0, ...vals);
  const recent = closed.slice(-3).reduce((a, p) => a + p.total, 0) / 3;
  const prior = closed.slice(-6, -3).reduce((a, p) => a + p.total, 0) / 3;
  const trend = prior > 0 ? Math.round(((recent - prior) / prior) * 100) : null;

  const unplannedSum = closed.reduce((a, p) => a + p.unplanned, 0);
  const unplannedShare = sum > 0 ? Math.round((unplannedSum / sum) * 1000) / 10 : 0;

  let idle = 0;
  for (let i = periods.length - 1; i >= 0; i--) { if (periods[i].total > 0) break; idle++; }

  const { available, onHand } = availableOf(mat, plant, slocSet, rules, null, pool);
  const perDay = avg / 30;
  const coverDays = perDay > 0 ? Math.round(available / perDay) : null;
  const safety = safetyOf(mat, plant);
  const mrp = mrpDataOf(mat, plant);
  const safetyDays = perDay > 0 && safety > 0 ? Math.round(safety / perDay) : null;
  // a month of demand at the observed spread, which is what safety stock is really for
  const suggestedSafety = avg > 0 ? Math.ceil(sd * 1.64) : 0;

  const lead = matInfo(mat).lead || 0;
  const exposed = coverDays !== null && lead > 0 && coverDays < lead;

  const flags = [];
  if (idle >= 3) flags.push({ tone: "stop", text: `Nothing issued for ${idle} months. ${fmtQty(onHand, uom)} ${uom} is sitting still — check whether it is still in a live bill of material.` });
  if (unplannedShare >= 8) flags.push({ tone: "caution", text: `${unplannedShare}% of issues had no order behind them. Either scrap is being posted as consumption, or shop floor issues are skipping the order reference.` });
  if (cv >= 0.6 && avg > 0) flags.push({ tone: "caution", text: `Consumption is lumpy — it swings ${Math.round(cv * 100)}% around a mean of ${fmtQty(avg, uom)}. Peak month was ${fmtQty(peak, uom)}, so an average-based reorder point will be short in a peak.` });
  if (exposed && avg > 0) flags.push({ tone: "stop", text: `${coverDays} days of cover at the average run rate against a ${lead} day lead time. A replenishment ordered today arrives after the stock runs out.` });
  else if (coverDays !== null && lead > 0 && coverDays < lead * 1.5 && avg > 0) flags.push({ tone: "caution", text: `${coverDays} days of cover against a ${lead} day lead time. There is no room for a late delivery.` });
  if (safety > 0 && suggestedSafety > safety * 1.5 && avg > 0) flags.push({ tone: "caution", text: `Safety stock is ${fmtQty(safety, uom)} but the observed spread suggests around ${fmtQty(suggestedSafety, uom)} for the same service level.` });
  if (trend !== null && trend >= 25) flags.push({ tone: "caution", text: `Consumption is up ${trend}% on the previous quarter. Reorder point and forecast were probably set against the older rate.` });
  if (trend !== null && trend <= -25) flags.push({ tone: "signal", text: `Consumption is down ${Math.abs(trend)}% on the previous quarter. Check for obsolescence before the next order goes out.` });

  return {
    mat, plant, uom, desc: matInfo(mat).desc,
    periods, closed, avg, sd, cv, peak, trend, sum,
    unplannedSum, unplannedShare, idle,
    available, onHand, coverDays, safety, safetyDays, suggestedSafety, mrp, lead, exposed,
    flags,
    status: flags.some((f) => f.tone === "stop") ? "late" : flags.length ? "risk" : "ok",
  };
}

/* The issue documents behind the history */
function consumptionMovements(mat, plant, rules) {
  return GOODS_MVT
    .filter((g) => g.m === mat && g.p === plant && ["261", "262", "543", "201"].includes(g.mvt))
    .map((g) => ({ ...g, date: addDays(rules.t0, g.offset), meta: MVT_TYPES[g.mvt] }))
    .sort((a, b) => b.date - a.date);
}

/* ============================================================
   BACKWARD SCHEDULING

   Work backwards from the date the customer wants the goods to the date
   production has to start, which is the date the components must be there.
   Weekends are non-working; a real build reads the factory calendar instead.
   ============================================================ */

const isWorkday = (d) => d.getDay() !== 0 && d.getDay() !== 6;

function subWorkDays(date, n) {
  const d = new Date(date);
  let left = Math.max(0, Math.round(n));
  while (left > 0) { d.setDate(d.getDate() - 1); if (isWorkday(d)) left--; }
  while (!isWorkday(d)) d.setDate(d.getDate() - 1);
  return d;
}

function workDaysBetween(a, b) {
  if (b <= a) return 0;
  let n = 0; const d = new Date(a);
  while (d < b) { d.setDate(d.getDate() + 1); if (isWorkday(d)) n++; }
  return n;
}

/* In-house production time. With a production version the routing gives a
   lot-size dependent answer; without one we fall back to MARC-DZEIT. */
function inHouseDays(fg, plant, qty, pv) {
  if (pv && pv.hoursPer) {
    const wc = WORK_CENTRES.find((w) => w.id === pv.wc && w.plant === plant);
    const perDay = wc ? wcCapacity(wc) / 5 : 8;
    return { days: Math.max(1, Math.ceil((qty * pv.hoursPer) / Math.max(perDay, 1))), basis: "routing", perDay: r3(perDay), hours: r3(qty * pv.hoursPer) };
  }
  return { days: Math.max(1, matInfo(fg).lead || 1), basis: "material master", perDay: null, hours: null };
}

/* delivery → goods issue → loading → material availability → production start */
function backwardSchedule({ fg, plant, qty, delivery, so, pv }) {
  const sp = SHIP_POINTS.find((x) => x.plant === plant) || { pickPack: 1, loading: 1, id: "—", desc: "" };
  const transit = so ? so.transit : 2;
  const margin = marginOf(marginKeyOf(fg, plant));
  const ih = inHouseDays(fg, plant, qty, pv);

  const goodsIssue = subWorkDays(delivery, transit);
  const loading = subWorkDays(goodsIssue, sp.loading);
  const materialAvail = subWorkDays(loading, sp.pickPack);
  const schedFinish = subWorkDays(materialAvail, margin.floatAfter);
  const prodStart = subWorkDays(schedFinish, ih.days);
  const releaseBy = subWorkDays(prodStart, margin.floatBefore);
  const orderBy = subWorkDays(releaseBy, margin.opening);

  return {
    delivery, goodsIssue, loading, materialAvail, schedFinish, prodStart, releaseBy, orderBy,
    needBy: prodStart,
    transit, shipPoint: sp, margin, inHouse: ih,
    steps: [
      { k: "Customer delivery date", d: delivery, days: null, src: so ? `VBEP-EDATU on ${so.doc}/${so.item}` : "entered by the planner" },
      { k: "Goods issue", d: goodsIssue, days: transit, src: `transit time on route ${so ? so.route : "—"} · TVRO-TRAZTD` },
      { k: "Loading", d: loading, days: sp.loading, src: `loading time at shipping point ${sp.id} · TVST` },
      { k: "Material availability", d: materialAvail, days: sp.pickPack, src: `pick and pack time at ${sp.id} · TVST` },
      { k: "Scheduled finish", d: schedFinish, days: margin.floatAfter, src: `float after production · T436A key ${margin.key}` },
      { k: "Production start", d: prodStart, days: ih.days, src: ih.basis === "routing" ? `routing ${pv.routing}/${pv.counter} · ${ih.hours} h at ${ih.perDay} h per day on ${pv.wc}` : `in-house production time · MARC-DZEIT` },
      { k: "Release by", d: releaseBy, days: margin.floatBefore, src: `float before production · T436A key ${margin.key}` },
      { k: "Create order by", d: orderBy, days: margin.opening, src: `opening period · T436A key ${margin.key}` },
    ],
  };
}

/* ============================================================
   HORIZON ENGINE

   The readiness engine above answers "can I start this order". These answer
   "does the plan hold over the next eight weeks" — the same data, bucketed by
   week, plus the capacity the plan would consume.
   ============================================================ */

function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - yearStart) / DAY + 1) / 7);
}

function weekBuckets(t0, n = 8) {
  const start = new Date(t0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // back to Monday
  return Array.from({ length: n }, (_, i) => {
    const from = addDays(start, i * 7);
    return { i, from, to: addDays(from, 6), label: `W${isoWeek(from)}`, date: fmtDate(from) };
  });
}

const weekIndex = (weeks, d) => {
  if (d < weeks[0].from) return 0;
  for (let i = weeks.length - 1; i >= 0; i--) if (d >= weeks[i].from) return i;
  return -1;
};

/* MD04 in weekly buckets: every demand and receipt element, rolled into projected stock */
function demandSupply(mat, plant, rules, weeks, slocSet, run) {
  const n = weeks.length;
  const zero = () => Array(n).fill(0);
  const row = { so: zero(), pir: zero(), dep: zero(), runDep: zero(), run: zero(), planned: zero(), prod: zero(), purch: zero(), subcon: zero() };

  const put = (bucket, date, qty) => {
    const i = weekIndex(weeks, date);
    if (i >= 0 && i < n && qty > 0) bucket[i] += qty;
  };

  for (const s of SALES_ORDERS.filter((x) => x.m === mat && x.p === plant))
    put(row.so, addDays(rules.t0, s.reqOffset), s.qty);

  for (const f of PIR.filter((x) => x.m === mat && x.p === plant))
    put(row.pir, addDays(rules.t0, f.offset), Math.max(0, f.qty - f.withdrawn));

  for (const r of openReservations(mat, plant, rules.t0))
    put(row.dep, r.date, r.open);

  /* This planning run: a receipt on the finished good, dependent demand on its components */
  for (const d of (run && run.supply) || [])
    if (d.m === mat && d.p === plant) put(row.run, d.date, d.qty);
  for (const d of (run && run.dependent) || [])
    if (d.m === mat && d.p === plant) put(row.runDep, d.date, d.qty);

  for (const o of PLANNED_ORDERS.filter((x) => x.m === mat && x.p === plant))
    put(row.planned, addDays(rules.t0, o.finishOffset), o.qty);

  for (const o of PROD_ORDERS.filter((x) => x.material === mat && x.plant === plant)) {
    const open = Math.max(0, o.qty - o.delivered);
    put(row.prod, addDays(rules.t0, o.finishOffset), open);
  }

  for (const s of SUPPLY.filter((x) => x.m === mat && x.p === plant))
    put(row.purch, addDays(rules.t0, s.offset), Math.max(0, s.q - s.received));

  for (const s of SUBCON.filter((x) => x.material === mat && x.plant === plant))
    put(row.subcon, addDays(rules.t0, s.offset), Math.max(0, s.q - s.received));

  const opening = onHandIn(mat, plant, slocSet, rules);
  const safety = safetyOf(mat, plant);
  let running = opening;
  const rows = weeks.map((w, i) => {
    const demand = row.so[i] + row.pir[i] + row.dep[i] + row.runDep[i];
    const supply = row.planned[i] + row.prod[i] + row.purch[i] + row.subcon[i] + row.run[i];
    running = r3(running + supply - demand);
    return {
      ...w,
      so: row.so[i], pir: row.pir[i], dep: row.dep[i], runDep: row.runDep[i],
      planned: row.planned[i], prod: row.prod[i], purch: row.purch[i], subcon: row.subcon[i], run: row.run[i],
      demand, supply, closing: running,
    };
  });

  const totalDemand = rows.reduce((a, r) => a + r.demand, 0);
  const totalSupply = rows.reduce((a, r) => a + r.supply, 0);
  const firstShort = rows.find((r) => r.closing < 0) || null;
  const firstBreach = rows.find((r) => r.closing < safety) || null;
  const avgWeekly = totalDemand / n;
  return {
    mat, plant, uom: matInfo(mat).uom, desc: matInfo(mat).desc,
    rows, opening, safety, totalDemand, totalSupply,
    balance: r3(opening + totalSupply - totalDemand),
    firstShort, firstBreach,
    coverDays: avgWeekly > 0 ? Math.round((opening / avgWeekly) * 7) : null,
    status: firstShort ? "late" : firstBreach ? "risk" : "ok",
  };
}

/* Capacity: hours already committed by orders, plus what this planning run would add */
function capacityLoad(plant, rules, weeks, programmeLines) {
  const n = weeks.length;
  const out = (rules && rules.wcOut) || new Set();
  const centres = WORK_CENTRES.filter((w) => w.plant === plant);

  const spread = (bucket, startD, finishD, hours, note, list) => {
    const a = Math.max(0, weekIndex(weeks, startD));
    const b = weekIndex(weeks, finishD);
    const last = b < 0 ? a : Math.min(b, n - 1);
    const span = Math.max(1, last - a + 1);
    const per = hours / span;
    for (let i = a; i <= last && i < n; i++) bucket[i] += per;
    if (list && hours > 0) list.push({ ...note, hours: r3(hours), from: a, to: last, start: startD, finish: finishD });
  };

  return centres.map((w) => {
    const unavailable = out.has(w.id);
    const avail = unavailable ? 0 : wcCapacity(w);
    const committed = Array(n).fill(0);
    const run = Array(n).fill(0);
    const drivers = [];

    for (const o of PROD_ORDERS.filter((x) => x.plant === plant && x.wc === w.id)) {
      if (o.status.includes("TECO") || o.status.includes("DLV")) continue;
      const open = Math.max(0, o.qty - o.delivered);
      spread(committed, addDays(rules.t0, o.startOffset), addDays(rules.t0, o.finishOffset),
        open * o.hoursPer,
        { kind: "order", ref: o.order, material: o.material, qty: open, status: o.status, released: o.status.includes("REL"), missing: o.status.includes("MSPT") },
        drivers);
    }
    for (const o of PLANNED_ORDERS.filter((x) => x.p === plant && x.wc === w.id)) {
      spread(committed, addDays(rules.t0, o.startOffset), addDays(rules.t0, o.finishOffset),
        o.qty * o.hoursPer,
        { kind: o.firmed ? "planned firmed" : "planned", ref: o.order, material: o.m, qty: o.qty, firmed: o.firmed },
        drivers);
    }
    for (const L of programmeLines || []) {
      if (L.plant !== plant || !L.master.ok || !L.pv || L.pv.wc !== w.id) continue;
      const i = Math.max(0, weekIndex(weeks, L.needBy));
      const hours = L.qty * (L.pv.hoursPer || 0);
      if (i < n) run[i] += hours;
      if (hours > 0) drivers.push({
        kind: "this run", ref: `line ${L.seq}`, material: L.fg, qty: L.qty, hours: r3(hours),
        from: i, to: i, start: weeks[i].from, finish: L.needBy,
      });
    }

    const rows = weeks.map((wk, i) => {
      const c = r3(committed[i]), r = r3(run[i]), total = r3(c + r);
      return {
        ...wk, committed: c, run: r, total, avail,
        pct: avail > 0 ? Math.round((total / avail) * 100) : null,
        over: r3(Math.max(0, total - avail)),
      };
    });
    return {
      ...w, avail, unavailable, rows, drivers: drivers.sort((a, b) => b.hours - a.hours),
      peak: avail > 0 ? Math.max(...rows.map((r) => r.pct)) : null,
      overWeeks: rows.filter((r) => r.over > 0),
      totalOver: r3(rows.reduce((a, r) => a + r.over, 0)),
      strandedHours: unavailable ? r3(rows.reduce((a, r) => a + r.total, 0)) : 0,
    };
  });
}

/* What the plant built against what it shipped, week by week */
function productionVsDispatch(scope, rules, weeks, runLines) {
  const n = weeks.length;
  const inScope = (m, p) => scope.some((x) => x.m === m && x.p === p);
  const produced = Array(n).fill(0), dispatched = Array(n).fill(0);
  const plannedOut = Array(n).fill(0), plannedShip = Array(n).fill(0);

  const put = (b, date, q) => { const i = weekIndex(weeks, date); if (i >= 0 && i < n && q > 0) b[i] += q; };

  // actuals from posted movements
  for (const g of GOODS_MVT) {
    if (!inScope(g.m, g.p)) continue;
    const d = addDays(rules.t0, g.offset);
    if (g.mvt === "101" && g.refType === "PRD") put(produced, d, g.qty);
    if (g.mvt === "601") put(dispatched, d, g.qty);
  }
  // forward: open production and deliveries not yet issued, then the order book
  for (const o of PROD_ORDERS) {
    if (!inScope(o.material, o.plant)) continue;
    const open = Math.max(0, o.qty - o.delivered);
    if (open > 0) put(plannedOut, addDays(rules.t0, o.finishOffset), open);
  }
  for (const o of PLANNED_ORDERS) {
    if (!inScope(o.m, o.p)) continue;
    put(plannedOut, addDays(rules.t0, o.finishOffset), o.qty);
  }
  for (const L of runLines || []) {
    if (!inScope(L.fg, L.plant)) continue;
    put(plannedOut, L.needBy, L.qty);
  }
  const delivered = new Set(DELIVERIES.map((d) => d.so));
  for (const d of DELIVERIES) {
    if (!inScope(d.m, d.p) || d.gi) continue;
    put(plannedShip, addDays(rules.t0, d.offset), d.qty);
  }
  for (const so of SALES_ORDERS) {
    // a line that already has a delivery is counted there, not twice
    if (!inScope(so.m, so.p) || delivered.has(so.doc)) continue;
    put(plannedShip, addDays(rules.t0, so.reqOffset), so.qty);
  }

  let cum = 0;
  const rows = weeks.map((w, i) => {
    const past = w.to < rules.t0;
    const out = past ? produced[i] : produced[i] + plannedOut[i];
    const ship = past ? dispatched[i] : dispatched[i] + plannedShip[i];
    cum = r3(cum + out - ship);
    return {
      ...w, past,
      produced: r3(produced[i]), dispatched: r3(dispatched[i]),
      plannedOut: r3(past ? 0 : plannedOut[i]), plannedShip: r3(past ? 0 : plannedShip[i]),
      runOut: 0,
      out: r3(out), ship: r3(ship), net: r3(out - ship), cum,
    };
  });

  const hist = rows.filter((r) => r.past);
  const fwd = rows.filter((r) => !r.past);
  return {
    rows,
    builtToDate: r3(hist.reduce((a, r) => a + r.produced, 0)),
    shippedToDate: r3(hist.reduce((a, r) => a + r.dispatched, 0)),
    plannedBuild: r3(fwd.reduce((a, r) => a + r.out, 0)),
    plannedShip: r3(fwd.reduce((a, r) => a + r.ship, 0)),
  };
}

/* Plain next step for a material whose projection is not clean */
function demandAction(d) {
  if (d.status === "ok") return "Nothing due.";
  const lead = matInfo(d.mat).lead || 0;
  const proc = matInfo(d.mat).proc;
  if (d.firstShort) {
    const gap = Math.abs(d.firstShort.closing);
    const what = proc === "E" ? "raise or pull in a production order" : "expedite an existing order, or raise a requisition";
    return `Short ${fmtQty(gap, d.uom)} ${d.uom} by ${d.firstShort.label} — ${what}. Lead time ${lead} days, so act by ${fmtDate(addDays(d.firstShort.from, -lead))}.`;
  }
  return `Dips under safety stock in ${d.firstBreach.label}. Cover exists, but there is no buffer left for a late receipt.`;
}

/* Order book split, for the dispatch outcome donut */
function orderBookSplit(risk, scope, rules) {
  const inScope = (m, p) => scope.some((x) => x.m === m && x.p === p);
  const shipped = DELIVERIES.filter((d) => inScope(d.m, d.p) && d.gi).reduce((a, d) => a + d.qty, 0);
  const onTime = risk.filter((r) => r.covered).reduce((a, r) => a + r.qty, 0);
  const late = risk.filter((r) => !r.covered && r.expected).reduce((a, r) => a + r.qty, 0);
  const beyond = risk.filter((r) => !r.covered && !r.expected).reduce((a, r) => a + r.qty, 0);
  return [
    { key: "shipped", label: "Already shipped", qty: r3(shipped), color: "#7C97AC" },
    { key: "ontime", label: "Will ship on time", qty: r3(onTime), color: "var(--go)" },
    { key: "late", label: "Will ship late", qty: r3(late), color: "var(--caution)" },
    { key: "beyond", label: "No date in the horizon", qty: r3(beyond), color: "var(--stop)" },
  ].filter((x) => x.qty > 0);
}

/* Which sales order lines the projection cannot support, and by how long */
function deliveryRisk(plant, rules, weeks, slocSet, run) {
  const out = [];
  const byMat = {};
  for (const so of SALES_ORDERS.filter((s) => s.p === plant)) {
    if (!byMat[so.m]) byMat[so.m] = demandSupply(so.m, plant, rules, weeks, slocSet, run);
  }
  for (const [mat, ds] of Object.entries(byMat)) {
    // supply and non-sales demand accumulated week by week
    const cum = [];
    let sup = ds.opening, oth = 0;
    ds.rows.forEach((r) => { sup += r.supply; oth += r.pir + r.dep + r.run; cum.push(sup - oth); });

    let soCum = 0;
    const lines = SALES_ORDERS.filter((s) => s.p === plant && s.m === mat)
      .map((s) => ({ ...s, req: addDays(rules.t0, s.reqOffset) }))
      .sort((a, b) => a.req - b.req);

    for (const s of lines) {
      soCum += s.qty;
      const wi = Math.max(0, weekIndex(weeks, s.req));
      const covered = wi < cum.length && cum[wi] - soCum >= -1e-9;
      let expected = null, lateDays = 0;
      if (!covered) {
        for (let i = wi; i < cum.length; i++) {
          if (cum[i] - soCum >= -1e-9) { expected = weeks[i].from; break; }
        }
        lateDays = expected ? diffDays(expected, s.req) : null;
      }
      out.push({
        ...s, material: mat, uom: ds.uom, req: s.req, covered, expected, lateDays,
        shortfall: covered ? 0 : r3(soCum - (cum[wi] ?? 0)),
        cause: covered ? null
          : ds.firstShort ? `Projected stock is negative from ${ds.firstShort.label}`
          : "Receipts land after the requested date",
      });
    }
  }
  return out.sort((a, b) => (b.lateDays ?? -1) - (a.lateDays ?? -1) || a.req - b.req);
}

/* ============================================================
   ALLOCATION POOL

   When several finished goods are planned together they compete for the same
   stock, the same open purchase orders and the same vendor-held material. The
   pool records what each line has already drawn so the next line down the
   priority list only ever sees what is genuinely left.
   ============================================================ */

const pk = (...a) => a.join("|");
const makePool = () => ({ stock: {}, sloc: {}, supply: {}, plantStock: {}, vendor: {} });
const clonePool = (p) => ({
  stock: { ...p.stock }, sloc: { ...p.sloc }, supply: { ...p.supply },
  plantStock: { ...p.plantStock }, vendor: { ...p.vendor },
});
const drawn = (bucket, k) => bucket[k] || 0;
const draw = (bucket, k, q) => { if (q > 0) bucket[k] = Math.round(((bucket[k] || 0) + q) * 1000) / 1000; };

function stockRows(mat, plant) {
  return STOCK.filter((r) => r.m === mat && r.p === plant);
}

/* Batch rows with their dates and whether the planner has marked them out */
function batchRows(mat, plant, rules) {
  const t0 = (rules && rules.t0) || today();
  return BATCHES.filter((b) => b.m === mat && b.p === plant).map((b) => ({
    ...b,
    key: batchKey(b),
    mfg: addDays(t0, b.mfgOffset),
    exp: b.expOffset == null ? null : addDays(t0, b.expOffset),
    expired: b.expOffset != null && b.expOffset < 0,
    shelfDays: b.expOffset == null ? null : b.expOffset,
    excluded: rules && rules.batchOut ? rules.batchOut.has(batchKey(b)) : false,
  }));
}

const isBatchManaged = (mat) => BATCH_MANAGED.has(mat);

/* For a batch managed material only the batches still marked in are counted */
function onHandIn(mat, plant, slocSet, rules) {
  const plain = () => stockRows(mat, plant).filter((r) => slocSet.has(r.s)).reduce((a, r) => a + r.q, 0);
  if (!isBatchManaged(mat)) return plain();
  const rows = batchRows(mat, plant, rules);
  // A batch managed material with stock but no batch records is an extract gap.
  // Fall back to the location figure rather than silently reporting nothing.
  if (!rows.length) return plain();
  return r3(rows.filter((b) => slocSet.has(b.sloc) && !b.excluded).reduce((a, b) => a + b.qty, 0));
}

function excludedRows(mat, plant, slocSet, pool, rules) {
  const base = isBatchManaged(mat)
    ? SLOCS.filter((sl) => !slocSet.has(sl.code)).map((sl) => ({
        m: mat, p: plant, s: sl.code,
        q: batchRows(mat, plant, rules).filter((b) => b.sloc === sl.code && !b.excluded).reduce((a, b) => a + b.qty, 0),
      }))
    : stockRows(mat, plant).filter((r) => !slocSet.has(r.s));
  return base
    .map((r) => ({ ...r, q: Math.max(0, r.q - (pool ? drawn(pool.sloc, pk(plant, mat, r.s)) : 0)) }))
    .filter((r) => r.q > 0)
    .sort((a, b) => SLOC_BY_CODE[a.s].effort - SLOC_BY_CODE[b.s].effort);
}

function reservedFor(mat, plant, rules) {
  if (rules.resPolicy === "none") return 0;
  const list = openReservations(mat, plant, rules.t0);
  const use = list.filter((r) => {
    if (rules.resPolicy === "horizon") return r.date <= rules.needBy;
    if (rules.resPolicy === "released") return r.released;
    return true;
  });
  return use.reduce((a, r) => a + r.open, 0);
}

/* Open reservations: required less already withdrawn, ignoring anything flagged final issue */
function openReservations(mat, plant, t0) {
  return RESERVATIONS.filter((r) => r.m === mat && r.p === plant)
    .map((r) => ({
      ...r,
      date: addDays(t0, r.offset),
      open: r.finalIssue ? 0 : Math.max(0, r.reqQty - r.withdrawn),
      released: isReleased(r.order),
      orderInfo: ORDER_BY_ID[r.order] || null,
    }))
    .filter((r) => r.open > 0)
    .sort((a, b) => a.date - b.date);
}

/* Production orders at this plant, with dates resolved */
function prodOrders(plant, rules) {
  return PROD_ORDERS.filter((o) => o.plant === plant)
    .map((o) => ({
      ...o,
      created: addDays(rules.t0, o.createdOffset),
      start: addDays(rules.t0, o.startOffset),
      finish: addDays(rules.t0, o.finishOffset),
      openQty: Math.max(0, o.qty - o.delivered),
      released: o.status.includes("REL"),
      missingParts: o.status.includes("MSPT"),
      complete: o.status.includes("TECO") || o.status.includes("DLV"),
      late: o.finishOffset < 0 && o.delivered < o.qty,
    }))
    .sort((a, b) => a.finish - b.finish);
}

/* Posted goods movements, newest first */
function goodsMovements(plant, rules, materials) {
  return GOODS_MVT.filter((g) => g.p === plant)
    .filter((g) => !materials || materials.includes(g.m))
    .map((g) => ({
      ...g,
      date: addDays(rules.t0, g.offset),
      meta: MVT_TYPES[g.mvt] || { text: "Movement", effect: "move" },
      orderInfo: ORDER_BY_ID[g.ref] || null,
    }))
    .sort((a, b) => b.date - a.date || a.doc.localeCompare(b.doc));
}

/* Inbound supply. Only the balance still to be delivered counts, and of that only the part
   a previous MRP run has not already pegged to other dependent requirements. */
function decorateSupply(s, rules, pool) {
  const pegged = (s.pegged || []).reduce((a, p) => a + p.qty, 0);
  const openQty = Math.max(0, s.q - s.received);
  const usable = rules.excludePegged ? Math.max(0, openQty - pegged) : openQty;
  const taken = pool ? drawn(pool.supply, pk(s.doc, s.item)) : 0;
  return {
    ...s,
    date: addDays(rules.t0, s.offset),
    created: addDays(rules.t0, s.createdOffset),
    pegged,
    openQty,
    allocated: taken,
    free: Math.max(0, usable - taken),
    state: openQty <= 0 ? "closed" : s.received > 0 ? "partial" : "open",
    overdue: openQty > 0 && s.offset < 0,
  };
}

function allSupply(mat, plant, rules, pool) {
  const po = SUPPLY.filter((s) => s.m === mat && s.p === plant).map((s) => decorateSupply(s, rules, pool));
  const sc = SUBCON.filter((s) => s.plant === plant && s.material === mat).map((s) =>
    decorateSupply({ ...s, m: s.material, p: s.plant, type: "SC" }, rules, pool)
  );
  return [...po, ...sc].sort((a, b) => a.date - b.date);
}

function freeSupply(mat, plant, rules, pool) {
  return allSupply(mat, plant, rules, pool).filter((s) => s.free > 0);
}

/* Subcontracting orders raised by this plant */
function subconOrders(plant, rules, pool) {
  return SUBCON.filter((s) => s.plant === plant)
    .map((s) => decorateSupply({ ...s, m: s.material, p: s.plant, type: "SC" }, rules, pool))
    .sort((a, b) => a.date - b.date);
}

/* Our components physically held at a subcontractor: owned, but not issuable at the plant */
function vendorStock(mat, plant, rules, pool) {
  const out = [];
  for (const sc of SUBCON.filter((s) => s.plant === plant)) {
    for (const c of sc.provided) {
      if (c.code !== mat) continue;
      const taken = pool ? drawn(pool.vendor, pk(sc.doc, sc.item, c.code)) : 0;
      const left = Math.max(0, c.qty - c.consumed - taken);
      if (left <= 0) continue;
      out.push({
        code: c.code, vendor: sc.vendor, vendorCode: sc.vendorCode,
        doc: sc.doc, item: sc.item, parent: sc.material, service: sc.service,
        provided: c.qty, consumed: c.consumed, qty: left,
        sentOn: addDays(rules.t0, sc.createdOffset),
        delivery: addDays(rules.t0, sc.offset),
        ageDays: -sc.createdOffset,
        overdue: sc.offset < 0 && sc.q > sc.received,
        mode: sc.mode, createdBy: sc.createdBy,
      });
    }
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

function vendorStockAll(plant, rules, pool) {
  const seen = new Set();
  const out = [];
  for (const sc of SUBCON.filter((s) => s.plant === plant)) {
    for (const c of sc.provided) {
      const key = `${sc.doc}-${sc.item}-${c.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(...vendorStock(c.code, plant, rules, pool).filter((v) => v.doc === sc.doc && v.item === sc.item));
    }
  }
  return out;
}

// stock at other plants that is freely issuable there (unrestricted sloc types only)
function otherPlantStock(mat, homePlant, rules, pool) {
  const out = [];
  for (const p of PLANTS) {
    if (p.id === homePlant) continue;
    const q = STOCK.filter(
      (r) => r.m === mat && r.p === p.id && SLOC_BY_CODE[r.s].type === "Unrestricted"
    ).reduce((a, r) => a + r.q, 0);
    const res = reservedFor(mat, p.id, rules);
    const taken = pool ? drawn(pool.plantStock, pk(p.id, mat)) : 0;
    const free = Math.max(0, q - res - taken);
    if (free > 0) out.push({ plant: p.id, name: p.name, qty: free, reserved: res, transit: transitDays(p.id, homePlant) });
  }
  return out.sort((a, b) => a.transit - b.transit);
}

const r3 = (n) => Math.round(n * 1000) / 1000;

function availableOf(mat, plant, slocSet, rules, bonus, pool) {
  const onHand = onHandIn(mat, plant, slocSet, rules);
  const res = reservedFor(mat, plant, rules);
  const taken = pool ? drawn(pool.stock, pk(plant, mat)) : 0;
  const extra = bonus ? bonus[mat] || 0 : 0;
  return {
    onHand, reserved: res, allocated: r3(taken),
    available: r3(Math.max(0, r3(onHand - res - taken)) + extra),
  };
}

/* Recursive: how many units of the parent can this branch support.
   "bonus" lets the caller ask the same question as if certain arrivals had already landed. */
function branchCapacity(code, perParent, plant, slocSet, rules, seen = new Set(), bonus = null, pool = null) {
  if (perParent <= 0) return Infinity;
  if (seen.has(code)) return Infinity;
  const next = new Set(seen); next.add(code);

  const { available } = availableOf(code, plant, slocSet, rules, bonus, pool);
  const kids = componentsOf(code, rules);
  if (kids && kids.length) {
    const caps = kids.map((c) => {
      const f = c.qty * (1 + (c.scrap || 0) / 100);
      return branchCapacity(c.code, f, plant, slocSet, rules, next, bonus, pool);
    });
    const sub = Math.min(...caps);
    return (available + sub) / perParent;
  }
  return available / perParent;
}

/* How the buildable quantity climbs as each resolution step lands */
function buildProfile({ fg, orderQty, plant, slocSet, rules, shortLines, pool }) {
  const top = componentsOf(fg, rules) || [];
  if (!top.length) return [];

  const stamps = new Set([rules.t0.getTime(), rules.needBy.getTime()]);
  shortLines.forEach((l) => l.resolution.steps.forEach((s) => stamps.add(s.eta.getTime())));

  return [...stamps].sort((a, b) => a - b).map((t) => {
    const bonus = {};
    shortLines.forEach((l) =>
      l.resolution.steps.forEach((s) => {
        if (s.eta.getTime() <= t) bonus[l.code] = (bonus[l.code] || 0) + s.qty;
      })
    );
    const caps = top.map((c) => {
      const f = c.qty * (1 + (c.scrap || 0) / 100);
      return branchCapacity(c.code, f, plant, slocSet, rules, new Set(), bonus, pool);
    });
    const cap = caps.length ? Math.min(...caps) : 0;
    return { date: new Date(t), qty: Math.max(0, Math.min(Math.floor(cap), orderQty)) };
  });
}

/* Build the ordered resolution plan for one shortage */
function resolve({ mat, shortage, plant, slocSet, rules, pool }) {
  const m = MATERIALS[mat];
  const { needBy, t0 } = rules;
  const steps = [];
  let remaining = shortage;

  const supply = freeSupply(mat, plant, rules, pool);
  const overdueSupply = supply.filter((s) => s.overdue);
  const onTime = supply.filter((s) => !s.overdue && s.date <= needBy);
  const late = supply.filter((s) => !s.overdue && s.date > needBy);

  /* Tier one: everything that costs nothing new — material already on order and landing in
     time, and stock sitting in storage locations the planner excluded. Among options that
     land in time, take the least disruptive one; if none land in time, take the fastest. */
  const freeOptions = [
    ...onTime.map((s) => ({ kind: "inbound", eta: s.date, qty: s.free, effort: 0, s })),
    ...excludedRows(mat, plant, slocSet, pool, rules).map((r) => {
      const meta = SLOC_BY_CODE[r.s];
      return {
        kind: "transfer",
        eta: addDays(t0, meta.effort <= 1 ? 0 : meta.effort <= 2 ? 1 : 2),
        qty: r.q,
        effort: meta.effort + 1,
        r, meta,
      };
    }),
  ].sort((a, b) => {
    const aIn = a.eta <= needBy, bIn = b.eta <= needBy;
    if (aIn !== bIn) return aIn ? -1 : 1;
    if (aIn) return a.effort - b.effort;
    return a.eta - b.eta;
  });

  for (const o of freeOptions) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, o.qty);
    if (o.kind === "inbound") {
      const s = o.s;
      if (pool) draw(pool.supply, pk(s.doc, s.item), take);
      const pegNote = s.pegged > 0 && rules.excludePegged
        ? ` ${fmtQty(s.pegged, m.uom)} of the open quantity is pegged to earlier demand, leaving ${fmtQty(s.free, m.uom)} free.`
        : "";
      steps.push({
        rank: 1,
        kind: "inbound",
        label: `${s.type} ${s.doc} arrives ${fmtDate(s.date)}`,
        detail: `${s.vendor} · ${fmtQty(s.free, m.uom)} ${m.uom} free and inbound, lands before the need date. No action required.${pegNote}`,
        qty: take,
        eta: s.date,
        committedEta: s.date,
        owner: "Purchasing",
        cost: "Already committed",
        doc: s.doc,
      });
    } else {
      if (pool) draw(pool.sloc, pk(plant, mat, o.r.s), take);
      steps.push({
        rank: 2,
        kind: "transfer",
        label: `Transfer ${fmtQty(take, m.uom)} ${m.uom} from ${o.r.s}`,
        detail: o.meta.note || `Move to an issuable storage location at plant ${plant}`,
        qty: take,
        eta: o.eta,
        owner: "Stores",
        cost: "No new spend",
        slocType: o.meta.type,
      });
    }
    remaining -= take;
  }

  // 3 — inter-plant stock transfer
  for (const o of otherPlantStock(mat, plant, rules, pool)) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, o.qty);
    if (pool) draw(pool.plantStock, pk(o.plant, mat), take);
    steps.push({
      rank: 3,
      kind: "sto",
      label: `Raise STO for ${fmtQty(take, m.uom)} ${m.uom} from plant ${o.plant}`,
      detail: `${o.name} shows ${fmtQty(o.qty, m.uom)} ${m.uom} free after its own reservations. Transit ${o.transit} day${o.transit > 1 ? "s" : ""}.`,
      qty: take,
      eta: addDays(t0, o.transit + 1),
      owner: "Supply planning",
      cost: "Freight only",
    });
    remaining -= take;
  }

  // 3 — existing open purchase orders / inbound STOs
  // 4 — recall components already sitting at a subcontractor
  for (const v of vendorStock(mat, plant, rules, pool)) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, v.qty);
    if (pool) draw(pool.vendor, pk(v.doc, v.item, mat), take);
    steps.push({
      rank: 4,
      kind: "recall",
      label: `Recall ${fmtQty(take, m.uom)} ${m.uom} from ${v.vendor}`,
      detail: `Held against subcontracting order ${v.doc}/${v.item} for ${v.parent}, sent ${v.ageDays} days ago${v.overdue ? " and now overdue" : ""}. Recalling stops that subcontract work.`,
      qty: take,
      eta: addDays(t0, 3),
      owner: "Supply planning",
      cost: "No new spend, but halts subcontract work",
      vendor: v.vendor,
      doc: v.doc,
    });
    remaining -= take;
  }

  // 5 — chase receipts that are already past their delivery date
  for (const s of overdueSupply) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, s.free);
    if (pool) draw(pool.supply, pk(s.doc, s.item), take);
    steps.push({
      rank: 5,
      kind: "chase",
      label: `Chase ${s.type} ${s.doc} — overdue since ${fmtDate(s.date)}`,
      detail: `${s.vendor} · ${fmtQty(s.free, m.uom)} ${m.uom} is ${diffDays(t0, s.date)} days past the promised date. Get a firm commitment before planning around it.`,
      qty: take,
      eta: addDays(t0, 3),
      committedEta: s.date,
      owner: "Purchasing",
      cost: "Date unconfirmed",
      doc: s.doc,
      atRisk: true,
    });
    remaining -= take;
  }

  // 6 — expedite orders that exist but are confirmed late
  for (const s of late) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, s.free);
    if (pool) draw(pool.supply, pk(s.doc, s.item), take);
    const gap = diffDays(s.date, needBy);
    // A pull-in beyond this window is not something expediting normally recovers
    const recoverable = gap <= PULL_IN_WINDOW;
    const pegNote = s.pegged > 0 && rules.excludePegged
      ? ` Of ${fmtQty(s.openQty, m.uom)} still open, ${fmtQty(s.pegged, m.uom)} is pegged to earlier demand, leaving ${fmtQty(s.free, m.uom)} free.`
      : "";
    steps.push({
      rank: 6,
      kind: "expedite",
      label: `Expedite ${s.type} ${s.doc} — pull in from ${fmtDate(s.date)}`,
      detail: recoverable
        ? `${s.vendor} · ${gap} days late. A pull-in of this size is usually achievable with premium freight.${pegNote}`
        : `${s.vendor} · ${gap} days late. That is beyond what expediting normally recovers — plan on ${fmtDate(s.date)} unless the vendor confirms otherwise.${pegNote}`,
      qty: take,
      eta: recoverable ? needBy : s.date,
      committedEta: s.date,
      owner: "Purchasing",
      cost: recoverable ? "Premium freight likely" : "Premium freight, date still at risk",
      doc: s.doc,
    });
    remaining -= take;
  }

  // 7 — new procurement
  if (remaining > 1e-9) {
    const eta = addDays(t0, m.lead);
    const placeBy = addDays(needBy, -m.lead);
    const overdue = placeBy < t0;
    steps.push({
      rank: 7,
      kind: "pr",
      label: `Create PR for ${fmtQty(roundQty(remaining, m.uom), m.uom)} ${m.uom}`,
      detail: overdue
        ? `Lead time ${m.lead} days. Order date has already passed — needs a source with a shorter lead time or a partial delivery.`
        : `Lead time ${m.lead} days. Release the PR by ${fmtDate(placeBy)} to land on time.`,
      qty: roundQty(remaining, m.uom),
      eta,
      placeBy,
      overdue,
      owner: "Purchasing",
      cost: "New spend",
    });
    remaining = 0;
  }

  const coverage = steps.length ? new Date(Math.max(...steps.map((s) => s.eta.getTime()))) : t0;
  return { steps, coverage };
}

/* Full explosion */
function runCheck({ fg, orderQty, plant, slocSet, rules, pool }) {
  const { t0, needBy } = rules;
  const lines = [];

  // capacity is measured before this line draws anything, so it reflects what is left to it
  const top = componentsOf(fg, rules) || [];
  const caps = top.map((c) => {
    const f = c.qty * (1 + (c.scrap || 0) / 100);
    return { code: c.code, cap: branchCapacity(c.code, f, plant, slocSet, rules, new Set(), null, pool) };
  });
  const tightest = caps.reduce((a, b) => (b.cap < a.cap ? b : a), caps[0] || { code: null, cap: 0 });
  const buildable = Math.max(0, Math.floor(tightest.cap));

  function walk(code, required, perFG, level, parentCode) {
    const m = MATERIALS[code];
    const { onHand, reserved, allocated, available } = availableOf(code, plant, slocSet, rules, null, pool);
    const req = roundQty(required, m.uom);
    const shortage = Math.max(0, roundQty(req - available, m.uom));
    const kids = componentsOf(code, rules);
    const isAssembly = !!(kids && kids.length);

    // this line takes what it can from stock before any later line sees it
    const takenFromStock = Math.min(available, req);
    if (pool) draw(pool.stock, pk(plant, code), takenFromStock);

    // capture what was on offer to this line, before resolution draws it down
    const excl = excludedRows(code, plant, slocSet, pool, rules);
    const exclQty = excl.reduce((a, r) => a + r.q, 0);
    const resvList = openReservations(code, plant, t0);
    const supplyList = allSupply(code, plant, rules, pool);
    const usableInbound = supplyList.filter((s) => s.free > 0 && !s.overdue && s.date <= needBy);
    const inboundByNeed = usableInbound.reduce((a, s) => a + s.free, 0);
    const peggedQty = supplyList.reduce((a, s) => a + s.pegged, 0);
    const atVendor = vendorStock(code, plant, rules, pool);
    const atVendorQty = atVendor.reduce((a, v) => a + v.qty, 0);

    /* A sub-assembly is netted against its own receipts — a subcontracted housing coming
       back next week means we do not need to explode its castings again. */
    const inboundApplied = isAssembly ? Math.min(shortage, inboundByNeed) : 0;
    const toExplode = isAssembly ? roundQty(shortage - inboundApplied, m.uom) : 0;
    let inboundCover = t0;
    if (inboundApplied > 0 && pool) {
      let need = inboundApplied;
      for (const s of usableInbound) {
        if (need <= 1e-9) break;
        const t = Math.min(need, s.free);
        draw(pool.supply, pk(s.doc, s.item), t);
        if (s.date > inboundCover) inboundCover = s.date;
        need -= t;
      }
    } else if (inboundApplied > 0) {
      inboundCover = usableInbound.reduce((d, s) => (s.date > d ? s.date : d), t0);
    }

    let res = null;
    if (shortage > 0 && !isAssembly) {
      res = resolve({ mat: code, shortage, plant, slocSet, rules, pool });
    }

    const line = {
      code, level, parentCode,
      desc: m.desc, uom: m.uom, proc: m.proc, mrp: m.mrp, lead: m.lead,
      perFG, required: req, onHand, reserved, allocated, available, shortage,
      allocatedHere: takenFromStock,
      isAssembly, exclQty, excl,
      resvList, supplyList, inboundByNeed, peggedQty,
      atVendor, atVendorQty,
      inboundApplied, toExplode,
      resolution: res,
      coverage: res ? res.coverage : isAssembly && shortage > 0 && toExplode <= 0 ? inboundCover : null,
      status:
        isAssembly && toExplode > 0 ? "assembly"
        : isAssembly && shortage > 0 ? "coverable"
        : shortage <= 0 ? "ok"
        : res && res.coverage <= needBy ? "coverable"
        : "late",
    };
    lines.push(line);

    if (isAssembly && toExplode > 0) {
      for (const c of kids) {
        const f = c.qty * (1 + (c.scrap || 0) / 100);
        walk(c.code, toExplode * f, perFG * f, level + 1, code);
      }
    }
  }

  for (const c of top) {
    const f = c.qty * (1 + (c.scrap || 0) / 100);
    walk(c.code, orderQty * f, f, 1, fg);
  }

  const shortLines = lines.filter((l) => l.shortage > 0 && !l.isAssembly);
  const lateLines = shortLines.filter((l) => l.status === "late");
  const fullKit = shortLines.length
    ? new Date(Math.max(...shortLines.map((l) => l.coverage.getTime())))
    : t0;

  // the one component whose coverage date decides when the kit is complete
  const critical = shortLines.length
    ? shortLines.reduce((a, b) => (b.coverage > a.coverage ? b : a))
    : null;

  const verdict = shortLines.length === 0 ? "release" : lateLines.length ? "blocked" : "coverable";
  const depth = lines.length ? Math.max(...lines.map((l) => l.level)) : 0;

  return { lines, shortLines, lateLines, buildable, tightest, fullKit, critical, verdict, depth, rules, t0 };
}

/* ============================================================
   PROGRAMME: several finished goods planned together
   ============================================================ */

function runProgramme({ demand, slocSet, resPolicy, excludePegged, batchOut, wcOut }) {
  const t0 = today();
  const pool = makePool();
  const lines = [];

  for (let i = 0; i < demand.length; i++) {
    const d = demand[i];
    const master = { known: !!MATERIALS[d.fg], hasBom: !!BOMS[d.fg] };
    master.ok = master.known && master.hasBom;
    const so = d.so ? SALES_ORDERS.find((x) => `${x.doc}/${x.item}` === d.so) : null;

    /* Two passes: the version sets the production time, which sets the start date,
       which is the date the version has to be valid on. It settles in one step. */
    let pv = master.ok ? selectVersion(d.fg, d.qty, d.delivery, d.version && d.version !== "AUTO" ? d.version : null, t0) : null;
    let schedule = backwardSchedule({ fg: d.fg, plant: d.plant, qty: d.qty, delivery: d.delivery, so, pv });
    if (master.ok) {
      const pv2 = selectVersion(d.fg, d.qty, schedule.needBy, d.version && d.version !== "AUTO" ? d.version : null, t0);
      if (pv2 && (!pv || pv2.version !== pv.version)) {
        pv = pv2;
        schedule = backwardSchedule({ fg: d.fg, plant: d.plant, qty: d.qty, delivery: d.delivery, so, pv });
      }
    }
    const needBy = schedule.needBy;

    const rules = {
      t0, needBy, resPolicy, excludePegged, batchOut, wcOut,
      alts: pv ? { [d.fg]: pv.bom } : {},
    };
    const poolBefore = clonePool(pool);
    const result = runCheck({
      fg: d.fg, orderQty: d.qty, plant: d.plant, slocSet, rules, pool,
    });
    const profile = buildProfile({
      fg: d.fg, orderQty: d.qty, plant: d.plant, slocSet, rules,
      shortLines: result.shortLines, pool: poolBefore,
    });
    lines.push({
      ...d, seq: i + 1, rules, pv, master, so, schedule, needBy,
      startsInPast: needBy < t0,
      result, profile,
    });
  }

  const valid = lines.filter((l) => l.master.ok);
  const invalid = lines.filter((l) => !l.master.ok);
  const totalDemand = valid.reduce((a, l) => a + l.qty, 0);
  const totalBuildable = valid.reduce((a, l) => a + Math.min(l.result.buildable, l.qty), 0);
  const blocked = valid.filter((l) => l.result.verdict === "blocked");
  const shortLineCount = valid.filter((l) => l.result.verdict !== "release").length;
  const kitDates = valid.filter((l) => l.result.shortLines.length).map((l) => l.result.fullKit.getTime());
  const programmeKit = kitDates.length ? new Date(Math.max(...kitDates)) : t0;
  const verdict = invalid.length || blocked.length ? "blocked" : shortLineCount ? "coverable" : "release";
  const plants = [...new Set(lines.map((l) => l.plant))];

  return {
    lines, pool, t0, totalDemand, totalBuildable,
    blocked, invalid, shortLineCount, programmeKit, verdict, plants,
  };
}

/* Components more than one line in the programme draws on */
function contention(programme) {
  const map = {};
  for (const L of programme.lines) {
    if (!L.master.ok) continue;
    for (const l of L.result.lines) {
      if (l.isAssembly) continue;
      const k = pk(L.plant, l.code);
      if (!map[k]) {
        map[k] = {
          key: k, plant: L.plant, code: l.code, desc: l.desc, uom: l.uom,
          onHand: l.onHand, reserved: l.reserved, rows: [],
        };
      }
      const e = map[k];
      const prior = e.rows.find((r) => r.seq === L.seq);
      if (prior) {
        prior.required += l.required;
        prior.allocated += l.allocatedHere;
        prior.shortage += l.shortage;
      } else {
        e.rows.push({
          seq: L.seq, fg: L.fg, plant: L.plant,
          required: l.required, allocated: l.allocatedHere, shortage: l.shortage,
          status: l.status,
        });
      }
    }
  }
  return Object.values(map)
    .filter((m) => m.rows.length > 1)
    .map((m) => ({
      ...m,
      totalRequired: r3(m.rows.reduce((a, r) => a + r.required, 0)),
      totalAllocated: r3(m.rows.reduce((a, r) => a + r.allocated, 0)),
      totalShort: r3(m.rows.reduce((a, r) => a + r.shortage, 0)),
      starved: m.rows.filter((r) => r.shortage > 0).length,
    }))
    .sort((a, b) => b.totalShort - a.totalShort || b.totalRequired - a.totalRequired);
}

/* ============================================================
   CHARTS
   ============================================================ */

const SEQ_COLOR = ["#2C5D8F", "#1F7A54", "#A96A05", "#16706B", "#7A4E6E", "#7C97AC"];

const KIND_COLOR = {
  inbound: "#7C97AC",
  transfer: "var(--go)",
  sto: "var(--signal)",
  recall: "#16706B",
  chase: "#9C4A22",
  expedite: "var(--caution)",
  pr: "var(--stop)",
};
const KIND_LABEL = {
  inbound: "Committed inbound",
  transfer: "Storage location transfer",
  sto: "Inter-plant transfer",
  recall: "Recall from subcontractor",
  chase: "Chase overdue receipt",
  expedite: "Expedited order",
  pr: "New requisition",
};

function dateTicks(t0, end, count = 6) {
  const span = end - t0.getTime();
  const step = Math.max(1, Math.round(span / DAY / count));
  const out = [];
  for (let d = 0; d * DAY <= span; d += step) out.push(new Date(t0.getTime() + d * DAY));
  return out;
}

/* Horizontal bar showing how much of a requirement is covered */
function CoverageBar({ available, required, status }) {
  const pct = required > 0 ? Math.min(100, (available / required) * 100) : 100;
  const fill = status === "ok" ? "var(--go)" : status === "late" ? "var(--stop)" : "var(--caution)";
  return (
    <div className="crc-cbar" title={`${Math.round(pct)}% covered from stock`}>
      <div className="crc-cbar-fill" style={{ width: `${pct}%`, background: fill }} />
    </div>
  );
}

/* When each short component becomes covered, and by which action */
function KitGantt({ lines, t0, needBy, fullKit, verdict }) {
  if (!lines.length) return null;
  const rows = [...lines].sort((a, b) => b.coverage - a.coverage);
  const end = Math.max(fullKit.getTime(), needBy.getTime()) + 2 * DAY;
  const W = 780, LEFT = 158, RIGHT = 66, ROW = 26, TOP = 24;
  const plotW = W - LEFT - RIGHT;
  const H = TOP + rows.length * ROW + 18 + ROW + 30;
  const span = Math.max(end - t0.getTime(), 5 * DAY);
  const x = (d) => LEFT + ((d.getTime() - t0.getTime()) / span) * plotW;
  const ticks = dateTicks(t0, end);
  const kitY = TOP + rows.length * ROW + 16;
  const verdictColor = verdict === "blocked" ? "var(--stop)" : verdict === "coverable" ? "var(--caution)" : "var(--go)";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-svg" role="img"
      aria-label="When each short component becomes covered">
      {ticks.map((d, i) => (
        <line key={i} x1={x(d)} y1={TOP - 8} x2={x(d)} y2={kitY + ROW - 8}
          stroke="var(--rule-soft)" strokeWidth="1" />
      ))}

      {/* need-by marker */}
      <line x1={x(needBy)} y1={TOP - 14} x2={x(needBy)} y2={kitY + ROW - 8}
        stroke="var(--ink)" strokeWidth="1.5" />
      <text
        x={x(needBy) > LEFT + plotW * 0.62 ? x(needBy) - 5 : x(needBy) + 5}
        y={TOP - 15}
        fontSize="10.5"
        textAnchor={x(needBy) > LEFT + plotW * 0.62 ? "end" : "start"}
        fill="var(--ink)"
      >
        Need by {fmtDate(needBy)}
      </text>

      {rows.map((l, i) => {
        const y = TOP + i * ROW;
        let cursor = t0;
        const segs = [...l.resolution.steps]
          .sort((a, b) => a.eta - b.eta)
          .map((s) => {
            const seg = { from: cursor, to: s.eta, kind: s.kind };
            if (s.eta > cursor) cursor = s.eta;
            return seg;
          });
        return (
          <g key={l.code}>
            <text x={LEFT - 10} y={y + 11} fontSize="11" textAnchor="end"
              fill="var(--ink)" className="crc-svg-mono">{l.code}</text>
            <rect x={LEFT} y={y + 2} width={plotW} height="11" rx="1" fill="#F0F3F5" />
            {segs.map((s, j) => {
              const x1 = x(s.from), x2 = Math.max(x(s.to), x(s.from) + 4);
              return (
                <rect key={j} x={x1} y={y + 2} width={x2 - x1} height="11" rx="1"
                  fill={KIND_COLOR[s.kind] || "var(--signal)"}>
                  <title>{KIND_LABEL[s.kind]} — ready {fmtDate(s.to)}</title>
                </rect>
              );
            })}
            <text x={x(l.coverage) + 6} y={y + 11} fontSize="10.5"
              fill={l.status === "late" ? "var(--stop)" : "var(--ink3)"}
              className="crc-svg-mono">{fmtDate(l.coverage)}</text>
          </g>
        );
      })}

      <line x1={LEFT - 148} y1={kitY - 8} x2={W - 10} y2={kitY - 8} stroke="var(--rule)" strokeWidth="1" />
      <text x={LEFT - 10} y={kitY + 11} fontSize="11" fontWeight="600" textAnchor="end" fill="var(--ink)">
        Full kit
      </text>
      <rect x={LEFT} y={kitY + 2} width={Math.max(x(fullKit) - LEFT, 4)} height="11" rx="1" fill={verdictColor} />
      <text x={x(fullKit) + 6} y={kitY + 11} fontSize="10.5" fontWeight="600"
        fill={verdictColor} className="crc-svg-mono">{fmtDate(fullKit)}</text>

      {ticks.map((d, i) => (
        <text key={i} x={x(d)} y={H - 8} fontSize="10" textAnchor="middle"
          fill="var(--ink3)" className="crc-svg-mono">{fmtDate(d)}</text>
      ))}
    </svg>
  );
}

/* How the buildable quantity climbs over time */
function BuildProfileChart({ profile, orderQty, t0, needBy, fullKit }) {
  if (!profile.length) return null;
  const W = 780, H = 208, L = 40, R = 58, T = 18, B = 32;
  const end = Math.max(fullKit.getTime(), needBy.getTime()) + 2 * DAY;
  const span = Math.max(end - t0.getTime(), 5 * DAY);
  const top = Math.max(orderQty, 1);
  const x = (t) => L + ((t - t0.getTime()) / span) * (W - L - R);
  const y = (v) => T + (1 - v / top) * (H - T - B);

  let path = `M ${x(profile[0].date.getTime())} ${y(profile[0].qty)}`;
  for (let i = 1; i < profile.length; i++) {
    path += ` L ${x(profile[i].date.getTime())} ${y(profile[i - 1].qty)}`;
    path += ` L ${x(profile[i].date.getTime())} ${y(profile[i].qty)}`;
  }
  path += ` L ${x(end)} ${y(profile[profile.length - 1].qty)}`;
  const area = `${path} L ${x(end)} ${y(0)} L ${x(profile[0].date.getTime())} ${y(0)} Z`;
  const yTicks = [0, Math.round(top / 2), top];
  const ticks = dateTicks(t0, end);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-svg" role="img"
      aria-label="Buildable quantity over time">
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="var(--rule-soft)" strokeWidth="1" />
          <text x={L - 7} y={y(v) + 3.5} fontSize="10" textAnchor="end"
            fill="var(--ink3)" className="crc-svg-mono">{v}</text>
        </g>
      ))}

      <line x1={L} y1={y(top)} x2={W - R} y2={y(top)} stroke="var(--ink3)"
        strokeWidth="1" strokeDasharray="3 3" />
      <text x={W - R + 6} y={y(top) + 3.5} fontSize="10" fill="var(--ink2)">order qty</text>

      <path d={area} fill="var(--signal)" opacity="0.12" />
      <path d={path} fill="none" stroke="var(--signal)" strokeWidth="2"
        strokeLinejoin="round" />

      <line x1={x(needBy.getTime())} y1={T - 8} x2={x(needBy.getTime())} y2={H - B}
        stroke="var(--ink)" strokeWidth="1.5" />
      <text
        x={x(needBy.getTime()) > L + (W - L - R) * 0.62 ? x(needBy.getTime()) - 5 : x(needBy.getTime()) + 5}
        y={T - 2}
        fontSize="10.5"
        textAnchor={x(needBy.getTime()) > L + (W - L - R) * 0.62 ? "end" : "start"}
        fill="var(--ink)"
      >
        Need by {fmtDate(needBy)}
      </text>

      {profile.map((p, i) => (
        <circle key={i} cx={x(p.date.getTime())} cy={y(p.qty)} r="3"
          fill="#fff" stroke="var(--signal)" strokeWidth="1.75">
          <title>{fmtDate(p.date)} — {p.qty} buildable</title>
        </circle>
      ))}

      {ticks.map((d, i) => (
        <text key={i} x={x(d.getTime())} y={H - 8} fontSize="10" textAnchor="middle"
          fill="var(--ink3)" className="crc-svg-mono">{fmtDate(d)}</text>
      ))}
    </svg>
  );
}

/* Each order from creation date to promised delivery */
function PoTimeline({ orders, t0, needBy }) {
  if (!orders.length) return null;
  const rows = [...orders].sort((a, b) => a.created - b.created);
  const min = Math.min(...rows.map((o) => o.created.getTime()));
  const max = Math.max(...rows.map((o) => o.date.getTime()), needBy.getTime());
  const start = min - 2 * DAY, end = max + 2 * DAY;
  const W = 780, LEFT = 132, RIGHT = 58, ROW = 24, TOP = 34;
  const plotW = W - LEFT - RIGHT;
  const H = TOP + rows.length * ROW + 30;
  const span = Math.max(end - start, 5 * DAY);
  const x = (t) => LEFT + ((t - start) / span) * plotW;
  const ticks = (() => {
    const step = Math.max(1, Math.round(span / DAY / 6));
    const out = [];
    for (let d = 0; d * DAY <= span; d += step) out.push(new Date(start + d * DAY));
    return out;
  })();
  const nbFlip = x(needBy.getTime()) > LEFT + plotW * 0.6;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-svg" role="img"
      aria-label="Purchase orders from creation date to delivery date">
      {ticks.map((d, i) => (
        <line key={i} x1={x(d.getTime())} y1={TOP - 8} x2={x(d.getTime())} y2={H - 24}
          stroke="var(--rule-soft)" strokeWidth="1" />
      ))}

      {/* today sits on the upper line, need-by on the lower, so they never collide */}
      <line x1={x(t0.getTime())} y1={TOP - 24} x2={x(t0.getTime())} y2={H - 24}
        stroke="var(--ink3)" strokeWidth="1" strokeDasharray="3 3" />
      <text x={x(t0.getTime())} y={TOP - 27} fontSize="10" textAnchor="middle" fill="var(--ink3)">today</text>

      <line x1={x(needBy.getTime())} y1={TOP - 14} x2={x(needBy.getTime())} y2={H - 24}
        stroke="var(--ink)" strokeWidth="1.5" />
      <text
        x={nbFlip ? x(needBy.getTime()) - 5 : x(needBy.getTime()) + 5}
        y={TOP - 6} fontSize="10.5"
        textAnchor={nbFlip ? "end" : "start"}
        fill="var(--ink)"
      >
        Need by {fmtDate(needBy)}
      </text>

      {rows.map((o, i) => {
        const y = TOP + i * ROW;
        const x1 = x(o.created.getTime());
        const x2 = Math.max(x(o.date.getTime()), x1 + 4);
        const color = o.openQty <= 0 ? "var(--rule)" : o.mode === "MRP" ? "var(--signal)" : "var(--caution)";
        const recvFrac = o.q > 0 ? o.received / o.q : 0;
        return (
          <g key={o.doc + o.item}>
            <text x={LEFT - 10} y={y + 11} fontSize="10.5" textAnchor="end"
              fill="var(--ink)" className="crc-svg-mono">{o.doc}</text>
            <rect x={x1} y={y + 2} width={x2 - x1} height="10" rx="1" fill={color} opacity={o.openQty <= 0 ? 0.5 : 1}>
              <title>{o.m} · {o.vendor} · created {fmtDate(o.created)}, due {fmtDate(o.date)}</title>
            </rect>
            {recvFrac > 0 && o.openQty > 0 && (
              <rect x={x1} y={y + 2} width={(x2 - x1) * recvFrac} height="10" rx="1" fill="var(--rule)" />
            )}
            <text x={x2 + 6} y={y + 11} fontSize="10"
              fill={o.date > needBy && o.openQty > 0 ? "var(--stop)" : "var(--ink3)"}
              className="crc-svg-mono">{fmtDate(o.date)}</text>
          </g>
        );
      })}

      {ticks.map((d, i) => (
        <text key={i} x={x(d.getTime())} y={H - 8} fontSize="10" textAnchor="middle"
          fill="var(--ink3)" className="crc-svg-mono">{fmtDate(d)}</text>
      ))}
    </svg>
  );
}

/* Demand below the axis, receipts above, projected stock walking across */
function DemandSupplyChart({ d }) {
  const rows = d.rows;
  if (!rows.length) return null;
  const W = 780, H = 250, L = 46, R = 46, T = 16, B = 34;
  const pw = W - L - R, ph = H - T - B;
  const maxBar = Math.max(1, ...rows.map((r) => Math.max(r.demand, r.supply)));
  const closings = rows.map((r) => r.closing);
  const hi = Math.max(maxBar, ...closings, d.safety);
  const lo = Math.min(0, ...closings);
  const span = Math.max(hi - lo, 1);
  const y = (v) => T + (1 - (v - lo) / span) * ph;
  const bw = pw / rows.length;
  const zero = y(0);

  const seg = [
    ["so", "#7C97AC"], ["pir", "#A9BCC9"], ["dep", "var(--caution)"], ["runDep", "#C6813A"],
  ];
  const sup = [
    ["planned", "#8FBFA6"], ["prod", "var(--go)"], ["purch", "#4E8C6E"], ["subcon", "#16706B"], ["run", "#C6813A"],
  ];

  const line = rows.map((r, i) => `${i === 0 ? "M" : "L"} ${L + bw * (i + 0.5)} ${y(r.closing)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-svg" role="img"
      aria-label={`Demand, supply and projected stock for ${d.mat}`}>
      {[hi, (hi + lo) / 2, lo].map((v, i) => (
        <g key={i}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="var(--rule-soft)" />
          <text x={L - 7} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="var(--ink3)"
            className="crc-svg-mono">{Math.round(v)}</text>
        </g>
      ))}
      <line x1={L} y1={zero} x2={W - R} y2={zero} stroke="var(--ink3)" strokeWidth="1" />
      {d.safety > 0 && (
        <>
          <line x1={L} y1={y(d.safety)} x2={W - R} y2={y(d.safety)} stroke="var(--caution)"
            strokeWidth="1" strokeDasharray="4 3" />
          <text x={W - R + 5} y={y(d.safety) + 3.5} fontSize="9.5" fill="var(--caution)">safety</text>
        </>
      )}

      {rows.map((r, i) => {
        const x = L + bw * i + bw * 0.18;
        const w = bw * 0.64;
        let dTop = zero, sTop = zero;
        return (
          <g key={r.label}>
            {seg.map(([k, c]) => {
              const v = r[k]; if (!v) return null;
              const h = (v / span) * ph; const yy = dTop; dTop += h;
              return <rect key={k} x={x} y={yy} width={w} height={Math.max(h, 0.6)} fill={c}>
                <title>{r.label} {k} {fmtQty(v, d.uom)}</title></rect>;
            })}
            {sup.map(([k, c]) => {
              const v = r[k]; if (!v) return null;
              const h = (v / span) * ph; sTop -= h;
              return <rect key={k} x={x} y={sTop} width={w} height={Math.max(h, 0.6)} fill={c}>
                <title>{r.label} {k} {fmtQty(v, d.uom)}</title></rect>;
            })}
          </g>
        );
      })}

      <path d={line} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
      {rows.map((r, i) => (
        <circle key={r.label} cx={L + bw * (i + 0.5)} cy={y(r.closing)} r="3.2"
          fill={r.closing < 0 ? "var(--stop)" : "#fff"} stroke="var(--ink)" strokeWidth="1.75">
          <title>{r.label} projected {fmtQty(r.closing, d.uom)} {d.uom}</title>
        </circle>
      ))}
      {rows.map((r, i) => (
        <text key={r.label} x={L + bw * (i + 0.5)} y={H - 8} fontSize="10" textAnchor="middle"
          fill="var(--ink3)" className="crc-svg-mono">{r.label}</text>
      ))}
    </svg>
  );
}

/* Committed load plus this run's load against available hours */
function CapacityChart({ c }) {
  const rows = c.rows;
  const W = 780, H = 210, L = 46, R = 52, T = 16, B = 32;
  const pw = W - L - R, ph = H - T - B;
  const top = Math.max(c.avail * 1.15, ...rows.map((r) => r.total), 1);
  const noCap = c.avail <= 0;
  const y = (v) => T + (1 - v / top) * ph;
  const bw = pw / rows.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-svg" role="img"
      aria-label={`Capacity load for ${c.id}`}>
      {[0, c.avail / 2, c.avail].map((v, i) => (
        <g key={i}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="var(--rule-soft)" />
          <text x={L - 7} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="var(--ink3)"
            className="crc-svg-mono">{Math.round(v)}</text>
        </g>
      ))}
      {!noCap && (
        <>
          <line x1={L} y1={y(c.avail)} x2={W - R} y2={y(c.avail)} stroke="var(--stop)"
            strokeWidth="1.5" strokeDasharray="4 3" />
          <text x={W - R + 5} y={y(c.avail) + 3.5} fontSize="9.5" fill="var(--stop)">available</text>
        </>
      )}

      {rows.map((r, i) => {
        const x = L + bw * i + bw * 0.2, w = bw * 0.6;
        const over = r.total > c.avail;
        const capH = Math.min(r.committed, c.avail);
        return (
          <g key={r.label}>
            <rect x={x} y={y(r.committed)} width={w} height={Math.max(y(0) - y(r.committed), 0)}
              fill={over ? "#8FA8C0" : "var(--signal)"}>
              <title>{r.label} committed {r.committed} h</title>
            </rect>
            {r.run > 0 && (
              <rect x={x} y={y(r.total)} width={w} height={Math.max(y(r.committed) - y(r.total), 0)} fill="#C6813A">
                <title>{r.label} this run {r.run} h</title>
              </rect>
            )}
            {over && (
              <rect x={x} y={y(r.total)} width={w} height={Math.max(y(c.avail) - y(r.total), 0)}
                fill="none" stroke="var(--stop)" strokeWidth="1.5">
                <title>{r.label} over by {r.over} h</title>
              </rect>
            )}
            <text x={x + w / 2} y={y(r.total) - 5} fontSize="10" textAnchor="middle"
              fill={over ? "var(--stop)" : "var(--ink3)"} className="crc-svg-mono">
              {r.pct === null ? (r.total > 0 ? `${r.total} h` : "") : `${r.pct}%`}
            </text>
          </g>
        );
      })}
      {rows.map((r, i) => (
        <text key={r.label} x={L + bw * (i + 0.5)} y={H - 8} fontSize="10" textAnchor="middle"
          fill="var(--ink3)" className="crc-svg-mono">{r.label}</text>
      ))}
    </svg>
  );
}

/* Which order sits on which work centre, and when */
function WorkCentreGantt({ centres, weeks, t0 }) {
  const rows = [];
  for (const c of centres) {
    const lanes = [];
    for (const d of [...c.drivers].sort((a, b) => a.start - b.start)) {
      let li = lanes.findIndex((l) => l[l.length - 1].finish < d.start);
      if (li < 0) { lanes.push([d]); li = lanes.length - 1; } else lanes[li].push(d);
    }
    if (!lanes.length) lanes.push([]);
    lanes.forEach((l, i) => rows.push({ centre: c, lane: l, first: i === 0, laneCount: lanes.length }));
  }
  if (!rows.length) return null;

  const start = weeks[0].from.getTime();
  const end = weeks[weeks.length - 1].to.getTime() + DAY;
  const span = end - start;
  const W = 780, LEFT = 118, RIGHT = 12, ROW = 22, TOP = 30;
  const pw = W - LEFT - RIGHT;
  const H = TOP + rows.length * ROW + 26;
  const x = (d) => LEFT + Math.min(1, Math.max(0, (d.getTime() - start) / span)) * pw;

  const colour = (d) =>
    d.kind === "this run" ? "#C6813A"
    : d.kind === "planned" ? "#A9BCC9"
    : d.kind === "planned firmed" ? "#7C97AC"
    : d.missing ? "var(--stop)"
    : d.released ? "var(--signal)"
    : "#8FA8C0";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-svg" role="img"
      aria-label="Production orders by work centre over time">
      {weeks.map((w) => (
        <g key={w.label}>
          <line x1={x(w.from)} y1={TOP - 14} x2={x(w.from)} y2={H - 20} stroke="var(--rule-soft)" />
          <text x={x(w.from) + 4} y={TOP - 17} fontSize="10" fill="var(--ink3)" className="crc-svg-mono">{w.label}</text>
        </g>
      ))}
      <line x1={x(t0)} y1={TOP - 20} x2={x(t0)} y2={H - 20} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="3 2" />
      <text x={x(t0) + 4} y={TOP - 23} fontSize="10" fill="var(--ink)">today</text>

      {rows.map((r, i) => {
        const y = TOP + i * ROW;
        return (
          <g key={r.centre.id + i}>
            {r.first && (
              <>
                <line x1={4} y1={y - 3} x2={W - RIGHT} y2={y - 3} stroke="var(--rule)" />
                <text x={LEFT - 8} y={y + 11} fontSize="10.5" textAnchor="end" fill="var(--ink)"
                  className="crc-svg-mono">{r.centre.id}</text>
                <text x={LEFT - 8} y={y + 21} fontSize="9" textAnchor="end" fill="var(--ink3)">
                  {r.centre.avail} h/wk
                </text>
              </>
            )}
            {r.lane.map((d, j) => {
              const x1 = x(d.start), x2 = Math.max(x(d.finish), x1 + 8);
              const label = `${d.ref} · ${d.qty}`;
              return (
                <g key={j}>
                  <rect x={x1} y={y + 2} width={x2 - x1} height="14" rx="2" fill={colour(d)}>
                    <title>{d.ref} · {d.material} · {d.qty} units · {d.hours} h · {fmtDate(d.start)} to {fmtDate(d.finish)}{d.missing ? " · missing parts" : ""}</title>
                  </rect>
                  {x2 - x1 > label.length * 5.4 && (
                    <text x={x1 + 5} y={y + 12.5} fontSize="9.5" fill="#fff" className="crc-svg-mono">{label}</text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/* Built against shipped, week by week, with the running gap */
function FlowChart({ flow, t0 }) {
  const rows = flow.rows;
  const W = 780, H = 240, L = 46, R = 50, T = 18, B = 40;
  const pw = W - L - R, ph = H - T - B;
  const top = Math.max(1, ...rows.map((r) => Math.max(r.out, r.ship)));
  const cums = rows.map((r) => r.cum);
  const cHi = Math.max(0, ...cums), cLo = Math.min(0, ...cums);
  const cSpan = Math.max(cHi - cLo, 1);
  const y = (v) => T + (1 - v / top) * ph;
  const cy = (v) => T + (1 - (v - cLo) / cSpan) * ph;
  const bw = pw / rows.length;
  const line = rows.map((r, i) => `${i === 0 ? "M" : "L"} ${L + bw * (i + 0.5)} ${cy(r.cum)}`).join(" ");
  const firstFwd = rows.findIndex((r) => !r.past);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-svg" role="img" aria-label="Production against dispatch by week">
      {[0, top / 2, top].map((v, i) => (
        <g key={i}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="var(--rule-soft)" />
          <text x={L - 7} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="var(--ink3)"
            className="crc-svg-mono">{Math.round(v)}</text>
        </g>
      ))}
      {firstFwd > 0 && (
        <>
          <line x1={L + bw * firstFwd} y1={T - 10} x2={L + bw * firstFwd} y2={H - B}
            stroke="var(--ink)" strokeWidth="1.5" />
          <text x={L + bw * firstFwd - 4} y={T - 3} fontSize="10" textAnchor="end" fill="var(--ink)">actual</text>
          <text x={L + bw * firstFwd + 4} y={T - 3} fontSize="10" fill="var(--ink3)">planned</text>
        </>
      )}
      {rows.map((r, i) => {
        const xb = L + bw * i + bw * 0.14, w = bw * 0.34;
        return (
          <g key={r.label}>
            <rect x={xb} y={y(r.out)} width={w} height={Math.max(y(0) - y(r.out), 0)}
              fill={r.past ? "var(--go)" : "#8FBFA6"}>
              <title>{r.label} built {r.out}</title>
            </rect>
            <rect x={xb + w + 2} y={y(r.ship)} width={w} height={Math.max(y(0) - y(r.ship), 0)}
              fill={r.past ? "#7C97AC" : "#B4C6D2"}>
              <title>{r.label} shipped {r.ship}</title>
            </rect>
          </g>
        );
      })}
      <path d={line} fill="none" stroke="var(--caution)" strokeWidth="2" strokeLinejoin="round" />
      {rows.map((r, i) => (
        <circle key={r.label} cx={L + bw * (i + 0.5)} cy={cy(r.cum)} r="2.8" fill="#fff"
          stroke="var(--caution)" strokeWidth="1.6">
          <title>{r.label} cumulative {r.cum > 0 ? "+" : ""}{r.cum}</title>
        </circle>
      ))}
      <text x={W - R + 5} y={cy(cums[cums.length - 1]) + 3.5} fontSize="9.5" fill="var(--caution)">net</text>
      {rows.map((r, i) => (
        <text key={r.label} x={L + bw * (i + 0.5)} y={H - 8} fontSize="9.5" textAnchor="middle"
          fill={r.past ? "var(--ink3)" : "var(--ink2)"} className="crc-svg-mono">{r.label}</text>
      ))}
    </svg>
  );
}

/* Order book outcome */
function Donut({ slices, unit }) {
  const total = slices.reduce((a, s) => a + s.qty, 0);
  if (!total) return null;
  const S = 190, cx = S / 2, cy = S / 2, rOut = 78, rIn = 48;
  let angle = -Math.PI / 2;
  const arc = (frac) => {
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
    return `M ${p(rOut, a0)} A ${rOut} ${rOut} 0 ${big} 1 ${p(rOut, a1)} L ${p(rIn, a1)} A ${rIn} ${rIn} 0 ${big} 0 ${p(rIn, a0)} Z`;
  };
  return (
    <div className="crc-donutwrap">
      <svg viewBox={`0 0 ${S} ${S}`} className="crc-donut" role="img" aria-label="Order book outcome">
        {slices.map((s) => (
          <path key={s.key} d={arc(s.qty / total)} fill={s.color} stroke="#fff" strokeWidth="1.5">
            <title>{s.label} — {fmtQty(s.qty, unit)} {unit}, {Math.round((s.qty / total) * 100)}%</title>
          </path>
        ))}
        <text x={cx} y={cy - 2} fontSize="22" fontWeight="600" textAnchor="middle"
          fill="var(--ink)" className="crc-svg-mono">{fmtQty(total, unit)}</text>
        <text x={cx} y={cy + 14} fontSize="10" textAnchor="middle" fill="var(--ink3)">{unit} in the book</text>
      </svg>
      <ul className="crc-donutkey">
        {slices.map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} />
            <span className="crc-donutkey-l">{s.label}</span>
            <span className="crc-donutkey-v">{fmtQty(s.qty, unit)}</span>
            <span className="crc-donutkey-p">{Math.round((s.qty / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Monthly consumption, with the unplanned share stacked on top and the average across */
function ConsumptionChart({ h }) {
  const rows = h.periods;
  const W = 780, H = 210, L = 46, R = 46, T = 18, B = 34;
  const pw = W - L - R, ph = H - T - B;
  const top = Math.max(1, ...rows.map((r) => r.total), h.avg);
  const y = (v) => T + (1 - v / top) * ph;
  const bw = pw / rows.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-svg" role="img"
      aria-label={`Monthly consumption of ${h.mat}`}>
      {[0, top / 2, top].map((v, i) => (
        <g key={i}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="var(--rule-soft)" />
          <text x={L - 7} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="var(--ink3)"
            className="crc-svg-mono">{Math.round(v)}</text>
        </g>
      ))}
      <line x1={L} y1={y(h.avg)} x2={W - R} y2={y(h.avg)} stroke="var(--ink)"
        strokeWidth="1.5" strokeDasharray="4 3" />
      <text x={W - R + 5} y={y(h.avg) + 3.5} fontSize="9.5" fill="var(--ink2)">avg</text>

      {rows.map((r, i) => {
        const x = L + bw * i + bw * 0.2, w = bw * 0.6;
        return (
          <g key={r.key}>
            <rect x={x} y={y(r.planned)} width={w} height={Math.max(y(0) - y(r.planned), 0)}
              fill={r.current ? "#A9BCC9" : "var(--signal)"}>
              <title>{r.label} planned {fmtQty(r.planned, h.uom)}</title>
            </rect>
            {r.unplanned > 0 && (
              <rect x={x} y={y(r.total)} width={w} height={Math.max(y(r.planned) - y(r.total), 0)}
                fill="var(--caution)">
                <title>{r.label} unplanned {fmtQty(r.unplanned, h.uom)}</title>
              </rect>
            )}
          </g>
        );
      })}
      {rows.map((r, i) => (
        <text key={r.key} x={L + bw * (i + 0.5)} y={H - 8} fontSize="9.5" textAnchor="middle"
          fill={r.current ? "var(--ink3)" : "var(--ink2)"} className="crc-svg-mono">
          {r.label}{r.current ? "*" : ""}
        </text>
      ))}
    </svg>
  );
}

/* Twelve periods at a glance, on the material's own scale */
function ConsumptionSpark({ h }) {
  const rows = h.periods;
  const W = 240, H = 56, P = 3;
  const top = Math.max(1, ...rows.map((r) => r.total));
  const bw = (W - P * 2) / rows.length;
  const y = (v) => P + (1 - v / top) * (H - P * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-sparksvg" role="img"
      aria-label={`Consumption trend for ${h.mat}`}>
      <line x1={P} y1={y(h.avg)} x2={W - P} y2={y(h.avg)} stroke="var(--ink3)"
        strokeWidth="1" strokeDasharray="3 3" />
      {rows.map((r, i) => {
        const x = P + bw * i + bw * 0.16, w = bw * 0.68;
        return (
          <g key={r.key}>
            <rect x={x} y={y(r.planned)} width={w} height={Math.max(y(0) - y(r.planned), 0)}
              fill={r.current ? "#A9BCC9" : "var(--signal)"} />
            {r.unplanned > 0 && (
              <rect x={x} y={y(r.total)} width={w} height={Math.max(y(r.planned) - y(r.total), 0)}
                fill="var(--caution)" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* Backward schedule drawn along a date axis */
function ScheduleChain({ schedule, t0 }) {
  const steps = [...schedule.steps].sort((a, b) => a.d - b.d);
  const first = Math.min(steps[0].d.getTime(), t0.getTime());
  const last = steps[steps.length - 1].d.getTime();
  const span = Math.max(last - first, 5 * DAY);
  const W = 780, H = 108, L = 14, R = 14, Y = 62;
  const pw = W - L - R;
  const x = (d) => L + ((d.getTime() - first) / span) * pw;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-svg" role="img" aria-label="Backward schedule">
      <line x1={L} y1={Y} x2={W - R} y2={Y} stroke="var(--rule)" strokeWidth="2" />
      <line x1={x(schedule.needBy)} y1={Y - 4} x2={x(schedule.delivery)} y2={Y - 4}
        stroke="var(--signal)" strokeWidth="4" strokeLinecap="round" />
      <line x1={x(t0)} y1={20} x2={x(t0)} y2={H - 14} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="3 2" />
      <text x={x(t0)} y={16} fontSize="10" textAnchor="middle" fill="var(--ink)">today</text>

      {steps.map((st, i) => {
        const key = st.k === "Production start" || st.k === "Customer delivery date";
        const up = i % 2 === 0;
        const ly = up ? Y - 16 : Y + 26;
        const late = st.d < t0;
        return (
          <g key={st.k}>
            <circle cx={x(st.d)} cy={Y} r={key ? 5.5 : 3.5}
              fill={late ? "var(--stop)" : key ? "var(--signal)" : "#fff"}
              stroke={late ? "var(--stop)" : "var(--signal)"} strokeWidth="1.8" />
            <text x={x(st.d)} y={ly} fontSize="9.5" textAnchor="middle"
              fill={late ? "var(--stop)" : "var(--ink2)"}>{st.k}</text>
            <text x={x(st.d)} y={ly + (up ? -10 : 11)} fontSize="9.5" textAnchor="middle"
              fill={late ? "var(--stop)" : "var(--ink3)"} className="crc-svg-mono">{fmtDate(st.d)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* The summary as plain text, for pasting into an email or a meeting note */
function summaryText({ summary, programme, t0, weeks, ai }) {
  const L = [];
  L.push("COMPONENT READINESS AND CAPACITY REPORT");
  L.push(`Generated ${fmtDateLong(t0)}`);
  L.push(`Plants ${programme.plants.join(", ")} · horizon ${weeks.length} weeks to ${fmtDateLong(weeks[weeks.length - 1].to)}`);
  L.push("");
  L.push("1. THE PLAN");
  programme.lines.forEach((l) => {
    L.push(`   Line ${l.seq}: ${l.fg} x${l.qty} at plant ${l.plant}` +
      (l.so ? ` for sales order ${l.so.doc}/${l.so.item}, ${l.so.customer}` : " (planner entry)"));
    L.push(`      Customer wants ${fmtDateLong(l.delivery)}` +
      (l.master.ok ? ` · production must start ${fmtDateLong(l.needBy)}${l.startsInPast ? " (ALREADY PASSED)" : ""}` : " · cannot be exploded"));
    if (l.master.ok) L.push(`      ${Math.min(l.result.buildable, l.qty)} of ${l.qty} buildable today · ${l.result.shortLines.length ? `full kit ${fmtDateLong(l.result.fullKit)}` : "kit complete"} · ${l.result.verdict}`);
  });
  L.push("");
  L.push("2. HEADLINE");
  L.push(`   ${summary.headline}`);
  L.push("");
  L.push("3. KEY READINGS");
  summary.stats.forEach((st) => L.push(`   ${st.k}: ${st.v} — ${st.s}`));
  L.push("");
  L.push("4. FINDINGS");
  ["critical", "warning", "watch"].forEach((sev) => {
    const grp = summary.issues.filter((i) => i.sev === sev);
    if (!grp.length) return;
    L.push(`   ${sev === "critical" ? "ACT TODAY" : sev === "warning" ? "THIS WEEK" : "WATCH"} (${grp.length})`);
    grp.forEach((i, n) => {
      L.push(`   ${n + 1}. [${i.area}] ${i.headline}`);
      L.push(`      ${i.detail}`);
    });
    L.push("");
  });
  if (ai) {
    L.push("5. BRIEFING");
    L.push(`   ${ai.headline}`);
    if (ai.situation) L.push(`   ${ai.situation}`);
    if (ai.decision) L.push(`   DECISION NEEDED: ${ai.decision}`);
    [["today", "Today"], ["thisWeek", "Later this week"]].forEach(([k, label]) => {
      if (!(ai[k] || []).length) return;
      L.push(`   ${label}:`);
      ai[k].forEach((a, n) => L.push(`      ${n + 1}. ${a.action} — ${a.owner}. ${a.why}`));
    });
    if ((ai.watch || []).length) { L.push("   Watch:"); ai.watch.forEach((w) => L.push(`      - ${w}`)); }
  }
  L.push("");
  L.push("Figures are a snapshot. Capacity is rough-cut and does not sequence operations.");
  return L.join("\n");
}

/* Exactly what is where, and how much of it can actually be issued today */
function stockPicture(mat, plant, slocSet, rules, pool, held) {
  const rows = STOCK.filter((r) => r.m === mat && r.p === plant);
  const byLoc = {};
  for (const s of SLOCS) byLoc[s.code] = rows.filter((r) => r.s === s.code).reduce((a, r) => a + r.q, 0);

  const cat = (type) => SLOCS.filter((s) => s.type === type).reduce((a, s) => a + byLoc[s.code], 0);
  const unrestricted = cat("Unrestricted");
  const quality = cat("Quality hold");
  const blocked = cat("Blocked");
  const transit = cat("In transit");
  const staged = cat("Staged for dispatch");
  const atVendor = (held || []).filter((v) => v.code === mat).reduce((a, v) => a + v.qty, 0);

  const counted = SLOCS.filter((s) => slocSet.has(s.code)).reduce((a, s) => a + byLoc[s.code], 0);
  const excluded = SLOCS.filter((s) => !slocSet.has(s.code)).reduce((a, s) => a + byLoc[s.code], 0);
  const { reserved, allocated, available } = availableOf(mat, plant, slocSet, rules, null, pool);

  const totalOwned = r3(counted + excluded + atVendor);
  return {
    mat, plant, uom: matInfo(mat).uom, desc: matInfo(mat).desc,
    byLoc, unrestricted, quality, blocked, transit, staged, atVendor,
    counted, excluded, reserved, allocated, available, totalOwned,
    issuableNow: r3(Math.max(0, counted - reserved)),
    notIssuable: r3(excluded + atVendor),
  };
}

/* Jump bar for screens that stack several panels, plus a way back up */
function ScreenNav({ sections }) {
  const go = (id) => {
    const el = typeof document !== "undefined" && document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  if (!sections.length) return null;
  return (
    <nav className="crc-jump" aria-label="Sections on this screen">
      <span className="crc-jump-l">On this screen</span>
      {sections.map((sec) => (
        <button key={sec.id} className="crc-jumpbtn" onClick={() => go(sec.id)}>
          {sec.label}
          {sec.count != null && <span className="crc-jumpcount">{sec.count}</span>}
        </button>
      ))}
    </nav>
  );
}

function ScrollTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 420);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!show) return null;
  return (
    <button className="crc-totop" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      title="Back to the top">↑<span>Top</span></button>
  );
}

/* Material entry: pick from the list or type a code that is not in it */
function MaterialInput({ value, onChange, options, state }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const picked = useRef(false);

  useEffect(() => { setText(value); }, [value]);

  const q = text.trim().toUpperCase();
  const matches = options
    .filter((o) => !q || o.code.toUpperCase().includes(q) || o.desc.toUpperCase().includes(q))
    .slice(0, 8);

  const commit = (v) => {
    const t = v.trim().toUpperCase();
    setText(t);
    if (t !== value) onChange(t);
    setOpen(false);
  };

  return (
    <div className="crc-combo">
      <input
        className={`crc-inline crc-combo-in ${state === "missing" ? "crc-combo-bad" : state === "nobom" ? "crc-combo-warn" : ""}`}
        value={text}
        spellCheck={false}
        placeholder="Type a material or pick one"
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { if (picked.current) { picked.current = false; return; } commit(text); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit(text); e.currentTarget.blur(); }
          if (e.key === "Escape") { setText(value); setOpen(false); }
        }}
      />
      <button
        className="crc-combo-toggle"
        tabIndex={-1}
        title="Show materials"
        onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o); }}
      >▾</button>
      {open && matches.length > 0 && (
        <ul className="crc-combo-list">
          {matches.map((o) => (
            <li key={o.code}>
              <button
                onMouseDown={(e) => { e.preventDefault(); picked.current = true; commit(o.code); }}
              >
                <span className="crc-mono">{o.code}</span>
                <span className="crc-combo-desc">{o.desc}</span>
                <span className="crc-combo-kind">{o.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* Proportional strip of component states */
function CompletenessStrip({ lines }) {
  const leaves = lines.filter((l) => !l.isAssembly);
  const n = leaves.length || 1;
  const parts = [
    { k: "ok", n: leaves.filter((l) => l.status === "ok").length, c: "var(--go)", label: "available" },
    { k: "coverable", n: leaves.filter((l) => l.status === "coverable").length, c: "var(--caution)", label: "recoverable" },
    { k: "late", n: leaves.filter((l) => l.status === "late").length, c: "var(--stop)", label: "will delay" },
  ].filter((p) => p.n > 0);

  return (
    <div className="crc-strip">
      <div className="crc-strip-bar">
        {parts.map((p) => (
          <div key={p.k} className="crc-strip-seg" style={{ width: `${(p.n / n) * 100}%`, background: p.c }}
            title={`${p.n} ${p.label}`} />
        ))}
      </div>
      <div className="crc-strip-key">
        {parts.map((p) => (
          <span key={p.k}><i style={{ background: p.c }} />{p.n} {p.label}</span>
        ))}
      </div>
    </div>
  );
}

/* Shortfall as a share of requirement, worst first */
function ShortfallBars({ lines }) {
  if (!lines.length) return null;
  const rows = [...lines]
    .map((l) => ({ ...l, pct: l.required > 0 ? (l.shortage / l.required) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct);
  return (
    <div className="crc-sfbars">
      {rows.map((l) => (
        <div key={l.code} className="crc-sfrow">
          <span className="crc-sf-code">{l.code}</span>
          <div className="crc-sf-track">
            <div className="crc-sf-fill"
              style={{ width: `${Math.min(100, l.pct)}%`, background: l.status === "late" ? "var(--stop)" : "var(--caution)" }} />
          </div>
          <span className="crc-sf-pct">{Math.round(l.pct)}%</span>
          <span className="crc-sf-qty">{fmtQty(l.shortage, l.uom)} {l.uom} short</span>
        </div>
      ))}
    </div>
  );
}

/* Legend shared by the schedule charts */
function KindLegend({ kinds }) {
  return (
    <div className="crc-key">
      {kinds.map((k) => (
        <span key={k}><i style={{ background: KIND_COLOR[k] }} />{KIND_LABEL[k]}</span>
      ))}
    </div>
  );
}

/* Indented BOM structure with per-node coverage */
function BomTree({ nodes, depth = 0 }) {
  return (
    <ul className={depth === 0 ? "crc-tree" : "crc-tree crc-tree-sub"}>
      {nodes.map((n) => (
        <li key={n.code + n.level} className="crc-tnode">
          <div className={`crc-tcard crc-t-${n.status}`}>
            <div className="crc-tcard-id">
              <span className="crc-matcode">{n.code}</span>
              <span className="crc-matdesc">{n.desc}</span>
            </div>
            <div className="crc-tcard-figs">
              <CoverageBar available={n.available} required={n.required} status={n.status} />
              <span className="crc-tqty">
                {fmtQty(n.available, n.uom)} of {fmtQty(n.required, n.uom)} {n.uom}
              </span>
              {n.shortage > 0 && !n.isAssembly && (
                <span className="crc-tshort">short {fmtQty(n.shortage, n.uom)}</span>
              )}
              <StatusTag status={n.status} />
            </div>
          </div>
          {n.children.length > 0 && <BomTree nodes={n.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function toTree(lines) {
  const roots = [];
  const stack = [];
  for (const l of lines) {
    const node = { ...l, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/* ============================================================
   SMALL UI PIECES
   ============================================================ */

const StatusTag = ({ status }) => {
  const map = {
    ok: { t: "Available", c: "go" },
    coverable: { t: "Recoverable", c: "caution" },
    late: { t: "Will delay", c: "stop" },
    assembly: { t: "Explodes down", c: "signal" },
  };
  const v = map[status] || map.ok;
  return <span className={`crc-tag crc-tag-${v.c}`}>{v.t}</span>;
};

function Section({ title, hint, children, id }) {
  return (
    <div className="crc-section" id={id}>
      <div className="crc-section-head">
        <h3>{title}</h3>
        {hint && <span className="crc-section-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* Coverage timeline inside an expanded shortage card */
function Timeline({ t0, needBy, steps }) {
  const last = steps.length ? Math.max(...steps.map((s) => s.eta.getTime())) : needBy.getTime();
  const end = Math.max(last, needBy.getTime()) + 2 * DAY;
  const span = Math.max(end - t0.getTime(), 7 * DAY);
  const pct = (d) => Math.min(100, Math.max(0, ((d.getTime() - t0.getTime()) / span) * 100));

  let cursor = t0;
  const segs = [...steps].sort((a, b) => a.eta - b.eta).map((s) => {
    const seg = { from: cursor, to: s.eta, kind: s.kind, step: s };
    if (s.eta > cursor) cursor = s.eta;
    return seg;
  });

  return (
    <div className="crc-timeline">
      <div className="crc-tl-track">
        {segs.map((s, i) => (
          <div
            key={i}
            className="crc-tl-seg"
            style={{
              left: `${pct(s.from)}%`,
              width: `${Math.max(pct(s.to) - pct(s.from), 1.5)}%`,
              background: KIND_COLOR[s.kind],
            }}
            title={`${KIND_LABEL[s.kind]} — ready ${fmtDate(s.to)}`}
          />
        ))}
        <div className="crc-tl-need" style={{ left: `${pct(needBy)}%` }}>
          <span className="crc-tl-need-label">Need by {fmtDate(needBy)}</span>
        </div>
      </div>
      <div className="crc-tl-scale">
        <span>Today</span>
        <span>{fmtDate(new Date(t0.getTime() + span))}</span>
      </div>
    </div>
  );
}

/* ============================================================
   MAIN
   ============================================================ */

export default function ComponentReadinessCheck() {
  const t0 = today();

  const [demand, setDemand] = useState(() => [
    { key: 1, so: "45000874/20", fg: "FG-PUMP-100", qty: 18, plant: "1000", version: "AUTO", deliveryISO: toISO(addDays(t0, 19)) },
    { key: 2, so: "45000878/10", fg: "FG-PUMP-100", qty: 15, plant: "1000", version: "AUTO", deliveryISO: toISO(addDays(t0, 26)) },
    { key: 3, so: "45000889/20", fg: "FG-GEAR-200", qty: 14, plant: "1100", version: "AUTO", deliveryISO: toISO(addDays(t0, 30)) },
  ]);
  const [selected, setSelected] = useState(0);

  const [resPolicy, setResPolicy] = useState("all");
  const [excludePegged, setExcludePegged] = useState(true);
  const [included, setIncluded] = useState(
    () => new Set(SLOCS.filter((s) => s.defaultIn).map((s) => s.code))
  );
  /* Batches and work centres are marked in and out here, not on a separate input screen */
  const [batchOut, setBatchOut] = useState(() => defaultBatchExclusions());
  const [wcOut, setWcOut] = useState(() => new Set());
  const [tab, setTab] = useState("run");
  const [bomView, setBomView] = useState("table");
  const [poFilter, setPoFilter] = useState("open");
  const [expanded, setExpanded] = useState(null);

  const [aiSummary, setAiSummary] = useState(null);
  const [sumBusy, setSumBusy] = useState(false);
  const [sumError, setSumError] = useState(null);
  const [aiPlan, setAiPlan] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);

  const parseISO = (s) => {
    const d = new Date(s + "T00:00:00");
    return isNaN(d.getTime()) ? addDays(t0, 10) : d;
  };

  /* Lines are allocated stock in list order, so position is priority */
  const programme = useMemo(
    () => runProgramme({
      demand: demand.map((d) => ({ ...d, qty: Number(d.qty) || 0, delivery: parseISO(d.deliveryISO) })),
      slocSet: included,
      resPolicy,
      excludePegged,
      batchOut,
      wcOut,
    }),
    [demand, included, resPolicy, excludePegged, batchOut, wcOut]
  );

  const contended = useMemo(() => contention(programme), [programme]);

  const weeks = useMemo(() => weekBuckets(t0, 8), [t0]);

  /* The run is a receipt on each finished good and dependent demand on its components */
  const runFlows = useMemo(() => {
    const ok = programme.lines.filter((l) => l.master.ok);
    return {
      supply: ok.map((l) => ({ m: l.fg, p: l.plant, date: l.needBy, qty: l.qty })),
      dependent: ok.flatMap((l) => l.result.lines.map((x) => ({ m: x.code, p: l.plant, date: l.needBy, qty: x.required }))),
    };
  }, [programme]);

  const selIdx = Math.min(selected, programme.lines.length - 1);
  const sel = programme.lines[selIdx];

  // the rest of the screen reports on whichever line is selected
  const fgCode = sel.fg;
  const orderQty = sel.qty;
  const plant = sel.plant;
  const needBy = sel.needBy;
  const result = sel.result;
  const profile = sel.profile;

  const patchLine = (key, patch) => {
    setDemand((d) => d.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setAiPlan(null);
    setExpanded(null);
  };
  const nextKey = () => Math.max(0, ...demand.map((x) => x.key)) + 1;
  const addLine = () => {
    const fresh = FINISHED_GOODS.find((f) => !demand.some((d) => d.fg === f.code)) || FINISHED_GOODS[0];
    setDemand((d) => [...d, { key: nextKey(), so: null, fg: fresh.code, qty: fresh.defaultQty, plant: fresh.plant, version: "AUTO", deliveryISO: toISO(addDays(t0, 21)) }]);
    setAiPlan(null);
  };
  /* Taking a line from a sales order brings its material, plant, quantity and delivery date */
  const addFromSO = (ref) => {
    const so = SALES_ORDERS.find((x) => `${x.doc}/${x.item}` === ref);
    if (!so) return;
    setDemand((d) => [...d, {
      key: nextKey(), so: ref, fg: so.m, qty: so.qty, plant: so.p, version: "AUTO",
      deliveryISO: toISO(addDays(t0, so.reqOffset)),
    }]);
    setAiPlan(null);
  };
  const attachSO = (key, ref) => {
    if (!ref) { patchLine(key, { so: null }); return; }
    const so = SALES_ORDERS.find((x) => `${x.doc}/${x.item}` === ref);
    if (so) patchLine(key, { so: ref, fg: so.m, qty: so.qty, plant: so.p, version: "AUTO", deliveryISO: toISO(addDays(t0, so.reqOffset)) });
  };
  const removeLine = (key) => {
    if (demand.length <= 1) return;
    setDemand((d) => d.filter((x) => x.key !== key));
    setSelected(0);
    setAiPlan(null);
    setExpanded(null);
  };
  const moveLine = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= demand.length) return;
    setDemand((d) => { const n = [...d]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setSelected((s) => (s === i ? j : s === j ? i : s));
    setAiPlan(null);
    setExpanded(null);
  };

  const toggleBatch = (key) => {
    setBatchOut((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
    setAiPlan(null); setAiSummary(null);
  };
  const toggleWc = (id) => {
    setWcOut((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setAiPlan(null); setAiSummary(null);
  };

  const toggleSloc = (code) => {
    setIncluded((prev) => {
      const n = new Set(prev);
      n.has(code) ? n.delete(code) : n.add(code);
      return n;
    });
    setAiPlan(null);
  };

  // materials touched by this explosion, for the stock matrix
  const touched = useMemo(() => {
    const seen = [];
    for (const l of result.lines) if (!seen.includes(l.code)) seen.push(l.code);
    return seen;
  }, [result]);

  // number of materials in this explosion that hold stock in each location
  const slocCounts = useMemo(() => {
    const out = {};
    for (const s of SLOCS) {
      out[s.code] = touched.filter((m) =>
        STOCK.some((r) => r.m === m && r.p === plant && r.s === s.code && r.q > 0)
      ).length;
    }
    return out;
  }, [touched, plant]);

  const excludedVisible = useMemo(
    () => result.lines.reduce((a, l) => a + (l.exclQty > 0 ? 1 : 0), 0),
    [result]
  );

  // everything competing with this order: open reservations and supply already pegged by MRP
  const commitments = useMemo(() => {
    const rules = { t0, needBy, resPolicy, excludePegged };
    const resv = [];
    const supply = [];
    for (const m of touched) {
      for (const r of openReservations(m, plant, t0)) {
        const counted =
          resPolicy === "none" ? false : resPolicy === "horizon" ? r.date <= needBy : true;
        resv.push({ ...r, uom: MATERIALS[m].uom, counted });
      }
      for (const s of allSupply(m, plant, rules)) supply.push({ ...s, uom: MATERIALS[s.m].uom });
    }
    resv.sort((a, b) => a.date - b.date);
    supply.sort((a, b) => a.date - b.date);
    return { resv, supply };
  }, [touched, plant, resPolicy, excludePegged, needBy, t0]);

  const shopFloor = useMemo(() => {
    const rules = { t0, needBy, resPolicy, excludePegged };
    return {
      orders: prodOrders(plant, rules),
      moves: goodsMovements(plant, rules, null),
    };
  }, [plant, needBy, resPolicy, excludePegged, t0]);

  const subcon = useMemo(() => {
    const rules = { t0, needBy, resPolicy, excludePegged };
    return { orders: subconOrders(plant, rules), held: vendorStockAll(plant, rules) };
  }, [plant, needBy, resPolicy, excludePegged, t0]);

  const horizonRules = useMemo(
    () => ({ t0, needBy, resPolicy, excludePegged, batchOut, wcOut }),
    [t0, needBy, resPolicy, excludePegged, batchOut, wcOut]
  );

  const [dsPick, setDsPick] = useState(null);
  const [scope, setScope] = useState("line");
  /* Everything below the run follows the finished good selected above,
     unless the planner widens it to the whole run. */
  const scopeMats = useMemo(() => {
    const src = scope === "line" ? [sel] : programme.lines;
    const seen = [];
    for (const L of src) {
      if (!L.master.ok) continue;
      if (!seen.some((x) => x.m === L.fg && x.p === L.plant)) seen.push({ m: L.fg, p: L.plant, isFG: true });
      for (const x of L.result.lines) if (!seen.some((y) => y.m === x.code && y.p === L.plant)) seen.push({ m: x.code, p: L.plant, isFG: false });
    }
    return seen;
  }, [scope, sel, programme]);

  const scopeFGs = useMemo(() => scopeMats.filter((x) => x.isFG), [scopeMats]);
  const scopePlants = useMemo(() => [...new Set(scopeMats.map((x) => x.p))], [scopeMats]);
  const scopeLines = useMemo(
    () => (scope === "line" ? [sel] : programme.lines).filter((l) => l.master.ok),
    [scope, sel, programme]
  );

  const projectionSet = useMemo(
    () => scopeMats.map((x) => demandSupply(x.m, x.p, horizonRules, weeks, included, runFlows)),
    [scopeMats, horizonRules, weeks, included, runFlows]
  );

  /* the charted material, defaulting to the selected line's finished good */
  const projection =
    projectionSet.find((d) => `${d.mat}|${d.plant}` === dsPick) ||
    projectionSet.find((d) => d.mat === fgCode && d.plant === plant) ||
    projectionSet[0] ||
    demandSupply(fgCode, plant, horizonRules, weeks, included, runFlows);

  /* Work centres the scoped materials actually touch, so the capacity view narrows too */
  const capacityAll = useMemo(() => {
    const all = scopePlants.flatMap((pl) => capacityLoad(pl, horizonRules, weeks, programme.lines));
    if (scope !== "line") return all;
    const mats = new Set(scopeMats.map((x) => x.m));
    return all.filter((c) => c.drivers.some((d) => mats.has(d.material)));
  }, [scope, scopeMats, scopePlants, horizonRules, weeks, programme]);

  const risk = useMemo(() => {
    const all = scopePlants.flatMap((pl) => deliveryRisk(pl, horizonRules, weeks, included, runFlows));
    const fgs = new Set(scopeFGs.map((x) => x.m));
    return scope === "line" ? all.filter((r) => fgs.has(r.material)) : all;
  }, [scope, scopeFGs, scopePlants, horizonRules, weeks, included, runFlows]);

  /* Production against dispatch looks back four weeks as well as forward */
  const flowWeeks = useMemo(() => weekBuckets(addDays(t0, -28), 12), [t0]);
  const flow = useMemo(
    () => productionVsDispatch(scopeFGs, horizonRules, flowWeeks, scopeLines),
    [scopeFGs, horizonRules, flowWeeks, scopeLines]
  );
  const bookSplit = useMemo(() => orderBookSplit(risk, scopeFGs, horizonRules), [risk, scopeFGs, horizonRules]);

  const batchesInScope = useMemo(
    () => touched.filter(isBatchManaged).flatMap((m) => batchRows(m, plant, horizonRules)),
    [touched, plant, horizonRules]
  );
  const [copied, setCopied] = useState(false);
  /* Consumption history stands on its own: the planner picks a plant, then adds the
     materials they want to look at. It is not scoped by the finished good selected above,
     because usage is a property of the material and the plant, not of one order. */
  const materialsWithHistory = (pl) =>
    CONSUMPTION.filter((c) => c.p === pl).map((c) => c.m).sort();

  const [consPlant, setConsPlant] = useState(() => (FINISHED_GOODS[0] && FINISHED_GOODS[0].plant) || PLANTS[0].id);
  const [consMats, setConsMats] = useState(() => materialsWithHistory((FINISHED_GOODS[0] && FINISHED_GOODS[0].plant) || PLANTS[0].id));
  const [consPick, setConsPick] = useState(null);

  const consAvailable = useMemo(() => materialsWithHistory(consPlant), [consPlant]);
  const consOptions = useMemo(
    () => consAvailable
      .filter((m) => !consMats.includes(m))
      .map((code) => ({ code, desc: matInfo(code).desc, kind: `plant ${consPlant}` })),
    [consAvailable, consMats, consPlant]
  );

  const pickConsPlant = (pl) => {
    setConsPlant(pl);
    setConsMats(materialsWithHistory(pl));
    setConsPick(null);
  };
  const addConsMaterial = (code) => {
    const c = code.trim().toUpperCase();
    if (!consAvailable.includes(c)) return;
    setConsMats((x) => (x.includes(c) ? x : [...x, c]));
    setConsPick(`${c}|${consPlant}`);
  };
  const removeConsMaterial = (code) =>
    setConsMats((x) => x.filter((m) => m !== code));

  const consumption = useMemo(
    () => consMats
      .map((m) => consumptionHistory(m, consPlant, horizonRules, included, null))
      .filter(Boolean)
      .map((c) => ({ ...c, key: `${c.mat}|${c.plant}` }))
      .sort((a, b) => (a.status === b.status ? b.avg - a.avg : a.status === "late" ? -1 : b.status === "late" ? 1 : a.status === "risk" ? -1 : 1)),
    [consMats, consPlant, horizonRules, included]
  );
  const consSel = consumption.find((c) => c.key === consPick) || consumption[0] || null;

  const runWide = useMemo(() => {
    const seen = [];
    for (const L of programme.lines) {
      if (!L.master.ok) continue;
      if (!seen.some((x) => x.m === L.fg && x.p === L.plant)) seen.push({ m: L.fg, p: L.plant, isFG: true });
      for (const x of L.result.lines) if (!seen.some((y) => y.m === x.code && y.p === L.plant)) seen.push({ m: x.code, p: L.plant, isFG: false });
    }
    const plants = [...new Set(seen.map((x) => x.p))];
    const fgs = seen.filter((x) => x.isFG);
    return {
      projection: seen.map((x) => demandSupply(x.m, x.p, horizonRules, weeks, included, runFlows)),
      capacity: plants.flatMap((pl) => capacityLoad(pl, horizonRules, weeks, programme.lines)),
      risk: plants.flatMap((pl) => deliveryRisk(pl, horizonRules, weeks, included, runFlows)),
      consumption: seen.map((x) => consumptionHistory(x.m, x.p, horizonRules, included, null)).filter(Boolean),
      flow: productionVsDispatch(fgs, horizonRules, flowWeeks, programme.lines.filter((l) => l.master.ok)),
    };
  }, [programme, horizonRules, weeks, flowWeeks, included, runFlows]);

  /* The summary always reports the whole run, whatever the screens below are scoped to */
  const summary = useMemo(
    () => summarise({
      programme, contended,
      projectionSet: runWide.projection,
      capacityAll: runWide.capacity,
      risk: runWide.risk,
      consumption: runWide.consumption,
      flow: runWide.flow,
      shopFloor, commitments, subcon, t0, weeks,
    }),
    [programme, contended, runWide, shopFloor, commitments, subcon, t0, weeks]
  );

  const navCount = (k) => ({
    summary: summary.counts.critical || null,
    run: programme.lines.length,
    demand: projectionSet.filter((d) => d.status !== "ok").length,
    capacity: capacityAll.filter((c) => c.totalOver > 0).length,
    sales: risk.filter((r) => !r.covered).length,
    flow: null,
    components: result.lines.length,
    shortages: result.shortLines.length,
    contention: contended.length,
    prod: shopFloor.orders.filter((o) => !o.complete).length,
    orders: commitments.supply.filter((s) => s.openQty > 0).length,
    subcon: subcon.held.length,
    consumption: consumption.filter((c) => c.status !== "ok").length || null,
    sap: SAP_SOURCES.length,
  }[k] ?? null);

  /* ---------- Claude API: briefing over the whole run ---------- */
  const draftSummary = useCallback(async () => {
    setSumBusy(true); setSumError(null); setAiSummary(null);
    const payload = {
      today: fmtDateLong(t0),
      horizon: `${weeks.length} weeks to ${fmtDateLong(weeks[weeks.length - 1].to)}`,
      plan: programme.lines.map((L) => ({
        line: L.seq,
        salesOrder: L.so ? `${L.so.doc}/${L.so.item} for ${L.so.customer}` : "planner entry, no order",
        material: L.fg, quantity: L.qty, plant: L.plant,
        customerDeliveryDate: fmtDateLong(L.delivery),
        productionMustStart: L.master.ok ? fmtDateLong(L.needBy) : null,
        alreadyLateToStart: !!L.startsInPast,
        verdict: L.master.ok ? L.result.verdict : "cannot be exploded",
        buildableToday: L.master.ok ? Math.min(L.result.buildable, L.qty) : 0,
        fullKitDate: L.master.ok && L.result.shortLines.length ? fmtDateLong(L.result.fullKit) : "complete",
      })),
      counts: summary.counts,
      readings: summary.stats.map((s) => `${s.k}: ${s.v} (${s.s})`),
      findings: summary.issues.map((i) => `[${i.sev}] ${i.area} — ${i.headline}. ${i.detail}`),
    };
    const prompt = `You are the production planning lead opening the morning meeting at a discrete manufacturing plant in India. Below is the full readout from the planning cockpit, in JSON.

${JSON.stringify(payload, null, 2)}

Write the briefing you would actually give. Rules:
- Lead with the single thing that matters most. If a customer date is going to move, say so plainly and name the order.
- Separate what has to happen today from what can wait until later in the week, and what is only worth watching.
- Every item names who does it: Stores, Quality, Supply planning, Purchasing, Production planning, or Sales.
- Do not repeat the numbers back. Interpret them. Say what the situation means and what the decision is.
- Where two findings share a root cause, say so once rather than listing both.
- Be direct and specific. No filler, no encouragement, no restating the question.

Respond with ONLY a JSON object, no markdown fences and no preamble:
{
  "headline": "one sentence, the thing the room needs to hear first",
  "situation": "two or three sentences putting the run in context",
  "today": [{"action": "...", "owner": "Purchasing", "why": "..."}],
  "thisWeek": [{"action": "...", "owner": "...", "why": "..."}],
  "watch": ["short note", "short note"],
  "decision": "the one call that needs a person to make it, or null if there is none"
}`;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await r.json();
      const text = data.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      setAiSummary(JSON.parse(text.replace(/```json/g, "").replace(/```/g, "").trim()));
    } catch (e) {
      setSumError("The briefing could not be generated. The readings below are unaffected.");
    } finally { setSumBusy(false); }
  }, [programme, summary, weeks, t0]);

  /* ---------- Claude API action plan ---------- */
  const draftPlan = useCallback(async () => {
    setAiBusy(true);
    setAiError(null);
    setAiPlan(null);

    const payload = {
      planningRun: {
        totalLines: programme.lines.length,
        allocationOrder: programme.lines.map((L) => `${L.seq}. ${L.fg} x${L.qty} at plant ${L.plant}, needed ${fmtDateLong(L.needBy)}`),
        note: "Stock is allocated strictly down this list, so earlier lines take what they need first.",
        contendedComponents: contended.map(
          (c) => `${c.code} at ${c.plant}: ${fmtQty(c.onHand, c.uom)} on hand, run needs ${fmtQty(c.totalRequired, c.uom)}, ${fmtQty(c.totalShort, c.uom)} not covered by stock`
        ),
      },
      order: {
        lineNumber: sel.seq,
        productionVersion: sel.pv
          ? `${sel.pv.version} ${sel.pv.text}, BOM alternative ${sel.pv.bom}, routing ${sel.pv.routing}, ${sel.pv.line}${sel.pv.manual ? ", fixed by the planner" : ", selected automatically"}${sel.pv.warn ? ` — ${sel.pv.warn}` : ""}`
          : "no production version defined",
        alternativeVersions: sel.pv && sel.pv.list.length > 1
          ? sel.pv.list.filter((v) => v.version !== sel.pv.version).map(
              (v) => `${v.version} ${v.text}, BOM ${v.bom}, lot ${v.lotFrom}-${v.lotTo}${v.locked ? ", locked" : ""}`)
          : [],
        finishedGood: fgCode,
        description: matInfo(fgCode).desc,
        quantity: Number(orderQty),
        plant: `${plant} ${PLANTS.find((p) => p.id === plant).name}`,
        needBy: fmtDateLong(needBy),
        today: fmtDateLong(t0),
      },
      verdict: result.verdict,
      buildableNow: result.buildable,
      bomLevelsExploded: result.depth,
      fullKitDate: fmtDateLong(result.fullKit),
      excludedStorageLocations: SLOCS.filter((s) => !included.has(s.code)).map((s) => `${s.code} (${s.type})`),
      reservationRule:
        resPolicy === "all" ? "All open reservations subtracted from on-hand stock"
        : resPolicy === "horizon" ? "Only reservations due on or before the need date are subtracted"
        : "Reservations ignored — committed stock treated as free",
      peggedSupplyRule: excludePegged
        ? "Supply already pegged to earlier MRP dependent requirements is excluded; only the free balance counts"
        : "Pegged supply is being counted as available, which double-books it against other orders",
      competingCommitments: commitments.resv
        .filter((r) => r.counted)
        .map((r) => `${r.m}: ${fmtQty(r.open, r.uom)} ${r.uom} open on ${r.order}, needed ${fmtDate(r.date)}`),
      peggedSupply: commitments.supply
        .filter((s) => s.pegged > 0)
        .map((s) => `${s.doc} ${s.m}: ${fmtQty(s.pegged, s.uom)} of ${fmtQty(s.openQty, s.uom)} open is pegged, ${fmtQty(s.free, s.uom)} free`),
      openPurchaseOrders: commitments.supply
        .filter((s) => s.openQty > 0)
        .map((s) => ({
          document: `${s.doc}/${s.item}`,
          type: s.type,
          material: s.m,
          vendor: s.vendor,
          createdOn: fmtDateLong(s.created),
          createdBy: `${s.mode} — ${s.createdBy}`,
          deliveryDate: fmtDateLong(s.date),
          ordered: s.q,
          received: s.received,
          open: s.openQty,
          freeForThisOrder: s.free,
          landsInTime: s.date <= needBy,
        })),
      competingProductionOrders: shopFloor.orders.filter((o) => !o.complete).map((o) => ({
        order: o.order,
        builds: o.material,
        openQty: o.openQty,
        finishDate: fmtDateLong(o.finish),
        systemStatus: o.status.join(" "),
        released: o.released,
        flaggedMissingParts: o.missingParts,
      })),
      subcontracting: subcon.orders.filter((s) => s.openQty > 0).map((s) => ({
        document: `${s.doc}/${s.item}`,
        vendor: s.vendor,
        returns: s.material,
        openQty: s.openQty,
        deliveryDate: fmtDateLong(s.date),
        overdue: s.overdue,
        raisedBy: `${s.mode} — ${s.createdBy}`,
      })),
      componentsHeldAtVendors: subcon.held.map(
        (v) => `${v.code}: ${fmtQty(v.qty, MATERIALS[v.code].uom)} at ${v.vendor} on ${v.doc}, ${v.ageDays} days${v.overdue ? ", order overdue" : ""}`
      ),
      shortages: result.shortLines.map((l) => ({
        material: l.code,
        description: l.desc,
        bomLevel: l.level,
        uom: l.uom,
        required: l.required,
        onHand: l.onHand,
        openReservations: l.reserved,
        available: l.available,
        short: l.shortage,
        leadTimeDays: l.lead,
        coverageDate: fmtDateLong(l.coverage),
        willDelayOrder: l.status === "late",
        options: l.resolution.steps.map((s) => ({
          option: s.label,
          note: s.detail,
          qty: s.qty,
          readyBy: fmtDateLong(s.eta),
          suggestedOwner: s.owner,
          costImpact: s.cost,
        })),
      })),
    };

    const prompt = `You are an experienced production planning lead in a discrete manufacturing plant in India. Below is the component readiness check for line ${sel.seq} of a multi-item planning run, in JSON.

${JSON.stringify(payload, null, 2)}

Write a sequenced action plan the planner can work through today. Rules:
- Always exhaust no-new-spend options first: internal storage location transfers, then inter-plant stock transfer orders, then expediting purchase orders that already exist, and only then a new purchase requisition.
- Where a shortage exists because stock is reserved for another order or because inbound supply is pegged to earlier demand, say so and name the competing order. Re-allocating is a legitimate option, but flag it as a decision someone has to take rather than assuming it.
- Recalling components from a subcontractor frees material but stops the work they were sent for, so treat it as a trade-off and name the subcontracting order it would halt. Overdue subcontracting orders deserve their own chase action.
- When a competing production order is still in CRTD, re-planning it is a softer option than one already released and partially confirmed. Say which order you would touch and why.
- Other lines in the same planning run compete for the same stock. Where a shortage exists because an earlier line took the material, say so and treat resequencing the run as a real option alongside procurement.
- If an alternative production version exists that uses a different BOM, and a shortage sits on a component unique to the current one, switching version is worth raising as an option. Say what it would change and note that it needs the routing and line capacity to be available.
- One action per row. Order them by what has to happen first.
- "dueBy" is the date the action itself must be completed, not the date material arrives.
- Owner must be one of: Stores, Quality, Supply planning, Purchasing, Production planning.
- "impact" states plainly what breaks if this action slips.
- Keep every field short and specific. Use material codes.

Respond with ONLY a JSON object, no markdown fences and no preamble:
{
  "headline": "one sentence a planner would say in a morning meeting",
  "criticalPath": "the single material that decides the order date, and why",
  "actions": [
    {"seq": 1, "action": "...", "material": "RM-XXXX-000", "qty": "12 EA", "owner": "Stores", "dueBy": "12 Sep", "impact": "..."}
  ],
  "watchOuts": ["short risk note", "short risk note"]
}`;

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await r.json();
      const text = data.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
      setAiPlan(JSON.parse(clean));
    } catch (e) {
      setAiError("The action plan could not be generated. Check the connection and run it again.");
    } finally {
      setAiBusy(false);
    }
  }, [fgCode, orderQty, plant, needBy, included, result, commitments, subcon, shopFloor, programme, contended, sel, resPolicy, excludePegged, t0]);

  /* ---------- derived copy ---------- */
  const verdictCopy = !sel.master.ok ? {
    word: sel.master.known ? "No bill of material" : "Material not found",
    line: sel.master.known
      ? `${fgCode} exists in the material master but has no bill of material at this plant, so there is nothing to explode. Check the BOM usage and alternative, or pick a different material.`
      : `${fgCode} is not in the material master. Check the code, or pick one from the list.`,
    c: "stop",
  } : {
    release: {
      word: "Ready to release",
      line: `All components for ${orderQty} ${matInfo(fgCode).uom} are covered from the storage locations you included.`,
      c: "go",
    },
    coverable: {
      word: "Short, but recoverable",
      line: `${result.shortLines.length} component${result.shortLines.length > 1 ? "s" : ""} short today. Every gap can be closed before ${fmtDate(needBy)} if the actions below start now.`,
      c: "caution",
    },
    blocked: {
      word: `Cannot meet ${fmtDate(needBy)}`,
      line: `${result.lateLines.length} component${result.lateLines.length > 1 ? "s" : ""} cannot be covered in time. The earliest full kit is ${fmtDateLong(result.fullKit)}.`,
      c: "stop",
    },
  }[result.verdict];

  const kitDays = diffDays(result.fullKit, t0);

  return (
    <div className="crc-root">
      <style>{CSS}</style>

      <header className="crc-header">
        <div className="crc-header-in">
          <div className="crc-brand">
            <span className="crc-brand-mark" aria-hidden="true" />
            <div>
              <div className="crc-brand-name">Component readiness</div>
              <div className="crc-brand-sub">Can this run start, and what is stopping it</div>
            </div>
          </div>

          <div className={`crc-state crc-state-${summary.state}`}>
            <span className="crc-state-lamp" aria-hidden="true" />
            <div className="crc-state-body">
              <div className="crc-state-word">
                {summary.state === "release" ? "Clear to run"
                  : summary.state === "coverable" ? "Recoverable"
                  : "Action needed"}
              </div>
              <div className="crc-state-line">{summary.headline}</div>
            </div>
            <div className="crc-state-figs">
              <div>
                <span className="crc-state-v">{programme.totalBuildable}<em>/{programme.totalDemand}</em></span>
                <span className="crc-state-k">buildable now</span>
              </div>
              <div>
                <span className="crc-state-v">{programme.programmeKit > t0 ? fmtDate(programme.programmeKit) : "today"}</span>
                <span className="crc-state-k">run complete</span>
              </div>
            </div>
            <button
              className={`crc-sumbtn ${summary.counts.critical ? "crc-sumbtn-alert" : ""}`}
              onClick={() => { setTab("summary"); if (!aiSummary && !sumBusy) draftSummary(); }}
            >
              Summarise the run
              {summary.counts.critical > 0 && <span className="crc-sumbadge">{summary.counts.critical}</span>}
            </button>
          </div>
        </div>
        <div className="crc-header-strip">
          <span>{programme.lines.length} line{programme.lines.length > 1 ? "s" : ""}</span>
          <span>plant{programme.plants.length > 1 ? "s" : ""} {programme.plants.join(", ")}</span>
          <span>viewing {fgCode}</span>
          <span>{weeks.length}-week horizon</span>
          <span className="crc-header-date">checked {fmtDateLong(t0)}</span>
        </div>
      </header>

      <div className="crc-shell">
        {/* screen rail */}
        <nav className="crc-rail">
          {NAV_GROUPS.map((g) => (
            <div key={g.group} className="crc-railgroup">
              <div className="crc-railgroup-t">{g.group}</div>
              {g.items.map(([k, label]) => {
                const n = navCount(k);
                return (
                  <button key={k} className={tab === k ? "crc-railbtn crc-railbtn-on" : "crc-railbtn"}
                    onClick={() => setTab(k)}>
                    <span>{label}</span>
                    {n !== null && <span className="crc-railcount">{n}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="crc-railfoot">
            Horizon {weeks.length} weeks to {fmtDate(weeks[weeks.length - 1].to)}
            <br />
            {programme.lines.length} line{programme.lines.length > 1 ? "s" : ""} · plant{programme.plants.length > 1 ? "s" : ""} {programme.plants.join(", ")}
          </div>
        </nav>

        <main className="crc-main">
          {/* ---- PLANNING RUN (input) ---- */}
          {tab === "run" && (
            <>
              <ScreenNav sections={[
                { id: "sec-programme", label: "Planning run", count: programme.lines.length },
                { id: "sec-schedule", label: "Backward schedule" },
                { id: "sec-slocs", label: "Storage locations", count: included.size },
                { id: "sec-rules", label: "Calculation rules" },
              ]} />

          <div className="crc-programme" id="sec-programme">
            <div className="crc-prog-head">
              <div>
                <h3>Planning run</h3>
                <p>
                  Enter the date the customer wants the goods. Everything else is scheduled backwards from it:
                  transit, loading, pick and pack, float and production time give the date you have to start,
                  which is the date the components must be there. Lines draw stock in the order shown, so
                  position is priority. Click a line to see it in detail below.
                </p>
              </div>
              <div className="crc-prog-actions">
                <select className="crc-addso" value="" onChange={(e) => { addFromSO(e.target.value); e.target.value = ""; }}>
                  <option value="">Add from a sales order…</option>
                  {SALES_ORDERS.filter((o) => !demand.some((d) => d.so === `${o.doc}/${o.item}`)).map((o) => (
                    <option key={o.doc + o.item} value={`${o.doc}/${o.item}`}>
                      {o.doc}/{o.item} · {o.m} · {o.qty} · {fmtDate(addDays(t0, o.reqOffset))} · {o.customer}
                    </option>
                  ))}
                </select>
                <button className="crc-btn crc-btn-light" onClick={addLine}>Add without an order</button>
              </div>
            </div>

            <div className="crc-postats">
              {[
                [programme.lines.length, `line${programme.lines.length > 1 ? "s" : ""} across ${programme.plants.length} plant${programme.plants.length > 1 ? "s" : ""}`],
                [fmtQty(programme.totalDemand, "EA"), "units of demand"],
                [fmtQty(programme.totalBuildable, "EA"), "buildable right now"],
                [programme.blocked.length + programme.invalid.length, programme.invalid.length ? "lines blocked or unusable" : "lines that miss their date"],
                [programme.lines.filter((l) => l.startsInPast).length, "should already have started"],
                [programme.programmeKit > t0 ? fmtDate(programme.programmeKit) : "Today", "whole run complete"],
              ].map(([v, k], i) => (
                <div key={i} className="crc-postat">
                  <div className="crc-postat-v">{v}</div>
                  <div className="crc-postat-k">{k}</div>
                </div>
              ))}
            </div>

            <div className="crc-tablewrap">
              <table className="crc-table crc-progtable">
                <thead>
                  <tr>
                    <th className="crc-num">#</th>
                    <th>Sales order</th>
                    <th>Finished good</th>
                    <th>Version</th>
                    <th>Plant</th>
                    <th className="crc-num">Quantity</th>
                    <th>Delivery date</th>
                    <th>Start by</th>
                    <th className="crc-num">Buildable now</th>
                    <th>Full kit</th>
                    <th>Status</th>
                    <th className="crc-th-act">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {programme.lines.map((L, i) => {
                    const raw = demand[i];
                    const v = L.result.verdict;
                    return (
                      <tr
                        key={L.key}
                        className={i === selIdx ? "crc-prog-on" : ""}
                        onClick={() => { setSelected(i); setExpanded(null); }}
                      >
                        <td className="crc-num crc-dim">{L.seq}</td>
                        <td>
                          <select className="crc-inline crc-inline-so" value={raw.so || ""}
                            onChange={(e) => attachSO(L.key, e.target.value)}>
                            <option value="">Not from an order</option>
                            {SALES_ORDERS.map((o) => (
                              <option key={o.doc + o.item} value={`${o.doc}/${o.item}`}>
                                {o.doc}/{o.item} · {o.m} · {o.qty}
                              </option>
                            ))}
                          </select>
                          <div className="crc-matdesc">
                            {L.so
                              ? <>{L.so.customer} · {fmtQty(L.so.qty, matInfo(L.fg).uom)} {matInfo(L.fg).uom} · route {L.so.route}</>
                              : <span className="crc-dim">planner entry</span>}
                          </div>
                        </td>
                        <td>
                          <MaterialInput
                            value={L.fg}
                            options={MATERIAL_OPTIONS}
                            state={!L.master.known ? "missing" : !L.master.hasBom ? "nobom" : "ok"}
                            onChange={(code) => {
                              const f = FINISHED_GOODS.find((x) => x.code === code);
                              patchLine(L.key, f
                                ? { fg: code, plant: f.plant, version: "AUTO" }
                                : { fg: code, version: "AUTO" });
                            }}
                          />
                          <div className="crc-matdesc">
                            {!L.master.known
                              ? <span className="crc-combo-msg crc-combo-msgbad">not in the material master</span>
                              : !L.master.hasBom
                                ? <span className="crc-combo-msg crc-combo-msgwarn">no bill of material</span>
                                : matInfo(L.fg).desc}
                          </div>
                        </td>
                        <td>
                          {L.pv ? (
                            <>
                              <select className="crc-inline crc-inline-sm" value={raw.version || "AUTO"}
                                onChange={(e) => patchLine(L.key, { version: e.target.value })}>
                                <option value="AUTO">Auto</option>
                                {(PROD_VERSIONS[L.fg] || []).map((v) => (
                                  <option key={v.version} value={v.version}>
                                    {v.version} — {v.text}{v.locked ? " (locked)" : ""}
                                  </option>
                                ))}
                              </select>
                              <div className="crc-matdesc">
                                {L.pv.version} · BOM {L.pv.bom}
                                {L.pv.warn && <span className="crc-pvwarn" title={L.pv.warn}> !</span>}
                              </div>
                            </>
                          ) : <span className="crc-dim">none</span>}
                        </td>
                        <td>
                          <select className="crc-inline crc-inline-sm" value={L.plant}
                            onChange={(e) => patchLine(L.key, { plant: e.target.value })}>
                            {PLANTS.map((p) => <option key={p.id} value={p.id}>{p.id} {p.name}</option>)}
                          </select>
                        </td>
                        <td className="crc-num">
                          <input className="crc-inline crc-inline-num" type="number" min="1" value={raw.qty}
                            onChange={(e) => patchLine(L.key, { qty: e.target.value })} />
                        </td>
                        <td>
                          <input className="crc-inline crc-inline-sm" type="date" value={raw.deliveryISO}
                            onChange={(e) => patchLine(L.key, { deliveryISO: e.target.value })} />
                          {L.so && Math.abs(diffDays(L.delivery, addDays(t0, L.so.reqOffset))) > 0 && (
                            <div className="crc-matdesc crc-combo-msgwarn">
                              order asks for {fmtDate(addDays(t0, L.so.reqOffset))}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className={L.startsInPast ? "crc-date-late" : "crc-date"}>{fmtDate(L.needBy)}</div>
                          <div className="crc-matdesc">
                            {L.startsInPast
                              ? `${diffDays(t0, L.needBy)} days ago`
                              : `in ${diffDays(L.needBy, t0)} days`}
                          </div>
                        </td>
                        <td className="crc-num crc-strong">
                          {L.master.ok
                            ? <>{Math.min(L.result.buildable, L.qty)}<span className="crc-metric-of"> / {L.qty}</span></>
                            : <span className="crc-dim">—</span>}
                        </td>
                        <td>
                          {!L.master.ok
                            ? <span className="crc-dim">—</span>
                            : L.result.shortLines.length === 0
                            ? <span className="crc-dim">complete</span>
                            : <span className={L.result.fullKit > L.needBy ? "crc-date-late" : "crc-date"}>
                                {fmtDate(L.result.fullKit)}
                              </span>}
                        </td>
                        <td>
                          {!L.master.ok
                            ? <span className="crc-tag crc-tag-stop">Cannot explode</span>
                            : <span className={`crc-tag crc-tag-${v === "release" ? "go" : v === "coverable" ? "caution" : "stop"}`}>
                                {v === "release" ? "Ready" : v === "coverable" ? "Recoverable" : "Misses date"}
                              </span>}
                        </td>
                        <td className="crc-th-act">
                          <div className="crc-acts">
                            <button className="crc-iconbtn" disabled={i === 0}
                              onClick={(e) => { e.stopPropagation(); moveLine(i, -1); }} title="Move up">↑</button>
                            <button className="crc-iconbtn" disabled={i === programme.lines.length - 1}
                              onClick={(e) => { e.stopPropagation(); moveLine(i, 1); }} title="Move down">↓</button>
                            <button className="crc-iconbtn crc-iconbtn-del" disabled={demand.length <= 1}
                              onClick={(e) => { e.stopPropagation(); removeLine(L.key); }} title="Remove line">×</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {contended.length > 0 && (
              <div className="crc-prog-note">
                {contended.filter((c) => c.starved > 0).length > 0
                  ? `${contended.length} components are needed by more than one line, and ${contended.filter((c) => c.starved > 0).length} of them run out before every line is covered. The Contention tab shows who gets what.`
                  : `${contended.length} components are needed by more than one line, and stock covers all of them.`}
              </div>
            )}
          </div>


              {sel.master.ok && (
                <div className="crc-panel crc-panel-top" id="sec-schedule">
                  <div className="crc-panel-head">
                    <span>
                      Backward schedule for line {sel.seq} · {sel.fg}
                      {sel.so ? ` · sales order ${sel.so.doc}/${sel.so.item}` : ""}
                    </span>
                    <span className="crc-head-right">
                      <span className={sel.startsInPast ? "crc-panel-flag" : ""}>
                        {sel.startsInPast
                          ? `Production should have started ${diffDays(t0, sel.needBy)} days ago`
                          : `Production starts in ${diffDays(sel.needBy, t0)} days`}
                      </span>
                    </span>
                  </div>
                  <ScheduleChain schedule={sel.schedule} t0={t0} />
                  <div className="crc-tablewrap">
                    <table className="crc-table">
                      <thead>
                        <tr>
                          <th>Step</th>
                          <th>Date</th>
                          <th className="crc-num">Working days</th>
                          <th>Where the number comes from</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sel.schedule.steps.map((st, i) => (
                          <tr key={st.k} className={st.k === "Production start" ? "crc-prog-on" : ""}>
                            <td className={i === 0 || st.k === "Production start" ? "crc-strong" : ""}>{st.k}</td>
                            <td className={st.d < t0 ? "crc-date-late" : "crc-date"}>{fmtDate(st.d)}</td>
                            <td className="crc-num crc-dim">{st.days === null ? "—" : `− ${st.days}`}</td>
                            <td className="crc-dim">{st.src}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="crc-legend">
                    Components have to be available on the production start date, so that is the date the
                    readiness check works to. Create order by is the last day the order can be created and still
                    make the delivery — past that, the customer date moves. Weekends are treated as non-working;
                    a live build reads the factory calendar on the plant instead.
                  </div>
                </div>
              )}

              <div className="crc-runcols">

          <Section
            id="sec-slocs"
            title="Storage locations"
            hint="Untick a location to keep its stock out of the availability figure. It stays visible in the results."
          >
            <div className="crc-slocs">
              {SLOCS.map((s) => {
                const on = included.has(s.code);
                const n = slocCounts[s.code] || 0;
                return (
                  <div key={s.code} className={`crc-sloc ${on ? "" : "crc-sloc-off"}`}>
                    <label className="crc-sloc-main">
                      <input type="checkbox" checked={on} onChange={() => toggleSloc(s.code)} />
                      <span className="crc-sloc-code">{s.code}</span>
                      <span className="crc-sloc-name">{s.name}</span>
                    </label>
                    <div className="crc-sloc-foot">
                      <span className={`crc-stocktype crc-st-${s.type === "Unrestricted" ? "free" : "held"}`}>{s.type}</span>
                      <span className="crc-sloc-qty">
                        {n > 0 ? `${n} material${n > 1 ? "s" : ""} held here` : "nothing held here"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section id="sec-rules" title="Calculation rules">
            <div className="crc-rule">
              <div className="crc-rule-title">Open reservations</div>
              <div className="crc-rule-help">
                Quantity still to be withdrawn against other released orders. Anything already issued or flagged
                final issue is never counted.
              </div>
              <div className="crc-seg crc-seg-4">
                {[
                  ["all", "All open"],
                  ["horizon", "In horizon"],
                  ["released", "Released"],
                  ["none", "Ignore"],
                ].map(([k, label]) => (
                  <button
                    key={k}
                    className={resPolicy === k ? "crc-seg-btn crc-seg-on" : "crc-seg-btn"}
                    onClick={() => { setResPolicy(k); setAiPlan(null); }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="crc-rule-echo">
                {resPolicy === "all" && "Every open reservation is subtracted from on-hand stock."}
                {resPolicy === "horizon" && `Only reservations due on or before ${fmtDate(needBy)} compete with this order.`}
                {resPolicy === "released" && "Only reservations belonging to released orders count. Orders still in CRTD are treated as re-plannable."}
                {resPolicy === "none" && "Reservations are ignored. Committed stock is being treated as free."}
              </div>
            </div>

            <label className="crc-switch">
              <input type="checkbox" checked={excludePegged} onChange={() => { setExcludePegged(!excludePegged); setAiPlan(null); }} />
              <span>
                <strong>Exclude supply pegged by earlier MRP runs</strong>
                <em>
                  Purchase orders and stock transfer orders already assigned to other dependent requirements
                  count only for their unpegged balance.
                </em>
              </span>
            </label>

            <div className="crc-note">
              Both rules change the availability figure directly. Confirm them against your MRP configuration
              before running the check on live plant data.
            </div>
          </Section>
              </div>
            </>
          )}

          {/* context strip on every other screen */}
          {tab !== "run" && (
            <div className={`crc-ctx crc-ctx-${verdictCopy.c}`}>
              <div className="crc-ctx-lines">
                {programme.lines.map((L, i) => (
                  <button key={L.key} className={i === selIdx ? "crc-ctxbtn crc-ctxbtn-on" : "crc-ctxbtn"}
                    onClick={() => { setSelected(i); setExpanded(null); }}>
                    <span className="crc-mono">#{L.seq}</span> {L.fg}
                    <span className="crc-ctxbtn-q">{L.qty} · {L.plant}</span>
                  </button>
                ))}
              </div>
              <div className="crc-ctx-scope">
                <span className="crc-seg crc-seg-sm">
                  {[["line", "This material"], ["run", "Whole run"]].map(([k, label]) => (
                    <button key={k} className={scope === k ? "crc-seg-btn crc-seg-on" : "crc-seg-btn"}
                      onClick={() => { setScope(k); setDsPick(null); }}>{label}</button>
                  ))}
                </span>
              </div>
              <div className="crc-ctx-verdict">
                <span className="crc-ctx-word">{verdictCopy.word}</span>
                <span className="crc-ctx-sub">
                  {sel.master.ok
                    ? `${Math.min(result.buildable, orderQty)} of ${orderQty} buildable now · full kit ${kitDays <= 0 ? "on hand" : fmtDate(result.fullKit)}`
                    : "nothing to explode"}
                </span>
                <button className="crc-linkbtn" onClick={() => setTab("run")}>edit the run</button>
              </div>
            </div>
          )}


          {/* ---- DEMAND AND SUPPLY ---- */}
          {tab === "demand" && (
            <>
              <ScreenNav sections={[
                { id: "sec-dsall", label: "All materials", count: projectionSet.length },
                { id: "sec-dschart", label: "Projected stock" },
                { id: "sec-dsweeks", label: "Week by week" },
              ]} />
              <div className="crc-panel" id="sec-dsall">
                <div className="crc-panel-head">
                  <span>Every material this run touches, bucketed by week against what is already on order</span>
                </div>
                <div className="crc-tablewrap">
                  <table className="crc-table">
                    <thead>
                      <tr>
                        <th className="crc-th-mat">Material</th>
                        <th>Plant</th>
                        <th className="crc-num">Opening</th>
                        <th className="crc-num">Safety</th>
                        <th className="crc-num">Demand</th>
                        <th className="crc-num">Supply</th>
                        <th className="crc-num">Balance</th>
                        <th>First shortage</th>
                        <th className="crc-num">Cover</th>
                        <th>What to do</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectionSet.map((d) => (
                        <tr key={d.mat + d.plant}
                          className={d.mat === projection.mat && d.plant === projection.plant ? "crc-prog-on" : d.status === "late" ? "crc-tr-short" : ""}
                          onClick={() => setDsPick(`${d.mat}|${d.plant}`)} style={{ cursor: "pointer" }}>
                          <td className="crc-th-mat">
                            <div className="crc-matcode">{d.mat}</div>
                            <div className="crc-matdesc">{d.desc}</div>
                          </td>
                          <td className="crc-mono">{d.plant}</td>
                          <td className="crc-num">{fmtQty(d.opening, d.uom)}</td>
                          <td className="crc-num crc-dim">{d.safety > 0 ? fmtQty(d.safety, d.uom) : "—"}</td>
                          <td className="crc-num">{fmtQty(d.totalDemand, d.uom)}</td>
                          <td className="crc-num">{fmtQty(d.totalSupply, d.uom)}</td>
                          <td className={`crc-num crc-strong ${d.balance < 0 ? "crc-num-short" : ""}`}>{fmtQty(d.balance, d.uom)}</td>
                          <td>
                            {d.firstShort
                              ? <span className="crc-date-late">{d.firstShort.label} · {d.firstShort.date}</span>
                              : d.firstBreach
                                ? <span className="crc-excl">below safety {d.firstBreach.label}</span>
                                : <span className="crc-dim">none</span>}
                          </td>
                          <td className="crc-num crc-dim">{d.coverDays === null ? "—" : `${d.coverDays} d`}</td>
                          <td>
                            <StatusTag status={d.status === "ok" ? "ok" : d.status === "risk" ? "coverable" : "late"} />
                            <div className="crc-actionline">{demandAction(d)}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="crc-legend">
                  Opening stock is what sits in the storage locations you included, so excluding quality-hold stock
                  moves this line too. Demand covers sales orders, forecast, dependent requirements from other
                  orders, and what this planning run needs. Click a row to chart it.
                </div>
              </div>

              <div className="crc-panel crc-panel-top" id="sec-dschart">
                <div className="crc-chart">
                  <div className="crc-chart-head">
                    <h4>{projection.mat}<span className="crc-head-sub">{projection.desc}</span></h4>
                    <p>
                      Demand below the line, receipts above it, and the projected stock walking across.
                      Anything under zero is a week the plant cannot serve.
                    </p>
                  </div>
                  <DemandSupplyChart d={projection} />
                  <div className="crc-key">
                    <span><i style={{ background: "#7C97AC" }} />Sales orders</span>
                    <span><i style={{ background: "#A9BCC9" }} />Forecast</span>
                    <span><i style={{ background: "var(--caution)" }} />Dependent requirements</span>
                    <span><i style={{ background: "#C6813A" }} />This planning run</span>
                    <span><i style={{ background: "var(--go)" }} />Receipts</span>
                    <span><i style={{ background: "var(--ink)" }} />Projected stock</span>
                  </div>
                </div>

                <div className="crc-tablewrap" id="sec-dsweeks">
                  <table className="crc-table">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th className="crc-num">Sales orders</th>
                        <th className="crc-num">Forecast</th>
                        <th className="crc-num">Dependent</th>
                        <th className="crc-num">This run</th>
                        <th className="crc-num">Planned</th>
                        <th className="crc-num">Production</th>
                        <th className="crc-num">Purchasing</th>
                        <th className="crc-num">Subcontract</th>
                        <th className="crc-num">Run output</th>
                        <th className="crc-num">Projected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projection.rows.map((r) => (
                        <tr key={r.label} className={r.closing < 0 ? "crc-tr-short" : ""}>
                          <td>
                            <div className="crc-matcode">{r.label}</div>
                            <div className="crc-matdesc">{r.date}</div>
                          </td>
                          {[r.so, r.pir, r.dep, r.runDep].map((v, i) => (
                            <td key={i} className={`crc-num ${v > 0 ? "" : "crc-dim"}`}>{v > 0 ? `−${fmtQty(v, projection.uom)}` : "—"}</td>
                          ))}
                          {[r.planned, r.prod, r.purch, r.subcon, r.run].map((v, i) => (
                            <td key={i} className={`crc-num ${v > 0 ? "crc-mvt-plus" : "crc-dim"}`}>{v > 0 ? `+${fmtQty(v, projection.uom)}` : "—"}</td>
                          ))}
                          <td className={`crc-num crc-strong ${r.closing < 0 ? "crc-num-short" : r.closing < projection.safety ? "crc-excl" : ""}`}>
                            {fmtQty(r.closing, projection.uom)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="crc-legend">
                  Run output is what this planning run would deliver into stock; this run needs is what it consumes.
                  A finished good on the run shows both, one week apart from its components.
                </div>
              </div>
            </>
          )}

          {/* ---- CAPACITY ---- */}
          {tab === "capacity" && (
            <>
              <ScreenNav sections={[
                { id: "sec-caploads", label: "Load by week", count: capacityAll.length },
                { id: "sec-capgantt", label: "Orders by work centre" },
              ]} />
              <div className="crc-panel" id="sec-caploads">
                <div className="crc-panel-head">
                  <span>Hours required against hours available, including what this run would add</span>
                  <span className="crc-head-right">
                    <span className="crc-panel-flag">
                      {capacityAll.filter((c) => c.totalOver > 0).length} work centre
                      {capacityAll.filter((c) => c.totalOver > 0).length === 1 ? "" : "s"} over capacity
                    </span>
                    {wcOut.size > 0 && (
                      <button className="crc-linkbtn" onClick={() => setWcOut(new Set())}>bring all back on line</button>
                    )}
                  </span>
                </div>
                <div className="crc-tablewrap">
                  <table className="crc-table">
                    <thead>
                      <tr>
                        <th className="crc-th-count">In use</th>
                        <th className="crc-th-mat">Work centre</th>
                        <th>Plant</th>
                        <th className="crc-num">Available</th>
                        {weeks.map((w) => <th key={w.label} className="crc-num">{w.label}</th>)}
                        <th className="crc-num">Over</th>
                      </tr>
                    </thead>
                    <tbody>
                      {capacityAll.map((c) => (
                        <tr key={c.id} className={c.unavailable ? "crc-tr-muted" : c.totalOver > 0 ? "crc-tr-short" : ""}>
                          <td className="crc-th-count">
                            <label className="crc-mark">
                              <input type="checkbox" checked={!c.unavailable} onChange={() => toggleWc(c.id)} />
                            </label>
                          </td>
                          <td className="crc-th-mat">
                            <div className="crc-matcode">
                              {c.id}
                              {c.unavailable && <span className="crc-tag crc-tag-stop">down</span>}
                            </div>
                            <div className="crc-matdesc">{c.desc} · {c.shifts} shift{c.shifts > 1 ? "s" : ""}</div>
                          </td>
                          <td className="crc-mono">{c.plant}</td>
                          <td className="crc-num">{c.unavailable ? <span className="crc-num-short">0 h</span> : `${c.avail} h`}</td>
                          {c.rows.map((r) => (
                            <td key={r.label}
                              className={`crc-num ${r.pct === null ? "crc-num-short" : r.pct > 100 ? "crc-num-short" : r.pct > 90 ? "crc-excl" : r.pct === 0 ? "crc-dim" : ""}`}>
                              {r.pct === null ? (r.total > 0 ? "—" : "") : `${r.pct}%`}
                            </td>
                          ))}
                          <td className={`crc-num crc-strong ${c.totalOver > 0 ? "crc-num-short" : "crc-dim"}`}>
                            {c.totalOver > 0 ? `${c.totalOver} h` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="crc-legend">
                  Untick a work centre to take it off line — a breakdown, a maintenance window, or a shift not
                  being manned. Its available hours drop to zero and everything already booked on it shows as
                  stranded, so you can see what has to move and where it could go.
                  {wcOut.size > 0 && (() => {
                    const stranded = capacityAll.filter((c) => c.unavailable).reduce((a, c) => a + c.strandedHours, 0);
                    const spare = capacityAll.filter((c) => !c.unavailable)
                      .reduce((a, c) => a + c.rows.reduce((x, r) => x + Math.max(0, c.avail - r.total), 0), 0);
                    return ` ${r3(stranded)} hours are currently stranded on centres you have taken off line, against ${r3(spare)} hours of spare capacity across the rest.`;
                  })()}
                </div>
              </div>

              {capacityAll.some((c) => c.drivers.length > 0) && (
                <div className="crc-panel crc-panel-top" id="sec-capgantt">
                  <div className="crc-chart">
                    <div className="crc-chart-head">
                      <h4>Which order sits on which work centre</h4>
                      <p>
                        Every order on these lines placed against its own start and finish dates. Orders that
                        overlap on the same work centre are stacked, so two bars on one line at the same time is
                        the week that centre goes over.
                      </p>
                    </div>
                    <WorkCentreGantt centres={capacityAll} weeks={weeks} t0={t0} />
                    <div className="crc-key">
                      <span><i style={{ background: "var(--signal)" }} />Released order</span>
                      <span><i style={{ background: "#8FA8C0" }} />Created, not released</span>
                      <span><i style={{ background: "var(--stop)" }} />Missing parts</span>
                      <span><i style={{ background: "#7C97AC" }} />Planned, firmed</span>
                      <span><i style={{ background: "#A9BCC9" }} />Planned, not firmed</span>
                      <span><i style={{ background: "#C6813A" }} />This planning run</span>
                    </div>
                  </div>
                </div>
              )}

              {capacityAll.filter((c) => c.peak > 0 || c.strandedHours > 0).map((c) => (
                <div key={c.id} className="crc-panel crc-panel-top">
                  <div className="crc-chart">
                    <div className="crc-chart-head">
                      <h4>{c.id}<span className="crc-head-sub">{c.desc}</span></h4>
                      <p>
                        {c.unavailable
                          ? `Marked off line, so there are no available hours. Everything below is work that has to be placed somewhere else.`
                          : `${c.avail} hours available each week after ${Math.round(c.util * 100)}% utilisation on ${c.shifts} shift${c.shifts > 1 ? "s" : ""}. The darker part of each bar is what this planning run adds on top of orders already on the floor.`}
                      </p>
                    </div>
                    <CapacityChart c={c} />
                    <div className="crc-key">
                      <span><i style={{ background: "var(--signal)" }} />Committed orders</span>
                      <span><i style={{ background: "#C6813A" }} />This planning run</span>
                      <span><i style={{ background: "var(--stop)" }} />Over capacity</span>
                    </div>
                    {c.totalOver > 0 && (
                      <div className="crc-chart-read">
                        {(() => {
                          const spare = c.rows.find((r) => r.over === 0 && r.total < c.avail * 0.7);
                          const biggest = c.drivers.filter((d) => c.overWeeks.some((w) => w.i >= d.from && w.i <= d.to))[0];
                          return (
                            <>
                              Over capacity in {c.overWeeks.map((w) => w.label).join(", ")} by {c.totalOver} hours.
                              {biggest && <> The largest job in those weeks is {biggest.ref} ({biggest.material}, {biggest.hours} h)</>}
                              {spare ? <> — moving it to {spare.label} would clear the peak.</> : <> — there is no week with real slack, so this needs a shift or an alternative line.</>}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                  {c.drivers.length > 0 && (
                    <div className="crc-tablewrap">
                      <table className="crc-table">
                        <thead>
                          <tr>
                            <th>Source</th>
                            <th>Reference</th>
                            <th className="crc-th-mat">Material</th>
                            <th className="crc-num">Quantity</th>
                            <th className="crc-num">Hours</th>
                            <th>Spread over</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.drivers.map((d, i) => (
                            <tr key={i}>
                              <td>
                                <span className={`crc-mode crc-mode-${d.kind === "this run" ? "man" : "mrp"}`}>
                                  {d.kind}
                                </span>
                              </td>
                              <td className="crc-mono">{d.ref}</td>
                              <td className="crc-th-mat">
                                <div className="crc-matcode">{d.material}</div>
                                <div className="crc-matdesc">{matInfo(d.material).desc}</div>
                              </td>
                              <td className="crc-num">{fmtQty(d.qty, matInfo(d.material).uom)}</td>
                              <td className="crc-num crc-strong">{r3(d.hours)} h</td>
                              <td className="crc-mono">
                                {weeks[d.from].label}{d.to > d.from ? ` – ${weeks[d.to].label}` : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* ---- OUTPUT AND DISPATCH ---- */}
          {tab === "flow" && (
            <>
              <ScreenNav sections={[
                { id: "sec-flowchart", label: "Produced vs dispatched" },
                { id: "sec-flowbook", label: "Order book outcome" },
                { id: "sec-flowweeks", label: "Week by week" },
              ]} />
              <div className="crc-panel" id="sec-flowchart">
                <div className="crc-panel-head">
                  <span>What the plant produced against what it dispatched, four weeks back and eight forward</span>
                </div>
                <div className="crc-postats">
                  {[
                    [fmtQty(flow.builtToDate, "EA"), "built in the last 4 weeks"],
                    [fmtQty(flow.shippedToDate, "EA"), "shipped in the last 4 weeks"],
                    [`${flow.builtToDate - flow.shippedToDate > 0 ? "+" : ""}${fmtQty(flow.builtToDate - flow.shippedToDate, "EA")}`,
                      flow.builtToDate >= flow.shippedToDate ? "stock built up" : "stock drawn down"],
                    [fmtQty(flow.plannedBuild, "EA"), "planned output ahead"],
                    [fmtQty(flow.plannedShip, "EA"), "committed to ship ahead"],
                  ].map(([v, k], i) => (
                    <div key={i} className="crc-postat">
                      <div className="crc-postat-v">{v}</div>
                      <div className="crc-postat-k">{k}</div>
                    </div>
                  ))}
                </div>
                <div className="crc-chart">
                  <FlowChart flow={flow} t0={t0} />
                  <div className="crc-key">
                    <span><i style={{ background: "var(--go)" }} />Built, posted</span>
                    <span><i style={{ background: "#8FBFA6" }} />Built, planned</span>
                    <span><i style={{ background: "#7C97AC" }} />Shipped, posted</span>
                    <span><i style={{ background: "#B4C6D2" }} />To ship, committed</span>
                    <span><i style={{ background: "var(--caution)" }} />Cumulative net</span>
                  </div>
                  <div className="crc-chart-read">
                    {flow.plannedShip > flow.plannedBuild
                      ? `Ahead of you, ${fmtQty(flow.plannedShip, "EA")} is committed to ship against ${fmtQty(flow.plannedBuild, "EA")} of planned output. The gap of ${fmtQty(flow.plannedShip - flow.plannedBuild, "EA")} has to come from stock on hand, or something slips.`
                      : `Planned output of ${fmtQty(flow.plannedBuild, "EA")} covers the ${fmtQty(flow.plannedShip, "EA")} committed to ship. The cumulative line staying above zero is the check that it lands in the right weeks, not just in total.`}
                  </div>
                </div>
              </div>

              <div className="crc-panel crc-panel-top" id="sec-flowbook">
                <div className="crc-chart">
                  <div className="crc-chart-head">
                    <h4>Where the order book ends up</h4>
                    <p>Every unit on the books for {scope === "line" ? fgCode : "this run"}, by what actually happens to it.</p>
                  </div>
                  {bookSplit.length ? <Donut slices={bookSplit} unit={matInfo(fgCode).uom} />
                    : <div className="crc-empty crc-empty-sm"><p>No order book for this selection.</p></div>}
                </div>
              </div>

              <div className="crc-panel crc-panel-top" id="sec-flowweeks">
                <div className="crc-tablewrap">
                  <table className="crc-table">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th className="crc-num">Produced</th>
                        <th className="crc-num">Shipped</th>
                        <th className="crc-num">Planned output</th>
                        <th className="crc-num">To ship</th>
                        <th className="crc-num">Net</th>
                        <th className="crc-num">Cumulative</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flow.rows.map((r) => (
                        <tr key={r.label} className={r.past ? "crc-tr-muted" : r.net < 0 ? "crc-tr-short" : ""}>
                          <td>
                            <div className="crc-matcode">{r.label}</div>
                            <div className="crc-matdesc">{r.date}{r.past ? " · actual" : ""}</div>
                          </td>
                          <td className="crc-num">{r.produced > 0 ? fmtQty(r.produced, "EA") : <span className="crc-dim">—</span>}</td>
                          <td className="crc-num">{r.dispatched > 0 ? fmtQty(r.dispatched, "EA") : <span className="crc-dim">—</span>}</td>
                          <td className="crc-num">{r.plannedOut > 0 ? fmtQty(r.plannedOut, "EA") : <span className="crc-dim">—</span>}</td>
                          <td className="crc-num">{r.plannedShip > 0 ? fmtQty(r.plannedShip, "EA") : <span className="crc-dim">—</span>}</td>
                          <td className={`crc-num ${r.net < 0 ? "crc-num-short" : r.net > 0 ? "crc-mvt-plus" : "crc-dim"}`}>
                            {r.net !== 0 ? `${r.net > 0 ? "+" : ""}${fmtQty(r.net, "EA")}` : "—"}
                          </td>
                          <td className={`crc-num crc-strong ${r.cum < 0 ? "crc-num-short" : ""}`}>
                            {r.cum > 0 ? "+" : ""}{fmtQty(r.cum, "EA")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="crc-legend">
                  Built comes from goods receipts posted against production orders, shipped from goods issues on
                  outbound deliveries. Forward weeks use open production and planned orders against the confirmed
                  order book, so the cumulative line is the stock position this plan produces.
                </div>
              </div>
            </>
          )}

          {/* ---- SALES AND DELIVERY RISK ---- */}
          {tab === "sales" && (
            <div className="crc-panel">
              <div className="crc-panel-head">
                <span>Sales order lines measured against the projected stock this plan produces</span>
              </div>
              <div className="crc-postats">
                {(() => {
                  const late = risk.filter((r) => !r.covered);
                  const beyond = late.filter((r) => !r.expected);
                  const qtyAtRisk = late.reduce((a, r) => a + r.qty, 0);
                  const worst = late.reduce((a, r) => Math.max(a, r.lateDays || 0), 0);
                  return [
                    [risk.length, "order lines in the horizon"],
                    [risk.length - late.length, "will ship on the requested date"],
                    [late.length, "will not"],
                    [fmtQty(qtyAtRisk, "EA"), "units at risk"],
                    [beyond.length ? `${beyond.length} beyond` : `${worst} d`, beyond.length ? "the 8-week horizon" : "worst delay"],
                  ].map(([v, k], i) => (
                    <div key={i} className="crc-postat">
                      <div className="crc-postat-v">{v}</div>
                      <div className="crc-postat-k">{k}</div>
                    </div>
                  ));
                })()}
              </div>
              <div className="crc-tablewrap">
                <table className="crc-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th className="crc-th-mat">Material</th>
                      <th className="crc-num">Quantity</th>
                      <th className="crc-num">Confirmed</th>
                      <th>Requested</th>
                      <th>Achievable</th>
                      <th className="crc-num">Delay</th>
                      <th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {risk.map((r) => (
                      <tr key={r.doc + r.item} className={!r.covered ? "crc-tr-short" : ""}>
                        <td>
                          <div className="crc-matcode">{r.doc}<span className="crc-item">/{r.item}</span></div>
                          <div className="crc-matdesc">plant {r.p}</div>
                        </td>
                        <td>
                          <div>{r.customer}</div>
                          <div className="crc-matdesc crc-mono">{r.soldTo}</div>
                        </td>
                        <td className="crc-th-mat">
                          <div className="crc-matcode">{r.material}</div>
                          <div className="crc-matdesc">{matInfo(r.material).desc}</div>
                        </td>
                        <td className="crc-num">{fmtQty(r.qty, r.uom)}</td>
                        <td className={`crc-num ${r.confirmed < r.qty ? "crc-excl" : "crc-dim"}`}>
                          {fmtQty(r.confirmed, r.uom)}
                        </td>
                        <td className="crc-mono">{fmtDate(r.req)}</td>
                        <td>
                          {r.covered
                            ? <span className="crc-date">{fmtDate(r.req)}</span>
                            : r.expected
                              ? <span className="crc-date-late">{fmtDate(r.expected)}</span>
                              : <span className="crc-date-late">beyond the horizon</span>}
                        </td>
                        <td className={`crc-num ${r.covered ? "crc-dim" : "crc-num-short"}`}>
                          {r.covered ? "—" : r.lateDays !== null ? `${r.lateDays} d` : "—"}
                        </td>
                        <td className="crc-dim">
                          {r.covered
                            ? <span className="crc-tag crc-tag-go">on time</span>
                            : <>Short {fmtQty(r.shortfall, r.uom)} {r.uom}. {r.cause}.</>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="crc-legend">
                Order lines are served in requested-date sequence, so an earlier line consumes stock before a later
                one is judged. A confirmed quantity below the order quantity means sales has already promised less
                than the customer asked for. This reads the same projection as the demand and supply screen, so
                excluding a storage location or reordering the run changes these dates.
              </div>
            </div>
          )}

          {/* ---- COMPONENTS ---- */}
          {tab === "components" && (
            <>
            <ScreenNav sections={[
              ...(sel.pv ? [{ id: "sec-pv", label: "Production version" }] : []),
              { id: "sec-bom", label: "Exploded bill", count: result.lines.length },
            ]} />
            <div className="crc-panel">
              {sel.pv && (
                <div className="crc-pv" id="sec-pv">
                  <div className="crc-pv-active">
                    <div className="crc-pv-lead">
                      <div className="crc-pv-title">
                        <span className="crc-matcode">Version {sel.pv.version}</span>
                        <span className="crc-pv-text">{sel.pv.text}</span>
                        {sel.pv.manual
                          ? <span className="crc-tag crc-tag-signal">planner override</span>
                          : <span className="crc-tag crc-tag-neutral">selected automatically</span>}
                        {sel.pv.locked && <span className="crc-tag crc-tag-stop">locked</span>}
                      </div>
                      <p className="crc-pv-reason">{sel.pv.reason}</p>
                    </div>
                    <dl className="crc-pv-facts">
                      <div><dt>BOM alternative</dt><dd>{sel.pv.bom} · usage {sel.pv.bomUsage}</dd></div>
                      <div><dt>Routing</dt><dd>{sel.pv.routing} / {sel.pv.counter}</dd></div>
                      <div><dt>Line</dt><dd>{sel.pv.line}</dd></div>
                      <div><dt>Lot size</dt><dd>{sel.pv.lotFrom} to {sel.pv.lotTo}</dd></div>
                      <div><dt>Valid</dt><dd>{fmtDate(sel.pv.from)} to {fmtDate(sel.pv.to)}</dd></div>
                    </dl>
                  </div>

                  {sel.pv.warn && <div className="crc-pv-warn">{sel.pv.warn}</div>}

                  {sel.pv.list.length > 1 && (
                    <table className="crc-conttable crc-pvtable">
                      <thead>
                        <tr>
                          <th>Version</th>
                          <th>BOM</th>
                          <th>Routing</th>
                          <th>Line</th>
                          <th className="crc-num">Lot size</th>
                          <th>Validity</th>
                          <th>Fits this line</th>
                          <th className="crc-th-act">Use</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sel.pv.list.map((v) => {
                          const active = v.version === sel.pv.version;
                          const fits = !v.locked && v.inDate && v.inLot;
                          return (
                            <tr key={v.version} className={active ? "crc-pv-on" : v.locked ? "crc-tr-muted" : ""}>
                              <td>
                                <span className="crc-mono">{v.version}</span>
                                <div className="crc-matdesc">{v.text}</div>
                              </td>
                              <td className="crc-mono">{v.bom}</td>
                              <td className="crc-mono">{v.routing}/{v.counter}</td>
                              <td>{v.line}</td>
                              <td className="crc-num crc-mono">{v.lotFrom}–{v.lotTo}</td>
                              <td className="crc-mono">{fmtDate(v.from)} – {fmtDate(v.to)}</td>
                              <td>
                                {v.locked
                                  ? <span className="crc-tag crc-tag-stop">locked</span>
                                  : fits
                                    ? <span className="crc-tag crc-tag-go">valid</span>
                                    : <span className="crc-tag crc-tag-caution">
                                        {!v.inLot ? `lot size ${orderQty} outside range` : "outside validity"}
                                      </span>}
                              </td>
                              <td className="crc-th-act">
                                {active
                                  ? <span className="crc-dim">in use</span>
                                  : <button className="crc-minibtn"
                                      onClick={() => patchLine(sel.key, { version: v.version })}>Use</button>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  {sel.pv.list.length > 1 && (
                    <div className="crc-pv-foot">
                      {(demand[selIdx].version || "AUTO") === "AUTO"
                        ? "Selection is automatic. Pick a version above to override it and see how the bill of material changes."
                        : (
                          <>
                            Version fixed by hand.{" "}
                            <button className="crc-linkbtn" onClick={() => patchLine(sel.key, { version: "AUTO" })}>
                              Return to automatic selection
                            </button>
                          </>
                        )}
                    </div>
                  )}
                </div>
              )}
              <div className="crc-panel-head">
                <span>Exploded bill of material, netted against stock in the included storage locations</span>
                <span className="crc-head-right">
                  {excludedVisible > 0 && (
                    <span className="crc-panel-flag">
                      {excludedVisible} material{excludedVisible > 1 ? "s have" : " has"} stock in excluded locations
                    </span>
                  )}
                  <span className="crc-seg crc-seg-sm">
                    {[["table", "Table"], ["tree", "Structure"]].map(([k, label]) => (
                      <button key={k} className={bomView === k ? "crc-seg-btn crc-seg-on" : "crc-seg-btn"}
                        onClick={() => setBomView(k)}>{label}</button>
                    ))}
                  </span>
                </span>
              </div>
              <span id="sec-bom" />
              {bomView === "tree" ? (
                <div className="crc-treewrap">
                  <BomTree nodes={toTree(result.lines)} />
                </div>
              ) : (
              <div className="crc-tablewrap">
                <table className="crc-table">
                  <thead>
                    <tr>
                      <th className="crc-th-mat">Material</th>
                      <th className="crc-num">Lvl</th>
                      <th className="crc-num">Per unit</th>
                      <th className="crc-num">Required</th>
                      <th className="crc-num">On hand</th>
                      <th className="crc-num">Open resv</th>
                      <th className="crc-num">Available</th>
                      <th className="crc-th-cov">Coverage</th>
                      <th className="crc-num">Short</th>
                      <th className="crc-num">Free inbound</th>
                      <th className="crc-num">Excluded</th>
                      <th>Covered by</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.lines.map((l, i) => (
                      <tr key={`${l.code}-${i}`} className={l.shortage > 0 && !l.isAssembly ? "crc-tr-short" : ""}>
                        <td className="crc-th-mat">
                          <div className="crc-matcell" style={{ paddingLeft: `${(l.level - 1) * 18}px` }}>
                            {l.level > 1 && <span className="crc-branch" aria-hidden="true" />}
                            <div>
                              <div className="crc-matcode">
                                {l.code}
                                <span className={`crc-proc crc-proc-${l.proc}`}>{l.proc === "E" ? "in-house" : "bought"}</span>
                              </div>
                              <div className="crc-matdesc">{l.desc}</div>
                            </div>
                          </div>
                        </td>
                        <td className="crc-num crc-dim">{l.level}</td>
                        <td className="crc-num crc-dim">{fmtQty(l.perFG, l.uom)}</td>
                        <td className="crc-num crc-strong">{fmtQty(l.required, l.uom)} <span className="crc-uom">{l.uom}</span></td>
                        <td className="crc-num">{fmtQty(l.onHand, l.uom)}</td>
                        <td className="crc-num" title={l.resvList.map((r) => `${r.order}: ${fmtQty(r.open, l.uom)} open, due ${fmtDate(r.date)}`).join("\n")}>
                          {l.reserved > 0
                            ? <span className="crc-resv">−{fmtQty(l.reserved, l.uom)}</span>
                            : <span className="crc-dim">—</span>}
                        </td>
                        <td className="crc-num crc-strong">{fmtQty(l.available, l.uom)}</td>
                        <td className="crc-th-cov">
                          <CoverageBar available={l.available} required={l.required} status={l.status} />
                        </td>
                        <td className={`crc-num ${l.shortage > 0 ? "crc-num-short" : "crc-dim"}`}>
                          {l.shortage > 0 ? fmtQty(l.shortage, l.uom) : "—"}
                        </td>
                        <td className="crc-num" title={l.peggedQty > 0 ? `${fmtQty(l.peggedQty, l.uom)} ${l.uom} pegged to earlier demand` : ""}>
                          {l.inboundByNeed > 0
                            ? <span className="crc-inbound">{fmtQty(l.inboundByNeed, l.uom)}{l.peggedQty > 0 && excludePegged ? "*" : ""}</span>
                            : <span className="crc-dim">—</span>}
                        </td>
                        <td className="crc-num">
                          {l.exclQty > 0
                            ? <span className="crc-excl">{fmtQty(l.exclQty, l.uom)}</span>
                            : <span className="crc-dim">—</span>}
                        </td>
                        <td>
                          {l.isAssembly
                            ? <span className="crc-dim">{l.shortage > 0 ? "see components below" : "from stock"}</span>
                            : l.coverage
                              ? <span className={l.status === "late" ? "crc-date-late" : "crc-date"}>{fmtDate(l.coverage)}</span>
                              : <span className="crc-dim">on hand</span>}
                        </td>
                        <td><StatusTag status={l.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
              <div className="crc-legend">
                Available = on hand in the included storage locations, less open reservations.
                Sub-assemblies are netted against their own stock first, and only the uncovered balance explodes to
                the next level — this order goes {result.depth} level{result.depth > 1 ? "s" : ""} deep.
                Required quantities include component scrap from the bill of material.
                {excludePegged && " An asterisk marks inbound supply where part of the order quantity is pegged to earlier demand."}
              </div>
            </div>
            </>
          )}

          {/* ---- SHORTAGES ---- */}
          {tab === "shortages" && (
            <>
            <ScreenNav sections={result.shortLines.slice(0, 8).map((l) => ({
              id: `sec-short-${l.code}`, label: l.code, count: null,
            }))} />
            <div className="crc-panel">
              {result.shortLines.length === 0 ? (
                <div className="crc-empty">
                  <div className="crc-empty-title">Nothing is short</div>
                  <p>Every component is covered from the storage locations you included. The order can be released.</p>
                </div>
              ) : (
                <>
                  <div className="crc-panel-head">
                    <span>Ordered cheapest first: move what you already own before committing new spend</span>
                  </div>
                  <div className="crc-shortlist">
                    {result.shortLines.map((l) => {
                      const open = expanded === l.code;
                      return (
                        <article key={l.code} id={`sec-short-${l.code}`} className={`crc-short crc-short-${l.status}`}>
                          <button className="crc-short-head" onClick={() => setExpanded(open ? null : l.code)}>
                            <div className="crc-short-id">
                              <div className="crc-matcode">{l.code}</div>
                              <div className="crc-matdesc">{l.desc}</div>
                            </div>
                            <div className="crc-short-figs">
                              <div>
                                <span className="crc-sf-v crc-num-short">{fmtQty(l.shortage, l.uom)} {l.uom}</span>
                                <span className="crc-sf-k">short</span>
                              </div>
                              <div>
                                <span className="crc-sf-v">{fmtQty(l.available, l.uom)}</span>
                                <span className="crc-sf-k">of {fmtQty(l.required, l.uom)} needed</span>
                              </div>
                              <div>
                                <span className={`crc-sf-v ${l.status === "late" ? "crc-date-late" : ""}`}>{fmtDate(l.coverage)}</span>
                                <span className="crc-sf-k">covered by</span>
                              </div>
                              <StatusTag status={l.status} />
                              <span className={`crc-chev ${open ? "crc-chev-open" : ""}`} aria-hidden="true" />
                            </div>
                          </button>

                          {open && (
                            <div className="crc-short-body">
                              <Timeline t0={t0} needBy={needBy} steps={l.resolution.steps} />
                              <ol className="crc-steps">
                                {l.resolution.steps.map((s, i) => (
                                  <li key={i} className={`crc-step crc-step-${s.kind}`}>
                                    <div className="crc-step-rank">{i + 1}</div>
                                    <div className="crc-step-body">
                                      <div className="crc-step-label">{s.label}</div>
                                      <div className="crc-step-detail">{s.detail}</div>
                                      <div className="crc-step-meta">
                                        <span>Owner: {s.owner}</span>
                                        <span>Ready {fmtDate(s.eta)}</span>
                                        <span className={s.cost === "New spend" ? "crc-cost-new" : "crc-cost-free"}>{s.cost}</span>
                                        {s.overdue && <span className="crc-cost-new">Order date already passed</span>}
                                      </div>
                                    </div>
                                  </li>
                                ))}
                              </ol>
                              {l.excl.length > 0 && (
                                <div className="crc-exclbox">
                                  <div className="crc-exclbox-title">Stock you excluded from the calculation</div>
                                  {l.excl.map((r) => (
                                    <div key={r.s} className="crc-exclrow">
                                      <span className="crc-mono">{r.s}</span>
                                      <span>{SLOC_BY_CODE[r.s].name}</span>
                                      <span className="crc-mono">{fmtQty(r.q, l.uom)} {l.uom}</span>
                                      <span className="crc-exclnote">{SLOC_BY_CODE[r.s].note || "Available if you include this location"}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            </>
          )}

          {/* ---- CONTENTION ---- */}
          {tab === "contention" && (
            <>
            <ScreenNav sections={contended.slice(0, 8).map((c) => ({ id: `sec-cont-${c.code}`, label: c.code }))} />
            <div className="crc-panel">
              <div className="crc-panel-head">
                <span>Components more than one line in this run needs, and how the stock was split</span>
                <span className="crc-head-right">
                  <span className="crc-panel-flag">
                    {contended.filter((c) => c.starved > 0).length} of {contended.length} leave a line short
                  </span>
                </span>
              </div>

              <div className="crc-contlist">
                {contended.map((c) => {
                  const total = Math.max(c.totalRequired, 1);
                  return (
                    <article key={c.key} id={`sec-cont-${c.code}`} className="crc-cont">
                      <div className="crc-cont-head">
                        <div>
                          <div className="crc-matcode">{c.code}</div>
                          <div className="crc-matdesc">{c.desc} · plant {c.plant}</div>
                        </div>
                        <div className="crc-cont-figs">
                          <div>
                            <span className="crc-sf-v">{fmtQty(c.onHand, c.uom)}</span>
                            <span className="crc-sf-k">on hand</span>
                          </div>
                          {c.reserved > 0 && (
                            <div>
                              <span className="crc-sf-v crc-resv">−{fmtQty(c.reserved, c.uom)}</span>
                              <span className="crc-sf-k">reserved elsewhere</span>
                            </div>
                          )}
                          <div>
                            <span className="crc-sf-v">{fmtQty(c.totalRequired, c.uom)}</span>
                            <span className="crc-sf-k">this run needs</span>
                          </div>
                          <div>
                            <span className={`crc-sf-v ${c.totalShort > 0 ? "crc-num-short" : ""}`}>
                              {c.totalShort > 0 ? fmtQty(c.totalShort, c.uom) : "0"}
                            </span>
                            <span className="crc-sf-k">not covered by stock</span>
                          </div>
                        </div>
                      </div>

                      <div className="crc-cont-bar">
                        {c.rows.map((r, i) => (
                          r.allocated > 0 && (
                            <div key={r.seq} className="crc-cont-seg"
                              style={{ width: `${(r.allocated / total) * 100}%`, background: SEQ_COLOR[i % SEQ_COLOR.length] }}
                              title={`Line ${r.seq} ${r.fg} — allocated ${fmtQty(r.allocated, c.uom)} ${c.uom}`} />
                          )
                        ))}
                        {c.totalShort > 0 && (
                          <div className="crc-cont-seg crc-cont-gap"
                            style={{ width: `${(c.totalShort / total) * 100}%` }}
                            title={`${fmtQty(c.totalShort, c.uom)} ${c.uom} must come from somewhere else`} />
                        )}
                      </div>

                      <table className="crc-conttable">
                        <thead>
                          <tr>
                            <th>Line</th>
                            <th className="crc-num">Needs</th>
                            <th className="crc-num">Gets from stock</th>
                            <th className="crc-num">Left short</th>
                            <th>Outcome for that line</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.rows.map((r, i) => (
                            <tr key={r.seq}>
                              <td>
                                <span className="crc-seqdot" style={{ background: SEQ_COLOR[i % SEQ_COLOR.length] }} />
                                <span className="crc-mono">#{r.seq}</span> {r.fg}
                              </td>
                              <td className="crc-num">{fmtQty(r.required, c.uom)}</td>
                              <td className="crc-num crc-strong">{fmtQty(r.allocated, c.uom)}</td>
                              <td className={`crc-num ${r.shortage > 0 ? "crc-num-short" : "crc-dim"}`}>
                                {r.shortage > 0 ? fmtQty(r.shortage, c.uom) : "—"}
                              </td>
                              <td>
                                {r.shortage <= 0
                                  ? <span className="crc-tag crc-tag-go">covered from stock</span>
                                  : <StatusTag status={r.status} />}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </article>
                  );
                })}
              </div>

              <div className="crc-legend">
                Stock is allocated strictly down the priority list, so line 1 takes what it needs before line 2
                sees anything. A line left short here is not necessarily late — it may still be covered by a
                transfer, an inter-plant move or an order, which is what its own Shortages tab shows. Reorder the
                run above to change who gets first call.
              </div>
            </div>
            </>
          )}

          {/* ---- SCHEDULE ---- */}
          {tab === "schedule" && (
            <>
            <ScreenNav sections={[
              { id: "sec-gantt", label: "When shortages close" },
              { id: "sec-profile", label: "Buildable over time" },
            ]} />
            <div className="crc-panel">
              {result.shortLines.length === 0 ? (
                <div className="crc-empty">
                  <div className="crc-empty-title">Nothing to schedule</div>
                  <p>The kit is complete today, so there is no recovery sequence to plot.</p>
                </div>
              ) : (
                <>
                  <div className="crc-chart" id="sec-gantt">
                    <div className="crc-chart-head">
                      <h4>When each shortage closes</h4>
                      <p>
                        One bar per short component, coloured by the action that covers it. The bar ends on the
                        date that component is complete; anything crossing the need-by line pushes the order.
                      </p>
                    </div>
                    <KitGantt
                      lines={result.shortLines}
                      t0={t0}
                      needBy={needBy}
                      fullKit={result.fullKit}
                      verdict={result.verdict}
                    />
                    <KindLegend
                      kinds={[...new Set(result.shortLines.flatMap((l) => l.resolution.steps.map((s) => s.kind)))]}
                    />
                  </div>

                  <div className="crc-chart" id="sec-profile">
                    <div className="crc-chart-head">
                      <h4>Buildable quantity as actions land</h4>
                      <p>
                        Recalculated across the whole multi-level bill at each arrival date, so the line steps up
                        only when the tightest remaining component moves.
                      </p>
                    </div>
                    <BuildProfileChart
                      profile={profile}
                      orderQty={Number(orderQty) || 0}
                      t0={t0}
                      needBy={needBy}
                      fullKit={result.fullKit}
                    />
                    <div className="crc-chart-read">
                      {(() => {
                        const first = profile[0], last = profile[profile.length - 1];
                        const atNeed = [...profile].filter((p) => p.date <= needBy).pop();
                        return `Starts at ${first ? first.qty : 0} today, reaches ${atNeed ? atNeed.qty : 0} by ${fmtDate(needBy)}, and completes at ${last ? last.qty : 0} on ${fmtDate(result.fullKit)}.`;
                      })()}
                    </div>
                  </div>
                </>
              )}
            </div>
            </>
          )}

          {/* ---- STOCK BY LOCATION ---- */}
          {tab === "stock" && (
            <>
              <ScreenNav sections={[
                { id: "sec-stkpos", label: "Position by material", count: touched.length },
                { id: "sec-stkloc", label: "Where it sits" },
                ...(touched.some(isBatchManaged) ? [{ id: "sec-stkbatch", label: "Batches", count: batchesInScope.length }] : []),
              ]} />

              <div className="crc-panel" id="sec-stkpos">
                <div className="crc-panel-head">
                  <span>What is owned at plant {plant}, and how much of it can be issued today</span>
                </div>
                {(() => {
                  const pics = touched.map((m) => stockPicture(m, plant, included, horizonRules, null, subcon.held));
                  const sum = (k) => r3(pics.reduce((a, x) => a + x[k], 0));
                  return (
                    <>
                      <div className="crc-postats">
                        {[
                          [`${pics.filter((x) => x.issuableNow > 0).length} of ${pics.length}`, "materials with issuable stock"],
                          [fmtQty(sum("unrestricted"), "EA"), "unrestricted, all materials"],
                          [fmtQty(sum("reserved"), "EA"), "already reserved elsewhere"],
                          [fmtQty(sum("excluded"), "EA"), "in locations you excluded"],
                          [fmtQty(sum("atVendor"), "EA"), "held at subcontractors"],
                        ].map(([v, k], i) => (
                          <div key={i} className="crc-postat">
                            <div className="crc-postat-v">{v}</div>
                            <div className="crc-postat-k">{k}</div>
                          </div>
                        ))}
                      </div>
                      <div className="crc-tablewrap">
                        <table className="crc-table">
                          <thead>
                            <tr>
                              <th className="crc-th-mat">Material</th>
                              <th className="crc-num">Owned</th>
                              <th className="crc-num">Unrestricted</th>
                              <th className="crc-num">Quality hold</th>
                              <th className="crc-num">Blocked</th>
                              <th className="crc-num">In transit</th>
                              <th className="crc-num">Staged</th>
                              <th className="crc-num">At vendor</th>
                              <th className="crc-num">Counted</th>
                              <th className="crc-num">Reserved</th>
                              <th className="crc-num">Issuable now</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pics.map((x) => (
                              <tr key={x.mat} className={x.issuableNow <= 0 ? "crc-tr-short" : ""}>
                                <td className="crc-th-mat">
                                  <div className="crc-matcode">{x.mat}</div>
                                  <div className="crc-matdesc">{x.desc}</div>
                                </td>
                                <td className="crc-num">{fmtQty(x.totalOwned, x.uom)} <span className="crc-uom">{x.uom}</span></td>
                                <td className="crc-num">{x.unrestricted > 0 ? fmtQty(x.unrestricted, x.uom) : <span className="crc-dim">—</span>}</td>
                                <td className="crc-num">{x.quality > 0 ? <span className="crc-excl">{fmtQty(x.quality, x.uom)}</span> : <span className="crc-dim">—</span>}</td>
                                <td className="crc-num">{x.blocked > 0 ? <span className="crc-num-short">{fmtQty(x.blocked, x.uom)}</span> : <span className="crc-dim">—</span>}</td>
                                <td className="crc-num">{x.transit > 0 ? <span className="crc-excl">{fmtQty(x.transit, x.uom)}</span> : <span className="crc-dim">—</span>}</td>
                                <td className="crc-num">{x.staged > 0 ? <span className="crc-excl">{fmtQty(x.staged, x.uom)}</span> : <span className="crc-dim">—</span>}</td>
                                <td className="crc-num">{x.atVendor > 0 ? <span className="crc-vendorqty">{fmtQty(x.atVendor, x.uom)}</span> : <span className="crc-dim">—</span>}</td>
                                <td className="crc-num">{fmtQty(x.counted, x.uom)}</td>
                                <td className="crc-num">{x.reserved > 0 ? <span className="crc-resv">−{fmtQty(x.reserved, x.uom)}</span> : <span className="crc-dim">—</span>}</td>
                                <td className={`crc-num crc-strong ${x.issuableNow <= 0 ? "crc-num-short" : "crc-mvt-plus"}`}>
                                  {fmtQty(x.issuableNow, x.uom)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="crc-legend">
                        Owned is everything on the books at this plant plus what a subcontractor is holding for us.
                        Counted is only the storage locations ticked on the planning run. Issuable now is counted
                        less open reservations, and it is the only column the readiness check spends. Quality hold,
                        blocked, in transit, staged and vendor stock are all ours, but none of them can be issued
                        to an order without an action first.
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="crc-panel crc-panel-top" id="sec-stkloc">
                <div className="crc-panel-head">
                  <span>Where each quantity physically sits</span>
                  <span className="crc-head-right">
                    <span className="crc-panel-flag">
                      {SLOCS.filter((x) => !included.has(x.code)).length} of {SLOCS.length} locations excluded from the calculation
                    </span>
                  </span>
                </div>
                <div className="crc-tablewrap">
                  <table className="crc-table crc-matrix">
                    <thead>
                      <tr>
                        <th className="crc-th-mat">Material</th>
                        {SLOCS.map((sl) => (
                          <th key={sl.code} className={`crc-num ${included.has(sl.code) ? "" : "crc-th-off"}`}>
                            <span className="crc-mono">{sl.code}</span>
                            <span className="crc-th-sub">{sl.type}</span>
                            <span className="crc-th-sub">{included.has(sl.code) ? "counted" : "excluded"}</span>
                          </th>
                        ))}
                        <th className="crc-num">At vendor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {touched.map((m) => {
                        const x = stockPicture(m, plant, included, horizonRules, null, subcon.held);
                        return (
                          <tr key={m}>
                            <td className="crc-th-mat">
                              <div className="crc-matcode">{m}</div>
                              <div className="crc-matdesc">{x.desc}</div>
                            </td>
                            {SLOCS.map((sl) => (
                              <td key={sl.code} className={`crc-num ${included.has(sl.code) ? "" : "crc-cell-off"}`}>
                                {x.byLoc[sl.code] > 0 ? fmtQty(x.byLoc[sl.code], x.uom) : <span className="crc-dim">—</span>}
                              </td>
                            ))}
                            <td className="crc-num">
                              {x.atVendor > 0 ? <span className="crc-vendorqty">{fmtQty(x.atVendor, x.uom)}</span> : <span className="crc-dim">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="crc-legend">
                  Excluded stock is never hidden. It is shown here, counted in the owned figure, and offered as the
                  first way to close a shortage — so you can decide whether a usage decision or a release makes it
                  usable in time. Vendor stock has no storage location because it is not at the plant at all.
                </div>
              </div>
            </>
          )}

          {/* batch marking sits with the stock it affects */}
          {tab === "stock" && touched.some(isBatchManaged) && (
            <div className="crc-panel crc-panel-top" id="sec-stkbatch">
              <div className="crc-panel-head">
                <span>Batch stock — untick a batch to keep it out of the availability figure</span>
                <span className="crc-head-right">
                  <span className={batchOut.size ? "crc-panel-flag" : "crc-dim"}>
                    {batchOut.size} of {batchesInScope.length} batches marked out
                  </span>
                  <button className="crc-linkbtn" onClick={() => setBatchOut(new Set())}>count everything</button>
                  <button className="crc-linkbtn" onClick={() => setBatchOut(defaultBatchExclusions())}>reset</button>
                </span>
              </div>
              <div className="crc-tablewrap">
                <table className="crc-table">
                  <thead>
                    <tr>
                      <th className="crc-th-count">Count it</th>
                      <th className="crc-th-mat">Material</th>
                      <th>Batch</th>
                      <th>Location</th>
                      <th className="crc-num">Quantity</th>
                      <th>Status</th>
                      <th>Made</th>
                      <th>Expires</th>
                      <th>Vendor batch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchesInScope.map((b) => {
                      const on = !b.excluded;
                      return (
                        <tr key={b.key} className={on ? "" : "crc-tr-muted"}>
                          <td className="crc-th-count">
                            <label className="crc-mark">
                              <input type="checkbox" checked={on} onChange={() => toggleBatch(b.key)} />
                            </label>
                          </td>
                          <td className="crc-th-mat">
                            <div className="crc-matcode">{b.m}</div>
                            <div className="crc-matdesc">{matInfo(b.m).desc}</div>
                          </td>
                          <td className="crc-mono">{b.batch}</td>
                          <td>
                            <span className="crc-mono">{b.sloc}</span>
                            <div className="crc-matdesc">{included.has(b.sloc) ? SLOC_BY_CODE[b.sloc].name : "location excluded"}</div>
                          </td>
                          <td className="crc-num crc-strong">{fmtQty(b.qty, matInfo(b.m).uom)} <span className="crc-uom">{matInfo(b.m).uom}</span></td>
                          <td>
                            {b.expired
                              ? <span className="crc-tag crc-tag-stop">expired</span>
                              : b.status === "restricted"
                                ? <span className="crc-tag crc-tag-caution">restricted</span>
                                : <span className="crc-tag crc-tag-go">unrestricted</span>}
                          </td>
                          <td className="crc-mono crc-dim">{fmtDate(b.mfg)}</td>
                          <td>
                            {b.exp
                              ? <>
                                  <div className={b.expired ? "crc-date-late" : b.shelfDays < 60 ? "crc-excl" : "crc-date"}>{fmtDate(b.exp)}</div>
                                  <div className="crc-matdesc">
                                    {b.expired ? `${-b.shelfDays} days ago` : `${b.shelfDays} days left`}
                                  </div>
                                </>
                              : <span className="crc-dim">no shelf life</span>}
                          </td>
                          <td className="crc-mono crc-dim">{b.vendorBatch}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="crc-legend">
                Expired and restricted batches start unticked, because neither can be issued without a decision
                first. Ticking one counts it immediately — the readiness check, the projection and the shortage
                list all move. Batch quantities add up to the storage location figures above, so the two views
                never disagree.
              </div>
            </div>
          )}

          {/* ---- CONSUMPTION HISTORY ---- */}
          {tab === "consumption" && (
            <>
              <ScreenNav sections={[
                { id: "sec-conspick", label: "Materials", count: consMats.length },
                { id: "sec-consall", label: "All selected", count: consumption.length },
                ...(consSel ? [{ id: "sec-conschart", label: consSel.mat }] : []),
              ]} />

              <div className="crc-panel" id="sec-conspick">
                <div className="crc-panel-head">
                  <span>Usage by plant and material. This screen is not tied to the finished good selected above.</span>
                </div>

                <div className="crc-conspick">
                  <label className="crc-field crc-field-inline">
                    <span>Plant</span>
                    <select value={consPlant} onChange={(e) => pickConsPlant(e.target.value)}>
                      {PLANTS.map((pl) => (
                        <option key={pl.id} value={pl.id}>
                          {pl.id} {pl.name} — {materialsWithHistory(pl.id).length} materials with history
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="crc-consadd-in">
                    <span className="crc-consadd-l">Add a material</span>
                    <MaterialInput
                      value=""
                      options={consOptions}
                      state="ok"
                      onChange={(code) => addConsMaterial(code)}
                    />
                    <button className="crc-linkbtn" disabled={!consOptions.length}
                      onClick={() => setConsMats(consAvailable)}>
                      add all {consAvailable.length}
                    </button>
                    {consMats.length > 0 && (
                      <button className="crc-linkbtn" onClick={() => { setConsMats([]); setConsPick(null); }}>clear</button>
                    )}
                  </div>
                </div>

                {consMats.length > 0 && (
                  <div className="crc-chips crc-chips-row">
                    {consMats.map((m) => (
                      <span key={m} className="crc-chip">
                        <span className="crc-mono">{m}</span>
                        <button onClick={() => removeConsMaterial(m)} title="Remove">×</button>
                      </span>
                    ))}
                  </div>
                )}

                {consumption.length > 0 && (
                  <div className="crc-postats">
                    {(() => {
                      const flagged = consumption.filter((c) => c.status !== "ok").length;
                      const exposed = consumption.filter((c) => c.exposed).length;
                      const unpl = consumption.filter((c) => c.unplannedShare >= 8).length;
                      const idle = consumption.filter((c) => c.idle >= 3).length;
                      return [
                        [consumption.length, `materials tracked at plant ${consPlant}`],
                        [flagged, "with something worth a look"],
                        [exposed, "with less cover than their lead time"],
                        [unpl, "issuing over 8% without an order"],
                        [idle, "not moved for three months"],
                      ].map(([v, k], i) => (
                        <div key={i} className="crc-postat">
                          <div className="crc-postat-v">{v}</div>
                          <div className="crc-postat-k">{k}</div>
                        </div>
                      ));
                    })()}
                  </div>
                )}

                {consumption.length === 0 ? (
                  <div className="crc-empty">
                    <div className="crc-empty-title">No materials selected</div>
                    <p>
                      {consAvailable.length
                        ? `Plant ${consPlant} has ${consAvailable.length} materials with posted usage. Add one above, or add them all.`
                        : `No material at plant ${consPlant} has posted usage history.`}
                    </p>
                  </div>
                ) : (
                  <div className="crc-tablewrap">
                    <table className="crc-table">
                      <thead>
                        <tr>
                          <th className="crc-th-mat">Material</th>
                          <th className="crc-num">Average / month</th>
                          <th className="crc-num">Peak</th>
                          <th className="crc-num">Twelve periods</th>
                          <th className="crc-num">Swing</th>
                          <th className="crc-num">Trend</th>
                          <th className="crc-num">Unplanned</th>
                          <th className="crc-num">Stock</th>
                          <th className="crc-num">Cover</th>
                          <th className="crc-num">Safety</th>
                          <th>What it says</th>
                          <th className="crc-th-act"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {consumption.map((c) => (
                          <tr key={c.key}
                            className={consSel && c.key === consSel.key ? "crc-prog-on" : c.status === "late" ? "crc-tr-short" : ""}
                            onClick={() => setConsPick(c.key)} style={{ cursor: "pointer" }}>
                            <td className="crc-th-mat">
                              <div className="crc-matcode">{c.mat}</div>
                              <div className="crc-matdesc">{c.desc}</div>
                            </td>
                            <td className="crc-num crc-strong">{fmtQty(c.avg, c.uom)} <span className="crc-uom">{c.uom}</span></td>
                            <td className="crc-num crc-dim">{fmtQty(c.peak, c.uom)}</td>
                            <td className="crc-num crc-dim">{fmtQty(c.sum, c.uom)}</td>
                            <td className={`crc-num ${c.cv >= 0.6 ? "crc-excl" : "crc-dim"}`}>{Math.round(c.cv * 100)}%</td>
                            <td className={`crc-num ${c.trend === null ? "crc-dim" : Math.abs(c.trend) >= 25 ? "crc-excl" : "crc-dim"}`}>
                              {c.trend === null ? "—" : `${c.trend > 0 ? "+" : ""}${c.trend}%`}
                            </td>
                            <td className={`crc-num ${c.unplannedShare >= 8 ? "crc-num-short" : "crc-dim"}`}>
                              {c.unplannedShare > 0 ? `${c.unplannedShare}%` : "—"}
                            </td>
                            <td className="crc-num">{fmtQty(c.onHand, c.uom)}</td>
                            <td className={`crc-num ${c.exposed ? "crc-num-short" : ""}`}>
                              {c.coverDays === null ? "—" : `${c.coverDays} d`}
                              {c.lead > 0 && <div className="crc-matdesc">lead {c.lead} d</div>}
                            </td>
                            <td className="crc-num crc-dim">
                              {c.safety > 0
                                ? <>{fmtQty(c.safety, c.uom)}<div className="crc-matdesc">{c.safetyDays} d</div></>
                                : "not set"}
                            </td>
                            <td>
                              {c.flags.length === 0
                                ? <span className="crc-tag crc-tag-go">settings look right</span>
                                : <div className="crc-actionline">{c.flags[0].text}</div>}
                            </td>
                            <td className="crc-th-act">
                              <button className="crc-iconbtn crc-iconbtn-del"
                                onClick={(e) => { e.stopPropagation(); removeConsMaterial(c.mat); }}
                                title="Remove from the list">×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="crc-legend">
                  Averages exclude the current period because it is only part complete. Cover is measured against
                  each material's own lead time rather than a fixed number of days, since a bolt with a week's lead
                  time and a casting with three weeks are not exposed by the same stock level. Stock and cover
                  reflect the storage locations and batches marked in on the planning run.
                </div>
              </div>

              {consumption.length > 1 && (
                <div className="crc-panel crc-panel-top" id="sec-consall">
                  <div className="crc-panel-head">
                    <span>Every material side by side — twelve periods each, on its own scale</span>
                  </div>
                  <div className="crc-sparkgrid">
                    {consumption.map((c) => (
                      <button key={c.key}
                        className={`crc-spark ${consSel && c.key === consSel.key ? "crc-spark-on" : ""}`}
                        onClick={() => setConsPick(c.key)}>
                        <div className="crc-spark-head">
                          <span className="crc-matcode">{c.mat}</span>
                          <span className={`crc-tag crc-tag-${c.status === "ok" ? "go" : c.status === "risk" ? "caution" : "stop"}`}>
                            {c.status === "ok" ? "steady" : c.status === "risk" ? "watch" : "act"}
                          </span>
                        </div>
                        <ConsumptionSpark h={c} />
                        <div className="crc-spark-foot">
                          <span>{fmtQty(c.avg, c.uom)} {c.uom} a month</span>
                          <span className="crc-dim">
                            {c.coverDays === null ? "" : `${c.coverDays} d cover`}
                            {c.unplannedShare >= 8 ? ` · ${c.unplannedShare}% unplanned` : ""}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="crc-legend">
                    Each sparkline has its own vertical scale, so compare shape and trend rather than height.
                    Amber is the part issued without an order behind it.
                  </div>
                </div>
              )}

              {consSel && (
                <div className="crc-panel crc-panel-top" id="sec-conschart">
                  <div className="crc-chart">
                    <div className="crc-chart-head">
                      <h4>{consSel.mat}<span className="crc-head-sub">{consSel.desc}</span></h4>
                      <p>
                        Twelve periods of issues. The amber part of each bar went out without a production order
                        behind it. The current period is part complete and is marked with an asterisk.
                      </p>
                    </div>
                    <ConsumptionChart h={consSel} />
                    <div className="crc-key">
                      <span><i style={{ background: "var(--signal)" }} />Issued to an order</span>
                      <span><i style={{ background: "var(--caution)" }} />Unplanned</span>
                      <span><i style={{ background: "#A9BCC9" }} />Part period</span>
                      <span><i style={{ background: "var(--ink)" }} />Average</span>
                    </div>
                  </div>

                  <div className="crc-postats">
                    {[
                      [fmtQty(consSel.avg, consSel.uom), `average per month, ${consSel.uom}`],
                      [fmtQty(consSel.sum, consSel.uom), "issued in twelve periods"],
                      [`${consSel.unplannedShare}%`, "went out without an order"],
                      [consSel.coverDays === null ? "—" : `${consSel.coverDays} d`, `cover against a ${consSel.lead} day lead time`],
                      [consSel.safety > 0 ? fmtQty(consSel.suggestedSafety, consSel.uom) : "—",
                        consSel.safety > 0 ? `suggested safety, now ${fmtQty(consSel.safety, consSel.uom)}` : "no safety stock set"],
                    ].map(([v, k], i) => (
                      <div key={i} className="crc-postat">
                        <div className="crc-postat-v">{v}</div>
                        <div className="crc-postat-k">{k}</div>
                      </div>
                    ))}
                  </div>

                  {consSel.flags.length > 0 && (
                    <>
                      <div className="crc-subhead">What to look at</div>
                      <ul className="crc-flaglist">
                        {consSel.flags.map((f, i) => (
                          <li key={i} className={`crc-flag crc-flag-${f.tone}`}>{f.text}</li>
                        ))}
                      </ul>
                    </>
                  )}

                  <div className="crc-subhead">Issue documents posted</div>
                  {(() => {
                    const mv = consumptionMovements(consSel.mat, consSel.plant, horizonRules);
                    if (!mv.length) {
                      return (
                        <div className="crc-empty crc-empty-sm">
                          <p>No issue documents in the retained movement history for this material.</p>
                        </div>
                      );
                    }
                    return (
                      <div className="crc-tablewrap">
                        <table className="crc-table">
                          <thead>
                            <tr>
                              <th>Material document</th>
                              <th>Posted</th>
                              <th>Movement</th>
                              <th>Against</th>
                              <th className="crc-num">Quantity</th>
                              <th>Location</th>
                              <th>User</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mv.map((g) => (
                              <tr key={g.doc + g.item}>
                                <td className="crc-matcode">{g.doc}<span className="crc-item">/{g.item}</span></td>
                                <td className="crc-mono">{fmtDate(g.date)}</td>
                                <td>
                                  <div className="crc-matcode">{g.mvt}</div>
                                  <div className="crc-matdesc">{g.meta.text}</div>
                                </td>
                                <td className="crc-mono">{g.ref || <span className="crc-dim">no reference</span>}</td>
                                <td className={`crc-num crc-strong ${g.mvt === "262" ? "crc-mvt-plus" : "crc-mvt-minus"}`}>
                                  {g.mvt === "262" ? "+" : "−"}{fmtQty(g.qty, consSel.uom)}
                                </td>
                                <td className="crc-mono">{g.sloc || <span className="crc-dim">vendor stock</span>}</td>
                                <td>{g.user}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                  <div className="crc-legend">
                    Period totals come from the consumption update on the material, which is what forecast and
                    reorder point planning read. The documents below are the retained movement history and will
                    cover a shorter window than the periods above.
                  </div>
                </div>
              )}
            </>
          )}

          {/* ---- PRODUCTION ORDERS ---- */}
          {tab === "prod" && (
            <div className="crc-panel">
              {shopFloor.orders.length === 0 ? (
                <div className="crc-empty">
                  <div className="crc-empty-title">No production orders</div>
                  <p>Nothing else is in progress at plant {plant}, so no order competes for these components.</p>
                </div>
              ) : (
                <>
                  <div className="crc-panel-head">
                    <span>Other orders on the shop floor, what they have reserved, and what has actually moved</span>
                  </div>

                  <div className="crc-postats">
                    {(() => {
                      const open = shopFloor.orders.filter((o) => !o.complete);
                      const rel = open.filter((o) => o.released).length;
                      const msp = open.filter((o) => o.missingParts).length;
                      const late = open.filter((o) => o.late).length;
                      const demand = open.reduce((a, o) => a + o.openQty, 0);
                      return [
                        [open.length, "orders still open"],
                        [rel, "released to the floor"],
                        [open.length - rel, "created, not yet released"],
                        [msp, "flagged missing parts"],
                        [late, "past their finish date"],
                      ].map(([v, k], i) => (
                        <div key={i} className="crc-postat">
                          <div className="crc-postat-v">{v}</div>
                          <div className="crc-postat-k">{k}</div>
                        </div>
                      ));
                    })()}
                  </div>

                  <div className="crc-subhead">Production orders</div>
                  <div className="crc-tablewrap">
                    <table className="crc-table">
                      <thead>
                        <tr>
                          <th>Order</th>
                          <th className="crc-th-mat">Material</th>
                          <th>Created</th>
                          <th>Mode and user</th>
                          <th>Start</th>
                          <th>Finish</th>
                          <th className="crc-num">Order qty</th>
                          <th className="crc-num">Confirmed</th>
                          <th className="crc-num">Delivered</th>
                          <th className="crc-num">Open</th>
                          <th>System status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shopFloor.orders.map((o) => (
                          <tr key={o.order} className={o.complete ? "crc-tr-muted" : o.missingParts ? "crc-tr-short" : ""}>
                            <td>
                              <div className="crc-matcode">{o.order}</div>
                              <div className="crc-matdesc">{o.type} · controller {o.mrp}</div>
                            </td>
                            <td className="crc-th-mat">
                              <div className="crc-matcode">{o.material}</div>
                              <div className="crc-matdesc">{MATERIALS[o.material].desc}</div>
                            </td>
                            <td>
                              <div className="crc-mono">{fmtDate(o.created)}</div>
                              <div className="crc-matdesc">{diffDays(t0, o.created)} days ago</div>
                            </td>
                            <td>
                              <span className={`crc-mode crc-mode-${o.mode === "MRP" ? "mrp" : "man"}`}>{o.mode}</span>
                              <div className="crc-matdesc">{o.createdBy}</div>
                            </td>
                            <td className="crc-mono">{fmtDate(o.start)}</td>
                            <td>
                              <div className={o.late ? "crc-date-late" : "crc-date"}>{fmtDate(o.finish)}</div>
                              {o.late && <div className="crc-matdesc">{diffDays(t0, o.finish)} days late</div>}
                            </td>
                            <td className="crc-num">{fmtQty(o.qty, MATERIALS[o.material].uom)}</td>
                            <td className="crc-num crc-dim">{o.confirmed > 0 ? fmtQty(o.confirmed, MATERIALS[o.material].uom) : "—"}</td>
                            <td className="crc-num crc-dim">{o.delivered > 0 ? fmtQty(o.delivered, MATERIALS[o.material].uom) : "—"}</td>
                            <td className="crc-num crc-strong">{fmtQty(o.openQty, MATERIALS[o.material].uom)}</td>
                            <td>
                              <div className="crc-statuses">
                                {o.status.map((s) => (
                                  <span key={s} className={`crc-status crc-status-${ORDER_STATUS[s].tone}`} title={ORDER_STATUS[s].name}>{s}</span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="crc-subhead">Component requirements these orders hold</div>
                  {commitments.resv.length === 0 ? (
                    <div className="crc-empty crc-empty-sm">
                      <p>None of these orders reserves a component that this bill of material needs.</p>
                    </div>
                  ) : (
                    <div className="crc-tablewrap">
                      <table className="crc-table">
                        <thead>
                          <tr>
                            <th className="crc-th-mat">Material</th>
                            <th>Reservation</th>
                            <th>Against order</th>
                            <th>Order status</th>
                            <th className="crc-num">Required</th>
                            <th className="crc-num">Withdrawn</th>
                            <th className="crc-num">Still open</th>
                            <th>Needed on</th>
                            <th>Effect here</th>
                          </tr>
                        </thead>
                        <tbody>
                          {commitments.resv.map((r) => (
                            <tr key={r.id} className={r.counted ? "" : "crc-tr-muted"}>
                              <td className="crc-th-mat">
                                <div className="crc-matcode">{r.m}</div>
                                <div className="crc-matdesc">{MATERIALS[r.m].desc}</div>
                              </td>
                              <td className="crc-mono crc-dim">{r.id}</td>
                              <td className="crc-mono">{r.order}</td>
                              <td>
                                <div className="crc-statuses">
                                  {(r.orderInfo ? r.orderInfo.status : []).map((s) => (
                                    <span key={s} className={`crc-status crc-status-${ORDER_STATUS[s].tone}`} title={ORDER_STATUS[s].name}>{s}</span>
                                  ))}
                                </div>
                              </td>
                              <td className="crc-num crc-dim">{fmtQty(r.reqQty, r.uom)}</td>
                              <td className="crc-num crc-dim">{fmtQty(r.withdrawn, r.uom)}</td>
                              <td className="crc-num crc-strong">{fmtQty(r.open, r.uom)} <span className="crc-uom">{r.uom}</span></td>
                              <td className="crc-mono">{fmtDate(r.date)}</td>
                              <td>
                                {r.counted
                                  ? <span className="crc-tag crc-tag-caution">Subtracted</span>
                                  : <span className="crc-tag crc-tag-neutral">
                                      {resPolicy === "horizon" ? `Due after ${fmtDate(needBy)}`
                                        : resPolicy === "released" ? "Order not released"
                                        : "Not subtracted"}
                                    </span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="crc-legend">
                    Withdrawn quantities on the reservations above are the sum of the issues posted against each
                    order. An order still in CRTD has reserved stock but has not been released, which is why the
                    reservation rule offers a released-only setting — those requirements are usually still
                    re-plannable. The issue documents themselves are on the consumption history screen.
                  </div>
                </>
              )}
            </div>
          )}

          {/* ---- PURCHASE ORDERS ---- */}
          {tab === "orders" && (
            <div className="crc-panel">
              {commitments.supply.length === 0 ? (
                <div className="crc-empty">
                  <div className="crc-empty-title">Nothing on order</div>
                  <p>No purchase orders or stock transfer orders exist for these components at plant {plant}.</p>
                </div>
              ) : (
                <>
                  <div className="crc-panel-head">
                    <span>Every purchase and stock transfer order covering these components at plant {plant}</span>
                    <span className="crc-head-right">
                      <span className="crc-seg crc-seg-sm">
                        {[["open", "Open only"], ["all", "Include received"]].map(([k, label]) => (
                          <button key={k} className={poFilter === k ? "crc-seg-btn crc-seg-on" : "crc-seg-btn"}
                            onClick={() => setPoFilter(k)}>{label}</button>
                        ))}
                      </span>
                    </span>
                  </div>

                  <div className="crc-postats">
                    {(() => {
                      const open = commitments.supply.filter((s) => s.openQty > 0);
                      const inTime = open.filter((s) => s.date <= needBy).length;
                      const overdue = open.filter((s) => s.overdue).length;
                      const mrp = open.filter((s) => s.mode === "MRP").length;
                      const stats = [
                        [open.length, "orders still open"],
                        [inTime, `land by ${fmtDate(needBy)}`],
                        [open.length - inTime - overdue, "land after the need date"],
                        [overdue, "past the delivery date"],
                        [`${mrp} of ${open.length}`, "created by MRP"],
                      ];
                      return stats.map(([v, k], i) => (
                        <div key={i} className="crc-postat">
                          <div className="crc-postat-v">{v}</div>
                          <div className="crc-postat-k">{k}</div>
                        </div>
                      ));
                    })()}
                  </div>

                  <div className="crc-chart">
                    <div className="crc-chart-head">
                      <h4>Order placed to delivery promised</h4>
                      <p>
                        Each bar runs from the date the order was created to its confirmed delivery date, so a
                        short bar reaching past the need-by line is an order that was placed too late to help.
                      </p>
                    </div>
                    <PoTimeline
                      orders={commitments.supply.filter((s) => poFilter === "all" || s.openQty > 0)}
                      t0={t0}
                      needBy={needBy}
                    />
                    <div className="crc-key">
                      <span><i style={{ background: "var(--signal)" }} />Created by MRP</span>
                      <span><i style={{ background: "var(--caution)" }} />Created manually</span>
                      <span><i style={{ background: "var(--rule)" }} />Already received</span>
                    </div>
                  </div>

                  <div className="crc-tablewrap">
                    <table className="crc-table">
                      <thead>
                        <tr>
                          <th className="crc-th-mat">Material</th>
                          <th>Document</th>
                          <th>Vendor</th>
                          <th>Created</th>
                          <th>Mode</th>
                          <th>Delivery date</th>
                          <th className="crc-num">Ordered</th>
                          <th className="crc-num">Received</th>
                          <th className="crc-num">Open</th>
                          <th className="crc-num">Pegged</th>
                          <th className="crc-num">Free here</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {commitments.supply
                          .filter((s) => poFilter === "all" || s.openQty > 0)
                          .map((s) => (
                            <tr key={s.doc + s.item} className={s.openQty <= 0 ? "crc-tr-muted" : ""}>
                              <td className="crc-th-mat">
                                <div className="crc-matcode">{s.m}</div>
                                <div className="crc-matdesc">{MATERIALS[s.m].desc}</div>
                              </td>
                              <td>
                                <div className="crc-matcode">
                                  {s.doc}<span className="crc-item">/{s.item}</span>
                                  <span className={`crc-proc crc-proc-${s.type === "PO" ? "F" : "E"}`}>{s.type}</span>
                                </div>
                              </td>
                              <td>
                                <div>{s.vendor}</div>
                                <div className="crc-matdesc crc-mono">{s.vendorCode}</div>
                              </td>
                              <td>
                                <div className="crc-mono">{fmtDate(s.created)}</div>
                                <div className="crc-matdesc">{diffDays(t0, s.created)} days ago</div>
                              </td>
                              <td>
                                <span className={`crc-mode crc-mode-${s.mode === "MRP" ? "mrp" : "man"}`}>{s.mode}</span>
                                <div className="crc-matdesc">{s.createdBy}</div>
                              </td>
                              <td>
                                <div className={s.date > needBy ? "crc-date-late" : "crc-date"}>{fmtDate(s.date)}</div>
                                <div className="crc-matdesc">
                                  {s.date > needBy
                                    ? `${diffDays(s.date, needBy)} days after need date`
                                    : `${diffDays(needBy, s.date)} days of margin`}
                                </div>
                              </td>
                              <td className="crc-num">{fmtQty(s.q, s.uom)}</td>
                              <td className="crc-num crc-dim">{s.received > 0 ? fmtQty(s.received, s.uom) : "—"}</td>
                              <td className="crc-num crc-strong">{fmtQty(s.openQty, s.uom)} <span className="crc-uom">{s.uom}</span></td>
                              <td className="crc-num">
                                {s.pegged > 0
                                  ? <span className={excludePegged ? "crc-resv" : "crc-dim"}>{fmtQty(s.pegged, s.uom)}</span>
                                  : <span className="crc-dim">—</span>}
                              </td>
                              <td className="crc-num crc-strong">
                                {s.free > 0 ? <span className="crc-inbound">{fmtQty(s.free, s.uom)}</span> : <span className="crc-dim">0</span>}
                              </td>
                              <td>
                                {s.overdue
                                  ? <span className="crc-tag crc-tag-stop">Overdue</span>
                                  : s.state === "closed"
                                    ? <span className="crc-tag crc-tag-neutral">Fully received</span>
                                    : s.state === "partial"
                                      ? <span className="crc-tag crc-tag-caution">Part received</span>
                                      : <span className="crc-tag crc-tag-go">Open</span>}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="crc-legend">
                    Open quantity is what the vendor still owes: ordered less received. Free here is the open
                    quantity after removing anything pegged to earlier demand, and that is the only part this
                    order can draw on. Pegged detail is on each shortage in the Shortages tab.
                  </div>
                </>
              )}
            </div>
          )}

          {/* ---- SUBCONTRACTING ---- */}
          {tab === "subcon" && (
            <div className="crc-panel">
              {subcon.orders.length === 0 ? (
                <div className="crc-empty">
                  <div className="crc-empty-title">No subcontracting at this plant</div>
                  <p>Nothing is out with a vendor, so no component stock is held outside plant {plant}.</p>
                </div>
              ) : (
                <>
                  <div className="crc-panel-head">
                    <span>Work out with vendors, and the components of ours they are holding</span>
                  </div>

                  <div className="crc-postats">
                    {(() => {
                      const open = subcon.orders.filter((s) => s.openQty > 0);
                      const overdue = open.filter((s) => s.overdue).length;
                      const oldest = subcon.held.length ? Math.max(...subcon.held.map((v) => v.ageDays)) : 0;
                      const used = subcon.held.filter((v) => result.lines.some((l) => l.code === v.code)).length;
                      return [
                        [open.length, "orders still open"],
                        [subcon.held.length, "component lines at vendors"],
                        [used, "of them needed by this order"],
                        [overdue, "orders past the delivery date"],
                        [`${oldest} d`, "longest time at a vendor"],
                      ].map(([v, k], i) => (
                        <div key={i} className="crc-postat">
                          <div className="crc-postat-v">{v}</div>
                          <div className="crc-postat-k">{k}</div>
                        </div>
                      ));
                    })()}
                  </div>

                  <div className="crc-chart">
                    <div className="crc-chart-head">
                      <h4>Subcontracting orders, raised to promised return</h4>
                      <p>
                        A bar ending left of today is an order the vendor has not returned on time, and every day
                        it runs on is a day our components sit in their plant instead of ours.
                      </p>
                    </div>
                    <PoTimeline orders={subcon.orders} t0={t0} needBy={needBy} />
                    <div className="crc-key">
                      <span><i style={{ background: "var(--signal)" }} />Created by MRP</span>
                      <span><i style={{ background: "var(--caution)" }} />Created manually</span>
                      <span><i style={{ background: "var(--rule)" }} />Already returned</span>
                    </div>
                  </div>

                  <div className="crc-subhead">Subcontracting orders</div>
                  <div className="crc-tablewrap">
                    <table className="crc-table">
                      <thead>
                        <tr>
                          <th className="crc-th-mat">Vendor returns</th>
                          <th>Document</th>
                          <th>Vendor</th>
                          <th>Operation</th>
                          <th>Created</th>
                          <th>Mode and user</th>
                          <th>Delivery date</th>
                          <th className="crc-num">Ordered</th>
                          <th className="crc-num">Returned</th>
                          <th className="crc-num">Open</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subcon.orders.map((s) => (
                          <tr key={s.doc + s.item} className={s.openQty <= 0 ? "crc-tr-muted" : ""}>
                            <td className="crc-th-mat">
                              <div className="crc-matcode">{s.material}</div>
                              <div className="crc-matdesc">{MATERIALS[s.material].desc}</div>
                            </td>
                            <td>
                              <div className="crc-matcode">
                                {s.doc}<span className="crc-item">/{s.item}</span>
                                <span className="crc-proc crc-proc-E">SC</span>
                              </div>
                            </td>
                            <td>
                              <div>{s.vendor}</div>
                              <div className="crc-matdesc crc-mono">{s.vendorCode}</div>
                            </td>
                            <td className="crc-matdesc">{s.service}</td>
                            <td>
                              <div className="crc-mono">{fmtDate(s.created)}</div>
                              <div className="crc-matdesc">{diffDays(t0, s.created)} days ago</div>
                            </td>
                            <td>
                              <span className={`crc-mode crc-mode-${s.mode === "MRP" ? "mrp" : "man"}`}>{s.mode}</span>
                              <div className="crc-matdesc">{s.createdBy}</div>
                            </td>
                            <td>
                              <div className={s.overdue || s.date > needBy ? "crc-date-late" : "crc-date"}>{fmtDate(s.date)}</div>
                              <div className="crc-matdesc">
                                {s.overdue
                                  ? `${diffDays(t0, s.date)} days overdue`
                                  : s.date > needBy
                                    ? `${diffDays(s.date, needBy)} days after need date`
                                    : `${diffDays(needBy, s.date)} days of margin`}
                              </div>
                            </td>
                            <td className="crc-num">{fmtQty(s.q, MATERIALS[s.material].uom)}</td>
                            <td className="crc-num crc-dim">{s.received > 0 ? fmtQty(s.received, MATERIALS[s.material].uom) : "—"}</td>
                            <td className="crc-num crc-strong">{fmtQty(s.openQty, MATERIALS[s.material].uom)}</td>
                            <td>
                              {s.overdue
                                ? <span className="crc-tag crc-tag-stop">Overdue</span>
                                : s.state === "closed"
                                  ? <span className="crc-tag crc-tag-neutral">Complete</span>
                                  : s.state === "partial"
                                    ? <span className="crc-tag crc-tag-caution">Part returned</span>
                                    : <span className="crc-tag crc-tag-go">With vendor</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="crc-subhead">Our components held at subcontractors</div>
                  {subcon.held.length === 0 ? (
                    <div className="crc-empty crc-empty-sm">
                      <p>Every component provided has been consumed. Nothing of ours is sitting at a vendor.</p>
                    </div>
                  ) : (
                    <div className="crc-tablewrap">
                      <table className="crc-table">
                        <thead>
                          <tr>
                            <th className="crc-th-mat">Component</th>
                            <th>Vendor</th>
                            <th>Against order</th>
                            <th>Sent on</th>
                            <th className="crc-num">Provided</th>
                            <th className="crc-num">Consumed</th>
                            <th className="crc-num">Still at vendor</th>
                            <th className="crc-num">Days held</th>
                            <th>Bearing on this order</th>
                          </tr>
                        </thead>
                        <tbody>
                          {subcon.held.map((v) => {
                            const line = result.lines.find((l) => l.code === v.code);
                            const uom = MATERIALS[v.code].uom;
                            return (
                              <tr key={v.doc + v.item + v.code} className={v.overdue ? "crc-tr-short" : ""}>
                                <td className="crc-th-mat">
                                  <div className="crc-matcode">{v.code}</div>
                                  <div className="crc-matdesc">{MATERIALS[v.code].desc}</div>
                                </td>
                                <td>
                                  <div>{v.vendor}</div>
                                  <div className="crc-matdesc crc-mono">{v.vendorCode}</div>
                                </td>
                                <td>
                                  <div className="crc-matcode">{v.doc}<span className="crc-item">/{v.item}</span></div>
                                  <div className="crc-matdesc">returns {v.parent}</div>
                                </td>
                                <td>
                                  <div className="crc-mono">{fmtDate(v.sentOn)}</div>
                                  <div className="crc-matdesc">{v.mode} · {v.createdBy}</div>
                                </td>
                                <td className="crc-num crc-dim">{fmtQty(v.provided, uom)}</td>
                                <td className="crc-num crc-dim">{v.consumed > 0 ? fmtQty(v.consumed, uom) : "—"}</td>
                                <td className="crc-num crc-strong">
                                  <span className="crc-vendorqty">{fmtQty(v.qty, uom)}</span> <span className="crc-uom">{uom}</span>
                                </td>
                                <td className={`crc-num ${v.ageDays > 20 ? "crc-num-short" : ""}`}>{v.ageDays}</td>
                                <td>
                                  {!line
                                    ? <span className="crc-dim">not in this bill</span>
                                    : line.shortage > 0
                                      ? <span className="crc-tag crc-tag-caution">
                                          could cover {fmtQty(Math.min(v.qty, line.shortage), uom)} of the shortage
                                        </span>
                                      : <span className="crc-tag crc-tag-go">not needed, stock covers it</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="crc-legend">
                    This is special stock held at the vendor: ours on the books, but not issuable at plant {plant}
                    until it is recalled. Recalling is offered on a shortage only after internal transfers and
                    inter-plant moves, because pulling components back stops the subcontract work they were sent for.
                    Storage location SC01 is different — that is material staged at the plant and not yet dispatched.
                  </div>
                </>
              )}
            </div>
          )}

          {/* ---- SAP MAPPING ---- */}
          {tab === "sap" && (
            <div className="crc-panel">
              <div className="crc-panel-head">
                <span>Where each dataset comes from in SAP, and the adapter that reshapes it</span>
              </div>
              <div className="crc-sapintro">
                <p>
                  Each area lists the underlying tables and the released CDS view that exposes the same data on
                  S/4HANA. Prefer the CDS view: it applies the joins, language and status filters that a raw table
                  read leaves to you.
                </p>
                <p>
                  The screen runs on demo data shaped the way the engine wants it. To point it at a real system,
                  replace each constant below with the output of its adapter in <span className="crc-mono">SAP_ADAPTERS</span>,
                  which takes rows still carrying SAP field names. Nothing in the calculation changes.
                </p>
                <p>
                  Extract everything in one pass with a single timestamp. Pegging in particular is the result of the
                  last MRP run rather than a stored field, so a stock extract from this morning read against a
                  pegging extract from last night will quietly disagree.
                </p>
              </div>

              {SAP_SOURCES.map((src) => (
                <section key={src.area} className="crc-sap">
                  <div className="crc-sap-head">
                    <div>
                      <h4>{src.area}</h4>
                      <div className="crc-sap-target">
                        replaces <span className="crc-mono">{src.target}</span>
                      </div>
                    </div>
                    <div className="crc-sap-meta">
                      <div><dt>CDS view</dt><dd className="crc-mono crc-sap-fld">{src.cds}</dd></div>
                      <div><dt>Read via</dt><dd>{src.read}</dd></div>
                      <div><dt>Transaction</dt><dd>{src.tcode}</dd></div>
                    </div>
                  </div>

                  <div className="crc-sap-tables">
                    {src.tables.map((t) => (
                      <span key={t.t} className="crc-sap-table">
                        <span className="crc-mono">{t.t}</span>
                        <span className="crc-sap-tt">{t.text}</span>
                        <span className="crc-sap-key">key {t.key}</span>
                      </span>
                    ))}
                  </div>

                  <table className="crc-conttable crc-saptable">
                    <thead>
                      <tr>
                        <th>Field here</th>
                        <th>SAP field</th>
                        <th>Meaning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {src.fields.map(([app, sap, note]) => (
                        <tr key={app + sap}>
                          <td className="crc-mono">{app}</td>
                          <td className="crc-mono crc-sap-fld">{sap}</td>
                          <td className="crc-dim">{note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {src.note && <div className="crc-sap-note">{src.note}</div>}
                </section>
              ))}

              <div className="crc-legend">
                Storage location stock needs one row per stock category, not per location: MARD holds unrestricted,
                quality inspection and blocked quantities in separate fields on the same row, and this screen treats
                them as separate locations so they can be excluded independently. The stock adapter takes a mapping
                function for exactly that.
              </div>
            </div>
          )}

          {/* ---- SUMMARY ---- */}
          {tab === "summary" && (
            <>
              <ScreenNav sections={[
                { id: "sec-sumhead", label: "Headline" },
                { id: "sec-sumread", label: "Key readings", count: summary.stats.length },
                { id: "sec-sumfind", label: "Findings", count: summary.issues.length },
                { id: "sec-sumbrief", label: "Briefing" },
              ]} />

              <div className="crc-report" id="sec-sumhead">
                <div className="crc-report-head">
                  <div>
                    <div className="crc-report-t">Component readiness and capacity report</div>
                    <div className="crc-report-s">
                      Plant{programme.plants.length > 1 ? "s" : ""} {programme.plants.join(", ")} ·
                      {" "}{programme.lines.length} planning line{programme.lines.length === 1 ? "" : "s"} ·
                      {" "}horizon {weeks.length} weeks to {fmtDateLong(weeks[weeks.length - 1].to)}
                    </div>
                    <div className="crc-report-s">Generated {fmtDateLong(t0)}</div>
                  </div>
                  <div className="crc-report-actions">
                    <button className="crc-btn crc-btn-light" onClick={() => {
                      const text = summaryText({ summary, programme, t0, weeks, ai: aiSummary });
                      if (navigator.clipboard) navigator.clipboard.writeText(text).then(
                        () => { setCopied(true); setTimeout(() => setCopied(false), 2200); },
                        () => setCopied(false));
                    }}>{copied ? "Copied" : "Copy as text"}</button>
                    <button className="crc-btn crc-btn-light" onClick={() => window.print()}>Print</button>
                  </div>
                </div>
                <table className="crc-table crc-report-lines">
                  <thead>
                    <tr>
                      <th className="crc-num">Line</th>
                      <th>Sales order</th>
                      <th className="crc-th-mat">Material</th>
                      <th className="crc-num">Qty</th>
                      <th>Plant</th>
                      <th>Customer wants</th>
                      <th>Must start</th>
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {programme.lines.map((L) => (
                      <tr key={L.key}>
                        <td className="crc-num crc-dim">{L.seq}</td>
                        <td>
                          {L.so
                            ? <><span className="crc-mono">{L.so.doc}/{L.so.item}</span><div className="crc-matdesc">{L.so.customer}</div></>
                            : <span className="crc-dim">planner entry</span>}
                        </td>
                        <td className="crc-th-mat">
                          <div className="crc-matcode">{L.fg}</div>
                          <div className="crc-matdesc">{matInfo(L.fg).desc}</div>
                        </td>
                        <td className="crc-num">{L.qty}</td>
                        <td className="crc-mono">{L.plant}</td>
                        <td className="crc-mono">{fmtDate(L.delivery)}</td>
                        <td className={L.startsInPast ? "crc-date-late" : "crc-date"}>
                          {L.master.ok ? fmtDate(L.needBy) : "—"}
                          {L.startsInPast && <div className="crc-matdesc">passed</div>}
                        </td>
                        <td>
                          {!L.master.ok
                            ? <span className="crc-tag crc-tag-stop">cannot explode</span>
                            : <span className={`crc-tag crc-tag-${L.result.verdict === "release" ? "go" : L.result.verdict === "coverable" ? "caution" : "stop"}`}>
                                {L.result.verdict === "release" ? "ready" : L.result.verdict === "coverable" ? "recoverable" : "misses date"}
                              </span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={`crc-verdict crc-panel-top crc-v-${summary.state === "release" ? "go" : summary.state === "coverable" ? "caution" : "stop"}`}>
                <div className="crc-verdict-lead">
                  <div className="crc-verdict-word">
                    {summary.state === "release" ? "The plan holds" : summary.state === "coverable" ? "Needs attention" : "Action needed today"}
                  </div>
                  <p className="crc-verdict-line">{summary.headline}</p>
                  {summary.worst && (
                    <div className="crc-verdict-order">
                      Biggest single item: {summary.worst.headline}
                    </div>
                  )}
                </div>
                <div className="crc-metrics">
                  {[["critical", "must act today", "stop"], ["warning", "this week", "caution"], ["watch", "worth watching", "signal"]].map(([k, label, tone]) => (
                    <div key={k} className="crc-metric">
                      <div className="crc-metric-v" style={{ color: summary.counts[k] ? `var(--${tone === "signal" ? "signal" : tone})` : "var(--ink3)" }}>
                        {summary.counts[k]}
                      </div>
                      <div className="crc-metric-k">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="crc-panel crc-panel-top" id="sec-sumread">
                <div className="crc-panel-head">
                  <span>Key readings — one number from every screen, for the whole run</span>
                  <span className="crc-head-right"><span className="crc-dim">click any reading to open the screen behind it</span></span>
                </div>
                <div className="crc-sumgrid">
                  {summary.stats.map((st) => (
                    <button key={st.k} className="crc-sumstat" onClick={() => setTab(st.screen)}>
                      <div className="crc-sumstat-v">{st.v}</div>
                      <div className="crc-sumstat-k">{st.k}</div>
                      <div className="crc-sumstat-s">{st.s}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="crc-panel crc-panel-top" id="sec-sumfind">
                <div className="crc-panel-head">
                  <span>Findings — grouped by root cause, worst first</span>
                  <span className="crc-head-right">
                    <span className="crc-panel-flag">{summary.issues.length} item{summary.issues.length === 1 ? "" : "s"}</span>
                  </span>
                </div>
                <div className="crc-sevkey">
                  <span><i className="crc-sev-stop" /><b>Act today</b> — the plan breaks unless someone moves on it now</span>
                  <span><i className="crc-sev-caution" /><b>This week</b> — recoverable, but it needs a decision before the week is out</span>
                  <span><i className="crc-sev-signal" /><b>Watch</b> — no action yet, but it will become one if nothing changes</span>
                </div>
                {summary.issues.length === 0 ? (
                  <div className="crc-empty">
                    <div className="crc-empty-title">Nothing to report</div>
                    <p>Every check across the run came back clean.</p>
                  </div>
                ) : (
                  <ul className="crc-issues">
                    {summary.issues.map((i, n) => (
                      <li key={n} className={`crc-issue crc-issue-${i.sev}`}>
                        <div className="crc-issue-tag">
                          <span className={`crc-tag crc-tag-${i.sev === "critical" ? "stop" : i.sev === "warning" ? "caution" : "signal"}`}>
                            {i.sev === "critical" ? "Act today" : i.sev === "warning" ? "This week" : "Watch"}
                          </span>
                          <span className="crc-issue-area">{i.area}</span>
                        </div>
                        <div className="crc-issue-body">
                          <div className="crc-issue-head"><span className="crc-issue-n">{n + 1}.</span> {i.headline}</div>
                          <div className="crc-issue-detail">{i.detail}</div>
                        </div>
                        <button className="crc-minibtn" onClick={() => setTab(i.screen)}>Open</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="crc-panel crc-panel-top" id="sec-sumbrief">
                <div className="crc-aibox-head">
                  <div>
                    <h4>Briefing</h4>
                    <p>Turns the findings above into what to say, who does it, and the one call that needs a person.</p>
                  </div>
                  <button className="crc-btn" onClick={draftSummary} disabled={sumBusy}>
                    {sumBusy ? "Writing…" : aiSummary ? "Write it again" : "Write the briefing"}
                  </button>
                </div>
                {sumError && <div className="crc-error">{sumError}</div>}
                {aiSummary && (
                  <div className="crc-plan">
                    <p className="crc-plan-headline">{aiSummary.headline}</p>
                    {aiSummary.situation && <p className="crc-brief-sit">{aiSummary.situation}</p>}
                    {aiSummary.decision && (
                      <div className="crc-critical">
                        <span>Decision needed</span>
                        <p>{aiSummary.decision}</p>
                      </div>
                    )}
                    {[["today", "Today"], ["thisWeek", "Later this week"]].map(([k, label]) => (
                      (aiSummary[k] || []).length > 0 && (
                        <div key={k} className="crc-briefblock">
                          <div className="crc-subhead crc-subhead-flat">{label}</div>
                          <div className="crc-tablewrap">
                            <table className="crc-table">
                              <thead>
                                <tr><th className="crc-num">#</th><th>Action</th><th>Owner</th><th>Why</th></tr>
                              </thead>
                              <tbody>
                                {aiSummary[k].map((a, i) => (
                                  <tr key={i}>
                                    <td className="crc-num crc-dim">{i + 1}</td>
                                    <td className="crc-strong">{a.action}</td>
                                    <td>{a.owner}</td>
                                    <td className="crc-dim">{a.why}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    ))}
                    {(aiSummary.watch || []).length > 0 && (
                      <div className="crc-watch">
                        <div className="crc-watch-title">Worth watching</div>
                        <ul>{aiSummary.watch.map((w, i) => <li key={i}>{w}</li>)}</ul>
                      </div>
                    )}
                  </div>
                )}
                {!aiSummary && !sumBusy && !sumError && (
                  <div className="crc-empty crc-empty-sm">
                    <p>The readings above stand on their own. The briefing adds a narrative and an owner against each action.</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ---- ANALYSIS ---- */}
          {tab === "analysis" && (
            <div className="crc-panel">
              <div className="crc-analysis">
                <div className="crc-readout">
                  <h4>What the numbers say</h4>
                  <p>
                    Against a demand of {fmtQty(Number(orderQty) || 0, "EA")} {matInfo(fgCode).uom} of {fgCode} at plant {plant},
                    {result.shortLines.length === 0
                      ? " every component clears. The kit is complete and the order can go to the shop floor."
                      : ` ${result.shortLines.length} of ${result.lines.filter((l) => !l.isAssembly).length} components fall short.`}
                    {result.buildable > 0 && result.buildable < Number(orderQty) && (
                      <> You can start a partial run of {result.buildable} today; {result.tightest.code} is what caps it.</>
                    )}
                    {result.buildable === 0 && result.shortLines.length > 0 && (
                      <> Nothing can be built today — {result.tightest.code} has no usable stock.</>
                    )}
                  </p>
                  {result.shortLines.length > 0 && (
                    <p>
                      The full kit lands {fmtDateLong(result.fullKit)}
                      {result.fullKit > needBy
                        ? `, which is ${diffDays(result.fullKit, needBy)} days later than the ${fmtDate(needBy)} start you asked for.`
                        : `, inside the ${fmtDate(needBy)} start date.`}
                      {result.critical && ` The date is set by ${result.critical.code}; nothing else on the list moves it.`}
                      {" "}
                      {(() => {
                        const t = { transfer: 0, sto: 0, expedite: 0, pr: 0 };
                        result.shortLines.forEach((l) =>
                          l.resolution.steps.forEach((s) => { if (t[s.kind] !== undefined) t[s.kind]++; })
                        );
                        const parts = [];
                        if (t.transfer) parts.push(`${t.transfer} internal transfer${t.transfer > 1 ? "s" : ""}`);
                        if (t.sto) parts.push(`${t.sto} inter-plant transfer${t.sto > 1 ? "s" : ""}`);
                        if (t.expedite) parts.push(`${t.expedite} purchase order${t.expedite > 1 ? "s" : ""} to expedite`);
                        if (t.pr) parts.push(`${t.pr} new requisition${t.pr > 1 ? "s" : ""}`);
                        return parts.length ? `Closing the gap takes ${parts.join(", ")}.` : "";
                      })()}
                    </p>
                  )}
                  {(() => {
                    const counted = commitments.resv.filter((r) => r.counted);
                    const pegged = commitments.supply.filter((s) => s.pegged > 0);
                    if (!counted.length && !pegged.length) return null;
                    return (
                      <p>
                        {counted.length > 0 && (
                          <>Other released orders hold {counted.length} open reservation{counted.length > 1 ? "s" : ""} against these materials, which is why on-hand and available differ. </>
                        )}
                        {pegged.length > 0 && excludePegged && (
                          <>{pegged.length} inbound document{pegged.length > 1 ? "s are" : " is"} partly pegged to demand a previous MRP run already planned for, so only the free balance has been used here.</>
                        )}
                      </p>
                    );
                  })()}
                  {resPolicy === "none" && (
                    <p className="crc-warnline">
                      Reservations are being ignored, so stock committed to other orders is counted as free.
                      Agree the re-allocation with the planners who own those orders before releasing.
                    </p>
                  )}
                  {!excludePegged && (
                    <p className="crc-warnline">
                      Pegged supply is being counted as available. The same receipt is now promised to two orders —
                      whichever draws it first leaves the other short.
                    </p>
                  )}
                </div>

                {result.shortLines.length > 0 && (
                  <div className="crc-chart crc-chart-flat">
                    <div className="crc-chart-head">
                      <h4>Size of each gap</h4>
                      <p>Shortfall as a share of what the order needs, worst first.</p>
                    </div>
                    <ShortfallBars lines={result.shortLines} />
                  </div>
                )}

                <div className="crc-aibox">
                  <div className="crc-aibox-head">
                    <div>
                      <h4>Sequenced action plan</h4>
                      <p>Turns the shortage list into dated actions with an owner against each one.</p>
                    </div>
                    <button className="crc-btn" onClick={draftPlan} disabled={aiBusy || result.shortLines.length === 0}>
                      {aiBusy ? "Drafting…" : aiPlan ? "Redraft plan" : "Draft action plan"}
                    </button>
                  </div>

                  {result.shortLines.length === 0 && (
                    <div className="crc-empty crc-empty-sm">
                      <p>No shortages to plan around. Release the order.</p>
                    </div>
                  )}

                  {aiError && <div className="crc-error">{aiError}</div>}

                  {aiPlan && (
                    <div className="crc-plan">
                      <p className="crc-plan-headline">{aiPlan.headline}</p>
                      {aiPlan.criticalPath && (
                        <div className="crc-critical">
                          <span>Critical path</span>
                          <p>{aiPlan.criticalPath}</p>
                        </div>
                      )}
                      <div className="crc-tablewrap">
                        <table className="crc-table crc-plantable">
                          <thead>
                            <tr>
                              <th className="crc-num">#</th>
                              <th>Action</th>
                              <th>Material</th>
                              <th className="crc-num">Quantity</th>
                              <th>Owner</th>
                              <th>Due by</th>
                              <th>If it slips</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(aiPlan.actions || []).map((a, i) => (
                              <tr key={i}>
                                <td className="crc-num crc-dim">{a.seq ?? i + 1}</td>
                                <td className="crc-strong">{a.action}</td>
                                <td className="crc-mono">{a.material}</td>
                                <td className="crc-num crc-mono">{a.qty}</td>
                                <td>{a.owner}</td>
                                <td className="crc-mono">{a.dueBy}</td>
                                <td className="crc-dim">{a.impact}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {aiPlan.watchOuts && aiPlan.watchOuts.length > 0 && (
                        <div className="crc-watch">
                          <div className="crc-watch-title">Watch outs</div>
                          <ul>{aiPlan.watchOuts.map((w, i) => <li key={i}>{w}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      <ScrollTop />
    </div>
  );
}

/* ============================================================
   STYLES
   ============================================================ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.crc-root{
  --paper:#E6EBF0; --panel:#FFFFFF; --panel-2:#F7F9FB;
  --ink:#14212A; --ink2:#4C606D; --ink3:#647887;
  --rule:#C2CDD6; --rule-soft:#E1E7EC;
  --go:#1B6E4C; --go-bg:#E0EDE6;
  --caution:#96600A; --caution-bg:#FAEBD3;
  --stop:#A32D1B; --stop-bg:#F7E0DB;
  --signal:#235A8C; --signal-bg:#E1EAF3;
  --brass:#C0803A; --brass-bg:#F7EDDF;
  font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  color:var(--ink);
  /* engineering paper: a printed grid, barely there */
  background:
    linear-gradient(rgba(20,33,42,.030) 1px, transparent 1px) 0 0 / 100% 24px,
    linear-gradient(90deg, rgba(20,33,42,.030) 1px, transparent 1px) 0 0 / 24px 100%,
    var(--paper);
  min-height:100vh; font-size:13px; line-height:1.5;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
.crc-root *{box-sizing:border-box;}
.crc-root h3,.crc-root h4{margin:0;font-weight:600;}
.crc-root p{margin:0;}
.crc-mono,.crc-num{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;}
.crc-root button:focus-visible,.crc-root input:focus-visible,.crc-root select:focus-visible,
.crc-root a:focus-visible{outline:2px solid var(--brass); outline-offset:2px; border-radius:2px;}
@media(prefers-reduced-motion:reduce){.crc-root *{transition:none!important;animation:none!important;}}

/* ---- header: the state masthead is where the boldness goes ---- */
.crc-header{background:var(--ink);color:#E7EDF2;
  box-shadow:inset 0 -1px 0 rgba(255,255,255,.07), 0 1px 0 rgba(20,33,42,.18);}
.crc-header-in{max-width:1460px;margin:0 auto;padding:16px 24px 14px;display:flex;
  align-items:center;justify-content:space-between;gap:28px;flex-wrap:wrap;}
.crc-brand{display:flex;align-items:center;gap:12px;flex:none;}
.crc-brand-mark{width:26px;height:26px;border:2px solid var(--brass);border-radius:2px;flex:none;
  background:
    linear-gradient(135deg,transparent 44%,var(--brass) 44%,var(--brass) 56%,transparent 56%),
    linear-gradient(45deg,transparent 44%,rgba(192,128,58,.4) 44%,rgba(192,128,58,.4) 56%,transparent 56%);}
.crc-brand-name{font-size:16px;font-weight:600;letter-spacing:-0.012em;line-height:1.2;}
.crc-brand-sub{font-size:11.5px;color:#8DA2B0;margin-top:2px;}

.crc-state{display:flex;align-items:center;gap:20px;flex:1 1 520px;min-width:0;
  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);
  border-left:4px solid var(--ink3);border-radius:3px;padding:10px 16px;}
.crc-state-release{border-left-color:var(--go);}
.crc-state-coverable{border-left-color:var(--caution);}
.crc-state-blocked{border-left-color:var(--stop);}
.crc-state-lamp{width:9px;height:9px;border-radius:50%;flex:none;background:var(--ink3);
  box-shadow:0 0 0 3px rgba(255,255,255,.07);}
.crc-state-release .crc-state-lamp{background:#3FA377;box-shadow:0 0 0 3px rgba(63,163,119,.22);}
.crc-state-coverable .crc-state-lamp{background:#D89A2E;box-shadow:0 0 0 3px rgba(216,154,46,.22);}
.crc-state-blocked .crc-state-lamp{background:#D9563E;box-shadow:0 0 0 3px rgba(217,86,62,.22);
  animation:crc-pulse 2.6s ease-in-out infinite;}
@keyframes crc-pulse{0%,100%{box-shadow:0 0 0 3px rgba(217,86,62,.22);}50%{box-shadow:0 0 0 6px rgba(217,86,62,.05);}}
.crc-state-body{min-width:0;flex:1 1 auto;}
.crc-state-word{font-size:19px;font-weight:600;letter-spacing:-0.015em;line-height:1.15;}
.crc-state-release .crc-state-word{color:#7FD1AC;}
.crc-state-coverable .crc-state-word{color:#F0BE6A;}
.crc-state-blocked .crc-state-word{color:#F09A85;}
.crc-state-line{font-size:12px;color:#A6B8C4;margin-top:2px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.crc-state-figs{display:flex;gap:22px;flex:none;}
.crc-state-v{display:block;font-family:'IBM Plex Mono',monospace;font-size:19px;font-weight:600;
  font-variant-numeric:tabular-nums;letter-spacing:-0.02em;color:#E7EDF2;line-height:1.15;}
.crc-state-v em{font-style:normal;font-size:13px;font-weight:400;color:#7F929F;}
.crc-state-k{display:block;font-size:10.5px;color:#8DA2B0;margin-top:2px;}

.crc-header-strip{max-width:1460px;margin:0 auto;padding:0 24px 11px;display:flex;gap:20px;
  flex-wrap:wrap;font-size:11px;color:#8DA2B0;}
.crc-header-strip span{position:relative;}
.crc-header-strip span+span::before{content:"";position:absolute;left:-10px;top:4px;bottom:2px;
  width:1px;background:rgba(255,255,255,.13);}
.crc-header-date{margin-left:auto;font-family:'IBM Plex Mono',monospace;}
@media(max-width:900px){.crc-header-date{margin-left:0;}}

/* ---- shell ---- */
.crc-shell{max-width:1460px;margin:0 auto;padding:20px 24px 64px;
  display:grid;grid-template-columns:308px minmax(0,1fr);gap:20px;align-items:start;}
@media(max-width:1000px){.crc-shell{grid-template-columns:1fr;padding:16px;}}

/* ---- controls ---- */
.crc-controls{display:flex;flex-direction:column;gap:16px;position:sticky;top:16px;}
@media(max-width:1000px){.crc-controls{position:static;}}
.crc-section{background:var(--panel);border:1px solid var(--rule);border-radius:3px;padding:15px;
  box-shadow:0 1px 2px rgba(20,33,42,.05);}
.crc-section-head{border-bottom:1px solid var(--rule);padding-bottom:8px;margin-bottom:12px;}
.crc-section-head h3{font-size:13.5px;letter-spacing:-0.008em;}
.crc-section-hint{display:block;margin-top:4px;font-size:12px;color:var(--ink2);line-height:1.45;}
.crc-field{display:block;margin-bottom:10px;}
.crc-field:last-child{margin-bottom:0;}
.crc-field>span{display:block;font-size:12px;color:var(--ink2);margin-bottom:4px;}
.crc-field input,.crc-field select{
  width:100%;padding:7px 8px;border:1px solid var(--rule);border-radius:2px;background:#fff;
  font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--ink);}
.crc-field select{font-family:'IBM Plex Sans',sans-serif;}
.crc-field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;}

.crc-slocs{display:flex;flex-direction:column;gap:2px;}
.crc-sloc{padding:8px;border:1px solid var(--rule-soft);border-radius:2px;background:#fff;}
.crc-sloc-off{background:#F5F7F9;border-style:dashed;}
.crc-sloc-off .crc-sloc-name,.crc-sloc-off .crc-sloc-code{color:var(--ink3);}
.crc-sloc-main{display:flex;align-items:center;gap:8px;cursor:pointer;}
.crc-sloc-main input{accent-color:var(--signal);width:15px;height:15px;flex:none;}
.crc-sloc-code{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;}
.crc-sloc-name{font-size:13px;}
.crc-sloc-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:5px;padding-left:23px;}
.crc-stocktype{font-size:11px;padding:1px 5px;border-radius:2px;}
.crc-st-free{background:var(--go-bg);color:var(--go);}
.crc-st-held{background:var(--caution-bg);color:var(--caution);}
.crc-sloc-qty{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink3);}

.crc-rule{margin-bottom:14px;}
.crc-rule-title{font-size:13px;font-weight:600;}
.crc-rule-help{font-size:12px;color:var(--ink2);margin-top:2px;line-height:1.45;}
.crc-seg{display:flex;margin-top:8px;border:1px solid var(--rule);border-radius:2px;overflow:hidden;}
.crc-seg-btn{flex:1;background:#fff;border:0;border-right:1px solid var(--rule);padding:6px 4px;
  font-family:inherit;font-size:11.5px;color:var(--ink2);cursor:pointer;line-height:1.3;}
.crc-seg-btn:last-child{border-right:0;}
.crc-seg-btn:hover{background:#F4F7F9;}
.crc-seg-on{background:var(--ink);color:#fff;font-weight:500;}
.crc-seg-on:hover{background:var(--ink);}
.crc-rule-echo{margin-top:6px;font-size:11.5px;color:var(--ink3);line-height:1.45;}

.crc-subhead{padding:14px 16px 8px;font-size:12px;font-weight:600;
  border-bottom:1px solid var(--rule-soft);}
.crc-tr-muted td{opacity:.5;}
.crc-resv{color:var(--caution);}
.crc-inbound{color:var(--signal);}
.crc-tag-neutral{background:#EFF1F3;color:var(--ink2);}

/* ---- charts ---- */
.crc-svg{width:100%;height:auto;display:block;font-family:'IBM Plex Sans',sans-serif;}
.crc-svg-mono{font-family:'IBM Plex Mono',monospace;}
.crc-chart{padding:16px;border-bottom:1px solid var(--rule-soft);}
.crc-chart:last-child{border-bottom:0;}
.crc-chart-flat{padding:0;border:0;}
.crc-chart-head{margin-bottom:14px;}
.crc-chart-head h4{font-size:15px;letter-spacing:-0.012em;}
.crc-chart-head p{font-size:12.5px;color:var(--ink2);margin-top:3px;max-width:74ch;line-height:1.5;}
.crc-chart-read{margin-top:10px;font-size:12.5px;color:var(--ink2);
  border-left:3px solid var(--signal);padding-left:11px;max-width:74ch;}
.crc-key{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;font-size:11.5px;color:var(--ink2);}
.crc-key span{display:flex;align-items:center;gap:6px;}
.crc-key i{width:11px;height:9px;border-radius:1px;display:block;}

.crc-cbar{width:76px;height:7px;background:#E7ECEF;border-radius:1px;overflow:hidden;}
.crc-cbar-fill{height:100%;border-radius:1px;}
.crc-th-cov{width:88px;}

.crc-strip{margin-top:14px;}
.crc-strip-bar{display:flex;height:7px;border-radius:1px;overflow:hidden;background:#E7ECEF;}
.crc-strip-seg{height:100%;}
.crc-strip-key{display:flex;flex-wrap:wrap;gap:14px;margin-top:7px;font-size:11.5px;color:var(--ink2);}
.crc-strip-key span{display:flex;align-items:center;gap:5px;}
.crc-strip-key i{width:9px;height:9px;border-radius:1px;display:block;}

.crc-sfbars{display:flex;flex-direction:column;gap:7px;}
.crc-sfrow{display:grid;grid-template-columns:132px minmax(0,1fr) 42px 122px;gap:11px;align-items:center;}
.crc-sf-code{font-family:'IBM Plex Mono',monospace;font-size:12px;}
.crc-sf-track{height:11px;background:#E7ECEF;border-radius:1px;overflow:hidden;}
.crc-sf-fill{height:100%;}
.crc-sf-pct{font-family:'IBM Plex Mono',monospace;font-size:12px;text-align:right;font-variant-numeric:tabular-nums;}
.crc-sf-qty{font-size:11.5px;color:var(--ink3);}
@media(max-width:700px){
  .crc-sfrow{grid-template-columns:1fr 46px;gap:6px;}
  .crc-sf-track{grid-column:1/-1;} .crc-sf-qty{grid-column:1/-1;}
}

/* ---- BOM structure view ---- */
.crc-treewrap{padding:16px;}
.crc-tree{list-style:none;margin:0;padding:0;}
.crc-tree-sub{margin-left:15px;padding-left:15px;border-left:1px solid var(--rule);}
.crc-tnode{position:relative;margin-top:5px;}
.crc-tree-sub>.crc-tnode::before{content:"";position:absolute;left:-15px;top:17px;
  width:11px;height:1px;background:var(--rule);}
.crc-tcard{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;
  border:1px solid var(--rule-soft);border-left-width:3px;border-radius:2px;padding:9px 12px;background:#fff;}
.crc-t-ok{border-left-color:var(--go);}
.crc-t-coverable{border-left-color:var(--caution);}
.crc-t-late{border-left-color:var(--stop);}
.crc-t-assembly{border-left-color:var(--signal);background:#FBFCFD;}
.crc-tcard-id{display:flex;flex-direction:column;gap:1px;min-width:200px;}
.crc-tcard-figs{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.crc-tqty{font-family:'IBM Plex Mono',monospace;font-size:12px;font-variant-numeric:tabular-nums;}
.crc-tshort{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--stop);font-weight:600;}

.crc-head-right{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.crc-seg-sm .crc-seg-btn{padding:4px 11px;font-size:11.5px;}
.crc-seg-sm{border:1px solid var(--rule);border-radius:2px;overflow:hidden;display:flex;}

/* ---- print ---- */
@media print{
  .crc-root{background:#fff;}
  .crc-header{background:#fff;color:var(--ink);border-bottom:2px solid var(--ink);box-shadow:none;}
  .crc-brand-name,.crc-brand-sub,.crc-state-word,.crc-state-v,.crc-state-k,
  .crc-state-line,.crc-header-strip{color:var(--ink)!important;}
  .crc-state{background:none;border-color:var(--rule);}
  .crc-root{background:#fff!important;}
  .crc-panel,.crc-programme,.crc-section{box-shadow:none;}
  .crc-shell{display:block;padding:0;max-width:none;}
  .crc-controls,.crc-tabs,.crc-btn,.crc-rail,.crc-sumbtn,.crc-report-actions{display:none!important;}
  .crc-report{border-top-width:3px;}
  .crc-issue{break-inside:avoid;}
  .crc-sumgrid{grid-template-columns:repeat(4,1fr);}
  .crc-panel,.crc-verdict,.crc-section{border-color:#999;break-inside:avoid;}
  .crc-table tbody tr{break-inside:avoid;}
  .crc-tablewrap{overflow:visible;}
}

.crc-postats{display:grid;grid-template-columns:repeat(5,1fr);border-bottom:1px solid var(--rule);
  background:var(--panel-2);}
@media(max-width:820px){.crc-postats{grid-template-columns:repeat(2,1fr);}}
.crc-postat{padding:13px 15px;border-right:1px solid var(--rule-soft);}
.crc-postat:last-child{border-right:0;}
.crc-postat-v{font-family:'IBM Plex Mono',monospace;font-size:22px;font-weight:600;
  font-variant-numeric:tabular-nums;letter-spacing:-0.025em;line-height:1.05;color:var(--ink);}
.crc-postat-k{font-size:11.5px;color:var(--ink2);margin-top:3px;line-height:1.35;}
.crc-mode{display:inline-block;font-size:11px;font-weight:500;padding:1px 6px;border-radius:2px;}
.crc-mode-mrp{background:var(--signal-bg);color:var(--signal);}
.crc-mode-man{background:var(--caution-bg);color:var(--caution);}
.crc-item{color:var(--ink3);font-weight:400;}
.crc-report{background:var(--panel);border:1px solid var(--rule);border-top:4px solid var(--ink);border-radius:3px;}
.crc-report-head{padding:16px;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;
  border-bottom:1px solid var(--rule-soft);}
.crc-report-t{font-size:20px;font-weight:600;letter-spacing:-0.02em;}
.crc-report-s{font-size:12px;color:var(--ink2);margin-top:3px;}
.crc-report-actions{display:flex;gap:8px;align-items:flex-start;}
.crc-report-lines th{background:#F7F9FA;}
.crc-sevkey{padding:11px 16px;border-bottom:1px solid var(--rule-soft);display:flex;
  flex-direction:column;gap:5px;font-size:12px;color:var(--ink2);}
.crc-sevkey span{display:flex;align-items:baseline;gap:8px;}
.crc-sevkey b{font-weight:600;color:var(--ink);}
.crc-sevkey i{width:10px;height:10px;border-radius:2px;display:block;flex:none;position:relative;top:1px;}
.crc-sev-stop{background:var(--stop);} .crc-sev-caution{background:var(--caution);} .crc-sev-signal{background:var(--rule);}
.crc-issue-n{color:var(--ink3);font-family:'IBM Plex Mono',monospace;font-size:12px;}
.crc-th-count{width:62px;text-align:center;}
.crc-mark{display:flex;justify-content:center;cursor:pointer;}
.crc-mark input{accent-color:var(--signal);width:15px;height:15px;}
.crc-conspick{padding:14px 16px;border-bottom:1px solid var(--rule-soft);display:flex;
  gap:28px;align-items:flex-end;flex-wrap:wrap;}
.crc-field-inline{margin-bottom:0;min-width:250px;}
.crc-chips-row{padding:11px 16px;border-bottom:1px solid var(--rule-soft);}
.crc-sparkgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:1px;
  background:var(--rule-soft);border-bottom:1px solid var(--rule-soft);}
.crc-spark{background:#fff;border:0;border-left:3px solid transparent;padding:11px 13px;
  font-family:inherit;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:6px;}
.crc-spark:hover{background:#F7F9FA;}
.crc-spark-on{border-left-color:var(--brass);background:var(--brass-bg);}
.crc-spark-on:hover{background:var(--brass-bg);}
.crc-spark-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.crc-sparksvg{width:100%;height:auto;display:block;}
.crc-spark-foot{display:flex;flex-direction:column;gap:1px;font-size:11px;color:var(--ink2);}
.crc-consadd{padding:12px 16px;border-bottom:1px solid var(--rule-soft);display:flex;
  gap:24px;align-items:flex-start;flex-wrap:wrap;}
.crc-consadd-in{display:flex;align-items:center;gap:10px;}
.crc-consadd-l{font-size:11.5px;color:var(--ink3);white-space:nowrap;}
.crc-chips{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
.crc-chip{display:flex;align-items:baseline;gap:6px;background:var(--signal-bg);color:var(--signal);
  border-radius:2px;padding:3px 6px 3px 8px;font-size:12px;}
.crc-chip .crc-mono{font-size:12px;}
.crc-chip button{background:none;border:0;color:var(--signal);cursor:pointer;font-size:14px;
  line-height:1;padding:0 2px;}
.crc-chip button:hover{color:var(--stop);}
.crc-main{min-width:0;}
.crc-issue-body,.crc-step-body,.crc-short-id{min-width:0;}
.crc-head-sub{display:block;font-size:12px;font-weight:400;color:var(--ink2);margin-top:2px;
  letter-spacing:0;}
/* the location matrix is the widest grid here, so its material column stays put */
.crc-matrix .crc-th-mat{position:sticky;left:0;z-index:3;background:var(--panel);
  box-shadow:1px 0 0 var(--rule-soft);}
.crc-matrix thead .crc-th-mat{z-index:5;background:var(--panel-2);}
.crc-matrix tbody tr:hover .crc-th-mat{background:var(--panel-2);}
.crc-jump{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:rgba(255,255,255,.92);
  backdrop-filter:blur(6px);border:1px solid var(--rule);border-radius:3px;padding:8px 12px;
  margin-bottom:16px;position:sticky;top:8px;z-index:20;box-shadow:0 1px 3px rgba(20,33,42,.07);}
.crc-jump-l{font-size:11px;color:var(--ink3);margin-right:4px;}
.crc-jumpbtn{background:#F4F7F9;border:1px solid var(--rule-soft);border-radius:2px;padding:4px 10px;
  font-family:inherit;font-size:12px;color:var(--ink2);cursor:pointer;display:flex;align-items:center;gap:6px;}
.crc-jumpbtn:hover{background:var(--brass-bg);color:#7A4E12;border-color:var(--brass);}
.crc-jumpcount{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ink3);}
.crc-totop{position:fixed;right:22px;bottom:22px;z-index:40;background:var(--ink);color:#fff;
  border:0;border-radius:3px;padding:9px 13px;font-family:inherit;font-size:12px;cursor:pointer;
  display:flex;align-items:center;gap:7px;box-shadow:0 3px 12px rgba(27,42,51,.28);}
.crc-totop:hover{background:#0F1A22;}
@media print{.crc-jump,.crc-totop{display:none!important;}}
.crc-sumbtn{background:var(--brass);color:#1A1206;border:1px solid var(--brass);border-radius:2px;
  padding:8px 14px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;
  display:flex;align-items:center;gap:8px;flex:none;transition:filter .12s ease;}
.crc-sumbtn:hover{filter:brightness(1.08);}
.crc-sumbtn-alert{box-shadow:0 0 0 3px rgba(192,128,58,.22);}
.crc-sumbadge{background:#7A1E10;color:#fff;border-radius:2px;padding:1px 6px;
  font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;}
.crc-sumgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));}
.crc-sumstat{text-align:left;background:#fff;border:0;border-right:1px solid var(--rule-soft);
  border-bottom:1px solid var(--rule-soft);padding:14px 16px;font-family:inherit;cursor:pointer;}
.crc-sumstat:hover{background:var(--brass-bg);}
.crc-sumstat-v{font-family:'IBM Plex Mono',monospace;font-size:23px;font-weight:600;
  font-variant-numeric:tabular-nums;letter-spacing:-0.025em;color:var(--ink);line-height:1.1;}
.crc-sumstat-k{font-size:12px;color:var(--ink2);margin-top:4px;}
.crc-sumstat-s{font-size:11px;color:var(--ink3);margin-top:2px;}
.crc-issues{list-style:none;margin:0;padding:0;}
.crc-issue{display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:16px;align-items:start;
  padding:12px 16px;border-bottom:1px solid var(--rule-soft);border-left:4px solid transparent;}
.crc-issue:last-child{border-bottom:0;}
.crc-issue-critical{border-left-color:var(--stop);background:#FDF8F7;}
.crc-issue-warning{border-left-color:var(--caution);}
.crc-issue-watch{border-left-color:var(--rule);}
.crc-issue-tag{display:flex;flex-direction:column;gap:4px;align-items:flex-start;}
.crc-issue-area{font-size:11px;color:var(--ink3);}
.crc-issue-head{font-size:13px;font-weight:600;}
.crc-issue-detail{font-size:12.5px;color:var(--ink2);margin-top:3px;line-height:1.5;max-width:88ch;}
@media(max-width:720px){.crc-issue{grid-template-columns:1fr;gap:7px;}}
.crc-brief-sit{font-size:13.5px;color:var(--ink2);line-height:1.6;margin-top:9px;max-width:80ch;}
.crc-briefblock{margin-top:16px;}
.crc-subhead-flat{padding:0 0 7px;border-bottom:1px solid var(--rule-soft);}
.crc-flaglist{list-style:none;margin:0;padding:0 16px 14px;display:flex;flex-direction:column;gap:7px;}
.crc-flag{font-size:12.5px;line-height:1.5;padding:9px 11px;border-left:3px solid var(--rule);
  background:#FBFCFD;max-width:96ch;}
.crc-flag-stop{border-left-color:var(--stop);background:#FDF6F4;color:#8C2717;}
.crc-flag-caution{border-left-color:var(--caution);background:#FFFCF6;color:#7A4D04;}
.crc-flag-signal{border-left-color:var(--signal);background:var(--signal-bg);color:#26527D;}
.crc-prog-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.crc-addso{border:1px solid var(--rule);border-radius:2px;background:#fff;padding:8px 10px;
  font-family:inherit;font-size:12.5px;color:var(--ink);max-width:290px;}
.crc-inline-so{max-width:190px;font-family:'IBM Plex Mono',monospace;font-size:12px;}
.crc-actionline{font-size:11.5px;color:var(--ink2);margin-top:4px;max-width:46ch;line-height:1.45;}
.crc-ctx-scope{display:flex;align-items:center;}
.crc-donutwrap{display:flex;gap:32px;align-items:center;flex-wrap:wrap;}
.crc-donut{width:190px;height:190px;flex:none;}
.crc-donutkey{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;min-width:280px;}
.crc-donutkey li{display:grid;grid-template-columns:11px 1fr auto auto;gap:10px;align-items:baseline;
  font-size:12.5px;padding-bottom:6px;border-bottom:1px solid var(--rule-soft);}
.crc-donutkey li:last-child{border-bottom:0;}
.crc-donutkey i{width:11px;height:11px;border-radius:2px;display:block;}
.crc-donutkey-l{color:var(--ink2);}
.crc-donutkey-v{font-family:'IBM Plex Mono',monospace;font-weight:600;font-variant-numeric:tabular-nums;}
.crc-donutkey-p{font-family:'IBM Plex Mono',monospace;color:var(--ink3);font-size:11.5px;width:34px;text-align:right;}

/* ---- screen rail ---- */
.crc-shell{grid-template-columns:216px minmax(0,1fr);}
.crc-rail{background:var(--ink);border-radius:3px;padding:8px 0 4px;position:sticky;top:16px;
  align-self:start;overflow:hidden;box-shadow:0 1px 3px rgba(20,33,42,.16);}
@media(max-width:1000px){.crc-rail{position:static;}}
.crc-railgroup{padding-bottom:8px;}
.crc-railgroup-t{padding:10px 14px 5px;font-size:10px;color:#6E8494;letter-spacing:.06em;
  text-transform:none;font-weight:500;}
.crc-railbtn{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;
  padding:7px 14px;background:none;border:0;border-left:3px solid transparent;
  font-family:inherit;font-size:12.5px;color:#AFC0CD;cursor:pointer;text-align:left;
  transition:color .12s ease,background .12s ease;}
.crc-railbtn:hover{color:#fff;background:rgba(255,255,255,.05);}
.crc-railbtn-on{color:#fff;background:rgba(192,128,58,.13);border-left-color:var(--brass);font-weight:500;}
.crc-railcount{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#8FA5B3;
  background:rgba(0,0,0,.28);padding:1px 5px;border-radius:2px;min-width:18px;text-align:center;}
.crc-railbtn-on .crc-railcount{background:var(--brass);color:#121D25;font-weight:600;}
.crc-railfoot{padding:11px 14px;margin-top:4px;border-top:1px solid rgba(255,255,255,.09);
  font-size:10.5px;color:#6E8494;line-height:1.5;}

/* ---- context strip ---- */
.crc-ctx{background:var(--panel);border:1px solid var(--rule);border-left-width:5px;border-radius:3px;
  margin-bottom:16px;padding:9px 14px;display:flex;justify-content:space-between;
  align-items:center;gap:18px;flex-wrap:wrap;}
.crc-ctx-go{border-left-color:var(--go);} .crc-ctx-caution{border-left-color:var(--caution);}
.crc-ctx-stop{border-left-color:var(--stop);}
.crc-ctx-lines{display:flex;gap:5px;flex-wrap:wrap;}
.crc-ctxbtn{background:#fff;border:1px solid var(--rule);border-radius:2px;padding:4px 9px;
  font-family:inherit;font-size:12px;color:var(--ink2);cursor:pointer;display:flex;align-items:baseline;gap:6px;}
.crc-ctxbtn:hover{background:#F4F7F9;}
.crc-ctxbtn-on{background:var(--ink);color:#fff;border-color:var(--ink);box-shadow:inset 0 -2px 0 var(--brass);}
.crc-ctxbtn-q{font-family:'IBM Plex Mono',monospace;font-size:10.5px;opacity:.7;}
.crc-ctx-verdict{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;}
.crc-ctx-word{font-size:13px;font-weight:600;}
.crc-ctx-sub{font-size:11.5px;color:var(--ink3);font-family:'IBM Plex Mono',monospace;}

.crc-runcols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;align-items:start;}
.crc-panel-top{margin-top:16px;}

/* ---- material combobox ---- */
.crc-combo{position:relative;}
.crc-combo-in{width:100%;max-width:230px;font-family:'IBM Plex Mono',monospace;font-size:12.5px;
  text-transform:uppercase;padding-right:20px;}
.crc-combo-bad{border-color:var(--stop)!important;background:#FFF8F6;}
.crc-combo-warn{border-color:var(--caution)!important;background:#FFFCF6;}
.crc-combo-toggle{position:absolute;right:2px;top:3px;width:17px;height:19px;border:0;background:none;
  color:var(--ink3);font-size:10px;cursor:pointer;padding:0;line-height:1;}
.crc-combo-list{position:absolute;z-index:20;top:100%;left:0;min-width:330px;margin:2px 0 0;padding:3px;
  list-style:none;background:#fff;border:1px solid var(--rule);border-radius:2px;
  box-shadow:0 4px 14px rgba(27,42,51,.14);max-height:250px;overflow:auto;}
.crc-combo-list button{display:grid;grid-template-columns:130px 1fr auto;gap:9px;align-items:baseline;
  width:100%;text-align:left;background:none;border:0;padding:5px 7px;font-family:inherit;
  font-size:12.5px;cursor:pointer;border-radius:2px;color:var(--ink);}
.crc-combo-list button:hover{background:var(--signal-bg);}
.crc-combo-desc{color:var(--ink2);font-size:12px;}
.crc-combo-kind{color:var(--ink3);font-size:10.5px;white-space:nowrap;}
.crc-combo-msg{font-weight:500;}
.crc-combo-msgbad{color:var(--stop);}
.crc-combo-msgwarn{color:var(--caution);}

/* ---- SAP mapping ---- */
.crc-sapintro{padding:14px 16px;border-bottom:1px solid var(--rule-soft);}
.crc-sapintro p{font-size:12.5px;color:var(--ink2);line-height:1.55;max-width:82ch;margin-bottom:8px;}
.crc-sapintro p:last-child{margin-bottom:0;}
.crc-sap{border-bottom:1px solid var(--rule);}
.crc-sap:last-of-type{border-bottom:0;}
.crc-sap-head{padding:13px 16px 9px;display:flex;justify-content:space-between;gap:22px;flex-wrap:wrap;}
.crc-sap-head h4{font-size:13px;}
.crc-sap-target{font-size:11.5px;color:var(--ink3);margin-top:2px;}
.crc-sap-meta{display:flex;gap:22px;flex-wrap:wrap;}
.crc-sap-meta dt{font-size:10.5px;color:var(--ink3);}
.crc-sap-meta dd{margin:1px 0 0;font-size:11.5px;max-width:40ch;}
.crc-sap-tables{display:flex;flex-wrap:wrap;gap:7px;padding:0 16px 11px;}
.crc-sap-table{display:flex;flex-direction:column;gap:1px;border:1px solid var(--rule-soft);
  border-left:3px solid var(--signal);border-radius:2px;padding:5px 9px;background:#FBFCFD;}
.crc-sap-table .crc-mono{font-size:12px;font-weight:600;}
.crc-sap-tt{font-size:11px;color:var(--ink2);}
.crc-sap-key{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ink3);}
.crc-saptable th{background:#F7F9FA;}
.crc-saptable td,.crc-saptable th{padding:6px 16px;}
.crc-sap-fld{color:var(--signal);}
.crc-sap-note{margin:0 16px 13px;padding:9px 11px;background:var(--signal-bg);
  border-left:3px solid var(--signal);font-size:12.5px;color:#26527D;line-height:1.5;max-width:88ch;}

/* ---- production version ---- */
.crc-pv{border-bottom:1px solid var(--rule);background:#FBFCFD;}
.crc-pv-active{padding:14px 16px;display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;}
.crc-pv-lead{min-width:250px;}
.crc-pv-title{display:flex;align-items:center;gap:9px;flex-wrap:wrap;}
.crc-pv-text{font-size:13px;font-weight:600;}
.crc-pv-reason{font-size:12.5px;color:var(--ink2);margin-top:4px;max-width:62ch;}
.crc-pv-facts{display:flex;gap:22px;flex-wrap:wrap;margin:0;}
.crc-pv-facts dt{font-size:11px;color:var(--ink3);}
.crc-pv-facts dd{margin:2px 0 0;font-family:'IBM Plex Mono',monospace;font-size:12px;
  font-variant-numeric:tabular-nums;}
.crc-pv-warn{margin:0 16px 12px;padding:9px 11px;background:var(--caution-bg);
  border-left:3px solid var(--caution);font-size:12.5px;color:#7A4D04;line-height:1.5;}
.crc-pvtable{border-top:1px solid var(--rule-soft);}
.crc-pvtable th{background:#F7F9FA;}
.crc-pvtable td,.crc-pvtable th{padding:7px 16px;}
.crc-pv-on{background:var(--signal-bg);}
.crc-pv-foot{padding:10px 16px;font-size:12px;color:var(--ink3);border-top:1px solid var(--rule-soft);}
.crc-pvwarn{color:var(--caution);font-weight:700;}
.crc-minibtn{background:var(--ink);color:#fff;border:0;border-radius:2px;padding:3px 10px;
  font-family:inherit;font-size:11.5px;cursor:pointer;}
.crc-minibtn:hover{background:#0F1A22;}
.crc-linkbtn{background:none;border:0;padding:0;font-family:inherit;font-size:12px;
  color:var(--signal);text-decoration:underline;cursor:pointer;}

/* ---- planning programme ---- */
.crc-programme{background:var(--panel);border:1px solid var(--rule);border-radius:3px;margin-bottom:16px;
  box-shadow:0 1px 2px rgba(20,33,42,.05);}
.crc-prog-head{padding:14px 16px;display:flex;justify-content:space-between;align-items:flex-start;
  gap:18px;border-bottom:1px solid var(--rule-soft);flex-wrap:wrap;}
.crc-prog-head h3{font-size:15px;letter-spacing:-0.012em;}
.crc-prog-head p{font-size:12.5px;color:var(--ink2);margin-top:3px;max-width:70ch;line-height:1.5;}
.crc-btn-light{background:#fff;color:var(--ink);border:1px solid var(--rule);}
.crc-btn-light:hover:not(:disabled){background:#F4F7F9;}
.crc-progtable tbody tr{cursor:pointer;}
.crc-progtable tbody tr.crc-prog-on{background:var(--brass-bg);box-shadow:inset 3px 0 0 var(--brass);}
.crc-progtable tbody tr.crc-prog-on:hover{background:#F3E5D2;}
.crc-progtable td{vertical-align:middle;}
.crc-inline{border:1px solid transparent;border-radius:2px;background:transparent;padding:4px 5px;
  font-family:'IBM Plex Sans',sans-serif;font-size:12.5px;color:var(--ink);max-width:250px;width:100%;}
.crc-inline:hover{border-color:var(--rule);background:#fff;}
.crc-inline:focus{border-color:var(--signal);background:#fff;}
.crc-inline-sm{max-width:132px;font-family:'IBM Plex Mono',monospace;font-size:12px;}
.crc-inline-num{max-width:76px;text-align:right;font-family:'IBM Plex Mono',monospace;
  font-variant-numeric:tabular-nums;font-size:12.5px;}
.crc-th-act{width:96px;}
.crc-acts{display:flex;gap:3px;justify-content:flex-end;}
.crc-iconbtn{width:22px;height:22px;border:1px solid var(--rule);background:#fff;border-radius:2px;
  font-family:inherit;font-size:12px;line-height:1;color:var(--ink2);cursor:pointer;padding:0;}
.crc-iconbtn:hover:not(:disabled){background:#F0F3F5;color:var(--ink);}
.crc-iconbtn:disabled{opacity:.35;cursor:not-allowed;}
.crc-iconbtn-del:hover:not(:disabled){background:var(--stop-bg);color:var(--stop);border-color:var(--stop);}
.crc-prog-note{padding:11px 16px;border-top:1px solid var(--rule-soft);font-size:12.5px;
  color:var(--ink2);line-height:1.5;}

/* ---- contention ---- */
.crc-contlist{display:flex;flex-direction:column;}
.crc-cont{padding:16px;border-bottom:1px solid var(--rule-soft);}
.crc-cont:last-child{border-bottom:0;}
.crc-cont-head{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:flex-start;}
.crc-cont-figs{display:flex;gap:22px;flex-wrap:wrap;}
.crc-cont-bar{display:flex;height:13px;border-radius:1px;overflow:hidden;background:#E7ECEF;margin:14px 0 12px;}
.crc-cont-seg{height:100%;}
.crc-cont-gap{background:repeating-linear-gradient(45deg,#F0D9D3,#F0D9D3 4px,#F8E9E5 4px,#F8E9E5 8px);}
.crc-conttable{width:100%;border-collapse:collapse;font-size:12.5px;}
.crc-conttable th{text-align:left;font-weight:600;font-size:11px;color:var(--ink2);
  padding:6px 9px;border-bottom:1px solid var(--rule-soft);white-space:nowrap;}
.crc-conttable td{padding:6px 9px;border-bottom:1px solid var(--rule-soft);}
.crc-conttable tbody tr:last-child td{border-bottom:0;}
.crc-seqdot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;vertical-align:middle;}
.crc-statuses{display:flex;flex-wrap:wrap;gap:3px;max-width:180px;}
.crc-status{font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:500;
  padding:1px 4px;border-radius:2px;border:1px solid transparent;}
.crc-status-go{background:var(--go-bg);color:var(--go);}
.crc-status-stop{background:var(--stop-bg);color:var(--stop);}
.crc-status-signal{background:var(--signal-bg);color:var(--signal);}
.crc-status-neutral{background:#EFF1F3;color:var(--ink2);}
.crc-mvt{font-family:'IBM Plex Sans',sans-serif;font-size:10px;font-weight:500;
  padding:0 4px;border-radius:2px;}
.crc-mvt-in{background:var(--go-bg);color:var(--go);}
.crc-mvt-out{background:var(--caution-bg);color:var(--caution);}
.crc-mvt-move{background:var(--signal-bg);color:var(--signal);}
.crc-mvt-plus{color:var(--go);}
.crc-mvt-minus{color:var(--caution);}
.crc-subhead-split{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;}
.crc-seg-4 .crc-seg-btn{padding:6px 2px;font-size:11px;}
.crc-vendorqty{color:#16706B;}

.crc-switch{display:flex;gap:9px;align-items:flex-start;cursor:pointer;}
.crc-switch input{accent-color:var(--signal);width:15px;height:15px;margin-top:2px;flex:none;}
.crc-switch strong{display:block;font-size:13px;font-weight:600;}
.crc-switch em{display:block;font-style:normal;font-size:12px;color:var(--ink2);margin-top:2px;line-height:1.45;}
.crc-note{margin-top:10px;padding:8px 9px;background:var(--signal-bg);border-left:3px solid var(--signal);
  font-size:12px;color:#26527D;line-height:1.45;}

/* ---- verdict ---- */
.crc-verdict{background:var(--panel);border:1px solid var(--rule);border-radius:3px;
  box-shadow:0 1px 2px rgba(20,33,42,.05);border-left-width:5px;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:0;overflow:hidden;}
@media(max-width:860px){.crc-verdict{grid-template-columns:1fr;}}
.crc-v-go{border-left-color:var(--go);} .crc-v-caution{border-left-color:var(--caution);} .crc-v-stop{border-left-color:var(--stop);}
.crc-verdict-lead{padding:20px 22px;}
.crc-verdict-word{font-size:34px;font-weight:600;letter-spacing:-0.028em;line-height:1.1;}
.crc-v-go .crc-verdict-word{color:var(--go);} .crc-v-caution .crc-verdict-word{color:var(--caution);} .crc-v-stop .crc-verdict-word{color:var(--stop);}
.crc-verdict-line{margin-top:7px;font-size:14px;color:var(--ink2);max-width:56ch;}
.crc-verdict-order{margin-top:12px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--ink3);}
.crc-metrics{display:grid;grid-template-columns:repeat(3,1fr);border-left:1px solid var(--rule);}
@media(max-width:860px){.crc-metrics{border-left:0;border-top:1px solid var(--rule);}}
.crc-metric{padding:18px 14px;border-right:1px solid var(--rule-soft);}
.crc-metric:last-child{border-right:0;}
.crc-metric-v{font-family:'IBM Plex Mono',monospace;font-size:30px;font-weight:600;
  font-variant-numeric:tabular-nums;letter-spacing:-0.03em;line-height:1.05;}
.crc-metric-of{font-size:16px;font-weight:400;color:var(--ink3);}
.crc-metric-k{font-size:12px;color:var(--ink2);margin-top:5px;}
.crc-metric-x{font-size:11px;color:var(--ink3);margin-top:2px;}

/* ---- panel ---- */
.crc-panel{background:var(--panel);border:1px solid var(--rule);border-radius:3px;
  box-shadow:0 1px 2px rgba(20,33,42,.05);}
.crc-panel-head{padding:12px 16px;border-bottom:1px solid var(--rule);background:var(--panel-2);
  font-size:12.5px;color:var(--ink2);display:flex;justify-content:space-between;
  gap:16px;flex-wrap:wrap;align-items:baseline;}
.crc-panel-flag{color:var(--caution);}
.crc-tablewrap{overflow-x:auto;}
.crc-table{width:100%;border-collapse:collapse;font-size:13px;}
.crc-table th{text-align:left;font-weight:600;font-size:10.5px;color:var(--ink3);letter-spacing:.01em;
  padding:9px 11px;border-bottom:1px solid var(--rule);white-space:nowrap;background:var(--panel-2);}
.crc-table td{padding:10px 11px;border-bottom:1px solid var(--rule-soft);vertical-align:top;}
.crc-table tbody tr:last-child td{border-bottom:0;}
.crc-table tbody tr{transition:background .12s ease;}
.crc-table tbody tr:hover{background:var(--panel-2);}
.crc-num{text-align:right;font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;white-space:nowrap;}
.crc-th-mat{text-align:left;min-width:230px;}
.crc-th-off{color:var(--ink3);}
.crc-th-sub{display:block;font-weight:400;font-size:10px;color:var(--ink3);margin-top:1px;}
.crc-tr-short{background:#FEFBF5;}
.crc-tr-short:hover{background:#FBF4E8;}
.crc-matcell{display:flex;gap:7px;align-items:flex-start;}
.crc-branch{width:9px;height:9px;border-left:1px solid var(--rule);border-bottom:1px solid var(--rule);
  margin-top:5px;flex:none;}
.crc-matcode{font-family:'IBM Plex Mono',monospace;font-size:12.5px;font-weight:600;letter-spacing:-.01em;
  display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.crc-matdesc{font-size:11.5px;color:var(--ink3);margin-top:2px;line-height:1.4;}
.crc-proc{font-family:'IBM Plex Sans',sans-serif;font-size:10px;font-weight:500;padding:0 4px;border-radius:2px;}
.crc-proc-E{background:var(--signal-bg);color:var(--signal);}
.crc-proc-F{background:#EFF1F3;color:var(--ink2);}
.crc-uom{font-size:11px;color:var(--ink3);}
.crc-strong{font-weight:600;}
.crc-dim{color:var(--ink3);}
.crc-num-short{color:var(--stop);font-weight:600;}
.crc-excl{color:var(--caution);}
.crc-date{color:var(--ink);font-family:'IBM Plex Mono',monospace;font-size:12.5px;}
.crc-date-late{color:var(--stop);font-weight:600;font-family:'IBM Plex Mono',monospace;font-size:12.5px;}
.crc-cell-off{background:#F5F7F9;color:var(--ink3);}
.crc-legend{padding:12px 16px;border-top:1px solid var(--rule-soft);background:var(--panel-2);
  font-size:11.5px;color:var(--ink3);line-height:1.55;max-width:96ch;
  border-radius:0 0 3px 3px;}

/* ---- tags ---- */
.crc-tag{display:inline-block;font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:2px;
  white-space:nowrap;letter-spacing:.005em;}
.crc-tag-go{background:var(--go-bg);color:var(--go);}
.crc-tag-caution{background:var(--caution-bg);color:var(--caution);}
.crc-tag-stop{background:var(--stop-bg);color:var(--stop);}
.crc-tag-signal{background:var(--signal-bg);color:var(--signal);}

/* ---- shortages ---- */
.crc-shortlist{display:flex;flex-direction:column;}
.crc-short{border-bottom:1px solid var(--rule-soft);}
.crc-short:last-child{border-bottom:0;}
.crc-short-head{width:100%;background:transparent;border:0;border-left:4px solid transparent;
  padding:13px 16px;display:flex;align-items:center;justify-content:space-between;gap:18px;
  cursor:pointer;text-align:left;font-family:inherit;flex-wrap:wrap;}
.crc-short-head:hover{background:#FAFBFC;}
.crc-short-coverable .crc-short-head{border-left-color:var(--caution);}
.crc-short-late .crc-short-head{border-left-color:var(--stop);}
.crc-short-figs{display:flex;align-items:center;gap:22px;flex-wrap:wrap;}
.crc-sf-v{display:block;font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:600;
  font-variant-numeric:tabular-nums;}
.crc-sf-k{display:block;font-size:11px;color:var(--ink3);margin-top:1px;}
.crc-chev{width:8px;height:8px;border-right:1.5px solid var(--ink2);border-bottom:1.5px solid var(--ink2);
  transform:rotate(45deg);transition:transform .15s ease;flex:none;}
.crc-chev-open{transform:rotate(-135deg);}
@media(prefers-reduced-motion:reduce){.crc-chev{transition:none;}}
.crc-short-body{padding:4px 16px 20px 20px;background:#FBFCFD;border-top:1px solid var(--rule-soft);}

.crc-timeline{padding:16px 0 6px;}
.crc-tl-track{position:relative;height:11px;background:#EFF2F4;border-radius:1px;margin:24px 0 6px;}
.crc-tl-seg{position:absolute;top:0;height:11px;border-radius:1px;}
.crc-tl-need{position:absolute;top:-18px;bottom:-6px;width:1.5px;background:var(--ink);}
.crc-tl-need-label{position:absolute;top:-14px;left:6px;font-size:10.5px;color:var(--ink);white-space:nowrap;}
.crc-tl-scale{display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink3);
  font-family:'IBM Plex Mono',monospace;}

.crc-steps{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:1px;}
.crc-step{display:flex;gap:11px;padding:11px 12px;background:#fff;border:1px solid var(--rule-soft);}
.crc-step-rank{width:20px;height:20px;border-radius:2px;background:var(--ink);color:#fff;
  font-family:'IBM Plex Mono',monospace;font-size:11px;display:flex;align-items:center;justify-content:center;flex:none;}
.crc-step-pr .crc-step-rank{background:var(--stop);}
.crc-step-expedite .crc-step-rank{background:var(--caution);}
.crc-step-transfer .crc-step-rank{background:var(--go);}
.crc-step-sto .crc-step-rank{background:var(--signal);}
.crc-step-label{font-size:13px;font-weight:600;}
.crc-step-detail{font-size:12.5px;color:var(--ink2);margin-top:2px;max-width:78ch;}
.crc-step-meta{display:flex;gap:16px;margin-top:6px;font-size:11px;color:var(--ink3);flex-wrap:wrap;}
.crc-cost-new{color:var(--stop);} .crc-cost-free{color:var(--go);}

.crc-exclbox{margin-top:14px;border:1px solid var(--caution);border-left-width:3px;background:#FFFCF6;padding:11px 12px;}
.crc-exclbox-title{font-size:12px;font-weight:600;color:var(--caution);margin-bottom:7px;}
.crc-exclrow{display:grid;grid-template-columns:56px 150px 90px minmax(0,1fr);gap:10px;
  font-size:12px;padding:4px 0;border-top:1px solid #F0E4CE;align-items:baseline;}
.crc-exclrow:first-of-type{border-top:0;}
.crc-exclnote{color:var(--ink2);}
@media(max-width:700px){.crc-exclrow{grid-template-columns:1fr;gap:2px;}}

/* ---- empty / error ---- */
.crc-empty{padding:48px 24px;text-align:center;color:var(--ink2);
  background:
    linear-gradient(rgba(20,33,42,.022) 1px, transparent 1px) 0 0 / 100% 20px,
    linear-gradient(90deg, rgba(20,33,42,.022) 1px, transparent 1px) 0 0 / 20px 100%;}
.crc-empty p{max-width:56ch;margin:0 auto;line-height:1.6;}
.crc-empty-sm{padding:20px;text-align:left;}
.crc-empty-title{font-size:16px;font-weight:600;color:var(--ink);margin-bottom:6px;letter-spacing:-0.012em;}
.crc-error{margin:12px 0 0;padding:10px 12px;background:var(--stop-bg);border-left:3px solid var(--stop);
  color:#8C2717;font-size:13px;}

/* ---- analysis ---- */
.crc-analysis{padding:18px 16px;display:flex;flex-direction:column;gap:18px;}
.crc-readout h4{font-size:13px;margin-bottom:8px;}
.crc-readout p{font-size:14px;color:var(--ink2);max-width:76ch;margin-bottom:9px;line-height:1.6;}
.crc-warnline{color:var(--caution)!important;border-left:3px solid var(--caution);padding-left:11px;}
.crc-aibox{border:1px solid var(--rule);border-radius:3px;}
.crc-aibox-head{padding:14px 16px;display:flex;justify-content:space-between;align-items:flex-start;
  gap:18px;border-bottom:1px solid var(--rule-soft);flex-wrap:wrap;}
.crc-aibox-head h4{font-size:13px;}
.crc-aibox-head p{font-size:12.5px;color:var(--ink2);margin-top:3px;max-width:60ch;}
.crc-btn{background:var(--ink);color:#fff;border:1px solid var(--ink);border-radius:2px;padding:8px 15px;
  font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;white-space:nowrap;
  transition:background .12s ease;}
.crc-btn:hover:not(:disabled){background:#0F1A22;}
.crc-btn:disabled{background:var(--rule);color:var(--ink3);cursor:not-allowed;}
.crc-plan{padding:16px;}
.crc-plan-headline{font-size:16px;font-weight:600;line-height:1.4;max-width:72ch;}
.crc-critical{margin:12px 0 16px;padding:11px 13px;background:var(--signal-bg);border-left:3px solid var(--signal);}
.crc-critical span{font-size:11px;font-weight:600;color:var(--signal);}
.crc-critical p{font-size:13px;color:#274F76;margin-top:3px;max-width:74ch;}
.crc-plantable{border:1px solid var(--rule-soft);}
.crc-watch{margin-top:16px;}
.crc-watch-title{font-size:12px;font-weight:600;margin-bottom:5px;}
.crc-watch ul{margin:0;padding-left:18px;font-size:13px;color:var(--ink2);}
.crc-watch li{margin-bottom:3px;max-width:76ch;}
`;
