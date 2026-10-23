/* adi Cable Trace — calculation engine.
 *
 * Everything electrical lives here and nothing else does: no DOM, no drawing,
 * no geometry. The page (app.js) works out where each cable runs and what it
 * shares containment with, hands that to sizeCircuit(), and draws what comes
 * back. The node tests load this file on its own, so keep it free of browser
 * globals.
 *
 * Basis: BS 7671:2018+A2:2022 (incorporating A3:2024), Appendix 4 current
 * ratings and mV/A/m, Table 4B1 / 4C1 / 52.2 correction factors, Tables
 * 41.2–41.4 maximum Zs (Cmin 0.95), 54.3 / 54.4 k values, 54.7 CPC sizing,
 * Table 41.5 for RCDs on TT. Containment fill from the IET On-Site Guide.
 * Cable diameters, armour data and gland ranges are typical UK
 * manufacturer figures (Prysmian / Doncaster / CMP) and are marked as such.
 *
 * Every table below was entered by hand. CLAUDE.md section 3 lists which are
 * exact transcriptions and which are typical figures to check against the
 * supplier's sheet before a design is issued.
 */
(function (root) {
  'use strict';

  const U0 = 230;          // nominal line to earth
  const U1 = 230;          // single phase
  const U3 = 400;          // three phase line to line
  const SQRT3 = Math.sqrt(3);

  // ------------------------------------------------------------------
  // Conductor resistance at 20 °C, mΩ/m (copper) — OSG Table I1
  // ------------------------------------------------------------------
  const R20 = {
    0.5: 36.0, 0.75: 24.5, 1: 18.10, 1.5: 12.10, 2.5: 7.41, 4: 4.61, 6: 3.08,
    10: 1.83, 16: 1.15, 25: 0.727, 35: 0.524, 50: 0.387, 70: 0.268,
    95: 0.193, 120: 0.153, 150: 0.124, 185: 0.0991, 240: 0.0754, 300: 0.0601
  };
  // Multiplier from 20 °C to the conductor's maximum operating temperature
  // (GN3 / OSG Table I3): 70 °C thermoplastic 1.20, 90 °C thermosetting 1.28.
  // Steel armour is taken at about 60 °C.
  const R_FACTOR = { 70: 1.20, 90: 1.28, armour: 1.18 };

  const STD_SIZES = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];

  // ------------------------------------------------------------------
  // Appendix 4 current-carrying capacity (A) and voltage drop (mV/A/m)
  // Keys: method + loaded conductors (2 = single phase, 3 = three phase).
  // ------------------------------------------------------------------
  function zip(sizes, arr) {
    const o = {};
    sizes.forEach((s, i) => { if (arr[i] != null) o[s] = arr[i]; });
    return o;
  }
  const S_SINGLE = [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
  const S_MULTI = [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95];
  const S_TE = [1, 1.5, 2.5, 4, 6, 10, 16];
  const S_SWA = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
  const S_FLEX = [0.5, 0.75, 1, 1.5, 2.5, 4];

  const TABLES = {
    // 4D1A / 4D1B — single-core 70 °C thermoplastic, non-armoured (6491X)
    '4D1A': {
      title: 'Table 4D1A/4D1B — single-core 70 °C thermoplastic, copper',
      maxT: 70, sizes: S_SINGLE,
      rating: {
        A2: zip(S_SINGLE, [11, 14.5, 20, 26, 34, 46, 61, 80, 99, 119, 151, 182, 210, 240, 273, 320, 367]),
        A3: zip(S_SINGLE, [10.5, 13.5, 18, 24, 31, 42, 56, 73, 89, 108, 136, 164, 188, 216, 245, 286, 328]),
        B2: zip(S_SINGLE, [13.5, 17.5, 24, 32, 41, 57, 76, 101, 125, 151, 192, 232, 269, 300, 341, 400, 458]),
        B3: zip(S_SINGLE, [12, 15.5, 21, 28, 36, 50, 68, 89, 110, 134, 171, 207, 239, 262, 296, 346, 394]),
        C2: zip(S_SINGLE, [15.5, 20, 27, 37, 47, 65, 87, 114, 141, 182, 234, 284, 330, 381, 436, 515, 594]),
        C3: zip(S_SINGLE, [14, 18, 25, 33, 43, 59, 79, 104, 129, 167, 214, 261, 303, 349, 400, 472, 545])
      },
      // E (free air / tray) is not a method for unsheathed singles; D likewise.
      fallback: { E: 'C', D: 'A', F: 'C' },
      mv: {
        2: zip(S_SINGLE, [44, 29, 18, 11, 7.3, 4.4, 2.8, 1.80, 1.30, 0.95, 0.65, 0.49, 0.41, 0.34, 0.29, 0.24, 0.21]),
        3: zip(S_SINGLE, [38, 25, 15, 9.5, 6.4, 3.8, 2.4, 1.55, 1.10, 0.81, 0.56, 0.42, 0.35, 0.29, 0.25, 0.21, 0.185])
      }
    },
    // 4D2A / 4D2B — multicore 70 °C thermoplastic, non-armoured
    '4D2A': {
      title: 'Table 4D2A/4D2B — multicore 70 °C thermoplastic, non-armoured',
      maxT: 70, sizes: S_MULTI,
      rating: {
        A2: zip(S_MULTI, [11, 14, 18.5, 25, 32, 43, 57, 75, 92, 110, 139, 167]),
        A3: zip(S_MULTI, [10, 13, 17.5, 23, 29, 39, 52, 68, 83, 99, 125, 150]),
        B2: zip(S_MULTI, [13, 16.5, 23, 30, 38, 52, 69, 90, 111, 133, 168, 201]),
        B3: zip(S_MULTI, [11.5, 15, 20, 27, 34, 46, 62, 80, 99, 118, 149, 179]),
        C2: zip(S_MULTI, [15, 19.5, 27, 36, 46, 63, 85, 112, 138, 168, 213, 258]),
        C3: zip(S_MULTI, [13.5, 17.5, 24, 32, 41, 57, 76, 96, 119, 144, 184, 223]),
        E2: zip(S_MULTI, [17, 22, 30, 40, 51, 70, 94, 119, 148, 180, 232, 282]),
        E3: zip(S_MULTI, [14.5, 18.5, 25, 34, 43, 60, 80, 101, 126, 153, 196, 238])
      },
      fallback: { D: 'A', F: 'E' },
      mv: {
        2: zip(S_MULTI, [44, 29, 18, 11, 7.3, 4.4, 2.8, 1.75, 1.25, 0.93, 0.63, 0.46]),
        3: zip(S_MULTI, [38, 25, 15, 9.5, 6.4, 3.8, 2.4, 1.50, 1.10, 0.80, 0.55, 0.41])
      }
    },
    // 4D5 — 70 °C thermoplastic flat twin & earth (6242Y)
    '4D5': {
      title: 'Table 4D5 — 70 °C thermoplastic flat twin and earth',
      maxT: 70, sizes: S_TE, singlePhaseOnly: true,
      rating: {
        C2: zip(S_TE, [16, 20, 27, 37, 47, 64, 85]),
        A2: zip(S_TE, [11.5, 14.5, 20, 26, 32, 44, 57]),
        M100_2: zip(S_TE, [13, 16, 21, 27, 34, 45, 57]),
        M101_2: zip(S_TE, [10.5, 13, 17, 22, 27, 36, 46]),
        M102_2: zip(S_TE, [13, 16, 21, 27, 35, 47, 63]),
        M103_2: zip(S_TE, [8, 10, 13.5, 17.5, 23.5, 32, 42.5])
      },
      // Not tabulated for T&E: on tray it is taken as clipped direct (C),
      // in conduit or trunking as method A (the conservative column).
      fallback: { E: 'C', B: 'A', D: 'A', F: 'C' },
      mv: { 2: zip(S_TE, [44, 29, 18, 11, 7.3, 4.4, 2.8]) }
    },
    // 4D4A / 4D4B — multicore armoured 70 °C thermoplastic (BS 6346)
    '4D4A': {
      title: 'Table 4D4A/4D4B — multicore armoured 70 °C thermoplastic',
      maxT: 70, sizes: S_SWA,
      rating: {
        C2: zip(S_SWA, [21, 28, 38, 49, 67, 89, 118, 145, 175, 222, 269, 310, 356, 405, 476, 547]),
        C3: zip(S_SWA, [18, 25, 33, 42, 58, 77, 102, 125, 151, 192, 231, 267, 306, 348, 409, 469]),
        E2: zip(S_SWA, [22, 31, 41, 53, 72, 97, 128, 157, 190, 241, 291, 336, 386, 439, 516, 592]),
        E3: zip(S_SWA, [19, 26, 35, 45, 62, 83, 110, 135, 163, 207, 251, 290, 332, 378, 445, 510]),
        D2: zip(S_SWA, [22, 29, 37, 46, 60, 78, 99, 119, 140, 173, 204, 231, 261, 292, 336, 379]),
        D3: zip(S_SWA, [18, 24, 30, 38, 50, 64, 83, 100, 118, 145, 171, 193, 218, 245, 282, 317])
      },
      // Armoured cable in conduit or trunking is not tabulated: taken as C.
      fallback: { A: 'C', B: 'C', F: 'E' },
      mv: {
        2: zip(S_SWA, [29, 18, 11, 7.3, 4.4, 2.8, 1.75, 1.25, 0.93, 0.65, 0.49, 0.41, 0.34, 0.29, 0.24, 0.21]),
        3: zip(S_SWA, [25, 15, 9.5, 6.4, 3.8, 2.4, 1.50, 1.10, 0.80, 0.57, 0.43, 0.36, 0.29, 0.25, 0.21, 0.185])
      }
    },
    // 4E4A / 4E4B — multicore armoured 90 °C thermosetting (BS 5467, BS 6724)
    '4E4A': {
      title: 'Table 4E4A/4E4B — multicore armoured 90 °C thermosetting',
      maxT: 90, sizes: S_SWA,
      rating: {
        C2: zip(S_SWA, [27, 36, 49, 62, 85, 110, 146, 180, 219, 279, 338, 392, 451, 515, 607, 698]),
        C3: zip(S_SWA, [23, 31, 42, 53, 73, 94, 124, 154, 187, 238, 289, 335, 386, 441, 520, 599]),
        E2: zip(S_SWA, [29, 39, 52, 66, 90, 115, 152, 188, 228, 291, 354, 410, 472, 539, 636, 732]),
        E3: zip(S_SWA, [25, 33, 44, 56, 78, 99, 131, 162, 197, 251, 304, 353, 406, 463, 546, 628]),
        D2: zip(S_SWA, [25, 33, 43, 53, 71, 91, 116, 139, 164, 203, 239, 271, 306, 343, 395, 446]),
        D3: zip(S_SWA, [21, 28, 36, 44, 58, 75, 96, 115, 135, 167, 197, 223, 251, 281, 324, 365])
      },
      fallback: { A: 'C', B: 'C', F: 'E' },
      mv: {
        2: zip(S_SWA, [31, 19, 12, 7.9, 4.7, 2.9, 1.90, 1.35, 1.00, 0.71, 0.53, 0.43, 0.36, 0.30, 0.25, 0.22]),
        3: zip(S_SWA, [27, 16, 10, 6.8, 4.0, 2.5, 1.65, 1.15, 0.87, 0.61, 0.45, 0.37, 0.30, 0.26, 0.21, 0.185])
      }
    },
    // 4F3A / 4F3B — flexible cords, 60 °C rubber / 70 °C thermoplastic.
    // Above 4 mm² a flexible multicore is rated as 4D2A (flagged).
    'FLEX': {
      title: 'Table 4F3A/4F3B — flexible cords (above 4 mm², 4D2A)',
      maxT: 70, sizes: [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25],
      flat: {
        2: zip(S_FLEX, [3, 6, 10, 16, 25, 32]),
        3: zip(S_FLEX, [3, 6, 10, 16, 20, 25])
      },
      mvFlat: {
        2: zip(S_FLEX, [93, 62, 46, 32, 19, 12]),
        3: zip(S_FLEX, [80, 54, 40, 27, 16, 10])
      },
      above: '4D2A'
    }
  };

  const METHOD_LABEL = {
    A: 'A — enclosed in conduit in an insulated wall',
    B: 'B — in conduit or trunking on a wall',
    C: 'C — clipped direct',
    D: 'D — in a duct in the ground',
    E: 'E — free air / perforated tray, ladder or basket',
    M100: '100 — above a plasterboard ceiling, insulation ≤100 mm',
    M101: '101 — above a plasterboard ceiling, insulation >100 mm',
    M102: '102 — in a stud wall, touching the inner wall',
    M103: '103 — in a stud wall, not touching the inner wall'
  };

  function tableOf(key) { return TABLES[key]; }

  // The tabulated rating for a size by a method, following the table's
  // fallback when a method is not tabulated. Returns {it, method, fellBack}.
  function tabulated(tableKey, method, loaded, size) {
    const t = TABLES[tableKey];
    if (!t) return null;
    const L = loaded >= 3 ? 3 : 2;
    if (tableKey === 'FLEX') {
      if (size <= 4) {
        const v = t.flat[L][size];
        return v == null ? null : { it: v, method: 'flex', fellBack: false, table: '4F3A' };
      }
      const r = tabulated(t.above, method, loaded, size);
      return r ? Object.assign({}, r, { table: t.above, fellBack: true, note: 'flexible above 4 mm² rated as 4D2A' }) : null;
    }
    let m = method;
    let fellBack = false;
    const key = (mm) => (mm.startsWith('M') ? mm + '_' + L : mm + L);
    let guard = 0;
    while (!t.rating[key(m)] && guard++ < 4) {
      const fb = t.fallback && t.fallback[m];
      if (!fb) break;
      m = fb; fellBack = true;
    }
    let row = t.rating[key(m)];
    if (!row && t.singlePhaseOnly) row = t.rating[key(m).replace(/3$/, '2')];
    if (!row) return null;
    const v = row[size];
    return v == null ? null : { it: v, method: m, fellBack, table: tableKey };
  }

  function mvPerAm(tableKey, loaded, size) {
    const t = TABLES[tableKey];
    if (!t) return null;
    const L = loaded >= 3 ? 3 : 2;
    if (tableKey === 'FLEX') {
      if (size <= 4) return t.mvFlat[L][size];
      return mvPerAm(t.above, loaded, size);
    }
    const row = t.mv[L] || t.mv[2];
    if (!row) return null;
    if (!t.mv[L] && L === 3) return row[size] != null ? row[size] * SQRT3 / 2 : null;
    return row[size] != null ? row[size] : null;
  }

  // ------------------------------------------------------------------
  // Correction factors
  // ------------------------------------------------------------------
  // Table 4B1 — ambient air, not RCD/BS 3036 specific.
  const CA = {
    70: { 25: 1.03, 30: 1.00, 35: 0.94, 40: 0.87, 45: 0.79, 50: 0.71, 55: 0.61, 60: 0.50 },
    90: { 25: 1.02, 30: 1.00, 35: 0.96, 40: 0.91, 45: 0.87, 50: 0.82, 55: 0.76, 60: 0.71, 65: 0.65, 70: 0.58 }
  };
  function caFor(maxT, ambient) {
    const t = CA[maxT >= 90 ? 90 : 70];
    const keys = Object.keys(t).map(Number).sort((a, b) => a - b);
    const a = Number(ambient);
    if (!(a > keys[0])) return t[keys[0]];
    // the next tabulated temperature at or above — never interpolate down
    for (const k of keys) if (a <= k) return t[k];
    return 0; // hotter than the table: the cable cannot be used there
  }

  // Table 4C1 — grouping. Arrangement rows:
  //   enclosed — bunched in air, on a surface, embedded or enclosed (conduit, trunking)
  //   wall     — single layer on a wall or floor, touching
  //   tray     — single layer of multicores on a perforated tray, touching
  //   ladder   — single layer on ladder or cleats, touching
  //   spaced   — spaced by at least twice the diameter: no reduction
  const CG = {
    enclosed: [1.00, 0.80, 0.70, 0.65, 0.60, 0.57, 0.54, 0.52, 0.50, 0.48, 0.46, 0.45, 0.44, 0.43, 0.42, 0.41, 0.40, 0.39, 0.39, 0.38],
    wall:     [1.00, 0.85, 0.79, 0.75, 0.73, 0.72, 0.72, 0.71, 0.70],
    tray:     [1.00, 0.88, 0.82, 0.77, 0.75, 0.73, 0.73, 0.72, 0.72],
    ladder:   [1.00, 0.87, 0.82, 0.80, 0.80, 0.79, 0.79, 0.78, 0.78]
  };
  function cgFor(arr, n) {
    n = Math.max(1, Math.round(n || 1));
    if (arr === 'spaced') return 1;
    const row = CG[arr] || CG.enclosed;
    return row[Math.min(n, row.length) - 1];
  }

  // Table 52.2 — cable surrounded by thermal insulation for a short length.
  const CI = { none: 1, '50': 0.88, '100': 0.78, '200': 0.63, '400': 0.51, full: 0.5 };
  const CI_LABEL = {
    none: 'No thermal insulation', '50': 'Through insulation for 50 mm', '100': '… 100 mm',
    '200': '… 200 mm', '400': '… 400 mm', full: 'Surrounded for more than 0.5 m'
  };

  // Which Appendix 4 method and Table 4C1 row a kind of containment means.
  const CONTAINMENT_METHOD = {
    tray: { method: 'E', arr: 'tray' },
    ladder: { method: 'E', arr: 'ladder' },
    basket: { method: 'E', arr: 'tray' },
    trunking: { method: 'B', arr: 'enclosed' },
    conduit: { method: 'B', arr: 'enclosed' },
    flexconduit: { method: 'B', arr: 'enclosed' },
    cleats: { method: 'C', arr: 'wall' },
    duct: { method: 'D', arr: 'enclosed' }
  };

  // ------------------------------------------------------------------
  // Cable types
  // ------------------------------------------------------------------
  // Typical overall diameters (mm). Doncaster / Prysmian catalogue figures,
  // rounded; check the supplier's sheet before relying on a tight tray.
  const OD_SWA_XLPE = {
    2: zip(S_SWA, [12.0, 13.0, 14.6, 15.8, 18.0, 20.1, 22.0, 24.0, 25.0, 28.0, 31.6, 34.5, 38.0, 42.0, 47.0, 51.5]),
    3: zip(S_SWA, [12.4, 13.5, 15.3, 16.6, 18.8, 21.0, 24.4, 26.4, 27.0, 30.0, 34.0, 37.0, 41.0, 45.5, 50.5, 55.5]),
    4: zip(S_SWA, [13.1, 14.3, 16.2, 17.7, 20.2, 22.7, 26.6, 28.8, 30.0, 34.0, 38.5, 42.0, 46.5, 51.5, 58.0, 63.5]),
    5: zip(S_SWA, [14.0, 15.3, 17.4, 19.0, 21.7, 24.4, 29.0, 31.5, 35.5]),
    7: { 1.5: 15.0, 2.5: 16.6 }, 12: { 1.5: 18.4, 2.5: 20.6 }, 19: { 1.5: 21.0, 2.5: 23.6 }, 27: { 1.5: 24.4, 2.5: 27.5 }
  };
  // Steel wire armour: resistance at 20 °C (Ω/km) and gross area (mm²).
  const ARMOUR_R = {
    2: zip(S_SWA, [10.2, 8.8, 7.9, 7.0, 6.0, 3.7, 3.7, 3.4, 2.6, 2.2, 1.7, 1.5, 1.4, 1.2, 1.0, 0.76]),
    3: zip(S_SWA, [9.5, 8.2, 7.5, 6.4, 3.9, 3.5, 2.6, 2.4, 2.0, 1.8, 1.4, 1.3, 1.1, 0.81, 0.71, 0.64]),
    4: zip(S_SWA, [9.0, 7.7, 4.6, 4.2, 3.6, 3.1, 2.3, 2.0, 1.8, 1.2, 1.1, 0.98, 0.71, 0.63, 0.56, 0.50]),
    5: zip(S_SWA, [8.5, 7.3, 4.3, 3.9, 3.3, 2.8, 2.1, 1.8, 1.6])
  };
  const ARMOUR_A = {
    2: zip(S_SWA, [16, 17, 21, 24, 28, 42, 42, 46, 62, 72, 96, 106, 120, 136, 154, 220]),
    3: zip(S_SWA, [17, 19, 23, 26, 42, 46, 62, 68, 78, 90, 112, 126, 146, 204, 234, 262]),
    4: zip(S_SWA, [18, 20, 35, 38, 44, 52, 72, 80, 94, 131, 146, 166, 229, 258, 294, 328]),
    5: zip(S_SWA, [20, 22, 38, 42, 48, 58, 80, 90, 106])
  };
  const OD_SINGLE = zip(S_SINGLE, [2.8, 3.0, 3.6, 4.2, 4.8, 6.1, 7.2, 8.9, 10.1, 11.9, 13.8, 15.9, 17.6, 19.6, 21.9, 25.0, 27.9]);
  const OD_TRI = { 0.5: 2.4, 0.75: 2.6, 1: 2.9, 1.5: 3.1, 2.5: 3.8, 4: 4.4, 6: 5.0, 10: 6.6, 16: 7.8, 25: 9.7, 35: 11.0, 50: 12.8, 70: 14.8, 95: 17.1 };
  // flat twin & earth: width (lies flat on the tray) and thickness
  const OD_TE = { 1: [7.8, 4.1], 1.5: [8.4, 4.4], 2.5: [9.9, 5.2], 4: [11.3, 5.8], 6: [12.9, 6.4], 10: [16.4, 7.9], 16: [18.8, 9.0] };
  const OD_TE3 = { 1: [9.8, 4.4], 1.5: [10.6, 4.8], 2.5: [12.5, 5.4] };
  const TE_CPC = { 1: 1, 1.5: 1, 2.5: 1.5, 4: 1.5, 6: 2.5, 10: 4, 16: 6 };
  const OD_FP200 = {
    2: { 1: 7.2, 1.5: 7.8, 2.5: 8.8, 4: 10.2 },
    3: { 1: 7.6, 1.5: 8.3, 2.5: 9.4, 4: 10.9 },
    4: { 1: 8.3, 1.5: 9.0, 2.5: 10.3, 4: 12.0 }
  };
  const OD_YY = {
    2: { 0.5: 5.4, 0.75: 5.9, 1: 6.3, 1.5: 7.0, 2.5: 8.3, 4: 9.8, 6: 11.2 },
    3: { 0.5: 5.7, 0.75: 6.2, 1: 6.7, 1.5: 7.4, 2.5: 8.9, 4: 10.6, 6: 12.2, 10: 15.0, 16: 17.5, 25: 22.0 },
    4: { 0.5: 6.2, 0.75: 6.8, 1: 7.3, 1.5: 8.2, 2.5: 9.8, 4: 11.7, 6: 13.4, 10: 16.6, 16: 19.5, 25: 24.5 },
    5: { 0.5: 6.8, 0.75: 7.4, 1: 8.0, 1.5: 9.0, 2.5: 10.8, 4: 12.9, 6: 14.8, 10: 18.4, 16: 21.6, 25: 27.0 },
    7: { 0.5: 7.4, 0.75: 8.1, 1: 8.8, 1.5: 9.9, 2.5: 12.0 },
    12: { 0.5: 9.5, 0.75: 10.4, 1: 11.3, 1.5: 12.7, 2.5: 15.6 },
    18: { 0.5: 11.0, 0.75: 12.1, 1: 13.1, 1.5: 14.9 },
    25: { 0.5: 13.0, 0.75: 14.3, 1: 15.6, 1.5: 17.7 }
  };
  const OD_H07 = {
    2: { 1: 8.6, 1.5: 9.6, 2.5: 11.4 },
    3: { 1: 9.2, 1.5: 10.4, 2.5: 12.4, 4: 14.4, 6: 16.0, 10: 20.5, 16: 23.5, 25: 28.5 },
    4: { 1: 10.1, 1.5: 11.4, 2.5: 13.5, 4: 15.6, 6: 17.6, 10: 22.6, 16: 25.8, 25: 31.4 },
    5: { 1: 11.0, 1.5: 12.6, 2.5: 14.8, 4: 17.2, 6: 19.5, 10: 24.8, 16: 28.5, 25: 34.6 }
  };
  const OD_INSTR = { 1: { 0.5: 5.6, 0.75: 6.2, 1: 6.6, 1.5: 7.4 }, 2: { 0.5: 7.8, 0.75: 8.6, 1: 9.4, 1.5: 10.6 }, 5: { 0.5: 11.6, 0.75: 12.8, 1: 14.0 }, 10: { 0.5: 15.4, 0.75: 17.2 } };

  function lookupOd(table, cores, size) {
    const row = table[cores];
    if (row && row[size] != null) return row[size];
    // nearest tabulated core count above, then below
    const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
    const up = keys.find(k => k >= cores && table[k][size] != null);
    if (up != null) return table[up][size];
    const dn = keys.slice().reverse().find(k => table[k][size] != null);
    return dn != null ? table[dn][size] : null;
  }

  // use: power — sized to Appendix 4. control — sized on volt drop from VA.
  // signal — measured and length-checked only.
  const CABLE_TYPES = {
    swa: {
      label: 'SWA XLPE/PVC (BS 5467)', short: 'SWA', group: 'Power — armoured', use: 'power',
      table: '4E4A', maxT: 90, armoured: true, sizes: S_SWA, cpcModes: ['core', 'armour'], defaultCpc: 'core',
      kCore: 143, kArmour: 46, od: (c, s) => lookupOd(OD_SWA_XLPE, c, s), cores: [2, 3, 4, 5, 7, 12, 19, 27]
    },
    swaLsz: {
      label: 'SWA XLPE/LSZH (BS 6724)', short: 'SWA LSZH', group: 'Power — armoured', use: 'power',
      table: '4E4A', maxT: 90, armoured: true, sizes: S_SWA, cpcModes: ['core', 'armour'], defaultCpc: 'core',
      kCore: 143, kArmour: 46, od: (c, s) => { const v = lookupOd(OD_SWA_XLPE, c, s); return v && v + 0.4; }, cores: [2, 3, 4, 5, 7, 12, 19, 27]
    },
    swaPvc: {
      label: 'SWA PVC/PVC (BS 6346)', short: 'SWA PVC', group: 'Power — armoured', use: 'power',
      table: '4D4A', maxT: 70, armoured: true, sizes: S_SWA, cpcModes: ['core', 'armour'], defaultCpc: 'core',
      kCore: 115, kArmour: 51, od: (c, s) => { const v = lookupOd(OD_SWA_XLPE, c, s); return v && v + 0.8; }, cores: [2, 3, 4, 5, 7, 12, 19, 27]
    },
    vsd: {
      label: 'VSD / EMC screened SWA (3c + 3E)', short: 'VSD SWA', group: 'Power — armoured', use: 'power',
      table: '4E4A', maxT: 90, armoured: true, sizes: S_SWA.filter(s => s >= 1.5 && s <= 240), cpcModes: ['vsdEarth'], defaultCpc: 'vsdEarth',
      kCore: 143, kArmour: 46, od: (c, s) => { const v = lookupOd(OD_SWA_XLPE, 4, s); return v && v + 1.5; }, cores: [3], fixedCores: 3,
      note: 'Symmetrical 3 earth cores (about half the phase area) plus an overall screen. Glanded with EMC glands at both ends.'
    },
    fp600: {
      label: 'FP600S enhanced fire resistant (BS 7846 F120)', short: 'FP600S', group: 'Power — armoured', use: 'power',
      table: '4E4A', maxT: 90, armoured: true, sizes: S_SWA, cpcModes: ['core', 'armour'], defaultCpc: 'core',
      kCore: 143, kArmour: 46, od: (c, s) => { const v = lookupOd(OD_SWA_XLPE, c, s); return v && v + 0.6; }, cores: [2, 3, 4, 5, 7, 12]
    },
    te: {
      label: 'Twin & earth 6242Y (BS 6004)', short: 'T&E', group: 'Power — sheathed', use: 'power',
      table: '4D5', maxT: 70, armoured: false, sizes: S_TE, cpcModes: ['te'], defaultCpc: 'te', singlePhaseOnly: true,
      kCore: 115, flat: true, od: (c, s) => { const t = c >= 4 ? OD_TE3 : OD_TE; return t[s] ? t[s][0] : null; },
      thick: (c, s) => { const t = c >= 4 ? OD_TE3 : OD_TE; return t[s] ? t[s][1] : null; }, cores: [3, 4],
      note: 'Flat cable: the tray takes its width. CPC is the reduced bare conductor (2.5/1.5, 4/1.5, 6/2.5, 10/4, 16/6).'
    },
    single: {
      label: 'Singles 6491X (BS 6004 / H07V-R)', short: '6491X', group: 'Power — singles', use: 'power',
      table: '4D1A', maxT: 70, armoured: false, sizes: S_SINGLE, cpcModes: ['separate'], defaultCpc: 'separate',
      kCore: 143, singles: true, od: (c, s) => OD_SINGLE[s] || null, cores: [1],
      note: 'Unsheathed — must be enclosed in conduit or trunking (521.10.1). CPC is a separate single sized to Table 54.7.'
    },
    singleLsz: {
      label: 'Singles 6491B LSZH (BS 7211)', short: '6491B', group: 'Power — singles', use: 'power',
      table: '4D1A', maxT: 70, armoured: false, sizes: S_SINGLE, cpcModes: ['separate'], defaultCpc: 'separate',
      kCore: 143, singles: true, od: (c, s) => { const v = OD_SINGLE[s]; return v && v + 0.2; }, cores: [1]
    },
    tri: {
      label: 'Tri-rated singles (BS 6231)', short: 'Tri-rated', group: 'Power — singles', use: 'power',
      table: '4D1A', maxT: 70, armoured: false, sizes: S_SINGLE.filter(s => s <= 95), cpcModes: ['separate'], defaultCpc: 'separate',
      kCore: 143, singles: true, od: (c, s) => OD_TRI[s] || null, cores: [1],
      note: 'Panel and switchgear wiring. Rated here to 70 °C single-core figures (4D1A) — conservative for a 90 °C cable.'
    },
    fp200: {
      label: 'FP200 Gold fire resistant (BS 7629-1)', short: 'FP200', group: 'Fire & life safety', use: 'power',
      table: '4D2A', maxT: 70, armoured: false, sizes: [1, 1.5, 2.5, 4], cpcModes: ['core'], defaultCpc: 'core',
      kCore: 115, od: (c, s) => lookupOd(OD_FP200, Math.min(4, c - 1 || 2), s), cores: [3, 4, 5],
      note: 'Cores counted with the CPC (2c+E = 3). Fire alarm, emergency lighting and life-safety circuits.'
    },
    yy: {
      label: 'YY flexible control (PVC/PVC)', short: 'YY', group: 'Flexible & control', use: 'power', control: true,
      table: 'FLEX', maxT: 70, armoured: false, sizes: [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25], cpcModes: ['core'], defaultCpc: 'core',
      kCore: 115, flexible: true, od: (c, s) => lookupOd(OD_YY, c, s), cores: [2, 3, 4, 5, 7, 12, 18, 25]
    },
    cy: {
      label: 'CY screened flexible (copper braid)', short: 'CY', group: 'Flexible & control', use: 'power', control: true,
      table: 'FLEX', maxT: 70, armoured: false, sizes: [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25], cpcModes: ['core'], defaultCpc: 'core',
      kCore: 115, flexible: true, od: (c, s) => { const v = lookupOd(OD_YY, c, s); return v && v + 1.2; }, cores: [2, 3, 4, 5, 7, 12, 18, 25]
    },
    sy: {
      label: 'SY steel braided flexible', short: 'SY', group: 'Flexible & control', use: 'power', control: true,
      table: 'FLEX', maxT: 70, armoured: false, sizes: [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25], cpcModes: ['core'], defaultCpc: 'core',
      kCore: 115, flexible: true, od: (c, s) => { const v = lookupOd(OD_YY, c, s); return v && v + 2.0; }, cores: [2, 3, 4, 5, 7, 12, 18, 25]
    },
    h07: {
      label: 'H07RN-F rubber flexible (arctic grade)', short: 'H07RN-F', group: 'Flexible & control', use: 'power',
      table: 'FLEX', maxT: 70, armoured: false, sizes: [1, 1.5, 2.5, 4, 6, 10, 16, 25], cpcModes: ['core'], defaultCpc: 'core',
      kCore: 115, flexible: true, od: (c, s) => lookupOd(OD_H07, c, s), cores: [2, 3, 4, 5]
    },
    instr: {
      label: 'Instrumentation, screened pairs (BS EN 50288-7)', short: 'Instr', group: 'Flexible & control', use: 'control',
      table: null, maxT: 70, armoured: false, sizes: [0.5, 0.75, 1, 1.5], cpcModes: ['none'], defaultCpc: 'none',
      od: (c, s) => lookupOd(OD_INSTR, c, s), cores: [1, 2, 5, 10], coreWord: 'pair', pairs: true
    },
    bms: {
      label: 'BMS bus twisted pair, screened (Belden 8723 type)', short: 'BMS TP', group: 'Data & signal', use: 'signal',
      table: null, sizes: [0.34], cpcModes: ['none'], defaultCpc: 'none', od: () => 4.6, cores: [2], coreWord: 'pair', pairs: true,
      maxLenM: 1200, maxLenNote: 'RS-485 / BACnet MS/TP segment 1200 m'
    },
    cat6: {
      label: 'Cat6 U/UTP LSZH', short: 'Cat6', group: 'Data & signal', use: 'signal',
      table: null, sizes: [0.2], cpcModes: ['none'], defaultCpc: 'none', od: () => 6.2, cores: [4], coreWord: 'pair', pairs: true,
      maxLenM: 90, maxLenNote: 'permanent link 90 m (channel 100 m)'
    },
    cat6a: {
      label: 'Cat6A F/UTP LSZH', short: 'Cat6A', group: 'Data & signal', use: 'signal',
      table: null, sizes: [0.25], cpcModes: ['none'], defaultCpc: 'none', od: () => 7.5, cores: [4], coreWord: 'pair', pairs: true,
      maxLenM: 90, maxLenNote: 'permanent link 90 m (channel 100 m)'
    }
  };

  // Overall diameter of one cable (or one single) in mm.
  function cableOd(typeKey, cores, size, odOverride) {
    if (odOverride > 0) return odOverride;
    const t = CABLE_TYPES[typeKey];
    if (!t) return null;
    return t.od(cores, size);
  }

  // How many conductors a cable needs for a circuit.
  function coresFor(typeKey, phase, neutral, cpc) {
    const t = CABLE_TYPES[typeKey];
    if (!t) return 2;
    if (t.fixedCores) return t.fixedCores;
    const live = phase === 3 ? (neutral ? 4 : 3) : 2;
    if (t.singles) return 1;
    if (t.use === 'signal') return t.cores[0];
    if (cpc === 'core' || cpc === 'te' || t.flexible) return live + 1;
    return live;
  }
  // Number of single cables pulled for a singles circuit (lines, N, CPC).
  function singlesCount(phase, neutral) {
    return (phase === 3 ? (neutral ? 4 : 3) : 2) + 1;
  }

  // CPC area (mm²) for a cable and line size.
  function cpcArea(typeKey, cpc, cores, size) {
    const t = CABLE_TYPES[typeKey];
    if (cpc === 'armour') return (ARMOUR_A[Math.min(5, cores)] || {})[size] || null;
    if (cpc === 'te') return TE_CPC[size] || null;
    if (cpc === 'vsdEarth') return nearestStd(size * 0.5, 'up');
    if (cpc === 'separate') {
      if (size <= 16) return size;
      if (size <= 35) return 16;
      return nearestStd(size / 2, 'up');
    }
    if (cpc === 'none') return null;
    return size; // a core of the cable
  }
  function cpcRPerM(typeKey, cpc, cores, size) {
    // mΩ/m at 20 °C
    if (cpc === 'armour') {
      const r = (ARMOUR_R[Math.min(5, cores)] || {})[size];
      return r == null ? null : r; // Ω/km == mΩ/m
    }
    const a = cpcArea(typeKey, cpc, cores, size);
    return a ? R20[a] || null : null;
  }
  function nearestStd(a, dir) {
    if (dir === 'up') return STD_SIZES.find(s => s >= a - 1e-9) || STD_SIZES[STD_SIZES.length - 1];
    return STD_SIZES.slice().reverse().find(s => s <= a + 1e-9) || STD_SIZES[0];
  }

  // ------------------------------------------------------------------
  // Protective devices
  // ------------------------------------------------------------------
  const MCB_RATINGS = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125];
  const MCCB_RATINGS = [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630];
  const BS88_RATINGS = [2, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200];
  // BS 88-2 gG fuses, maximum Zs (Ω) — Table 41.2 (0.4 s) and Table 41.4 (5 s), Cmin 0.95.
  const BS88_ZS = {
    0.4: { 2: 33.1, 4: 15.6, 6: 7.80, 10: 4.65, 16: 2.43, 20: 1.68, 25: 1.29, 32: 0.99, 40: 0.79, 50: 0.56, 63: 0.43 },
    5: { 2: 44, 4: 21, 6: 11.1, 10: 6.42, 16: 3.71, 20: 2.87, 25: 2.21, 32: 1.67, 40: 1.36, 50: 1.02, 63: 0.82, 80: 0.62, 100: 0.43, 125: 0.35, 160: 0.29, 200: 0.20 }
  };
  const DEVICES = {
    mcb: {
      label: 'MCB (BS EN 60898)', ratings: MCB_RATINGS, curves: ['B', 'C', 'D'], kA: [6, 10, 15, 25], defaultKA: 10
    },
    mccb: {
      label: 'MCCB (BS EN 60947-2)', ratings: MCCB_RATINGS, curves: [], kA: [16, 25, 36, 50, 70], defaultKA: 36
    },
    bs88: {
      label: 'Fuse BS 88-2 gG', ratings: BS88_RATINGS, curves: [], kA: [50, 80], defaultKA: 80
    }
  };
  const MCB_INST = { B: 5, C: 10, D: 20 };     // trips instantaneously by this × In
  const MCB_HOLD = { B: 3, C: 5, D: 10 };      // will not trip below this × In
  const CMIN = 0.95;

  function deviceLabel(dev, In) {
    if (!dev) return '';
    if (dev.family === 'mcb') return 'MCB ' + dev.curve + (In || '') + (dev.rcd ? ' RCBO ' + dev.rcd + 'mA' : '');
    if (dev.family === 'mccb') return 'MCCB ' + (In || '') + 'A' + (dev.rcd ? ' + RCD ' + dev.rcd + 'mA' : '');
    return 'BS 88 ' + (In || '') + 'A gG' + (dev.rcd ? ' + RCD ' + dev.rcd + 'mA' : '');
  }

  // Maximum earth fault loop impedance for a device and disconnection time.
  function zsMax(dev, In, tDisc) {
    if (dev.family === 'mcb') {
      let mult = MCB_INST[dev.curve] || 10;
      if (dev.curve === 'D' && tDisc >= 5) mult = 10;
      return U0 * CMIN / (mult * In);
    }
    if (dev.family === 'mccb') {
      const im = (dev.im || 10) * In;
      return U0 * CMIN / im;
    }
    const tbl = BS88_ZS[tDisc >= 5 ? 5 : 0.4];
    return tbl[In] != null ? tbl[In] : null;
  }
  // Time to disconnect at a fault current, for the adiabatic check.
  function faultTime(dev, In, If, zs, tReq) {
    if (dev.family === 'mcb') {
      return If >= (MCB_INST[dev.curve] || 10) * In ? 0.1 : 5;
    }
    if (dev.family === 'mccb') {
      return If >= (dev.im || 10) * In ? 0.1 : 5;
    }
    const z04 = BS88_ZS[0.4][In];
    if (z04 != null && zs <= z04) return 0.4;
    return 5;
  }

  // ------------------------------------------------------------------
  // Loads
  // ------------------------------------------------------------------
  const LOAD_KINDS = {
    motor: { label: 'Motor', motor: true, glyph: 'M' },
    pump: { label: 'Pump', motor: true, glyph: 'P' },
    fan: { label: 'Fan', motor: true, glyph: 'F' },
    ahu: { label: 'AHU', motor: true, glyph: 'AHU' },
    chiller: { label: 'Chiller / condenser', motor: true, glyph: 'CH' },
    boiler: { label: 'Boiler / burner', motor: false, glyph: 'B' },
    heater: { label: 'Heater / trace heating', motor: false, glyph: 'H' },
    lighting: { label: 'Lighting', motor: false, lighting: true, glyph: 'L' },
    sockets: { label: 'Socket outlets', motor: false, glyph: 'S' },
    vsdpanel: { label: 'Control panel / VSD panel', motor: false, glyph: 'CP' },
    general: { label: 'General load', motor: false, glyph: 'G' }
  };
  const DRIVES = {
    DOL: { label: 'Direct on line', start: 6 },
    SD: { label: 'Star-delta', start: 2.5 },
    SS: { label: 'Soft starter', start: 3 },
    VSD: { label: 'VSD / inverter', start: 1 },
    NA: { label: 'Not a motor', start: 1 }
  };

  // Design current. kW is what the manufacturer gives for the electrical
  // input unless kwBasis is 'output' (motor shaft), when efficiency applies.
  // A typed maximum current always wins over the kW figure.
  function designCurrent(load) {
    const phase = load.phase === 1 ? 1 : 3;
    const kw = Number(load.kw) || 0;
    const pf = Number(load.pf) > 0 ? Number(load.pf) : 0.85;
    const eff = load.kwBasis === 'output' ? (Number(load.eff) > 0 ? Number(load.eff) : 0.9) : 1;
    const fromKw = kw > 0 ? (phase === 3 ? kw * 1000 / (SQRT3 * U3 * pf * eff) : kw * 1000 / (U1 * pf * eff)) : 0;
    const typed = Number(load.amps) > 0 ? Number(load.amps) : 0;
    const ib = typed > 0 ? typed : fromKw;
    const kind = LOAD_KINDS[load.kind] || LOAD_KINDS.general;
    const drive = kind.motor ? (load.drive || 'DOL') : 'NA';
    const startMult = Number(load.startMult) > 0 ? Number(load.startMult) : (DRIVES[drive] || DRIVES.NA).start;
    const peak = Number(load.peakA) > 0 ? Number(load.peakA) : ib * startMult;
    return { ib, fromKw, typed, phase, drive, start: kind.motor ? peak : ib, startMult, basis: typed > 0 ? 'typed' : 'kW' };
  }

  // ------------------------------------------------------------------
  // Isolators, glands, containment fill
  // ------------------------------------------------------------------
  const ISOLATOR_RATINGS = [16, 20, 25, 32, 40, 63, 80, 100, 125, 160];
  const ISOLATOR_ENCLOSURES = {
    poly: 'Polycarbonate', grp: 'GRP', metal: 'Metal clad (painted steel)', ss304: 'Stainless steel 304', ss316: 'Stainless steel 316'
  };
  const ISOLATOR_IP = ['IP65', 'IP66', 'IP66/67', 'IP69K'];
  function pickIsolator(In, phase, neutral, drive, prefs) {
    prefs = prefs || {};
    const rating = ISOLATOR_RATINGS.find(r => r >= In) || null;
    let poles = phase === 3 ? (neutral ? '4P' : '3P') : '2P';
    let aux = false;
    if (drive === 'VSD') { aux = true; if (phase === 3 && !neutral) poles = '6P'; }
    return {
      rating, poles: prefs.poles && prefs.poles !== 'auto' ? prefs.poles : poles,
      aux: prefs.aux != null ? !!prefs.aux : aux,
      duty: drive && drive !== 'NA' ? 'AC-23A' : 'AC-22A'
    };
  }

  // Cable glands. Outer sheath ranges (mm) for CW / BW type, CMP / Hawke typical.
  const GLAND_SIZES = [
    ['20S16', 6.1, 11.5], ['20S', 9.5, 15.9], ['20', 15.5, 21.1], ['25', 22.0, 28.0], ['32', 27.5, 34.8],
    ['40', 33.0, 41.0], ['50S', 39.5, 47.2], ['50', 45.5, 53.0], ['63S', 52.5, 59.4], ['63', 58.0, 65.3],
    ['75S', 64.0, 72.0], ['75', 70.0, 78.0]
  ];
  // Nylon compression glands (IP68) for unarmoured cable.
  const NYLON_GLANDS = [['M16', 4.5, 10], ['M20', 6, 13], ['M25', 13, 18], ['M32', 18, 25], ['M40', 22, 32], ['M50', 30, 38], ['M63', 37, 44]];
  function glandFor(od, armoured) {
    const list = armoured ? GLAND_SIZES : NYLON_GLANDS;
    const g = list.find(x => od >= x[1] - 1e-9 && od <= x[2] + 1e-9) || list.find(x => od <= x[2]);
    return g ? g[0] : 'Oversize';
  }
  const GLAND_TYPES = {
    BW: 'BW — indoor, armour clamp only',
    CW: 'CW — outdoor, inner + outer seal',
    CXT: 'CXT — hazardous area / barrier',
    EMC: 'EMC — 360° screen termination (VSD)'
  };

  // Flexible conduit (Adaptaflex / Kopex type) for a tail, by cable OD.
  const FLEX_CONDUIT = [[16, 8.5], [20, 11.5], [25, 15.5], [32, 21], [40, 27], [50, 35], [63, 46]];
  function flexConduitFor(od) {
    const f = FLEX_CONDUIT.find(x => od <= x[1]);
    return f ? f[0] : null;
  }

  const CONTAINMENT = {
    tray: {
      label: 'Cable tray (perforated)', widths: [50, 75, 100, 150, 225, 300, 450, 600, 750, 900], depths: [25, 50],
      duties: { light: 'Light duty', medium: 'Medium duty', heavy: 'Heavy duty' }, defaultDuty: 'medium', stockM: 3, fill: 'width'
    },
    ladder: {
      label: 'Cable ladder', widths: [150, 300, 450, 600, 750, 900], depths: [100, 125, 150],
      duties: { medium: 'Medium duty', heavy: 'Heavy duty' }, defaultDuty: 'heavy', stockM: 3, fill: 'width'
    },
    basket: {
      label: 'Wire basket tray', widths: [50, 100, 150, 200, 300, 400, 500, 600], depths: [50, 100],
      duties: { light: 'Standard' }, defaultDuty: 'light', stockM: 3, fill: 'width'
    },
    trunking: {
      label: 'Steel trunking', sizes: [[50, 50], [75, 75], [100, 50], [100, 100], [150, 50], [150, 75], [150, 100], [150, 150], [225, 75], [225, 150], [300, 100], [300, 150]],
      duties: { std: 'Steel' }, defaultDuty: 'std', stockM: 3, fill: 'area'
    },
    pvctrunking: {
      label: 'PVC trunking / mini trunking', sizes: [[16, 16], [25, 16], [25, 25], [38, 16], [38, 25], [40, 40], [50, 50], [75, 75], [100, 50], [100, 100]],
      duties: { std: 'PVC-U' }, defaultDuty: 'std', stockM: 3, fill: 'area', methodKey: 'trunking'
    },
    conduit: {
      label: 'Steel conduit', bores: [20, 25, 32, 38, 50], duties: { std: 'Heavy gauge steel' }, defaultDuty: 'std', stockM: 3.75, fill: 'conduit'
    },
    pvcconduit: {
      label: 'PVC conduit', bores: [16, 20, 25, 32, 38, 50], duties: { std: 'Heavy gauge PVC' }, defaultDuty: 'std', stockM: 3, fill: 'conduit', methodKey: 'conduit'
    },
    cleats: {
      label: 'Cleated / clipped direct (no containment)', widths: [], duties: { std: 'Cleats / clips' }, defaultDuty: 'std', stockM: 0, fill: 'none'
    }
  };
  const FINISHES = { prg: 'Pre-galvanised', hdg: 'Hot-dip galvanised', ss316: 'Stainless steel 316', ss304: 'Stainless steel 304', pvc: 'PVC / plastic' };

  // Fill on a width basis (tray, ladder, basket): the cables side by side
  // plus the spare allowance. Spaced cables need a clearance of 2 D each.
  function widthRequired(ods, sparePct, spaced) {
    const sum = ods.reduce((a, d) => a + d, 0);
    const gaps = spaced ? ods.reduce((a, d) => a + 2 * d, 0) : 0;
    return (sum + gaps) * (1 + (Number(sparePct) || 0) / 100);
  }
  function pickWidth(kind, reqMm) {
    const c = CONTAINMENT[kind];
    if (!c || !c.widths || !c.widths.length) return null;
    return c.widths.find(w => w >= reqMm - 1e-9) || null;
  }
  // Fill on an area basis (trunking): cable areas within the space factor.
  function areaOf(ods) { return ods.reduce((a, d) => a + Math.PI * d * d / 4, 0); }
  function pickTrunking(kind, ods, spaceFactor, sparePct) {
    const c = CONTAINMENT[kind];
    const need = areaOf(ods) * (1 + (Number(sparePct) || 0) / 100);
    const sf = (Number(spaceFactor) || 45) / 100;
    const s = c.sizes.find(([w, h]) => w * h * sf >= need);
    return { size: s || null, needMm2: need, sf };
  }
  // Conduit: cable area within the space factor of the bore area.
  function pickConduit(kind, ods, spaceFactor) {
    const c = CONTAINMENT[kind];
    const need = areaOf(ods);
    const sf = (Number(spaceFactor) || 40) / 100;
    const b = c.bores.find(d => Math.PI * d * d / 4 * sf >= need);
    return { bore: b || null, needMm2: need, sf };
  }

  // Default support spacing (m) and what one support is made of.
  const SUPPORT_SPACING = { tray: 1.5, ladder: 2.0, basket: 1.5, trunking: 1.5, pvctrunking: 1.0, conduit: 1.75, pvcconduit: 1.0, cleats: 0.4 };
  const MOUNTS = {
    droprod: 'Ceiling — drop rods & unistrut trapeze',
    beamclamp: 'Steel beam — beam clamps, drop rods & trapeze',
    cantilever: 'Wall — unistrut cantilever arms',
    wallbracket: 'Wall — direct brackets / stand-off',
    wallflat: 'Wall — fixed flat to wall (screws & plugs)',
    floor: 'Floor / plant deck — unistrut stands',
    saddle: 'Saddles / spacer bar saddles (conduit)',
    cleat: 'Cable cleats / P-clips'
  };
  const UNISTRUT_ARMS = [150, 300, 450, 600, 750];
  function supportKit(mount, kind, widthMm, dropM, opts) {
    opts = opts || {};
    const items = [];
    const add = (item, qty, unit) => items.push({ item, qty, unit: unit || 'nr' });
    const w = widthMm || 100;
    switch (mount) {
      case 'droprod':
      case 'beamclamp': {
        const rods = w > 450 ? 2 : 2;
        const rodLen = Math.max(0.1, Math.ceil(((dropM || 0.5) + 0.1) * 10) / 10);
        add('M10 threaded drop rod', +(rods * rodLen).toFixed(2), 'm');
        add('41×41 unistrut channel (trapeze)', +((w + 150) / 1000).toFixed(2), 'm');
        add('M10 channel nut + washer', rods * 2);
        add('M10 nut + washer (rod)', rods * 2);
        if (mount === 'beamclamp') add('Beam clamp M10', rods);
        else add('M10 ceiling anchor (throughbolt / shield)', rods);
        add('Channel end cap', 2);
        break;
      }
      case 'cantilever': {
        const arm = UNISTRUT_ARMS.find(a => a >= w) || UNISTRUT_ARMS[UNISTRUT_ARMS.length - 1];
        add('Unistrut cantilever arm ' + arm + ' mm', 1);
        add('41×41 unistrut channel (wall upright, 0.3 m)', 0.3, 'm');
        add('M10 wall anchor', 2);
        add('M10 channel nut + set screw', 2);
        break;
      }
      case 'wallbracket':
        add('Wall support bracket ' + w + ' mm', 1);
        add('M8 wall anchor', 2);
        add('M6 tray bolt + nut', 2);
        break;
      case 'wallflat':
        add('No. 10 screw + plug', kind === 'pvctrunking' || kind === 'pvcconduit' ? 2 : 2);
        break;
      case 'floor':
        add('Unistrut floor stand (2 legs)', 1);
        add('41×41 unistrut channel (stand)', +((w + 150) / 1000 + 1.0).toFixed(2), 'm');
        add('M10 floor anchor', 4);
        break;
      case 'saddle':
        add(kind === 'pvcconduit' ? 'PVC saddle' : 'Spacer bar saddle', 1);
        add('No. 10 screw + plug', 2);
        break;
      case 'cleat':
        add('Cable cleat / P-clip', opts.cables || 1);
        add('Screw + plug / channel fixing', opts.cables || 1);
        break;
      default:
        break;
    }
    return items;
  }

  // ------------------------------------------------------------------
  // Sizing
  // ------------------------------------------------------------------
  // circ: {
  //   kind: 'power' | 'submain' | 'control',
  //   load: {phase, neutral, kind, kw, kwBasis, pf, eff, amps, peakA, drive, startMult, overloadAtStarter} (power)
  //   ib: number (submain — already rolled up), phase, neutral
  //   ctrl: {volts, va, signal} (control)
  //   board: {zdb, pfcKA, upstreamPct}
  //   device: {family, curve, rating (null = auto), kA, im, rcd}
  //   legs: [{ role, type, cpc, cores (null = auto), lengthM, conds: [{method, arr, n, ambient}], ci, step, odOverride }]
  // }
  // settings: { vdLighting, vdOther, vdStart, vdControl, earthing, finalDiscT, distDiscT, maxFinalA }
  function sizeCircuit(circ, settings) {
    settings = settings || {};
    if (circ.kind === 'control') return sizeControl(circ, settings);

    const out = { kind: circ.kind, legs: [], checks: [], warnings: [], ok: true };
    const load = circ.load || {};
    let dc;
    if (circ.kind === 'submain') {
      const phase = circ.phase === 1 ? 1 : 3;
      dc = { ib: circ.ib || 0, fromKw: circ.ib || 0, typed: 0, phase, drive: 'NA', start: circ.ib || 0, startMult: 1, basis: 'roll-up' };
    } else {
      dc = designCurrent(load);
    }
    const phase = dc.phase;
    const neutral = circ.kind === 'submain' ? circ.neutral !== false : !!load.neutral;
    const loaded = phase === 3 ? 3 : 2;
    const U = phase === 3 ? U3 : U1;
    out.ib = dc.ib; out.phase = phase; out.start = dc.start; out.drive = dc.drive; out.dc = dc;

    const dev = Object.assign({ family: 'mcb', curve: 'C', kA: null, im: 10, rcd: 0 }, circ.device || {});
    const fam = DEVICES[dev.family] || DEVICES.mcb;
    out.device = dev;

    // Disconnection time required (411.3.2): final circuits up to 32 A in
    // 0.4 s on TN (0.2 s on TT); distribution circuits and larger finals 5 s.
    const earthing = settings.earthing || 'TN-S';
    const isFinal = circ.kind !== 'submain';

    // --- protective device ---------------------------------------------
    const motorStart = (dc.drive === 'DOL' || dc.drive === 'SD' || dc.drive === 'SS') ? dc.start : 0;
    function minRatingFor() {
      let need = dc.ib;
      if (motorStart > 0) {
        if (dev.family === 'mcb') need = Math.max(need, 1.2 * motorStart / (MCB_HOLD[dev.curve] || 5));
        if (dev.family === 'bs88' && dc.drive === 'DOL') need = Math.max(need, motorStart / 2.5);
      }
      return need;
    }
    let In;
    const autoIn = fam.ratings.find(r => r >= minRatingFor() - 1e-9) || null;
    if (dev.rating) In = Number(dev.rating); else In = autoIn;
    out.In = In; out.autoIn = autoIn;
    if (!In) {
      out.ok = false;
      out.checks.push({ id: 'device', ok: false, text: 'No ' + fam.label + ' large enough for ' + dc.ib.toFixed(1) + ' A' });
      return out;
    }
    if (In < dc.ib) out.checks.push({ id: 'ibIn', ok: false, text: 'Device ' + In + ' A is below the design current ' + dc.ib.toFixed(1) + ' A (433.1.1)' });
    else out.checks.push({ id: 'ibIn', ok: true, text: 'Ib ' + dc.ib.toFixed(1) + ' A ≤ In ' + In + ' A' });

    if (motorStart > 0 && dev.family === 'mcb') {
      const hold = (MCB_HOLD[dev.curve] || 5) * In;
      const okS = hold >= motorStart * 1.2;
      out.checks.push({
        id: 'start', ok: okS, warn: !okS,
        text: okS ? 'Starting current ' + motorStart.toFixed(0) + ' A within Type ' + dev.curve + ' hold (' + hold.toFixed(0) + ' A)'
                  : 'Type ' + dev.curve + In + ' may trip on start (' + motorStart.toFixed(0) + ' A × 1.2 against ' + hold.toFixed(0) + ' A) — consider Type D or a larger rating'
      });
    }
    if (motorStart > 0 && dev.family === 'mccb') {
      const im = (dev.im || 10) * In;
      if (im < motorStart * 1.2) out.checks.push({ id: 'start', ok: false, warn: true, text: 'MCCB magnetic setting ' + im.toFixed(0) + ' A is below the starting peak — raise Im' });
    }

    const tReq = earthing === 'TT' ? (isFinal && In <= (settings.maxFinalA || 32) ? 0.2 : 1)
      : (isFinal && In <= (settings.maxFinalA || 32) ? 0.4 : 5);
    out.tReq = tReq;

    // --- size each leg ----------------------------------------------------
    // The overload rule: Iz ≥ In, unless overload protection is provided at
    // the starter (433.3.1 / motor overload relay), when Iz ≥ Ib suffices.
    const izNeed = load.overloadAtStarter && circ.kind === 'power' ? dc.ib : In;
    out.izNeed = izNeed;

    const legs = (circ.legs || []).map(leg => {
      const t = CABLE_TYPES[leg.type] || CABLE_TYPES.swa;
      const cpc = leg.cpc && t.cpcModes.includes(leg.cpc) ? leg.cpc : t.defaultCpc;
      const cores = leg.cores || coresFor(leg.type, phase, neutral, cpc);
      const conds = (leg.conds && leg.conds.length ? leg.conds : [{ method: 'C', arr: 'wall', n: 1, ambient: settings.ambient || 30 }]);
      const ci = CI[leg.ci || 'none'] || 1;
      return { src: leg, t, typeKey: leg.type in CABLE_TYPES ? leg.type : 'swa', cpc, cores, conds, ci, L: Math.max(0, Number(leg.lengthM) || 0) };
    });

    function legRating(l, size) {
      // Worst condition along the leg governs: the smallest Iz.
      let worst = null;
      for (const c of l.conds) {
        const tab = tabulated(l.t.table, c.method, loaded, size);
        if (!tab) return null;
        const ca = caFor(l.t.maxT, c.ambient != null ? c.ambient : (settings.ambient || 30));
        const cg = cgFor(c.arr, c.n);
        const iz = tab.it * ca * cg * l.ci;
        if (!worst || iz < worst.iz) worst = { iz, it: tab.it, ca, cg, ci: l.ci, method: tab.method, fellBack: tab.fellBack, table: tab.table, cond: c, note: tab.note };
      }
      return worst;
    }
    function legVd(l, size, I) {
      const mv = mvPerAm(l.t.table, loaded, size);
      if (mv == null) return null;
      const v = mv * I * l.L / 1000;
      return { mv, v, pct: v / U * 100 };
    }
    function legR(l, size) {
      // (R1 + R2) for the leg at operating temperature, Ω
      const r1 = R20[size];
      const r2 = cpcRPerM(l.typeKey, l.cpc, l.cores, size);
      if (r1 == null || r2 == null) return null;
      const f = R_FACTOR[l.t.maxT >= 90 ? 90 : 70];
      const f2 = l.cpc === 'armour' ? R_FACTOR.armour : f;
      return (r1 * f + r2 * f2) * l.L / 1000;
    }

    // smallest size that carries izNeed under every condition, and no
    // smaller than Table 52.3 allows for fixed wiring (1.5 mm² power)
    const minSize = Number(settings.minPower) > 0 ? Number(settings.minPower) : 1.5;
    const idx = legs.map(l => {
      const i = l.t.sizes.findIndex(s => { if (s < minSize - 1e-9) return false; const r = legRating(l, s); return r && r.iz >= izNeed - 1e-9; });
      return i;
    });
    legs.forEach((l, k) => { if (idx[k] < 0) { idx[k] = l.t.sizes.length - 1; l.noFit = true; } });

    const vdLimit = (LOAD_KINDS[load.kind] || {}).lighting ? (settings.vdLighting || 3) : (settings.vdOther || 5);
    const upstream = Number(circ.board && circ.board.upstreamPct) || 0;
    const zdb = Number(circ.board && circ.board.zdb) || 0;
    const pfc = Number(circ.board && circ.board.pfcKA) || 0;
    const zmax = zsMax(dev, In, tReq >= 1 ? 5 : 0.4);

    function evaluate(ix) {
      let vdPct = upstream, rTot = 0, vStartPct = upstream;
      const per = legs.map((l, k) => {
        const size = l.t.sizes[ix[k]];
        const vd = legVd(l, size, dc.ib);
        const vs = motorStart > 0 ? legVd(l, size, motorStart) : null;
        const r = legR(l, size);
        if (vd) vdPct += vd.pct;
        if (vs) vStartPct += vs.pct;
        if (r != null) rTot += r;
        return { size, vd, vs, r };
      });
      const zs = zdb + rTot;
      return { per, vdPct, vStartPct, zs };
    }

    // Upsize for volt drop and Zs automatically, the leg doing most harm first.
    const auto = idx.slice();
    let ev = evaluate(auto);
    let guard = 0;
    const zsOk = (e) => earthing === 'TT' || zmax == null || e.zs <= zmax;
    // Zs can only be fixed by a bigger cable if the board itself is inside
    // the limit; otherwise leave the size alone and let the check say so.
    const zsFixable = earthing === 'TT' || zmax == null || zdb < zmax;
    const needs = (e) => e.vdPct > vdLimit || (zsFixable && !zsOk(e));
    while (needs(ev) && guard++ < 60) {
      let best = -1, bestV = -1;
      legs.forEach((l, k) => {
        if (auto[k] >= l.t.sizes.length - 1) return;
        const p = ev.per[k];
        const harm = ev.vdPct > vdLimit ? (p.vd ? p.vd.pct : 0) : (p.r || 0);
        if (harm > bestV) { bestV = harm; best = k; }
      });
      if (best < 0) break;
      auto[best]++;
      ev = evaluate(auto);
    }

    // The user's steps up or down from the automatic pick.
    const fin = auto.map((ix, k) => {
      const step = Math.round(Number(legs[k].src.step) || 0);
      return Math.max(0, Math.min(legs[k].t.sizes.length - 1, ix + step));
    });
    ev = evaluate(fin);

    // --- per-leg results ---------------------------------------------------
    legs.forEach((l, k) => {
      const size = l.t.sizes[fin[k]];
      const rt = legRating(l, size);
      const p = ev.per[k];
      const od = cableOd(l.typeKey, l.cores, size, l.src.odOverride);
      const res = {
        role: l.src.role, type: l.typeKey, typeLabel: l.t.label, short: l.t.short,
        cores: l.cores, size, autoSize: l.t.sizes[auto[k]], minIzSize: l.t.sizes[idx[k]], step: fin[k] - auto[k],
        cpc: l.cpc, cpcArea: cpcArea(l.typeKey, l.cpc, l.cores, size), lengthM: l.L,
        it: rt ? rt.it : null, iz: rt ? rt.iz : null, ca: rt ? rt.ca : null, cg: rt ? rt.cg : null, ci: l.ci,
        method: rt ? rt.method : null, methodFellBack: rt ? rt.fellBack : false, table: rt ? rt.table : l.t.table,
        govCond: rt ? rt.cond : null,
        mv: p.vd ? p.vd.mv : null, vdV: p.vd ? p.vd.v : null, vdPct: p.vd ? p.vd.pct : null,
        r12: p.r, od, singles: !!l.t.singles,
        nSingles: l.t.singles ? singlesCount(phase, neutral) : 1,
        warnings: []
      };
      if (!rt) res.warnings.push('Not tabulated for this size and method');
      else if (rt.iz < izNeed - 1e-9) res.warnings.push('Iz ' + rt.iz.toFixed(1) + ' A is below ' + (izNeed === In ? 'In ' : 'Ib ') + izNeed.toFixed(1) + ' A');
      if (size < minSize - 1e-9) res.warnings.push('Below the ' + minSize + ' mm² minimum for fixed power wiring (Table 52.3)');
      if (l.noFit) res.warnings.push('Largest size in the range cannot carry the current — parallel cables or another type needed');
      if (l.t.singlePhaseOnly && phase === 3) res.warnings.push(l.t.short + ' is a single-phase cable');
      if (l.t.singles && l.conds.some(c => c.method === 'E' || c.method === 'C')) res.warnings.push('Unsheathed singles must be enclosed in conduit or trunking (521.10.1)');
      if (rt && rt.fellBack) res.notes = (res.notes || []).concat('Method ' + (rt.cond.method) + ' not tabulated in ' + rt.table + ' — rated as method ' + rt.method);
      if (rt && rt.note) res.notes = (res.notes || []).concat(rt.note);
      if (rt && rt.ca === 0) res.warnings.push('Ambient above the cable\'s rating');
      out.legs.push(res);
    });

    // --- checks ------------------------------------------------------------
    const izMin = Math.min.apply(null, out.legs.map(l => l.iz == null ? 0 : l.iz));
    out.iz = izMin;
    out.checks.push({ id: 'iz', ok: izMin >= izNeed - 1e-9, text: 'Iz ' + izMin.toFixed(1) + ' A ≥ ' + (izNeed === In ? 'In ' : 'Ib ') + izNeed.toFixed(1) + ' A' + (izNeed !== In ? ' (overload at starter)' : '') });

    out.vdPct = ev.vdPct; out.vdLimit = vdLimit; out.upstreamPct = upstream;
    out.vdV = ev.per.reduce((a, p) => a + (p.vd ? p.vd.v : 0), 0);
    out.checks.push({ id: 'vd', ok: ev.vdPct <= vdLimit + 1e-9, text: 'Volt drop ' + ev.vdPct.toFixed(2) + ' % (limit ' + vdLimit + ' %' + (upstream ? ', incl. ' + upstream.toFixed(2) + ' % upstream' : '') + ')' });
    if (motorStart > 0) {
      const lim = settings.vdStart || 10;
      out.vStartPct = ev.vStartPct;
      out.checks.push({ id: 'vstart', ok: ev.vStartPct <= lim + 1e-9, warn: ev.vStartPct > lim, text: 'Volt drop on start ' + ev.vStartPct.toFixed(1) + ' % (limit ' + lim + ' %)' });
    }

    out.zs = ev.zs; out.zmax = zmax; out.zdb = zdb;
    if (earthing === 'TT') {
      const idn = Number(dev.rcd) || 0;
      if (!idn) out.checks.push({ id: 'zs', ok: false, text: 'TT system: an RCD is needed for fault protection (411.5)' });
      else {
        const lim = 50 / (idn / 1000);
        out.checks.push({ id: 'zs', ok: ev.zs <= lim, text: 'Zs ' + ev.zs.toFixed(2) + ' Ω ≤ ' + lim.toFixed(0) + ' Ω for a ' + idn + ' mA RCD (Table 41.5)' });
      }
    } else if (zmax == null) {
      out.checks.push({ id: 'zs', ok: false, text: 'No maximum Zs tabulated for ' + deviceLabel(dev, In) + ' at ' + (tReq >= 1 ? 5 : 0.4) + ' s' });
    } else {
      const okZ = ev.zs <= zmax + 1e-9;
      const rcdSaves = !okZ && Number(dev.rcd) > 0 && ev.zs <= 50 / (Number(dev.rcd) / 1000);
      out.checks.push({
        id: 'zs', ok: okZ || rcdSaves,
        text: 'Zs ' + ev.zs.toFixed(3) + ' Ω ' + (okZ ? '≤' : '>') + ' max ' + zmax.toFixed(3) + ' Ω (' + (tReq >= 1 ? '5' : '0.4') + ' s, ' + (dev.family === 'bs88' ? 'Table 41.' + (tReq >= 1 ? '4' : '2') : dev.family === 'mccb' ? 'Im ' + (dev.im || 10) + ' × In' : 'Table 41.3') + ')' + (rcdSaves ? ' — fault protection by the RCD' : '') + (!okZ && !rcdSaves && zdb >= zmax ? ' — Zdb at the board alone is over the limit: check the board\'s Zdb, lower the device setting or add an RCD' : '')
      });
    }

    // Adiabatic check on the CPC (543.1.3): S ≥ √(I²t) / k
    const If = ev.zs > 0 ? U0 / ev.zs : null;
    out.If = If;
    if (If) {
      const t = faultTime(dev, In, If, ev.zs, tReq);
      out.tFault = t;
      out.legs.forEach((lr, k) => {
        const l = legs[k];
        if (lr.cpcArea == null) return;
        const kk = lr.cpc === 'armour' ? (l.t.kArmour || 46) : (l.t.kCore || 115);
        const sMin = Math.sqrt(If * If * t) / kk;
        lr.cpcMin = sMin; lr.k = kk;
        const ok = lr.cpcArea >= sMin - 1e-9;
        out.checks.push({ id: 'adiabatic', ok, text: (lr.role === 'tail' ? 'Tail' : 'Cable') + ' CPC ' + lr.cpcArea + ' mm² ' + (ok ? '≥' : '<') + ' ' + sMin.toFixed(2) + ' mm² (If ' + If.toFixed(0) + ' A, t ' + t + ' s, k ' + kk + ')' });
      });
    }

    // Breaking capacity (434.5.1)
    const kA = Number(dev.kA) || fam.defaultKA;
    out.kA = kA;
    if (pfc > 0) out.checks.push({ id: 'icn', ok: kA >= pfc - 1e-9, text: 'Breaking capacity ' + kA + ' kA ' + (kA >= pfc ? '≥' : '<') + ' PFC ' + pfc + ' kA at the board' });

    // Signal limits do not apply; collect leg warnings into checks
    out.legs.forEach(lr => lr.warnings.forEach(w => out.checks.push({ id: 'leg', ok: false, text: (lr.role === 'tail' ? 'Tail: ' : '') + w })));

    out.ok = out.checks.every(c => c.ok || c.warn);
    out.hasWarn = out.checks.some(c => c.warn && !c.ok);
    out.deviceText = deviceLabel(dev, In);
    return out;
  }

  // Control (24 V / 230 V supplies to actuators etc.) sized on volt drop from
  // the VA. Signal cables (bus, data, analogue) are measured and checked
  // against their maximum run only.
  function sizeControl(circ, settings) {
    const out = { kind: 'control', legs: [], checks: [], warnings: [], ok: true };
    const ctrl = circ.ctrl || {};
    const V = Number(ctrl.volts) || 24;
    const va = Number(ctrl.va) || 0;
    const I = va > 0 ? va / V : 0;
    out.ib = I; out.volts = V;
    const lim = Number(settings.vdControl) || 5;
    out.vdLimit = lim;
    let vdTot = 0;
    (circ.legs || []).forEach(leg => {
      const t = CABLE_TYPES[leg.type] || CABLE_TYPES.instr;
      const L = Math.max(0, Number(leg.lengthM) || 0);
      const cores = leg.cores || t.cores[0];
      const res = { role: leg.role, type: leg.type, typeLabel: t.label, short: t.short, cores, lengthM: L, warnings: [], step: 0 };
      if (t.use === 'signal' || ctrl.signal || !(I > 0)) {
        res.size = t.sizes[Math.max(0, Math.min(t.sizes.length - 1, Math.round(Number(leg.step) || 0)))];
        res.od = cableOd(leg.type, cores, res.size, leg.odOverride);
        if (t.maxLenM && L > t.maxLenM) res.warnings.push('Run ' + L.toFixed(0) + ' m exceeds ' + t.maxLenNote);
        out.legs.push(res);
        return;
      }
      // pick the smallest size with loop volt drop within the limit
      const loopV = (s) => 2 * L * (R20[s] || 99) * R_FACTOR[70] * I / 1000;
      const minC = Number(settings.minControl) > 0 ? Number(settings.minControl) : 0.5;
      let ix = t.sizes.findIndex(s => s >= minC - 1e-9 && loopV(s) / V * 100 <= lim);
      if (ix < 0) ix = t.sizes.length - 1;
      const autoIx = ix;
      ix = Math.max(0, Math.min(t.sizes.length - 1, ix + Math.round(Number(leg.step) || 0)));
      res.size = t.sizes[ix]; res.autoSize = t.sizes[autoIx]; res.step = ix - autoIx;
      res.vdV = loopV(res.size); res.vdPct = res.vdV / V * 100; vdTot += res.vdPct;
      res.od = cableOd(leg.type, cores, res.size, leg.odOverride);
      if (t.maxLenM && L > t.maxLenM) res.warnings.push('Run ' + L.toFixed(0) + ' m exceeds ' + t.maxLenNote);
      out.legs.push(res);
    });
    if (I > 0 && !ctrl.signal) {
      out.vdPct = vdTot;
      out.checks.push({ id: 'vd', ok: vdTot <= lim + 1e-9, text: V + ' V supply: ' + I.toFixed(2) + ' A, volt drop ' + vdTot.toFixed(1) + ' % (limit ' + lim + ' %)' });
    } else {
      out.checks.push({ id: 'sig', ok: true, text: 'Signal / data — length only' });
    }
    out.legs.forEach(lr => lr.warnings.forEach(w => out.checks.push({ id: 'leg', ok: false, text: w })));
    out.ok = out.checks.every(c => c.ok || c.warn);
    return out;
  }

  const api = {
    U0, U1, U3, R20, STD_SIZES, TABLES, METHOD_LABEL, CA, CG, CI, CI_LABEL, CONTAINMENT_METHOD,
    CABLE_TYPES, DEVICES, MCB_INST, MCB_HOLD, BS88_ZS, LOAD_KINDS, DRIVES,
    ISOLATOR_RATINGS, ISOLATOR_ENCLOSURES, ISOLATOR_IP, GLAND_SIZES, NYLON_GLANDS, GLAND_TYPES,
    CONTAINMENT, FINISHES, SUPPORT_SPACING, MOUNTS, UNISTRUT_ARMS, FLEX_CONDUIT,
    tabulated, mvPerAm, caFor, cgFor, cableOd, coresFor, singlesCount, cpcArea, cpcRPerM,
    zsMax, faultTime, deviceLabel, designCurrent, pickIsolator, glandFor, flexConduitFor,
    widthRequired, pickWidth, areaOf, pickTrunking, pickConduit, supportKit,
    sizeCircuit, sizeControl, nearestStd
  };
  root.CableEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
