/* adi Cable Trace — what comes out: the schedules drawer, the 3D view, the
 * PDF report and the Excel workbook. All four read the same rows (the
 * *Rows() builders below), so the screen, the PDF and the spreadsheet can
 * never disagree.
 */
'use strict';
(function () {
  const E = window.CableEngine, C = window.CableCore;
  const { esc, fmt, el } = window.CT;
  const n2 = (v, d) => (v == null || !isFinite(v) ? '' : Number(Number(v).toFixed(d == null ? 2 : d)));

  // ------------------------------------------------------------------
  // rows
  // ------------------------------------------------------------------
  function nodeName(id) { const n = CT.nodeById(id); return n ? n.name : ''; }
  function sheetName(id) { const s = CT.P.sheets.find(x => x.id === id); return s ? s.name : ''; }

  function cableRows() {
    const P = CT.P, A = CT.A;
    const head = ['Ref', 'Type', 'From', 'Via', 'To', 'Phase', 'kW', 'Ib A', 'Start A', 'Device', 'kA', 'Leg', 'Cable', 'Cores', 'Size mm²', 'CPC mm²', 'Method', 'Ca', 'Cg', 'Ci', 'It A', 'Iz A', 'Length m', 'mV/A/m', 'VD V', 'VD %', 'Total VD %', 'Zs Ω', 'Zs max Ω', 'CPC min mm²', 'OD mm', 'Status', 'Notes'];
    const rows = [];
    P.circuits.forEach(c => {
      const r = A.results.get(c.id);
      if (!r) return;
      const L = CT.nodeById(c.target);
      const legs = r.legs && r.legs.length ? r.legs : [{}];
      const fails = (r.checks || []).filter(x => !x.ok && !x.warn).map(x => x.text);
      const warns = (r.checks || []).filter(x => !x.ok && x.warn).map(x => x.text);
      legs.forEach((lr, i) => {
        const t = E.CABLE_TYPES[lr.type] || {};
        rows.push({
          cid: c.id, ok: r.ok, warn: warns.length > 0, first: i === 0,
          cells: [
            i === 0 ? c.ref : '', i === 0 ? (c.kind === 'submain' ? 'Sub-main' : c.kind === 'control' ? (c.ctrl && c.ctrl.signal ? 'Signal' : 'Control') : 'Power') : '',
            i === 0 ? nodeName(c.board) : '', i === 0 ? nodeName(c.iso) : '', i === 0 ? nodeName(c.target) : '',
            i === 0 && c.kind !== 'control' ? (r.phase === 1 ? '1ph' : '3ph') : '',
            i === 0 && L && L.kw ? Number(L.kw) : '',
            i === 0 ? n2(r.ib, 2) : '', i === 0 && r.start > r.ib ? n2(r.start, 0) : '',
            i === 0 ? (r.deviceText || '') : '', i === 0 && r.kA ? r.kA : '',
            lr.role === 'tail' ? 'Tail' : 'Main', t.label || '', lr.cores ? lr.cores + (t.coreWord === 'pair' ? 'pr' : 'c') : '', lr.size != null ? lr.size : '',
            lr.cpcArea || '', lr.method || '', n2(lr.ca, 2), n2(lr.cg, 2), n2(lr.ci, 2), n2(lr.it, 1), n2(lr.iz, 1),
            n2(lr.lengthM, 1), n2(lr.mv, 2), n2(lr.vdV, 2), n2(lr.vdPct, 2),
            i === 0 ? n2(r.vdPct, 2) : '', i === 0 ? n2(r.zs, 3) : '', i === 0 ? n2(r.zmax, 3) : '',
            n2(lr.cpcMin, 2), n2(lr.od, 1),
            i === 0 ? (r.ok ? (warns.length ? 'Check' : 'Pass') : 'FAIL') : '',
            i === 0 ? fails.concat(warns).join('; ') + (lr.step ? (fails.length || warns.length ? '; ' : '') + (lr.step > 0 ? 'upsized ' : 'downsized ') + Math.abs(lr.step) + ' from ' + lr.autoSize : '') : (lr.step ? (lr.step > 0 ? 'upsized ' : 'downsized ') + Math.abs(lr.step) + ' from ' + lr.autoSize : '')
          ]
        });
      });
    });
    return { head, rows };
  }

  function containRows() {
    const P = CT.P, A = CT.A;
    const TK = CT.getTK();
    const head = ['Run', 'Sheet', 'Type', 'Duty', 'Finish', 'Size', 'Plan m', 'Vertical m', 'Total m', 'Cables', 'Circuits', 'Grouped', 'Segregation', 'Σ OD mm', 'Needed mm', 'Fill %', 'Fixing', 'Spacing m', 'Supports', 'Fittings', 'Status'];
    const rows = P.routes.map(r => {
      const res = A.routes.get(r.id) || {};
      const def = E.CONTAINMENT[r.type] || E.CONTAINMENT.tray;
      const f = TK.fits.get(r.id) || {};
      const names = C.FITTING_NAMES[r.type] || {};
      return {
        rid: r.id, ok: res.ok !== false, warn: res.okSpare === false,
        cells: [r.name, sheetName(r.sheet), def.label, def.duties[r.duty || def.defaultDuty] || '', r.type.startsWith('pvc') ? 'PVC' : (E.FINISHES[r.finish || P.settings.defFinish] || ''),
          res.size || '', n2(res.lens ? res.lens.plan : 0, 2), n2(res.lens ? res.lens.vert : 0, 2), n2(res.lens ? res.lens.total : 0, 2),
          res.cables || 0, res.nCircuits || 0, res.maxGrouped || 0, res.mixed ? (res.seg === 'divider' ? (def.fill === 'area' ? 'Compartment' : 'Divider') : res.seg === 'gap' ? res.sepMm + ' mm gap' : 'Separate') : '', n2(res.sumOd, 1), def.fill === 'width' ? n2(res.reqMm, 0) : '', n2(res.fillPct, 0),
          E.MOUNTS[res.mount] || '', n2(res.spacing, 2), res.supports || 0,
          Object.keys(f).filter(k => f[k] && names[k]).map(k => f[k] + '× ' + names[k]).join(', '),
          res.ok === false ? 'OVER-FULL' : res.okSpare === false ? 'No spare' : 'OK']
      };
    });
    (A.risers || new Map()).forEach((res, key) => {
      rows.push({ ok: res.ok !== false, cells: ['Riser ' + key, '', (E.CONTAINMENT[res.kind] || {}).label + ' (riser)', '', '', res.size, 0, n2(res.len, 2), n2(res.len, 2), res.cables, '', '', res.mixed ? 'Divider' : '', n2(res.sumOd, 1), n2(res.reqMm, 0), n2(res.fillPct, 0), E.MOUNTS.wallbracket, '', '', '', res.ok === false ? 'OVER-FULL' : 'OK'] });
    });
    return { head, rows };
  }

  function boqSections() {
    const TK = CT.getTK();
    const P = CT.P;
    const sec = [];
    const list = (m) => [...m.values()];
    sec.push({ title: 'Cable', head: ['Cable', 'Cores', 'Size mm²', 'Route m', 'Order m (+' + P.settings.wasteCable + ' %)'],
      rows: list(TK.cables).sort((a, b) => a.desc.localeCompare(b.desc) || String(a.cores).localeCompare(String(b.cores)) || a.size - b.size).map(v => [v.desc, v.cores, v.size, n2(v.qty, 1), v.order]) });
    sec.push({ title: 'Containment', head: ['Containment', 'Size', 'Duty', 'Finish', 'Metres', 'Order m (+' + P.settings.wasteContain + ' %)', 'Lengths'],
      rows: list(TK.contain).map(v => { const m = v.qty * (1 + (P.settings.wasteContain || 0) / 100); return [v.desc, v.size, v.duty, v.finish, n2(v.qty, 1), n2(m, 1), v.stockM ? Math.ceil(m / v.stockM) + ' × ' + v.stockM + ' m' : '']; }) });
    sec.push({ title: 'Containment fittings', head: ['Fitting', 'Size', 'Finish', 'Qty'], rows: list(TK.fittings).filter(v => v.qty > 0).map(v => [v.desc, v.size, v.finish, Math.ceil(v.qty)]) });
    sec.push({ title: 'Fixings & supports', head: ['Item', 'Unit', 'Qty'], rows: list(TK.fixings).sort((a, b) => a.desc.localeCompare(b.desc)).map(v => [v.desc, v.unit, v.unit === 'm' ? n2(v.qty, 1) : Math.ceil(v.qty)]) });
    sec.push({ title: 'Isolators', head: ['Isolator', 'Rating A', 'Poles', 'Aux', 'Enclosure', 'IP', 'Qty'], rows: list(TK.isolators).map(v => [v.desc, v.rating || '', v.poles, v.aux ? 'Yes' : 'No', v.enclosure, v.ip, v.qty]) });
    sec.push({ title: 'Glands & terminations', head: ['Item', 'Type', 'Size', 'Qty'], rows: list(TK.glands).sort((a, b) => a.desc.localeCompare(b.desc)).map(v => [v.desc, v.type, v.size, v.qty]) });
    sec.push({ title: 'Flexible conduit', head: ['Item', 'Unit', 'Qty'], rows: list(TK.flex).map(v => [v.desc, v.unit, v.unit === 'm' ? n2(v.qty * (1 + (P.settings.wasteCable || 0) / 100), 1) : v.qty]) });
    sec.push({ title: 'Protective devices', head: ['Board', 'Device', 'kA', 'Qty'], rows: list(TK.devices).sort((a, b) => a.board.localeCompare(b.board)).map(v => [v.board, v.desc, v.kA, v.qty]) });
    if (TK.field.size) sec.push({ title: 'Field devices', head: ['Device', 'Qty'], rows: list(TK.field).map(v => [v.desc, v.qty]) });
    if (TK.sundries.size) sec.push({ title: 'Sundries', head: ['Item', 'Unit', 'Qty'], rows: list(TK.sundries).map(v => [v.desc, v.unit, v.qty]) });
    return sec;
  }

  function isoRows() {
    const P = CT.P, A = CT.A;
    const head = ['Isolator', 'Sheet', 'Circuit', 'Load', 'Rating A', 'Poles', 'Aux', 'Duty', 'Enclosure', 'IP', 'Switch-fuse', 'Location', 'Fixed', 'Notes'];
    const rows = P.nodes.filter(n => n.kind === 'isolator').map(n => {
      const sp = C.isolatorSpec(P, A, n);
      const c = sp.circuit ? CT.circById(sp.circuit) : null;
      return { ok: !sp.warn.length, cells: [n.name, sheetName(n.sheet), c ? c.ref : '', c ? nodeName(c.target) : '', sp.rating || '', sp.poles, sp.aux ? 'Yes' : 'No', sp.duty, E.ISOLATOR_ENCLOSURES[sp.enclosure] || sp.enclosure, sp.ip, sp.fused ? 'Yes' : '', n.outdoor ? 'Outdoor' : 'Indoor', n.mount === 'unistrut' ? 'Unistrut' : 'Wall', sp.warn.join('; ')] };
    });
    return { head, rows };
  }
  function issueRows() {
    return { head: ['Severity', 'Issue'], rows: (CT.A.issues || []).map(i => ({ ok: i.sev !== 'fail', warn: i.sev === 'warn', cells: [i.sev === 'fail' ? 'Fail' : 'Check', i.text], i })) };
  }

  // ------------------------------------------------------------------
  // drawer
  // ------------------------------------------------------------------
  let tab = 'cables';
  function drawerOpen() { return el('drawer').classList.contains('on'); }
  function tableHtml(t, clickKind) {
    return '<table class="sched"><thead><tr>' + t.head.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>'
      + t.rows.map(r => '<tr class="' + (r.ok === false ? 'bad' : r.warn ? 'warn' : '') + (clickKind && (r.cid || r.rid) ? ' click' : '') + '"' + (r.cid ? ' data-go="circ:' + r.cid + '"' : r.rid ? ' data-go="route:' + r.rid + '"' : '') + '>'
        + r.cells.map(v => '<td class="' + (typeof v === 'number' ? 'n' : '') + (v === 'FAIL' || v === 'OVER-FULL' ? ' bad' : '') + '">' + esc(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  }
  function renderSchedule() {
    const body = el('schedBody');
    let h = '';
    const note = el('schedNote');
    if (tab === 'cables') { const t = cableRows(); h = tableHtml(t, true); note.textContent = CT.P.circuits.length + ' circuits · click a row to find it'; }
    else if (tab === 'contain') { const t = containRows(); h = tableHtml(t, true); note.textContent = 'Spare ' + CT.P.settings.spare + ' % on cable widths · trunking ' + CT.P.settings.spaceTrunking + ' % · conduit ' + CT.P.settings.spaceConduit + ' %'; }
    else if (tab === 'boq') {
      h = boqSections().map(s => '<table class="sched" style="margin-bottom:6px"><thead><tr>' + s.head.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody><tr class="grp"><td colspan="' + s.head.length + '">' + esc(s.title) + '</td></tr>' + (s.rows.length ? s.rows.map(r => '<tr>' + r.map(v => '<td class="' + (typeof v === 'number' ? 'n' : '') + '">' + esc(v) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + s.head.length + '" style="color:var(--muted)">None</td></tr>') + '</tbody></table>').join('');
      note.textContent = 'Cable includes ' + CT.P.settings.termAllow + ' m at each end; order quantities include wastage';
    }
    else if (tab === 'iso') {
      const TK = CT.getTK();
      h = tableHtml(isoRows()) + '<table class="sched" style="margin-top:8px"><thead><tr><th>Gland / termination</th><th>Type</th><th>Size</th><th>Qty</th></tr></thead><tbody>' + [...TK.glands.values()].map(v => '<tr><td>' + esc(v.desc) + '</td><td>' + esc(v.type) + '</td><td>' + esc(v.size) + '</td><td class="n">' + v.qty + '</td></tr>').join('') + '</tbody></table>';
      note.textContent = 'Glands counted at both ends of each armoured cable';
    }
    else if (tab === 'issues') { const t = issueRows(); h = t.rows.length ? tableHtml(t) : '<p class="note" style="padding:12px;color:var(--live)">Nothing fails.</p>'; note.textContent = ''; }
    body.innerHTML = h;
  }
  function openDrawer() { el('drawer').classList.add('on'); renderSchedule(); }
  el('bSched').onclick = () => { if (drawerOpen()) el('drawer').classList.remove('on'); else openDrawer(); };
  el('bSchedClose').onclick = () => el('drawer').classList.remove('on');
  el('schedTabs').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-tab]'); if (!b) return;
    tab = b.dataset.tab;
    document.querySelectorAll('#schedTabs button').forEach(x => x.classList.toggle('on', x === b));
    renderSchedule();
  });
  el('schedBody').addEventListener('click', ev => {
    const tr = ev.target.closest('tr[data-go]'); if (!tr) return;
    const [k, id] = tr.dataset.go.split(':');
    CT.goTo(k, id);
  });

  // ------------------------------------------------------------------
  // 3D
  // ------------------------------------------------------------------
  const cam = { yaw: -0.6, pitch: 0.62, scale: 20, ox: 0, oy: 0, ex: 1, fitted: false };
  function threeOpen() { return el('three').classList.contains('on'); }
  function worldOf(sheetId, x, y, h) {
    const P = CT.P;
    const s = P.sheets.find(q => q.id === sheetId);
    const k = s && s.pxPerM > 0 ? s.pxPerM : 50;
    return { x: x / k, y: y / k, z: ((s ? Number(s.level) || 0 : 0) + (h || 0)) };
  }
  function scene(opts) {
    const P = CT.P, A = CT.A;
    const allSheets = opts.all;
    const onSheet = (sid) => allSheets || sid === P.active;
    const prims = [];
    const k = (sid) => { const s = P.sheets.find(q => q.id === sid); return s && s.pxPerM > 0 ? s.pxPerM : 50; };
    // a floor under what is traced on each sheet, not the whole sheet
    P.sheets.forEach(s => {
      if (!onSheet(s.id)) return;
      const xs = [], ys = [];
      P.nodes.filter(n => n.sheet === s.id).forEach(n => { xs.push(n.x); ys.push(n.y); });
      P.routes.filter(r => r.sheet === s.id).forEach(r => r.pts.forEach(q => { xs.push(q.x); ys.push(q.y); }));
      if (!xs.length) return;
      const k1 = k(s.id), m = 2 * k1;
      const a = worldOf(s.id, Math.min(...xs) - m, Math.min(...ys) - m, 0), b = worldOf(s.id, Math.max(...xs) + m, Math.max(...ys) + m, 0);
      prims.push({ t: 'poly', pts: [a, { x: b.x, y: a.y, z: a.z }, b, { x: a.x, y: b.y, z: a.z }], fill: 'rgba(120,120,110,0.06)', stroke: 'rgba(120,120,110,0.35)', lw: 1 });
      prims.push({ t: 'text', a: { x: a.x, y: a.y, z: a.z }, text: s.name + (s.level ? ' +' + fmt(s.level, 1) + ' m' : ''), col: '#8a8e97' });
    });
    // containment as flat strips (vertical runs as upright strips)
    A.G.edges.forEach(e => {
      const r = e.rid ? A.ix.route.get(e.rid) : null;
      if (r && !onSheet(r.sheet)) return;
      const pa = A.G.nodes.get(e.a), pb = A.G.nodes.get(e.b);
      if (!r) {
        // riser between sheets
        const nA = A.ix.node.get(e.a.slice(2)), nB = A.ix.node.get(e.b.slice(2));
        if (!nA || !nB || (!allSheets && (nA.sheet !== P.active && nB.sheet !== P.active))) return;
        const res = A.risers.get(e.riser) || {};
        const w = (res.drawMm || 150) / 1000;
        const p1 = worldOf(nA.sheet, nA.x, nA.y, nA.h), p2 = worldOf(nB.sheet, nB.x, nB.y, nB.h);
        prims.push({ t: 'poly', pts: [{ x: p1.x - w / 2, y: p1.y, z: p1.z }, { x: p1.x + w / 2, y: p1.y, z: p1.z }, { x: p2.x + w / 2, y: p2.y, z: p2.z }, { x: p2.x - w / 2, y: p2.y, z: p2.z }], fill: 'rgba(185,119,14,0.25)', stroke: '#b9770e', lw: 1 });
        return;
      }
      const res = A.routes.get(r.id) || {};
      const col = CT.ROUTE_COLS[r.type] || '#777';
      const w = Math.max(0.02, (r.type === 'cleats' ? (res.sumOd || 20) : (res.drawMm || 100)) / 1000);
      const A3 = worldOf(r.sheet, pa.x, pa.y, pa.h), B3 = worldOf(r.sheet, pb.x, pb.y, pb.h);
      let nx = -(B3.y - A3.y), ny = B3.x - A3.x;
      let L = Math.hypot(nx, ny);
      if (L < 1e-6) {
        // vertical: take the direction of a neighbouring horizontal piece
        const nb = (A.G.adj.get(e.a) || []).concat(A.G.adj.get(e.b) || []).find(f => f !== e && f.plan > 0.01);
        if (nb) { const qa = A.G.nodes.get(nb.a), qb = A.G.nodes.get(nb.b); nx = -(qb.y - qa.y); ny = qb.x - qa.x; L = Math.hypot(nx, ny); }
        if (L < 1e-6) { nx = 1; ny = 0; L = 1; }
      }
      nx = nx / L * w / 2; ny = ny / L * w / 2;
      const kk = r.orient === 'wall' && e.plan > 0.01;
      if (kk) {
        // tray on edge against a wall: an upright strip
        prims.push({ t: 'poly', pts: [{ x: A3.x, y: A3.y, z: A3.z }, { x: B3.x, y: B3.y, z: B3.z }, { x: B3.x, y: B3.y, z: B3.z + w }, { x: A3.x, y: A3.y, z: A3.z + w }], fill: hexA(col, 0.28), stroke: col, lw: 1 });
      } else {
        prims.push({ t: 'poly', pts: [{ x: A3.x + nx, y: A3.y + ny, z: A3.z }, { x: B3.x + nx, y: B3.y + ny, z: B3.z }, { x: B3.x - nx, y: B3.y - ny, z: B3.z }, { x: A3.x - nx, y: A3.y - ny, z: A3.z }], fill: hexA(col, res.ok === false ? 0.12 : 0.28), stroke: res.ok === false ? '#bb3b2e' : col, lw: 1 });
      }
      // side lips at the run's real depth, so a tray reads as a tray
      const def = E.CONTAINMENT[r.type] || {};
      const depth = !kk && def.fill === 'width' ? ((def.depths && def.depths[r.type === 'ladder' ? 0 : 1]) || def.depths && def.depths[0] || 50) / 1000 : 0;
      if (depth) [1, -1].forEach(sg => prims.push({ t: 'poly', pts: [{ x: A3.x + nx * sg, y: A3.y + ny * sg, z: A3.z }, { x: B3.x + nx * sg, y: B3.y + ny * sg, z: B3.z }, { x: B3.x + nx * sg, y: B3.y + ny * sg, z: B3.z + depth }, { x: A3.x + nx * sg, y: A3.y + ny * sg, z: A3.z + depth }], fill: hexA(col, 0.18), stroke: col, lw: 1 }));
      // cables across it, laid out exactly as on the plan (C.edgeLayout)
      const lay = C.edgeLayout(P, A, e.id);
      const ux = nx / (w / 2), uy = ny / (w / 2);
      const at = (t, o, dz) => ({ x: A3.x + (B3.x - A3.x) * t + (kk ? 0 : ux * o), y: A3.y + (B3.y - A3.y) * t + (kk ? 0 : uy * o), z: A3.z + (B3.z - A3.z) * t + (kk ? o + w / 2 : dz) });
      if (lay.divider != null) {
        const o = lay.divider / 1000;
        prims.push({ t: 'poly', pts: [at(0, o, 0), at(1, o, 0), at(1, o, Math.max(depth, 0.05)), at(0, o, Math.max(depth, 0.05))], fill: 'rgba(35,38,44,0.35)', stroke: '#23262c', lw: 1 });
      }
      lay.items.forEach(cb => {
        const d = cb.od / 1000;
        const o = cb.off / 1000;
        const c = CT.circById(cb.cid); if (!c) return;
        const t0 = cb.t0 != null ? cb.t0 : 0, t1 = cb.t1 != null ? cb.t1 : 1;
        prims.push({ t: 'line', a: at(t0, o, d / 2), b: at(t1, o, d / 2), stroke: CT.circColour(c), lw: 2 });
      });
      // drop rods
      if (opts.fixings && (r.mount === 'droprod' || r.mount === 'beamclamp' || (!r.mount && P.settings.defMount === 'droprod')) && e.plan > 0.01) {
        const sp = Number(r.spacing) > 0 ? Number(r.spacing) : (P.settings.spacing[r.type] || 1.5);
        const soffit = Number(r.soffit) > 0 ? Number(r.soffit) : P.settings.soffit;
        const n = Math.ceil(e.plan / sp);
        const lev = (P.sheets.find(q => q.id === r.sheet) || {}).level || 0;
        for (let i = 0; i <= n; i++) {
          const t = n ? i / n : 0;
          const x = A3.x + (B3.x - A3.x) * t, y = A3.y + (B3.y - A3.y) * t, z = A3.z + (B3.z - A3.z) * t;
          [1, -1].forEach(sg => prims.push({ t: 'line', a: { x: x + nx * sg * 1.1, y: y + ny * sg * 1.1, z }, b: { x: x + nx * sg * 1.1, y: y + ny * sg * 1.1, z: Number(lev) + soffit }, stroke: 'rgba(90,90,90,0.55)', lw: 1 }));
        }
      }
    });
    // cables off containment
    P.circuits.forEach(c => {
      const res = A.results.get(c.id);
      if (!res || !res.paths) return;
      res.paths.forEach(lp => lp.spans.forEach(sp => {
        if (sp.edge) return;
        if (!onSheet(sp.from.sheet) && !onSheet(sp.to.sheet)) return;
        const a = worldOf(sp.from.sheet, sp.from.x, sp.from.y, sp.from.h), b = worldOf(sp.to.sheet, sp.to.x, sp.to.y, sp.to.h);
        // up or down at the lower end, then across
        const lowA = a.z <= b.z;
        const mid = lowA ? { x: a.x, y: a.y, z: b.z } : { x: b.x, y: b.y, z: a.z };
        const dash = lp.role === 'tail' ? [5, 3] : null;
        prims.push({ t: 'line', a, b: mid, stroke: CT.circColour(c), lw: 2, dash });
        prims.push({ t: 'line', a: mid, b, stroke: CT.circColour(c), lw: 2, dash });
      }));
    });
    // equipment
    P.nodes.forEach(n => {
      if (!onSheet(n.sheet)) return;
      const p = worldOf(n.sheet, n.x, n.y, n.h);
      // small, light boxes: a pump set or a row of isolators must not merge
      // into one dark block. Sizes are nominal, scaled by the 3D bar's
      // Equipment control.
      const f = opts.equip || 1;
      let sx = 0.1, sy = 0.1, sz = 0.1, col = '#888';
      if (n.kind === 'board') { sx = 0.45; sy = 0.15; sz = 0.6; col = n.boardKind === 'BMS' || n.boardKind === 'CP' ? '#2e86c1' : '#5d6d7e'; }
      else if (n.kind === 'load') { sx = 0.35; sy = 0.35; sz = 0.35; col = '#d68910'; }
      else if (n.kind === 'isolator') { sx = 0.1; sy = 0.06; sz = 0.12; col = '#c0392b'; }
      else if (n.kind === 'device') { sx = 0.06; sy = 0.06; sz = 0.06; col = '#2471a3'; }
      else if (n.kind === 'riser') { sx = 0.08; sy = 0.08; sz = 0.08; col = '#b9770e'; }
      sx *= f; sy *= f; sz *= f;
      box(prims, p, sx, sy, sz, col);
      if (opts.labels !== false) prims.push({ t: 'text', a: { x: p.x, y: p.y, z: p.z + sz / 2 + 0.12 }, text: n.name || '', col: '#23262c' });
    });
    return prims;
  }
  function box(prims, c, sx, sy, sz, col) {
    const x0 = c.x - sx / 2, x1 = c.x + sx / 2, y0 = c.y - sy / 2, y1 = c.y + sy / 2, z0 = c.z - sz / 2, z1 = c.z + sz / 2;
    const f = (pts) => prims.push({ t: 'poly', pts, fill: hexA(col, 0.3), stroke: col, lw: 1 });
    f([{ x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }]);
    f([{ x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 }, { x: x1, y: y0, z: z1 }, { x: x0, y: y0, z: z1 }]);
    f([{ x: x0, y: y1, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }]);
    f([{ x: x0, y: y0, z: z0 }, { x: x0, y: y1, z: z0 }, { x: x0, y: y1, z: z1 }, { x: x0, y: y0, z: z1 }]);
    f([{ x: x1, y: y0, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x1, y: y1, z: z1 }, { x: x1, y: y0, z: z1 }]);
  }
  function hexA(hex, a) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return hex;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }
  function proj(v, cm, centre) {
    const ex = cm.ex || 1;
    const x = v.x - centre.x, y = v.y - centre.y, z = (v.z - centre.z) * ex;
    const cy = Math.cos(cm.yaw), sy = Math.sin(cm.yaw);
    const xr = x * cy - y * sy, yr = x * sy + y * cy;
    const cp = Math.cos(cm.pitch), sp = Math.sin(cm.pitch);
    return { sx: xr, sy: yr * sp - z * cp, d: yr * cp + z * sp };
  }
  function renderTo(cv, prims, cm, fit) {
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.fillStyle = '#f6f5f1'; ctx.fillRect(0, 0, W, H);
    // centre of the scene
    let mn = { x: Infinity, y: Infinity, z: Infinity }, mx = { x: -Infinity, y: -Infinity, z: -Infinity };
    const each = (v) => { mn.x = Math.min(mn.x, v.x); mn.y = Math.min(mn.y, v.y); mn.z = Math.min(mn.z, v.z); mx.x = Math.max(mx.x, v.x); mx.y = Math.max(mx.y, v.y); mx.z = Math.max(mx.z, v.z); };
    prims.forEach(p => { if (p.t === 'poly') p.pts.forEach(each); else if (p.t === 'line') { each(p.a); each(p.b); } else each(p.a); });
    if (!isFinite(mn.x)) { ctx.fillStyle = '#8a8e97'; ctx.font = '14px sans-serif'; ctx.fillText('Nothing traced yet', 20, 30); return; }
    const centre = { x: (mn.x + mx.x) / 2, y: (mn.y + mx.y) / 2, z: (mn.z + mx.z) / 2 };
    if (fit || !cm.fitted) {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      prims.forEach(p => (p.t === 'poly' ? p.pts : p.t === 'line' ? [p.a, p.b] : [p.a]).forEach(v => { const q = proj(v, cm, centre); a = Math.min(a, q.sx); b = Math.max(b, q.sx); c = Math.min(c, q.sy); d = Math.max(d, q.sy); }));
      cm.scale = Math.min(W / Math.max(1e-3, b - a), H / Math.max(1e-3, d - c)) * 0.88;
      cm.ox = -(a + b) / 2 * cm.scale; cm.oy = -(c + d) / 2 * cm.scale;
      cm.fitted = true;
    }
    const S = (v) => { const q = proj(v, cm, centre); return { x: W / 2 + cm.ox + q.sx * cm.scale, y: H / 2 + cm.oy + q.sy * cm.scale, d: q.d }; };
    const items = prims.map(p => {
      if (p.t === 'poly') { const s = p.pts.map(S); return { p, s, d: s.reduce((a, q) => a + q.d, 0) / s.length }; }
      if (p.t === 'line') { const a = S(p.a), b = S(p.b); return { p, s: [a, b], d: (a.d + b.d) / 2 + 0.001 }; }
      const a = S(p.a); return { p, s: [a], d: a.d + 1000 };
    });
    items.sort((a, b) => a.d - b.d);
    items.forEach(it => {
      const p = it.p;
      ctx.setLineDash(p.dash || []);
      if (p.t === 'poly') {
        ctx.beginPath(); it.s.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath();
        ctx.fillStyle = p.fill; ctx.fill();
        ctx.strokeStyle = p.stroke; ctx.lineWidth = p.lw || 1; ctx.stroke();
      } else if (p.t === 'line') {
        ctx.beginPath(); ctx.moveTo(it.s[0].x, it.s[0].y); ctx.lineTo(it.s[1].x, it.s[1].y);
        ctx.strokeStyle = p.stroke; ctx.lineWidth = p.lw || 1; ctx.lineCap = 'round'; ctx.stroke();
      } else {
        ctx.font = '600 10px Archivo, sans-serif'; ctx.fillStyle = p.col; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(p.text, it.s[0].x, it.s[0].y); ctx.fillText(p.text, it.s[0].x, it.s[0].y);
      }
    });
    ctx.setLineDash([]);
  }
  function draw3D(fit) {
    const cv = el('c3d');
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(200, Math.round(r.width * dpr)); cv.height = Math.max(200, Math.round(r.height * dpr));
    cam.ex = Number(el('threeEx').value) || 1;
    const prims = scene({ all: el('threeAll').checked, fixings: el('threeFix').checked, equip: Number(el('threeEq').value) || 1, labels: el('threeLbl').checked });
    const scaled = Object.assign({}, cam);
    if (!fit && cam.fitted) { scaled.scale = cam.scale * dpr; scaled.ox = cam.ox * dpr; scaled.oy = cam.oy * dpr; }
    renderTo(cv, prims, scaled, fit || !cam.fitted);
    if (fit || !cam.fitted) { cam.scale = scaled.scale / dpr; cam.ox = scaled.ox / dpr; cam.oy = scaled.oy / dpr; cam.fitted = true; }
    el('legend3d').innerHTML = '<span><i style="background:#a0522d"></i>Power</span><span><i style="background:#2471a3"></i>Control</span><span><i style="background:#1e8449"></i>Signal</span><span><i style="background:#6b7380"></i>Tray</span><span><i style="background:#4a5d6e"></i>Ladder</span><span><i style="background:#7e57c2"></i>Trunking</span><span><i style="background:#6d4c41"></i>Conduit</span>';
  }
  function view(v) {
    if (v === 'iso') { cam.yaw = -0.6; cam.pitch = 0.62; }
    if (v === 'plan') { cam.yaw = 0; cam.pitch = Math.PI / 2; }
    if (v === 'front') { cam.yaw = 0; cam.pitch = 0; }
    if (v === 'side') { cam.yaw = -Math.PI / 2; cam.pitch = 0; }
    draw3D(true);
  }
  function open3D() { el('three').classList.add('on'); cam.fitted = false; requestAnimationFrame(() => draw3D(true)); }
  function close3D() { el('three').classList.remove('on'); }
  el('b3d').onclick = () => (threeOpen() ? close3D() : open3D());
  el('b3dClose').onclick = close3D;
  el('threeViews').addEventListener('click', ev => { const b = ev.target.closest('button[data-v]'); if (!b) return; document.querySelectorAll('#threeViews button').forEach(x => x.classList.toggle('on', x === b && b.dataset.v !== 'fit')); view(b.dataset.v === 'fit' ? null : b.dataset.v); });
  ['threeEx', 'threeAll', 'threeFix', 'threeEq', 'threeLbl'].forEach(id => el(id).addEventListener('change', () => draw3D(true)));
  (function wire3D() {
    const cv = el('c3d');
    let drag = null;
    cv.addEventListener('pointerdown', ev => { drag = { x: ev.clientX, y: ev.clientY, pan: ev.shiftKey || ev.button === 2 || ev.button === 1 }; cv.setPointerCapture(ev.pointerId); });
    cv.addEventListener('pointermove', ev => {
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      drag.x = ev.clientX; drag.y = ev.clientY;
      if (drag.pan) { cam.ox += dx; cam.oy += dy; }
      else { cam.yaw += dx * 0.008; cam.pitch = Math.max(0, Math.min(Math.PI / 2, cam.pitch + dy * 0.008)); }
      draw3D(false);
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('contextmenu', ev => ev.preventDefault());
    cv.addEventListener('wheel', ev => {
      ev.preventDefault();
      const f = Math.pow(1.0015, -ev.deltaY);
      const r = cv.getBoundingClientRect();
      const mx = ev.clientX - r.left - r.width / 2, my = ev.clientY - r.top - r.height / 2;
      cam.ox = mx - (mx - cam.ox) * f; cam.oy = my - (my - cam.oy) * f;
      cam.scale *= f;
      draw3D(false);
    }, { passive: false });
    window.addEventListener('resize', () => { if (threeOpen()) draw3D(false); });
  })();
  function capture3D(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cm = { yaw: -0.6, pitch: 0.62, ex: 1, fitted: false };
    renderTo(cv, scene({ all: true, fixings: true }), cm, true);
    return cv.toDataURL('image/png');
  }

  // ------------------------------------------------------------------
  // plan images for the report
  // ------------------------------------------------------------------
  async function planImage(s, maxPx) {
    const P = CT.P, V = CT.V;
    const scale = Math.min(1, maxPx / Math.max(s.w, s.h));
    const keep = { active: P.active, zoom: V.zoom, sel: V.sel, draft: V.draft, snap: V.snap };
    P.active = s.id; V.zoom = scale; V.sel = null; V.draft = null; V.snap = null;
    CT.render();
    const inner = el('ov').innerHTML;
    Object.assign(V, { zoom: keep.zoom, sel: keep.sel, draft: keep.draft, snap: keep.snap });
    P.active = keep.active;
    CT.render();
    const W = Math.round(s.w * scale), H = Math.round(s.h * scale);
    const bg = s.src ? '<image href="' + s.src + '" x="0" y="0" width="' + s.w + '" height="' + s.h + '"/>' : '<rect x="0" y="0" width="' + s.w + '" height="' + s.h + '" fill="#fff"/>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="0 0 ' + s.w + ' ' + s.h + '"><style>text{font-family:Arial,sans-serif;paint-order:stroke;stroke:rgba(255,255,255,.92);stroke-linejoin:round}</style>' + bg + inner + '</svg>';
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
      return cv.toDataURL('image/jpeg', 0.85);
    } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
  }

  // ------------------------------------------------------------------
  // PDF report
  // ------------------------------------------------------------------
  async function exportPdf() {
    const P = CT.P;
    if (!P.sheets.length) { CT.toast('Nothing to report yet'); return; }
    const w = window.open('', '_blank');
    if (!w) { CT.toast('Allow pop-ups for this page to open the report'); return; }
    w.document.write('<p style="font-family:sans-serif;padding:20px">Building the report…</p>');
    const plans = [];
    for (const s of P.sheets) plans.push({ s, img: await planImage(s, 2400) });
    const iso = capture3D(1800, 1100);
    const A = CT.A;
    const fails = A.issues.filter(i => i.sev === 'fail').length;
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const tbl = (t) => '<table><thead><tr>' + t.head.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + t.rows.map(r => { const cells = r.cells || r; return '<tr class="' + (r.ok === false ? 'bad' : '') + '">' + cells.map(v => '<td' + (typeof v === 'number' ? ' class="n"' : '') + '>' + esc(v) + '</td>').join('') + '</tr>'; }).join('') + '</tbody></table>';
    const s = P.settings;
    const css = '@page{size:A3 landscape;margin:12mm}body{font-family:Arial,Helvetica,sans-serif;color:#23262c;font-size:10px;margin:0}h1{font-size:22px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #23262c;padding-bottom:3px;page-break-after:avoid}h3{font-size:11px;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.08em;color:#5c6069}table{border-collapse:collapse;width:100%;margin-bottom:8px;page-break-inside:auto}tr{page-break-inside:avoid}th{background:#f1efe9;text-align:left;padding:3px 4px;border-bottom:1px solid #bfb9ac;font-size:8.5px}td{padding:2px 4px;border-bottom:1px solid #e4e0d8;font-size:8.5px}td.n{text-align:right}tr.bad td{background:#fdecea}.hd{display:flex;align-items:center;gap:16px;border-bottom:3px solid #7ad1e4;padding-bottom:10px;margin-bottom:10px}.hd img{height:36px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 16px;font-size:10px;margin:8px 0}.meta b{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.1em;color:#8a8e97}.plan{page-break-before:always}.plan img,.iso img{width:100%;border:1px solid #d9d5cc}.note{font-size:9px;color:#5c6069;line-height:1.5}.pb{page-break-before:always}.fail{color:#bb3b2e;font-weight:700}';
    const html = '<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><title>' + esc(P.name) + ' — Cable Trace report</title><style>' + css + '</style></head><body>'
      + '<div class="hd"><img src="' + new URL('./logo.png', location.href).href + '"><div><h1>' + esc(P.name || 'Cable Trace') + '</h1><div>Electrical take-off and cable sizing — BS 7671:2018+A2:2022 (A3:2024)</div></div></div>'
      + '<div class="meta"><div><b>Reference</b>' + esc(P.ref || '—') + '</div><div><b>Client</b>' + esc(P.client || '—') + '</div><div><b>Date</b>' + date + '</div><div><b>Revision</b>' + (P.rev || 0) + '</div>'
      + '<div><b>Earthing</b>' + esc(s.earthing) + ', Ze ' + s.ze + ' Ω</div><div><b>Volt drop</b>' + s.vdLighting + ' % lighting / ' + s.vdOther + ' % other</div><div><b>Containment spare</b>' + s.spare + ' %</div><div><b>Result</b>' + (fails ? '<span class="fail">' + fails + ' item(s) fail</span>' : 'All circuits pass') + '</div></div>'
      + '<h2>3D view</h2><div class="iso"><img src="' + iso + '"></div>'
      + '<h2 class="pb">Cable schedule</h2>' + tbl(cableRows())
      + '<h2>Containment</h2>' + tbl(containRows())
      + '<h2 class="pb">Take-off</h2>' + boqSections().map(sec => '<h3>' + esc(sec.title) + '</h3>' + (sec.rows.length ? tbl({ head: sec.head, rows: sec.rows }) : '<p class="note">None</p>')).join('')
      + '<h2>Isolators</h2>' + tbl(isoRows())
      + (A.issues.length ? '<h2>Issues</h2>' + tbl(issueRows()) : '')
      + plans.map(p => '<div class="plan"><h2>' + esc(p.s.name) + (p.s.level ? ' — floor level +' + fmt(p.s.level, 2) + ' m' : '') + '</h2>' + (p.img ? '<img src="' + p.img + '">' : '<p class="note">Plan could not be drawn.</p>') + '</div>').join('')
      + '<h2 class="pb">Basis</h2><p class="note">Current ratings and mV/A/m from BS 7671 Appendix 4. Iz = It × Ca × Cg × Ci with grouping from the circuits sharing each piece of containment; the worst piece governs. Volt drop from tabulated mV/A/m plus the drop upstream of each board. Zs = Zdb + (R1+R2) at operating temperature against Tables 41.2–41.4 (Cmin 0.95). CPC adiabatic check to 543.1.3. Breaking capacity against the fault level at each board. Cable lengths include ' + s.termAllow + ' m termination allowance at each end; order quantities include ' + s.wasteCable + ' % cable and ' + s.wasteContain + ' % containment wastage. Cable diameters, armour data and gland ranges are typical UK catalogue figures — check the supplier\'s data. This report is a design aid and must be checked by a competent designer before issue.</p>'
      + '<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>';
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ------------------------------------------------------------------
  // Excel
  // ------------------------------------------------------------------
  function exportXlsx() {
    const P = CT.P;
    const sheets = [];
    const c = cableRows();
    sheets.push({ name: 'Cable schedule', rows: [c.head].concat(c.rows.map(r => r.cells)) });
    const k = containRows();
    sheets.push({ name: 'Containment', rows: [k.head].concat(k.rows.map(r => r.cells)) });
    const boq = [['Section', 'Item', 'Detail', 'Detail', 'Detail', 'Detail', 'Qty / order']];
    boqSections().forEach(sec => {
      boq.push([sec.title.toUpperCase()]);
      boq.push([''].concat(sec.head));
      sec.rows.forEach(r => boq.push([''].concat(r)));
      boq.push([]);
    });
    sheets.push({ name: 'Take-off', rows: boq });
    const i = isoRows();
    sheets.push({ name: 'Isolators', rows: [i.head].concat(i.rows.map(r => r.cells)) });
    const TK = CT.getTK();
    sheets.push({ name: 'Glands', rows: [['Item', 'Type', 'Size', 'Qty']].concat([...TK.glands.values()].map(v => [v.desc, v.type, v.size, v.qty])) });
    const iss = issueRows();
    sheets.push({ name: 'Issues', rows: [iss.head].concat(iss.rows.map(r => r.cells)) });
    const s = P.settings;
    sheets.push({ name: 'Basis', rows: [['Setting', 'Value'], ['Project', P.name], ['Reference', P.ref], ['Client', P.client], ['Standard', 'BS 7671:2018+A2:2022 (A3:2024)'], ['Earthing', s.earthing], ['Ze (Ω)', s.ze], ['Default Zdb (Ω)', s.zdbDefault], ['Default PFC (kA)', s.pfcDefault], ['Ambient (°C)', s.ambient], ['VD lighting (%)', s.vdLighting], ['VD other (%)', s.vdOther], ['VD motor start (%)', s.vdStart], ['VD control (%)', s.vdControl], ['Containment spare (%)', s.spare], ['Trunking space factor (%)', s.spaceTrunking], ['Conduit space factor (%)', s.spaceConduit], ['Termination allowance (m/end)', s.termAllow], ['Cable wastage (%)', s.wasteCable], ['Containment wastage (%)', s.wasteContain]] });
    const bytes = XLSX_LITE.build(sheets);
    CT.download(CT.fileBase() + '-takeoff.xlsx', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    CT.toast('Excel workbook saved');
  }
  el('bPdf').onclick = exportPdf;
  el('bXls').onclick = exportXlsx;

  window.Outputs = { drawerOpen, renderSchedule, threeOpen, draw3D: () => draw3D(false), open3D, close3D, cableRows, containRows, boqSections, isoRows, exportPdf, exportXlsx, capture3D };
})();
