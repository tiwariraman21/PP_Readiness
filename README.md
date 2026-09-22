# PPC Dashboard

Component readiness check for SAP PP, branded InfraBeat. A single-page React app
that takes a planning run and reports, per order, whether the components are
actually available to issue — across plants, storage locations and BOM levels —
and what has to happen for the shortages to close.

The repository folder is still named `PP_Readiness`; only the application name
changed. The data file keeps its `PP_Readiness_Database.xlsx` name too, since
renaming it would touch the loader, both build scripts and every copy on disk.

The model covers plant-to-plant transit days, storage location types
(quality inspection, subcontract staging, in transit, blocked stock) and the
effort each one costs to convert into issuable stock, multi-level BOMs with
alternatives, and in-house versus bought-out procurement lead times.

## Using it

**Themes.** The moon/sun control in the masthead switches between light and
dark. The choice is kept in that browser's `localStorage`, so it survives a
reload; a browser that has never chosen follows the operating system setting.
Printing always uses the light palette regardless of what is on screen — the
app drops to light for the duration of the print job and restores afterwards.

**Building a run.** The run is a set of material and plant combinations. Pick a
plant, open **Choose materials**, and either type a code into the search box or
tick as many finished goods and sub-assemblies as you want; each becomes its own
line. A combination already in the run is shown ticked-out rather than offered
twice — two lines for the same material at the same plant would only compete
with each other. The same material at a different plant is a different
combination and stays available. Lines draw stock in the order they are listed,
so position is priority.

Typing a code that exists in the material master but has no bill of material
offers it under **Typed in**, flagged as unable to explode. That is deliberate:
the run then says so plainly, which is more useful than refusing the entry.

The **Finished good** cell on each line is also a text box — type a code over it
to swap a line's material without removing and re-adding it.

**F4 material search.** Every material field opens the search help on
<kbd>F4</kbd>, or by clicking the F4 button on the field. It searches the whole
material master — not only materials that carry a bill of material — filters by
plant, and shows type, unit, MRP controller and on-hand stock. Fields that take
one material return one; the run builder, the consumption filter and the export
filter return a set. You can still type a code straight into a field without
opening the search.

**Consumption history.** Twelve months of goods issues, charted, with the part
that had no production order behind it picked out in amber and the month in
progress greyed and excluded from the averages. Filter by plant, by materials
via F4, or leave both open for everything with history. Below the chart each
material gets a sparkline, its average, peak, unplanned share, trend and cover.
When the filter spans several units of measure the chart says so rather than
pretending the total means one thing.

**Export.** The **Export…** button on the Summary screen takes any combination of
twelve data sections, narrowed by plant, material and date range, as **Excel**
(one sheet per section plus a sheet recording the filters), **CSV** (a single
file, each section under its own heading) or **PDF**. PDF goes through the
browser's own print dialog — choose *Save as PDF* as the destination — rather
than bundling a PDF library.

**Scope.** Most screens follow the line selected in the strip at the top, and a
**This material / Whole run** toggle widens them to every line in the run. Stock
carries its own pair of controls instead — material scope and **Plant / All
plants** — because "what have we got, and where" is usually asked across sites.
Components and Shortages always read the selected line, so they show no toggle.

**Branding.** The InfraBeat mark is set in the page's own type rather than
shipped as an image, so it stays sharp at any size and needs no asset. To use
the real artwork instead, drop the file next to the page — `public/` for the
Vite build, `standalone/` for the single-file build — and point `BRAND_LOGO_SRC`
at it near the top of the `BRANDING AND THEME` section in
`src/components/ComponentReadinessCheck.jsx`. The wordmark is then replaced by
an `<img>`. Brand colours sit on their own white plate so they stay correct
against the dark masthead in both themes.

## Where the data lives

`public/PP_Readiness_Database.xlsx` is the database, and it is the source of
truth. The app holds no figures of its own: it fetches the workbook on load,
decodes it and renders it. Edit a quantity in Excel, save, reload the page and
the dashboard moves.

That has one consequence worth knowing up front. **The page has to be served
over http.** A browser will not let a `file://` page read a local file, so
opening `standalone/index.html` by double-clicking it now shows a load error
rather than the dashboard. Use `tools\serve.ps1` or the Vite dev server.

The workbook covers four plants and a year of trading: 280 materials — 60
finished goods, 40 sub-assemblies and 180 raw materials — 100 multi-level bills
of material, 28 work centres, and roughly 5,000 transactional rows including 420
sales order lines, 260 production orders, 420 purchase orders, 2,000 goods
movements and twelve months of consumption per material and plant. All of it
sits across 29 sheets:

| Sheet | Holds |
| --- | --- |
| `Plants`, `Transit`, `StorageLocations` | Sites, inter-plant transit days, storage location types and the effort to release each |
| `Materials`, `BOM`, `ProductionVersions` | Material master, bills of material by alternative, and the routing/line/lot-size ranges MRP picks between |
| `FinishedGoods`, `Stock`, `MRPData` | Sellable goods, stock by storage location, safety stock and reorder points |
| `WorkCentres`, `SchedulingMargin`, `ShipPoints` | Capacity, float and opening periods, pick/pack and loading time |
| `SalesOrders`, `PIR`, `Deliveries` | Firm demand, forecast, and what has shipped |
| `ProductionOrders`, `PlannedOrders`, `Reservations` | The shop floor, what MRP proposes, and what is already committed |
| `PurchaseOrders`, `PurchaseOrderPegging`, `Subcontracting`, `SubconProvided` | Inbound supply, quantities already pegged to other orders, and stock sitting at vendors |
| `Batches`, `BatchManaged`, `Consumption`, `GoodsMovements`, `MovementTypes`, `OrderStatus` | Batch stock with shelf life, twelve months of consumption, posted movements and the code catalogues |
| `_Schema` | How to read all of the above |

### The `_Schema` sheet

The loader reads `_Schema` before anything else. It records, for every sheet,
which dataset it carries, which column heading maps to which property, what
type that property is, and how the flat rows are folded back into the nested
shapes the app expects — bills of material by parent and alternative,
production versions grouped by material, pegging lines attached to their
purchase order.

Nothing about the column layout is hard coded in the app, so a heading can be
renamed or a column moved in Excel and the dashboard keeps working, as long as
`_Schema` is updated to match. Delete `_Schema` and the page will tell you it
cannot read the workbook.

### Changing the data

Editing the workbook in Excel is the intended path, and needs no tooling.

Two things to keep right, because nothing enforces them:

- A batch-managed material's batch quantities must add up to its storage
  location stock, or availability will disagree with what MMBE would show.
- Codes are joins. A `Material` on `Stock` that does not exist on `Materials`,
  or a `WorkCentre` on `ProductionVersions` with no row on `WorkCentres`, will
  read as missing rather than raise an error.

To start over, `tools\build-workbook.ps1` rebuilds the workbook from the seed
in `data/dataset.json`. The seed is never written back to, so this **discards
every edit made in Excel** and returns the data to its starting state. It needs
Excel installed, since it drives Excel to write the file.

### Regenerating the demo data

`tools\make-dataset.ps1` writes `data/dataset.json` from scratch: the plant
network, the material master, multi-level bills, and a year of sales orders,
deliveries, production and planned orders, purchasing, subcontracting,
reservations, goods movements, batches and consumption. Run it, then
`build-workbook.ps1`, to get a new workbook:

```powershell
powershell -ExecutionPolicy Bypass -File tools\make-dataset.ps1
powershell -ExecutionPolicy Bypass -File tools\build-workbook.ps1
```

It is seeded, so re-running reproduces the same data byte for byte; pass
`-Seed <number>` for a different but equally coherent set. Two shaping rules are
deliberate and worth knowing before you tune it: about a third of material and
plant combinations are stocked tight so the shortage, contention and coverage
screens have real cases to show, and just over half the purchase and
subcontracting book is still open and lands inside the planning horizon, so
inbound supply is not all history.

The opening planning run is not hard coded either. It seeds itself from real
sales order lines — two different plants so the plant-keyed screens change when
the scope widens to the whole run, then a third line back on the first plant so
the contention screen has two lines competing for the same stock.

## Requirements

- Any modern browser, and the ability to serve a folder over http
- Node.js 18 or newer, for the Vite workflow — optional, see below
- Microsoft Excel, only to rebuild the workbook from the seed

The first load needs network access: React, Babel and the spreadsheet reader
come from CDN.

## Getting started

With Node:

```bash
npm install
npm run dev
```

The dev server starts on <http://localhost:5173> and opens a browser. Vite
serves `public/` at the site root, so the workbook is found automatically.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production bundle into `dist/` |
| `npm run preview` | Serve the built bundle locally |
| `npm run standalone` | Single-file HTML build, no Node needed at runtime |
| `npm run serve` | Static server for the standalone build |
| `npm run workbook` | Rebuild the workbook from the seed — discards Excel edits |

## The offline single file

`tools\build-offline.ps1` produces **`standalone\PPC-Dashboard-offline.html`** —
one file, about 1.4 MB, that needs no server, no network and no install. Double
click it, or mail it to someone, and it opens.

It differs from the served build in three ways, all of them to remove
dependencies:

- the JSX is compiled to plain JavaScript at build time, so no compiler ships
  with it,
- React and ReactDOM are inlined (cached under `tools\vendor` after the first
  build),
- the data is **embedded as JSON**, so there is no workbook to fetch and no
  spreadsheet reader to load.

```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 5174   # in another window
powershell -ExecutionPolicy Bypass -File tools\build-offline.ps1
```

Building it needs the local server running and a network connection — Babel and
the React bundles are fetched at build time. Opening the result needs neither.

Two consequences worth knowing. The data in it is a **snapshot**: editing the
workbook afterwards does not change the file, so rebuild to pick up new figures.
And the webfont import is stripped so nothing reaches for the network, which
means it renders in the system font rather than IBM Plex.

## Running without Node

`tools\build-standalone.ps1` compiles the component into one self-contained
HTML file. React and Babel load from CDN and the JSX is transpiled in the
browser, so no toolchain is needed at runtime. It copies the workbook next to
the HTML, because the page fetches it on load.

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-standalone.ps1
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

Then open <http://localhost:5173>. Pass `-Port 8080` to `serve.ps1` if 5173 is
taken. The server binds `localhost` only, which is what lets it run without an
elevated prompt.

Two constraints come with this path, both enforced by the build script rather
than left to fail silently at runtime:

- The component must be self-contained — a single file whose only import is
  React. Any other `import` aborts the build.
- It is slower to start than the Vite build, since Babel compiles the whole
  component on every page load. Prefer `npm run dev` when Node is available.

## Layout

```
PP_Readiness/
├── index.html                 Vite entry document
├── package.json
├── vite.config.js
├── data/
│   └── dataset.json           Seed the workbook is built from
├── public/
│   └── PP_Readiness_Database.xlsx    The database the app reads
├── src/
│   ├── main.jsx               React root
│   ├── App.jsx                Mounts the readiness component
│   ├── index.css              Page-level resets only
│   └── components/
│       └── ComponentReadinessCheck.jsx
└── tools/
    ├── build-standalone.ps1   No-build single-file HTML output
    ├── build-workbook.ps1     Seed -> xlsx, via Excel
    └── serve.ps1              Static server for the standalone build
```

`ComponentReadinessCheck.jsx` keeps the empty table declarations at the top with
their comments, so the shape of each dataset is still documented next to the
code that uses it. They are filled in by the loader further down the same file.

The readiness component ships its own scoped styles under `.crc-root`, so
`src/index.css` is deliberately limited to page-level resets. Keep it that
way to avoid the two stylesheets fighting.
