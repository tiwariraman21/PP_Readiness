import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";

/* ============================================================
   MASTER DATA
   ============================================================ */

let PLANTS = [];

// Inter-plant transit days (picking + freight)
let TRANSIT = {};

let SLOCS = [];

// Indexes and lookups built from the tables above. They are rebuilt by
// rebuildDerived() once the workbook has been read, not at module load.
let SLOC_BY_CODE = {};

// procurement: F = bought out, E = made in-house
let MATERIALS = {};

// parent -> components. scrap = component scrap %
/* Bills of material, keyed by material then BOM alternative.
   A finished good with more than one alternative is reached through a production version. */
let BOMS = {};

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
  { group: "Readiness", items: [["components", "Components"], ["shortages", "Shortages"], ["contention", "Contention"]] },
  { group: "Reference", items: [["stock", "Stock"], ["consumption", "Consumption history"], ["prod", "Production orders"], ["orders", "Purchase orders"], ["subcon", "Subcontracting"]] },
  { group: "Support", items: [["summary", "Summary"]] },
];

/* Production versions. Each ties a BOM alternative to a routing, a line, a lot size
   range and a validity period. MRP picks the first version that is unlocked, valid on
   the date and covers the order quantity. */
let PROD_VERSIONS = {};

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

let FINISHED_GOODS = [];

// material / plant / storage location / qty
let STOCK = [];

/* System status codes as they appear on a production order */
let ORDER_STATUS = {};

/* Open production orders competing for the same components */
let PROD_ORDERS = [];

/* MRP plant data — MARC. Safety stock is what the projected stock line is measured against. */
let MRP_DATA = [];
const safetyOf = (m, p) => (MRP_DATA.find((r) => r.m === m && r.p === p) || {}).safety || 0;
const mrpDataOf = (m, p) => MRP_DATA.find((r) => r.m === m && r.p === p) || null;
const marginKeyOf = (m, p) => (mrpDataOf(m, p) || {}).marginKey || "001";

/* Sales order schedule lines — VBAP / VBEP. This is the demand the plant is judged on. */
let SALES_ORDERS = [];

/* Shipping points — TVST. Loading and pick/pack time sit between the plant and the truck. */
let SHIP_POINTS = [];

/* Scheduling margin keys — T436A, assigned on MARC-SFCPF. All values in working days. */
let SCHED_MARGIN = [];
const marginOf = (key) => SCHED_MARGIN.find((m) => m.key === key) || SCHED_MARGIN[0];

/* Planned independent requirements — PBIM / PBED. Forecast that real orders consume. */
let PIR = [];

/* Planned orders — PLAF. Not yet converted, and deleted by the next MRP run unless firmed. */
let PLANNED_ORDERS = [];

/* Work centres and available capacity — CRHD / KAKO. Hours per week after utilisation. */
let WORK_CENTRES = [];
const wcCapacity = (w) => Math.round(w.grossPerWeek * w.util);

/* Batch stock — MCHB with shelf life and status from MCHA. Only materials flagged
   batch managed appear here, and their batch quantities must add up to the storage
   location stock above or availability will disagree with MMBE. */
let BATCH_MANAGED = new Set();

let BATCHES = [];

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
let CONSUMPTION = [];

/* Outbound deliveries — LIKP / LIPS. Goods issue posted means it left the plant. */
let DELIVERIES = [];

let ORDER_BY_ID = {};
const isReleased = (id) => {
  const o = ORDER_BY_ID[id];
  return o ? o.status.includes("REL") : true;
};

/* Movement type catalogue */
let MVT_TYPES = {};

/* Posted component movements. offset is days from today. */
let GOODS_MVT = [];

/* Open reservations from earlier MRP runs and released orders.
   Open quantity = required − withdrawn, and nothing is open once final issue is set. */
let RESERVATIONS = [];

/* Subcontracting orders. The vendor returns "material"; the components under "provided"
   are our stock physically sitting at the vendor (special stock O) — owned but not issuable
   at the plant until recalled. */
let SUBCON = [];

/* Open purchase orders and stock transfer orders.
   openQty = ordered − received. "pegged" records quantities a previous MRP run already
   assigned to other dependent requirements — that quantity is not free for this order. */
let SUPPLY = [];

/* ============================================================
   THE EXCEL DATABASE

   Every table above starts empty. PP_Readiness_Database.xlsx, served
   alongside this page, is the source of truth: edit it in Excel, reload the
   page, and the dashboard follows. Nothing here hard codes the column
   layout. The workbook carries a _Schema sheet saying which sheet holds
   which dataset, which heading maps to which property, what type it is and
   how the rows are put back together, so a column can be renamed or moved
   in Excel without touching this file.

   Rebuild the workbook with tools\build-workbook.ps1.
   ============================================================ */

const WORKBOOK_FILE = "PP_Readiness_Database.xlsx";
const SHEETJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

let DATA_SOURCE = { file: WORKBOOK_FILE, sheets: 0, rows: 0, loadedAt: null };

/* The spreadsheet reader is a CDN global rather than an import, so that the
   single file standalone build keeps working without a bundler. */
function loadReader() {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window.XLSX) return resolve();
    const existing = document.querySelector('script[data-pp-reader="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("The spreadsheet reader could not be loaded from the CDN. This page needs network access on first load.")));
      return;
    }
    const tag = document.createElement("script");
    tag.src = SHEETJS_CDN;
    tag.async = true;
    tag.setAttribute("data-pp-reader", "1");
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error("The spreadsheet reader could not be loaded from the CDN. This page needs network access on first load."));
    document.head.appendChild(tag);
  });
}

/* Excel gives back whatever the cell happened to hold. Plant 1000 and version
   0001 have to stay strings, an empty number cell has to stay null so the
   "no expiry date" checks keep working, and a blank text cell reads as "". */
function coerceCell(value, type) {
  if (value === null || value === undefined || value === "") {
    return type === "n" ? null : type === "b" ? false : "";
  }
  if (type === "n") {
    const n = typeof value === "number" ? value : Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
  }
  if (type === "b") {
    if (typeof value === "boolean") return value;
    const s = String(value).trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "y";
  }
  return typeof value === "string" ? value : String(value);
}

function readSchema(wb) {
  const ws = wb.Sheets["_Schema"];
  if (!ws) throw new Error('The workbook has no "_Schema" sheet, so its layout cannot be read. Rebuild it with tools\\build-workbook.ps1.');
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  const bySheet = new Map();
  for (const r of rows) {
    const sheet = String(r.Sheet);
    if (!bySheet.has(sheet)) {
      bySheet.set(sheet, { sheet, dataset: String(r.Dataset), shape: String(r.Shape), cols: [] });
    }
    bySheet.get(sheet).cols.push({
      ordinal: Number(r.Ordinal),
      header: String(r.Header),
      key: String(r.Key),
      type: String(r.Type),
    });
  }
  const specs = Array.from(bySheet.values());
  for (const s of specs) s.cols.sort((a, b) => a.ordinal - b.ordinal);
  return specs;
}

function readTable(wb, spec) {
  const ws = wb.Sheets[spec.sheet];
  if (!ws) throw new Error(`The workbook has no "${spec.sheet}" sheet, but _Schema says it should.`);
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  const missing = spec.cols.filter((c) => raw.length && !(c.header in raw[0]));
  if (missing.length) {
    throw new Error(`Sheet "${spec.sheet}" is missing the column${missing.length > 1 ? "s" : ""} ${missing.map((c) => `"${c.header}"`).join(", ")}.`);
  }
  return raw.map((row) => {
    const out = {};
    for (const c of spec.cols) out[c.key] = coerceCell(row[c.header], c.type);
    return out;
  });
}

/* Flat rows back into the shapes the rest of the file expects */
function reshape(spec, rows) {
  const first = spec.cols[0].key;
  switch (spec.shape) {
    case "list":
      return rows.map((r) => r[first]);

    case "dict": {
      const out = {};
      for (const r of rows) {
        const value = {};
        for (const c of spec.cols) if (c.key !== first) value[c.key] = r[c.key];
        out[r[first]] = value;
      }
      return out;
    }

    case "transit": {
      const out = {};
      for (const r of rows) out[`${r.from}-${r.to}`] = r.days;
      return out;
    }

    case "bom": {
      const out = {};
      for (const r of rows) {
        if (!out[r.material]) out[r.material] = {};
        if (!out[r.material][r.alt]) out[r.material][r.alt] = [];
        out[r.material][r.alt].push({ code: r.code, qty: r.qty, scrap: r.scrap });
      }
      return out;
    }

    case "prodver": {
      const out = {};
      for (const r of rows) {
        const v = {};
        for (const c of spec.cols) if (c.key !== "material") v[c.key] = r[c.key];
        if (!out[r.material]) out[r.material] = [];
        out[r.material].push(v);
      }
      return out;
    }

    case "prodorders":
      return rows.map((r) => ({ ...r, status: r.status ? r.status.split(/\s+/).filter(Boolean) : [] }));

    case "consumption":
      return rows.map((r) => {
        const total = [];
        const unplanned = [];
        for (let i = 1; i <= 12; i++) {
          total.push(r["t" + i]);
          unplanned.push(r["u" + i]);
        }
        return { m: r.m, p: r.p, total, unplanned };
      });

    default:
      return rows;
  }
}

function assignDataset(name, value) {
  switch (name) {
    case "PLANTS": PLANTS = value; break;
    case "TRANSIT": TRANSIT = value; break;
    case "SLOCS": SLOCS = value; break;
    case "MATERIALS": MATERIALS = value; break;
    case "BOMS": BOMS = value; break;
    case "PROD_VERSIONS": PROD_VERSIONS = value; break;
    case "FINISHED_GOODS": FINISHED_GOODS = value; break;
    case "STOCK": STOCK = value; break;
    case "ORDER_STATUS": ORDER_STATUS = value; break;
    case "PROD_ORDERS": PROD_ORDERS = value; break;
    case "MRP_DATA": MRP_DATA = value; break;
    case "SALES_ORDERS": SALES_ORDERS = value; break;
    case "SHIP_POINTS": SHIP_POINTS = value; break;
    case "SCHED_MARGIN": SCHED_MARGIN = value; break;
    case "PIR": PIR = value; break;
    case "PLANNED_ORDERS": PLANNED_ORDERS = value; break;
    case "WORK_CENTRES": WORK_CENTRES = value; break;
    case "BATCHES": BATCHES = value; break;
    case "BATCH_MANAGED": BATCH_MANAGED = new Set(value); break;
    case "CONSUMPTION": CONSUMPTION = value; break;
    case "DELIVERIES": DELIVERIES = value; break;
    case "MVT_TYPES": MVT_TYPES = value; break;
    case "GOODS_MVT": GOODS_MVT = value; break;
    case "RESERVATIONS": RESERVATIONS = value; break;
    case "SUBCON": SUBCON = value; break;
    case "SUPPLY": SUPPLY = value; break;
    default: break;
  }
}

/* Pegging lines and subcontract components live on their own sheets, keyed
   back to the document and item of the order they belong to. */
function attachChildren(spec, rows) {
  const field = spec.shape.slice("child:".length);
  const parents = spec.dataset === "SUPPLY" ? SUPPLY : spec.dataset === "SUBCON" ? SUBCON : null;
  if (!parents) return;

  const index = new Map();
  for (const p of parents) {
    p[field] = [];
    index.set(`${p.doc}|${p.item}`, p);
  }
  for (const r of rows) {
    const parent = index.get(`${r.doc}|${r.item}`);
    if (!parent) continue;
    const child = {};
    for (const c of spec.cols) if (c.key !== "doc" && c.key !== "item") child[c.key] = r[c.key];
    parent[field].push(child);
  }
}

/* Indexes that used to be computed while the module loaded */
function rebuildDerived() {
  SLOC_BY_CODE = Object.fromEntries(SLOCS.map((s) => [s.code, s]));
  ORDER_BY_ID = Object.fromEntries(PROD_ORDERS.map((o) => [o.order, o]));
  MATERIAL_OPTIONS = Object.keys(BOMS)
    .map((code) => ({
      code,
      desc: matInfo(code).desc,
      kind: FINISHED_GOODS.some((f) => f.code === code) ? "finished good" : "sub-assembly",
    }))
    .sort((a, b) => (a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === "finished good" ? -1 : 1));
}

/* The offline single-file build has no workbook to fetch and no spreadsheet
   reader: the data is baked into the page as plain JSON, already in the shape
   the app uses. It is a snapshot taken at build time rather than a live file. */
function useEmbeddedData(raw) {
  let rows = 0;
  for (const name of Object.keys(raw)) {
    const v = raw[name];
    assignDataset(name, v);
    if (Array.isArray(v)) rows += v.length;
    else if (v && typeof v === "object") rows += Object.keys(v).length;
  }
  // the served workbook carries these on their own sheets; embedded they are nested
  for (const s of SUPPLY) if (!Array.isArray(s.pegged)) s.pegged = [];
  for (const s of SUBCON) if (!Array.isArray(s.provided)) s.provided = [];

  rebuildDerived();
  if (!FINISHED_GOODS.length || !Object.keys(BOMS).length) {
    throw new Error("The data built into this file has no finished goods or bills of material in it.");
  }
  DATA_SOURCE = { file: "built into this file", sheets: Object.keys(raw).length, rows, loadedAt: new Date() };
  return DATA_SOURCE;
}

async function readWorkbook() {
  if (typeof window !== "undefined" && window.__PPC_DATA__) {
    return useEmbeddedData(window.__PPC_DATA__);
  }

  await loadReader();

  const url = new URL(WORKBOOK_FILE, document.baseURI).href;
  let res;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (e) {
    throw new Error(`${WORKBOOK_FILE} could not be fetched. If you opened this file from disk, serve the folder over http instead — the browser blocks reading local files.`);
  }
  if (!res.ok) throw new Error(`${WORKBOOK_FILE} came back ${res.status} ${res.statusText}. It should sit next to this page.`);

  const wb = XLSX.read(await res.arrayBuffer(), { type: "array" });
  const specs = readSchema(wb);

  let rowCount = 0;
  const children = [];
  for (const spec of specs) {
    const rows = readTable(wb, spec);
    rowCount += rows.length;
    if (spec.shape.indexOf("child:") === 0) children.push({ spec, rows });
    else assignDataset(spec.dataset, reshape(spec, rows));
  }
  for (const c of children) attachChildren(c.spec, c.rows);

  rebuildDerived();

  if (!FINISHED_GOODS.length || !Object.keys(BOMS).length) {
    throw new Error("The workbook loaded but has no finished goods or bills of material in it.");
  }

  DATA_SOURCE = { file: WORKBOOK_FILE, sheets: specs.length, rows: rowCount, loadedAt: new Date() };
  return DATA_SOURCE;
}

let datasetPromise = null;
function loadDataset() {
  if (!datasetPromise) datasetPromise = readWorkbook();
  return datasetPromise;
}

/* ============================================================
   HELPERS
   ============================================================ */

const DAY = 86400000;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const diffDays = (a, b) => Math.round((a.getTime() - b.getTime()) / DAY);
/* Local date, not UTC. toISOString() converts first, so east of UTC every date
   handed to a <input type="date"> came back a day early — a run scheduled for
   the 10th displayed and re-parsed as the 9th. */
const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDate = (d) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const fmtDateLong = (d) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/* Manual entry means a code may not exist in the material master */
const matInfo = (code) =>
  MATERIALS[code] || { desc: "Not found in the material master", uom: "EA", lead: 0, proc: "F", mrp: "—", missing: true };

/* Anything with a bill of material can be planned, not just finished goods */
let MATERIAL_OPTIONS = [];

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
    { key: "shipped", label: "Already shipped", qty: r3(shipped), color: "var(--mark-1)" },
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
        code: c.code, plant: sc.plant, vendor: sc.vendor, vendorCode: sc.vendorCode,
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

const SEQ_COLOR = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)", "var(--seq-6)"];

const KIND_COLOR = {
  inbound: "var(--mark-1)",
  transfer: "var(--go)",
  sto: "var(--signal)",
  recall: "var(--teal-ink)",
  chase: "var(--mark-rust)",
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
            <rect x={LEFT} y={y + 2} width={plotW} height="11" rx="1" fill="var(--track)" />
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
    ["so", "var(--mark-1)"], ["pir", "var(--mark-2)"], ["dep", "var(--caution)"], ["runDep", "var(--mark-run)"],
  ];
  const sup = [
    ["planned", "var(--mark-green)"], ["prod", "var(--go)"], ["purch", "var(--mark-green2)"], ["subcon", "var(--teal-ink)"], ["run", "var(--mark-run)"],
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
              fill={r.past ? "var(--go)" : "var(--mark-green)"}>
              <title>{r.label} built {r.out}</title>
            </rect>
            <rect x={xb + w + 2} y={y(r.ship)} width={w} height={Math.max(y(0) - y(r.ship), 0)}
              fill={r.past ? "var(--mark-1)" : "var(--mark-3)"}>
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
              fill={r.current ? "var(--mark-2)" : "var(--signal)"}>
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
              fill={r.current ? "var(--mark-2)" : "var(--signal)"} />
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
  /* Side margins have to clear the widest label, and the labels at each end are
     anchored inwards rather than centred — a centred "Create order by" on the
     first step used to run off the left of the viewBox and get clipped. */
  const W = 780, H = 116, L = 78, R = 78, Y = 66;
  const pw = W - L - R;
  const x = (d) => L + ((d.getTime() - first) / span) * pw;
  const EDGE = 62;
  const anchorAt = (px) => (px < EDGE ? "start" : px > W - EDGE ? "end" : "middle");
  const labelX = (px) => (px < EDGE ? 2 : px > W - EDGE ? W - 2 : px);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-svg" role="img" aria-label="Backward schedule">
      <line x1={L} y1={Y} x2={W - R} y2={Y} stroke="var(--rule)" strokeWidth="2" />
      <line x1={x(schedule.needBy)} y1={Y - 4} x2={x(schedule.delivery)} y2={Y - 4}
        stroke="var(--signal)" strokeWidth="4" strokeLinecap="round" />
      <line x1={x(t0)} y1={22} x2={x(t0)} y2={H - 14} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="3 2" />
      <text x={labelX(x(t0))} y={16} fontSize="10" textAnchor={anchorAt(x(t0))} fill="var(--ink)">today</text>

      {steps.map((st, i) => {
        const key = st.k === "Production start" || st.k === "Customer delivery date";
        const up = i % 2 === 0;
        const ly = up ? Y - 16 : Y + 26;
        const late = st.d < t0;
        const px = x(st.d);
        return (
          <g key={st.k}>
            <circle cx={px} cy={Y} r={key ? 5.5 : 3.5}
              fill={late ? "var(--stop)" : key ? "var(--signal)" : "var(--panel)"}
              stroke={late ? "var(--stop)" : "var(--signal)"} strokeWidth="1.8" />
            <text x={labelX(px)} y={ly} fontSize="9.5" textAnchor={anchorAt(px)}
              fill={late ? "var(--stop)" : "var(--ink2)"}>{st.k}</text>
            <text x={labelX(px)} y={ly + (up ? -10 : 11)} fontSize="9.5" textAnchor={anchorAt(px)}
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
  L.push(`${APP_NAME.toUpperCase()} — COMPONENT READINESS AND CAPACITY REPORT`);
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
  // held can now span plants, so a row only counts against the plant that sent it
  const atVendor = (held || [])
    .filter((v) => v.code === mat && (v.plant == null || v.plant === plant))
    .reduce((a, v) => a + v.qty, 0);

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

/* Material entry: type a code, or press F4 for the search help.
   The old inline suggestion list is gone — F4 is the one way to browse. */
function MaterialInput({ value, onChange, state, onF4 }) {
  const [text, setText] = useState(value);
  const picked = useRef(false);

  useEffect(() => { setText(value); }, [value]);

  const commit = (v) => {
    const t = v.trim().toUpperCase();
    setText(t);
    if (t !== value) onChange(t);
  };

  const search = () => {
    picked.current = true;
    onF4((code) => { setText(code); if (code !== value) onChange(code); });
  };

  return (
    <div className="crc-combo">
      <input
        className={`crc-inline crc-combo-in ${state === "missing" ? "crc-combo-bad" : state === "nobom" ? "crc-combo-warn" : ""}`}
        value={text}
        spellCheck={false}
        placeholder="Code, or F4"
        title="Type a material code, or press F4 to search"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (picked.current) { picked.current = false; return; } commit(text); }}
        onKeyDown={(e) => {
          if (e.key === "F4") { e.preventDefault(); search(); return; }
          if (e.key === "Enter") { commit(text); e.currentTarget.blur(); }
          if (e.key === "Escape") { setText(value); e.currentTarget.blur(); }
        }}
      />
      <button
        className="crc-combo-toggle"
        tabIndex={-1}
        title="Search materials (F4)"
        onMouseDown={(e) => { e.preventDefault(); search(); }}
      >F4</button>
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

/* ============================================================
   BRANDING AND THEME
   ============================================================ */

const APP_NAME = "PPC Dashboard";

/* The InfraBeat wordmark. It is set in the page's own type rather than shipped
   as an image so it stays sharp at any size and needs no asset to load. To use
   the real artwork instead, point BRAND_LOGO_SRC at a file next to the page
   (public/ for the Vite build, standalone/ for the single file build) and the
   <img> replaces the wordmark. Brand colours sit on their own white plate so
   they stay correct against the dark masthead in both themes. */
const BRAND_LOGO_SRC = null;

function BrandLogo() {
  if (BRAND_LOGO_SRC) {
    return <img className="crc-logo-img" src={BRAND_LOGO_SRC} alt="InfraBeat" />;
  }
  return (
    <span className="crc-logo" role="img" aria-label="InfraBeat">
      <span className="crc-logo-a">Infra</span><span className="crc-logo-b">Beat</span>
    </span>
  );
}

const THEME_KEY = "ppc-dashboard-theme";

/* localStorage throws outright in some privacy modes, so every access is
   guarded and simply falls back to the system preference. */
function readStoredTheme() {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch (e) { /* storage unavailable */ }
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch (e) { /* matchMedia unavailable */ }
  return "light";
}

function storeTheme(v) {
  try { window.localStorage.setItem(THEME_KEY, v); } catch (e) { /* storage unavailable */ }
}

/* Capacity as a picture: one row per work centre, one cell per week, shaded by
   how hard that week is loaded, with a peak bar on the right. It answers "where
   is it tight and when" at a glance, without naming a single order. */
function CapacityHeat({ centres, weeks }) {
  if (!centres.length) return null;
  const band = (pct) =>
    pct === null ? "na" : pct > 100 ? "over" : pct > 90 ? "tight" : pct > 70 ? "busy" : pct > 0 ? "easy" : "idle";

  return (
    <div className="crc-heat">
      <div className="crc-heat-grid" style={{ gridTemplateColumns: `minmax(170px,1.5fr) repeat(${weeks.length}, 1fr) 96px` }}>
        <div className="crc-heat-h">Work centre</div>
        {weeks.map((w) => <div key={w.label} className="crc-heat-h crc-heat-hc">{w.label}</div>)}
        <div className="crc-heat-h crc-heat-hc">Peak</div>

        {centres.map((c) => (
          <React.Fragment key={c.id}>
            <div className={c.unavailable ? "crc-heat-n crc-heat-off" : "crc-heat-n"}>
              <span className="crc-mono">{c.id}</span>
              <span className="crc-heat-sub">plant {c.plant} · {c.avail} h/wk</span>
            </div>
            {c.rows.map((r) => (
              <div key={r.label} className={`crc-heat-c crc-heat-${band(r.pct)}`}
                title={`${c.id} ${r.label}: ${r.pct === null ? "off line" : r.pct + "% of " + c.avail + " h"}${r.over > 0 ? `, ${r.over} h over` : ""}`}>
                {r.pct === null ? "" : r.pct > 0 ? r.pct : ""}
              </div>
            ))}
            <div className="crc-heat-peak">
              <div className="crc-heat-bar">
                <i className={`crc-heat-fill crc-heat-${band(c.peak)}`}
                  style={{ width: `${Math.min(100, c.peak === null ? 0 : c.peak)}%` }} />
              </div>
              <span className={c.peak !== null && c.peak > 100 ? "crc-heat-pk crc-num-short" : "crc-heat-pk"}>
                {c.peak === null ? "—" : `${c.peak}%`}
              </span>
            </div>
          </React.Fragment>
        ))}
      </div>
      <div className="crc-key">
        <span><i className="crc-heat-sw crc-heat-easy" />Under 70%</span>
        <span><i className="crc-heat-sw crc-heat-busy" />70 to 90%</span>
        <span><i className="crc-heat-sw crc-heat-tight" />90 to 100%</span>
        <span><i className="crc-heat-sw crc-heat-over" />Over capacity</span>
        <span><i className="crc-heat-sw crc-heat-na" />Off line</span>
      </div>
    </div>
  );
}

/* Twelve months of issues, with the part that had no order behind it picked out */
function ConsumptionBars({ months, uom, mixed }) {
  const W = 780, H = 230, L = 52, R = 16, T = 16, B = 44;
  const pw = W - L - R, ph = H - T - B;
  const top = Math.max(1, ...months.map((m) => m.total));
  const bw = pw / months.length;
  const y = (v) => T + (1 - v / top) * ph;
  const ticks = [0, top / 2, top];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-svg" role="img"
      aria-label={`Consumption over the last twelve months${mixed ? ", mixed units of measure" : ` in ${uom}`}`}>
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="var(--rule-soft)" strokeWidth="1" />
          <text x={L - 8} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="var(--ink3)"
            className="crc-svg-mono">{fmtQty(r3(v), mixed ? "EA" : uom)}</text>
        </g>
      ))}
      {months.map((m, i) => {
        const x = L + bw * i + bw * 0.18;
        const w = bw * 0.64;
        const hTot = Math.max(0, y(0) - y(m.total));
        const hUnp = Math.max(0, y(0) - y(m.unplanned));
        return (
          <g key={m.key}>
            <rect x={x} y={y(m.total)} width={w} height={hTot} rx="1"
              fill={m.current ? "var(--mark-2)" : "var(--signal)"}>
              <title>{m.label}: {fmtQty(m.total, mixed ? "" : uom)} issued{m.unplanned > 0 ? `, ${fmtQty(m.unplanned, mixed ? "" : uom)} with no order behind it` : ""}{m.current ? " (month still running)" : ""}</title>
            </rect>
            {m.unplanned > 0 && (
              <rect x={x} y={y(m.unplanned)} width={w} height={hUnp} rx="1" fill="var(--caution)" opacity="0.95">
                <title>{m.label}: {fmtQty(m.unplanned, mixed ? "" : uom)} unplanned</title>
              </rect>
            )}
            <text x={x + w / 2} y={H - 24} fontSize="10" textAnchor="middle"
              fill={m.current ? "var(--ink3)" : "var(--ink2)"} className="crc-svg-mono">{m.label}</text>
            {m.current && (
              <text x={x + w / 2} y={H - 11} fontSize="9" textAnchor="middle" fill="var(--ink3)">part month</text>
            )}
          </g>
        );
      })}
      <line x1={L} y1={y(0)} x2={W - R} y2={y(0)} stroke="var(--rule)" strokeWidth="1.5" />
    </svg>
  );
}

/* One material's twelve months, small enough to sit in a table cell */
function Sparkline({ values }) {
  const W = 108, H = 26;
  const top = Math.max(1, ...values);
  const bw = W / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crc-spark-svg" aria-hidden="true">
      {values.map((v, i) => {
        const h = Math.max(v > 0 ? 1.5 : 0, (v / top) * (H - 4));
        return <rect key={i} x={i * bw + bw * 0.15} y={H - h} width={bw * 0.7} height={h} rx="0.8"
          fill={i === values.length - 1 ? "var(--mark-2)" : "var(--signal)"} />;
      })}
    </svg>
  );
}

/* ============================================================
   DATA EXPORT

   Everything on screen can leave as a workbook, a CSV or a PDF. The spreadsheet
   reader already loaded for the database doubles as the writer; the PDF library
   is only fetched if somebody actually asks for a PDF.
   ============================================================ */

const EXPORT_SECTIONS = [
  { id: "run", label: "Planning run", note: "one row per line in the run" },
  { id: "components", label: "Components", note: "the exploded bill for every line" },
  { id: "shortages", label: "Shortages", note: "only the components that are short" },
  { id: "demand", label: "Demand and supply", note: "opening, demand, supply and balance by material" },
  { id: "capacity", label: "Capacity", note: "hours and load by work centre and week" },
  { id: "stock", label: "Stock", note: "owned and issuable by material and plant" },
  { id: "consumption", label: "Consumption history", note: "twelve monthly buckets per material" },
  { id: "orders", label: "Purchase orders", note: "open inbound supply" },
  { id: "prod", label: "Production orders", note: "what is on the floor" },
  { id: "subcon", label: "Subcontracting", note: "orders and stock held at vendors" },
  { id: "sales", label: "Sales and delivery risk", note: "order lines against the projected position" },
  { id: "findings", label: "Summary findings", note: "the headline, key readings and findings" },
];

/* Rows are built as arrays so the same shape feeds a sheet, a CSV and a PDF table. */
function buildExport(ctx, filters) {
  const { t0, weeks, programme, runWide, consumption, commitments, shopFloor, subcon, summary,
    horizonRules, included } = ctx;
  const { plants, mats, fromISO, toISO: toISOv } = filters;

  const from = fromISO ? new Date(fromISO + "T00:00:00") : null;
  const to = toISOv ? new Date(toISOv + "T23:59:59") : null;
  const inRange = (d) => !d || ((!from || d >= from) && (!to || d <= to));
  const okPlant = (p) => !plants.length || plants.includes(p);
  const okMat = (m) => !mats.length || mats.includes(m);

  const out = {};

  out.run = {
    columns: ["Line", "Sales order", "Customer", "Material", "Description", "Quantity", "Plant",
      "Customer wants", "Must start", "Buildable now", "Full kit", "Verdict"],
    rows: programme.lines.filter((L) => okPlant(L.plant) && okMat(L.fg) && inRange(L.delivery)).map((L) => [
      L.seq, L.so ? `${L.so.doc}/${L.so.item}` : "planner entry", L.so ? L.so.customer : "",
      L.fg, matInfo(L.fg).desc, L.qty, L.plant,
      fmtDate(L.delivery), L.master.ok ? fmtDate(L.needBy) : "",
      L.master.ok ? Math.min(L.result.buildable, L.qty) : "",
      L.master.ok && L.result.shortLines.length ? fmtDate(L.result.fullKit) : "on hand",
      !L.master.ok ? "cannot explode" : L.result.verdict,
    ]),
  };

  const compRows = [];
  for (const L of programme.lines) {
    if (!L.master.ok || !okPlant(L.plant)) continue;
    for (const l of L.result.lines) {
      if (!okMat(l.code)) continue;
      compRows.push([L.seq, L.fg, L.plant, l.level, l.code, l.desc, l.uom, l.perFG, l.required,
        l.onHand, l.reserved, l.available, l.shortage, l.lead,
        l.coverage ? fmtDate(l.coverage) : "", l.status]);
    }
  }
  const compCols = ["Line", "Finished good", "Plant", "BOM level", "Material", "Description", "UoM",
    "Per unit", "Required", "On hand", "Open reservations", "Available", "Short", "Lead days",
    "Covered by", "Status"];
  out.components = { columns: compCols, rows: compRows };
  out.shortages = { columns: compCols, rows: compRows.filter((r) => Number(r[12]) > 0) };

  out.demand = {
    columns: ["Material", "Description", "Plant", "UoM", "Opening", "Safety", "Demand", "Supply",
      "Balance", "First shortage", "Cover days", "Status"],
    rows: runWide.projection.filter((d) => okPlant(d.plant) && okMat(d.mat)).map((d) => [
      d.mat, d.desc, d.plant, d.uom, d.opening, d.safety, d.totalDemand, d.totalSupply, d.balance,
      d.firstShort ? `${d.firstShort.label} ${d.firstShort.date}` : "", d.coverDays == null ? "" : d.coverDays,
      d.status,
    ]),
  };

  out.capacity = {
    columns: ["Work centre", "Description", "Plant", "Shifts", "Available h/week",
      ...weeks.map((w) => w.label), "Peak %", "Hours over", "Status"],
    rows: runWide.capacity.filter((c) => okPlant(c.plant)).map((c) => [
      c.id, c.desc, c.plant, c.shifts, c.avail,
      ...c.rows.map((r) => (r.pct == null ? "" : r.pct)),
      c.peak == null ? "" : c.peak, c.totalOver,
      c.unavailable ? "off line" : c.totalOver > 0 ? "overloaded" : "capacity available",
    ]),
  };

  const stockPairs = [];
  for (const d of runWide.projection) {
    if (!okPlant(d.plant) || !okMat(d.mat)) continue;
    if (!stockPairs.some((x) => x.m === d.mat && x.p === d.plant)) stockPairs.push({ m: d.mat, p: d.plant });
  }
  out.stock = {
    columns: ["Material", "Description", "Plant", "UoM", "Owned", "Unrestricted", "Quality hold",
      "Blocked", "In transit", "Staged", "At vendor", "Counted", "Reserved", "Issuable now"],
    rows: stockPairs.map(({ m, p }) => {
      const x = stockPicture(m, p, included, horizonRules, null, subcon.held);
      return [m, x.desc, p, x.uom, x.totalOwned, x.unrestricted, x.quality, x.blocked, x.transit,
        x.staged, x.atVendor, x.counted, x.reserved, x.issuableNow];
    }),
  };

  const consRows = consumption.filter((c) => okPlant(c.plant) && okMat(c.mat));
  out.consumption = {
    columns: ["Material", "Description", "Plant", "UoM", ...(consRows[0] ? consRows[0].periods.map((p) => p.label) : []),
      "Monthly average", "Peak", "Unplanned %", "Trend %", "Cover days", "Status"],
    rows: consRows.map((c) => [
      c.mat, c.desc, c.plant, c.uom, ...c.periods.map((p) => p.total),
      c.avg, c.peak, c.unplannedShare, c.trend == null ? "" : c.trend,
      c.coverDays == null ? "" : c.coverDays, c.status,
    ]),
  };

  out.orders = {
    columns: ["Document", "Item", "Type", "Material", "Plant", "Vendor", "Ordered", "Received",
      "Open", "Due", "Overdue", "Raised by"],
    rows: commitments.supply
      .filter((s) => okPlant(s.plant || s.p) && okMat(s.m) && inRange(s.date))
      .map((s) => [s.doc, s.item, s.type, s.m, s.plant || s.p, s.vendor, s.q, s.received,
        s.openQty, fmtDate(s.date), s.date < t0 ? "yes" : "no", `${s.mode} ${s.createdBy}`]),
  };

  out.prod = {
    columns: ["Order", "Material", "Plant", "Work centre", "Type", "Quantity", "Delivered",
      "Confirmed", "Start", "Finish", "Status", "Raised by"],
    rows: shopFloor.orders
      .filter((o) => okPlant(o.plant) && okMat(o.material) && inRange(o.finish))
      .map((o) => [o.order, o.material, o.plant, o.wc, o.type, o.qty, o.delivered, o.confirmed,
        fmtDate(o.start), fmtDate(o.finish), (o.status || []).join(" "), `${o.mode} ${o.createdBy}`]),
  };

  out.subcon = {
    columns: ["Document", "Item", "Plant", "Vendor", "Material", "Quantity", "Received", "Due",
      "Service", "Component held", "Held quantity"],
    rows: subcon.orders
      .filter((s) => okPlant(s.plant) && inRange(s.date))
      .flatMap((s) => {
        const held = subcon.held.filter((h) => h.doc === s.doc && h.item === s.item);
        if (!held.length) return [[s.doc, s.item, s.plant, s.vendor, s.material, s.q, s.received,
          fmtDate(s.date), s.service, "", ""]];
        return held.map((h) => [s.doc, s.item, s.plant, s.vendor, s.material, s.q, s.received,
          fmtDate(s.date), s.service, h.code, h.qty]);
      }),
  };

  out.sales = {
    columns: ["Sales order", "Item", "Customer", "Material", "Plant", "Quantity", "Confirmed",
      "Requested", "Can ship", "Days late", "Covered", "Why not"],
    rows: runWide.risk
      .filter((r) => okPlant(r.p) && okMat(r.material) && inRange(r.req))
      .map((r) => [r.doc, r.item, r.customer, r.material, r.p, r.qty, r.confirmed,
        fmtDate(r.req), r.expected ? fmtDate(r.expected) : (r.covered ? "on the date" : "beyond horizon"),
        r.lateDays == null ? "" : r.lateDays, r.covered ? "yes" : "no", r.cause || ""]),
  };

  const findRows = [["Headline", summary.headline, ""]];
  for (const s of summary.stats) findRows.push(["Key reading", `${s.k}: ${s.v}`, s.s]);
  for (const i of summary.issues) {
    findRows.push([i.sev, `${i.area}: ${i.headline}`, i.detail || ""]);
  }
  out.findings = { columns: ["Kind", "What", "Detail"], rows: findRows };

  return out;
}

function safeSheetName(s) {
  return s.replace(/[\[\]\*\?\/\\:]/g, " ").slice(0, 31);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function ExportDialog({ ctx, onClose, openF4, onPrint }) {
  const [format, setFormat] = useState("xlsx");
  const [picked, setPicked] = useState(() => new Set(["run", "components", "shortages", "findings"]));
  const [plants, setPlants] = useState([]);
  const [mats, setMats] = useState([]);
  const [fromISO, setFromISO] = useState("");
  const [toISOv, setToISOv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const filters = { plants, mats, fromISO, toISO: toISOv };
  const data = useMemo(() => buildExport(ctx, filters), [ctx, plants, mats, fromISO, toISOv]);
  const chosen = EXPORT_SECTIONS.filter((s) => picked.has(s.id));
  const totalRows = chosen.reduce((a, s) => a + ((data[s.id] && data[s.id].rows.length) || 0), 0);

  const toggle = (id) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const stamp = toISO(ctx.t0);
  const filterLines = [
    ["Generated", fmtDateLong(ctx.t0)],
    ["Plants", plants.length ? plants.join(", ") : "all in the run"],
    ["Materials", mats.length ? mats.join(", ") : "all in the run"],
    ["Date range", fromISO || toISOv ? `${fromISO || "any"} to ${toISOv || "any"}` : "no limit"],
    ["Sections", chosen.map((s) => s.label).join(", ")],
  ];

  const run = async () => {
    if (!chosen.length) return;
    setBusy(true); setError(null);
    try {
      if (format === "xlsx") {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb,
          XLSX.utils.aoa_to_sheet([[`${APP_NAME} export`], [], ...filterLines]), "About");
        for (const s of chosen) {
          const d = data[s.id];
          XLSX.utils.book_append_sheet(wb,
            XLSX.utils.aoa_to_sheet([d.columns, ...d.rows]), safeSheetName(s.label));
        }
        XLSX.writeFile(wb, `PPC-Dashboard-${stamp}.xlsx`);
      } else if (format === "csv") {
        // one file, sections separated by their own heading row
        const parts = [`${APP_NAME} export`, ...filterLines.map((l) => l.join(": ")), ""];
        for (const s of chosen) {
          const d = data[s.id];
          parts.push(`## ${s.label}`);
          parts.push(XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet([d.columns, ...d.rows])).trim());
          parts.push("");
        }
        downloadBlob(new Blob(["﻿" + parts.join("\r\n")], { type: "text/csv;charset=utf-8" }),
          `PPC-Dashboard-${stamp}.csv`);
      } else {
        /* PDF goes through the browser's own print dialog rather than a bundled
           PDF library. The page renders the chosen sections as a print-only
           document; the user picks "Save as PDF" as the destination. It needs no
           extra download and no CDN, and the output uses the same type as the
           screen. */
        onPrint({
          title: `${APP_NAME} — component readiness export`,
          filterLines,
          sections: chosen.map((s) => ({ label: s.label, ...data[s.id] })),
        });
      }
      onClose();
    } catch (e) {
      setError((e && e.message) || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="crc-f4wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="crc-f4 crc-exp" role="dialog" aria-modal="true" aria-label="Export data">
        <div className="crc-f4-top">
          <div>
            <div className="crc-f4-t">Export</div>
            <div className="crc-f4-s">
              Choose what to take, narrow it if you want, and pick a format. Filters travel with the
              file so it says what it is.
            </div>
          </div>
          <button className="crc-f4-x" onClick={onClose} aria-label="Close">esc</button>
        </div>

        <div className="crc-f4-body">
          <div className="crc-exp-grid">
            <div>
              <div className="crc-exp-t">What to include</div>
              <div className="crc-exp-secs">
                {EXPORT_SECTIONS.map((s) => {
                  const n = (data[s.id] && data[s.id].rows.length) || 0;
                  return (
                    <label key={s.id} className={n === 0 ? "crc-matpick-i crc-matpick-in" : "crc-matpick-i"}>
                      <input type="checkbox" checked={picked.has(s.id)} disabled={n === 0}
                        onChange={() => toggle(s.id)} />
                      <span>
                        <span className="crc-matcode">{s.label}</span>
                        <span className="crc-matdesc">{n === 0 ? "nothing in this filter" : `${n} row${n === 1 ? "" : "s"} · ${s.note}`}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="crc-exp-t">Narrow it</div>
              <div className="crc-exp-field">
                <span className="crc-pickfield-l">Plants</span>
                <div className="crc-exp-chips">
                  {PLANTS.map((p) => (
                    <button key={p.id}
                      className={plants.includes(p.id) ? "crc-seg-btn crc-seg-on crc-exp-chip" : "crc-seg-btn crc-exp-chip"}
                      onClick={() => setPlants((x) => x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id])}>
                      {p.id}
                    </button>
                  ))}
                  {plants.length > 0 && <button className="crc-linkbtn" onClick={() => setPlants([])}>all</button>}
                </div>
              </div>

              <div className="crc-exp-field">
                <span className="crc-pickfield-l">Materials</span>
                <button className="crc-btn crc-btn-light"
                  onClick={() => openF4({ mode: "multi", plant: plants.length === 1 ? plants[0] : "", initial: mats, title: "Materials to export" },
                    (codes) => setMats(codes))}>
                  {mats.length ? `${mats.length} selected` : "All materials"}
                  <kbd className="crc-kbd2">F4</kbd>
                </button>
                {mats.length > 0 && <button className="crc-linkbtn" onClick={() => setMats([])}>all</button>}
              </div>

              <div className="crc-exp-field">
                <span className="crc-pickfield-l">Date range</span>
                <input type="date" className="crc-addso" value={fromISO} onChange={(e) => setFromISO(e.target.value)} />
                <span className="crc-exp-to">to</span>
                <input type="date" className="crc-addso" value={toISOv} onChange={(e) => setToISOv(e.target.value)} />
                {(fromISO || toISOv) && (
                  <button className="crc-linkbtn" onClick={() => { setFromISO(""); setToISOv(""); }}>clear</button>
                )}
              </div>
              <div className="crc-exp-note">
                The date range applies to rows that carry a date — purchase and production orders,
                subcontracting, sales lines and the run itself. Master data and stock are not filtered by it.
              </div>

              <div className="crc-exp-t crc-exp-t2">Format</div>
              <div className="crc-exp-formats">
                {[["xlsx", "Excel", "one sheet per section, plus a sheet recording the filters"],
                  ["csv", "CSV", "a single file, each section under its own heading"],
                  ["pdf", "PDF", "opens the print dialog — choose Save as PDF as the destination"]].map(([k, label, note]) => (
                  <label key={k} className={format === k ? "crc-matpick-i crc-exp-fmt crc-exp-fmt-on" : "crc-matpick-i crc-exp-fmt"}>
                    <input type="radio" name="crc-exp-format" checked={format === k} onChange={() => setFormat(k)} />
                    <span>
                      <span className="crc-matcode">{label}</span>
                      <span className="crc-matdesc">{note}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {error && <div className="crc-exp-err">{error}</div>}
        </div>

        <div className="crc-f4-foot">
          <span>{chosen.length} section{chosen.length === 1 ? "" : "s"} · {totalRows} row{totalRows === 1 ? "" : "s"}</span>
          <span className="crc-f4-foot-r">
            <button className="crc-btn crc-btn-light" onClick={onClose}>Cancel</button>
            <button className="crc-btn" disabled={!chosen.length || busy} onClick={run}>
              {busy ? "Preparing…" : format === "pdf" ? "Print / Save as PDF" : `Export ${format.toUpperCase()}`}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/* The export rendered for paper. Hidden on screen, shown only to the printer. */
function PrintDoc({ doc }) {
  return (
    <div className="crc-printdoc">
      <h1 className="crc-pd-t">{doc.title}</h1>
      <table className="crc-pd-meta">
        <tbody>
          {doc.filterLines.map(([k, v]) => (
            <tr key={k}><th>{k}</th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
      {doc.sections.map((s) => (
        <div key={s.label} className="crc-pd-sec">
          <h2 className="crc-pd-h">{s.label}<span>{s.rows.length} row{s.rows.length === 1 ? "" : "s"}</span></h2>
          <table className="crc-pd-table">
            <thead>
              <tr>{s.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j}>{v == null ? "" : String(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   F4 MATERIAL SEARCH

   SAP habit: F4 on a field opens the search help, so every material field here
   does the same. It searches the whole material master rather than only the
   materials that carry a bill of material, filters by plant, and hands back a
   single code or a set of them depending on how it was opened.
   ============================================================ */

function materialKind(code) {
  if (FINISHED_GOODS.some((f) => f.code === code)) return "Finished good";
  if (BOMS[code]) return "Sub-assembly";
  return "Component";
}

function F4Dialog({ spec, onClose, onPick }) {
  const multi = spec.mode === "multi";
  const [q, setQ] = useState("");
  const [plantFilter, setPlantFilter] = useState(spec.plant || "");
  const [chosen, setChosen] = useState(() => new Set(spec.initial || []));
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  const rows = useMemo(() => {
    const term = q.trim().toUpperCase();
    const out = [];
    for (const code of Object.keys(MATERIALS)) {
      const m = MATERIALS[code];
      if (term && !(code.toUpperCase().includes(term) || (m.desc || "").toUpperCase().includes(term))) continue;
      if (plantFilter) {
        const known = STOCK.some((s) => s.m === code && s.p === plantFilter)
          || FINISHED_GOODS.some((f) => f.code === code && f.plant === plantFilter)
          || MRP_DATA.some((d) => d.m === code && d.p === plantFilter);
        if (!known) continue;
      }
      const onHand = STOCK
        .filter((s) => s.m === code && (!plantFilter || s.p === plantFilter))
        .reduce((a, s) => a + s.q, 0);
      out.push({ code, desc: m.desc, uom: m.uom, mrp: m.mrp, kind: materialKind(code), onHand });
    }
    /* The master is stored raw materials first, which buries every finished good
       behind 180 components. A planner looks for what is sold before what goes
       into it, so the list is ordered that way. */
    const rank = { "Finished good": 0, "Sub-assembly": 1, Component: 2 };
    return out.sort((a, b) => (rank[a.kind] - rank[b.kind]) || a.code.localeCompare(b.code));
  }, [q, plantFilter]);

  useEffect(() => { setCursor(0); }, [q, plantFilter]);

  const take = (code) => {
    if (multi) {
      setChosen((s) => {
        const n = new Set(s);
        if (n.has(code)) n.delete(code); else n.add(code);
        return n;
      });
    } else {
      onPick(code);
    }
  };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (rows[cursor]) take(rows[cursor].code);
      else if (multi && chosen.size) onPick([...chosen]);
    }
  };

  return (
    <div className="crc-f4wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="crc-f4" role="dialog" aria-modal="true" aria-label={spec.title || "Material search"} onKeyDown={onKey}>
        <div className="crc-f4-top">
          <div>
            <div className="crc-f4-t">{spec.title || "Material search"}</div>
            <div className="crc-f4-s">
              {multi ? "Tick every material you want, then use the selection." : "Pick a material to fill the field."}
              {" "}Search runs over the material master.
            </div>
          </div>
          <button className="crc-f4-x" onClick={onClose} aria-label="Close">esc</button>
        </div>

        <div className="crc-f4-filters">
          <input
            ref={inputRef}
            className="crc-f4-q"
            value={q}
            spellCheck={false}
            placeholder="Material code or description…"
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="crc-pickfield">
            <span className="crc-pickfield-l">Plant</span>
            <select className="crc-addso" value={plantFilter} onChange={(e) => setPlantFilter(e.target.value)}>
              <option value="">All plants</option>
              {PLANTS.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}
            </select>
          </label>
          <span className="crc-f4-count">
            {rows.length} of {Object.keys(MATERIALS).length}
            {multi && chosen.size > 0 && ` · ${chosen.size} selected`}
          </span>
        </div>

        <div className="crc-f4-body">
          {rows.length === 0 ? (
            <div className="crc-f4-none">Nothing in the material master matches “{q}”.</div>
          ) : (
            <table className="crc-table crc-f4-table">
              <thead>
                <tr>
                  {multi && <th className="crc-th-count">Use</th>}
                  <th className="crc-th-mat">Material</th>
                  <th>Type</th>
                  <th>UoM</th>
                  <th>MRP</th>
                  <th className="crc-num">On hand{plantFilter ? ` at ${plantFilter}` : ""}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.code}
                    className={i === cursor ? "crc-prog-on" : ""}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => take(r.code)}
                    style={{ cursor: "pointer" }}
                  >
                    {multi && (
                      <td className="crc-th-count">
                        <label className="crc-mark" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={chosen.has(r.code)} onChange={() => take(r.code)} />
                        </label>
                      </td>
                    )}
                    <td className="crc-th-mat">
                      <div className="crc-matcode">{r.code}</div>
                      <div className="crc-matdesc">{r.desc}</div>
                    </td>
                    <td>{r.kind}</td>
                    <td className="crc-mono">{r.uom}</td>
                    <td className="crc-mono">{r.mrp}</td>
                    <td className="crc-num">{r.onHand > 0 ? fmtQty(r.onHand, r.uom) : <span className="crc-dim">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="crc-f4-foot">
          <span><kbd className="crc-kbd2">↑</kbd><kbd className="crc-kbd2">↓</kbd> move</span>
          <span><kbd className="crc-kbd2">↵</kbd> {multi ? "tick" : "choose"}</span>
          <span><kbd className="crc-kbd2">esc</kbd> close</span>
          {multi && (
            <span className="crc-f4-foot-r">
              {chosen.size > 0 && (
                <button className="crc-linkbtn" onClick={() => setChosen(new Set())}>clear</button>
              )}
              <button className="crc-btn" disabled={!chosen.size} onClick={() => onPick([...chosen])}>
                Use {chosen.size || ""} material{chosen.size === 1 ? "" : "s"}
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ReadinessDashboard() {
  const t0 = today();

  /* Theme is remembered per browser and falls back to the operating system
     preference on a machine that has never set it. */
  const [theme, setTheme] = useState(readStoredTheme);
  useEffect(() => { storeTheme(theme); }, [theme]);

  /* Paper is white whatever the screen is set to. Rather than restate the whole
     light palette inside the print rules, drop back to the light theme for the
     duration of the print job and restore afterwards. */
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => setPrinting(true);
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  /* The opening run is seeded from real sales order lines rather than fixed
     codes, so regenerating the workbook cannot leave it pointing at a material
     or plant that no longer exists. Three different finished goods, each still
     ahead of its requested date. */
  const [demand, setDemand] = useState(() => {
    const rows = [];
    const seenMat = [];
    const seenPlant = [];
    const take = (s) => {
      seenMat.push(s.m);
      seenPlant.push(s.p);
      rows.push({
        key: rows.length + 1, so: `${s.doc}/${s.item}`, fg: s.m, qty: s.qty,
        plant: s.p, version: "AUTO", deliveryISO: toISO(addDays(t0, s.reqOffset)),
      });
    };
    const usable = SALES_ORDERS.filter((s) => s.reqOffset >= 7 && BOMS[s.m]);
    // Two different plants, so the plant-keyed screens change when the scope
    // widens to the whole run, then a second line back on the first plant so
    // there is something for the contention screen to arbitrate.
    for (const s of usable) {
      if (rows.length >= 2) break;
      if (seenMat.includes(s.m) || seenPlant.includes(s.p)) continue;
      take(s);
    }
    for (const s of usable) {
      if (rows.length >= 3) break;
      if (seenMat.includes(s.m) || s.p !== seenPlant[0]) continue;
      take(s);
    }
    for (const s of usable) {
      if (rows.length >= 3) break;
      if (seenMat.includes(s.m)) continue;
      take(s);
    }
    if (rows.length) return rows;
    return FINISHED_GOODS.slice(0, 3).map((f, i) => ({
      key: i + 1, so: null, fg: f.code, qty: f.defaultQty,
      plant: f.plant, version: "AUTO", deliveryISO: toISO(addDays(t0, 21)),
    }));
  });
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
    setDemand((d) => d.map((x) => {
      if (x.key !== key) return x;
      const next = { ...x, ...patch };
      /* A line that no longer builds the order's material is not that order's
         line any more. Without this the row kept the old customer and document
         after the material was changed, which is the one thing on the screen
         that would still be describing the previous selection. */
      if (next.so && Object.prototype.hasOwnProperty.call(patch, "fg")) {
        const so = SALES_ORDERS.find((s) => `${s.doc}/${s.item}` === next.so);
        if (!so || so.m !== next.fg) next.so = null;
      }
      return next;
    }));
    setAiPlan(null);
    setExpanded(null);
    // the charted material is pinned by code, so unpin it when the line changes
    setDsPick(null);
  };
  const nextKey = () => Math.max(0, ...demand.map((x) => x.key)) + 1;

  /* The run is built from material and plant combinations. Pick a plant, tick as
     many materials as you want, and each one becomes a line. A combination
     already in the run is skipped rather than duplicated, since two lines for the
     same material at the same plant would just compete with each other. */
  const [addPlant, setAddPlant] = useState(() => (PLANTS[0] && PLANTS[0].id) || "");
  const [addMats, setAddMats] = useState(() => new Set());

  /* One F4 dialog serves every material field on every screen. The caller says
     what it wants back and the callback lives in a ref, so reopening it from a
     different field cannot fire a stale handler. */
  const [exportOpen, setExportOpen] = useState(false);
  /* Holding the export as a print-only document, printing it, then dropping it */
  const [printDoc, setPrintDoc] = useState(null);
  useEffect(() => {
    if (!printDoc) return;
    const id = window.setTimeout(() => { window.print(); setPrintDoc(null); }, 80);
    return () => window.clearTimeout(id);
  }, [printDoc]);
  const [f4, setF4] = useState(null);
  const f4Cb = useRef(null);
  const openF4 = useCallback((opts, cb) => { f4Cb.current = cb; setF4(opts); }, []);
  const closeF4 = useCallback(() => { f4Cb.current = null; setF4(null); }, []);
  const pickF4 = useCallback((value) => {
    const cb = f4Cb.current;
    f4Cb.current = null;
    setF4(null);
    if (cb) cb(value);
  }, []);

  const toggleAddMat = (code) => {
    setAddMats((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code); else n.add(code);
      return n;
    });
  };

  const alreadyInRun = (code, p) => demand.some((x) => x.fg === code && x.plant === p);

  const addSelected = () => {
    if (!addMats.size || !addPlant) return;
    /* Listed materials keep the order they are shown in, and anything typed in by
       hand that is not on that list follows. Order is priority in the run. */
    const ordered = MATERIAL_OPTIONS.map((o) => o.code).filter((c) => addMats.has(c));
    for (const c of addMats) if (!ordered.includes(c)) ordered.push(c);

    setDemand((d) => {
      let k = Math.max(0, ...d.map((x) => x.key));
      const next = [...d];
      for (const code of ordered) {
        if (next.some((x) => x.fg === code && x.plant === addPlant)) continue;
        const fg = FINISHED_GOODS.find((f) => f.code === code && f.plant === addPlant)
          || FINISHED_GOODS.find((f) => f.code === code);
        next.push({
          key: ++k, so: null, fg: code,
          qty: (fg && fg.defaultQty) || 10,
          plant: addPlant, version: "AUTO",
          deliveryISO: toISO(addDays(t0, 21)),
        });
      }
      return next;
    });
    setAddMats(new Set());
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

  const [dsPick, setDsPick] = useState(null);
  const [scope, setScope] = useState("line");
  /* Everything below the run follows the finished good selected above,
     unless the planner widens it to the whole run. This block sits above the
     per-screen data because the reference screens read from it too — they used
     to key off the selected line alone, which is why Whole run appeared to do
     nothing on Production orders, Purchase orders and Subcontracting. */
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

  // everything competing with the run in scope: open reservations and supply already pegged by MRP
  const commitments = useMemo(() => {
    const rules = { t0, needBy, resPolicy, excludePegged };
    const resv = [];
    const supply = [];
    const seenResv = new Set();
    const seenSupply = new Set();
    for (const { m, p } of scopeMats) {
      for (const r of openReservations(m, p, t0)) {
        const k = `${r.id}|${m}|${p}`;
        if (seenResv.has(k)) continue;
        seenResv.add(k);
        const counted =
          resPolicy === "none" ? false : resPolicy === "horizon" ? r.date <= needBy : true;
        resv.push({ ...r, plant: p, uom: MATERIALS[m].uom, counted });
      }
      for (const s of allSupply(m, p, rules)) {
        const k = `${s.doc}|${s.item}|${s.m}|${p}`;
        if (seenSupply.has(k)) continue;
        seenSupply.add(k);
        supply.push({ ...s, plant: p, uom: MATERIALS[s.m].uom });
      }
    }
    resv.sort((a, b) => a.date - b.date);
    supply.sort((a, b) => a.date - b.date);
    return { resv, supply };
  }, [scopeMats, resPolicy, excludePegged, needBy, t0]);

  const scopePlantList = useMemo(
    () => [...new Set(scopeMats.map((x) => x.p))],
    [scopeMats]
  );

  const shopFloor = useMemo(() => {
    const rules = { t0, needBy, resPolicy, excludePegged };
    const plants = scopePlantList.length ? scopePlantList : [plant];
    return {
      orders: plants.flatMap((pl) => prodOrders(pl, rules)),
      moves: plants.flatMap((pl) => goodsMovements(pl, rules, null)),
    };
  }, [scopePlantList, plant, needBy, resPolicy, excludePegged, t0]);

  const subcon = useMemo(() => {
    const rules = { t0, needBy, resPolicy, excludePegged };
    const plants = scopePlantList.length ? scopePlantList : [plant];
    return {
      orders: plants.flatMap((pl) => subconOrders(pl, rules)),
      held: plants.flatMap((pl) => vendorStockAll(pl, rules)),
    };
  }, [scopePlantList, plant, needBy, resPolicy, excludePegged, t0]);

  const horizonRules = useMemo(
    () => ({ t0, needBy, resPolicy, excludePegged, batchOut, wcOut }),
    [t0, needBy, resPolicy, excludePegged, batchOut, wcOut]
  );

  /* Contention is a property of the whole run - it is the competition between
     lines - but the screen has to answer the question the toggle asks. Whole run
     shows every contended component; This material narrows to the ones the
     selected line is actually fighting for. */
  const contendedInScope = useMemo(
    () => (scope === "run" ? contended : contended.filter((c) => c.rows.some((r) => r.seq === sel.seq))),
    [scope, contended, sel]
  );

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

  /* Stock is asked a different question from the rest of the run, so it carries
     its own scope on two axes: which materials (just the selected line, or every
     line in the run) and which plants (the line's plant, or all of them). Both
     controls sit on the Stock screen and the tables below read from this. */
  const [stockAllPlants, setStockAllPlants] = useState(false);
  const stockScope = useMemo(() => {
    const mats = [];
    for (const x of scopeMats) if (!mats.includes(x.m)) mats.push(x.m);
    if (!stockAllPlants) return mats.map((m) => ({ m, p: plant }));
    const pairs = [];
    for (const m of mats) {
      // across all plants, list a material only where it actually holds a position
      const ps = PLANTS.map((x) => x.id).filter((p) => STOCK.some((r) => r.m === m && r.p === p && r.q > 0));
      if (!ps.length) pairs.push({ m, p: plant });
      else for (const p of ps) pairs.push({ m, p });
    }
    return pairs;
  }, [scopeMats, stockAllPlants, plant]);

  const batchesInScope = useMemo(
    () => stockScope.filter((x) => isBatchManaged(x.m)).flatMap((x) => batchRows(x.m, x.p, horizonRules)),
    [stockScope, horizonRules]
  );
  const [copied, setCopied] = useState(false);
  /* Consumption history stands on its own: usage is a property of the material
     and the plant, not of one order, so it is filtered rather than scoped. The
     default is everything with history, across every plant. */
  const [consPlantSel, setConsPlantSel] = useState("");   // "" = all plants
  const [consMatSel, setConsMatSel] = useState([]);       // [] = every material with history

  const consumption = useMemo(() => {
    const plants = consPlantSel ? [consPlantSel] : PLANTS.map((p) => p.id);
    const out = [];
    for (const p of plants) {
      for (const rec of CONSUMPTION.filter((c) => c.p === p)) {
        if (consMatSel.length && !consMatSel.includes(rec.m)) continue;
        const h = consumptionHistory(rec.m, p, horizonRules, included, null);
        if (h) out.push({ ...h, key: `${h.mat}|${h.plant}` });
      }
    }
    return out.sort((a, b) =>
      (a.status === b.status ? b.sum - a.sum : a.status === "late" ? -1 : b.status === "late" ? 1 : a.status === "risk" ? -1 : 1));
  }, [consPlantSel, consMatSel, horizonRules, included]);

  /* Twelve monthly buckets summed over whatever is in the filter. Materials can
     carry different units, so the chart says so rather than pretending the
     total is one number with one meaning. */
  const consChart = useMemo(() => {
    const months = monthsBack(t0, 12);
    const uoms = [...new Set(consumption.map((c) => c.uom))];
    return {
      uoms,
      months: months.map((mo, i) => ({
        ...mo,
        total: r3(consumption.reduce((a, c) => a + ((c.periods[i] && c.periods[i].total) || 0), 0)),
        unplanned: r3(consumption.reduce((a, c) => a + ((c.periods[i] && c.periods[i].unplanned) || 0), 0)),
      })),
    };
  }, [consumption, t0]);

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
    contention: contendedInScope.length,
    prod: shopFloor.orders.filter((o) => !o.complete).length,
    orders: commitments.supply.filter((s) => s.openQty > 0).length,
    subcon: subcon.held.length,
    consumption: consumption.filter((c) => c.status !== "ok").length || null,
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
    <div className={printDoc ? "crc-root crc-printing" : "crc-root"} data-theme={printing || printDoc ? "light" : theme}>
      <style>{CSS}</style>

      {f4 && <F4Dialog spec={f4} onClose={closeF4} onPick={pickF4} />}
      {printDoc && <PrintDoc doc={printDoc} />}
      {exportOpen && (
        <ExportDialog
          ctx={{ t0, weeks, programme, runWide, consumption, commitments, shopFloor, subcon,
            summary, horizonRules, included }}
          openF4={openF4}
          onPrint={(d) => { setExportOpen(false); setPrintDoc(d); }}
          onClose={() => setExportOpen(false)}
        />
      )}

      <header className="crc-header">
        <div className="crc-header-in">
          <div className="crc-brand">
            <BrandLogo />
            <div>
              <div className="crc-brand-name">{APP_NAME}</div>
              <div className="crc-brand-sub">Can this run start, and what is stopping it</div>
            </div>
          </div>

          <div className="crc-headtools">
            <button
              type="button"
              className="crc-themebtn"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-pressed={theme === "dark"}
              title={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
            >
              <span aria-hidden="true">{theme === "dark" ? "☀" : "☽"}</span>
              <span className="crc-sr">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
            </button>
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
                <label className="crc-pickfield">
                  <span className="crc-pickfield-l">Plant</span>
                  <select className="crc-addso" value={addPlant} onChange={(e) => setAddPlant(e.target.value)}>
                    {PLANTS.map((p) => (
                      <option key={p.id} value={p.id}>{p.id} · {p.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="crc-btn crc-btn-light"
                  onClick={() => openF4(
                    { mode: "multi", plant: addPlant, initial: [...addMats], title: `Materials to plan at plant ${addPlant}` },
                    (codes) => setAddMats(new Set(codes))
                  )}
                >
                  {addMats.size ? `${addMats.size} material${addMats.size > 1 ? "s" : ""} selected` : "Choose materials"}
                  <kbd className="crc-kbd2">F4</kbd>
                </button>
                <button className="crc-btn" disabled={!addMats.size} onClick={addSelected}>
                  Add {addMats.size > 0 ? addMats.size : ""} line{addMats.size === 1 ? "" : "s"}
                </button>
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
                            state={!L.master.known ? "missing" : !L.master.hasBom ? "nobom" : "ok"}
                            /* every plant, not just this line's: picking a finished
                               good from elsewhere moves the line to its plant */
                            onF4={(cb) => openF4(
                              { mode: "single", plant: "", title: `Material for line ${L.seq}` },
                              cb
                            )}
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
              {/* Components and Shortages always read the selected line, and Stock
                  carries its own scope controls, so the shared toggle is hidden there. */}
              {!["components", "shortages", "stock"].includes(tab) && (
                <div className="crc-ctx-scope">
                  <span className="crc-seg crc-seg-sm">
                    {[["line", "This material"], ["run", "Whole run"]].map(([k, label]) => (
                      <button key={k} className={scope === k ? "crc-seg-btn crc-seg-on" : "crc-seg-btn"}
                        onClick={() => { setScope(k); setDsPick(null); }}>{label}</button>
                    ))}
                  </span>
                </div>
              )}
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
                        <th className="crc-num">Demand</th>
                        <th className="crc-num">Supply</th>
                        <th className="crc-num">Balance</th>
                        <th>First shortage</th>
                        <th className="crc-th-act2">What to do</th>
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
                          <td className="crc-num" title={d.safety > 0 ? `safety stock ${fmtQty(d.safety, d.uom)} ${d.uom}` : "no safety stock set"}>
                            {fmtQty(d.opening, d.uom)}
                          </td>
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
                          <td className="crc-th-act2">
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
                    <span><i style={{ background: "var(--mark-1)" }} />Sales orders</span>
                    <span><i style={{ background: "var(--mark-2)" }} />Forecast</span>
                    <span><i style={{ background: "var(--caution)" }} />Dependent requirements</span>
                    <span><i style={{ background: "var(--mark-run)" }} />This planning run</span>
                    <span><i style={{ background: "var(--go)" }} />Receipts</span>
                    <span><i style={{ background: "var(--ink)" }} />Projected stock</span>
                  </div>
                </div>

                <div className="crc-tablewrap" id="sec-dsweeks">
                  <table className="crc-table">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th className="crc-num">Demand</th>
                        <th className="crc-num">Supply</th>
                        <th className="crc-num">Projected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projection.rows.map((r) => {
                        /* Eleven columns of breakdown made this unreadable at a glance.
                           The two totals carry the week; the split behind each one is on
                           the cell, for when someone needs to know where it came from. */
                        const parts = (pairs) => pairs.filter(([, v]) => v > 0)
                          .map(([k, v]) => `${k} ${fmtQty(v, projection.uom)}`).join(" · ");
                        const demand = r3(r.so + r.pir + r.dep + r.runDep);
                        const supply = r3(r.planned + r.prod + r.purch + r.subcon + r.run);
                        const demandParts = parts([["sales orders", r.so], ["forecast", r.pir],
                          ["dependent", r.dep], ["this run", r.runDep]]);
                        const supplyParts = parts([["planned", r.planned], ["production", r.prod],
                          ["purchasing", r.purch], ["subcontract", r.subcon], ["run output", r.run]]);
                        return (
                          <tr key={r.label} className={r.closing < 0 ? "crc-tr-short" : ""}>
                            <td>
                              <div className="crc-matcode">{r.label}</div>
                              <div className="crc-matdesc">{r.date}</div>
                            </td>
                            <td className={`crc-num ${demand > 0 ? "" : "crc-dim"}`} title={demandParts || "nothing due out"}>
                              {demand > 0 ? `−${fmtQty(demand, projection.uom)}` : "—"}
                              {demandParts && <div className="crc-cellsub">{demandParts}</div>}
                            </td>
                            <td className={`crc-num ${supply > 0 ? "crc-mvt-plus" : "crc-dim"}`} title={supplyParts || "nothing due in"}>
                              {supply > 0 ? `+${fmtQty(supply, projection.uom)}` : "—"}
                              {supplyParts && <div className="crc-cellsub">{supplyParts}</div>}
                            </td>
                            <td className={`crc-num crc-strong ${r.closing < 0 ? "crc-num-short" : r.closing < projection.safety ? "crc-excl" : ""}`}>
                              {fmtQty(r.closing, projection.uom)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="crc-legend">
                  Demand is sales orders, forecast, dependent requirements and what this run consumes. Supply is
                  planned and production orders, purchasing, subcontracting and what this run delivers back into
                  stock. The split behind each total is shown under it.
                </div>
              </div>
            </>
          )}

          {/* ---- CAPACITY ---- */}
          {tab === "capacity" && (() => {
            const over = capacityAll.filter((c) => c.totalOver > 0);
            const offline = capacityAll.filter((c) => c.unavailable);
            const free = capacityAll.filter((c) => !c.unavailable && c.totalOver === 0);
            return (
              <div className="crc-panel">
                <div className="crc-panel-head">
                  <span>Work centre capacity — hours required against hours available, including what this run would add</span>
                  <span className="crc-head-right">
                    <span className={over.length ? "crc-panel-flag" : "crc-panel-ok"}>
                      {over.length} overloaded · {free.length} with capacity
                      {offline.length > 0 && ` · ${offline.length} off line`}
                    </span>
                    {wcOut.size > 0 && (
                      <button className="crc-linkbtn" onClick={() => setWcOut(new Set())}>bring all back on line</button>
                    )}
                  </span>
                </div>
                <div className="crc-chart">
                  <div className="crc-chart-head">
                    <h4>Load by week<span className="crc-head-sub">percentage of the hours each centre has</span></h4>
                    <p>
                      Every centre in scope against every week in the horizon. Darker is tighter; anything
                      over 100% is work that will not fit in the week it is planned for. The bar on the right
                      is the worst week that centre sees.
                    </p>
                  </div>
                  <CapacityHeat centres={capacityAll} weeks={weeks} />
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
                        <th className="crc-num">Peak</th>
                        <th className="crc-th-cap">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {capacityAll.map((c) => {
                        /* Spare hours in the tightest week is the number that answers
                           "can I put more on here", so it is what the status reports. */
                        const busiest = c.rows.reduce((a, r) => Math.max(a, r.total), 0);
                        const spare = r3(Math.max(0, c.avail - busiest));
                        return (
                          <tr key={c.id} className={c.unavailable ? "crc-tr-muted" : c.totalOver > 0 ? "crc-tr-short" : ""}>
                            <td className="crc-th-count">
                              <label className="crc-mark">
                                <input type="checkbox" checked={!c.unavailable} onChange={() => toggleWc(c.id)} />
                              </label>
                            </td>
                            <td className="crc-th-mat">
                              <div className="crc-matcode">{c.id}</div>
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
                            <td className={`crc-num crc-strong ${c.peak === null ? "crc-dim" : c.peak > 100 ? "crc-num-short" : ""}`}>
                              {c.peak === null ? "—" : `${c.peak}%`}
                            </td>
                            <td className="crc-th-cap">
                              {c.unavailable ? (
                                <>
                                  <span className="crc-status crc-status-neutral">Off line</span>
                                  <span className="crc-capnote">
                                    {c.strandedHours > 0 ? `${c.strandedHours} h stranded` : "nothing booked"}
                                  </span>
                                </>
                              ) : c.totalOver > 0 ? (
                                <>
                                  <span className="crc-status crc-status-stop">Overloaded</span>
                                  <span className="crc-capnote">
                                    {c.totalOver} h over in {c.overWeeks.map((w) => w.label).join(", ")}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="crc-status crc-status-go">Capacity available</span>
                                  <span className="crc-capnote">
                                    {spare} h spare in the tightest week
                                  </span>
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="crc-legend">
                  Each week column is the load on that centre as a percentage of the hours it has. Peak is the
                  worst week. Untick a centre to take it off line — a breakdown, a maintenance window, or a shift
                  not being manned — and its available hours drop to zero.
                  {wcOut.size > 0 && (() => {
                    const stranded = capacityAll.filter((c) => c.unavailable).reduce((a, c) => a + c.strandedHours, 0);
                    const spareAll = capacityAll.filter((c) => !c.unavailable)
                      .reduce((a, c) => a + c.rows.reduce((x, r) => x + Math.max(0, c.avail - r.total), 0), 0);
                    return ` ${r3(stranded)} hours are currently stranded on centres you have taken off line, against ${r3(spareAll)} hours of spare capacity across the rest.`;
                  })()}
                </div>
              </div>
            );
          })()}

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
                    <span><i style={{ background: "var(--mark-green)" }} />Built, planned</span>
                    <span><i style={{ background: "var(--mark-1)" }} />Shipped, posted</span>
                    <span><i style={{ background: "var(--mark-3)" }} />To ship, committed</span>
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
                        <th className="crc-th-when">Figures</th>
                        <th className="crc-num">Built</th>
                        <th className="crc-num">Shipped</th>
                        <th className="crc-num">Net</th>
                        <th className="crc-num">Cumulative</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flow.rows.map((r) => {
                        /* Past weeks fill produced/dispatched and future weeks fill the
                           planned pair, so four columns were half empty on every row.
                           One pair of columns, labelled by which side of today it is. */
                        const built = r.past ? r.produced : r.plannedOut;
                        const shipped = r.past ? r.dispatched : r.plannedShip;
                        return (
                          <tr key={r.label} className={r.past ? "crc-tr-muted" : r.net < 0 ? "crc-tr-short" : ""}>
                            <td>
                              <div className="crc-matcode">{r.label}</div>
                              <div className="crc-matdesc">{r.date}</div>
                            </td>
                            <td className="crc-th-when">
                              <span className={`crc-status ${r.past ? "crc-status-neutral" : "crc-status-signal"}`}>
                                {r.past ? "actual" : "planned"}
                              </span>
                            </td>
                            <td className="crc-num">{built > 0 ? fmtQty(built, "EA") : <span className="crc-dim">—</span>}</td>
                            <td className="crc-num">{shipped > 0 ? fmtQty(shipped, "EA") : <span className="crc-dim">—</span>}</td>
                            <td className={`crc-num ${r.net < 0 ? "crc-num-short" : r.net > 0 ? "crc-mvt-plus" : "crc-dim"}`}>
                              {r.net !== 0 ? `${r.net > 0 ? "+" : ""}${fmtQty(r.net, "EA")}` : "—"}
                            </td>
                            <td className={`crc-num crc-strong ${r.cum < 0 ? "crc-num-short" : ""}`}>
                              {r.cum > 0 ? "+" : ""}{fmtQty(r.cum, "EA")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="crc-legend">
                  Weeks marked actual read from goods receipts posted against production orders and goods issues on
                  outbound deliveries. Weeks marked planned use open production and planned orders against the
                  confirmed order book, so the cumulative column is the stock position this plan produces.
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
                      <th className="crc-th-covby">Covered by</th>
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
            <ScreenNav sections={contendedInScope.slice(0, 8).map((c) => ({ id: `sec-cont-${c.code}`, label: c.code }))} />
            <div className="crc-panel">
              <div className="crc-panel-head">
                <span>Components more than one line in this run needs, and how the stock was split</span>
                <span className="crc-head-right">
                  <span className="crc-panel-flag">
                    {contendedInScope.filter((c) => c.starved > 0).length} of {contendedInScope.length} leave a line short
                  </span>
                </span>
              </div>

              <div className="crc-contlist">
                {contendedInScope.map((c) => {
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

          {/* ---- STOCK ---- */}
          {tab === "stock" && (
            <>
              <ScreenNav sections={[
                { id: "sec-stkpos", label: "Position by material", count: stockScope.length },
                { id: "sec-stkloc", label: "Where it sits" },
              ]} />

              <div className="crc-panel" id="sec-stkpos">
                <div className="crc-panel-head">
                  <span>
                    What is owned {stockAllPlants ? "across all plants" : `at plant ${plant}`}
                    {scope === "line" ? ` for ${fgCode} and its components` : " for every line in the run"},
                    and how much of it can be issued today
                  </span>
                  <span className="crc-head-right">
                    <span className="crc-seg crc-seg-sm">
                      {[["line", "This material"], ["run", "Whole run"]].map(([k, label]) => (
                        <button key={k} className={scope === k ? "crc-seg-btn crc-seg-on" : "crc-seg-btn"}
                          onClick={() => { setScope(k); setDsPick(null); }}>{label}</button>
                      ))}
                    </span>
                    <span className="crc-seg crc-seg-sm">
                      {[[false, `Plant ${plant}`], [true, "All plants"]].map(([v, label]) => (
                        <button key={String(v)} className={stockAllPlants === v ? "crc-seg-btn crc-seg-on" : "crc-seg-btn"}
                          onClick={() => setStockAllPlants(v)}>{label}</button>
                      ))}
                    </span>
                  </span>
                </div>
                {(() => {
                  const pics = stockScope.map((x) => ({
                    ...stockPicture(x.m, x.p, included, horizonRules, null, subcon.held),
                    plant: x.p,
                  }));
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
                              {stockAllPlants && <th>Plant</th>}
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
                              <tr key={`${x.mat}|${x.plant}`} className={x.issuableNow <= 0 ? "crc-tr-short" : ""}>
                                <td className="crc-th-mat">
                                  <div className="crc-matcode">{x.mat}</div>
                                  <div className="crc-matdesc">{x.desc}</div>
                                </td>
                                {stockAllPlants && <td className="crc-mono">{x.plant}</td>}
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
                        {stockAllPlants && <th>Plant</th>}
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
                      {stockScope.map(({ m, p }) => {
                        const x = stockPicture(m, p, included, horizonRules, null, subcon.held);
                        return (
                          <tr key={`${m}|${p}`}>
                            <td className="crc-th-mat">
                              <div className="crc-matcode">{m}</div>
                              <div className="crc-matdesc">{x.desc}</div>
                            </td>
                            {stockAllPlants && <td className="crc-mono">{p}</td>}
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
          {/* ---- CONSUMPTION HISTORY ---- */}
          {tab === "consumption" && (() => {
            const mixed = consChart.uoms.length > 1;
            const uom = consChart.uoms[0] || "EA";
            const closedTotal = consumption.reduce((a, c) => a + c.sum, 0);
            const unplanned = consumption.reduce((a, c) => a + c.unplannedSum, 0);
            const share = closedTotal > 0 ? Math.round((unplanned / closedTotal) * 1000) / 10 : 0;
            const idle = consumption.filter((c) => c.idle >= 3).length;

            return (
              <>
                <div className="crc-panel">
                  <div className="crc-panel-head">
                    <span>What has actually been issued over the last twelve months</span>
                    <span className="crc-head-right">
                      <span className={consumption.filter((c) => c.status !== "ok").length ? "crc-panel-flag" : "crc-panel-ok"}>
                        {consumption.length} material{consumption.length === 1 ? "" : "s"} with history
                      </span>
                    </span>
                  </div>

                  <div className="crc-consfilters">
                    <label className="crc-pickfield">
                      <span className="crc-pickfield-l">Plant</span>
                      <select className="crc-addso" value={consPlantSel} onChange={(e) => setConsPlantSel(e.target.value)}>
                        <option value="">All plants</option>
                        {PLANTS.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}
                      </select>
                    </label>

                    <label className="crc-pickfield">
                      <span className="crc-pickfield-l">Materials</span>
                      <button
                        className="crc-btn crc-btn-light"
                        onClick={() => openF4(
                          { mode: "multi", plant: consPlantSel, initial: consMatSel, title: "Materials to chart" },
                          (codes) => setConsMatSel(codes)
                        )}
                      >
                        {consMatSel.length ? `${consMatSel.length} selected` : "All materials"}
                        <kbd className="crc-kbd2">F4</kbd>
                      </button>
                    </label>

                    {consMatSel.length > 0 && (
                      <button className="crc-linkbtn" onClick={() => setConsMatSel([])}>show all materials</button>
                    )}
                    <span className="crc-consfilters-note">
                      {consPlantSel ? `plant ${consPlantSel}` : "every plant"} · {consMatSel.length ? `${consMatSel.length} chosen material${consMatSel.length === 1 ? "" : "s"}` : "every material with history"}
                    </span>
                  </div>

                  {consumption.length === 0 ? (
                    <div className="crc-empty"><p>Nothing in this filter has consumption history recorded.</p></div>
                  ) : (
                    <>
                      <div className="crc-postats">
                        {[
                          [fmtQty(r3(closedTotal), mixed ? "" : uom), `issued in 11 closed months${mixed ? ", mixed units" : `, ${uom}`}`],
                          [`${share}%`, "issued with no order behind it"],
                          [consumption.filter((c) => c.exposed).length, "with less cover than their lead time"],
                          [idle, "not issued for 3 months or more"],
                        ].map(([v, k], i) => (
                          <div key={i} className="crc-postat">
                            <div className="crc-postat-v">{v}</div>
                            <div className="crc-postat-k">{k}</div>
                          </div>
                        ))}
                      </div>

                      <div className="crc-chart">
                        <div className="crc-chart-head">
                          <h4>Monthly issues<span className="crc-head-sub">last 12 months, oldest first</span></h4>
                          <p>
                            Each bar is one month of goods issues for the materials in the filter. The amber part had
                            no production order behind it. The final bar is the month in progress, so it is short by
                            construction and is left out of the averages.
                          </p>
                        </div>
                        <ConsumptionBars months={consChart.months} uom={uom} mixed={mixed} />
                        <div className="crc-key">
                          <span><i style={{ background: "var(--signal)" }} />Issued against an order</span>
                          <span><i style={{ background: "var(--caution)" }} />Issued with no order</span>
                          <span><i style={{ background: "var(--mark-2)" }} />Month in progress</span>
                        </div>
                        {mixed && (
                          <div className="crc-chart-read">
                            The filter spans {consChart.uoms.join(", ")}, so the bars add quantities in different units.
                            Read the shape rather than the height, or narrow the filter to one material for a figure
                            that means something.
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {consumption.length > 0 && (
                  <div className="crc-panel crc-panel-top">
                    <div className="crc-panel-head">
                      <span>Material by material, with the twelve month shape and what it implies</span>
                    </div>
                    <div className="crc-tablewrap">
                      <table className="crc-table">
                        <thead>
                          <tr>
                            <th className="crc-th-mat">Material</th>
                            <th>Plant</th>
                            <th className="crc-th-spark">Last 12 months</th>
                            <th className="crc-num">Monthly average</th>
                            <th className="crc-num">Peak</th>
                            <th className="crc-num">Unplanned</th>
                            <th className="crc-num">Trend</th>
                            <th className="crc-num">Cover</th>
                            <th className="crc-th-act2">Reading</th>
                          </tr>
                        </thead>
                        <tbody>
                          {consumption.map((c) => (
                            <tr key={c.key} className={c.status === "late" ? "crc-tr-short" : ""}>
                              <td className="crc-th-mat">
                                <div className="crc-matcode">{c.mat}</div>
                                <div className="crc-matdesc">{c.desc}</div>
                              </td>
                              <td className="crc-mono">{c.plant}</td>
                              <td className="crc-th-spark">
                                <Sparkline values={c.periods.map((p) => p.total)} />
                              </td>
                              <td className="crc-num">{fmtQty(c.avg, c.uom)} <span className="crc-uom">{c.uom}</span></td>
                              <td className="crc-num">{fmtQty(c.peak, c.uom)}</td>
                              <td className={`crc-num ${c.unplannedShare >= 8 ? "crc-excl" : ""}`}>
                                {c.unplannedShare > 0 ? `${c.unplannedShare}%` : <span className="crc-dim">—</span>}
                              </td>
                              <td className={`crc-num ${c.trend === null ? "crc-dim" : c.trend >= 25 ? "crc-excl" : c.trend <= -25 ? "crc-num-short" : ""}`}>
                                {c.trend === null ? "—" : `${c.trend > 0 ? "+" : ""}${c.trend}%`}
                              </td>
                              <td className={`crc-num ${c.exposed ? "crc-num-short" : ""}`}>
                                {c.coverDays === null ? <span className="crc-dim">—</span> : `${c.coverDays} d`}
                              </td>
                              <td className="crc-th-act2">
                                <StatusTag status={c.status === "ok" ? "ok" : c.status === "risk" ? "coverable" : "late"} />
                                <div className="crc-actionline">
                                  {c.flags.length ? c.flags[0].text : "Usage is steady and covered against its lead time."}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="crc-legend">
                      Averages and trend use the eleven closed months; the month in progress is excluded so a
                      part-month does not drag the rate down. Cover is issuable stock divided by the average daily
                      run rate, measured against the material's lead time.
                    </div>
                  </div>
                )}
              </>
            );
          })()}

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
                    <table className="crc-table crc-bold-data">
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
                    <div className="crc-report-t">{APP_NAME} — component readiness and capacity report</div>
                    <div className="crc-report-s">
                      Plant{programme.plants.length > 1 ? "s" : ""} {programme.plants.join(", ")} ·
                      {" "}{programme.lines.length} planning line{programme.lines.length === 1 ? "" : "s"} ·
                      {" "}horizon {weeks.length} weeks to {fmtDateLong(weeks[weeks.length - 1].to)}
                    </div>
                    <div className="crc-report-s">Generated {fmtDateLong(t0)}</div>
                  </div>
                  <div className="crc-report-actions">
                      <button className="crc-btn" onClick={() => setExportOpen(true)}>Export…</button>
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
                    <span className="crc-sevcounts">
                      {[["critical", "Act today", "stop"], ["warning", "This week", "caution"], ["watch", "Watch", "signal"]].map(([k, label, tone]) => {
                        const n = summary.issues.filter((x) => x.sev === k).length;
                        return (
                          <span key={k} className={n ? `crc-sevcount crc-sevcount-${tone}` : "crc-sevcount crc-sevcount-off"}>
                            <b>{n}</b> {label}
                          </span>
                        );
                      })}
                    </span>
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

/* Every colour in this sheet resolves through a token below, which is what makes
   the dark theme a palette swap rather than a second stylesheet. Two pairs are
   deliberately not inverted: --head-bg is the masthead and rail, which stay the
   darkest surface in both themes, and --invert-bg / --invert-ink are the dark
   chips (primary buttons, the active tab, the scroll-to-top control). */
.crc-root{
  color-scheme:light;
  --paper:#E6EBF0; --panel:#FFFFFF; --panel-2:#F7F9FB;
  --tint:#F4F7F9; --tint2:#FBFCFD; --track:#E7ECEF; --neutral-bg:#EFF1F3;
  --ink:#14212A; --ink2:#4C606D; --ink3:#647887;
  --rule:#C2CDD6; --rule-soft:#E1E7EC;
  --go:#1B6E4C; --go-bg:#E0EDE6;
  --caution:#96600A; --caution-bg:#FAEBD3;
  --stop:#A32D1B; --stop-bg:#F7E0DB;
  --signal:#235A8C; --signal-bg:#E1EAF3;
  --brass:#C0803A; --brass-bg:#F7EDDF;

  --head-bg:#14212A;
  --head-ink:#E7EDF2; --head-ink2:#A6B8C4; --head-ink3:#8DA2B0;
  --rail-ink:#AFC0CD; --rail-ink2:#8FA5B3; --rail-ink3:#6E8494;
  --invert-bg:#14212A; --invert-ink:#FFFFFF; --ink-hover:#0F1A22;
  --go-lamp:#3FA377; --caution-lamp:#D89A2E; --stop-lamp:#D9563E;
  --go-word:#7FD1AC; --caution-word:#F0BE6A; --stop-word:#F09A85;
  --stop-soft:#FDF6F4; --stop-ink:#8C2717;
  --caution-soft:#FFFCF6; --caution-ink:#7A4D04;
  --caution-row:#FEFBF5; --caution-row2:#FBF4E8;
  --signal-ink:#26527D; --teal-ink:#16706B;
  --brass-ink:#1A1206; --brass-ink2:#7A4E12; --brass-bg2:#F3E5D2; --brass-rule:#F0E4CE;
  --badge-bg:#7A1E10;
  --gap-a:#F0D9D3; --gap-b:#F8E9E5;
  --grid:rgba(20,33,42,.030);
  /* white wherever the surface is dark in both themes: the rail, the alert badge */
  --on-dark:#FFFFFF; --sticky-bg:rgba(255,255,255,.92);

  /* chart marks: series colours and the fixed roles on the timeline charts */
  --seq-1:#2C5D8F; --seq-2:#1F7A54; --seq-3:#A96A05;
  --seq-4:#16706B; --seq-5:#7A4E6E; --seq-6:#7C97AC;
  --mark-1:#7C97AC; --mark-2:#A9BCC9; --mark-3:#B4C6D2; --mark-4:#8FA8C0;
  --mark-run:#C6813A; --mark-green:#8FBFA6; --mark-green2:#4E8C6E; --mark-rust:#9C4A22;

  font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  color:var(--ink);
  /* engineering paper: a printed grid, barely there */
  background:
    linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 24px,
    linear-gradient(90deg, var(--grid) 1px, transparent 1px) 0 0 / 24px 100%,
    var(--paper);
  min-height:100vh; font-size:13px; line-height:1.5;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}

/* Dark is a working shop-floor theme, not an inversion: surfaces stay blue-grey
   rather than black so the status colours keep their meaning, and the semantic
   tints go dark-with-bright-text instead of pale-with-dark-text. */
.crc-root[data-theme="dark"]{
  color-scheme:dark;
  --paper:#0E161C; --panel:#17222B; --panel-2:#1C2933;
  --tint:#22303B; --tint2:#1B2831; --track:#2A3945; --neutral-bg:#28363F;
  --ink:#E3EBF1; --ink2:#A9BDC9; --ink3:#8398A6;
  --rule:#33454F; --rule-soft:#26343D;
  --go:#5CC08D; --go-bg:#122C22;
  --caution:#E0A63C; --caution-bg:#33280F;
  --stop:#EE7A63; --stop-bg:#3A1D18;
  --signal:#6FA9DC; --signal-bg:#14293C;
  --brass:#D09B54; --brass-bg:#302410;

  --head-bg:#0A1015;
  --invert-bg:#354A59; --invert-ink:#EDF3F7; --ink-hover:#41586A;
  --stop-soft:#2A1714; --stop-ink:#F0A08C;
  --caution-soft:#2A2210; --caution-ink:#E8B75E;
  --caution-row:#26200E; --caution-row2:#332A14;
  --signal-ink:#8FBEE8; --teal-ink:#5FBFB8;
  --brass-ink:#1A1206; --brass-ink2:#E5C089; --brass-bg2:#3A2C14; --brass-rule:#4A3A1C;
  --gap-a:#3A211C; --gap-b:#2E1A16;
  --grid:rgba(255,255,255,.026);
  --sticky-bg:rgba(23,34,43,.93);

  /* The pale slate marks already read on a dark panel and keep their relative
     weight, so only the ones that were dark enough to disappear are lifted. */
  --seq-1:#6C9FD4; --seq-2:#58B487; --seq-3:#D9A24A;
  --seq-4:#4FB3AC; --seq-5:#C08AAE; --seq-6:#9FB6C7;
  --mark-green2:#6FB894; --mark-rust:#D2764A;
}
.crc-root *{box-sizing:border-box;}
.crc-root h3,.crc-root h4{margin:0;font-weight:600;}
.crc-root p{margin:0;}
.crc-mono,.crc-num{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;}
.crc-root button:focus-visible,.crc-root input:focus-visible,.crc-root select:focus-visible,
.crc-root a:focus-visible{outline:2px solid var(--brass); outline-offset:2px; border-radius:2px;}
@media(prefers-reduced-motion:reduce){.crc-root *{transition:none!important;animation:none!important;}}

/* ---- header: the state masthead is where the boldness goes ---- */
.crc-header{background:var(--head-bg);color:var(--head-ink);
  box-shadow:inset 0 -1px 0 rgba(255,255,255,.07), 0 1px 0 rgba(20,33,42,.18);}
.crc-header-in{max-width:1460px;margin:0 auto;padding:20px 26px 18px;display:flex;
  align-items:center;justify-content:space-between;gap:28px;flex-wrap:wrap;}
.crc-brand{display:flex;align-items:center;gap:15px;flex:none;}
.crc-brand-name{font-size:20px;font-weight:600;letter-spacing:-0.014em;line-height:1.2;}

/* ---- InfraBeat wordmark ----
   Brand colours are fixed, so the mark keeps its own white plate rather than
   inheriting the masthead. That holds in both themes and in print. The plate is
   sized to read as the identity of the page, not as a favicon next to a title. */
.crc-logo{display:inline-flex;align-items:center;background:#FFFFFF;border-radius:4px;
  padding:10px 15px;flex:none;font-weight:700;font-size:24px;letter-spacing:-0.022em;line-height:1;
  box-shadow:0 1px 2px rgba(0,0,0,.28), 0 0 0 1px rgba(255,255,255,.14);}
.crc-logo-a{color:#1B9DD9;}
.crc-logo-b{color:#E1251B;}
.crc-logo-img{height:48px;width:auto;display:block;background:#FFFFFF;border-radius:4px;
  padding:7px 11px;flex:none;box-shadow:0 1px 2px rgba(0,0,0,.28), 0 0 0 1px rgba(255,255,255,.14);}
@media(max-width:640px){
  .crc-logo{font-size:19px;padding:8px 12px;}
  .crc-logo-img{height:38px;}
  .crc-brand-name{font-size:17px;}
}

/* ---- header tools ---- */
.crc-headtools{display:flex;align-items:center;gap:8px;flex:none;order:3;}
.crc-themebtn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;
  font-size:15px;color:var(--head-ink);background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.14);border-radius:3px;cursor:pointer;line-height:1;}
.crc-themebtn:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.24);}
.crc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}

.crc-brand-sub{font-size:12.5px;color:var(--head-ink3);margin-top:3px;}

.crc-state{display:flex;align-items:center;gap:20px;flex:1 1 520px;min-width:0;
  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);
  border-left:4px solid var(--ink3);border-radius:3px;padding:10px 16px;}
.crc-state-release{border-left-color:var(--go);}
.crc-state-coverable{border-left-color:var(--caution);}
.crc-state-blocked{border-left-color:var(--stop);}
.crc-state-lamp{width:9px;height:9px;border-radius:50%;flex:none;background:var(--ink3);
  box-shadow:0 0 0 3px rgba(255,255,255,.07);}
.crc-state-release .crc-state-lamp{background:var(--go-lamp);box-shadow:0 0 0 3px rgba(63,163,119,.22);}
.crc-state-coverable .crc-state-lamp{background:var(--caution-lamp);box-shadow:0 0 0 3px rgba(216,154,46,.22);}
.crc-state-blocked .crc-state-lamp{background:var(--stop-lamp);box-shadow:0 0 0 3px rgba(217,86,62,.22);
  animation:crc-pulse 2.6s ease-in-out infinite;}
@keyframes crc-pulse{0%,100%{box-shadow:0 0 0 3px rgba(217,86,62,.22);}50%{box-shadow:0 0 0 6px rgba(217,86,62,.05);}}
.crc-state-body{min-width:0;flex:1 1 auto;}
.crc-state-word{font-size:19px;font-weight:600;letter-spacing:-0.015em;line-height:1.15;}
.crc-state-release .crc-state-word{color:var(--go-word);}
.crc-state-coverable .crc-state-word{color:var(--caution-word);}
.crc-state-blocked .crc-state-word{color:var(--stop-word);}
.crc-state-line{font-size:12px;color:var(--head-ink2);margin-top:2px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.crc-state-figs{display:flex;gap:22px;flex:none;}
.crc-state-v{display:block;font-family:'IBM Plex Mono',monospace;font-size:19px;font-weight:600;
  font-variant-numeric:tabular-nums;letter-spacing:-0.02em;color:var(--head-ink);line-height:1.15;}
.crc-state-v em{font-style:normal;font-size:13px;font-weight:400;color:var(--head-ink3);}
.crc-state-k{display:block;font-size:10.5px;color:var(--head-ink3);margin-top:2px;}

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
  width:100%;padding:7px 8px;border:1px solid var(--rule);border-radius:2px;background:var(--panel);
  font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--ink);}
.crc-field select{font-family:'IBM Plex Sans',sans-serif;}
.crc-field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;}

.crc-slocs{display:flex;flex-direction:column;gap:2px;}
.crc-sloc{padding:8px;border:1px solid var(--rule-soft);border-radius:2px;background:var(--panel);}
.crc-sloc-off{background:var(--tint);border-style:dashed;}
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
.crc-seg-btn{flex:1;background:var(--panel);border:0;border-right:1px solid var(--rule);padding:6px 4px;
  font-family:inherit;font-size:11.5px;color:var(--ink2);cursor:pointer;line-height:1.3;}
.crc-seg-btn:last-child{border-right:0;}
.crc-seg-btn:hover{background:var(--tint);}
.crc-seg-on{background:var(--invert-bg);color:var(--invert-ink);font-weight:500;}
.crc-seg-on:hover{background:var(--invert-bg);}
.crc-rule-echo{margin-top:6px;font-size:11.5px;color:var(--ink3);line-height:1.45;}

.crc-subhead{padding:14px 16px 8px;font-size:12px;font-weight:600;
  border-bottom:1px solid var(--rule-soft);}
.crc-tr-muted td{opacity:.5;}
.crc-resv{color:var(--caution);}
.crc-inbound{color:var(--signal);}
.crc-tag-neutral{background:var(--neutral-bg);color:var(--ink2);}

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

.crc-cbar{width:76px;height:7px;background:var(--track);border-radius:1px;overflow:hidden;}
.crc-cbar-fill{height:100%;border-radius:1px;}
.crc-th-cov{width:88px;}
/* wide enough that "see components below" sits on one or two lines rather than
   three, which is what was making these rows so tall */
.crc-th-covby{min-width:132px;}

.crc-strip{margin-top:14px;}
.crc-strip-bar{display:flex;height:7px;border-radius:1px;overflow:hidden;background:var(--track);}
.crc-strip-seg{height:100%;}
.crc-strip-key{display:flex;flex-wrap:wrap;gap:14px;margin-top:7px;font-size:11.5px;color:var(--ink2);}
.crc-strip-key span{display:flex;align-items:center;gap:5px;}
.crc-strip-key i{width:9px;height:9px;border-radius:1px;display:block;}

.crc-sfbars{display:flex;flex-direction:column;gap:7px;}
.crc-sfrow{display:grid;grid-template-columns:132px minmax(0,1fr) 42px 122px;gap:11px;align-items:center;}
.crc-sf-code{font-family:'IBM Plex Mono',monospace;font-size:12px;}
.crc-sf-track{height:11px;background:var(--track);border-radius:1px;overflow:hidden;}
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
  border:1px solid var(--rule-soft);border-left-width:3px;border-radius:2px;padding:9px 12px;background:var(--panel);}
.crc-t-ok{border-left-color:var(--go);}
.crc-t-coverable{border-left-color:var(--caution);}
.crc-t-late{border-left-color:var(--stop);}
.crc-t-assembly{border-left-color:var(--signal);background:var(--tint2);}
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
  .crc-state-line{color:var(--ink)!important;}
  .crc-state{background:none;border-color:var(--rule);}
  .crc-root{background:#fff!important;}
  .crc-panel,.crc-programme,.crc-section{box-shadow:none;}
  .crc-shell{display:block;padding:0;max-width:none;}
  .crc-controls,.crc-tabs,.crc-btn,.crc-rail,.crc-sumbtn,.crc-report-actions,
  .crc-headtools{display:none!important;}
  .crc-logo{box-shadow:none;border:1px solid var(--rule);}
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
.crc-report-lines th{background:var(--tint);}
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
.crc-spark{background:var(--panel);border:0;border-left:3px solid transparent;padding:11px 13px;
  font-family:inherit;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:6px;}
.crc-spark:hover{background:var(--tint);}
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
.crc-jump{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:var(--sticky-bg);
  backdrop-filter:blur(6px);border:1px solid var(--rule);border-radius:3px;padding:8px 12px;
  margin-bottom:16px;position:sticky;top:8px;z-index:20;box-shadow:0 1px 3px rgba(20,33,42,.07);}
.crc-jump-l{font-size:11px;color:var(--ink3);margin-right:4px;}
.crc-jumpbtn{background:var(--tint);border:1px solid var(--rule-soft);border-radius:2px;padding:4px 10px;
  font-family:inherit;font-size:12px;color:var(--ink2);cursor:pointer;display:flex;align-items:center;gap:6px;}
.crc-jumpbtn:hover{background:var(--brass-bg);color:var(--brass-ink2);border-color:var(--brass);}
.crc-jumpcount{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ink3);}
.crc-totop{position:fixed;right:22px;bottom:22px;z-index:40;background:var(--invert-bg);color:var(--invert-ink);
  border:0;border-radius:3px;padding:9px 13px;font-family:inherit;font-size:12px;cursor:pointer;
  display:flex;align-items:center;gap:7px;box-shadow:0 3px 12px rgba(27,42,51,.28);}
.crc-totop:hover{background:var(--ink-hover);}
@media print{.crc-jump,.crc-totop{display:none!important;}}
.crc-sumbtn{background:var(--brass);color:var(--brass-ink);border:1px solid var(--brass);border-radius:2px;
  padding:8px 14px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;
  display:flex;align-items:center;gap:8px;flex:none;transition:filter .12s ease;}
.crc-sumbtn:hover{filter:brightness(1.08);}
.crc-sumbtn-alert{box-shadow:0 0 0 3px rgba(192,128,58,.22);}
.crc-sumbadge{background:var(--badge-bg);color:var(--on-dark);border-radius:2px;padding:1px 6px;
  font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;}
.crc-sumgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));}
.crc-sumstat{text-align:left;background:var(--panel);border:0;border-right:1px solid var(--rule-soft);
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
.crc-issue-critical{border-left-color:var(--stop);background:var(--stop-soft);}
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
  background:var(--tint2);max-width:96ch;}
.crc-flag-stop{border-left-color:var(--stop);background:var(--stop-soft);color:var(--stop-ink);}
.crc-flag-caution{border-left-color:var(--caution);background:var(--caution-soft);color:var(--caution-ink);}
.crc-flag-signal{border-left-color:var(--signal);background:var(--signal-bg);color:var(--signal-ink);}
.crc-prog-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.crc-addso{border:1px solid var(--rule);border-radius:2px;background:var(--panel);padding:8px 10px;
  font-family:inherit;font-size:12.5px;color:var(--ink);max-width:290px;}

/* choosing what the run plans: a plant, then any number of materials at it */
.crc-pickfield{display:flex;align-items:center;gap:7px;}
.crc-pickfield-l{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);}
.crc-btn-open{border-color:var(--brass);box-shadow:inset 0 -2px 0 var(--brass);}
.crc-matpick{border-top:1px solid var(--rule);background:var(--panel-2);padding:13px 16px 15px;}
.crc-matpick-head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:baseline;
  font-size:12px;color:var(--ink2);max-width:none;}
.crc-matpick-head .crc-head-right{display:flex;gap:12px;align-items:baseline;}
.crc-sevcounts{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.crc-sevcount{font-size:11px;padding:3px 9px;border-radius:2px;border:1px solid var(--rule-soft);
  background:var(--panel-2);color:var(--ink2);}
.crc-sevcount b{font-family:'IBM Plex Mono',monospace;font-size:12.5px;font-weight:600;margin-right:3px;}
.crc-sevcount-stop{background:var(--stop-bg);border-color:var(--stop);color:var(--stop);}
.crc-sevcount-caution{background:var(--caution-bg);border-color:var(--caution);color:var(--caution);}
.crc-sevcount-signal{background:var(--signal-bg);border-color:var(--signal);color:var(--signal);}
.crc-sevcount-off{opacity:.6;}
/* ---- the printable export ---- */
.crc-printdoc{display:none;}
.crc-pd-t{font-size:17px;font-weight:600;margin:0 0 10px;}
.crc-pd-meta{border-collapse:collapse;margin-bottom:18px;font-size:11px;}
.crc-pd-meta th{text-align:left;padding:2px 14px 2px 0;color:var(--ink3);font-weight:600;
  white-space:nowrap;vertical-align:top;}
.crc-pd-meta td{padding:2px 0;}
.crc-pd-sec{margin-bottom:22px;break-inside:auto;}
.crc-pd-h{font-size:13px;font-weight:600;margin:0 0 6px;border-bottom:1.5px solid var(--ink);
  padding-bottom:3px;display:flex;justify-content:space-between;align-items:baseline;}
.crc-pd-h span{font-size:10px;font-weight:400;color:var(--ink3);}
.crc-pd-table{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed;}
.crc-pd-table th{text-align:left;background:#EEF2F5;border:1px solid #B9C6D0;padding:3px 4px;
  font-weight:600;word-wrap:break-word;}
.crc-pd-table td{border:1px solid #D4DDE4;padding:3px 4px;vertical-align:top;word-wrap:break-word;}
.crc-pd-table tr{break-inside:avoid;}
@media print{
  .crc-printing .crc-header,
  .crc-printing .crc-shell,
  .crc-printing .crc-totop{display:none!important;}
  .crc-printing .crc-printdoc{display:block;}
  .crc-pd-sec{break-before:page;}
  .crc-pd-sec:first-of-type{break-before:auto;}
}

/* ---- export dialog ---- */
.crc-exp{max-width:1040px;}
.crc-exp-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px;padding:16px;}
@media(max-width:860px){.crc-exp-grid{grid-template-columns:1fr;}}
.crc-exp-t{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;
  color:var(--ink3);margin-bottom:7px;}
.crc-exp-t2{margin-top:18px;}
.crc-exp-secs{display:flex;flex-direction:column;gap:1px;}
.crc-exp-field{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:10px;}
.crc-exp-chips{display:flex;gap:5px;align-items:center;flex-wrap:wrap;}
.crc-exp-chip{flex:none;border:1px solid var(--rule);border-radius:2px;padding:5px 11px;}
.crc-exp-to{font-size:11px;color:var(--ink3);}
.crc-exp-note{font-size:11px;color:var(--ink3);line-height:1.5;max-width:52ch;margin-top:2px;}
.crc-exp-formats{display:flex;flex-direction:column;gap:1px;}
.crc-exp-fmt-on{background:var(--signal-bg);border-color:var(--signal)!important;}
.crc-exp-err{margin:0 16px 14px;padding:10px 12px;border-left:3px solid var(--stop);
  background:var(--stop-soft);color:var(--stop-ink);font-size:12.5px;}

/* ---- capacity heatmap ---- */
.crc-heat{padding:2px 0 4px;}
.crc-heat-grid{display:grid;gap:2px;align-items:stretch;overflow-x:auto;}
.crc-heat-h{font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;
  color:var(--ink3);padding:0 4px 5px;align-self:end;}
.crc-heat-hc{text-align:center;}
.crc-heat-n{display:flex;flex-direction:column;justify-content:center;padding:4px 8px 4px 2px;
  font-size:12px;min-width:0;}
.crc-heat-n .crc-mono{font-size:11.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.crc-heat-sub{font-size:10px;color:var(--ink3);margin-top:1px;}
.crc-heat-off{opacity:.55;}
.crc-heat-c{display:flex;align-items:center;justify-content:center;min-height:26px;border-radius:2px;
  font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-variant-numeric:tabular-nums;}
.crc-heat-idle{background:var(--track);color:transparent;}
.crc-heat-na{background:repeating-linear-gradient(45deg,var(--track),var(--track) 3px,var(--panel) 3px,var(--panel) 6px);}
.crc-heat-easy{background:var(--go-bg);color:var(--go);}
.crc-heat-busy{background:var(--caution-bg);color:var(--caution);}
.crc-heat-tight{background:var(--brass-bg2);color:var(--brass-ink2);font-weight:600;}
.crc-heat-over{background:var(--stop-bg);color:var(--stop);font-weight:600;}
.crc-heat-peak{display:flex;align-items:center;gap:6px;padding-left:6px;}
.crc-heat-bar{flex:1;height:8px;background:var(--track);border-radius:1px;overflow:hidden;min-width:24px;}
.crc-heat-fill{display:block;height:8px;}
.crc-heat-pk{font-family:'IBM Plex Mono',monospace;font-size:10.5px;white-space:nowrap;}
.crc-heat-sw{width:11px;height:11px;border-radius:2px;display:inline-block;}

/* ---- a table asked to read louder than the rest ---- */
.crc-bold-data tbody td{font-weight:600;color:var(--ink);}
.crc-bold-data tbody td .crc-matdesc,
.crc-bold-data tbody td .crc-dim,
.crc-bold-data tbody td.crc-dim{font-weight:400;}

/* ---- consumption history ---- */
.crc-consfilters{display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:13px 16px;
  border-bottom:1px solid var(--rule-soft);background:var(--panel-2);}
.crc-consfilters-note{font-size:11px;color:var(--ink3);margin-left:auto;}
.crc-th-spark{width:124px;}
.crc-spark-svg{width:108px;height:26px;display:block;}

/* ---- F4 material search ---- */
.crc-kbd2{font-family:'IBM Plex Mono',monospace;font-size:9.5px;font-weight:600;padding:1px 4px;
  border-radius:2px;background:var(--neutral-bg);border:1px solid var(--rule-soft);
  color:var(--ink3);margin-left:7px;letter-spacing:.02em;}
.crc-f4wrap{position:fixed;inset:0;z-index:90;background:rgba(10,16,21,.55);
  display:flex;align-items:flex-start;justify-content:center;padding:7vh 16px 16px;}
.crc-f4{width:100%;max-width:920px;background:var(--panel);border:1px solid var(--rule);
  border-radius:4px;box-shadow:0 18px 50px rgba(10,16,21,.4);display:flex;flex-direction:column;
  max-height:82vh;overflow:hidden;}
.crc-f4-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;
  padding:14px 16px 12px;border-bottom:1px solid var(--rule-soft);}
.crc-f4-t{font-size:15px;font-weight:600;}
.crc-f4-s{font-size:12px;color:var(--ink2);margin-top:3px;max-width:76ch;}
.crc-f4-x{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ink3);
  background:var(--tint);border:1px solid var(--rule-soft);border-radius:2px;padding:3px 7px;
  cursor:pointer;flex:none;}
.crc-f4-x:hover{color:var(--ink);border-color:var(--rule);}
.crc-f4-filters{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:11px 16px;
  border-bottom:1px solid var(--rule-soft);background:var(--panel-2);}
.crc-f4-q{flex:1 1 300px;max-width:400px;border:1px solid var(--rule);border-radius:2px;
  background:var(--panel);padding:8px 10px;font-family:'IBM Plex Mono',monospace;font-size:12.5px;color:var(--ink);}
.crc-f4-q:focus{border-color:var(--signal);outline:none;box-shadow:0 0 0 2px var(--signal-bg);}
.crc-f4-q::placeholder{font-family:'IBM Plex Sans',sans-serif;color:var(--ink3);}
.crc-f4-count{font-size:11px;color:var(--ink3);margin-left:auto;}
.crc-f4-body{overflow-y:auto;flex:1;}
.crc-f4-table th{position:sticky;top:0;z-index:2;}
.crc-f4-none{padding:20px 16px;font-size:13px;color:var(--ink2);}
.crc-f4-foot{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:10px 16px;
  border-top:1px solid var(--rule-soft);background:var(--panel-2);font-size:11px;color:var(--ink3);}
.crc-f4-foot-r{margin-left:auto;display:flex;gap:12px;align-items:center;}
@media print{.crc-f4wrap{display:none!important;}}

.crc-matpick-search{display:flex;align-items:center;gap:12px;margin-top:11px;flex-wrap:wrap;}
.crc-matpick-q{flex:1 1 320px;max-width:420px;border:1px solid var(--rule);border-radius:2px;
  background:var(--panel);padding:8px 10px;font-family:'IBM Plex Mono',monospace;font-size:12.5px;
  color:var(--ink);}
.crc-matpick-q:focus{border-color:var(--signal);outline:none;box-shadow:0 0 0 2px var(--signal-bg);}
.crc-matpick-q::placeholder{font-family:'IBM Plex Sans',sans-serif;color:var(--ink3);}
.crc-matpick-count{font-size:11px;color:var(--ink3);}
.crc-matpick-none{margin-top:12px;font-size:12.5px;color:var(--ink2);}
.crc-matpick-group{margin-top:12px;}
.crc-matpick-t{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;
  color:var(--ink3);margin-bottom:6px;}
.crc-matpick-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:2px 14px;}
.crc-matpick-i{display:flex;gap:8px;align-items:flex-start;padding:5px 7px;border-radius:2px;
  cursor:pointer;border:1px solid transparent;}
.crc-matpick-i:hover{background:var(--tint);border-color:var(--rule-soft);}
.crc-matpick-i input{margin-top:2px;flex:none;}
.crc-matpick-i .crc-matdesc{margin-top:1px;}
.crc-matpick-in{opacity:.55;cursor:not-allowed;}
.crc-matpick-in:hover{background:transparent;border-color:transparent;}
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
.crc-rail{background:var(--head-bg);border-radius:3px;padding:8px 0 4px;position:sticky;top:16px;
  align-self:start;overflow:hidden;box-shadow:0 1px 3px rgba(20,33,42,.16);}
@media(max-width:1000px){.crc-rail{position:static;}}
.crc-railgroup{padding-bottom:8px;}
.crc-railgroup-t{padding:10px 14px 5px;font-size:10px;color:var(--rail-ink3);letter-spacing:.06em;
  text-transform:none;font-weight:500;}
.crc-railbtn{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;
  padding:7px 14px;background:none;border:0;border-left:3px solid transparent;
  font-family:inherit;font-size:12.5px;color:var(--rail-ink);cursor:pointer;text-align:left;
  transition:color .12s ease,background .12s ease;}
.crc-railbtn:hover{color:var(--on-dark);background:rgba(255,255,255,.05);}
.crc-railbtn-on{color:var(--on-dark);background:rgba(192,128,58,.13);border-left-color:var(--brass);font-weight:500;}
.crc-railcount{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--rail-ink2);
  background:rgba(0,0,0,.28);padding:1px 5px;border-radius:2px;min-width:18px;text-align:center;}
.crc-railbtn-on .crc-railcount{background:var(--brass);color:var(--brass-ink);font-weight:600;}
.crc-railfoot{padding:11px 14px;margin-top:4px;border-top:1px solid rgba(255,255,255,.09);
  font-size:10.5px;color:var(--rail-ink3);line-height:1.5;}

/* ---- context strip ---- */
.crc-ctx{background:var(--panel);border:1px solid var(--rule);border-left-width:5px;border-radius:3px;
  margin-bottom:16px;padding:9px 14px;display:flex;justify-content:space-between;
  align-items:center;gap:18px;flex-wrap:wrap;}
.crc-ctx-go{border-left-color:var(--go);} .crc-ctx-caution{border-left-color:var(--caution);}
.crc-ctx-stop{border-left-color:var(--stop);}
.crc-ctx-lines{display:flex;gap:5px;flex-wrap:wrap;}
.crc-ctxbtn{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:4px 9px;
  font-family:inherit;font-size:12px;color:var(--ink2);cursor:pointer;display:flex;align-items:baseline;gap:6px;}
.crc-ctxbtn:hover{background:var(--tint);}
.crc-ctxbtn-on{background:var(--invert-bg);color:var(--invert-ink);border-color:var(--invert-bg);box-shadow:inset 0 -2px 0 var(--brass);}
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
.crc-combo-bad{border-color:var(--stop)!important;background:var(--stop-soft);}
.crc-combo-warn{border-color:var(--caution)!important;background:var(--caution-soft);}
.crc-combo-toggle{position:absolute;right:3px;top:4px;width:17px;height:19px;border:0;background:none;
  color:var(--ink3);font-size:10px;cursor:pointer;padding:0;line-height:1;}
.crc-combo-list{position:absolute;z-index:20;top:100%;left:0;min-width:330px;margin:2px 0 0;padding:3px;
  list-style:none;background:var(--panel);border:1px solid var(--rule);border-radius:2px;
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

/* ---- production version ---- */
.crc-pv{border-bottom:1px solid var(--rule);background:var(--tint2);}
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
  border-left:3px solid var(--caution);font-size:12.5px;color:var(--caution-ink);line-height:1.5;}
.crc-pvtable{border-top:1px solid var(--rule-soft);}
.crc-pvtable th{background:var(--tint);}
.crc-pvtable td,.crc-pvtable th{padding:7px 16px;}
.crc-pv-on{background:var(--signal-bg);}
.crc-pv-foot{padding:10px 16px;font-size:12px;color:var(--ink3);border-top:1px solid var(--rule-soft);}
.crc-pvwarn{color:var(--caution);font-weight:700;}
.crc-minibtn{background:var(--invert-bg);color:var(--invert-ink);border:0;border-radius:2px;padding:3px 10px;
  font-family:inherit;font-size:11.5px;cursor:pointer;}
.crc-minibtn:hover{background:var(--ink-hover);}
.crc-linkbtn{background:none;border:0;padding:0;font-family:inherit;font-size:12px;
  color:var(--signal);text-decoration:underline;cursor:pointer;}

/* ---- planning programme ---- */
.crc-programme{background:var(--panel);border:1px solid var(--rule);border-radius:3px;margin-bottom:16px;
  box-shadow:0 1px 2px rgba(20,33,42,.05);}
.crc-prog-head{padding:14px 16px;display:flex;justify-content:space-between;align-items:flex-start;
  gap:18px;border-bottom:1px solid var(--rule-soft);flex-wrap:wrap;}
.crc-prog-head h3{font-size:15px;letter-spacing:-0.012em;}
.crc-prog-head p{font-size:12.5px;color:var(--ink2);margin-top:3px;max-width:70ch;line-height:1.5;}
.crc-btn-light{background:var(--panel);color:var(--ink);border:1px solid var(--rule);}
.crc-btn-light:hover:not(:disabled){background:var(--tint);}
.crc-progtable tbody tr{cursor:pointer;}
.crc-progtable tbody tr.crc-prog-on{background:var(--brass-bg);box-shadow:inset 3px 0 0 var(--brass);}
.crc-progtable tbody tr.crc-prog-on:hover{background:var(--brass-bg2);}
.crc-progtable td{vertical-align:middle;}
.crc-inline{border:1px solid transparent;border-radius:2px;background:transparent;padding:4px 5px;
  font-family:'IBM Plex Sans',sans-serif;font-size:12.5px;color:var(--ink);max-width:250px;width:100%;}
.crc-inline:hover{border-color:var(--rule);background:var(--panel);}
.crc-inline:focus{border-color:var(--signal);background:var(--panel);}
/* The material cell is a text box you can type a code straight into. Left with
   the transparent .crc-inline treatment it read as a static label and nobody
   discovered that, so it carries a visible box and caret at rest. */
input.crc-combo-in{border-color:var(--rule);background:var(--panel);padding:5px 22px 5px 7px;}
input.crc-combo-in:hover{border-color:var(--ink3);}
input.crc-combo-in:focus{border-color:var(--signal);box-shadow:0 0 0 2px var(--signal-bg);}
input.crc-combo-in::placeholder{color:var(--ink3);font-family:'IBM Plex Sans',sans-serif;}
.crc-inline-sm{max-width:132px;font-family:'IBM Plex Mono',monospace;font-size:12px;}
.crc-inline-num{max-width:76px;text-align:right;font-family:'IBM Plex Mono',monospace;
  font-variant-numeric:tabular-nums;font-size:12.5px;}
.crc-th-act{width:96px;}
.crc-acts{display:flex;gap:3px;justify-content:flex-end;}
.crc-iconbtn{width:22px;height:22px;border:1px solid var(--rule);background:var(--panel);border-radius:2px;
  font-family:inherit;font-size:12px;line-height:1;color:var(--ink2);cursor:pointer;padding:0;}
.crc-iconbtn:hover:not(:disabled){background:var(--tint);color:var(--ink);}
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
.crc-cont-bar{display:flex;height:13px;border-radius:1px;overflow:hidden;background:var(--track);margin:14px 0 12px;}
.crc-cont-seg{height:100%;}
.crc-cont-gap{background:repeating-linear-gradient(45deg,var(--gap-a),var(--gap-a) 4px,var(--gap-b) 4px,var(--gap-b) 8px);}
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
.crc-status-neutral{background:var(--neutral-bg);color:var(--ink2);}
.crc-mvt{font-family:'IBM Plex Sans',sans-serif;font-size:10px;font-weight:500;
  padding:0 4px;border-radius:2px;}
.crc-mvt-in{background:var(--go-bg);color:var(--go);}
.crc-mvt-out{background:var(--caution-bg);color:var(--caution);}
.crc-mvt-move{background:var(--signal-bg);color:var(--signal);}
.crc-mvt-plus{color:var(--go);}
.crc-mvt-minus{color:var(--caution);}
.crc-subhead-split{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;}
.crc-seg-4 .crc-seg-btn{padding:6px 2px;font-size:11px;}
.crc-vendorqty{color:var(--teal-ink);}

.crc-switch{display:flex;gap:9px;align-items:flex-start;cursor:pointer;}
.crc-switch input{accent-color:var(--signal);width:15px;height:15px;margin-top:2px;flex:none;}
.crc-switch strong{display:block;font-size:13px;font-weight:600;}
.crc-switch em{display:block;font-style:normal;font-size:12px;color:var(--ink2);margin-top:2px;line-height:1.45;}
.crc-note{margin-top:10px;padding:8px 9px;background:var(--signal-bg);border-left:3px solid var(--signal);
  font-size:12px;color:var(--signal-ink);line-height:1.45;}

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
.crc-panel-ok{color:var(--go);}
/* capacity status column: the pill answers "can I load more onto this centre",
   the note underneath says by how much */
.crc-th-cap{min-width:190px;}
.crc-capnote{display:block;font-size:11px;color:var(--ink3);margin-top:3px;line-height:1.35;}
/* the breakdown that used to be its own columns, folded under the total it belongs to */
.crc-cellsub{font-family:'IBM Plex Sans',sans-serif;font-size:10.5px;font-weight:400;
  color:var(--ink3);margin-top:2px;line-height:1.35;white-space:normal;max-width:26ch;}
.crc-th-act2{min-width:220px;}
.crc-th-when{width:82px;}
.crc-tablewrap{overflow-x:auto;}
.crc-table{width:100%;border-collapse:collapse;font-size:13px;}
.crc-table th{text-align:left;font-weight:600;font-size:10.5px;color:var(--ink3);letter-spacing:.01em;
  padding:9px 11px;border-bottom:1px solid var(--rule);white-space:nowrap;background:var(--panel-2);}
.crc-table td{padding:10px 11px;border-bottom:1px solid var(--rule-soft);vertical-align:top;}
.crc-table tbody tr:last-child td{border-bottom:0;}
.crc-table tbody tr{transition:background .12s ease;}
.crc-table tbody tr:hover{background:var(--panel-2);}
.crc-num{text-align:right;font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;white-space:nowrap;}
/* A bare th selector outranks the .crc-num and .crc-th-count classes on
   specificity, so a numeric heading used to sit left while its column of values
   sat right. These rules put every heading over its own values.
   No backticks in this file's CSS - the whole sheet is a template literal. */
.crc-table th.crc-num{text-align:right;}
.crc-table th.crc-th-count{text-align:center;}
.crc-table td.crc-th-count{text-align:center;}
.crc-th-mat{text-align:left;min-width:230px;}
.crc-th-off{color:var(--ink3);}
.crc-th-sub{display:block;font-weight:400;font-size:10px;color:var(--ink3);margin-top:1px;}
.crc-tr-short{background:var(--caution-row);}
.crc-tr-short:hover{background:var(--caution-row2);}
.crc-matcell{display:flex;gap:7px;align-items:flex-start;}
.crc-branch{width:9px;height:9px;border-left:1px solid var(--rule);border-bottom:1px solid var(--rule);
  margin-top:5px;flex:none;}
.crc-matcode{font-family:'IBM Plex Mono',monospace;font-size:12.5px;font-weight:600;letter-spacing:-.01em;
  display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.crc-matdesc{font-size:11.5px;color:var(--ink3);margin-top:2px;line-height:1.4;}
.crc-proc{font-family:'IBM Plex Sans',sans-serif;font-size:10px;font-weight:500;padding:0 4px;border-radius:2px;}
.crc-proc-E{background:var(--signal-bg);color:var(--signal);}
.crc-proc-F{background:var(--neutral-bg);color:var(--ink2);}
.crc-uom{font-size:11px;color:var(--ink3);}
.crc-strong{font-weight:600;}
.crc-dim{color:var(--ink3);}
.crc-num-short{color:var(--stop);font-weight:600;}
.crc-excl{color:var(--caution);}
.crc-date{color:var(--ink);font-family:'IBM Plex Mono',monospace;font-size:12.5px;}
.crc-date-late{color:var(--stop);font-weight:600;font-family:'IBM Plex Mono',monospace;font-size:12.5px;}
.crc-cell-off{background:var(--tint);color:var(--ink3);}
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
.crc-short-head:hover{background:var(--tint2);}
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
.crc-short-body{padding:4px 16px 20px 20px;background:var(--tint2);border-top:1px solid var(--rule-soft);}

.crc-timeline{padding:16px 0 6px;}
.crc-tl-track{position:relative;height:11px;background:var(--track);border-radius:1px;margin:24px 0 6px;}
.crc-tl-seg{position:absolute;top:0;height:11px;border-radius:1px;}
.crc-tl-need{position:absolute;top:-18px;bottom:-6px;width:1.5px;background:var(--ink);}
.crc-tl-need-label{position:absolute;top:-14px;left:6px;font-size:10.5px;color:var(--ink);white-space:nowrap;}
.crc-tl-scale{display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink3);
  font-family:'IBM Plex Mono',monospace;}

.crc-steps{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:1px;}
.crc-step{display:flex;gap:11px;padding:11px 12px;background:var(--panel);border:1px solid var(--rule-soft);}
.crc-step-rank{width:20px;height:20px;border-radius:2px;background:var(--invert-bg);color:var(--invert-ink);
  font-family:'IBM Plex Mono',monospace;font-size:11px;display:flex;align-items:center;justify-content:center;flex:none;}
.crc-step-pr .crc-step-rank{background:var(--stop);}
.crc-step-expedite .crc-step-rank{background:var(--caution);}
.crc-step-transfer .crc-step-rank{background:var(--go);}
.crc-step-sto .crc-step-rank{background:var(--signal);}
.crc-step-label{font-size:13px;font-weight:600;}
.crc-step-detail{font-size:12.5px;color:var(--ink2);margin-top:2px;max-width:78ch;}
.crc-step-meta{display:flex;gap:16px;margin-top:6px;font-size:11px;color:var(--ink3);flex-wrap:wrap;}
.crc-cost-new{color:var(--stop);} .crc-cost-free{color:var(--go);}

.crc-exclbox{margin-top:14px;border:1px solid var(--caution);border-left-width:3px;background:var(--caution-soft);padding:11px 12px;}
.crc-exclbox-title{font-size:12px;font-weight:600;color:var(--caution);margin-bottom:7px;}
.crc-exclrow{display:grid;grid-template-columns:56px 150px 90px minmax(0,1fr);gap:10px;
  font-size:12px;padding:4px 0;border-top:1px solid var(--brass-rule);align-items:baseline;}
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
  color:var(--stop-ink);font-size:13px;}

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
.crc-btn{background:var(--invert-bg);color:var(--invert-ink);border:1px solid var(--invert-bg);border-radius:2px;padding:8px 15px;
  font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;white-space:nowrap;
  transition:background .12s ease;}
.crc-btn:hover:not(:disabled){background:var(--ink-hover);}
.crc-btn:disabled{background:var(--rule);color:var(--ink3);cursor:not-allowed;}
.crc-plan{padding:16px;}
.crc-plan-headline{font-size:16px;font-weight:600;line-height:1.4;max-width:72ch;}
.crc-critical{margin:12px 0 16px;padding:11px 13px;background:var(--signal-bg);border-left:3px solid var(--signal);}
.crc-critical span{font-size:11px;font-weight:600;color:var(--signal);}
.crc-critical p{font-size:13px;color:var(--signal-ink);margin-top:3px;max-width:74ch;}
.crc-plantable{border:1px solid var(--rule-soft);}
.crc-watch{margin-top:16px;}
.crc-watch-title{font-size:12px;font-weight:600;margin-bottom:5px;}
.crc-watch ul{margin:0;padding-left:18px;font-size:13px;color:var(--ink2);}
.crc-watch li{margin-bottom:3px;max-width:76ch;}
`;

/* ============================================================
   BOOT

   The dashboard cannot render until the workbook has been read, so the
   exported component is a gate in front of it. A blank page is the worst
   failure mode here: if the file is missing, unreadable or served from
   disk, say which and what to do about it.
   ============================================================ */

/* The boot screen renders before the stylesheet is mounted, so it carries its
   own two palettes rather than tokens. It reads the stored preference directly:
   flashing a white page at someone who chose the dark theme is exactly the kind
   of thing a theme setting is supposed to prevent. */
const BOOT_THEME = {
  light: { bg: "#EDF1F4", ink: "#52646F", eyebrow: "#7C97AC", head: "#243B4A", stop: "#9C2A2A" },
  dark:  { bg: "#0E161C", ink: "#A9BDC9", eyebrow: "#7C97AC", head: "#E3EBF1", stop: "#EE7A63" },
};

function BootMessage({ title, tone, children }) {
  const c = BOOT_THEME[readStoredTheme()] || BOOT_THEME.light;
  return (
    <div style={{
      font: '14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif',
      color: c.ink,
      background: c.bg,
      minHeight: "100vh",
      padding: "48px 32px",
      boxSizing: "border-box",
    }}>
      <div style={{ maxWidth: "68ch" }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: c.eyebrow }}>
          {APP_NAME}
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: "6px 0 10px", color: tone === "stop" ? c.stop : c.head }}>
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}

export default function ComponentReadinessCheck() {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    loadDataset().then(
      () => { if (live) setPhase("ready"); },
      (err) => {
        if (!live) return;
        setError(err);
        setPhase("failed");
      }
    );
    return () => { live = false; };
  }, []);

  if (phase === "loading") {
    return (
      <BootMessage title="Reading the workbook">
        <p style={{ margin: 0 }}>
          Loading master data, stock and orders from <code>{WORKBOOK_FILE}</code>.
        </p>
      </BootMessage>
    );
  }

  if (phase === "failed") {
    return (
      <BootMessage title="The workbook could not be read" tone="stop">
        <p style={{ margin: "0 0 14px" }}>
          {(error && error.message) || String(error)}
        </p>
        <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 13 }}>What to check</p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li><code>{WORKBOOK_FILE}</code> sits in the same folder as this page.</li>
          <li>The page is served over http, not opened from disk.</li>
          <li>The workbook still has its <code>_Schema</code> sheet — rebuild it with <code>tools\build-workbook.ps1</code> if not.</li>
        </ul>
      </BootMessage>
    );
  }

  return <ReadinessDashboard />;
}
