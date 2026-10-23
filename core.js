/* adi Cable Trace — the model, the containment network and the take-off.
 *
 * No DOM here either. A project is plain JSON (see CLAUDE.md §4). solve()
 * turns it into an analysis: where every cable runs, what it shares, how it
 * is sized, how full each containment run is, and what to order. The page
 * draws the analysis; the schedules, PDF and Excel all read the same one so
 * they cannot disagree.
 */
(function (root) {
  'use strict';
  const E = root.CableEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  // ------------------------------------------------------------------
  // Defaults
  // ------------------------------------------------------------------
  function defaultSettings() {
    return {
      earthing: 'TN-S', ze: 0.8, zdbDefault: 0.2, pfcDefault: 10, ambient: 30,
      vdLighting: 3, vdOther: 5, vdStart: 10, vdControl: 5, maxFinalA: 32, minPower: 1.5, minControl: 0.5,
      spare: 25, spaceTrunking: 45, spaceConduit: 40,
      termAllow: 0.5, wasteCable: 5, wasteContain: 5,
      defPower: 'swa', defTail: 'sy', defControl: 'instr', defSignal: 'bms', tailFlex: true,
      defFamily: 'mcb', defCurve: 'C', motorCurve: 'C', defKA: 10,
      glandIndoor: 'BW', glandOutdoor: 'CW', cwIndoors: false, shrouds: true, earthTags: true,
      containHeight: 3.0, soffit: 4.0, boardH: 1.5, isolatorH: 1.5, loadH: 1.0, deviceH: 1.2,
      spacing: Object.assign({}, E.SUPPORT_SPACING),
      defMount: 'droprod', defFinish: 'hdg', defType: 'tray', defDuty: 'medium',
      freeMethod: 'C', autoRoute: true, autoHopM: 15, trayBendR: 150, ortho: true, stackScale: 1,
      isoEnclosure: 'poly', isoIP: 'IP66', stainlessOutdoor: false, calcRev: 3,
      segMethod: 'divider', segDividerMm: 10, segGapMm: 200, tierGapMm: 300, fireRating: 60
    };
  }
  function newProject() {
    return {
      app: 'adi-cable-trace', schema: 1, rev: 0, name: 'Untitled project', ref: '', client: '',
      settings: defaultSettings(),
      sheets: [], active: null,
      nodes: [], routes: [], circuits: [], measures: [], firewalls: [],
      nextId: 1
    };
  }
  function nid(P, prefix) { P.nextId = (P.nextId || 1) + 1; return (prefix || 'x') + (P.nextId - 1).toString(36); }

  // Make an old or hand-edited file safe to open.
  function repair(P) {
    const d = newProject();
    for (const k of Object.keys(d)) if (P[k] == null) P[k] = d[k];
    const had = P.settings || {};
    P.settings = Object.assign(defaultSettings(), had);
    // calcRev 2: DOL motors default to Type C (was D). A file from before
    // carries 'D' as the old default, not as anyone's choice.
    if (!(had.calcRev >= 2) && had.motorCurve === 'D') P.settings.motorCurve = 'C';
    // calcRev 3: the default Zdb is 0.2 Ω (was 0.35 Ω)
    if (!(had.calcRev >= 3) && Number(had.zdbDefault) === 0.35) P.settings.zdbDefault = 0.2;
    P.settings.calcRev = 3;
    P.settings.spacing = Object.assign({}, E.SUPPORT_SPACING, (P.settings.spacing || {}));
    let max = 0;
    const seen = (id) => { const m = /^[a-z]+([0-9a-z]+)$/.exec(String(id || '')); if (m) max = Math.max(max, parseInt(m[1], 36) || 0); };
    P.sheets.forEach(s => seen(s.id));
    P.nodes.forEach(n => seen(n.id));
    P.routes.forEach(r => { seen(r.id); (r.pts || []).forEach(p => seen(p.id)); });
    P.circuits.forEach(c => seen(c.id));
    P.measures.forEach(m => seen(m.id));
    (P.firewalls || []).forEach(f => seen(f.id));
    P.nextId = Math.max(P.nextId || 1, max + 1);
    if (!P.active && P.sheets[0]) P.active = P.sheets[0].id;
    P.circuits.forEach(c => { c.legs = c.legs || {}; c.device = c.device || {}; });
    return P;
  }

  // ------------------------------------------------------------------
  // Lookups
  // ------------------------------------------------------------------
  function index(P) {
    const ix = { node: new Map(), route: new Map(), pt: new Map(), circ: new Map(), sheet: new Map() };
    P.nodes.forEach(n => ix.node.set(n.id, n));
    P.routes.forEach(r => { ix.route.set(r.id, r); r.pts.forEach((p, i) => ix.pt.set(p.id, { r, p, i })); });
    P.circuits.forEach(c => ix.circ.set(c.id, c));
    P.sheets.forEach(s => ix.sheet.set(s.id, s));
    return ix;
  }
  function pxPerM(P, sheetId, ix) {
    const s = ix ? ix.sheet.get(sheetId) : P.sheets.find(x => x.id === sheetId);
    return s && s.pxPerM > 0 ? s.pxPerM : 50;
  }
  function sheetLevel(P, sheetId, ix) {
    const s = ix ? ix.sheet.get(sheetId) : P.sheets.find(x => x.id === sheetId);
    return s ? (Number(s.level) || 0) : 0;
  }

  // A route point that has been joined to another point (a tee, or a run
  // that carries on from where another stopped) takes that point's position.
  // keyOf() gives the network node it belongs to.
  function rootOf(ix, pid, depth) {
    const e = ix.pt.get(pid);
    if (!e) return null;
    const link = e.p.link;
    if (!link || (depth || 0) > 8) return { key: 'p:' + pid, x: e.p.x, y: e.p.y, h: e.p.h, sheet: e.r.sheet };
    if (link.startsWith('n:')) {
      const n = ix.node.get(link.slice(2));
      if (!n) return { key: 'p:' + pid, x: e.p.x, y: e.p.y, h: e.p.h, sheet: e.r.sheet };
      return { key: link, x: n.x, y: n.y, h: e.p.h, sheet: n.sheet };
    }
    const r = rootOf(ix, link.slice(2), (depth || 0) + 1);
    return r || { key: 'p:' + pid, x: e.p.x, y: e.p.y, h: e.p.h, sheet: e.r.sheet };
  }
  function ptPos(ix, pid) {
    const e = ix.pt.get(pid);
    if (!e) return null;
    const r = rootOf(ix, pid);
    // the joined point keeps its own height so a drop onto a lower run reads as a riser
    return { key: r.key, x: r.x, y: r.y, h: e.p.link ? (r.h != null ? r.h : e.p.h) : e.p.h, sheet: r.sheet };
  }

  // ------------------------------------------------------------------
  // The containment network
  // ------------------------------------------------------------------
  function buildGraph(P, ix) {
    const G = { nodes: new Map(), adj: new Map(), edges: [] };
    const addNode = (k, pos) => { if (!G.nodes.has(k)) { G.nodes.set(k, pos); G.adj.set(k, []); } };
    P.routes.forEach(r => {
      const ppm = pxPerM(P, r.sheet, ix);
      for (let i = 0; i < r.pts.length; i++) {
        const a = ptPos(ix, r.pts[i].id);
        addNode(a.key, a);
        if (i === 0) continue;
        const b = ptPos(ix, r.pts[i - 1].id);
        if (a.key === b.key) continue;
        const plan = Math.hypot(a.x - b.x, a.y - b.y) / ppm;
        const dh = Math.abs((a.h || 0) - (b.h || 0));
        const e = { id: r.id + ':' + i, rid: r.id, i, a: b.key, b: a.key, plan, dh, len: plan + dh, sheet: r.sheet };
        G.edges.push(e);
        G.adj.get(a.key).push(e);
        G.adj.get(b.key).push(e);
      }
    });
    // Risers: nodes of kind 'riser' sharing a riser name join their sheets.
    const risers = new Map();
    P.nodes.filter(n => n.kind === 'riser').forEach(n => {
      const k = (n.riser || n.name || '').trim().toUpperCase();
      if (!k) return;
      if (!risers.has(k)) risers.set(k, []);
      risers.get(k).push(n);
    });
    risers.forEach((list, k) => {
      const z = (n) => sheetLevel(P, n.sheet, ix) + (Number(n.h) || 0);
      list.sort((a, b) => z(a) - z(b));
      list.forEach(n => addNode('n:' + n.id, { key: 'n:' + n.id, x: n.x, y: n.y, h: n.h, sheet: n.sheet }));
      for (let j = 1; j < list.length; j++) {
        const a = list[j - 1], b = list[j];
        const e = { id: 'R:' + k + ':' + j, rid: null, riser: k, riserNode: a.id, a: 'n:' + a.id, b: 'n:' + b.id, plan: 0, dh: Math.abs(z(b) - z(a)), len: Math.abs(z(b) - z(a)), sheet: null };
        G.edges.push(e);
        G.adj.get(e.a).push(e);
        G.adj.get(e.b).push(e);
      }
    });
    G.edgeById = new Map(G.edges.map(e => [e.id, e]));
    return G;
  }

  function shortestPath(G, from, to) {
    if (!G.nodes.has(from) || !G.nodes.has(to)) return null;
    if (from === to) return { keys: [from], edges: [], len: 0 };
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const done = new Set();
    // small graphs: a linear scan priority queue is plenty
    const open = new Set([from]);
    while (open.size) {
      let u = null, best = Infinity;
      open.forEach(k => { const d = dist.get(k); if (d < best) { best = d; u = k; } });
      open.delete(u);
      if (u === to) break;
      done.add(u);
      for (const e of G.adj.get(u) || []) {
        const v = e.a === u ? e.b : e.a;
        if (done.has(v)) continue;
        const nd = best + e.len;
        if (nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); prev.set(v, { u, e }); open.add(v); }
      }
    }
    if (!dist.has(to)) return null;
    const keys = [to], edges = [];
    let k = to;
    while (k !== from) { const p = prev.get(k); edges.unshift(p.e); keys.unshift(p.u); k = p.u; }
    return { keys, edges, len: dist.get(to) };
  }

  // The best way into and out of the containment for a cable between two
  // pieces of equipment: off-containment metres cost double, so a short hop
  // to a run that goes the right way beats the nearest point on the wrong one.
  // One Dijkstra seeded from every network point near the start.
  const OFF_WEIGHT = 2;
  function autoRoute(P, ix, G, a, b) {
    const near = (n) => {
      const ppm = pxPerM(P, n.sheet, ix);
      const list = [];
      G.nodes.forEach((pos, k) => {
        if (pos.sheet !== n.sheet || !(G.adj.get(k) || []).length) return;
        const d = Math.hypot(pos.x - n.x, pos.y - n.y) / ppm + Math.abs((pos.h || 0) - (Number(n.h) || 0));
        list.push([k, d]);
      });
      const maxHop = Number(P.settings.autoHopM) > 0 ? Number(P.settings.autoHopM) : 15;
      return list.filter(x => x[1] <= maxHop).sort((p, q) => p[1] - q[1]).slice(0, 12);
    };
    const starts = near(a), ends = near(b);
    if (!starts.length || !ends.length) return null;
    const dist = new Map(), origin = new Map(), done = new Set(), open = new Set();
    starts.forEach(([k, d]) => { dist.set(k, d * OFF_WEIGHT); origin.set(k, k); open.add(k); });
    while (open.size) {
      let u = null, bd = Infinity;
      open.forEach(k => { const d = dist.get(k); if (d < bd) { bd = d; u = k; } });
      open.delete(u); done.add(u);
      for (const e of G.adj.get(u) || []) {
        const v = e.a === u ? e.b : e.a;
        if (done.has(v)) continue;
        const nd = bd + e.len;
        if (nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); origin.set(v, origin.get(u)); open.add(v); }
      }
    }
    let best = null, bv = Infinity;
    ends.forEach(([k, d]) => { if (dist.has(k)) { const v = dist.get(k) + d * OFF_WEIGHT; if (v < bv) { bv = v; best = [origin.get(k), k]; } } });
    if (!best) return null;
    // a straight run that is shorter than going via the containment stays off it
    if (a.sheet === b.sheet) {
      const direct = Math.hypot(a.x - b.x, a.y - b.y) / pxPerM(P, a.sheet, ix) + Math.abs((Number(a.h) || 0) - (Number(b.h) || 0));
      if (direct * OFF_WEIGHT < bv * 0.6 && direct < 3) return null;
    }
    return best;
  }

  function nearestGraphNode(G, sheet, x, y) {
    let best = null, bd = Infinity;
    G.nodes.forEach((pos, k) => {
      if (pos.sheet !== sheet) return;
      if (!(G.adj.get(k) || []).length) return;
      const d = Math.hypot(pos.x - x, pos.y - y);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }

  // ------------------------------------------------------------------
  // Circuits and their legs
  // ------------------------------------------------------------------
  // main: board → isolator (or straight to the load)
  // tail: isolator → load
  function legEnds(c) {
    const out = [];
    const tgt = c.target;
    if (c.iso) {
      if (c.board) out.push({ role: 'main', from: c.board, to: c.iso });
      if (tgt) out.push({ role: 'tail', from: c.iso, to: tgt });
    } else if (c.board && tgt) out.push({ role: 'main', from: c.board, to: tgt });
    return out;
  }

  function wayPos(ix, w) {
    if (w.p) return ptPos(ix, w.p);
    if (w.r) {
      const n = ix.node.get(w.r);
      return n ? { key: 'n:' + n.id, x: n.x, y: n.y, h: Number(n.h) || 0, sheet: n.sheet } : null;
    }
    return { key: null, x: w.x, y: w.y, h: w.h, sheet: w.s };
  }

  // The 3D path of one leg: node → waypoints (through the network between
  // network points) → node. Spans carry the network edge they ride on.
  function legPath(P, ix, G, c, end, settings) {
    const leg = (c.legs && c.legs[end.role]) || {};
    const a = ix.node.get(end.from), b = ix.node.get(end.to);
    if (!a || !b) return null;
    const pos = (n) => ({ key: n.kind === 'riser' ? 'n:' + n.id : null, x: n.x, y: n.y, h: Number(n.h) || 0, sheet: n.sheet, node: n.id });
    let ways = (leg.way || []).map(w => wayPos(ix, w)).filter(Boolean);
    const extra = Math.max(0, Number(leg.extra) || 0);
    const allow = 2 * (Number(settings.termAllow) || 0);
    const done = (pts, spans, auto, broken) => {
      const routeLen = spans.reduce((s, x) => s + x.len, 0);
      return { role: end.role, from: end.from, to: end.to, pts, spans, routeLen, extra, allow, lengthM: routeLen + extra + allow, auto, broken };
    };
    if (!ways.length && settings.autoRoute !== false && end.role === 'main' && !leg.direct && G.edges.length) {
      const ap = autoPath(P, ix, G, pos(a), pos(b), settings);
      if (ap) return done(ap.pts, ap.spans, true, false);
    }
    // nothing traced and nothing to ride on: a cable runs square to the
    // building, not diagonally across a room
    const square = !ways.length;
    const seq = [pos(a)].concat(ways, [pos(b)]);
    const pts = [seq[0]];
    const spans = [];
    let broken = false;
    for (let i = 1; i < seq.length; i++) {
      const A = seq[i - 1], B = seq[i];
      if (A.key && B.key && A.key !== B.key) {
        const sp = shortestPath(G, A.key, B.key);
        if (sp) {
          sp.edges.forEach((e, j) => {
            const kTo = sp.keys[j + 1];
            const to = G.nodes.get(kTo);
            spans.push({ edge: e, from: pts[pts.length - 1], to, len: e.len, plan: e.plan, dh: e.dh });
            pts.push(to);
          });
          continue;
        }
        broken = true;
      }
      if (A.key && B.key && A.key === B.key) continue;
      const ppm = pxPerM(P, A.sheet, ix);
      const sameSheet = A.sheet === B.sheet;
      if (!sameSheet) broken = true;
      const plan = sameSheet ? (square ? Math.abs(A.x - B.x) + Math.abs(A.y - B.y) : Math.hypot(A.x - B.x, A.y - B.y)) / ppm : 0;
      const zA = sheetLevel(P, A.sheet, ix) + (A.h || 0), zB = sheetLevel(P, B.sheet, ix) + (B.h || 0);
      const dh = Math.abs(zA - zB);
      spans.push({ edge: null, from: A, to: B, len: plan + dh, plan, dh });
      pts.push(B);
    }
    return done(pts, spans, false, broken);
  }

  // Where a piece of equipment can join the containment: the foot of the
  // perpendicular on every run within reach (so a pump under the middle of a
  // tray drops from the point above it), as well as the run's corners.
  function taps(P, ix, G, n, settings) {
    const ppm = pxPerM(P, n.sheet, ix);
    const hop = (Number(settings.autoHopM) > 0 ? Number(settings.autoHopM) : 15) * ppm;
    const out = [];
    G.edges.forEach(e => {
      if (!e.rid || e.sheet !== n.sheet) return;
      const pa = G.nodes.get(e.a), pb = G.nodes.get(e.b);
      const dx = pb.x - pa.x, dy = pb.y - pa.y, L2 = dx * dx + dy * dy;
      let t = L2 > 1e-9 ? ((n.x - pa.x) * dx + (n.y - pa.y) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const x = pa.x + dx * t, y = pa.y + dy * t;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d > hop) return;
      const h = (pa.h || 0) + ((pb.h || 0) - (pa.h || 0)) * t;
      out.push({ e, t, x, y, h, off: d / ppm + Math.abs((Number(n.h) || 0) - h) });
    });
    return out;
  }

  // The automatic route for a cable: on at the best tap near the start, the
  // shortest way through the containment, off at the best tap near the end.
  // Off-containment metres cost double, so a short drop onto a run going the
  // right way beats a long one onto the wrong run.
  function autoPath(P, ix, G, a, b, settings) {
    const W = OFF_WEIGHT;
    const ta = taps(P, ix, G, a, settings), tb = taps(P, ix, G, b, settings);
    if (!ta.length || !tb.length) return null;
    const dist = new Map(), prev = new Map(), done = new Set(), open = new Set();
    const relax = (k, d, p) => { if (d < (dist.has(k) ? dist.get(k) : Infinity)) { dist.set(k, d); prev.set(k, p); open.add(k); } };
    ta.forEach(tp => {
      relax(tp.e.a, W * tp.off + tp.e.len * tp.t, { tap: tp, side: 'a' });
      relax(tp.e.b, W * tp.off + tp.e.len * (1 - tp.t), { tap: tp, side: 'b' });
    });
    while (open.size) {
      let u = null, bd = Infinity;
      open.forEach(k => { const d = dist.get(k); if (d < bd) { bd = d; u = k; } });
      open.delete(u); done.add(u);
      for (const e of G.adj.get(u) || []) {
        const v = e.a === u ? e.b : e.a;
        if (!done.has(v)) relax(v, bd + e.len, { u, e });
      }
    }
    let best = null;
    tb.forEach(tp => {
      [['a', tp.e.len * tp.t], ['b', tp.e.len * (1 - tp.t)]].forEach(([side, part]) => {
        const k = tp.e[side];
        if (!dist.has(k)) return;
        const v = dist.get(k) + part + W * tp.off;
        if (!best || v < best.v) best = { v, tp, side };
      });
      // both ends on the same piece of containment
      ta.forEach(s0 => {
        if (s0.e !== tp.e) return;
        const v = W * (s0.off + tp.off) + tp.e.len * Math.abs(s0.t - tp.t);
        if (!best || v < best.v) best = { v, same: s0, tp };
      });
    });
    if (!best) return null;
    if (a.sheet === b.sheet) {
      const ppm = pxPerM(P, a.sheet, ix);
      const direct = (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / ppm + Math.abs((a.h || 0) - (b.h || 0));
      if (direct < 3 && direct * W < best.v) return null;
    }
    // rebuild the route as spans
    const footOf = (tp) => ({ key: null, x: tp.x, y: tp.y, h: tp.h, sheet: tp.e.sheet });
    const partial = (e, t0, t1, from, to) => {
      const f = Math.abs(t1 - t0);
      return { edge: e, t0: Math.min(t0, t1), t1: Math.max(t0, t1), from, to, len: e.len * f, plan: e.plan * f, dh: e.dh * f };
    };
    const free = (A0, B0) => {
      const ppm = pxPerM(P, A0.sheet, ix);
      const plan = Math.hypot(A0.x - B0.x, A0.y - B0.y) / ppm;
      const dh = Math.abs((A0.h || 0) - (B0.h || 0));
      return { edge: null, from: A0, to: B0, len: plan + dh, plan, dh };
    };
    const spans = [];
    if (best.same) {
      const fa = footOf(best.same);
      spans.push(free(a, fa));
      const fb = footOf(best.tp);
      if (best.same.t !== best.tp.t) spans.push(partial(best.tp.e, best.same.t, best.tp.t, fa, fb));
      spans.push(free(fb, b));
    } else {
      // walk back from the end vertex to the start tap
      const chain = [];
      let k = best.tp.e[best.side];
      let startTap = null;
      for (let guard = 0; guard < 10000; guard++) {
        const pv = prev.get(k);
        if (!pv) break;
        if (pv.tap) { startTap = pv; break; }
        chain.unshift({ e: pv.e, from: pv.u, to: k });
        k = pv.u;
      }
      if (!startTap) return null;
      const s0 = startTap.tap;
      const fa2 = footOf(s0);
      spans.push(free(a, fa2));
      const v0 = G.nodes.get(s0.e[startTap.side]);
      const t0end = startTap.side === 'a' ? 0 : 1;
      if (s0.t !== t0end) spans.push(partial(s0.e, s0.t, t0end, fa2, v0));
      chain.forEach(ch => spans.push({ edge: ch.e, t0: 0, t1: 1, from: G.nodes.get(ch.from), to: G.nodes.get(ch.to), len: ch.e.len, plan: ch.e.plan, dh: ch.e.dh }));
      const fb = footOf(best.tp);
      const vEnd = G.nodes.get(best.tp.e[best.side]);
      const t1end = best.side === 'a' ? 0 : 1;
      if (best.tp.t !== t1end) spans.push(partial(best.tp.e, t1end, best.tp.t, vEnd, fb));
      spans.push(free(fb, b));
    }
    const clean = spans.filter(s => s.len > 1e-6 || s.edge);
    const pts = [a].concat(clean.map(s => s.to));
    return { pts, spans: clean };
  }

  // ------------------------------------------------------------------
  // Defaults that depend on the load
  // ------------------------------------------------------------------
  function deviceFor(c, P, ix) {
    const s = P.settings;
    const d = Object.assign({}, c.device || {});
    if (!d.family) {
      d.family = s.defFamily || 'mcb';
      // beyond the MCB range (or close to it) a device not chosen by hand
      // becomes an MCCB
      const L = ix.node.get(c.target);
      const ib = c.kind === 'power' && L ? E.designCurrent(loadInput(L)).ib : 0;
      if (d.family === 'mcb' && ib > 100) d.family = 'mccb';
    }
    if (d.family === 'mcb' && !d.curve) {
      const load = ix.node.get(c.target);
      const kind = load && E.LOAD_KINDS[load.loadKind];
      const motor = kind && kind.motor && (load.drive || 'DOL') !== 'VSD';
      d.curve = motor ? (s.motorCurve || 'D') : (s.defCurve || 'C');
    }
    if (!d.kA) d.kA = d.family === 'mcb' ? (s.defKA || 10) : E.DEVICES[d.family].defaultKA;
    if (d.family === 'mccb' && !d.im) d.im = 10;
    return d;
  }
  function legType(c, role, P, ix) {
    const leg = (c.legs && c.legs[role]) || {};
    if (leg.type && E.CABLE_TYPES[leg.type]) return leg.type;
    const s = P.settings;
    if (c.kind === 'control') return c.ctrl && c.ctrl.signal ? (s.defSignal || 'bms') : (s.defControl || 'instr');
    if (role === 'tail') return s.defTail || 'sy';
    const load = ix.node.get(c.target);
    if (load && load.drive === 'VSD' && E.LOAD_KINDS[load.loadKind] && E.LOAD_KINDS[load.loadKind].motor) return 'swa';
    return s.defPower || 'swa';
  }

  // ------------------------------------------------------------------
  // solve(): the whole analysis
  // ------------------------------------------------------------------
  function solve(P) {
    const s = P.settings;
    const ix = index(P);
    const G = buildGraph(P, ix);
    const A = { ix, G, paths: new Map(), results: new Map(), occ: new Map(), routes: new Map(), boards: new Map(), issues: [] };

    // 1. paths
    P.circuits.forEach(c => {
      const list = legEnds(c).map(end => legPath(P, ix, G, c, end, s)).filter(Boolean);
      A.paths.set(c.id, list);
    });

    // 2. what shares each piece of containment
    P.circuits.forEach(c => {
      (A.paths.get(c.id) || []).forEach(lp => {
        const seen = new Set();
        lp.spans.forEach(sp => {
          if (!sp.edge || seen.has(sp.edge.id)) return;
          seen.add(sp.edge.id);
          if (!A.occ.has(sp.edge.id)) A.occ.set(sp.edge.id, []);
          A.occ.get(sp.edge.id).push({ cid: c.id, role: lp.role, power: c.kind !== 'control', band: bandOf(c), t0: sp.t0 != null ? sp.t0 : 0, t1: sp.t1 != null ? sp.t1 : 1 });
        });
      });
    });
    // Grouping is counted where the cables actually lie together: the most
    // power circuits side by side at any point of the stretch this cable rides.
    const powerCount = (eid, t0, t1) => {
      const list = (A.occ.get(eid) || []).filter(o => o.power && o.t1 >= (t0 || 0) - 1e-9 && o.t0 <= (t1 == null ? 1 : t1) + 1e-9);
      return maxCover(list, t0 || 0, t1 == null ? 1 : t1, () => 1, true);
    };

    function edgeContainment(e) {
      if (e.rid) {
        const r = ix.route.get(e.rid);
        return r ? { kind: r.type, layout: r.layout, amb: r.amb, route: r } : null;
      }
      const n = ix.node.get(e.riserNode);
      return n ? { kind: n.riserType || 'tray', layout: 'touching', amb: n.amb, riser: n } : null;
    }

    function legConds(c, lp, role) {
      const leg = (c.legs && c.legs[role]) || {};
      const conds = [];
      const seen = new Set();
      lp.spans.forEach(sp => {
        if (sp.edge) {
          const ct = edgeContainment(sp.edge);
          if (!ct) return;
          const mk = (E.CONTAINMENT[ct.kind] && E.CONTAINMENT[ct.kind].methodKey) || ct.kind;
          const m = E.CONTAINMENT_METHOD[mk] || E.CONTAINMENT_METHOD.tray;
          const cond = {
            method: ct.route && ct.route.inWall && m.method === 'B' ? 'A' : m.method,
            arr: ct.layout === 'spaced' && m.arr !== 'enclosed' ? 'spaced' : m.arr,
            n: c.kind === 'control' ? 1 : powerCount(sp.edge.id, sp.t0, sp.t1),
            ambient: ct.amb != null && ct.amb !== '' ? Number(ct.amb) : s.ambient,
            where: ct.route ? (ct.route.name || ct.route.id) : 'Riser ' + sp.edge.riser
          };
          const key = cond.method + cond.arr + cond.n + cond.ambient;
          if (!seen.has(key)) { seen.add(key); conds.push(cond); }
        }
      });
      const free = lp.spans.filter(sp => !sp.edge).reduce((a, sp) => a + sp.len, 0);
      if (free > 0.01 || !conds.length) {
        const flex = role === 'tail' && (leg.flex != null ? leg.flex : s.tailFlex);
        conds.push({
          method: flex ? 'B' : (leg.freeMethod || s.freeMethod || 'C'),
          arr: flex ? 'enclosed' : 'wall', n: 1,
          ambient: leg.amb != null && leg.amb !== '' ? Number(leg.amb) : s.ambient,
          where: flex ? 'flexible conduit' : 'off containment'
        });
      }
      return conds;
    }

    // 3. board roll-up (design current of each board, for sub-mains)
    const boards = P.nodes.filter(n => n.kind === 'board');
    const feeds = new Map(); // child board → submain circuit
    P.circuits.forEach(c => { if (c.kind === 'submain' && c.target) feeds.set(c.target, c); });
    const ibMemo = new Map();
    function boardIb(bid, guard) {
      if (ibMemo.has(bid)) return ibMemo.get(bid);
      if ((guard || 0) > 12) return 0;
      const b = ix.node.get(bid);
      const three = !b || b.phase !== 1;
      let sum = 0;
      P.circuits.forEach(c => {
        if (c.board !== bid || c.kind === 'control') return;
        let ib = 0, ph = 3;
        if (c.kind === 'submain') { ib = boardIb(c.target, (guard || 0) + 1); const t = ix.node.get(c.target); ph = t && t.phase === 1 ? 1 : 3; }
        else { const L = ix.node.get(c.target); if (!L) return; const dc = E.designCurrent(loadInput(L)); ib = dc.ib; ph = dc.phase; }
        sum += three && ph === 1 ? ib / 3 : ib;
      });
      const div = b && Number(b.diversity) > 0 ? Number(b.diversity) : 1;
      const v = sum * div;
      ibMemo.set(bid, v);
      return v;
    }

    // 4. size, board by board from the top
    const boardState = new Map();
    function stateOf(bid) {
      if (boardState.has(bid)) return boardState.get(bid);
      const b = ix.node.get(bid);
      const st = { zdb: s.zdbDefault, pfcKA: s.pfcDefault, upstreamPct: 0, derived: false };
      if (b) {
        const feed = feeds.get(bid);
        if (feed && feed.board && feed.board !== bid && !feed._sizing) {
          const r = sizeOne(feed);
          if (r && r.zs != null) {
            st.zdb = r.zs; st.upstreamPct = r.vdPct || 0; st.derived = true;
            // prospective fault current at the board: the source impedance
            // behind the parent board plus the sub-main's line conductor at
            // 20 °C (cold, so the higher, safer figure for breaking capacity)
            const par = stateOf(feed.board);
            const zSrc = E.U0 / (Math.max(par.pfcKA, 0.01) * 1000);
            const r1 = (r.legs || []).reduce((a, l) => a + (E.R20[l.size] || 0) * (l.lengthM || 0) / 1000, 0);
            st.pfcKA = +(E.U0 / (zSrc + r1) / 1000).toFixed(2);
          }
        }
        if (b.zdb !== '' && b.zdb != null && Number(b.zdb) > 0) { st.zdb = Number(b.zdb); st.derived = false; }
        if (b.pfcKA !== '' && b.pfcKA != null && Number(b.pfcKA) > 0) st.pfcKA = Number(b.pfcKA);
        if (b.upPct !== '' && b.upPct != null && !isNaN(Number(b.upPct))) st.upstreamPct = Number(b.upPct);
      }
      boardState.set(bid, st);
      return st;
    }

    function sizeOne(c) {
      if (A.results.has(c.id)) return A.results.get(c.id);
      c._sizing = true;
      const lps = A.paths.get(c.id) || [];
      const legs = lps.map(lp => {
        const leg = (c.legs && c.legs[lp.role]) || {};
        return {
          role: lp.role, type: legType(c, lp.role, P, ix), cpc: leg.cpc, cores: Number(leg.cores) || null,
          lengthM: lp.lengthM, conds: legConds(c, lp, lp.role), ci: leg.ci || 'none',
          step: leg.step || 0, odOverride: Number(leg.od) || 0
        };
      });
      let res;
      if (!legs.length) {
        res = { kind: c.kind, legs: [], checks: [{ ok: false, text: 'Not connected — trace the cable from the board' }], ok: false, ib: 0 };
      } else if (c.kind === 'control') {
        res = E.sizeCircuit({ kind: 'control', ctrl: c.ctrl || {}, legs }, s);
      } else {
        const st = c.board ? stateOf(c.board) : { zdb: s.zdbDefault, pfcKA: s.pfcDefault, upstreamPct: 0 };
        const board = { zdb: st.zdb, pfcKA: st.pfcKA, upstreamPct: st.upstreamPct };
        if (c.kind === 'submain') {
          const t = ix.node.get(c.target);
          res = E.sizeCircuit({ kind: 'submain', ib: boardIb(c.target), phase: t && t.phase === 1 ? 1 : 3, neutral: true, board, device: deviceFor(c, P, ix), legs }, s);
        } else {
          const L = ix.node.get(c.target);
          const load = L ? loadInput(L) : {};
          // DOL, star-delta and soft starters carry a motor overload relay, so
          // unless told otherwise the cable needs only Iz ≥ Ib (433.1, 433.3)
          const starter = L && (E.LOAD_KINDS[L.loadKind] || {}).motor && ['DOL', 'SD', 'SS'].includes(L.drive || 'DOL');
          load.overloadAtStarter = c.overloadAtStarter != null ? !!c.overloadAtStarter : !!starter;
          const dev0 = deviceFor(c, P, ix);
          res = E.sizeCircuit({ kind: 'power', load, board, device: dev0, legs }, s);
          // A started motor on an MCB with no curve chosen: try C and D and keep
          // whichever needs less copper (a D rides a big start at a lower rating,
          // a C allows a higher Zs on a small one).
          if (starter && dev0.family === 'mcb' && !(c.device && c.device.curve)) {
            const alt = E.sizeCircuit({ kind: 'power', load, board, device: Object.assign({}, dev0, { curve: dev0.curve === 'D' ? 'C' : 'D' }), legs }, s);
            const cu = (x) => (x.legs || []).reduce((a, l) => a + (l.size || 0) * (l.lengthM || 0), 0) + (x.ok ? 0 : 1e9);
            if (cu(alt) < cu(res) - 1e-9) res = alt;
            res.autoCurve = true;
          }
        }
        res.board = board;
        if (!c.board) res.checks.unshift({ ok: false, text: 'No supply — trace the cable from a board to the isolator' });
        if (!c.target) res.checks.unshift({ ok: false, text: 'Isolator not connected to a load yet' });
        res.ok = res.checks.every(x => x.ok || x.warn);
      }
      lps.forEach((lp, k) => { if (lp.broken && res.legs[k]) res.checks.push({ ok: false, text: (lp.role === 'tail' ? 'Tail' : 'Cable') + ' route has a gap — part of it is not joined through the containment' }); });
      // a drive in the panel: the whole run is the motor cable
      const Ld = c.kind === 'power' ? ix.node.get(c.target) : null;
      if (Ld && Ld.drive === 'VSD' && (E.LOAD_KINDS[Ld.loadKind] || {}).motor && Ld.drivePos === 'panel' && res.legs && res.legs.length) {
        res.vsdPanel = true;
        const motorM = res.legs.reduce((a, l) => a + (l.lengthM || 0), 0);
        const maxM = Number(Ld.vsdMaxM) > 0 ? Number(Ld.vsdMaxM) : E.VSD_MAX_DEFAULT;
        res.motorM = motorM; res.vsdMaxM = maxM;
        res.checks.push({ id: 'vsdlen', ok: motorM <= maxM, warn: motorM > maxM, text: 'Drive to motor ' + motorM.toFixed(0) + ' m ' + (motorM <= maxM ? '≤' : '>') + ' ' + maxM + ' m allowed by the drive' + (motorM > maxM ? ' — output filter / sine filter or move the drive' : '') });
        const unscreened = res.legs.filter(l => l.type !== 'vsd' && l.type !== 'cy');
        res.checks.push({ id: 'emc', ok: !unscreened.length, warn: unscreened.length > 0, text: unscreened.length ? 'Motor cable from a drive should be symmetrical screened VSD cable (or CY), screen glanded 360° at both ends — ' + unscreened.map(l => l.short).join(', ') + ' is not' : 'Screened motor cable, EMC glands both ends' });
      }
      res.ok = res.checks.every(x => x.ok || x.warn);
      res.paths = lps;
      c._sizing = false;
      A.results.set(c.id, res);
      return res;
    }
    boards.forEach(b => stateOf(b.id));
    P.circuits.forEach(c => sizeOne(c));
    boards.forEach(b => A.boards.set(b.id, Object.assign({ ib: boardIb(b.id) }, stateOf(b.id))));

    // 5. containment fill — every cable on every piece of every run
    const odOf = (cid, role) => {
      const r = A.results.get(cid);
      if (!r) return [];
      const lr = (r.legs || []).find(l => l.role === role);
      if (!lr || !lr.od) return [];
      const n = lr.singles ? (lr.nSingles || 1) : 1;
      const kg = E.cableWeight(lr.type, lr.cores, lr.size, lr.od, 1);
      const fire = lr.type === 'fp200' || lr.type === 'fp600';
      return Array.from({ length: n }, () => ({ od: lr.od, kg, fire }));
    };
    const edgeCables = new Map();
    A.occ.forEach((list, eid) => {
      const ods = [];
      const e = G.edgeById.get(eid);
      const r = e && e.rid ? ix.route.get(e.rid) : null;
      const tiered = r && Number(r.tiers) === 2;
      list.forEach(o => odOf(o.cid, o.role).forEach(d => ods.push({ od: d.od, kg: d.kg, fire: d.fire, cid: o.cid, role: o.role, band: o.band, tier: tiered && o.band === 'I' ? 2 : 1, t0: o.t0, t1: o.t1 })));
      edgeCables.set(eid, ods);
    });
    A.edgeCables = edgeCables;

    // The fullest point of a piece of containment: cables that ride only part
    // of it are counted only where they are.
    function fullestPoint(list, need) {
      const ts = [...new Set(list.flatMap(x => [x.t0, x.t1]).concat([0, 1]))].sort((p, q) => p - q);
      let best = [], bv = -1;
      for (let i = 0; i < ts.length; i++) {
        const m = i < ts.length - 1 ? (ts[i] + ts[i + 1]) / 2 : ts[i];
        const here = list.filter(x => x.t0 <= m + 1e-9 && x.t1 >= m - 1e-9);
        const v = need(here);
        if (v > bv) { bv = v; best = here; }
      }
      return best;
    }

    // Band I (ELV control, data, signal) and Band II (LV power) on the same
    // containment must be segregated (528.1, BS EN 50174-2): a divider in
    // tray, ladder and basket, a compartment in trunking, never one conduit.
    function sizeContainment(kind, layout, cabs, override) {
      const C = E.CONTAINMENT[kind] || E.CONTAINMENT.tray;
      const ods = cabs.map(x => x.od);
      const odII = cabs.filter(x => x.band !== 'I').map(x => x.od);
      const odI = cabs.filter(x => x.band === 'I').map(x => x.od);
      const mixed = odII.length > 0 && odI.length > 0;
      const out = { kind, cables: ods.length, sumOd: ods.reduce((a, d) => a + d, 0), mixed, seg: mixed ? (s.segMethod || 'divider') : null };
      const spaced = layout === 'spaced';
      if (C.fill === 'width') {
        const sepMm = mixed ? (out.seg === 'gap' ? Number(s.segGapMm) || 200 : out.seg === 'divider' ? Number(s.segDividerMm) || 10 : 0) : 0;
        out.sepMm = sepMm;
        const req = (list, spare) => mixed ? E.widthRequired(odII, spare, spaced) + E.widthRequired(odI, spare, false) + sepMm : E.widthRequired(list, spare, spaced);
        out.reqMm = req(ods, s.spare);
        out.auto = E.pickWidth(kind, out.reqMm);
        out.width = override ? Number(override) : out.auto;
        out.size = out.width ? out.width + ' mm' : 'over ' + C.widths[C.widths.length - 1] + ' mm';
        out.fillPct = out.width ? out.sumOd / out.width * 100 : null;
        out.ok = !!out.width && out.width >= req(ods, 0) - 1e-9;
        out.okSpare = !!out.width && out.width >= out.reqMm - 1e-9;
      } else if (C.fill === 'area') {
        const t = E.pickTrunking(kind, ods, s.spaceTrunking, s.spare);
        out.auto = t.size;
        const sz = override ? String(override).split('x').map(Number) : t.size;
        out.width = sz ? sz[0] : null; out.height = sz ? sz[1] : null;
        out.size = sz ? sz[0] + '×' + sz[1] + ' mm' + (mixed ? ' 2-compartment' : '') : 'oversize';
        out.fillPct = sz ? E.areaOf(ods) / (sz[0] * sz[1]) * 100 : null;
        out.ok = !!sz && out.fillPct <= t.sf * 100 + 1e-9;
        out.okSpare = out.ok;
        out.reqMm = Math.sqrt(t.needMm2 / t.sf);
      } else if (C.fill === 'conduit') {
        const t = E.pickConduit(kind, ods, s.spaceConduit);
        out.auto = t.bore;
        out.width = override ? Number(override) : t.bore;
        out.size = out.width ? out.width + ' mm' : 'oversize';
        out.fillPct = out.width ? E.areaOf(ods) / (Math.PI * out.width * out.width / 4) * 100 : null;
        out.ok = !!out.width && out.fillPct <= t.sf * 100 + 1e-9 && !mixed;
        out.okSpare = out.ok;
      } else {
        out.width = Math.max(20, out.sumOd); out.size = '—'; out.fillPct = null; out.ok = true; out.okSpare = true;
      }
      // what the plan and 3D draw: the chosen width, or what is needed if nothing fits
      out.drawMm = out.width || out.reqMm || out.sumOd || 50;
      return out;
    }
    const widthNeed = (layout) => (here) => {
      const II = here.filter(x => x.band !== 'I'), I = here.filter(x => x.band === 'I');
      const sep = II.length && I.length ? (s.segMethod === 'gap' ? Number(s.segGapMm) || 200 : s.segMethod === 'divider' ? Number(s.segDividerMm) || 10 : 0) : 0;
      return E.widthRequired(II.map(x => x.od), 0, layout === 'spaced') + E.widthRequired(I.map(x => x.od), 0, false) + sep;
    };

    const kgNeed = (here) => here.reduce((a, x) => a + (x.kg || 0), 0);
    P.routes.forEach(r => {
      const edges = G.edges.filter(e => e.rid === r.id);
      const tiered = Number(r.tiers) === 2;
      const need = widthNeed(r.layout);
      // the fullest point of the run, per tier
      const worstOf = (pick) => {
        let worst = [], wv = -1;
        edges.forEach(e => {
          const list = (edgeCables.get(e.id) || []).filter(pick);
          const here = fullestPoint(list, need);
          const v = need(here);
          if (v > wv) { wv = v; worst = here; }
        });
        return worst;
      };
      const all = [];
      edges.forEach(e => (edgeCables.get(e.id) || []).forEach(x => all.push(x)));
      const res = sizeContainment(r.type, r.layout, worstOf(x => x.tier !== 2), r.width);
      if (tiered) {
        res.tiers = 2;
        res.tier2 = sizeContainment(r.type, 'touching', worstOf(x => x.tier === 2), r.width2);
        res.mixed = false; res.seg = null;
      } else {
        res.mixedAnywhere = edges.some(e => (edgeCables.get(e.id) || []).some(x => x.band === 'I') && (edgeCables.get(e.id) || []).some(x => x.band !== 'I'));
        if (res.mixedAnywhere && !res.mixed) { res.mixed = true; res.seg = s.segMethod || 'divider'; }
      }
      // large cables will not take a standard tray bend (minimum internal
      // radius about 8 × D for armoured cable): ladder with large-radius bends
      res.maxOd = all.length ? Math.max(...all.map(x => x.od)) : 0;
      res.bendR = res.maxOd * 8;
      res.bendWarn = (r.type === 'tray' || r.type === 'basket' || r.type === 'trunking' || r.type === 'pvctrunking') && res.bendR > (Number(s.trayBendR) || 150);
      res.circuits = new Set();
      edges.forEach(e => (A.occ.get(e.id) || []).forEach(o => res.circuits.add(o.cid)));
      res.nCircuits = res.circuits.size;
      res.maxGrouped = Math.max(0, ...edges.map(e => powerCount(e.id, 0, 1)));
      // tray loading: cable weight at the heaviest point against the safe
      // working load at this run's support spacing
      const C0 = E.CONTAINMENT[r.type] || {};
      const duty = C0.duties && C0.duties[r.duty] ? r.duty : C0.defaultDuty;
      const span = Number(r.spacing) > 0 ? Number(r.spacing) : (s.spacing[r.type] || 1.5);
      const loadOf = (tier, w) => {
        let kg = 0;
        edges.forEach(e => {
          const list = (edgeCables.get(e.id) || []).filter(x => (x.tier || 1) === tier);
          kg = Math.max(kg, kgNeed(fullestPoint(list, kgNeed)));
        });
        const swl = E.traySwl(r.type, duty, w, span);
        return { kg, swl, ok: swl == null || kg <= swl + 1e-9, pct: swl ? kg / swl * 100 : null };
      };
      res.load = loadOf(1, res.width);
      if (tiered) res.tier2.load = loadOf(2, res.tier2.width);
      // fire-resistant cables and escape routes need metal supports throughout
      res.fire = all.some(x => x.fire);
      res.escape = !!r.escape;
      res.plastic = r.type === 'pvctrunking' || r.type === 'pvcconduit';
      res.stepPlan = stepPlan(r, edges, res);
      A.routes.set(r.id, res);
    });

    // Where a run could step down a size: the standard width needed along
    // the run, and the stretches (fed from either end) that need less than
    // the size chosen. Only for an automatic width.
    function stepPlan(r, edges, res) {
      const C0 = E.CONTAINMENT[r.type] || {};
      if (C0.fill !== 'width' || r.width || !res.width || Number(r.tiers) === 2) return null;
      const need = widthNeed(r.layout);
      const prof = [];
      let dist = 0;
      edges.slice().sort((a, b) => a.i - b.i).forEach(e => {
        const list = (edgeCables.get(e.id) || []).filter(x => x.tier !== 2);
        const ts = [...new Set(list.flatMap(x => [x.t0, x.t1]).concat([0, 1]))].sort((p, q) => p - q);
        for (let k = 0; k < ts.length - 1; k++) {
          const a0 = ts[k], a1 = ts[k + 1];
          if (a1 - a0 < 1e-9) continue;
          const m = (a0 + a1) / 2;
          const here = list.filter(x => x.t0 <= m + 1e-9 && x.t1 >= m - 1e-9);
          let w = E.pickWidth(r.type, need(here) * (1 + (Number(s.spare) || 0) / 100));
          if (!w) w = res.width;
          const len = e.len * (a1 - a0);
          prof.push({ i: e.i, t0: a0, t1: a1, w, s0: dist, s1: dist + len, len });
          dist += len;
        }
      });
      if (prof.length < 2) return null;
      const env = (arr) => { let m = 0; return arr.map(p => (m = Math.max(m, p.w))); };
      const fwd = env(prof.slice().reverse()).reverse();   // fed from the start
      const bwd = env(prof);                                // fed from the end
      const saving = (e2) => prof.reduce((a, p, k) => a + (e2[k] < res.width ? p.len : 0), 0);
      const sF = saving(fwd), sB = saving(bwd);
      const envUse = sF >= sB ? fwd : bwd;
      const savingM = Math.max(sF, sB);
      if (savingM < 1) return null;
      const parts = [];
      prof.forEach((p, k) => {
        const w = envUse[k];
        const last = parts[parts.length - 1];
        if (last && last.width === w) { last.to = p.s1; last.endI = p.i; last.endT = p.t1; }
        else parts.push({ width: w, from: p.s0, to: p.s1, i: p.i, t: p.t0, endI: p.i, endT: p.t1 });
      });
      if (parts.length < 2) return null;
      return { parts, savingM, cuts: parts.slice(1).map(p => ({ i: p.i, t: p.t, at: p.from, width: p.width })) };
    }

    // risers size the same way, per riser name
    A.risers = new Map();
    G.edges.filter(e => e.riser).forEach(e => {
      const n = ix.node.get(e.riserNode);
      const list = edgeCables.get(e.id) || [];
      const prev = A.risers.get(e.riser);
      const res = sizeContainment(n.riserType || 'tray', 'touching', list, n.riserWidth);
      res.len = (prev ? prev.len : 0) + e.len;
      if (!prev || (res.width || 0) >= (prev.width || 0)) A.risers.set(e.riser, Object.assign(res, { node: n }));
      else prev.len = res.len;
    });

    // 6. issues
    P.nodes.forEach(n => {
      if (n.kind === 'load' && !P.circuits.some(c => c.target === n.id && c.kind === 'power')) A.issues.push({ sev: 'warn', node: n.id, text: (n.name || 'Load') + ' has no supply traced' });
      if (n.kind === 'isolator' && !P.circuits.some(c => c.iso === n.id)) A.issues.push({ sev: 'warn', node: n.id, text: (n.name || 'Isolator') + ' is not on a circuit' });
    });
    P.circuits.forEach(c => {
      const r = A.results.get(c.id);
      if (r && !r.ok) A.issues.push({ sev: 'fail', circuit: c.id, text: (c.ref || c.id) + ': ' + r.checks.filter(x => !x.ok && !x.warn).map(x => x.text).join('; ') });
      else if (r && r.checks.some(x => x.warn && !x.ok)) A.issues.push({ sev: 'warn', circuit: c.id, text: (c.ref || c.id) + ': ' + r.checks.filter(x => x.warn && !x.ok).map(x => x.text).join('; ') });
    });
    A.routes.forEach((res, rid) => {
      const r = ix.route.get(rid);
      if (!res.ok) A.issues.push({ sev: 'fail', route: rid, text: (r.name || rid) + ': ' + E.CONTAINMENT[r.type].label + ' over-full (' + (res.fillPct ? res.fillPct.toFixed(0) + ' %' : 'no size fits') + ')' });
      else if (!res.okSpare) A.issues.push({ sev: 'warn', route: rid, text: (r.name || rid) + ': less than the ' + s.spare + ' % spare allowance' });
      if (res.mixed && (r.type === 'conduit' || r.type === 'pvcconduit')) A.issues.push({ sev: 'fail', route: rid, text: (r.name || rid) + ': power and control / data cables in the same conduit — segregate them (528.1)' });
      else if (res.mixed && res.seg === 'separate') A.issues.push({ sev: 'warn', route: rid, text: (r.name || rid) + ': power and control / data share this run — move the Band I cables to their own containment (528.1)' });
      if (res.fire && res.plastic) A.issues.push({ sev: 'fail', route: rid, text: (r.name || rid) + ': fire-resistant cables in plastic containment — support them with metal (521.10.202, BS 5839-1)' });
      else if (res.escape && res.plastic) A.issues.push({ sev: 'warn', route: rid, text: (r.name || rid) + ': plastic containment on an escape route needs metal fixings so it cannot collapse in a fire (521.10.202)' });
      [res.load, res.tier2 && res.tier2.load].forEach((ld, k) => { if (ld && !ld.ok) A.issues.push({ sev: 'fail', route: rid, text: (r.name || rid) + (k ? ' upper tier' : '') + ': cable load ' + ld.kg.toFixed(1) + ' kg/m over the ' + ld.swl.toFixed(0) + ' kg/m safe load at ' + (Number(r.spacing) || s.spacing[r.type]) + ' m centres — closer supports or heavier duty' }); });
      if (res.stepPlan) A.issues.push({ sev: 'info', route: rid, text: (r.name || rid) + ': could step down — ' + res.stepPlan.parts.map(p => p.width + ' mm for ' + (p.to - p.from).toFixed(1) + ' m').join(', then ') });
      if (res.bendWarn) A.issues.push({ sev: 'warn', route: rid, text: (r.name || rid) + ': carries a ' + res.maxOd.toFixed(1) + ' mm cable needing about ' + Math.round(res.bendR) + ' mm bend radius — use ladder with large-radius bends' });
    });
    // fire stopping where containment and cables cross a fire-rated wall
    A.fire = fireCrossings(P, A);
    return A;
  }

  function segCross(p1, p2, q1, q2) {
    const d = (p2.x - p1.x) * (q2.y - q1.y) - (p2.y - p1.y) * (q2.x - q1.x);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((q1.x - p1.x) * (q2.y - q1.y) - (q1.y - p1.y) * (q2.x - q1.x)) / d;
    const u = ((q1.x - p1.x) * (p2.y - p1.y) - (q1.y - p1.y) * (p2.x - p1.x)) / d;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y), t };
  }
  function fireCrossings(P, A) {
    const out = [];
    const walls = P.firewalls || [];
    if (!walls.length) return out;
    const each = (sheet, a, b, fn) => walls.forEach(w => {
      if (w.sheet !== sheet) return;
      for (let i = 1; i < w.pts.length; i++) { const x = segCross(a, b, w.pts[i - 1], w.pts[i]); if (x) fn(x, w); }
    });
    A.G.edges.forEach(e => {
      if (!e.rid || e.plan < 1e-6) return;
      const r = A.ix.route.get(e.rid);
      const pa = A.G.nodes.get(e.a), pb = A.G.nodes.get(e.b);
      each(r.sheet, pa, pb, (x, w) => out.push({ kind: 'contain', rid: r.id, x: x.x, y: x.y, sheet: r.sheet, rating: Number(w.rating) || P.settings.fireRating || 60, wall: w.id }));
    });
    P.circuits.forEach(c => {
      const res = A.results.get(c.id);
      (res && res.paths || []).forEach((lp, k) => lp.spans.forEach(sp => {
        if (sp.edge || sp.from.sheet !== sp.to.sheet) return;
        const lr = (res.legs || [])[k] || {};
        each(sp.from.sheet, sp.from, sp.to, (x, w) => out.push({ kind: 'cable', cid: c.id, role: lp.role, od: lr.od, x: x.x, y: x.y, sheet: sp.from.sheet, rating: Number(w.rating) || P.settings.fireRating || 60, wall: w.id }));
      }));
    });
    return out;
  }

  // Split a run at the given cuts ({i: edge index, t: 0..1 along it}) into
  // separate runs joined end to end, each sized on its own. Cable waypoints
  // keep their point ids, so the cables stay on.
  function splitRoute(P, rid, cuts) {
    const r = P.routes.find(x => x.id === rid);
    if (!r || !cuts.length) return [];
    // place every cut on the run as it was, then insert in order along it
    const orig = r.pts.slice();
    const at = [];
    cuts.slice().sort((a, b) => a.i - b.i || a.t - b.t).forEach(cu => {
      const a = orig[cu.i - 1], b = orig[cu.i];
      if (!a || !b) return;
      if (cu.t <= 1e-6) { at.push(r.pts.indexOf(a)); return; }
      if (cu.t >= 1 - 1e-6) { at.push(r.pts.indexOf(b)); return; }
      const np = { id: nid(P, 'p'), x: a.x + (b.x - a.x) * cu.t, y: a.y + (b.y - a.y) * cu.t, h: (a.h || 0) + ((b.h || 0) - (a.h || 0)) * cu.t };
      const k = r.pts.indexOf(b);
      r.pts.splice(k, 0, np);
      at.push(k);
    });
    const idxs = [...new Set(at)].filter(k => k > 0 && k < r.pts.length - 1).sort((a, b) => a - b);
    if (!idxs.length) return [];
    const all = r.pts;
    const bounds = [0].concat(idxs, [all.length - 1]);
    const made = [];
    r.pts = all.slice(0, bounds[1] + 1);
    r.width = null;
    for (let k = 1; k < bounds.length - 1; k++) {
      const from = all[bounds[k]];
      const piece = Object.assign({}, r, { id: nid(P, 'r'), name: (r.name || 'R') + String.fromCharCode(97 + k), width: null, pts: [] });
      piece.pts.push({ id: nid(P, 'p'), x: from.x, y: from.y, h: from.h, link: 'p:' + from.id });
      all.slice(bounds[k] + 1, bounds[k + 1] + 1).forEach(p => piece.pts.push(p));
      P.routes.push(piece);
      made.push(piece.id);
    }
    return made;
  }

  // Band I: extra-low voltage control, data and signal. Band II: LV power.
  function bandOf(c) {
    if (c.kind !== 'control') return 'II';
    const v = Number(c.ctrl && c.ctrl.volts) || 24;
    return (c.ctrl && c.ctrl.signal) || v <= 50 ? 'I' : 'II';
  }
  // the most items lying together anywhere in [t0, t1]
  function maxCover(list, t0, t1, w, distinct) {
    const ts = [...new Set(list.flatMap(x => [x.t0, x.t1]).concat([t0, t1]))].filter(t => t >= t0 - 1e-9 && t <= t1 + 1e-9).sort((p, q) => p - q);
    let best = 0;
    for (let i = 0; i < ts.length; i++) {
      const m = i < ts.length - 1 ? (ts[i] + ts[i + 1]) / 2 : ts[i];
      const here = list.filter(x => x.t0 <= m + 1e-9 && x.t1 >= m - 1e-9);
      const v = distinct ? new Set(here.map(x => x.cid)).size : here.reduce((a, x) => a + w(x), 0);
      if (v > best) best = v;
    }
    return Math.max(best, 1);
  }

  // Where each cable lies across a piece of containment, in mm from the
  // centreline (positive to the left of the run's direction). The plan and the
  // 3D both draw from this, so they always agree with each other and with the
  // width the take-off orders. Band II packs from one side, Band I from the
  // other with the divider (or gap) between; spaced cables keep 2 × D apart.
  function edgeLayout(P, A, eid) {
    const e = A.G.edgeById.get(eid);
    const r = e && e.rid ? A.ix.route.get(e.rid) : null;
    const res = r ? A.routes.get(r.id) : (e && e.riser ? A.risers.get(e.riser) : null);
    const list = (A.edgeCables.get(eid) || []).slice();
    const order = new Map(P.circuits.map((c, i) => [c.id, i]));
    list.sort((a, b) => (order.get(a.cid) - order.get(b.cid)) || (a.role < b.role ? -1 : 1));
    const W = res ? res.drawMm : 100;
    const spaced = r && r.layout === 'spaced';
    if (res && res.tiers === 2) {
      // two tiers: power on the lower, control and data on the upper, each
      // packed from its centre; the plan draws the upper tier beside the lower
      const W2 = res.tier2 ? res.tier2.drawMm : 100;
      const items = [];
      [[list.filter(x => x.tier !== 2), 1], [list.filter(x => x.tier === 2), 2]].forEach(([arr, tier]) => {
        const ln = (x) => x.od + (tier === 1 && spaced ? 2 * x.od : 0);
        const total = arr.reduce((a, x) => a + ln(x), 0) - (tier === 1 && spaced && arr.length ? 2 * arr[arr.length - 1].od : 0);
        let pos = -total / 2;
        arr.forEach(x => { items.push(Object.assign({}, x, { off: pos + x.od / 2, tier })); pos += ln(x); });
      });
      return { items, divider: null, W, W2, tiers: 2 };
    }
    const lane = (x) => x.od + (spaced && x.band !== 'I' ? 2 * x.od : 0);
    const II = list.filter(x => x.band !== 'I'), I = list.filter(x => x.band === 'I');
    const items = [];
    let divider = null;
    const packFrom = (arr, start, dir) => {
      let pos = start;
      arr.forEach(x => { const c0 = pos + dir * x.od / 2; items.push(Object.assign({}, x, { off: c0 })); pos += dir * lane(x); });
      return pos;
    };
    // Offsets are positive to the right of the trace direction on the plan.
    // Power keeps to the left edge, or to the wall for a tray on edge ("left
    // of the trace" is side 1).
    const ps = r && r.orient === 'wall' && r.side === -1 ? 1 : -1;
    if (II.length && I.length) {
      const endII = packFrom(II, ps * W / 2, -ps);
      packFrom(I, -ps * W / 2, ps);
      const sep = res && res.sepMm ? res.sepMm : 10;
      divider = endII - ps * sep / 2;
    } else if (r && r.orient === 'wall') {
      packFrom(list, ps * W / 2, -ps);
    } else {
      const total = list.reduce((a, x) => a + lane(x), 0) - (spaced && list.length ? 2 * list[list.length - 1].od : 0);
      packFrom(list, -total / 2, 1);
    }
    return { items, divider, W };
  }

  function loadInput(L) {
    return {
      kind: L.loadKind || 'general', phase: L.phase === 1 ? 1 : 3, neutral: !!L.neutral,
      kw: L.kw, kwBasis: L.kwBasis || 'input', pf: L.pf, eff: L.eff, amps: L.amps,
      peakA: L.peakA, drive: L.drive, startMult: L.startMult
    };
  }

  // ------------------------------------------------------------------
  // Take-off
  // ------------------------------------------------------------------
  function deflection(ax, ay, bx, by, cx, cy) {
    const v1x = bx - ax, v1y = by - ay, v2x = cx - bx, v2y = cy - by;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-6 || l2 < 1e-6) return 0;
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
    return Math.acos(cos) * 180 / Math.PI;
  }

  const FITTING_NAMES = {
    tray: { b90: 'Flat bend 90°', b45: 'Flat bend 45°', riser: 'Riser bend 90° (inside / outside)', tee: 'Equal tee', cross: 'Cross piece', reducer: 'Reducer', joint: 'Coupler set', end: 'Stop end' },
    ladder: { b90: 'Ladder bend 90° (large radius)', b45: 'Ladder bend 45°', riser: 'Ladder riser 90° (inside / outside)', tee: 'Ladder tee', cross: 'Ladder cross', reducer: 'Ladder reducer', joint: 'Ladder coupler pair', end: 'Ladder end' },
    basket: { b90: 'Basket bend (field made) — joint kit', b45: 'Basket 45° (field made) — joint kit', riser: 'Basket riser (field made) — joint kit', tee: 'Basket tee (field made) — joint kit', cross: 'Basket cross (field made) — joint kit', reducer: 'Basket reducer (field made)', joint: 'Basket coupler', end: '' },
    trunking: { b90: 'Trunking flat bend 90°', b45: 'Trunking bend 45°', riser: 'Trunking internal / external angle', tee: 'Trunking tee', cross: 'Trunking four-way', reducer: 'Trunking reducer', joint: 'Trunking coupler', end: 'Trunking stop end' },
    pvctrunking: { b90: 'PVC trunking flat angle', b45: 'PVC trunking 45°', riser: 'PVC trunking int / ext angle', tee: 'PVC trunking tee', cross: 'PVC trunking cross', reducer: 'PVC trunking reducer', joint: 'PVC trunking coupler', end: 'PVC trunking end cap' },
    conduit: { b90: 'Conduit 90° bend / angle box', b45: 'Conduit 45° set', riser: 'Conduit 90° bend (vertical)', tee: 'Conduit tee box', cross: 'Conduit four-way box', reducer: 'Conduit reducer', joint: 'Conduit coupler', end: 'Conduit terminal box' },
    pvcconduit: { b90: 'PVC conduit 90° bend', b45: 'PVC conduit 45° set', riser: 'PVC conduit 90° bend (vertical)', tee: 'PVC conduit tee box', cross: 'PVC conduit four-way box', reducer: 'PVC conduit reducer', joint: 'PVC conduit coupler', end: 'PVC conduit terminal box' },
    cleats: {}
  };

  function routeFittings(P, A) {
    const { G, ix } = A;
    const out = new Map(); // rid → {b90,b45,riser,tee,cross,reducer,end}
    const bump = (rid, k, n) => { if (!rid) return; if (!out.has(rid)) out.set(rid, {}); const o = out.get(rid); o[k] = (o[k] || 0) + (n || 1); };
    G.edges.forEach(e => { if (e.rid && e.dh > 0.05) bump(e.rid, 'riser', 2); });
    G.adj.forEach((list, key) => {
      const es = list.filter(e => e.rid);
      const deg = es.length;
      if (deg === 1) { bump(es[0].rid, 'end'); return; }
      if (deg === 2) {
        const [e1, e2] = es;
        if (e1.plan < 1e-6 || e2.plan < 1e-6) return;
        const p = G.nodes.get(key);
        const o1 = G.nodes.get(e1.a === key ? e1.b : e1.a);
        const o2 = G.nodes.get(e2.a === key ? e2.b : e2.a);
        const d = deflection(o1.x, o1.y, p.x, p.y, o2.x, o2.y);
        if (d > 67.5) bump(e1.rid, 'b90');
        else if (d > 22.5) bump(e1.rid, 'b45');
        if (e1.rid !== e2.rid) {
          const w1 = (A.routes.get(e1.rid) || {}).width, w2 = (A.routes.get(e2.rid) || {}).width;
          if (w1 && w2 && w1 !== w2) bump(w1 > w2 ? e1.rid : e2.rid, 'reducer');
        }
        return;
      }
      if (deg === 3) {
        // the tee belongs to the run that carries straight through
        const host = es.find((e, i) => es.some((f, j) => j !== i && f.rid === e.rid)) || es[0];
        bump(host.rid, 'tee');
      } else if (deg >= 4) bump(es[0].rid, 'cross');
    });
    out.forEach((o, rid) => {
      const r = ix.route.get(rid);
      if (r && (r.type === 'tray' || r.type === 'ladder' || r.type === 'basket') && o.end) o.end = 0; // open ends are not fitted
    });
    return out;
  }

  function routeLengths(A, rid) {
    let plan = 0, vert = 0;
    A.G.edges.forEach(e => { if (e.rid === rid) { plan += e.plan; vert += e.dh; } });
    return { plan, vert, total: plan + vert };
  }

  function addTo(map, key, qty, extra) {
    if (!map.has(key)) map.set(key, Object.assign({ qty: 0 }, extra || {}));
    map.get(key).qty += qty;
  }

  function takeoff(P, A) {
    const s = P.settings;
    const ix = A.ix;
    const cables = new Map(), contain = new Map(), fittings = new Map(), fixings = new Map(),
      isolators = new Map(), glands = new Map(), flex = new Map(), devices = new Map(), field = new Map(), sundries = new Map();
    const wasteC = 1 + (Number(s.wasteCable) || 0) / 100;
    const wasteK = 1 + (Number(s.wasteContain) || 0) / 100;

    // cables
    P.circuits.forEach(c => {
      const r = A.results.get(c.id);
      if (!r) return;
      (r.legs || []).forEach(lr => {
        const t = E.CABLE_TYPES[lr.type];
        if (!t || !lr.size) return;
        const L = lr.lengthM || 0;
        if (lr.singles) {
          const live = (lr.nSingles || 2) - 1;
          addTo(cables, t.short + '|1c|' + lr.size, L * live, { type: lr.type, desc: t.label, cores: '1c', size: lr.size, colour: 'brown/black/grey/blue' });
          if (lr.cpcArea) addTo(cables, t.short + '|1c|' + lr.cpcArea + '|cpc', L, { type: lr.type, desc: t.label + ' (CPC, green/yellow)', cores: '1c', size: lr.cpcArea });
        } else {
          const word = t.coreWord === 'pair' ? 'pr' : 'c';
          addTo(cables, t.short + '|' + lr.cores + word + '|' + lr.size, L, { type: lr.type, desc: t.label, cores: lr.cores + word, size: lr.size });
        }
      });
    });
    cables.forEach(v => { v.order = Math.ceil(v.qty * wasteC); });

    // containment, fittings, fixings
    const fits = routeFittings(P, A);
    P.routes.forEach(r => {
      const res = A.routes.get(r.id) || {};
      const C = E.CONTAINMENT[r.type] || E.CONTAINMENT.tray;
      const lens = routeLengths(A, r.id);
      const finish = r.type === 'pvctrunking' || r.type === 'pvcconduit' ? 'pvc' : (r.finish || s.defFinish);
      const duty = C.duties[r.duty] ? r.duty : C.defaultDuty;
      const dutyLabel = C.duties[duty];
      const sizeLabel = res.size || '—';
      if (r.type !== 'cleats') {
        addTo(contain, [r.type, sizeLabel, duty, finish].join('|'), lens.total, { desc: C.label, size: sizeLabel, duty: dutyLabel, finish: E.FINISHES[finish] || finish, stockM: C.stockM });
      }
      // segregation: a divider the length of a run carrying power and Band I
      if (res.mixed && (res.seg === 'divider' || C.fill === 'area') && r.type !== 'cleats' && C.fill !== 'conduit') {
        const what = C.fill === 'area' ? 'Trunking compartment divider' : (r.type === 'ladder' ? 'Ladder divider / separator' : r.type === 'basket' ? 'Basket divider' : 'Tray divider / separator strip');
        addTo(contain, ['divider', r.type, finish].join('|'), lens.total, { desc: what + ' (Band I / II segregation)', size: '—', duty: '', finish: E.FINISHES[finish] || finish, stockM: C.stockM || 3 });
      }
      const f = fits.get(r.id) || {};
      const names = FITTING_NAMES[r.type] || {};
      let nFit = 0;
      // the upper tier of a two-tier run is a second run of its own size,
      // with the same fittings
      const sizes = [sizeLabel].concat(res.tiers === 2 && res.tier2 ? [res.tier2.size || '—'] : []);
      if (res.tiers === 2 && res.tier2) addTo(contain, [r.type, res.tier2.size, duty, finish, 'upper'].join('|'), lens.total, { desc: C.label + ' (upper tier — control / data)', size: res.tier2.size, duty: dutyLabel, finish: E.FINISHES[finish] || finish, stockM: C.stockM });
      sizes.forEach((sz, ti) => {
        Object.keys(f).forEach(k => {
          if (!f[k] || !names[k]) return;
          if (!ti) nFit += f[k];
          addTo(fittings, [names[k], sz, finish].join('|'), f[k], { desc: names[k], size: sz, finish: E.FINISHES[finish] || finish });
        });
        if (C.stockM && r.type !== 'cleats') {
          const lengths = Math.ceil(lens.total * wasteK / C.stockM);
          const joints = Math.max(0, lengths - 1) + Object.keys(f).reduce((a, k) => a + (names[k] ? f[k] : 0), 0) * 2;
          if (names.joint) addTo(fittings, [names.joint, sz, finish].join('|'), joints, { desc: names.joint, size: sz, finish: E.FINISHES[finish] || finish });
        }
      });
      // supports along the horizontal, wall fixings up the vertical
      const spacing = Number(r.spacing) > 0 ? Number(r.spacing) : (s.spacing[r.type] || 1.5);
      const mount = r.mount || (r.type.includes('conduit') ? 'saddle' : r.type === 'cleats' ? 'cleat' : s.defMount);
      const soffit = Number(r.soffit) > 0 ? Number(r.soffit) : s.soffit;
      let supports = 0;
      A.G.edges.filter(e => e.rid === r.id).forEach(e => {
        if (e.plan > 0.01) {
          const n = Math.ceil(e.plan / spacing);
          supports += n;
          const pa = A.G.nodes.get(e.a), pb = A.G.nodes.get(e.b);
          const hAvg = ((pa.h || 0) + (pb.h || 0)) / 2;
          const depthM = ((res.height || (C.depths && C.depths[0]) || 50)) / 1000;
          const drop = Math.max(0.1, soffit - hAvg - depthM);
          const nCab = (A.edgeCables.get(e.id) || []).length;
          E.supportKit(mount, r.type, res.width, drop, { cables: Math.max(1, nCab) }).forEach(it => addTo(fixings, it.item + '|' + it.unit, it.qty * n, { desc: it.item, unit: it.unit }));
        }
        if (e.dh > 0.05) {
          const n = Math.ceil(e.dh / spacing) + 1;
          supports += n;
          E.supportKit(r.type.includes('conduit') ? 'saddle' : 'wallbracket', r.type, res.width, 0).forEach(it => addTo(fixings, it.item + '|' + it.unit, it.qty * n, { desc: it.item, unit: it.unit }));
        }
      });
      // the upper tier hangs from the same supports: one more trapeze (or arm)
      // on each, and drop rods that reach the lower tier
      if (res.tiers === 2 && res.tier2 && supports) {
        const w2 = res.tier2.width || res.width;
        const per = mount === 'droprod' || mount === 'beamclamp' ? [['41×41 unistrut channel (trapeze, upper tier)', (w2 + 150) / 1000, 'm'], ['M10 channel nut + washer', 2, 'nr'], ['M10 threaded drop rod', 2 * (Number(s.tierGapMm) || 300) / 1000, 'm']]
          : mount === 'cantilever' ? [['Unistrut cantilever arm ' + (E.UNISTRUT_ARMS.find(a => a >= w2) || 750) + ' mm (upper tier)', 1, 'nr'], ['M10 channel nut + set screw', 2, 'nr']]
          : [['Wall support bracket ' + w2 + ' mm (upper tier)', 1, 'nr'], ['M8 wall anchor', 2, 'nr']];
        per.forEach(([item, q, unit]) => addTo(fixings, item + '|' + unit, q * supports, { desc: item, unit }));
      }
      // one support at each fitting
      if (nFit && mount !== 'cleat') {
        E.supportKit(mount, r.type, res.width, Math.max(0.1, soffit - s.containHeight)).forEach(it => addTo(fixings, it.item + '|' + it.unit, it.qty * nFit, { desc: it.item, unit: it.unit }));
        supports += nFit;
      }
      res.supports = supports; res.fit = f; res.lens = lens; res.mount = mount; res.spacing = spacing;
    });
    // risers
    (A.risers || new Map()).forEach((res, key) => {
      const C = E.CONTAINMENT[res.kind] || E.CONTAINMENT.tray;
      addTo(contain, [res.kind, res.size, 'riser', s.defFinish].join('|'), res.len, { desc: C.label + ' (riser ' + key + ')', size: res.size, duty: 'Riser', finish: E.FINISHES[s.defFinish], stockM: C.stockM });
      const n = Math.ceil(res.len / (s.spacing[res.kind] || 1.5)) + 1;
      E.supportKit('wallbracket', res.kind, res.width, 0).forEach(it => addTo(fixings, it.item + '|' + it.unit, it.qty * n, { desc: it.item, unit: it.unit }));
    });
    fixings.forEach(v => { if (v.unit === 'm') v.qty = Math.ceil(v.qty * 10) / 10; });

    // isolators
    P.nodes.filter(n => n.kind === 'isolator').forEach(n => {
      const iso = isolatorSpec(P, A, n);
      const key = [iso.rating || '?', iso.poles, iso.aux ? 'aux' : '', iso.enclosure, iso.ip, iso.fused ? 'fused' : ''].join('|');
      addTo(isolators, key, 1, { desc: iso.text, rating: iso.rating, poles: iso.poles, aux: iso.aux, enclosure: E.ISOLATOR_ENCLOSURES[iso.enclosure] || iso.enclosure, ip: iso.ip, fused: iso.fused });
      if (n.mount === 'unistrut') {
        addTo(fixings, '41×41 unistrut channel (isolator mounting)|m', 0.6, { desc: '41×41 unistrut channel (isolator mounting)', unit: 'm' });
        addTo(fixings, 'M10 wall anchor|nr', 2, { desc: 'M10 wall anchor', unit: 'nr' });
        addTo(fixings, 'M6 channel nut + set screw (isolator)|nr', 4, { desc: 'M6 channel nut + set screw (isolator)', unit: 'nr' });
      } else {
        addTo(fixings, 'No. 10 screw + plug (isolator)|nr', 4, { desc: 'No. 10 screw + plug (isolator)', unit: 'nr' });
      }
    });

    // glands, flexible conduit
    const outdoorAt = (id) => { const n = ix.node.get(id); return !!(n && n.outdoor); };
    P.circuits.forEach(c => {
      const r = A.results.get(c.id);
      if (!r) return;
      (r.paths || []).forEach((lp, k) => {
        const lr = (r.legs || [])[k];
        if (!lr || !lr.od) return;
        const t = E.CABLE_TYPES[lr.type];
        const leg = (c.legs && c.legs[lp.role]) || {};
        const flexOn = lp.role === 'tail' && (leg.flex != null ? leg.flex : s.tailFlex) && !t.armoured;
        if (flexOn) {
          const fc = E.flexConduitFor(lr.od) || 'oversize';
          addTo(flex, 'Flexible conduit ' + fc + ' mm|m', lr.lengthM, { desc: 'Flexible conduit (Adaptaflex / Kopex type) ' + fc + ' mm', unit: 'm' });
          addTo(flex, 'Flexible conduit fitting ' + fc + ' mm|nr', 2, { desc: 'Flexible conduit fitting / gland ' + fc + ' mm', unit: 'nr' });
          return;
        }
        if (t.singles) return; // drawn into conduit / trunking, no glands
        [lp.from, lp.to].forEach(endId => {
          const n = ix.node.get(endId);
          if (n && n.kind === 'riser') return;
          if (t.armoured) {
            let type = outdoorAt(endId) ? (s.glandOutdoor || 'CW') : (s.cwIndoors ? 'CW' : (s.glandIndoor || 'BW'));
            if (lr.type === 'vsd' || r.vsdPanel) type = 'EMC';
            if (leg.gland && leg.gland !== 'auto') type = leg.gland;
            const g = E.glandFor(lr.od, true);
            addTo(glands, type + ' ' + g, 1, { desc: type + ' gland ' + g, type, size: g });
            if (s.shrouds) addTo(glands, 'Shroud ' + g, 1, { desc: 'PVC / LSF shroud ' + g, type: 'Shroud', size: g });
            if (s.earthTags) addTo(glands, 'Earth tag ' + g, 1, { desc: 'Earth tag ' + g, type: 'Earth tag', size: g });
          } else if (r.vsdPanel || lr.type === 'cy') {
            const g = E.glandFor(lr.od, false);
            addTo(glands, 'EMC brass ' + g, 1, { desc: 'EMC brass gland (360° screen) ' + g, type: 'EMC', size: g });
          } else {
            const g = E.glandFor(lr.od, false);
            addTo(glands, 'Nylon ' + g, 1, { desc: 'Nylon compression gland IP68 ' + g, type: 'Nylon', size: g });
          }
        });
      });
    });

    // protective devices, by board
    P.circuits.forEach(c => {
      const r = A.results.get(c.id);
      if (!r || !r.In || c.kind === 'control') return;
      const b = ix.node.get(c.board);
      addTo(devices, (b ? b.name : '—') + '|' + r.deviceText + '|' + r.kA, 1, { board: b ? b.name : '—', desc: r.deviceText, kA: r.kA });
    });
    P.nodes.filter(n => n.kind === 'device').forEach(n => addTo(field, n.devKind || 'device', 1, { desc: n.devKind || 'Field device' }));

    // cable ties per metre of tray / ladder (one every 300 mm per run of cables is overkill — one per 600 mm per cable)
    let ties = 0, mties = 0;
    A.edgeCables.forEach((list, eid) => {
      const e = A.G.edgeById.get(eid);
      if (!e) return;
      const r = e.rid ? ix.route.get(e.rid) : null;
      const kind = r ? r.type : 'tray';
      if (!(kind === 'tray' || kind === 'ladder' || kind === 'basket')) return;
      // fire-resistant cables, and everything on an escape route, are held
      // with metal ties so nothing drops in a fire (521.10.202)
      const metalAll = r && r.escape;
      const fireN = metalAll ? list.length : list.filter(x => x.fire).length;
      const rest = list.length - fireN;
      const per = Math.ceil(e.len / 0.6);
      if (rest) ties += per * Math.max(1, Math.ceil(rest / 3));
      if (fireN) mties += per * Math.max(1, Math.ceil(fireN / 3));
    });
    if (ties) addTo(sundries, 'Cable ties (UV stable)', ties, { desc: 'Cable ties, UV stable, one per 600 mm per bundle of three', unit: 'nr' });
    if (mties) addTo(sundries, 'Metal cable ties / fire-rated clips', mties, { desc: 'Stainless or coated-steel cable ties / fire clips (fire cables and escape routes)', unit: 'nr' });
    // fire-resistant cables clipped direct: metal clips every 300 mm
    P.circuits.forEach(c => {
      const r = A.results.get(c.id);
      (r && r.paths || []).forEach((lp, k) => {
        const lr = (r.legs || [])[k];
        if (!lr || !(lr.type === 'fp200' || lr.type === 'fp600')) return;
        const free = lp.spans.filter(sp => !sp.edge).reduce((a, sp) => a + sp.len, 0);
        if (free > 0.1) addTo(sundries, 'Fire-rated cable clips ' + (E.glandFor(lr.od, false)), Math.ceil(free / 0.3), { desc: 'Fire-rated (metal) cable clips for ' + lr.short + ' Ø' + lr.od.toFixed(1) + ' mm, 300 mm centres', unit: 'nr' });
      });
    });

    // fire stopping at fire-rated walls
    const fire = new Map();
    (A.fire || []).forEach(x => {
      if (x.kind === 'contain') {
        const r = ix.route.get(x.rid); const res = A.routes.get(x.rid) || {};
        const Cx = E.CONTAINMENT[r.type] || {};
        const what = Cx.fill === 'conduit' ? 'Intumescent conduit seal' : Cx.fill === 'area' ? 'Trunking fire barrier + intumescent seal' : 'Fire batt / intumescent pillow seal';
        const sizes = [res.size || '—'].concat(res.tiers === 2 && res.tier2 ? [res.tier2.size] : []);
        sizes.forEach(sz => addTo(fire, [what, Cx.label, sz, x.rating].join('|'), 1, { desc: what + ' — ' + Cx.label + ' ' + sz, rating: x.rating + ' min', unit: 'nr' }));
      } else {
        const sz = x.od ? (x.od <= 12 ? 'up to 12 mm' : x.od <= 25 ? '12–25 mm' : x.od <= 40 ? '25–40 mm' : 'over 40 mm') : '—';
        addTo(fire, ['Intumescent cable sleeve / collar', sz, x.rating].join('|'), 1, { desc: 'Intumescent cable sleeve / collar, cable Ø ' + sz, rating: x.rating + ' min', unit: 'nr' });
      }
    });

    return { cables, contain, fittings, fixings, isolators, glands, flex, devices, field, sundries, fire, fits };
  }

  function isolatorSpec(P, A, n) {
    const s = P.settings;
    const c = P.circuits.find(x => x.iso === n.id);
    const r = c && A.results.get(c.id);
    const L = c && A.ix.node.get(c.target);
    const phase = L ? (L.phase === 1 ? 1 : 3) : 3;
    const neutral = L ? !!L.neutral : false;
    const drive = L && E.LOAD_KINDS[L.loadKind] && E.LOAD_KINDS[L.loadKind].motor ? (L.drive || 'DOL') : 'NA';
    const pick = E.pickIsolator(r && r.In ? r.In : 16, phase, neutral, drive, { poles: n.poles, aux: n.aux === 'auto' || n.aux == null ? null : n.aux === true || n.aux === 'yes' });
    const rating = Number(n.rating) > 0 ? Number(n.rating) : pick.rating;
    let enclosure = n.enclosure || s.isoEnclosure || 'poly';
    if (!n.enclosure && n.outdoor && s.stainlessOutdoor) enclosure = 'ss316';
    const ip = n.ip || s.isoIP || 'IP66';
    const fused = !!n.fused;
    const warn = [];
    if (r && r.In && rating && rating < r.In) warn.push('Rated ' + rating + ' A, below the ' + r.In + ' A device');
    if (drive === 'VSD' && !pick.aux) warn.push('VSD: fit an early-break auxiliary contact to inhibit the drive');
    const text = (rating || '?') + ' A ' + pick.poles + (pick.aux ? ' + aux' : '') + (fused ? ' switch-fuse' : ' rotary isolator') + ', ' + (E.ISOLATOR_ENCLOSURES[enclosure] || enclosure) + ', ' + ip + ', ' + pick.duty;
    return { rating, poles: pick.poles, aux: pick.aux, enclosure, ip, fused, duty: pick.duty, text, warn, circuit: c ? c.id : null };
  }

  const api = { splitRoute, fireCrossings, defaultSettings, newProject, nid, repair, index, buildGraph, shortestPath, nearestGraphNode, autoRoute, autoPath, taps, edgeLayout, bandOf, maxCover, legEnds, legPath, ptPos, rootOf, pxPerM, sheetLevel, solve, takeoff, isolatorSpec, routeFittings, routeLengths, deviceFor, legType, loadInput, FITTING_NAMES };
  root.CableCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
