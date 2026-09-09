# PP_Readiness

Component readiness check for SAP PP. A single-page React app that takes a
planning run and reports, per order, whether the components are actually
available to issue — across plants, storage locations and BOM levels — and
what has to happen for the shortages to close.

The model covers plant-to-plant transit days, storage location types
(quality inspection, subcontract staging, in transit, blocked stock) and the
effort each one costs to convert into issuable stock, multi-level BOMs with
alternatives, and in-house versus bought-out procurement lead times.

## Status

Scaffold only. `src/components/ComponentReadinessCheck.jsx` is a placeholder —
see [Adding the component](#adding-the-component) below.

## Requirements

- Node.js 18 or newer (for the Vite workflow)
- Any modern browser

Neither is required for the standalone fallback described further down,
which needs only PowerShell and a browser.

## Getting started

```bash
npm install
npm run dev
```

The dev server starts on <http://localhost:5173> and opens a browser.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production bundle into `dist/` |
| `npm run preview` | Serve the built bundle locally |
| `npm run standalone` | Single-file HTML build, no Node needed at runtime |

## Adding the component

Copy the source file over the placeholder:

```powershell
Copy-Item "path\to\component-readiness-check.jsx" `
          "src\components\ComponentReadinessCheck.jsx" -Force
```

No edits are needed. The file already imports React and has a default
export, which is what `src/App.jsx` expects.

## Running without Node

If Node is not installed, `tools/build-standalone.ps1` compiles the component
into one self-contained HTML file. React and Babel load from CDN and the JSX
is transpiled in the browser, so the output opens by double-clicking it.

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-standalone.ps1
Start-Process standalone\index.html
```

Two constraints come with this path, both enforced by the script rather than
left to fail silently at runtime:

- The component must be self-contained — a single file whose only import is
  React. Any other `import` aborts the build.
- The first load needs network access to reach the CDN.

It is slower to start than the Vite build, since Babel compiles the whole
component on every page load. Prefer `npm run dev` when Node is available.

## Layout

```
PP_Readiness/
├── index.html                 Vite entry document
├── package.json
├── vite.config.js
├── src/
│   ├── main.jsx               React root
│   ├── App.jsx                Mounts the readiness component
│   ├── index.css              Page-level resets only
│   └── components/
│       └── ComponentReadinessCheck.jsx
└── tools/
    └── build-standalone.ps1   No-build single-file HTML output
```

The readiness component ships its own scoped styles under `.crc-root`, so
`src/index.css` is deliberately limited to page-level resets. Keep it that
way to avoid the two stylesheets fighting.
