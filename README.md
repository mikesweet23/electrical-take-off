# Cable Trace — electrical take-off and BS 7671 cable sizing

Open `index.html` (or the GitHub Pages site). No install.

1. **Open a drawing** — PDF (each page a sheet) or image, or start on a grid.
2. **Set the scale** (`S`) from a known dimension, or the drawing scale for a PDF.
3. **Place equipment** — boards (DB, consumer unit, MCC, switchboard, BMS, control panel), loads (motors, pumps, fans, AHUs, chillers…), local isolators, field devices and risers.
4. **Enter the loads** — kW as the manufacturer gives it, single or three phase, power factor, maximum current, peak current, DOL / star-delta / soft start / VSD.
5. **Trace containment** (`T`) — tray, ladder, basket, steel or PVC trunking, steel or PVC conduit, or cleated — with the fixing (drop rods and trapeze, beam clamps, unistrut cantilever arms, wall brackets…) and the height of every point.
6. **Trace cables** (`C`) — board → isolator → load, or board → load. Power, control or data.

Every circuit is sized to BS 7671:2018+A2:2022 (A3:2024): protective device,
cable size with grouping from the containment it actually shares, volt drop
(mV/A/m), Zs, CPC adiabatic check and breaking capacity. Step any cable up or
down — a non-compliant choice is kept and shown red.

The containment is sized from the cables on it (+25 % by default), and the
take-off counts cable, containment, fittings, fixings, isolators, glands
(BW/CW/EMC with shrouds and earth tags) and flexible conduit. **3D** shows it
all at height; **PDF** and **Excel** export the schedules and take-off.

Design notes and the data basis: [CLAUDE.md](CLAUDE.md).
