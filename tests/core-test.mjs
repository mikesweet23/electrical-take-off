// Source-level checks for the model, network, sizing and take-off. Run: node tests/core-test.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = require('../engine.js');
globalThis.CableEngine = E;
const C = require('../core.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg + ' (' + a + ' vs ' + b + ')');

function sample() {
  const P = C.newProject();
  P.sheets.push({ id: 's1', name: 'GF', pxPerM: 50, level: 0, w: 4000, h: 3000 });
  P.active = 's1';
  P.nodes.push({ id: 'b1', sheet: 's1', kind: 'board', name: 'DB1', x: 100, y: 100, h: 1.5, phase: 3 });
  P.nodes.push({ id: 'i1', sheet: 's1', kind: 'isolator', name: 'ISO1', x: 2100, y: 600, h: 1.5 });
  P.nodes.push({ id: 'l1', sheet: 's1', kind: 'load', name: 'P1', x: 2100, y: 700, h: 0.5, loadKind: 'pump', phase: 3, kw: 7.5, drive: 'DOL' });
  P.nodes.push({ id: 'l2', sheet: 's1', kind: 'load', name: 'F1', x: 2100, y: 200, h: 3, loadKind: 'fan', phase: 3, kw: 3, drive: 'VSD' });
  // tray: along y=100 then down x=2100 — 40 m + 10 m at 3 m
  P.routes.push({ id: 'r1', sheet: 's1', name: 'T1', type: 'tray', layout: 'touching', pts: [
    { id: 'p1', x: 150, y: 100, h: 3 }, { id: 'p2', x: 2100, y: 100, h: 3 }, { id: 'p3', x: 2100, y: 600, h: 3 }] });
  P.circuits.push({ id: 'c1', ref: 'DB1-1', kind: 'power', board: 'b1', iso: 'i1', target: 'l1', device: {}, legs: { main: {}, tail: {} } });
  P.circuits.push({ id: 'c2', ref: 'DB1-2', kind: 'power', board: 'b1', iso: null, target: 'l2', device: {}, legs: { main: {} } });
  return P;
}

{
  const P = sample();
  const A = C.solve(P);
  const r1 = A.results.get('c1');
  ok(r1 && r1.legs.length === 2, 'pump circuit has a main and a tail');
  const main = r1.paths[0];
  ok(main.auto && main.spans.some(s => s.edge), 'main leg auto-routes along the tray');
  // board (100,100,1.5) -> p1 (150,100,3): 1 m + 1.5 m; tray 39 + 10 m; p3 -> iso: 0 + 1.5 m
  near(main.routeLen, 1 + 1.5 + 39 + 10 + 1.5, 0.01, 'main route length = drops + tray');
  near(main.lengthM, main.routeLen + 1.0, 0.01, 'termination allowance 0.5 m each end added');
  const cond = r1.legs[0].govCond;
  ok(cond && (cond.n === 2 || cond.n === 1), 'grouping counts circuits on the shared tray');
  ok(r1.legs[1].role === 'tail' && r1.legs[1].short === 'SY', 'tail defaults to SY flex');
  ok(r1.device.curve === 'C' || r1.device.curve === 'D', 'DOL motor gets a C or D curve, whichever needs less copper');
  ok(r1.In >= 1.2 * r1.start / 5, 'Type C rating raised to ride through the DOL start');
  const r2 = A.results.get('c2');
  ok(r2.device.curve === 'C', 'VSD motor defaults to Type C');
  const tr = A.routes.get('r1');
  ok(tr.width >= 50 && tr.reqMm > tr.sumOd, 'tray width carries the 25 % spare');
  const T = C.takeoff(P, A);
  ok(T.cables.size >= 2, 'take-off lists the cables');
  const fit = T.fits.get('r1') || {};
  ok(fit.b90 === 1, 'one flat 90° bend counted at the corner');
  ok([...T.isolators.values()][0].qty === 1, 'isolator counted');
  ok([...T.glands.keys()].some(k => k.startsWith('BW')), 'BW glands on SWA indoors');
  ok([...T.flex.keys()].some(k => k.startsWith('Flexible conduit')), 'tail in flexible conduit');
  ok([...T.fixings.keys()].some(k => k.includes('drop rod')), 'drop rods counted for ceiling-hung tray');

  // step the main cable down two sizes: still drawn, flagged red
  P.circuits[0].legs.main.step = -3;
  const A2 = C.solve(P);
  const rr = A2.results.get('c1');
  ok(rr.legs[0].step === -3 || rr.legs[0].size === E.CABLE_TYPES.swa.sizes[0], 'downsized cable is kept, not blocked');
  ok(!rr.ok, 'downsized cable fails a check and is flagged');
}

{
  // a pump under the middle of a straight tray drops from the point above it
  const P = C.newProject();
  P.sheets.push({ id: 's1', pxPerM: 50, level: 0 });
  P.nodes.push({ id: 'b1', sheet: 's1', kind: 'board', name: 'DB1', x: 0, y: 100, h: 1.5, phase: 3 });
  P.nodes.push({ id: 'l1', sheet: 's1', kind: 'load', name: 'P1', x: 800, y: 300, h: 0.5, loadKind: 'pump', phase: 3, kw: 4, drive: 'DOL' });
  P.routes.push({ id: 'r1', sheet: 's1', name: 'T1', type: 'tray', pts: [{ id: 'p1', x: 50, y: 100, h: 3 }, { id: 'p2', x: 1550, y: 100, h: 3 }] });
  P.circuits.push({ id: 'c1', kind: 'power', board: 'b1', target: 'l1', device: {}, legs: { main: {} } });
  const A = C.solve(P);
  const lp = A.results.get('c1').paths[0];
  // 1 m + 1.5 m up to the tray, 15 m along, 4 m across + 2.5 m down
  near(lp.routeLen, 24, 0.01, 'mid-tray drop: board up, 15 m along the tray, across and down');
  const o = A.occ.get('r1:1')[0];
  ok(Math.abs(o.t1 - 0.5) < 1e-6, 'cable rides only the half of the tray it uses');

  // hand calculation: 4c 2.5 SWA, Ib from 4 kW at pf 0.85, 26 m incl. 1 m terminations
  const r = A.results.get('c1');
  const leg = r.legs[0];
  const ib = 4000 / (Math.sqrt(3) * 400 * 0.85);
  near(r.ib, ib, 1e-6, 'Ib = P / (√3 × 400 × pf)');
  const mv = E.mvPerAm('4E4A', 3, leg.size);
  near(leg.vdV, mv * ib * leg.lengthM / 1000, 1e-9, 'VD = mV/A/m × Ib × L / 1000');
  near(leg.vdPct, leg.vdV / 400 * 100, 1e-9, 'three phase VD % of 400 V');
  near(r.zs, 0.2 + (E.R20[leg.size] * 1.28 + E.R20[leg.cpcArea] * 1.28) * leg.lengthM / 1000, 1e-9, 'Zs = Zdb + (R1 + R2) × 1.28 × L');
  // a load with no containment near: square, not diagonal
  P.routes = [];
  const A2 = C.solve(P);
  near(A2.results.get('c1').paths[0].routeLen, (800 + 200) / 50 + 1, 0.01, 'no containment: runs square to the building');
}

{
  // engine reference points
  near(E.zsMax({ family: 'mcb', curve: 'B' }, 32, 0.4), 1.37, 0.01, 'B32 max Zs 1.37 Ω');
  near(E.zsMax({ family: 'mcb', curve: 'C' }, 16, 0.4), 1.37, 0.01, 'C16 max Zs 1.37 Ω');
  near(E.zsMax({ family: 'mcb', curve: 'D' }, 16, 0.4), 0.68, 0.01, 'D16 max Zs 0.68 Ω');
  ok(E.tabulated('4E4A', 'E', 3, 2.5).it === 33, '4E4A 2.5 mm² 3-core method E = 33 A');
  ok(E.tabulated('4D5', 'C', 2, 2.5).it === 27, 'T&E 2.5 clipped direct = 27 A');
  ok(E.tabulated('4D5', 'E', 2, 2.5).method === 'C', 'T&E on tray rated as clipped direct');
  ok(E.mvPerAm('4E4A', 3, 2.5) === 16, 'SWA 2.5 three-phase 16 mV/A/m');
  ok(E.cgFor('tray', 4) === 0.77 && E.cgFor('enclosed', 3) === 0.70, 'Table 4C1 factors');
  ok(E.caFor(90, 35) === 0.96 && E.caFor(70, 40) === 0.87, 'Table 4B1 factors');
  const dc = E.designCurrent({ kind: 'pump', phase: 3, kw: 11, pf: 0.85 });
  near(dc.ib, 18.68, 0.05, '11 kW three phase at pf 0.85');
  const dt = E.designCurrent({ kind: 'pump', phase: 3, kw: 11, amps: 21.5 });
  ok(dt.ib === 21.5 && dt.basis === 'typed', 'typed maximum current wins');
  ok(E.widthRequired([20, 20, 20], 25, false) === 75, '25 % on three 20 mm cables = 75 mm');
  ok(E.pickWidth('tray', 76) === 100, 'next tray up is 100 mm');
  ok(E.glandFor(14.3, true) === '20S', '4c 2.5 SWA takes a 20S gland');
  const iso = E.pickIsolator(16, 3, false, 'VSD');
  ok(iso.rating === 16 && iso.poles === '6P' && iso.aux, 'VSD isolator: 6 pole with aux');
}

{
  // sub-main: child board's Zdb and upstream volt drop come from its feed
  const P = sample();
  P.nodes.push({ id: 'b0', sheet: 's1', kind: 'board', name: 'MSB', x: 100, y: 1000, h: 1.5, phase: 3, zdb: 0.05, pfcKA: 25 });
  P.circuits.push({ id: 'c0', ref: 'MSB-1', kind: 'submain', board: 'b0', target: 'b1', device: { family: 'mccb' }, legs: { main: { direct: true } } });
  const A = C.solve(P);
  const sm = A.results.get('c0');
  ok(sm && sm.ib > 0, 'sub-main design current rolls up from the board');
  const st = A.boards.get('b1');
  ok(st.derived && Math.abs(st.zdb - sm.zs) < 1e-9, 'DB1 Zdb is the sub-main Zs');
  ok(st.upstreamPct > 0, 'DB1 carries the sub-main volt drop upstream');
}

{
  // risers join sheets
  const P = sample();
  P.sheets.push({ id: 's2', name: 'L1', pxPerM: 50, level: 4.5 });
  P.nodes.push({ id: 'k1', sheet: 's1', kind: 'riser', riser: 'R1', x: 2100, y: 100, h: 3 });
  P.nodes.push({ id: 'k2', sheet: 's2', kind: 'riser', riser: 'R1', x: 2100, y: 100, h: 3 });
  P.routes.push({ id: 'r2', sheet: 's2', name: 'T2', type: 'tray', pts: [{ id: 'q1', x: 2100, y: 100, h: 3, link: 'n:k2' }, { id: 'q2', x: 2100, y: 1100, h: 3 }] });
  P.routes[0].pts[1].link = 'n:k1';
  P.nodes.push({ id: 'l3', sheet: 's2', kind: 'load', name: 'AHU1', x: 2100, y: 1150, h: 3, loadKind: 'ahu', phase: 3, kw: 15, drive: 'VSD' });
  P.circuits.push({ id: 'c3', ref: 'DB1-3', kind: 'power', board: 'b1', target: 'l3', device: {}, legs: { main: {} } });
  const A = C.solve(P);
  const lp = A.results.get('c3').paths[0];
  ok(lp.spans.some(s => s.edge && s.edge.riser === 'R1'), 'cable to the floor above goes up the riser');
  ok(!lp.broken, 'riser route is continuous');
  ok(A.risers.get('R1') && A.risers.get('R1').len >= 4.5, 'riser containment measured');
}

{
  const r = E.sizeCircuit({ kind: 'control', ctrl: { volts: 24, va: 20 }, legs: [{ role: 'main', type: 'instr', lengthM: 80, cores: 1 }] }, {});
  ok(r.legs[0].size === 1.5 && !r.ok, '24 V 20 VA at 80 m: 1.5 mm² is the largest and still over 5 %');
  const r2 = E.sizeCircuit({ kind: 'control', ctrl: { signal: true }, legs: [{ role: 'main', type: 'cat6', lengthM: 95 }] }, {});
  ok(!r2.ok, 'Cat6 over 90 m flagged');
}

{
  // segregation: a BMS 24 V cable and a power cable on one tray get a divider
  const P = sample();
  P.nodes.push({ id: 'bm', sheet: 's1', kind: 'board', boardKind: 'BMS', name: 'BMS1', x: 100, y: 140, h: 1.5 });
  P.nodes.push({ id: 'fd', sheet: 's1', kind: 'device', name: 'FD1', x: 2100, y: 650, h: 1.2 });
  P.circuits.push({ id: 'cc', kind: 'control', board: 'bm', target: 'fd', ctrl: { volts: 24, va: 10 }, device: {}, legs: { main: {} } });
  const A = C.solve(P);
  const tr = A.routes.get('r1');
  ok(tr.mixed && tr.seg === 'divider', 'power and 24 V control on one tray: segregated by a divider');
  const lay = C.edgeLayout(P, A, 'r1:1');
  const pw = lay.items.filter(x => x.band === 'II'), ct = lay.items.filter(x => x.band === 'I');
  ok(lay.divider != null && pw.every(x => x.off < lay.divider) && ct.every(x => x.off > lay.divider), 'power one side of the divider, control the other');
  ok(lay.items.every(x => Math.abs(x.off) + x.od / 2 <= lay.W / 2 + 1e-6), 'every cable lies inside the tray width');
  const g = A.results.get('c1').legs[0].govCond;
  ok(g.n === 2, 'control cable not counted in the grouping (' + g.n + ')');
  const T = C.takeoff(P, A);
  ok([...T.contain.values()].some(v => /divider/i.test(v.desc)), 'tray divider in the take-off');
  // the same pair in one conduit fails
  P.routes[0].type = 'conduit';
  const A2 = C.solve(P);
  ok(A2.issues.some(i => /same conduit/.test(i.text)), 'power and data in one conduit is flagged');
}

{
  // spaced cables lie 2 × D apart and the tray is sized for it
  const P = sample();
  P.routes[0].layout = 'spaced';
  const A = C.solve(P);
  const lay = C.edgeLayout(P, A, 'r1:1');
  const [a, b] = lay.items.sort((p, q) => p.off - q.off);
  ok(Math.abs((b.off - b.od / 2) - (a.off + a.od / 2) - 2 * a.od) < 1e-6, 'spaced: clear gap of 2 × D between cables');
  ok(A.routes.get('r1').width >= lay.items.reduce((s, x) => s + 3 * x.od, 0) - 2 * a.od, 'spaced tray wide enough');
  ok(A.results.get('c1').legs[0].cg === 1, 'spaced: no grouping reduction');
}

{
  // grouping counts where cables lie together, not the whole piece
  const P = sample();
  // the VSD fan (c2) leaves the long straight before the pump's cable does
  const A = C.solve(P);
  const occ = A.occ.get('r1:1');
  ok(occ.length === 2, 'two circuits ride the long straight');
}

{
  // pump room: six pumps tapping a long tray at intervals
  const mk = () => {
    const P = C.newProject();
    P.sheets.push({ id: 's1', pxPerM: 50, level: 0 });
    P.nodes.push({ id: 'b1', sheet: 's1', kind: 'board', name: 'DB1', x: 200, y: 400, h: 1.5, phase: 3 });
    P.routes.push({ id: 'r1', sheet: 's1', name: 'CT1', type: 'tray', mount: 'droprod', layout: 'touching', pts: [{ id: 'p1', x: 250, y: 400, h: 3 }, { id: 'p2', x: 3250, y: 400, h: 3 }] });
    for (let i = 0; i < 6; i++) {
      const x = 900 + i * 450;
      P.nodes.push({ id: 'l' + i, sheet: 's1', kind: 'load', name: 'P' + i, loadKind: 'pump', x, y: 600, h: 0.5, phase: 3, kw: 15 + i * 4, drive: 'DOL' });
      P.circuits.push({ id: 'c' + i, kind: 'power', board: 'b1', target: 'l' + i, device: {}, legs: { main: {} } });
    }
    return C.repair(P);
  };
  const P = mk();
  const A = C.solve(P);
  const res = A.routes.get('r1');
  ok(res.load && res.load.kg > 0 && res.load.swl > 0, 'tray load worked out (' + res.load.kg.toFixed(1) + ' of ' + res.load.swl.toFixed(0) + ' kg/m)');
  ok(res.stepPlan && res.stepPlan.parts.length >= 2 && res.stepPlan.parts[0].width > res.stepPlan.parts[res.stepPlan.parts.length - 1].width, 'step-down plan: wider at the board end, narrower further on');
  const before = A.results.get('c5').legs[0].lengthM;
  const made = C.splitRoute(P, 'r1', res.stepPlan.cuts);
  ok(made.length === res.stepPlan.cuts.length, 'run split at every step');
  const A2 = C.solve(P);
  near(A2.results.get('c5').legs[0].lengthM, before, 0.01, 'cable length unchanged by the split');
  const T = C.takeoff(P, A2);
  ok([...T.fittings.values()].some(v => v.desc === 'Reducer'), 'reducers counted where the run steps down');
  const widths = P.routes.map(r => A2.routes.get(r.id).width);
  ok(widths[0] > widths[widths.length - 1], 'each piece sized on its own (' + widths.join(' → ') + ' mm)');

  // a heavy load on light-duty tray at wide centres fails
  const Q = mk();
  Q.routes[0].duty = 'light'; Q.routes[0].spacing = 3;
  Q.nodes.filter(n => n.kind === 'load').forEach(n => { n.kw = 90; n.drive = 'SD'; });
  const AQ = C.solve(Q);
  ok(!AQ.routes.get('r1').load.ok && AQ.issues.some(i => /safe load/.test(i.text)), 'overloaded light-duty tray flagged (' + AQ.routes.get('r1').load.kg.toFixed(1) + ' of ' + AQ.routes.get('r1').load.swl.toFixed(0) + ' kg/m)');
}

{
  // two tiers: control on the upper tier, no divider
  const P = sample();
  P.nodes.push({ id: 'bm', sheet: 's1', kind: 'board', boardKind: 'BMS', name: 'BMS1', x: 100, y: 140, h: 1.5 });
  P.nodes.push({ id: 'fd', sheet: 's1', kind: 'device', name: 'FD1', x: 2100, y: 650, h: 1.2 });
  P.circuits.push({ id: 'cc', kind: 'control', board: 'bm', target: 'fd', ctrl: { volts: 24, va: 10 }, device: {}, legs: { main: {} } });
  P.routes[0].tiers = 2;
  const A = C.solve(P);
  const res = A.routes.get('r1');
  ok(res.tiers === 2 && res.tier2 && res.tier2.width && !res.mixed, 'two tiers: upper tier sized, no divider needed');
  const lay = C.edgeLayout(P, A, 'r1:1');
  ok(lay.items.filter(x => x.tier === 2).every(x => x.band === 'I') && lay.items.filter(x => x.tier === 1).every(x => x.band === 'II'), 'power on the lower tier, control on the upper');
  const T = C.takeoff(P, A);
  ok([...T.contain.values()].some(v => /upper tier/.test(v.desc)), 'upper tier in the take-off');
  ok([...T.fixings.keys()].some(k => /upper tier/.test(k)), 'upper tier supports counted');
  ok(![...T.contain.values()].some(v => /divider/i.test(v.desc)), 'no divider on a two-tier run');
}

{
  // fire wall: containment crossing gets a seal, a loose cable a sleeve
  const P = sample();
  P.firewalls = [{ id: 'w1', sheet: 's1', rating: 120, pts: [{ x: 1000, y: 0 }, { x: 1000, y: 2000 }] }];
  P.nodes.push({ id: 'l9', sheet: 's1', kind: 'load', name: 'H1', x: 1500, y: 1500, h: 1, loadKind: 'heater', phase: 1, kw: 2 });
  P.circuits.push({ id: 'c9', kind: 'power', board: 'b1', target: 'l9', device: {}, legs: { main: { direct: true } } });
  const A = C.solve(P);
  ok(A.fire.some(x => x.kind === 'contain' && x.rating === 120), 'tray crossing a 120 min wall');
  ok(A.fire.some(x => x.kind === 'cable' && x.cid === 'c9'), 'loose cable crossing the wall');
  const T = C.takeoff(P, A);
  ok([...T.fire.values()].some(v => /pillow/.test(v.desc)) && [...T.fire.values()].some(v => /sleeve/.test(v.desc)), 'fire seals and sleeves in the take-off');
  // FP200 in PVC trunking fails; on tray it gets metal ties
  P.circuits[1].legs.main.type = 'fp200';
  P.nodes.find(n => n.id === 'l2').phase = 1; P.nodes.find(n => n.id === 'l2').kw = 1;
  P.routes[0].type = 'pvctrunking';
  ok(C.solve(P).issues.some(i => /plastic containment/.test(i.text)), 'fire cable in PVC trunking flagged');
  P.routes[0].type = 'tray';
  const T2 = C.takeoff(P, C.solve(P));
  ok([...T2.sundries.keys()].some(k => /Metal cable ties/.test(k)), 'metal ties for the fire cable');
}

{
  // drive in the panel: the run is the motor cable
  const P = sample();
  const fan = P.nodes.find(n => n.id === 'l2');
  fan.drivePos = 'panel'; fan.vsdMaxM = 30;
  const A = C.solve(P);
  const r = A.results.get('c2');
  ok(r.vsdPanel && r.checks.some(x => x.id === 'vsdlen' && !x.ok), 'motor cable over the drive limit flagged');
  ok(r.checks.some(x => x.id === 'emc' && !x.ok), 'unscreened SWA from a drive flagged');
  P.circuits[1].legs.main.type = 'vsd';
  const A2 = C.solve(P);
  ok(A2.results.get('c2').checks.some(x => x.id === 'emc' && x.ok), 'VSD cable passes the EMC check');
  const T = C.takeoff(P, A2);
  ok([...T.glands.keys()].some(k => k.startsWith('EMC')), 'EMC glands for the motor cable');
}

{
  // a big DOL motor: a D curve rides the start at a lower rating than a C
  const P = C.newProject();
  P.sheets.push({ id: 's1', pxPerM: 50, level: 0 });
  P.nodes.push({ id: 'b1', sheet: 's1', kind: 'board', name: 'DB1', x: 0, y: 0, h: 1.5, phase: 3 });
  P.nodes.push({ id: 'l1', sheet: 's1', kind: 'load', name: 'P4', x: 1500, y: 0, h: 1.5, loadKind: 'pump', phase: 3, kw: 27, drive: 'DOL' });
  P.circuits.push({ id: 'c1', kind: 'power', board: 'b1', target: 'l1', device: {}, legs: { main: {} } });
  const r = C.solve(P).results.get('c1');
  ok(r.device.curve === 'D' && r.In <= 50 && r.legs[0].size <= 16, '27 kW DOL: ' + r.deviceText + ', ' + r.legs[0].size + ' mm² (overload at the starter)');
  ok(r.izNeed < r.In, 'starter overload: cable sized to Ib, not In');
  P.circuits[0].device.curve = 'C';
  ok(C.solve(P).results.get('c1').device.curve === 'C', 'a chosen curve is kept');
}

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
