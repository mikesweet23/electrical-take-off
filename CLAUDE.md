# adi Cable Trace — design notes

A self-contained electrical take-off and BS 7671 cable sizing tool. No build
step, no package manager, no server: `index.html` opens from a hard disk on
site or from GitHub Pages. It works the same way as Pipe Trace in
`mikesweet23/Alternative-pipe-sizer`: open a drawing, set the scale, place
the equipment, trace runs with a height on every point, check in 3D, and
export a PDF report and Excel workbook.

**This document is the handover.** If you pick this up cold, read it before
changing anything.

---

## 1. Files

| File | Does | Touches the DOM |
|---|---|---|
| `index.html` | Markup and CSS only | — |
| `engine.js` | Every electrical number: Appendix 4 tables, correction factors, devices, Zs, adiabatic, volt drop, isolators, glands, containment fill, support kits. `sizeCircuit()` and `sizeControl()` | No |
| `core.js` | The project model, the containment network, cable routing, grouping, `solve()` and `takeoff()` | No |
| `app.js` | Sheets, drawings (pdf.js), zoom, tools, tracing, the plan overlay, the inspector, settings, save/open/autosave, undo | Yes |
| `edit.js` | Rotating a sheet, multi-select (lasso, Shift-click, Ctrl+A, group move, bulk edit) and copy / paste / duplicate | Yes |
| `outputs.js` | Schedules drawer, 3D view, PDF report, Excel export. All four read the same `*Rows()` builders | Yes |
| `xlsx.js` | A minimal .xlsx writer (stored zip, inline strings) | No |
| `tests/*.mjs` | Node checks of the engine, model, take-off and xlsx writer | — |

`engine.js`, `core.js` and `xlsx.js` load in Node unchanged — keep them
free of `window`/`document`. The only external script is pdf.js 3.11.174 from
cdnjs (the same build Pipe Trace uses); images open without it.

## 2. How a cable gets its size

1. **Path.** `legPath()` walks node → waypoints → node. Between two network
   points it follows the shortest path through the containment; anything else
   is a free span. Length = plan + vertical for every span (risers and drops are
   counted, never the hypotenuse), plus `termAllow` at each end, plus the leg's
   `extra`. A main leg with no waypoints is auto-routed (`autoRoute()`): one
   Dijkstra seeded from every containment point within `autoHopM` of the start,
   with off-containment metres costing double.
2. **Grouping.** `A.occ` lists every circuit on every piece (edge) of
   containment. Cg for a leg is taken per edge from the number of *power*
   circuits on it (control and data are not counted — Table 4C1 note on lightly
   loaded cables). Ca from the run's ambient. Ci per leg. Each distinct
   condition is passed to the engine; **the worst one governs**.
3. **Device.** Smallest rating ≥ Ib, and for DOL / star-delta / soft start on
   an MCB, the curve's no-trip threshold must clear 1.2 × the starting current.
   Motors default to Type D unless on a VSD.
4. **Cable.** Smallest size with Iz ≥ In under every condition (Iz ≥ Ib when
   "overload at starter" is ticked), never below `minPower` (Table 52.3). Then
   upsize the leg doing most harm until the total volt drop (including the
   board's upstream drop) and Zs pass. Zs is not chased if the board's own Zdb
   is already over the limit — that is reported, not "fixed" with copper.
5. **User step.** `leg.step` moves the size up or down from the automatic pick.
   A size that fails is **kept and drawn red**, never blocked.
6. **Checks.** Ib ≤ In, Iz, volt drop, volt drop on start, Zs (Tables
   41.2–41.4, Cmin 0.95, 0.4 s finals ≤ `maxFinalA` on TN, 5 s otherwise; TT
   needs an RCD, Table 41.5), adiabatic on every CPC (543.1.3), breaking
   capacity against the board's fault level.

A circuit with an isolator has two legs: **main** (board → isolator) and
**tail** (isolator → load). Both carry the same Ib and device; volt drop and
Zs are summed across them.

Sub-mains (board → board) roll up their design current from everything the
child board feeds (× its diversity). The child board's Zdb, upstream volt drop
and fault level then come from the sub-main unless typed on the board.

## 3. Data — what is exact and what is typical

Entered by hand from the 18th Edition; check against your copy after any edit:

- Appendix 4: 4D1A/B, 4D2A/B, 4D4A/B, 4D5, 4E4A/B, 4F3A/B (`TABLES`). mV/A/m
  above 16 mm² use the tabulated **z** values (conservative).
- Table 4B1 (Ca), 4C1 (Cg rows: enclosed / wall / tray / ladder), 52.2 (Ci).
- Maximum Zs: MCBs computed from Uo × Cmin / (multiple × In); BS 88-2 from
  `BS88_ZS` (Tables 41.2 and 41.4). MCCBs from the magnetic setting `im × In`.
- OSG Table I1 conductor resistance; ×1.20 (70 °C) / ×1.28 (90 °C) to
  operating temperature.

**Typical catalogue figures — verify before issuing a tight design or an order:**

- Cable overall diameters (`OD_*`) — Doncaster / Prysmian rounded.
- SWA armour resistance and area (`ARMOUR_R`, `ARMOUR_A`); armour at ×1.18.
- Gland outer-sheath ranges (`GLAND_SIZES`, `NYLON_GLANDS`).
- Flexible cords above 4 mm² rated from 4D2A; tri-rated singles rated as 70 °C
  singles; FP200 as 4D2A.
- Conduit fill uses a space factor (default 40 %) rather than the OSG cable
  factor tables; trunking uses the OSG 45 %.
- Support spacings and the per-support kits in `supportKit()`.

Every value is also overrideable where it matters on a job: the diameter per
leg, Zdb / PFC / upstream VD per board, widths per run, spacing per run.

## 4. The project file

`app: 'adi-cable-trace'`, `schema: 1`. Plain JSON, saved with the drawings.

| Key | Holds |
|---|---|
| `settings` | Everything in Project & basis (`defaultSettings()` in core.js) |
| `sheets[]` | `id, name, level (m), pxPerM, w, h, src (data URL), concept, pxPerPaperMm, ratio` |
| `nodes[]` | `kind: board / load / isolator / device / riser`, `sheet, x, y, h` and per-kind fields (see `addNode()` and the inspector forms) |
| `routes[]` | Containment: `type, duty, finish, width (null = auto), mount, layout, orient, side, soffit, spacing, amb, inWall, pts[]` |
| `routes[].pts[]` | `id, x, y, h, link?` — `link: 'p:<pid>'` joins it to another run's point (a tee or a continuation), `'n:<nodeId>'` to a riser |
| `circuits[]` | `kind: power / submain / control`, `board, iso, target, device{family, curve, rating, kA, im, rcd}, overloadAtStarter, ctrl{volts, va, signal}, legs{main, tail}` |
| `legs.main/tail` | `type, cpc, cores, step, extra, way[], direct, freeMethod, ci, flex, gland, od` |
| `way[]` | `{p: pid}` a containment point, `{r: nodeId}` a riser, `{s, x, y, h}` a free point |
| `measures[]` | Tape lines, plan only |

`repair()` makes an old or hand-edited file safe to open: missing keys,
settings merged over defaults, and the id counter moved past every id in use.

## 5. Conventions that are easy to break

- **Positions resolve through links.** Never read `pt.x` directly for a joined
  point — use `C.ptPos(ix, pid)`. Deleting a point calls `unrefPoint()` so
  anything joined to it, and any cable waypoint on it, keeps its place.
- **Heights are per point**, above that sheet's floor level. Clicking the last
  point again with a new height makes a vertical riser. `[` / `]` nudge the
  next height while tracing.
- **Stacking is drawn, not stored.** Cables on a run are drawn side by side at
  true diameter across the run's width (`orient: 'wall'` packs from the wall
  side). The zoomer's `1:1` button exaggerates the diameters for reading; it
  changes nothing in the sums.
- **One analysis.** `changed()` → `solveNow()` → `C.solve(P)`; the take-off is
  built lazily from that. The plan, inspector, schedules, 3D, PDF and Excel all
  read the same `A` — never compute a figure twice.
- **Undo** is snapshots of the take-off without drawing images. `pushUndo()`
  goes before the change.
- Refs (`DB1/3`) are automatic until typed (`refAuto: false`).
- **Rotating a sheet bakes the turn into the image** and turns every traced
  point on that sheet with it (nodes, run points, free cable waypoints, tape)
  about the sheet centre, landing on the new canvas centre. Each turn is drawn
  from the image as first loaded (`V.orig`), never the last rotated copy.
  `sheet.rot` is the angle; `V.baked` the angle the current image carries, so
  an undo re-renders the image when the two differ (`ensureBaked()`). The scale
  is untouched — rotation keeps distances.
- **Select tool:** drag on open paper lassos (runs come only when wholly
  inside), Shift-click toggles one, a press on a picked item drags the group.
  Pan is Space-drag, middle or right drag. A group move shifts unjoined run
  points — joined points follow what they are joined to.
- **Clipboard** is in `localStorage` in metres about the copy's centre, so it
  pastes at true size on a sheet at another scale and survives a reload.
  Joints inside the copy are kept, joints to anything left behind are let go.
  A cable comes along when its load (and isolator) is copied; if its board
  was not, the copy is fed from the same board and its supply auto-routes.

## 6. Checking a change

```bash
node tests/core-test.mjs
node tests/xlsx-test.mjs
python3 -m http.server 8765   # then http://127.0.0.1:8765/
```

A headless browser can drive the page: `CT.P`, `CT.A`, `CT.getTK()`,
`CT.goTo()` and `Outputs.*` are on `window`. Keep browser tooling outside the
repo — the tool has no dependencies and that is deliberate.
