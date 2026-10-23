/* adi Cable Trace — the page.
 *
 * Drawing, sheets, tools, tracing, the plan overlay and the inspector. The
 * electrical sums are in engine.js, the network and take-off in core.js; the
 * schedules, 3D, PDF and Excel are in outputs.js. Everything here reads the
 * analysis `A` that solveNow() keeps current.
 */
'use strict';
const E = window.CableEngine;
const C = window.CableCore;

let P = C.newProject();
let A = null;          // analysis from C.solve(P)
let TK = null;         // take-off, built on demand
const V = {
  zoom: 1, tool: 'select', sel: null, draft: null, snap: null, cursor: null,
  traceH: null, alt: false, space: false, labels: 2, stackIx: 0,
  pal: { ctype: 'tray', mount: '', orient: 'flat', ckind: 'power', cable: '', loadKind: 'pump', devKind: 'Sensor', boardKind: 'DB' },
  undo: [], drag: null, pan: null, hitCables: [], hitRoutes: [], dirty: false, imgCache: {}
};
const STACK_STEPS = [1, 2, 5, 10];

// ------------------------------------------------------------------
// small helpers
// ------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d));
const sizeTxt = (s) => (s == null ? '—' : (s < 1 ? String(s) : String(s)) + ' mm²');
function toast(msg, ms) {
  const t = el('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms || 2600);
}
function sheet() { return P.sheets.find(s => s.id === P.active) || null; }
function ppm() { const s = sheet(); return s && s.pxPerM > 0 ? s.pxPerM : 50; }
function nodeById(id) { return P.nodes.find(n => n.id === id); }
function routeById(id) { return P.routes.find(r => r.id === id); }
function circById(id) { return P.circuits.find(c => c.id === id); }
function defH(kind) {
  const s = P.settings;
  return kind === 'board' ? s.boardH : kind === 'isolator' ? s.isolatorH : kind === 'load' ? s.loadH : kind === 'device' ? s.deviceH : s.containHeight;
}
function getTK() { if (!TK) TK = C.takeoff(P, A); return TK; }

// colour per circuit, stable by order
const POWER_COLS = ['#a0522d', '#7d3c98', '#d35400', '#6e2c00', '#b9770e', '#5b2c6f', '#af601a', '#4a235a', '#935116', '#784212'];
const CTRL_COLS = ['#2471a3', '#1f618d', '#2e86c1', '#154360', '#5dade2'];
const SIG_COLS = ['#1e8449', '#239b56', '#117a65', '#0e6655', '#28b463'];
function circColour(c) {
  const list = c.kind === 'control' ? ((c.ctrl && c.ctrl.signal) ? SIG_COLS : CTRL_COLS) : POWER_COLS;
  const i = P.circuits.filter(x => x.kind === c.kind).indexOf(c);
  return list[(i < 0 ? 0 : i) % list.length];
}
const ROUTE_COLS = { tray: '#6b7380', ladder: '#4a5d6e', basket: '#8a9a9b', trunking: '#7e57c2', pvctrunking: '#9575cd', conduit: '#6d4c41', pvcconduit: '#a1887f', cleats: '#9e9e9e' };

// ------------------------------------------------------------------
// undo
// ------------------------------------------------------------------
function snapshot() {
  return JSON.stringify({
    nodes: P.nodes, routes: P.routes, circuits: P.circuits, measures: P.measures, settings: P.settings,
    sheets: P.sheets.map(s => Object.assign({}, s, { src: undefined })), active: P.active, nextId: P.nextId,
    name: P.name, ref: P.ref, client: P.client
  });
}
function pushUndo() {
  V.undo.push(snapshot());
  if (V.undo.length > 80) V.undo.shift();
  el('bUndo').disabled = false;
}
function undo() {
  const s = V.undo.pop();
  if (!s) return;
  const d = JSON.parse(s);
  const srcs = new Map(P.sheets.map(x => [x.id, x.src]));
  Object.assign(P, d);
  P.sheets.forEach(x => { x.src = srcs.get(x.id) || null; });
  el('bUndo').disabled = !V.undo.length;
  V.draft = null;
  if (V.sel && !selObject()) V.sel = null;
  showSheet();
  changed();
  ensureBaked();
}

// ------------------------------------------------------------------
// solve + render loop
// ------------------------------------------------------------------
function autoRefs() {
  const counts = new Map();
  P.circuits.forEach(c => {
    if (c.refAuto === false) return;
    const b = nodeById(c.board);
    const base = b ? b.name : (nodeById(c.iso) || {}).name || 'X';
    const key = base + (c.kind === 'control' ? 'C' : '');
    const n = (counts.get(key) || 0) + 1;
    counts.set(key, n);
    c.ref = c.kind === 'control' ? base + '/C' + n : base + '/' + n;
  });
}
function solveNow() {
  autoRefs();
  A = C.solve(P);
  TK = null;
}
let rafPending = false;
function changed(opts) {
  V.dirty = true;
  solveNow();
  scheduleRender();
  renderStatus();
  if (!(opts && opts.keepInspector)) renderInspector();
  if (window.Outputs && Outputs.drawerOpen()) Outputs.renderSchedule();
  if (window.Outputs && Outputs.threeOpen()) Outputs.draw3D();
  autosaveSoon();
}
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

// ------------------------------------------------------------------
// sheets and drawings
// ------------------------------------------------------------------
function addSheet(o) {
  const s = Object.assign({ id: C.nid(P, 's'), name: 'Sheet ' + (P.sheets.length + 1), level: 0, pxPerM: 0, w: 4000, h: 3000, src: null, concept: false }, o);
  P.sheets.push(s);
  P.active = s.id;
  return s;
}
function showSheet() {
  const s = sheet();
  const img = el('dwg');
  const sh = el('sheet');
  el('board').style.display = s ? 'none' : '';
  if (!s) { renderSheets(); return; }
  sh.classList.toggle('concept', !!s.concept);
  if (s.src) {
    img.style.visibility = 'visible';
    if (img.getAttribute('data-sheet') !== s.id) { img.src = s.src; img.setAttribute('data-sheet', s.id); }
  } else {
    img.removeAttribute('src'); img.setAttribute('data-sheet', ''); img.style.visibility = 'hidden';
  }
  img.style.width = s.w + 'px'; img.style.height = s.h + 'px';
  sh.style.width = s.w + 'px'; sh.style.height = s.h + 'px';
  const ov = el('ov');
  ov.setAttribute('width', s.w); ov.setAttribute('height', s.h);
  ov.setAttribute('viewBox', '0 0 ' + s.w + ' ' + s.h);
  applyZoom();
  renderSheets();
  scheduleRender();
}
function renderSheets() {
  const bar = el('sheets');
  const s = sheet();
  bar.innerHTML = P.sheets.map(x => '<button data-sheet="' + x.id + '" class="' + (x.id === P.active ? 'on' : '') + '" title="Double-click for name, level and scale">' + esc(x.name) + (x.level ? ' <span class="mono" style="color:var(--muted)">+' + fmt(x.level, 1) + ' m</span>' : '') + '</button>').join('')
    + '<button class="add" id="bAddDwg" title="Add a sheet from a PDF or image">+ Drawing</button>'
    + '<button class="add" id="bAddGrid" title="Add a blank grid sheet">+ Grid</button>'
    + '<div class="sp"></div>'
    + (s ? '<div class="scale">' + (s.pxPerM > 0 ? 'Scale ' + fmt(s.pxPerM, 1) + ' px/m' + (s.ratio ? ' &middot; 1:' + s.ratio : '') : '<span style="color:var(--alarm)">Scale not set — press S</span>') + '</div>' : '');
}
function sheetDialog(id) {
  const s = P.sheets.find(x => x.id === id);
  if (!s) return;
  modal('Sheet', '<div class="f"><label>Name</label><input id="shName" value="' + esc(s.name) + '"></div>'
    + '<div class="f"><label>Floor level</label><div class="unit"><input id="shLevel" type="number" step="0.1" value="' + (s.level || 0) + '"><span>m above datum</span></div></div>'
    + '<div class="f"><label>Scale</label><div class="unit"><input id="shPpm" type="number" step="0.01" value="' + (s.pxPerM || '') + '"><span>px per metre</span></div></div>'
    + '<p class="note">Heights you trace are above this floor. The 3D view and risers stack sheets by their floor level. Sheets are assumed to share the same origin and orientation, as building plans usually do.</p>',
  [['Delete sheet', () => {
    if (!confirm('Delete "' + s.name + '" and everything traced on it?')) return false;
    pushUndo();
    const gone = new Set(P.nodes.filter(n => n.sheet === s.id).map(n => n.id));
    P.nodes = P.nodes.filter(n => n.sheet !== s.id);
    P.routes = P.routes.filter(r => r.sheet !== s.id);
    P.measures = P.measures.filter(m => m.sheet !== s.id);
    P.circuits = P.circuits.filter(c => !gone.has(c.board) && !gone.has(c.target) && !gone.has(c.iso));
    P.sheets = P.sheets.filter(x => x.id !== s.id);
    P.active = P.sheets[0] ? P.sheets[0].id : null;
    V.sel = null; showSheet(); changed(); return true;
  }, 'danger'], ['Replace drawing', () => { V.replaceSheet = s.id; el('fDwg').click(); return true; }, 'ghost'],
  ['Save', () => {
    pushUndo();
    s.name = el('shName').value || s.name;
    s.level = Number(el('shLevel').value) || 0;
    const v = Number(el('shPpm').value);
    if (v > 0) s.pxPerM = v;
    renderSheets(); changed(); return true;
  }, 'go']]);
}

async function loadDrawingFile(file) {
  if (!file) return;
  const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
  try {
    if (isPdf) {
      if (typeof pdfjsLib === 'undefined') { toast('The PDF reader did not load — check the connection, or open an image instead'); return; }
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let pages = [1];
      if (pdf.numPages > 1) {
        pages = await pickPages(pdf.numPages, file.name);
        if (!pages || !pages.length) return;
      }
      let first = true;
      for (const pn of pages) {
        toast('Rendering page ' + pn + '…', 8000);
        const page = await pdf.getPage(pn);
        const vp1 = page.getViewport({ scale: 1 });
        const scale = Math.min(4, 6000 / Math.max(vp1.width, vp1.height));
        const vp = page.getViewport({ scale });
        const cv = document.createElement('canvas');
        cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const src = cv.toDataURL('image/jpeg', 0.86);
        const name = file.name.replace(/\.pdf$/i, '') + (pages.length > 1 || pdf.numPages > 1 ? ' p' + pn : '');
        placeDrawing({ src, w: cv.width, h: cv.height, name, pxPerPaperMm: scale * 72 / 25.4 }, first);
        first = false;
      }
      toast('Drawing loaded — now set the scale (S)');
    } else {
      const src = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      placeDrawing({ src, w: img.naturalWidth, h: img.naturalHeight, name: file.name.replace(/\.[a-z]+$/i, '') }, true);
      toast('Drawing loaded — now set the scale (S)');
    }
  } catch (e) {
    console.error(e);
    toast('Could not open that file: ' + (e && e.message ? e.message : e));
  }
}
function placeDrawing(d, first) {
  if (first && V.replaceSheet) {
    const s = P.sheets.find(x => x.id === V.replaceSheet);
    V.replaceSheet = null;
    if (s) {
      pushUndo();
      Object.assign(s, { src: d.src, w: d.w, h: d.h, concept: false, pxPerPaperMm: d.pxPerPaperMm || null });
      P.active = s.id; showSheet(); zoomFit(); changed(); return;
    }
  }
  pushUndo();
  const prev = sheet();
  addSheet({ name: d.name, src: d.src, w: d.w, h: d.h, pxPerPaperMm: d.pxPerPaperMm || null, level: prev ? prev.level : 0 });
  showSheet(); zoomFit(); changed();
  if (!sheet().pxPerM) setTool('scale');
}
function pickPages(n, name) {
  return new Promise(resolve => {
    const opts = Array.from({ length: n }, (_, i) => '<label style="display:inline-flex;gap:6px;align-items:center;margin:3px 14px 3px 0"><input type="checkbox" value="' + (i + 1) + '"' + (i === 0 ? ' checked' : '') + '> Page ' + (i + 1) + '</label>').join('');
    modal('Which pages?', '<p class="note">' + esc(name) + ' has ' + n + ' pages. Each page you tick opens as its own sheet — set each one\'s floor level so risers and the 3D view stack them.</p><div id="pgList">' + opts + '</div>',
      [['Cancel', () => { resolve(null); return true; }, 'ghost'], ['All pages', () => { resolve(Array.from({ length: n }, (_, i) => i + 1)); return true; }, 'ghost'],
       ['Open', () => { resolve([...document.querySelectorAll('#pgList input:checked')].map(x => Number(x.value))); return true; }, 'go']]);
  });
}
function newGridSheet() {
  pushUndo();
  addSheet({ name: 'Grid ' + (P.sheets.filter(s => s.concept).length + 1), concept: true, w: 5000, h: 3500, pxPerM: 50, src: null });
  showSheet(); zoomFit(); changed();
  toast('Grid sheet — 50 px per metre, each square is 1 m');
}

// ------------------------------------------------------------------
// zoom & coordinates
// ------------------------------------------------------------------
function applyZoom() {
  el('sheet').style.transform = 'scale(' + V.zoom + ')';
  const s = sheet();
  if (s) {
    // the scroller sizes to the transformed sheet through a wrapper margin
    el('sheet').style.marginRight = (s.w * (V.zoom - 1)) + 'px';
    el('sheet').style.marginBottom = (s.h * (V.zoom - 1)) + 'px';
  }
  el('zLvl').textContent = Math.round(V.zoom * 100) + '%';
}
function setZoom(z, anchor) {
  const sc = el('scroller');
  z = Math.max(0.03, Math.min(12, z));
  const rect = sc.getBoundingClientRect();
  const ax = anchor ? anchor.clientX - rect.left : rect.width / 2;
  const ay = anchor ? anchor.clientY - rect.top : rect.height / 2;
  const dx = (sc.scrollLeft + ax) / V.zoom, dy = (sc.scrollTop + ay) / V.zoom;
  V.zoom = z;
  applyZoom();
  sc.scrollLeft = dx * z - ax; sc.scrollTop = dy * z - ay;
  scheduleRender();
}
function zoomFit() {
  const s = sheet(); if (!s) return;
  const sc = el('scroller');
  const z = Math.min(sc.clientWidth / s.w, sc.clientHeight / s.h) * 0.98;
  V.zoom = Math.max(0.03, z);
  applyZoom();
  sc.scrollLeft = 0; sc.scrollTop = 0;
  scheduleRender();
}
function toDwg(ev) {
  const r = el('sheet').getBoundingClientRect();
  return { x: (ev.clientX - r.left) / V.zoom, y: (ev.clientY - r.top) / V.zoom };
}

// ------------------------------------------------------------------
// geometry
// ------------------------------------------------------------------
function distSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: Math.hypot(p.x - q.x, p.y - q.y), t, q };
}
function orthoNow() { return !!P.settings.ortho !== !!V.alt; }
function orthoPoint(prev, p) {
  if (!prev || !orthoNow()) return p;
  const dx = p.x - prev.x, dy = p.y - prev.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return p;
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  // project onto the locked direction
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const t = dx * ux + dy * uy;
  return { x: prev.x + ux * t, y: prev.y + uy * t };
}
function routePts(r) {
  if (!A) return r.pts.map(p => ({ id: p.id, x: p.x, y: p.y, h: p.h }));
  return r.pts.map(p => { const q = C.ptPos(A.ix, p.id) || p; return { id: p.id, x: q.x, y: q.y, h: q.h, link: p.link }; });
}

// what is under a point, nearest first
function hitNode(p, tolPx) {
  const tol = (tolPx || 16) / V.zoom;
  let best = null, bd = Infinity;
  P.nodes.forEach(n => {
    if (n.sheet !== P.active) return;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < tol && d < bd) { bd = d; best = n; }
  });
  return best;
}
function hitRoutePoint(p, tolPx, onlyRoute) {
  const tol = (tolPx || 10) / V.zoom;
  let best = null, bd = Infinity;
  P.routes.forEach(r => {
    if (r.sheet !== P.active) return;
    if (onlyRoute && r.id !== onlyRoute) return;
    routePts(r).forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < tol && d < bd) { bd = d; best = { route: r, i, pid: r.pts[i].id, x: q.x, y: q.y, h: q.h }; }
    });
  });
  return best;
}
function hitRouteSeg(p, tolPx) {
  const tol = (tolPx || 8) / V.zoom;
  let best = null, bd = Infinity;
  P.routes.forEach(r => {
    if (r.sheet !== P.active) return;
    const pts = routePts(r);
    const res = A && A.routes.get(r.id);
    const halfW = res && res.width ? res.width / 1000 * ppm() / 2 : 0;
    for (let i = 1; i < pts.length; i++) {
      const s = distSeg(p, pts[i - 1], pts[i]);
      const lim = Math.max(tol, halfW);
      if (s.d < lim && s.d < bd) {
        bd = s.d;
        const h = (pts[i - 1].h || 0) + ((pts[i].h || 0) - (pts[i - 1].h || 0)) * s.t;
        best = { route: r, i, x: s.q.x, y: s.q.y, h, t: s.t };
      }
    }
  });
  return best;
}
function hitCable(p) {
  let best = null, bd = Infinity;
  const tol = 6 / V.zoom;
  V.hitCables.forEach(h => {
    const s = distSeg(p, { x: h.x1, y: h.y1 }, { x: h.x2, y: h.y2 });
    const lim = Math.max(tol, h.w / 2);
    if (s.d < lim && s.d < bd) { bd = s.d; best = h; }
  });
  return best;
}
function hitMeasure(p) {
  const tol = 6 / V.zoom;
  for (const m of P.measures) {
    if (m.sheet !== P.active) continue;
    for (let i = 1; i < m.pts.length; i++) if (distSeg(p, m.pts[i - 1], m.pts[i]).d < tol) return m;
  }
  return null;
}

// ------------------------------------------------------------------
// rendering the plan
// ------------------------------------------------------------------
function render() {
  const s = sheet();
  const ov = el('ov');
  if (!s || !A) { ov.innerHTML = ''; return; }
  const k = ppm() / 1000;           // px per mm
  const z = V.zoom;
  const px = (n) => n / z;          // screen px → drawing px
  const f = STACK_STEPS[V.stackIx] || 1;
  const out = [];
  V.hitCables = [];
  const selC = V.sel && V.sel.kind === 'circ' ? V.sel.id : null;
  const selR = V.sel && V.sel.kind === 'route' ? V.sel.id : null;
  const selN = V.sel && V.sel.kind === 'node' ? V.sel.id : null;
  const multi = V.sel && V.sel.kind === 'multi' ? V.sel : null;

  // measures
  P.measures.filter(m => m.sheet === s.id).forEach(m => {
    const d = m.pts.map((q, i) => (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join('');
    const sel = (V.sel && V.sel.kind === 'measure' && V.sel.id === m.id) || (multi && multi.measures.includes(m.id));
    out.push('<path d="' + d + '" fill="none" stroke="#e0a422" stroke-width="' + px(sel ? 3 : 2) + '" stroke-dasharray="' + px(8) + ' ' + px(5) + '"/>');
    const last = m.pts[m.pts.length - 1];
    if (last) out.push('<text x="' + (last.x + px(6)) + '" y="' + (last.y - px(6)) + '" font-size="' + px(12) + '" font-weight="700" fill="#8a5d00" stroke-width="' + px(3) + '">' + fmt(measureLen(m), 2) + ' m</text>');
  });

  // containment bands
  P.routes.filter(r => r.sheet === s.id).forEach(r => {
    const pts = routePts(r);
    if (pts.length < 2) return;
    const res = A.routes.get(r.id) || {};
    const wmm = r.type === 'cleats' ? Math.max(20, (res.sumOd || 20)) : (res.drawMm || 100);
    const wpx = Math.max(wmm * k, px(3));
    const col = ROUTE_COLS[r.type] || '#777';
    const d = pts.map((q, i) => (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join('');
    const bad = res.ok === false;
    if (multi && multi.routes.includes(r.id)) out.push('<path d="' + d + '" fill="none" stroke="#e0a422" stroke-opacity="0.35" stroke-width="' + (wpx + px(10)) + '"/>');
    out.push('<path d="' + d + '" fill="none" stroke="' + (bad ? '#e57368' : col) + '" stroke-opacity="' + (r.type === 'cleats' ? 0.12 : 0.22) + '" stroke-width="' + wpx + '" stroke-linejoin="miter" stroke-linecap="butt"/>');
    // edges of the band
    if (wpx > px(5)) {
      [-1, 1].forEach(sg => out.push('<path d="' + offsetPath(pts, sg * wpx / 2) + '" fill="none" stroke="' + (bad ? '#bb3b2e' : col) + '" stroke-width="' + px(selR === r.id ? 2 : 1) + '" stroke-opacity="0.9"/>'));
    } else {
      out.push('<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + px(selR === r.id ? 2.5 : 1.2) + '"/>');
    }
    // vertical changes: mark the point where the height changes
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs((pts[i].h || 0) - (pts[i - 1].h || 0)) > 0.05) {
        const q = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) < 1 ? pts[i] : { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 };
        out.push('<g><circle cx="' + q.x + '" cy="' + q.y + '" r="' + px(7) + '" fill="#fff" stroke="' + col + '" stroke-width="' + px(1.5) + '"/>'
          + '<text x="' + q.x + '" y="' + (q.y + px(3.5)) + '" font-size="' + px(9) + '" text-anchor="middle" font-weight="800" fill="' + col + '" stroke-width="0">' + ((pts[i].h || 0) > (pts[i - 1].h || 0) ? '▲' : '▼') + '</text></g>');
      }
    }
    if (selR === r.id) {
      pts.forEach((q, i) => out.push('<rect x="' + (q.x - px(5)) + '" y="' + (q.y - px(5)) + '" width="' + px(10) + '" height="' + px(10) + '" fill="' + (V.sel.pt === i ? '#e0a422' : '#fff') + '" stroke="#23262c" stroke-width="' + px(1.5) + '"/>'));
    }
    if (V.labels >= 1) {
      let bi = 1, bl = 0;
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (l > bl) { bl = l; bi = i; } }
      const a = pts[bi - 1], b = pts[bi];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      const lab = (r.name || '') + ' ' + (r.type === 'cleats' ? 'cleated' : (res.size || '')) + (res.fillPct != null ? ' · ' + Math.round(res.fillPct) + '%' : '') + ' @' + fmt(pts[bi].h, 1) + 'm';
      out.push('<text x="' + mx + '" y="' + my + '" transform="rotate(' + ang.toFixed(1) + ' ' + mx + ' ' + my + ') translate(0 ' + (-(wpx / 2) - px(4)) + ')" font-size="' + px(11) + '" text-anchor="middle" font-weight="700" fill="' + (bad ? '#bb3b2e' : '#3c434d') + '" stroke-width="' + px(3) + '">' + esc(lab) + '</text>');
    }
  });

  // cables on containment: stacked side by side at true diameter, laid out by
  // C.edgeLayout() — the same layout the 3D draws and the take-off sizes for
  A.G.edges.forEach(e => {
    if (!e.rid) return;
    const r = A.ix.route.get(e.rid);
    if (!r || r.sheet !== s.id) return;
    const pa = A.G.nodes.get(e.a), pb = A.G.nodes.get(e.b);
    const L = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (L < 1) return;
    const lay = C.edgeLayout(P, A, e.id);
    if (!lay.items.length) return;
    const ux = (pb.x - pa.x) / L, uy = (pb.y - pa.y) / L;
    const nx = -uy, ny = ux;
    if (lay.divider != null) {
      const o = lay.divider * k * f;
      out.push('<line x1="' + (pa.x + nx * o).toFixed(2) + '" y1="' + (pa.y + ny * o).toFixed(2) + '" x2="' + (pb.x + nx * o).toFixed(2) + '" y2="' + (pb.y + ny * o).toFixed(2) + '" stroke="#23262c" stroke-width="' + Math.max(2 * k, px(1.2)).toFixed(3) + '" stroke-dasharray="' + px(6) + ' ' + px(3) + '"/>');
    }
    lay.items.forEach(cb => {
      const w = cb.od * k * f;
      const o = cb.off * k * f;
      const c = circById(cb.cid);
      if (!c) return;
      // only the stretch of this piece the cable actually rides
      const t0 = cb.t0 != null ? cb.t0 : 0, t1 = cb.t1 != null ? cb.t1 : 1;
      const ax = pa.x + (pb.x - pa.x) * t0, ay = pa.y + (pb.y - pa.y) * t0, bx = pa.x + (pb.x - pa.x) * t1, by = pa.y + (pb.y - pa.y) * t1;
      const x1 = ax + nx * o, y1 = ay + ny * o, x2 = bx + nx * o, y2 = by + ny * o;
      const sel = selC === c.id;
      const res2 = A.results.get(c.id);
      const bad = res2 && !res2.ok;
      out.push('<line x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) + '" stroke="' + circColour(c) + '" stroke-width="' + Math.max(w, px(1)).toFixed(3) + '" stroke-opacity="' + (selC && !sel ? 0.45 : 0.95) + '"/>');
      if (sel) out.push('<line x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) + '" stroke="#e0a422" stroke-width="' + Math.max(w + px(4), px(5)).toFixed(3) + '" stroke-opacity="0.45"/>');
      if (bad && !sel && w > px(2)) out.push('<line x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) + '" stroke="#bb3b2e" stroke-width="' + px(1) + '" stroke-dasharray="' + px(4) + ' ' + px(4) + '"/>');
      V.hitCables.push({ cid: c.id, role: cb.role, x1, y1, x2, y2, w: Math.max(w, px(2)) });
    });
  });

  // cables off containment (drops, tails, free runs)
  const labelSlots = new Map();
  P.circuits.forEach(c => {
    const res = A.results.get(c.id);
    if (!res || !res.paths) return;
    const sel = selC === c.id;
    res.paths.forEach((lp, li) => {
      const lr = (res.legs || [])[li] || {};
      const w = Math.max((lr.od || 10) * k * f, px(1.5));
      lp.spans.forEach(sp => {
        if (sp.edge) return;
        if (sp.from.sheet !== s.id || sp.to.sheet !== s.id) return;
        if (Math.hypot(sp.to.x - sp.from.x, sp.to.y - sp.from.y) < 0.5) return;
        const tail = lp.role === 'tail';
        out.push('<line x1="' + sp.from.x + '" y1="' + sp.from.y + '" x2="' + sp.to.x + '" y2="' + sp.to.y + '" stroke="' + circColour(c) + '" stroke-width="' + w.toFixed(3) + '" stroke-opacity="' + (selC && !sel ? 0.45 : 0.9) + '"' + (tail ? ' stroke-dasharray="' + px(6) + ' ' + px(3) + '"' : '') + ' stroke-linecap="round"/>');
        if (sel) out.push('<line x1="' + sp.from.x + '" y1="' + sp.from.y + '" x2="' + sp.to.x + '" y2="' + sp.to.y + '" stroke="#e0a422" stroke-width="' + (w + px(5)).toFixed(3) + '" stroke-opacity="0.45" stroke-linecap="round"/>');
        V.hitCables.push({ cid: c.id, role: lp.role, x1: sp.from.x, y1: sp.from.y, x2: sp.to.x, y2: sp.to.y, w });
      });
    });
    // label
    if ((V.labels >= 2 || sel) && res.paths[0]) {
      const lp = res.paths[0];
      let best = null, bl = 0;
      lp.spans.forEach(sp => { if (sp.from.sheet !== s.id || sp.to.sheet !== s.id) return; const l = Math.hypot(sp.to.x - sp.from.x, sp.to.y - sp.from.y); if (l > bl) { bl = l; best = sp; } });
      if (best && bl > px(40)) {
        const lr = res.legs[0] || {};
        const mx = (best.from.x + best.to.x) / 2, my = (best.from.y + best.to.y) / 2;
        const t = (c.ref || '') + ' ' + (lr.cores ? lr.cores + 'c ' : '') + (lr.size != null ? lr.size + 'mm² ' : '') + (lr.short || '') + (res.vdPct != null ? ' · ' + fmt(res.vdPct, 1) + '%' : '');
        // labels that share a stretch of containment step down so they do not overlap
        const slot = labelSlots.get(Math.round(mx / 40) + ':' + Math.round(my / 40)) || 0;
        labelSlots.set(Math.round(mx / 40) + ':' + Math.round(my / 40), slot + 1);
        out.push('<text x="' + mx + '" y="' + (my + px(14 + slot * 13)) + '" font-size="' + px(sel ? 12 : 10.5) + '" text-anchor="middle" font-weight="700" fill="' + (res.ok ? circColour(c) : '#bb3b2e') + '" stroke-width="' + px(3) + '">' + esc(t) + '</text>');
      }
    }
  });

  // equipment
  P.nodes.filter(n => n.sheet === s.id).forEach(n => out.push(nodeSvg(n, px, selN === n.id || !!(multi && multi.nodes.includes(n.id)))));
  if (V.drag && V.drag.kind === 'lasso') {
    const d = V.drag;
    out.push('<rect x="' + Math.min(d.a.x, d.b.x) + '" y="' + Math.min(d.a.y, d.b.y) + '" width="' + Math.abs(d.b.x - d.a.x) + '" height="' + Math.abs(d.b.y - d.a.y) + '" fill="rgba(224,164,34,.08)" stroke="#e0a422" stroke-width="' + px(1.5) + '" stroke-dasharray="' + px(6) + ' ' + px(4) + '"/>');
  }

  // draft
  if (V.draft) out.push(draftSvg(px));
  if (V.snap) {
    const sn = V.snap;
    out.push('<circle cx="' + sn.x + '" cy="' + sn.y + '" r="' + px(sn.kind === 'node' ? 16 : 8) + '" fill="none" stroke="#e0a422" stroke-width="' + px(2.5) + '"/>');
    if (sn.label) out.push('<text x="' + (sn.x + px(12)) + '" y="' + (sn.y - px(12)) + '" font-size="' + px(11.5) + '" font-weight="700" fill="#8a5d00" stroke-width="' + px(3) + '">' + esc(sn.label) + '</text>');
  }
  ov.innerHTML = out.join('');
}

function offsetPath(pts, off) {
  // miter offset of a polyline
  const n = pts.length;
  const res = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let d1 = i > 0 ? norm(p.x - a.x, p.y - a.y) : null;
    let d2 = i < n - 1 ? norm(b.x - p.x, b.y - p.y) : null;
    if (!d1) d1 = d2; if (!d2) d2 = d1;
    if (!d1) { res.push(p); continue; }
    const n1 = { x: -d1.y, y: d1.x }, n2 = { x: -d2.y, y: d2.x };
    let mx = n1.x + n2.x, my = n1.y + n2.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = n1.x; my = n1.y; } else { mx /= ml; my /= ml; }
    const cos = mx * n1.x + my * n1.y;
    const scale = off / Math.max(0.3, cos);
    res.push({ x: p.x + mx * scale, y: p.y + my * scale });
  }
  return res.map((q, i) => (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join('');
}
function norm(x, y) { const l = Math.hypot(x, y); return l < 1e-9 ? null : { x: x / l, y: y / l }; }

function nodeSvg(n, px, sel) {
  const s = px(12);
  const lab = V.labels >= 1 ? '<text x="' + (n.x + s * 1.4) + '" y="' + (n.y - s * 0.9) + '" font-size="' + px(11.5) + '" font-weight="800" fill="#23262c" stroke-width="' + px(3) + '">' + esc(n.name || '') + (V.labels >= 2 ? ' <tspan font-weight="500" fill="#5c6069">' + esc(nodeSub(n)) + '</tspan>' : '') + '</text>' : '';
  const ring = sel ? '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + (s * 1.9) + '" fill="rgba(224,164,34,.18)" stroke="#e0a422" stroke-width="' + px(2) + '"/>' : '';
  let g = '';
  if (n.kind === 'board') {
    const fill = n.boardKind === 'BMS' || n.boardKind === 'CP' ? '#2471a3' : '#23262c';
    g = '<rect x="' + (n.x - s * 1.3) + '" y="' + (n.y - s * 0.9) + '" width="' + (s * 2.6) + '" height="' + (s * 1.8) + '" fill="' + fill + '" stroke="#fff" stroke-width="' + px(1.5) + '"/>'
      + '<text x="' + n.x + '" y="' + (n.y + px(3.5)) + '" font-size="' + px(9.5) + '" font-weight="800" text-anchor="middle" fill="#fff" stroke-width="0">' + esc(n.boardKind || 'DB') + '</text>';
  } else if (n.kind === 'load') {
    const kd = E.LOAD_KINDS[n.loadKind] || E.LOAD_KINDS.general;
    const c = A && P.circuits.find(x => x.target === n.id && x.kind === 'power');
    const bad = c && A.results.get(c.id) && !A.results.get(c.id).ok;
    g = '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + s + '" fill="#fff" stroke="' + (bad ? '#bb3b2e' : (c ? '#8e4b1a' : '#9aa0a8')) + '" stroke-width="' + px(2.2) + '"/>'
      + '<text x="' + n.x + '" y="' + (n.y + px(3.5)) + '" font-size="' + px(kd.glyph.length > 2 ? 7.5 : 10) + '" font-weight="800" text-anchor="middle" fill="#23262c" stroke-width="0">' + esc(kd.glyph) + '</text>';
  } else if (n.kind === 'isolator') {
    const ss = /^ss/.test(n.enclosure || '');
    g = '<rect x="' + (n.x - s * 0.8) + '" y="' + (n.y - s * 0.8) + '" width="' + (s * 1.6) + '" height="' + (s * 1.6) + '" fill="' + (ss ? '#d5d8dc' : '#fff') + '" stroke="#c0392b" stroke-width="' + px(2) + '"/>'
      + '<line x1="' + (n.x - s * 0.5) + '" y1="' + (n.y + s * 0.5) + '" x2="' + (n.x + s * 0.5) + '" y2="' + (n.y - s * 0.5) + '" stroke="#c0392b" stroke-width="' + px(2) + '"/>';
  } else if (n.kind === 'device') {
    g = '<path d="M' + n.x + ' ' + (n.y - s) + 'L' + (n.x + s) + ' ' + (n.y + s * 0.8) + 'L' + (n.x - s) + ' ' + (n.y + s * 0.8) + 'Z" fill="#eaf2f8" stroke="#2471a3" stroke-width="' + px(2) + '"/>';
  } else if (n.kind === 'riser') {
    g = '<path d="M' + n.x + ' ' + (n.y - s) + 'L' + (n.x + s) + ' ' + n.y + 'L' + n.x + ' ' + (n.y + s) + 'L' + (n.x - s) + ' ' + n.y + 'Z" fill="#fdf2e9" stroke="#b9770e" stroke-width="' + px(2) + '"/>'
      + '<text x="' + n.x + '" y="' + (n.y + px(3.5)) + '" font-size="' + px(8.5) + '" font-weight="800" text-anchor="middle" fill="#7e5109" stroke-width="0">R</text>';
  }
  return '<g>' + ring + g + lab + '</g>';
}
function nodeSub(n) {
  if (n.kind === 'load') {
    const dc = E.designCurrent(C.loadInput(n));
    return (n.kw ? n.kw + 'kW ' : '') + (n.phase === 1 ? '1ph ' : '3ph ') + fmt(dc.ib, 1) + 'A' + (E.LOAD_KINDS[n.loadKind] && E.LOAD_KINDS[n.loadKind].motor ? ' ' + (n.drive || 'DOL') : '') + ' @' + fmt(n.h, 1) + 'm';
  }
  if (n.kind === 'isolator' && A) { const sp = C.isolatorSpec(P, A, n); return (sp.rating || '?') + 'A ' + sp.poles + (sp.aux ? '+aux' : '') + ' ' + (E.ISOLATOR_ENCLOSURES[sp.enclosure] || '').replace('Stainless steel', 'SS'); }
  if (n.kind === 'board' && A) { const b = A.boards.get(n.id); return b ? fmt(b.ib, 1) + 'A · Zdb ' + fmt(b.zdb, 2) + 'Ω' : ''; }
  if (n.kind === 'riser') return (n.riser || '') + ' @' + fmt(n.h, 1) + 'm';
  if (n.kind === 'device') return n.devKind || '';
  return '';
}
function measureLen(m) {
  let L = 0;
  for (let i = 1; i < m.pts.length; i++) L += Math.hypot(m.pts[i].x - m.pts[i - 1].x, m.pts[i].y - m.pts[i - 1].y);
  const sh = P.sheets.find(x => x.id === m.sheet);
  return L / (sh && sh.pxPerM > 0 ? sh.pxPerM : 50);
}

function draftSvg(px) {
  const d = V.draft;
  const pts = (d.pts || []).slice();
  const out = [];
  let colour = '#e0a422';
  if (d.tool === 'contain') colour = ROUTE_COLS[V.pal.ctype] || '#6b7380';
  if (d.tool === 'cable') colour = V.pal.ckind === 'power' ? '#a0522d' : V.pal.ckind === 'control' ? '#2471a3' : '#1e8449';
  if (V.cursor && pts.length) pts.push(V.cursor);
  if (pts.length > 1) {
    const path = pts.map((q, i) => (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join('');
    if (d.tool === 'contain' && V.pal.ctype !== 'cleats') {
      const def = E.CONTAINMENT[V.pal.ctype];
      const wmm = def && def.widths && def.widths.length ? 150 : 50;
      out.push('<path d="' + path + '" fill="none" stroke="' + colour + '" stroke-opacity=".25" stroke-width="' + Math.max(wmm * ppm() / 1000, px(4)) + '"/>');
    }
    out.push('<path d="' + path + '" fill="none" stroke="' + colour + '" stroke-width="' + px(2.2) + '" stroke-dasharray="' + px(7) + ' ' + px(4) + '"/>');
  }
  (d.pts || []).forEach((q, i) => {
    out.push('<circle cx="' + q.x + '" cy="' + q.y + '" r="' + px(4) + '" fill="#fff" stroke="' + colour + '" stroke-width="' + px(2) + '"/>');
    if (q.h != null && (i === 0 || Math.abs(q.h - d.pts[i - 1].h) > 0.01)) out.push('<text x="' + (q.x + px(6)) + '" y="' + (q.y + px(14)) + '" font-size="' + px(10.5) + '" font-weight="700" fill="#23262c" stroke-width="' + px(3) + '">' + fmt(q.h, 2) + ' m</text>');
  });
  if (d.tool === 'scale' && d.pts.length === 1 && V.cursor) {
    const L = Math.hypot(V.cursor.x - d.pts[0].x, V.cursor.y - d.pts[0].y);
    out.push('<text x="' + (V.cursor.x + px(8)) + '" y="' + (V.cursor.y - px(8)) + '" font-size="' + px(12) + '" font-weight="700" fill="#8a5d00" stroke-width="' + px(3) + '">' + fmt(L, 0) + ' px</text>');
  }
  if ((d.tool === 'tape' || d.tool === 'contain' || d.tool === 'cable') && pts.length > 1) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const last = pts[pts.length - 1];
    out.push('<text x="' + (last.x + px(10)) + '" y="' + (last.y + px(22)) + '" font-size="' + px(11) + '" font-weight="700" fill="#5c6069" stroke-width="' + px(3) + '">' + fmt(L / ppm(), 2) + ' m plan</text>');
  }
  return out.join('');
}

// ------------------------------------------------------------------
// status strip
// ------------------------------------------------------------------
function renderStatus() {
  const st = el('status');
  if (!A || !sheet()) { st.style.display = 'none'; return; }
  st.style.display = 'flex';
  const fails = A.issues.filter(i => i.sev === 'fail').length;
  const warns = A.issues.filter(i => i.sev === 'warn').length;
  let cableM = 0;
  A.results.forEach(r => (r.legs || []).forEach(l => { cableM += (l.lengthM || 0) * (l.singles ? (l.nSingles || 1) : 1); }));
  let contM = 0;
  A.G.edges.forEach(e => { contM += e.len; });
  const loads = P.nodes.filter(n => n.kind === 'load').length;
  const cells = [
    ['Loads', loads], ['Circuits', P.circuits.length], ['Cable', fmt(cableM, 0) + ' m'], ['Containment', fmt(contM, 0) + ' m'],
    ['Isolators', P.nodes.filter(n => n.kind === 'isolator').length]
  ];
  st.innerHTML = cells.map(c => '<div class="st"><b>' + c[0] + '</b><span>' + c[1] + '</span></div>').join('')
    + (fails ? '<div class="st bad" data-act="check"><b>Fails</b><span>' + fails + '</span></div>' : '')
    + (warns ? '<div class="st warn" data-act="check"><b>Check</b><span>' + warns + '</span></div>' : '')
    + (!fails && !warns && P.circuits.length ? '<div class="st"><b>BS 7671</b><span style="color:var(--live)">all pass</span></div>' : '');
}

// ------------------------------------------------------------------
// tools
// ------------------------------------------------------------------
const TOOLS = [
  ['select', 'V', 'Select', '<path d="M5 3l14 8-6 2-2 6z" fill="currentColor"/>'],
  ['scale', 'S', 'Scale', '<path d="M3 17L17 3l4 4L7 21z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2" stroke="currentColor" stroke-width="1.6"/>'],
  '-',
  ['board', 'B', 'Board', '<rect x="4" y="5" width="16" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9v6M12 9v6M16 9v6" stroke="currentColor" stroke-width="1.8"/>'],
  ['load', 'L', 'Load', '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><text x="12" y="16" font-size="10" text-anchor="middle" fill="currentColor" font-weight="800">M</text>'],
  ['isolator', 'I', 'Isolator', '<rect x="5" y="5" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 16L16 8" stroke="currentColor" stroke-width="2"/>'],
  ['device', 'D', 'Device', '<path d="M12 4l8 15H4z" fill="none" stroke="currentColor" stroke-width="1.8"/>'],
  ['riser', 'R', 'Riser', '<path d="M12 3l9 9-9 9-9-9z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v8M9 11l3-3 3 3" stroke="currentColor" stroke-width="1.6" fill="none"/>'],
  '-',
  ['contain', 'T', 'Contain', '<path d="M3 8h18M3 16h18" stroke="currentColor" stroke-width="1.8"/><path d="M6 8v8M10 8v8M14 8v8M18 8v8" stroke="currentColor" stroke-width="1" opacity=".7"/>'],
  ['cable', 'C', 'Cable', '<path d="M3 18c4 0 4-12 9-12s5 12 9 12" fill="none" stroke="currentColor" stroke-width="2.2"/>'],
  ['tape', 'M', 'Tape', '<rect x="3" y="8" width="18" height="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4" stroke="currentColor" stroke-width="1.4"/>'],
  '-',
  ['delete', 'Del', 'Delete', '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.8"/>']
];
function buildRail() {
  el('rail').innerHTML = TOOLS.map(t => t === '-' ? '<hr>' : '<button class="tool" data-tool="' + t[0] + '" title="' + t[2] + ' (' + t[1] + ')"><svg viewBox="0 0 24 24">' + t[3] + '</svg><i>' + t[2] + '</i></button>').join('');
}
const HINTS = {
  select: 'Click to select and edit. Drag on open paper to lasso several; Shift-click adds one. <kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> copy and paste. Space-drag to pan.',
  scale: 'Click both ends of a dimension you know.',
  board: 'Click to place a board — consumer unit, DB, MCC, BMS or control panel.',
  load: 'Click to place a load. Pick its kind above; enter kW or amps in the panel.',
  isolator: 'Click to place a local isolator beside its load.',
  device: 'Click to place a field device — sensor, actuator, switch.',
  riser: 'Click to place a riser. Give risers on different sheets the same name and containment joins through them.',
  contain: 'Click along the containment. Change <b>Height</b> before a click to rise or drop — click the last point again for a vertical riser. Start or finish on an existing run to tee in. <kbd>Enter</kbd> or double-click finishes.',
  cable: 'Click a board, then click along the containment (or free points), then the isolator or load. Board → isolator, then isolator → load for the tail. Board → load straight, and it routes through the containment by itself.',
  tape: 'Click along the route to measure. <kbd>Enter</kbd> to keep it.'
};
function setTool(t) {
  if (t === 'delete') { deleteSelected(); return; }
  if (!sheet() && t !== 'select') { toast('Open a drawing or a grid sheet first'); return; }
  if ((t === 'contain' || t === 'cable' || t === 'tape') && sheet() && !(sheet().pxPerM > 0)) { toast('Set the scale first (S)'); t = 'scale'; }
  V.tool = t;
  V.draft = null; V.snap = null;
  if (V.traceH == null) V.traceH = P.settings.containHeight;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  syncHint();
  renderPalette();
  el('scroller').classList.toggle('pan', t === 'select');
  scheduleRender();
}
function syncHint() {
  const h = el('hint');
  const t = V.tool;
  if (t === 'select') { h.classList.remove('on'); return; }
  h.classList.add('on');
  el('hintTxt').innerHTML = HINTS[t] || '';
  const tracing = t === 'contain' || t === 'cable' || t === 'tape';
  el('hintAngleWrap').style.display = tracing ? '' : 'none';
  el('hintOrthoWrap').style.display = tracing ? '' : 'none';
  el('hintHgt').style.display = (t === 'contain' || t === 'cable') ? '' : 'none';
  el('hintFin').style.display = tracing && V.draft ? '' : 'none';
  el('orthoChk').checked = !!P.settings.ortho;
  el('hgtIn').value = fmt(V.traceH, 2);
  h.classList.toggle('alt', !!V.alt && tracing);
}
function renderPalette() {
  const pal = el('pal');
  const t = V.tool;
  let h = '';
  const btns = (key, list) => list.map(([v, l]) => '<button data-pk="' + key + '" data-pv="' + esc(v) + '" class="' + (String(V.pal[key]) === String(v) ? 'on' : '') + '">' + esc(l) + '</button>').join('');
  if (t === 'contain') {
    h += '<div class="row"><b>Type</b>' + btns('ctype', Object.keys(E.CONTAINMENT).map(k => [k, E.CONTAINMENT[k].label.replace(/ \(.*\)/, '').replace('Cleated / clipped direct', 'Cleated / clipped')])) + '</div>';
    h += '<div class="row"><b>Fixing</b><select data-pk="mount"><option value="">Default (' + esc(E.MOUNTS[defaultMount(V.pal.ctype)]) + ')</option>' + Object.keys(E.MOUNTS).map(k => '<option value="' + k + '"' + (V.pal.mount === k ? ' selected' : '') + '>' + esc(E.MOUNTS[k]) + '</option>').join('') + '</select>'
      + '<b style="margin-left:8px">Lies</b>' + btns('orient', [['flat', 'Flat (horizontal)'], ['wall', 'On edge, on a wall']]) + '</div>';
  } else if (t === 'cable') {
    h += '<div class="row"><b>Cable</b>' + btns('ckind', [['power', 'Power'], ['control', 'Control'], ['signal', 'Data / signal']]) + '</div>';
    const use = V.pal.ckind === 'power' ? ['power'] : V.pal.ckind === 'control' ? ['control', 'power'] : ['signal'];
    const opts = Object.keys(E.CABLE_TYPES).filter(k => use.includes(E.CABLE_TYPES[k].use) || (V.pal.ckind === 'control' && E.CABLE_TYPES[k].control));
    h += '<div class="row"><b>Type</b><select data-pk="cable"><option value="">Project default</option>' + opts.map(k => '<option value="' + k + '"' + (V.pal.cable === k ? ' selected' : '') + '>' + esc(E.CABLE_TYPES[k].label) + '</option>').join('') + '</select></div>';
  } else if (t === 'load') {
    h += '<div class="row"><b>Load</b>' + btns('loadKind', Object.keys(E.LOAD_KINDS).map(k => [k, E.LOAD_KINDS[k].label])) + '</div>';
  } else if (t === 'board') {
    h += '<div class="row"><b>Board</b>' + btns('boardKind', BOARD_KINDS) + '</div>';
  } else if (t === 'device') {
    h += '<div class="row"><b>Device</b>' + btns('devKind', DEVICE_KINDS.map(d => [d, d])) + '</div>';
  }
  pal.innerHTML = h;
  pal.classList.toggle('on', !!h);
}
const BOARD_KINDS = [['DB', 'Distribution board'], ['CU', 'Consumer unit'], ['MCC', 'MCC'], ['SB', 'Switchboard'], ['BMS', 'BMS panel'], ['CP', 'Control panel']];
const DEVICE_KINDS = ['Sensor', 'Valve actuator', 'Damper actuator', 'Pressure switch', 'Flow switch', 'Detector', 'Thermostat', 'Outstation', 'Other'];
function defaultMount(type) {
  if (type === 'conduit' || type === 'pvcconduit') return 'saddle';
  if (type === 'cleats') return 'cleat';
  if (type === 'pvctrunking') return 'wallflat';
  return P.settings.defMount || 'droprod';
}

// ------------------------------------------------------------------
// placing equipment
// ------------------------------------------------------------------
function nextName(prefix) {
  let i = 1;
  const names = new Set(P.nodes.map(n => n.name));
  while (names.has(prefix + i)) i++;
  return prefix + i;
}
function addNode(kind, p) {
  pushUndo();
  const n = { id: C.nid(P, 'n'), sheet: P.active, kind, x: p.x, y: p.y, h: defH(kind) };
  if (kind === 'board') { n.boardKind = V.pal.boardKind; n.name = nextName(n.boardKind === 'CU' ? 'CU' : n.boardKind === 'BMS' ? 'BMS' : n.boardKind === 'CP' ? 'CP' : n.boardKind === 'MCC' ? 'MCC' : n.boardKind === 'SB' ? 'MSB' : 'DB'); n.phase = n.boardKind === 'CU' ? 1 : 3; }
  if (kind === 'load') {
    n.loadKind = V.pal.loadKind;
    const kd = E.LOAD_KINDS[n.loadKind];
    n.name = nextName(kd.glyph === 'AHU' ? 'AHU' : kd.glyph === 'CH' ? 'CH' : kd.glyph);
    n.phase = n.loadKind === 'lighting' || n.loadKind === 'sockets' ? 1 : 3;
    n.kw = kd.motor ? 2.2 : 1;
    n.drive = kd.motor ? 'DOL' : 'NA';
    n.kwBasis = 'input';
    n.pf = kd.motor ? 0.85 : 0.95;
  }
  if (kind === 'isolator') { n.name = nextName('ISO'); n.mount = 'wall'; }
  if (kind === 'device') { n.devKind = V.pal.devKind; n.name = nextName('FD'); }
  if (kind === 'riser') {
    // the same riser name on another sheet joins through it
    const others = P.nodes.filter(x => x.kind === 'riser' && x.sheet !== P.active);
    const used = new Set(P.nodes.filter(x => x.kind === 'riser' && x.sheet === P.active).map(x => x.riser));
    const reuse = others.find(x => !used.has(x.riser));
    n.riser = reuse ? reuse.riser : nextRiser();
    n.name = 'Riser ' + n.riser;
    n.h = P.settings.containHeight;
    n.riserType = 'tray';
    if (reuse) { n.x = reuse.x; n.y = reuse.y; }
  }
  P.nodes.push(n);
  V.sel = { kind: 'node', id: n.id };
  changed();
  return n;
}
function nextRiser() {
  const used = new Set(P.nodes.filter(x => x.kind === 'riser').map(x => x.riser));
  let i = 1; while (used.has('R' + i)) i++; return 'R' + i;
}

// ------------------------------------------------------------------
// tracing containment
// ------------------------------------------------------------------
function snapContain(p) {
  const n = hitNode(p, 14);
  if (n && n.kind === 'riser') return { kind: 'riser', id: n.id, x: n.x, y: n.y, h: n.h, label: n.name };
  const rp = hitRoutePoint(p, 11);
  if (rp) return { kind: 'pt', pid: rp.pid, x: rp.x, y: rp.y, h: rp.h, label: (rp.route.name || '') + ' @' + fmt(rp.h, 2) + ' m' };
  const sg = hitRouteSeg(p, 7);
  if (sg) return { kind: 'seg', rid: sg.route.id, i: sg.i, x: sg.x, y: sg.y, h: sg.h, label: 'tee into ' + (sg.route.name || '') };
  return null;
}
function containClick(p) {
  const d = V.draft || (V.draft = { tool: 'contain', pts: [] });
  const sn = snapContain(p);
  const prev = d.pts[d.pts.length - 1];
  if (prev && !sn) {
    // clicking the last point again with a new height makes a vertical riser
    if (Math.hypot(prev.x - p.x, prev.y - p.y) < 10 / V.zoom) {
      if (Math.abs(prev.h - V.traceH) > 0.005) { d.pts.push({ x: prev.x, y: prev.y, h: V.traceH }); scheduleRender(); syncHint(); return; }
      finishContain(); return;
    }
  }
  let q;
  if (sn) {
    q = { x: sn.x, y: sn.y, h: sn.h != null ? Number(sn.h) : V.traceH };
    if (sn.kind === 'pt') q.link = 'p:' + sn.pid;
    if (sn.kind === 'riser') q.link = 'n:' + sn.id;
    if (sn.kind === 'seg') q.seg = { rid: sn.rid, i: sn.i };
    // landing on a run at another height: the new run carries its own height to the joint
    if (d.pts.length && Math.abs(q.h - V.traceH) > 0.005 && sn.kind !== 'riser') {
      d.pts.push({ x: q.x, y: q.y, h: V.traceH });
    }
  } else {
    const o = orthoPoint(prev, p);
    q = { x: o.x, y: o.y, h: V.traceH };
  }
  if (prev && Math.hypot(prev.x - q.x, prev.y - q.y) < 0.5 && Math.abs(prev.h - q.h) < 0.005 && !q.link) return;
  d.pts.push(q);
  if (sn && d.pts.length >= 2 && (sn.kind === 'pt' || sn.kind === 'seg' || sn.kind === 'riser')) { finishContain(); return; }
  if (sn && d.pts.length === 1 && sn.h != null) { V.traceH = Number(sn.h); }
  syncHint();
  scheduleRender();
}
function finishContain() {
  const d = V.draft;
  if (!d || d.tool !== 'contain') return;
  const pts = d.pts;
  if (pts.length < 2) { V.draft = null; scheduleRender(); syncHint(); return; }
  pushUndo();
  const r = {
    id: C.nid(P, 'r'), sheet: P.active, name: nextRouteName(V.pal.ctype), type: V.pal.ctype,
    duty: E.CONTAINMENT[V.pal.ctype].defaultDuty, finish: P.settings.defFinish, width: null,
    mount: V.pal.mount || defaultMount(V.pal.ctype), layout: 'touching', orient: V.pal.orient, side: 1, pts: []
  };
  pts.forEach(q => {
    const pt = { id: C.nid(P, 'p'), x: q.x, y: q.y, h: q.h };
    if (q.link) pt.link = q.link;
    if (q.seg) {
      const host = routeById(q.seg.rid);
      if (host) {
        const np = { id: C.nid(P, 'p'), x: q.x, y: q.y, h: q.h };
        host.pts.splice(q.seg.i, 0, np);
        pt.link = 'p:' + np.id;
      }
    }
    r.pts.push(pt);
  });
  // a run that lands on another at a different height keeps its own height
  r.pts.forEach((pt, i) => { if (pt.link && pt.link.startsWith('p:') && i > 0 && i === r.pts.length - 1) { /* joined at the host height */ } });
  P.routes.push(r);
  V.draft = null;
  toast(r.name + ' added — ' + fmt(r.pts.length, 0) + ' points');
  changed();
  syncHint();
}
function nextRouteName(type) {
  const pre = { tray: 'CT', ladder: 'CL', basket: 'WB', trunking: 'TR', pvctrunking: 'PT', conduit: 'CD', pvcconduit: 'PC', cleats: 'CC' }[type] || 'R';
  let i = 1; const names = new Set(P.routes.map(r => r.name));
  while (names.has(pre + i)) i++;
  return pre + i;
}

// ------------------------------------------------------------------
// tracing cables
// ------------------------------------------------------------------
function snapCable(p) {
  const n = hitNode(p, 16);
  if (n) return { kind: n.kind === 'riser' ? 'riser' : 'node', id: n.id, x: n.x, y: n.y, h: n.h, label: n.name };
  const rp = hitRoutePoint(p, 11);
  if (rp) return { kind: 'pt', pid: rp.pid, x: rp.x, y: rp.y, h: rp.h, label: 'on ' + (rp.route.name || '') };
  const sg = hitRouteSeg(p, 7);
  if (sg) return { kind: 'seg', rid: sg.route.id, i: sg.i, x: sg.x, y: sg.y, h: sg.h, label: 'onto ' + (sg.route.name || '') };
  return null;
}
function cableClick(p) {
  const sn = snapCable(p);
  if (!V.draft) {
    if (!sn || sn.kind !== 'node') { toast('Start on a board, isolator, load or device'); return; }
    V.draft = { tool: 'cable', from: sn.id, way: [], pts: [{ x: sn.x, y: sn.y, h: sn.h }] };
    syncHint(); scheduleRender(); return;
  }
  const d = V.draft;
  const prev = d.pts[d.pts.length - 1];
  if (sn && sn.kind === 'node') {
    if (sn.id === d.from) { toast('That is where the cable starts'); return; }
    commitCable(d.from, sn.id, d.way);
    return;
  }
  if (sn && sn.kind === 'pt') { d.way.push({ p: sn.pid }); d.pts.push({ x: sn.x, y: sn.y, h: sn.h }); }
  else if (sn && sn.kind === 'riser') { d.way.push({ r: sn.id }); d.pts.push({ x: sn.x, y: sn.y, h: sn.h }); }
  else if (sn && sn.kind === 'seg') {
    pushUndo();
    const host = routeById(sn.rid);
    const np = { id: C.nid(P, 'p'), x: sn.x, y: sn.y, h: sn.h };
    host.pts.splice(sn.i, 0, np);
    solveNow();
    d.way.push({ p: np.id }); d.pts.push({ x: sn.x, y: sn.y, h: sn.h });
  } else {
    const o = orthoPoint(prev, p);
    d.way.push({ s: P.active, x: o.x, y: o.y, h: V.traceH });
    d.pts.push({ x: o.x, y: o.y, h: V.traceH });
  }
  syncHint(); scheduleRender();
}
const RANK = { board: 0, isolator: 1, load: 2, device: 2, riser: 9 };
function commitCable(aId, bId, way) {
  let a = nodeById(aId), b = nodeById(bId);
  way = (way || []).slice();
  const kind = V.pal.ckind;
  const ctype = V.pal.cable || null;
  pushUndo();
  let c = null, role = 'main';
  const isCtrlEnd = (n) => n.kind === 'device' || (n.kind === 'board' && (n.boardKind === 'BMS' || n.boardKind === 'CP'));
  if (kind !== 'power' || (a.kind === 'device' || b.kind === 'device')) {
    // control or signal: from the panel to the device or load
    if (b.kind === 'board' && a.kind !== 'board') { [a, b] = [b, a]; way.reverse(); }
    c = { id: C.nid(P, 'c'), kind: 'control', board: a.id, target: b.id, iso: null, refAuto: true, device: {}, ctrl: { volts: 24, va: kind === 'signal' ? 0 : 10, signal: kind === 'signal' }, legs: { main: { way } } };
    if (ctype) c.legs.main.type = ctype;
    P.circuits.push(c);
  } else {
    if (RANK[a.kind] > RANK[b.kind]) { [a, b] = [b, a]; way.reverse(); }
    if (a.kind === 'board' && b.kind === 'board') {
      c = P.circuits.find(x => x.kind === 'submain' && x.target === b.id);
      if (!c) { c = { id: C.nid(P, 'c'), kind: 'submain', board: a.id, target: b.id, refAuto: true, device: { family: 'mccb' }, legs: { main: {} } }; P.circuits.push(c); }
      c.board = a.id;
    } else if (a.kind === 'board' && b.kind === 'isolator') {
      c = P.circuits.find(x => x.iso === b.id);
      if (!c) { c = { id: C.nid(P, 'c'), kind: 'power', board: a.id, iso: b.id, target: null, refAuto: true, device: {}, legs: { main: {} } }; P.circuits.push(c); }
      c.board = a.id;
    } else if (a.kind === 'board' && b.kind === 'load') {
      c = P.circuits.find(x => x.kind === 'power' && x.target === b.id);
      if (!c) { c = { id: C.nid(P, 'c'), kind: 'power', board: a.id, iso: null, target: b.id, refAuto: true, device: {}, legs: { main: {} } }; P.circuits.push(c); }
      else { c.board = a.id; c.iso = null; delete c.legs.tail; }
    } else if (a.kind === 'isolator' && b.kind === 'load') {
      role = 'tail';
      c = P.circuits.find(x => x.iso === a.id);
      const other = P.circuits.find(x => x.kind === 'power' && x.target === b.id && x !== c);
      if (!c) { c = { id: C.nid(P, 'c'), kind: 'power', board: other ? other.board : null, iso: a.id, target: b.id, refAuto: true, device: other ? other.device : {}, legs: { main: {} } }; P.circuits.push(c); }
      if (other) { if (!c.board) c.board = other.board; P.circuits = P.circuits.filter(x => x !== other); }
      c.target = b.id;
    } else {
      V.draft = null; V.undo.pop();
      toast('Join a board to an isolator or load, an isolator to its load, or a board to another board');
      scheduleRender(); return;
    }
    c.legs[role] = Object.assign(c.legs[role] || {}, { way });
    if (ctype) c.legs[role].type = ctype;
  }
  V.draft = null;
  V.sel = { kind: 'circ', id: c.id };
  changed();
  syncHint();
  const r = A.results.get(c.id);
  if (c.kind === 'power' && c.iso && !c.target) toast('Supply to the isolator traced — now trace the tail from the isolator to the load');
  else if (r && r.legs && r.legs[0]) toast((c.ref || '') + ': ' + (r.legs.map(l => (l.cores ? l.cores + 'c ' : '') + l.size + 'mm² ' + l.short).join(' + ')) + (r.vdPct != null ? ' · VD ' + fmt(r.vdPct, 2) + '%' : ''));
}

// ------------------------------------------------------------------
// scale and tape
// ------------------------------------------------------------------
function scaleClick(p) {
  const d = V.draft || (V.draft = { tool: 'scale', pts: [] });
  d.pts.push(p);
  if (d.pts.length < 2) { scheduleRender(); return; }
  const L = Math.hypot(d.pts[1].x - d.pts[0].x, d.pts[1].y - d.pts[0].y);
  V.draft = null; scheduleRender();
  if (L < 5) { toast('Those points are too close'); return; }
  const s = sheet();
  modal('Set the scale', '<p class="note">The line you drew is <b>' + fmt(L, 0) + ' px</b> long on the sheet.</p>'
    + '<div class="f"><label>Its real length</label><div class="unit"><input id="scLen" type="number" step="0.001" placeholder="e.g. 6.0"><span>m</span></div></div>'
    + (s.pxPerPaperMm ? '<p class="note">Or, as this came from a PDF, type the drawing scale instead (as printed on the title block, at the sheet size it was drawn):</p><div class="f"><label>Drawing scale 1:</label><input id="scRatio" type="number" step="1" placeholder="100"></div>' : ''),
  [['Cancel', () => true, 'ghost'], ['Set scale', () => {
    const m = Number(el('scLen').value);
    const ratio = el('scRatio') ? Number(el('scRatio').value) : 0;
    pushUndo();
    if (m > 0) { s.pxPerM = L / m; s.ratio = null; }
    else if (ratio > 0 && s.pxPerPaperMm) { s.pxPerM = s.pxPerPaperMm * 1000 / ratio; s.ratio = ratio; }
    else { toast('Type the length in metres'); return false; }
    renderSheets(); changed(); setTool('select');
    toast('Scale set: ' + fmt(s.pxPerM, 2) + ' px per metre');
    return true;
  }, 'go']]);
  setTimeout(() => el('scLen') && el('scLen').focus(), 30);
}
function tapeClick(p) {
  const d = V.draft || (V.draft = { tool: 'tape', pts: [] });
  const prev = d.pts[d.pts.length - 1];
  const o = orthoPoint(prev, p);
  if (prev && Math.hypot(prev.x - o.x, prev.y - o.y) < 10 / V.zoom) { finishTape(); return; }
  d.pts.push(o);
  syncHint(); scheduleRender();
}
function finishTape() {
  const d = V.draft;
  if (!d || d.pts.length < 2) { V.draft = null; scheduleRender(); return; }
  pushUndo();
  const m = { id: C.nid(P, 'm'), sheet: P.active, pts: d.pts };
  P.measures.push(m);
  V.draft = null;
  toast('Measured ' + fmt(measureLen(m), 2) + ' m (plan)');
  changed(); syncHint();
}
function finishDraft() {
  if (!V.draft) return;
  if (V.draft.tool === 'contain') finishContain();
  else if (V.draft.tool === 'tape') finishTape();
  else if (V.draft.tool === 'cable') toast('Finish a cable on a load, isolator or board');
}

// ------------------------------------------------------------------
// selection, moving, deleting
// ------------------------------------------------------------------
function selObject() {
  const s = V.sel;
  if (!s) return null;
  if (s.kind === 'node') return nodeById(s.id);
  if (s.kind === 'route') return routeById(s.id);
  if (s.kind === 'circ') return circById(s.id);
  if (s.kind === 'measure') return P.measures.find(m => m.id === s.id);
  if (s.kind === 'multi') return s;
  return null;
}
function select(kind, id, extra) {
  V.sel = kind ? Object.assign({ kind, id }, extra || {}) : null;
  scheduleRender();
  renderInspector();
}
function selectAt(p) {
  if (V.sel && V.sel.kind === 'route') {
    const rp = hitRoutePoint(p, 10, V.sel.id);
    if (rp) { select('route', V.sel.id, { pt: rp.i }); return { kind: 'routept', rp }; }
  }
  const n = hitNode(p);
  if (n) { select('node', n.id); return { kind: 'node', n }; }
  const cb = hitCable(p);
  if (cb) { select('circ', cb.cid, { role: cb.role }); return { kind: 'circ' }; }
  const sg = hitRouteSeg(p, 8);
  if (sg) { select('route', sg.route.id); return { kind: 'route' }; }
  const m = hitMeasure(p);
  if (m) { select('measure', m.id); return { kind: 'measure' }; }
  return null;
}
function deleteSelected() {
  const s = V.sel;
  if (!s) { toast('Select something to delete'); return; }
  if (s.kind === 'multi') { deleteMulti(s); return; }
  pushUndo();
  if (s.kind === 'node') {
    removeNode(s.id);
  } else if (s.kind === 'route') {
    const r = routeById(s.id);
    if (s.pt != null && r.pts.length > 2) {
      const pt = r.pts[s.pt];
      unrefPoint(pt.id);
      r.pts.splice(s.pt, 1);
      V.sel = { kind: 'route', id: r.id };
      changed(); return;
    }
    r.pts.forEach(pt => unrefPoint(pt.id));
    P.routes = P.routes.filter(x => x.id !== s.id);
  } else if (s.kind === 'circ') {
    P.circuits = P.circuits.filter(c => c.id !== s.id);
  } else if (s.kind === 'measure') {
    P.measures = P.measures.filter(m => m.id !== s.id);
  }
  V.sel = null;
  changed();
}
function removeNode(id) {
  const n = nodeById(id);
  P.nodes = P.nodes.filter(x => x.id !== id);
  P.circuits = P.circuits.filter(c => c.target !== id && !(c.board === id && c.kind !== 'power'));
  P.circuits.forEach(c => {
    if (c.board === id) c.board = null;
    if (c.iso === id) { c.iso = null; if (c.legs.tail) { c.legs.main = c.legs.main || {}; delete c.legs.tail; } }
    Object.values(c.legs || {}).forEach(l => { if (l.way) l.way = l.way.filter(w => w.r !== id); });
  });
  P.circuits = P.circuits.filter(c => c.board || c.iso || c.target);
  if (n && n.kind === 'riser') P.routes.forEach(r => r.pts.forEach(pt => { if (pt.link === 'n:' + n.id) { pt.x = n.x; pt.y = n.y; delete pt.link; } }));
}
// a point is going: anything joined to it keeps its place, cables keep a free waypoint
function unrefPoint(pid) {
  const pos = A && C.ptPos(A.ix, pid);
  P.routes.forEach(r => r.pts.forEach(pt => { if (pt.link === 'p:' + pid) { if (pos) { pt.x = pos.x; pt.y = pos.y; } delete pt.link; } }));
  P.circuits.forEach(c => Object.values(c.legs || {}).forEach(l => {
    if (!l.way) return;
    l.way = l.way.map(w => (w.p === pid ? (pos ? { s: pos.sheet, x: pos.x, y: pos.y, h: pos.h } : null) : w)).filter(Boolean);
  }));
}

// ------------------------------------------------------------------
// pointer handling
// ------------------------------------------------------------------
function onDown(ev) {
  if (!sheet()) return;
  if (ev.button === 1 || ev.button === 2 || V.space) { beginPan(ev); ev.preventDefault(); return; }
  if (ev.button !== 0) return;
  const p = toDwg(ev);
  const t = V.tool;
  if (t === 'select') { selectDown(ev, p); return; }
  if (t === 'board' || t === 'load' || t === 'isolator' || t === 'device' || t === 'riser') { addNode(t, p); return; }
  if (t === 'contain') { containClick(p); return; }
  if (t === 'cable') { cableClick(p); return; }
  if (t === 'scale') { scaleClick(p); return; }
  if (t === 'tape') { tapeClick(p); return; }
}
function onMove(ev) {
  if (V.pan) {
    const sc = el('scroller');
    sc.scrollLeft = V.pan.sl - (ev.clientX - V.pan.x);
    sc.scrollTop = V.pan.st - (ev.clientY - V.pan.y);
    return;
  }
  if (!sheet()) return;
  const p = toDwg(ev);
  V.lastCursor = p;
  if (V.drag && V.drag.kind === 'lasso') { V.drag.b = p; scheduleRender(); return; }
  if (V.drag) {
    const dx = p.x - V.drag.start.x, dy = p.y - V.drag.start.y;
    if (!V.drag.moved && Math.hypot(dx, dy) * V.zoom < 3) return;
    if (!V.drag.moved) { pushUndo(); V.drag.moved = true; }
    if (V.drag.kind === 'group') {
      dragGroup(dx, dy);
    } else if (V.drag.kind === 'node') {
      const n = nodeById(V.drag.id);
      n.x = V.drag.ox + dx; n.y = V.drag.oy + dy;
    } else if (V.drag.kind === 'pt') {
      const r = routeById(V.drag.rid);
      let pt = r.pts[V.drag.i];
      // move the point the joint belongs to
      let guard = 0;
      while (pt.link && pt.link.startsWith('p:') && guard++ < 8) { const e = A.ix.pt.get(pt.link.slice(2)); if (!e) break; pt = e.p; }
      if (!pt.link || !pt.link.startsWith('n:')) {
        const prev = r.pts[V.drag.i - 1] || r.pts[V.drag.i + 1];
        const pp = prev ? C.ptPos(A.ix, prev.id) : null;
        const q = pp ? orthoPoint(pp, p) : p;
        pt.x = q.x; pt.y = q.y;
      }
    }
    solveNow(); scheduleRender();
    return;
  }
  if (V.tool === 'contain' || V.tool === 'cable' || V.tool === 'tape' || V.tool === 'scale') {
    let sn = null;
    if (V.tool === 'contain') sn = snapContain(p);
    else if (V.tool === 'cable') sn = snapCable(p);
    V.snap = sn;
    const prev = V.draft && V.draft.pts && V.draft.pts[V.draft.pts.length - 1];
    V.cursor = sn ? { x: sn.x, y: sn.y } : (V.tool === 'scale' ? p : orthoPoint(prev, p));
    if (prev) {
      const ang = Math.atan2(V.cursor.y - prev.y, V.cursor.x - prev.x) * 180 / Math.PI;
      el('hintAngle').textContent = fmt(((ang % 360) + 360) % 360, 0) + '° · ' + fmt(Math.hypot(V.cursor.x - prev.x, V.cursor.y - prev.y) / ppm(), 2) + ' m';
    }
    scheduleRender();
  } else if (V.snap) { V.snap = null; scheduleRender(); }
}
function onUp() {
  if (V.pan) { V.pan = null; el('scroller').classList.remove('panning'); }
  if (V.drag && V.drag.kind === 'lasso') {
    const d = V.drag;
    V.drag = null;
    if (Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) * V.zoom > 4) selectInBox(d.a, d.b, d.add);
    scheduleRender();
    return;
  }
  if (V.drag) {
    const moved = V.drag.moved;
    V.drag = null;
    if (moved) changed();
  }
}
function beginPan(ev) {
  const sc = el('scroller');
  V.pan = { x: ev.clientX, y: ev.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
  sc.classList.add('panning');
}

// ------------------------------------------------------------------
// inspector
// ------------------------------------------------------------------
function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
function F(label, html) { return '<div class="f"><label>' + label + '</label>' + html + '</div>'; }
function inp(o, k, val, type, extra) {
  return '<input data-o="' + o + '" data-k="' + k + '" data-ty="' + (type || 'text') + '" ' + (type === 'num' ? 'type="number" step="any"' : 'type="text"') + ' value="' + esc(val == null ? '' : val) + '" ' + (extra || '') + '>';
}
function num(o, k, val, unit, extra) { return '<div class="unit">' + inp(o, k, val, 'num', extra) + (unit ? '<span>' + unit + '</span>' : '') + '</div>'; }
function sel(o, k, cur, options, extra) { return '<select data-o="' + o + '" data-k="' + k + '" data-ty="sel" ' + (extra || '') + '>' + options.map(x => opt(x[0], x[1], cur)).join('') + '</select>'; }
function chk(o, k, val) { return '<input type="checkbox" data-o="' + o + '" data-k="' + k + '" data-ty="chk"' + (val ? ' checked' : '') + '>'; }
function checksHtml(list) {
  return '<ul class="chk">' + (list || []).map(c => '<li class="' + (c.ok ? 'ok' : c.warn ? 'warn' : 'bad') + '">' + esc(c.text) + '</li>').join('') + '</ul>';
}

function renderInspector() {
  const body = el('body');
  const box = el('insp');
  const o = selObject();
  if (!o) { body.classList.remove('insp'); box.innerHTML = ''; return; }
  body.classList.add('insp');
  let h = '';
  const k = V.sel.kind;
  if (k === 'node') h = nodeForm(o);
  else if (k === 'route') h = routeForm(o);
  else if (k === 'circ') h = circForm(o);
  else if (k === 'multi') h = multiForm(o);
  else if (k === 'measure') h = '' + hd('Tape', fmt(measureLen(o), 2) + ' m') + '<div class="insp-bd"><p class="note">A plan measurement only — not counted in the take-off.</p><div class="insp-actions"><button class="btn danger sm" data-act="delete">Delete</button></div></div>';
  box.innerHTML = h;
}
function hd(kind, title) {
  return '<div class="insp-hd"><div style="min-width:0;flex:1"><div class="kind">' + esc(kind) + '</div><h3>' + esc(title) + '</h3></div>'
    + '<button class="btn ghost sm" data-act="dup" title="Duplicate beside the original (Ctrl+D)">Duplicate</button>'
    + '<button class="btn go sm" data-act="done" title="Apply the changes and close (Enter applies a field too)">Done</button></div>';
}
// The field being typed in only commits on change (blur or Enter). A button
// press commits it first, so Done and Duplicate never lose an edit.
function commitActiveField() {
  const f = document.activeElement;
  if (!f || !el('insp').contains(f) || !f.dataset || !f.dataset.o) return;
  if (f.tagName === 'INPUT' && f.type !== 'checkbox' && f.value !== f.defaultValue) onInspectorChange({ target: f });
}

function nodeForm(n) {
  let h = '';
  const common = F('Name', inp('node', 'name', n.name)) + F('Height', num('node', 'h', n.h, 'm above floor'));
  if (n.kind === 'board') {
    const st = A.boards.get(n.id) || {};
    const feed = P.circuits.find(c => c.kind === 'submain' && c.target === n.id);
    h += hd('Board', n.name) + '<div class="insp-bd">' + common;
    h += F('Type', sel('node', 'boardKind', n.boardKind || 'DB', BOARD_KINDS));
    h += F('Supply', sel('node', 'phase', n.phase === 1 ? 1 : 3, [[3, 'Three phase (TP&N)'], [1, 'Single phase (SP&N)']]));
    h += '<h4>At the board</h4>';
    h += F('Zdb (Ze at board)', num('node', 'zdb', n.zdb, 'Ω', 'placeholder="' + fmt(st.zdb, 3) + (st.derived ? ' from feed' : ' default') + '"'));
    h += F('Fault level (PFC)', num('node', 'pfcKA', n.pfcKA, 'kA', 'placeholder="' + fmt(st.pfcKA, 1) + '"'));
    h += F('Upstream volt drop', num('node', 'upPct', n.upPct, '%', 'placeholder="' + fmt(st.upstreamPct, 2) + '"'));
    h += F('Diversity', num('node', 'diversity', n.diversity, '× (sub-main)', 'placeholder="1.0"'));
    h += F('Outdoor', chk('node', 'outdoor', n.outdoor));
    h += '<p class="note">' + (feed ? 'Fed by <a href="#" data-goto="circ:' + feed.id + '">' + esc(feed.ref) + '</a> — Zdb, PFC and upstream volt drop follow from that sub-main unless typed here.' : 'Leave Zdb blank to use the project default (' + P.settings.zdbDefault + ' Ω). Type the measured or calculated value at this board when you have it.') + '</p>';
    h += '<table class="kv"><tr><td>Connected load (after diversity)</td><td>' + fmt(st.ib, 1) + ' A</td></tr><tr><td>Zdb used</td><td>' + fmt(st.zdb, 3) + ' Ω</td></tr><tr><td>PFC used</td><td>' + fmt(st.pfcKA, 1) + ' kA</td></tr></table>';
    const outs = P.circuits.filter(c => c.board === n.id);
    if (outs.length) {
      h += '<h4>Outgoing circuits</h4><table class="kv">' + outs.map(c => { const r = A.results.get(c.id) || {}; const tgt = nodeById(c.target) || nodeById(c.iso); return '<tr><td><a href="#" data-goto="circ:' + c.id + '">' + esc(c.ref) + '</a> ' + esc(tgt ? tgt.name : '') + '</td><td style="color:' + (r.ok ? 'var(--live)' : 'var(--alarm)') + '">' + esc(r.deviceText || '') + '</td></tr>'; }).join('') + '</table>';
    }
  } else if (n.kind === 'load') {
    const kd = E.LOAD_KINDS[n.loadKind] || E.LOAD_KINDS.general;
    const dc = E.designCurrent(C.loadInput(n));
    const c = P.circuits.find(x => x.kind === 'power' && x.target === n.id);
    h += hd(kd.label, n.name) + '<div class="insp-bd">' + common;
    h += F('Kind', sel('node', 'loadKind', n.loadKind, Object.keys(E.LOAD_KINDS).map(k2 => [k2, E.LOAD_KINDS[k2].label])));
    h += F('Supply', sel('node', 'phase', n.phase === 1 ? 1 : 3, [[3, 'Three phase 400 V'], [1, 'Single phase 230 V']]));
    if (n.phase !== 1) h += F('Needs a neutral', chk('node', 'neutral', n.neutral));
    h += '<h4>Rating</h4>';
    h += F('Power', num('node', 'kw', n.kw, 'kW'));
    h += F('kW is', sel('node', 'kwBasis', n.kwBasis || 'input', [['input', 'Electrical input (nameplate)'], ['output', 'Motor shaft output']]));
    h += F('Power factor', num('node', 'pf', n.pf, '', 'placeholder="0.85"'));
    if (n.kwBasis === 'output') h += F('Efficiency', num('node', 'eff', n.eff, '', 'placeholder="0.90"'));
    h += F('Max current (FLC)', num('node', 'amps', n.amps, 'A', 'placeholder="from kW"'));
    if (kd.motor) {
      h += '<h4>Drive</h4>';
      h += F('Starting', sel('node', 'drive', n.drive || 'DOL', Object.keys(E.DRIVES).filter(d => d !== 'NA').map(d => [d, E.DRIVES[d].label])));
      h += F('Peak / start current', num('node', 'peakA', n.peakA, 'A', 'placeholder="' + fmt(dc.start, 0) + '"'));
      h += F('Start × FLC', num('node', 'startMult', n.startMult, '×', 'placeholder="' + (E.DRIVES[n.drive || 'DOL'] || {}).start + '"'));
    }
    h += F('Outdoor', chk('node', 'outdoor', n.outdoor));
    h += '<table class="kv"><tr><td>Design current Ib</td><td>' + fmt(dc.ib, 2) + ' A</td></tr>' + (dc.typed ? '<tr><td>From kW (for reference)</td><td>' + fmt(dc.fromKw, 2) + ' A</td></tr>' : '') + (kd.motor ? '<tr><td>Starting / peak</td><td>' + fmt(dc.start, 0) + ' A</td></tr>' : '') + '</table>';
    h += c ? '<p class="note">Fed by <a href="#" data-goto="circ:' + c.id + '">' + esc(c.ref) + '</a>.</p>' : '<p class="note warn">No supply traced. Use the Cable tool: board → isolator → this load, or board → this load.</p>';
  } else if (n.kind === 'isolator') {
    const sp = C.isolatorSpec(P, A, n);
    h += hd('Isolator', n.name) + '<div class="insp-bd">' + common;
    h += F('Rating', sel('node', 'rating', n.rating || '', [['', 'Auto (' + (sp.rating || '?') + ' A)']].concat(E.ISOLATOR_RATINGS.map(r => [r, r + ' A']))));
    h += F('Poles', sel('node', 'poles', n.poles || 'auto', [['auto', 'Auto (' + sp.poles + ')'], ['2P', '2 pole (DP)'], ['3P', '3 pole'], ['3PN', '3 pole + switched N'], ['4P', '4 pole'], ['6P', '6 pole']]));
    h += F('Aux contact', sel('node', 'aux', n.aux == null ? 'auto' : String(n.aux), [['auto', 'Auto (' + (sp.aux ? 'yes' : 'no') + ')'], ['true', 'Yes — early break'], ['false', 'No']]));
    h += F('Enclosure', sel('node', 'enclosure', n.enclosure || '', [['', 'Project default (' + (E.ISOLATOR_ENCLOSURES[P.settings.isoEnclosure] || '') + ')']].concat(Object.keys(E.ISOLATOR_ENCLOSURES).map(x => [x, E.ISOLATOR_ENCLOSURES[x]]))));
    h += F('IP rating', sel('node', 'ip', n.ip || '', [['', 'Project default (' + P.settings.isoIP + ')']].concat(E.ISOLATOR_IP.map(x => [x, x]))));
    h += F('Switch-fuse', chk('node', 'fused', n.fused));
    h += F('Fixed', sel('node', 'mount', n.mount || 'wall', [['wall', 'Direct to wall'], ['unistrut', 'On unistrut']]));
    h += F('Outdoor', chk('node', 'outdoor', n.outdoor));
    h += '<p class="note"><b>' + esc(sp.text) + '</b></p>';
    sp.warn.forEach(w => { h += '<p class="note bad">' + esc(w) + '</p>'; });
    if (sp.circuit) h += '<p class="note">On <a href="#" data-goto="circ:' + sp.circuit + '">' + esc((circById(sp.circuit) || {}).ref) + '</a>. Rated at least the protective device, AC-23A for motors.</p>';
  } else if (n.kind === 'device') {
    h += hd('Field device', n.name) + '<div class="insp-bd">' + common;
    h += F('Kind', sel('node', 'devKind', n.devKind || 'Sensor', DEVICE_KINDS.map(d => [d, d])));
    h += F('Outdoor', chk('node', 'outdoor', n.outdoor));
  } else if (n.kind === 'riser') {
    const rs = A.risers && A.risers.get((n.riser || '').toUpperCase());
    h += hd('Riser', n.name) + '<div class="insp-bd">' + common;
    h += F('Riser name', inp('node', 'riser', n.riser));
    h += F('Containment', sel('node', 'riserType', n.riserType || 'tray', ['tray', 'ladder', 'basket', 'trunking'].map(t => [t, E.CONTAINMENT[t].label])));
    h += F('Ambient', num('node', 'amb', n.amb, '°C', 'placeholder="' + P.settings.ambient + '"'));
    h += '<p class="note">Place a riser with the same name on each floor\'s sheet, and run containment into it. The vertical between floors is measured from the sheet levels and these heights.</p>';
    if (rs) h += '<table class="kv"><tr><td>Vertical length</td><td>' + fmt(rs.len, 2) + ' m</td></tr><tr><td>Size</td><td>' + esc(rs.size) + '</td></tr><tr><td>Cables</td><td>' + rs.cables + '</td></tr></table>';
  }
  h += '<div class="insp-actions"><button class="btn danger sm" data-act="delete">Delete</button></div></div>';
  return h;
}

function routeForm(r) {
  const res = A.routes.get(r.id) || {};
  const def = E.CONTAINMENT[r.type] || E.CONTAINMENT.tray;
  const lens = C.routeLengths(A, r.id);
  const fit = C.routeFittings(P, A).get(r.id) || {};
  let h = hd(def.label, r.name || r.id) + '<div class="insp-bd">';
  h += F('Name', inp('route', 'name', r.name));
  h += F('Type', sel('route', 'type', r.type, Object.keys(E.CONTAINMENT).map(k => [k, E.CONTAINMENT[k].label])));
  h += F('Duty', sel('route', 'duty', r.duty || def.defaultDuty, Object.keys(def.duties).map(k => [k, def.duties[k]])));
  if (r.type !== 'pvctrunking' && r.type !== 'pvcconduit' && r.type !== 'cleats') h += F('Finish', sel('route', 'finish', r.finish || P.settings.defFinish, Object.keys(E.FINISHES).filter(k => k !== 'pvc').map(k => [k, E.FINISHES[k]])));
  if (def.fill === 'width') h += F('Width', sel('route', 'width', r.width || '', [['', 'Auto (' + (res.auto ? res.auto + ' mm' : 'too wide') + ')']].concat(def.widths.map(w => [w, w + ' mm']))));
  if (def.fill === 'area') h += F('Size', sel('route', 'width', r.width || '', [['', 'Auto (' + (res.auto ? res.auto.join('×') : 'oversize') + ')']].concat(def.sizes.map(s => [s.join('x'), s.join(' × ') + ' mm']))));
  if (def.fill === 'conduit') h += F('Bore', sel('route', 'width', r.width || '', [['', 'Auto (' + (res.auto ? res.auto + ' mm' : 'oversize') + ')']].concat(def.bores.map(b => [b, b + ' mm']))));
  if (def.fill === 'width') {
    h += F('Cables lie', sel('route', 'layout', r.layout || 'touching', [['touching', 'Touching, single layer'], ['spaced', 'Spaced (2 × diameter)']]));
    h += F('Tray lies', sel('route', 'orient', r.orient || 'flat', [['flat', 'Flat (horizontal)'], ['wall', 'On edge against a wall']]));
    if (r.orient === 'wall') h += F('Wall side', sel('route', 'side', r.side || 1, [[1, 'Left of the trace direction'], [-1, 'Right of the trace direction']]));
  }
  if (def.fill === 'conduit') h += F('In an insulated wall', chk('route', 'inWall', r.inWall));
  h += '<h4>Fixing</h4>';
  h += F('Method', sel('route', 'mount', r.mount || defaultMount(r.type), Object.keys(E.MOUNTS).map(k => [k, E.MOUNTS[k]])));
  if (r.mount === 'droprod' || r.mount === 'beamclamp' || (!r.mount && defaultMount(r.type) === 'droprod')) h += F('Soffit height', num('route', 'soffit', r.soffit, 'm', 'placeholder="' + P.settings.soffit + '"'));
  h += F('Support spacing', num('route', 'spacing', r.spacing, 'm', 'placeholder="' + (P.settings.spacing[r.type] || 1.5) + '"'));
  h += F('Ambient', num('route', 'amb', r.amb, '°C', 'placeholder="' + P.settings.ambient + '"'));
  h += '<h4>Fill</h4><table class="kv">'
    + '<tr><td>Length (plan + vertical)</td><td>' + fmt(lens.plan, 2) + ' + ' + fmt(lens.vert, 2) + ' m</td></tr>'
    + '<tr><td>Cables on the fullest section</td><td>' + (res.cables || 0) + '</td></tr>'
    + '<tr><td>Circuits on the run</td><td>' + (res.nCircuits || 0) + '</td></tr>'
    + '<tr><td>Most power circuits side by side (Cg)</td><td>' + (res.maxGrouped || 0) + (res.maxGrouped > 1 ? ' → ' + E.cgFor(r.layout === 'spaced' ? 'spaced' : ((E.CONTAINMENT_METHOD[(E.CONTAINMENT[r.type] || {}).methodKey || r.type] || {}).arr || 'tray'), res.maxGrouped).toFixed(2) : '') + '</td></tr>'
    + (res.mixed ? '<tr><td>Power / control segregation</td><td>' + (res.seg === 'divider' ? 'divider' + (res.sepMm ? ' (' + res.sepMm + ' mm)' : '') : res.seg === 'gap' ? res.sepMm + ' mm gap' : (E.CONTAINMENT[r.type].fill === 'area' ? 'compartment' : 'separate runs')) + '</td></tr>' : '')
    + '<tr><td>Sum of diameters</td><td>' + fmt(res.sumOd, 1) + ' mm</td></tr>'
    + (def.fill === 'width' ? '<tr><td>Needed with ' + P.settings.spare + ' % spare</td><td>' + fmt(res.reqMm, 0) + ' mm</td></tr>' : '')
    + '<tr><td>Selected</td><td>' + esc(res.size || '—') + '</td></tr>'
    + '<tr><td>Fill</td><td style="color:' + (res.ok ? 'inherit' : 'var(--alarm)') + '">' + (res.fillPct != null ? fmt(res.fillPct, 0) + ' %' : '—') + '</td></tr>'
    + '</table>';
  if (res.bendWarn) h += '<p class="note warn">Largest cable ' + fmt(res.maxOd, 1) + ' mm needs about ' + Math.round(res.bendR) + ' mm internal bend radius — more than a standard ' + (P.settings.trayBendR || 150) + ' mm bend. Use cable ladder with large-radius bends.</p>';
  if (res.ok === false) h += '<p class="note bad">Over-full. Go up a size, split the run, or move circuits to another route.</p>';
  else if (res.okSpare === false) h += '<p class="note warn">Fits, but without the ' + P.settings.spare + ' % spare.</p>';
  const fitTxt = Object.keys(fit).filter(k => fit[k]).map(k => fit[k] + ' × ' + ((C.FITTING_NAMES[r.type] || {})[k] || k)).join(', ');
  if (fitTxt) h += '<p class="note">Fittings: ' + esc(fitTxt) + '</p>';
  // circuits on it
  if (res.circuits && res.circuits.size) h += '<p class="note">Carries ' + [...res.circuits].map(cid => { const c = circById(cid); return c ? '<a href="#" data-goto="circ:' + c.id + '">' + esc(c.ref) + '</a>' : ''; }).join(', ') + '</p>';
  // points
  const pts = routePts(r);
  h += '<h4>Heights point by point</h4><table class="pts">' + pts.map((q, i) => '<tr' + (V.sel.pt === i ? ' style="background:#fdf6e6"' : '') + '><td class="mono" style="color:var(--muted)">' + (i + 1) + '</td><td><input data-o="pt" data-i="' + i + '" data-k="h" data-ty="num" type="number" step="0.05" value="' + fmt(r.pts[i].h, 2) + '"> m</td><td style="font-size:11px;color:var(--muted)">' + (r.pts[i].link ? (r.pts[i].link.startsWith('n:') ? 'riser' : 'joint') : '') + '</td></tr>').join('') + '</table>';
  h += '<div class="insp-actions"><input id="lvlAll" type="number" step="0.1" value="' + fmt(pts[0] ? pts[0].h : P.settings.containHeight, 2) + '" style="width:80px;padding:5px;border:1px solid var(--rule-2);border-radius:3px"> <button class="btn ghost sm" data-act="levelAll">Set all to this height</button></div>';
  h += '<div class="insp-actions"><button class="btn ghost sm" data-act="reverse">Reverse</button>' + (V.sel.pt != null && r.pts.length > 2 ? '<button class="btn danger sm" data-act="delete">Delete point ' + (V.sel.pt + 1) + '</button>' : '') + '<button class="btn danger sm" data-act="deleteRoute">Delete run</button></div>';
  h += '</div>';
  return h;
}

function circForm(c) {
  const r = A.results.get(c.id) || { legs: [], checks: [] };
  const b = nodeById(c.board), iso = nodeById(c.iso), t = nodeById(c.target);
  const kindLabel = c.kind === 'submain' ? 'Sub-main' : c.kind === 'control' ? ((c.ctrl && c.ctrl.signal) ? 'Data / signal' : 'Control') : 'Power circuit';
  let h = hd(kindLabel, (c.ref || '') + (t ? ' — ' + t.name : ''));
  h += '<div class="insp-bd">';
  h += '<p class="note">' + (b ? '<a href="#" data-goto="node:' + b.id + '">' + esc(b.name) + '</a>' : '<span class="bad">no board</span>') + (iso ? ' → <a href="#" data-goto="node:' + iso.id + '">' + esc(iso.name) + '</a>' : '') + ' → ' + (t ? '<a href="#" data-goto="node:' + t.id + '">' + esc(t.name) + '</a>' : '<span style="color:var(--alarm)">no load yet</span>') + '</p>';
  h += F('Reference', inp('circ', 'ref', c.ref, 'text', 'data-ref="1"'));
  if (c.kind !== 'control') {
    const dev = C.deviceFor(c, P, A.ix);
    const fam = E.DEVICES[dev.family];
    h += '<h4>Protective device</h4>';
    h += F('Device', sel('dev', 'family', dev.family, Object.keys(E.DEVICES).map(k => [k, E.DEVICES[k].label])));
    if (dev.family === 'mcb') h += F('Curve', sel('dev', 'curve', dev.curve, [['B', 'Type B'], ['C', 'Type C'], ['D', 'Type D']]));
    h += F('Rating', sel('dev', 'rating', (c.device && c.device.rating) || '', [['', 'Auto (' + (r.autoIn || '?') + ' A)']].concat(fam.ratings.map(x => [x, x + ' A']))));
    h += F('Breaking capacity', sel('dev', 'kA', dev.kA, fam.kA.map(x => [x, x + ' kA'])));
    if (dev.family === 'mccb') h += F('Magnetic setting Im', num('dev', 'im', dev.im, '× In'));
    h += F('RCD', sel('dev', 'rcd', (c.device && c.device.rcd) || 0, [[0, 'None'], [30, '30 mA'], [100, '100 mA'], [300, '300 mA']]));
    if (c.kind === 'power' && t && E.LOAD_KINDS[t.loadKind] && E.LOAD_KINDS[t.loadKind].motor) h += F('Overload at starter', chk('circ', 'overloadAtStarter', c.overloadAtStarter));
    // headline
    h += '<div class="legbox ' + (r.ok ? '' : 'bad') + '"><div class="big">' + esc(r.deviceText || '—') + '</div>'
      + '<table class="kv"><tr><td>Design current Ib</td><td>' + fmt(r.ib, 2) + ' A</td></tr>'
      + (r.start && r.start > r.ib ? '<tr><td>Starting / peak</td><td>' + fmt(r.start, 0) + ' A</td></tr>' : '')
      + '<tr><td>Iz needed (≥ ' + (r.izNeed === r.In ? 'In' : 'Ib') + ')</td><td>' + fmt(r.izNeed, 1) + ' A</td></tr>'
      + '<tr><td>Total volt drop</td><td>' + fmt(r.vdPct, 2) + ' % · ' + fmt(r.vdV, 2) + ' V</td></tr>'
      + '<tr><td>Zs / max</td><td>' + fmt(r.zs, 3) + ' / ' + fmt(r.zmax, 3) + ' Ω</td></tr>'
      + '<tr><td>Disconnection</td><td>' + (r.tReq || '—') + ' s</td></tr>'
      + '</table></div>';
  } else {
    h += '<h4>Control supply</h4>';
    h += F('Signal / data only', chk('ctrl', 'signal', c.ctrl && c.ctrl.signal));
    if (!(c.ctrl && c.ctrl.signal)) {
      h += F('Voltage', sel('ctrl', 'volts', (c.ctrl && c.ctrl.volts) || 24, [[24, '24 V'], [12, '12 V'], [48, '48 V'], [110, '110 V'], [230, '230 V']]));
      h += F('Load', num('ctrl', 'va', c.ctrl && c.ctrl.va, 'VA'));
    }
  }
  h += '<h4>Checks</h4>' + checksHtml(r.checks);
  (r.legs || []).forEach((lr, i) => { h += legBox(c, lr, (r.paths || [])[i]); });
  h += '<div class="insp-actions"><button class="btn danger sm" data-act="delete">Delete circuit</button></div>';
  h += '</div>';
  return h;
}
function legBox(c, lr, lp) {
  const role = lr.role;
  const leg = (c.legs && c.legs[role]) || {};
  const t = E.CABLE_TYPES[lr.type];
  const bad = (lr.warnings && lr.warnings.length) || (lr.step < 0);
  const typeOpts = Object.keys(E.CABLE_TYPES).filter(k => c.kind === 'control' ? true : E.CABLE_TYPES[k].use === 'power').map(k => [k, E.CABLE_TYPES[k].label]);
  let h = '<div class="legbox ' + (lr.warnings && lr.warnings.length ? 'bad' : '') + '">';
  h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><b style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">' + (role === 'tail' ? 'Tail — isolator to load' : (c.iso ? 'Supply — board to isolator' : 'Cable')) + '</b></div>';
  h += '<div class="big"><span class="' + (bad ? 'bad' : '') + '">' + (lr.cores ? lr.cores + (t && t.coreWord === 'pair' ? 'pr' : 'c') + ' ' : '') + (lr.size != null ? lr.size + ' mm²' : '') + '</span><span style="font-size:12px;font-weight:600">' + esc(lr.short || '') + '</span>'
    + '<span class="stepper"><button data-act="step" data-role="' + role + '" data-d="-1" title="Downsize">−</button><span>' + (lr.step ? (lr.step > 0 ? '+' : '') + lr.step + ' from auto ' + lr.autoSize : 'auto') + '</span><button data-act="step" data-role="' + role + '" data-d="1" title="Upsize">+</button></span></div>';
  if (lr.step) h += '<p class="note ' + (lr.warnings.length ? 'bad' : 'warn') + '">' + (lr.step > 0 ? 'Upsized' : 'Downsized') + ' from the automatic ' + lr.autoSize + ' mm².' + (lr.warnings.length ? ' Not compliant — see the red checks.' : '') + '</p>';
  h += F('Cable type', sel('leg', 'type', leg.type || '', [['', 'Default (' + (E.CABLE_TYPES[C.legType(Object.assign({}, c, { legs: Object.assign({}, c.legs, { [role]: {} }) }), role, P, A.ix)] || {}).label + ')']].concat(typeOpts), 'data-role="' + role + '"'));
  if (t && t.cpcModes.length > 1) h += F('CPC', sel('leg', 'cpc', leg.cpc || t.defaultCpc, t.cpcModes.map(m => [m, m === 'armour' ? 'Armour as CPC' : m === 'core' ? 'Core in the cable' : m]), 'data-role="' + role + '"'));
  if (t && t.cores.length > 1) h += F('Cores', sel('leg', 'cores', leg.cores || '', [['', 'Auto (' + lr.cores + ')']].concat(t.cores.map(n => [n, n + (t.coreWord === 'pair' ? ' pair' : ' core')])), 'data-role="' + role + '"'));
  if (lr.iz != null) {
    h += '<table class="kv">'
      + '<tr><td>Tabulated It (' + esc(lr.table) + ', method ' + esc(lr.method) + ')</td><td>' + fmt(lr.it, 1) + ' A</td></tr>'
      + '<tr><td>Ca × Cg × Ci</td><td>' + fmt(lr.ca, 2) + ' × ' + fmt(lr.cg, 2) + ' × ' + fmt(lr.ci, 2) + '</td></tr>'
      + '<tr><td>Iz</td><td>' + fmt(lr.iz, 1) + ' A</td></tr>'
      + (lr.govCond ? '<tr><td>Governed by</td><td>' + esc(lr.govCond.where) + (lr.govCond.n > 1 ? ', ' + lr.govCond.n + ' circuits' : '') + '</td></tr>' : '')
      + '<tr><td>mV/A/m</td><td>' + fmt(lr.mv, 2) + '</td></tr>'
      + '<tr><td>Volt drop</td><td>' + fmt(lr.vdV, 2) + ' V · ' + fmt(lr.vdPct, 2) + ' %</td></tr>'
      + (lr.cpcArea ? '<tr><td>CPC</td><td>' + lr.cpcArea + ' mm²' + (lr.cpcMin ? ' (min ' + fmt(lr.cpcMin, 2) + ')' : '') + '</td></tr>' : '')
      + '<tr><td>R1 + R2</td><td>' + fmt(lr.r12, 3) + ' Ω</td></tr>'
      + '</table>';
  } else if (lr.vdPct != null) {
    h += '<table class="kv"><tr><td>Loop volt drop</td><td>' + fmt(lr.vdV, 2) + ' V · ' + fmt(lr.vdPct, 1) + ' %</td></tr></table>';
  }
  (lr.notes || []).forEach(n => { h += '<p class="note">' + esc(n) + '</p>'; });
  if (t && t.note) h += '<p class="note">' + esc(t.note) + '</p>';
  h += '<table class="kv"><tr><td>Overall diameter</td><td>' + fmt(lr.od, 1) + ' mm</td></tr>'
    + (lp ? '<tr><td>Route (incl. drops and risers)</td><td>' + fmt(lp.routeLen, 2) + ' m</td></tr><tr><td>Terminations + extra</td><td>' + fmt(lp.allow + lp.extra, 2) + ' m</td></tr><tr><td><b>Cable length</b></td><td><b>' + fmt(lp.lengthM, 2) + ' m</b></td></tr>' : '')
    + '</table>';
  h += F('Extra length', num('leg', 'extra', leg.extra, 'm', 'data-role="' + role + '" placeholder="0"'));
  h += F('Off containment', sel('leg', 'freeMethod', leg.freeMethod || '', [['', 'Default (' + P.settings.freeMethod + ')'], ['C', 'C — clipped direct'], ['B', 'B — conduit / trunking'], ['A', 'A — conduit in insulated wall'], ['E', 'E — free air'], ['D', 'D — duct in ground']], 'data-role="' + role + '"'));
  h += F('Thermal insulation', sel('leg', 'ci', leg.ci || 'none', Object.keys(E.CI).map(k => [k, E.CI_LABEL[k] + (k === 'none' ? '' : ' (' + E.CI[k] + ')')]), 'data-role="' + role + '"'));
  if (role === 'tail' && t && !t.armoured) h += F('In flexible conduit', sel('leg', 'flex', leg.flex == null ? '' : String(leg.flex), [['', 'Default (' + (P.settings.tailFlex ? 'yes' : 'no') + ')'], ['true', 'Yes'], ['false', 'No']], 'data-role="' + role + '"'));
  if (t && t.armoured) h += F('Glands', sel('leg', 'gland', leg.gland || 'auto', [['auto', 'Auto (indoor ' + (P.settings.cwIndoors ? 'CW' : P.settings.glandIndoor) + ' / outdoor ' + P.settings.glandOutdoor + ')'], ['BW', 'BW'], ['CW', 'CW'], ['CXT', 'CXT'], ['EMC', 'EMC']], 'data-role="' + role + '"'));
  h += F('Diameter override', num('leg', 'od', leg.od, 'mm', 'data-role="' + role + '" placeholder="' + fmt(lr.od, 1) + '"'));
  if (lp) h += '<p class="note">' + (lp.auto ? 'Routed automatically through the containment.' : (leg.way && leg.way.length ? 'Follows the route you traced.' : 'Straight between the ends — no containment.')) + (lp.broken ? ' <span style="color:var(--alarm)">The route has a gap.</span>' : '') + '</p>';
  h += '<div class="insp-actions"><button class="btn ghost xs" data-act="autoroute" data-role="' + role + '">Route via containment</button><button class="btn ghost xs" data-act="direct" data-role="' + role + '">Direct (no containment)</button></div>';
  h += '</div>';
  return h;
}

function onInspectorChange(ev) {
  const t = ev.target;
  const o = t.dataset.o;
  if (!o) return;
  const k = t.dataset.k;
  const ty = t.dataset.ty;
  let v;
  if (ty === 'chk') v = t.checked;
  else if (ty === 'num') v = t.value === '' ? null : Number(t.value);
  else v = t.value;
  if (ty === 'sel') {
    if (v === '' || v === 'auto') v = null;
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (/^-?\d+(\.\d+)?$/.test(v) && k !== 'ref') v = Number(v);
  }
  const s = V.sel;
  const obj = selObject();
  if (!obj) return;
  if (o === 'multi') { applyMulti(k, v); return; }
  pushUndo();
  if (o === 'node' || o === 'route' || o === 'circ') {
    if (v == null) delete obj[k]; else obj[k] = v;
    if (o === 'circ' && k === 'ref') obj.refAuto = false;
    if (o === 'node' && k === 'riser') obj.name = 'Riser ' + v;
    if (o === 'route' && k === 'type') { obj.width = null; obj.duty = E.CONTAINMENT[v].defaultDuty; obj.mount = defaultMount(v); }
  } else if (o === 'pt') {
    const i = Number(t.dataset.i);
    if (obj.pts[i]) obj.pts[i].h = v == null ? 0 : v;
  } else if (o === 'dev') {
    obj.device = obj.device || {};
    if (v == null) delete obj.device[k]; else obj.device[k] = v;
    if (k === 'family') { delete obj.device.rating; delete obj.device.kA; delete obj.device.curve; }
  } else if (o === 'ctrl') {
    obj.ctrl = obj.ctrl || {};
    obj.ctrl[k] = v;
  } else if (o === 'leg') {
    const role = t.dataset.role || 'main';
    obj.legs[role] = obj.legs[role] || {};
    if (v == null) delete obj.legs[role][k]; else obj.legs[role][k] = v;
    if (k === 'type') { delete obj.legs[role].cores; delete obj.legs[role].cpc; obj.legs[role].step = 0; }
  }
  changed();
}
function onInspectorClick(ev) {
  const a = ev.target.closest('[data-act],[data-goto]');
  if (!a) return;
  ev.preventDefault();
  if (a.dataset.goto) {
    const [kind, id] = a.dataset.goto.split(':');
    goTo(kind, id);
    return;
  }
  const act = a.dataset.act;
  const o = selObject();
  if (act === 'close') { select(null); return; }
  if (act === 'done') { select(null); toast('Changes applied'); return; }
  if (act === 'dup') {
    if (V.sel && V.sel.kind === 'circ') {
      // a cable is duplicated with the load (and isolator) it feeds
      const c = circById(V.sel.id);
      const m = emptyMulti();
      [c && c.iso, c && c.target].filter(Boolean).forEach(id => m.nodes.push(id));
      if (!m.nodes.length) { toast('Nothing to duplicate on this cable'); return; }
      V.sel = m;
    }
    duplicateSelection(); return;
  }
  if (act === 'copy') { copySelection(); return; }
  if (act === 'delete') { deleteSelected(); return; }
  if (act === 'deleteRoute') { V.sel = { kind: 'route', id: V.sel.id }; deleteSelected(); return; }
  if (act === 'step') {
    const role = a.dataset.role;
    pushUndo();
    o.legs[role] = o.legs[role] || {};
    o.legs[role].step = (Number(o.legs[role].step) || 0) + Number(a.dataset.d);
    changed(); return;
  }
  if (act === 'autoroute' || act === 'direct') {
    const role = a.dataset.role;
    pushUndo();
    o.legs[role] = o.legs[role] || {};
    o.legs[role].way = [];
    o.legs[role].direct = act === 'direct';
    if (act === 'autoroute' && role === 'tail') {
      // tails route through the containment only when traced; take the nearest points
      const res = A.results.get(o.id);
      const lp = res && res.paths && res.paths.find(x => x.role === role);
      if (lp) {
        const a1 = nodeById(lp.from), b1 = nodeById(lp.to);
        const k1 = C.nearestGraphNode(A.G, a1.sheet, a1.x, a1.y), k2 = C.nearestGraphNode(A.G, b1.sheet, b1.x, b1.y);
        if (k1 && k2) o.legs[role].way = [k1, k2].map(k => k.startsWith('p:') ? { p: k.slice(2) } : { r: k.slice(2) });
      }
    }
    changed(); return;
  }
  if (act === 'levelAll') {
    const hv = Number(el('lvlAll').value);
    if (!isFinite(hv)) return;
    pushUndo();
    o.pts.forEach(p => { p.h = hv; });
    changed(); return;
  }
  if (act === 'reverse') { pushUndo(); o.pts.reverse(); changed(); return; }
}
function goTo(kind, id) {
  const obj = kind === 'node' ? nodeById(id) : kind === 'circ' ? circById(id) : kind === 'route' ? routeById(id) : null;
  if (!obj) return;
  let sh = obj.sheet;
  if (kind === 'circ') { const n = nodeById(obj.board) || nodeById(obj.target) || nodeById(obj.iso); sh = n && n.sheet; }
  if (sh && sh !== P.active) { P.active = sh; showSheet(); }
  select(kind, id);
  // bring it into view
  let pt = null;
  if (kind === 'node') pt = obj;
  else if (kind === 'route') pt = routePts(obj)[0];
  else { const n = nodeById(obj.target) || nodeById(obj.iso) || nodeById(obj.board); pt = n; }
  if (pt) {
    const sc = el('scroller');
    sc.scrollLeft = pt.x * V.zoom - sc.clientWidth / 2;
    sc.scrollTop = pt.y * V.zoom - sc.clientHeight / 2;
  }
}

// ------------------------------------------------------------------
// modal
// ------------------------------------------------------------------
let modalActions = [];
function modal(title, html, actions, wide) {
  const m = el('modal');
  m.classList.toggle('wide', !!wide);
  modalActions = actions || [['Close', () => true, 'go']];
  m.innerHTML = '<div class="modal-hd"><h2>' + esc(title) + '</h2><button class="btn ghost sm" data-mx="x">✕</button></div><div class="modal-bd">' + html + '</div><div class="modal-ft">' + modalActions.map((a, i) => '<button class="btn sm ' + (a[2] || '') + '" data-mi="' + i + '">' + esc(a[0]) + '</button>').join('') + '</div>';
  el('modalBg').classList.add('on');
}
function closeModal() { el('modalBg').classList.remove('on'); }

// ------------------------------------------------------------------
// project & basis
// ------------------------------------------------------------------
function basisDialog() {
  const s = P.settings;
  const S = (k, val, unit, step) => '<div class="unit"><input data-s="' + k + '" type="number" step="' + (step || 'any') + '" value="' + esc(val) + '">' + (unit ? '<span>' + unit + '</span>' : '') + '</div>';
  const Sel = (k, val, opts) => '<select data-s="' + k + '">' + opts.map(x => opt(x[0], x[1], val)).join('') + '</select>';
  const Chk = (k, val) => '<input type="checkbox" data-s="' + k + '"' + (val ? ' checked' : '') + '>';
  const powerTypes = Object.keys(E.CABLE_TYPES).filter(k => E.CABLE_TYPES[k].use === 'power').map(k => [k, E.CABLE_TYPES[k].label]);
  let h = '<div class="grid2"><div>';
  h += '<h4>Project</h4>' + F('Project name', '<input data-p="name" value="' + esc(P.name) + '">') + F('Reference', '<input data-p="ref" value="' + esc(P.ref) + '">') + F('Client', '<input data-p="client" value="' + esc(P.client) + '">');
  h += '<h4>Supply</h4>';
  h += F('Earthing', Sel('earthing', s.earthing, [['TN-S', 'TN-S (separate earth — default for industrial)'], ['TN-C-S', 'TN-C-S (PME)'], ['TT', 'TT (earth electrode, RCD protection)']]));
  h += F('Ze at the origin', S('ze', s.ze, 'Ω'));
  h += F('Default Zdb at a board', S('zdbDefault', s.zdbDefault, 'Ω'));
  h += F('Default fault level', S('pfcDefault', s.pfcDefault, 'kA'));
  h += F('Ambient', S('ambient', s.ambient, '°C'));
  h += '<h4>Volt drop limits (Appendix 4, 6.4)</h4>';
  h += F('Lighting', S('vdLighting', s.vdLighting, '%')) + F('Other uses', S('vdOther', s.vdOther, '%')) + F('Motor starting', S('vdStart', s.vdStart, '%')) + F('Control (24 V etc.)', S('vdControl', s.vdControl, '%'));
  h += F('0.4 s final circuits up to', S('maxFinalA', s.maxFinalA, 'A'));
  h += F('Minimum power conductor', S('minPower', s.minPower, 'mm² (Table 52.3)'));
  h += F('Minimum control conductor', S('minControl', s.minControl, 'mm²'));
  h += '<h4>Protective devices</h4>';
  h += F('Default device', Sel('defFamily', s.defFamily, Object.keys(E.DEVICES).map(k => [k, E.DEVICES[k].label])));
  h += F('Default MCB curve', Sel('defCurve', s.defCurve, [['B', 'Type B'], ['C', 'Type C'], ['D', 'Type D']]));
  h += F('DOL / star-delta motors', Sel('motorCurve', s.motorCurve, [['C', 'Type C'], ['D', 'Type D']]));
  h += F('MCB breaking capacity', Sel('defKA', s.defKA, [[6, '6 kA'], [10, '10 kA'], [15, '15 kA'], [25, '25 kA']]));
  h += '</div><div>';
  h += '<h4>Cables</h4>';
  h += F('Power cable', Sel('defPower', s.defPower, powerTypes));
  h += F('Isolator → load tails', Sel('defTail', s.defTail, powerTypes));
  h += F('Tails in flexible conduit', Chk('tailFlex', s.tailFlex));
  h += F('Control cable', Sel('defControl', s.defControl, Object.keys(E.CABLE_TYPES).filter(k => E.CABLE_TYPES[k].use === 'control' || E.CABLE_TYPES[k].control).map(k => [k, E.CABLE_TYPES[k].label])));
  h += F('Data / signal cable', Sel('defSignal', s.defSignal, Object.keys(E.CABLE_TYPES).filter(k => E.CABLE_TYPES[k].use === 'signal').map(k => [k, E.CABLE_TYPES[k].label])));
  h += F('Off-containment method', Sel('freeMethod', s.freeMethod, [['C', 'C — clipped direct'], ['B', 'B — conduit / trunking'], ['E', 'E — free air']]));
  h += F('Termination allowance', S('termAllow', s.termAllow, 'm each end'));
  h += F('Cable wastage', S('wasteCable', s.wasteCable, '%'));
  h += F('Route new cables automatically', Chk('autoRoute', s.autoRoute));
  h += F('…joining containment within', S('autoHopM', s.autoHopM, 'm of the equipment'));
  h += '<h4>Glands</h4>';
  h += F('Indoor (armoured)', Sel('glandIndoor', s.glandIndoor, [['BW', 'BW'], ['CW', 'CW']]));
  h += F('Outdoor (armoured)', Sel('glandOutdoor', s.glandOutdoor, [['CW', 'CW'], ['CXT', 'CXT']]));
  h += F('Use CW glands indoors too', Chk('cwIndoors', s.cwIndoors));
  h += F('Shrouds', Chk('shrouds', s.shrouds)) + F('Earth tags', Chk('earthTags', s.earthTags));
  h += '<h4>Isolators</h4>';
  h += F('Enclosure', Sel('isoEnclosure', s.isoEnclosure, Object.keys(E.ISOLATOR_ENCLOSURES).map(k => [k, E.ISOLATOR_ENCLOSURES[k]])));
  h += F('IP rating', Sel('isoIP', s.isoIP, E.ISOLATOR_IP.map(x => [x, x])));
  h += F('Stainless 316 outdoors', Chk('stainlessOutdoor', s.stainlessOutdoor));
  h += '</div><div>';
  h += '<h4>Containment</h4>';
  h += F('Spare on cable widths', S('spare', s.spare, '%'));
  h += F('Trunking space factor', S('spaceTrunking', s.spaceTrunking, '%'));
  h += F('Conduit space factor', S('spaceConduit', s.spaceConduit, '%'));
  h += F('Standard tray bend radius', S('trayBendR', s.trayBendR, 'mm (above this → ladder)'));
  h += F('Power / data segregation', Sel('segMethod', s.segMethod, [['divider', 'Divider in the tray (BS EN 50174-2)'], ['gap', 'Clear gap, no divider'], ['separate', 'Separate containment — flag shared runs']]));
  h += F('Divider allowance', S('segDividerMm', s.segDividerMm, 'mm of width'));
  h += F('Clear gap', S('segGapMm', s.segGapMm, 'mm, when no divider'));
  h += F('Default finish', Sel('defFinish', s.defFinish, Object.keys(E.FINISHES).filter(k => k !== 'pvc').map(k => [k, E.FINISHES[k]])));
  h += F('Default fixing', Sel('defMount', s.defMount, Object.keys(E.MOUNTS).map(k => [k, E.MOUNTS[k]])));
  h += F('Containment wastage', S('wasteContain', s.wasteContain, '%'));
  h += '<h4>Support spacing</h4>';
  Object.keys(E.SUPPORT_SPACING).forEach(k => { h += F(E.CONTAINMENT[k].label, '<div class="unit"><input data-sp="' + k + '" type="number" step="0.05" value="' + (s.spacing[k] || '') + '"><span>m</span></div>'); });
  h += '<h4>Default heights</h4>';
  h += F('Containment', S('containHeight', s.containHeight, 'm')) + F('Soffit / slab', S('soffit', s.soffit, 'm')) + F('Boards', S('boardH', s.boardH, 'm')) + F('Isolators', S('isolatorH', s.isolatorH, 'm')) + F('Loads', S('loadH', s.loadH, 'm')) + F('Devices', S('deviceH', s.deviceH, 'm'));
  h += '</div></div>';
  h += '<h4>Basis of the sizing</h4><ul class="basis">'
    + '<li>BS 7671:2018+A2:2022 incorporating A3:2024 (18th Edition). Current ratings and mV/A/m from Appendix 4: 4D1A/B singles, 4D2A/B multicore, 4D4A/B PVC SWA, 4D5 twin &amp; earth, 4E4A/B XLPE SWA, 4F3A/B flexible cords.</li>'
    + '<li>Iz = It × Ca (Table 4B1) × Cg (Table 4C1, from the circuits that actually share each piece of containment) × Ci (Table 52.2). The worst piece of the route governs. Iz ≥ In, or Iz ≥ Ib where overload protection is at the starter.</li>'
    + '<li>Volt drop from the tabulated mV/A/m (impedance values at maximum conductor temperature, so conservative), added to the drop upstream of the board.</li>'
    + '<li>Zs = Zdb + (R1 + R2) × length at operating temperature (×1.20 for 70 °C, ×1.28 for 90 °C, steel armour ×1.18), against Tables 41.2–41.4 with Cmin 0.95. 0.4 s for final circuits up to ' + s.maxFinalA + ' A on TN, 5 s for distribution circuits.</li>'
    + '<li>CPC adiabatic check S ≥ √(I²t)/k (543.1.3) with k from Tables 54.3 / 54.4; MCB and MCCB instantaneous trips taken at 0.1 s.</li>'
    + '<li>Breaking capacity against the fault level at the board (434.5.1). TT: RCD and Table 41.5.</li>'
    + '<li>Grouping (Cg) counts the power circuits actually lying together at the fullest point of each stretch a cable rides — a cable that has left the tray no longer derates the others. Control and data cables (Band I) are not counted.</li>'
    + '<li>Band I (ELV control, data) and Band II (LV power) on one run are segregated (528.1, BS EN 50174-2): a divider, a clear gap or separate runs in tray, ladder and basket; a compartment in trunking; never the same conduit.</li>'
    + '<li>Containment: tray, ladder and basket from the sum of overall diameters plus the spare above; trunking to the space factor (On-Site Guide, 45 %); conduit to its space factor.</li>'
    + '<li>Cable diameters, armour resistance and area, and gland ranges are typical UK catalogue figures (Prysmian / Doncaster / CMP). Check the supplier\'s sheet for a tight tray or a gland order.</li>'
    + '<li>This is a design aid. A competent designer must check the result before it is issued.</li></ul>';
  modal('Project & basis', h, [['Done', () => true, 'go']], true);
  const bd = el('modal');
  bd.addEventListener('change', settingsChange);
}
function settingsChange(ev) {
  const t = ev.target;
  if (!t.dataset.s && !t.dataset.sp && !t.dataset.p) return;
  pushUndo();
  if (t.dataset.p) { P[t.dataset.p] = t.value; changed(); return; }
  if (t.dataset.sp) { P.settings.spacing[t.dataset.sp] = Number(t.value) || E.SUPPORT_SPACING[t.dataset.sp]; changed(); return; }
  const k = t.dataset.s;
  let v = t.type === 'checkbox' ? t.checked : t.value;
  if (t.type === 'number') v = Number(v);
  if (k === 'defKA') v = Number(v);
  P.settings[k] = v;
  changed();
}

// ------------------------------------------------------------------
// help
// ------------------------------------------------------------------
const STEPS = [
  ['Open the drawing', 'A PDF or an image. Several pages each become a sheet; give each sheet its floor level. Or start on a grid at 1 m squares.'],
  ['Set the scale', 'S, then click both ends of a dimension you know and type its length. For a PDF you can type the drawing scale instead.'],
  ['Place the equipment', 'B for boards (DB, consumer unit, MCC, BMS or control panel), L for loads (motors, pumps, fans, AHUs…), I for local isolators, D for field devices.'],
  ['Enter the loads', 'Click a load: kW (as the manufacturer gives it), single or three phase, power factor, and the maximum current if you have it. Motors take DOL, star-delta, soft start or VSD.'],
  ['Trace the containment', 'T. Pick tray, ladder, basket, trunking or conduit and the fixing. Type the height before each click; click the last point again at a new height for a vertical riser. Start or end on another run to tee in.'],
  ['Trace the cables', 'C. Click the board, then along the containment, then the isolator; then isolator to load for the tail. Board straight to a load routes itself through the containment.'],
  ['Read the result', 'Click a cable: device, cable size, Iz, volt drop, Zs and the CPC check. − and + step the size; anything that no longer complies goes red but stays.'],
  ['Schedules, 3D and outputs', 'Schedules has the cable schedule, containment fill and the full take-off — cable, containment, fittings, fixings, isolators and glands. PDF and Excel export the same figures.']
];
function helpDialog() {
  let h = '<div class="steps-grid">' + STEPS.map((s, i) => '<div class="st"><b><span class="n">' + (i + 1) + '</span>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>').join('') + '</div>';
  h += '<h4>Keys</h4><table class="keys">'
    + [['V', 'Select'], ['S', 'Scale'], ['B / L / I / D / R', 'Board, load, isolator, field device, riser'], ['T', 'Trace containment'], ['C', 'Trace a cable'], ['M', 'Tape measure'],
      ['[ and ]', 'Height of the next point −/+ 0.1 m (Shift: 0.5 m)'], ['Alt (hold)', 'Free angle for one click'], ['O', 'Square corners on / off'],
      ['Enter / double-click', 'Finish the run'], ['Backspace', 'Take back the last point'], ['Esc', 'Cancel / put the tool down'],
      ['Drag on open paper', 'Lasso — pick everything inside the box'], ['Shift-click', 'Add or remove one item'], ['Ctrl+A', 'Pick everything on the sheet'],
      ['Ctrl+C / Ctrl+V', 'Copy / paste at the cursor (works across sheets and after a reload)'], ['Ctrl+D', 'Duplicate beside the original'], ['Arrow keys', 'Nudge the selection 50 mm (Shift 500 mm)'],
      ['[ and ] (not tracing)', 'Rotate the drawing a quarter turn — ⟳ in the zoom bar for fine angles'],
      ['Del', 'Delete the selection (or a selected route point)'], ['Ctrl+Z', 'Undo'], ['Ctrl+S', 'Save'], ['F', 'Fit the sheet'], ['Space + drag, middle or right drag', 'Pan'], ['Wheel', 'Zoom']]
      .map(k => '<tr><td>' + esc(k[0]) + '</td><td>' + esc(k[1]) + '</td></tr>').join('') + '</table>';
  modal('How to use Cable Trace', h, [['Close', () => true, 'go']], true);
}
function checkDialog() {
  const list = A ? A.issues : [];
  const h = list.length ? '<ul class="issues">' + list.map((i, k) => '<li class="' + i.sev + '" data-issue="' + k + '">' + (i.sev === 'fail' ? '✕ ' : '! ') + esc(i.text) + '</li>').join('') + '</ul>' : '<p class="note" style="color:var(--live)">Nothing fails and nothing needs a look.</p>';
  modal('Check', h, [['Close', () => true, 'go']], true);
}

// ------------------------------------------------------------------
// save / open / autosave
// ------------------------------------------------------------------
function projectJson() {
  P.rev = (P.rev || 0) + 1;
  P.savedAt = new Date().toISOString();
  return JSON.stringify(P);
}
function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function fileBase() { return (P.name || 'cable-trace').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'cable-trace'; }
function saveProject() {
  download(fileBase() + '.cabletrace.json', projectJson());
  V.dirty = false;
  toast('Saved ' + fileBase() + '.cabletrace.json');
}
function loadProject(data) {
  if (!data || data.app !== 'adi-cable-trace') { toast('That is not a Cable Trace project file'); return; }
  P = C.repair(data);
  V.orig = {}; V.baked = {};
  el('dwg').setAttribute('data-sheet', '');
  V.undo = []; el('bUndo').disabled = true;
  V.sel = null; V.draft = null;
  showSheet(); zoomFit(); changed(); setTool('select');
  toast('Opened ' + (P.name || 'project'));
}
// IndexedDB keeps the whole project with its drawings
const IDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      try {
        const r = indexedDB.open('adi-cable-trace', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
  },
  async put(k, v) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readonly'); const q = tx.objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
};
let autosaveT = null;
function autosaveSoon() {
  clearTimeout(autosaveT);
  autosaveT = setTimeout(() => { IDB.put('autosave', JSON.stringify(P)).catch(() => {}); }, 1200);
}
async function offerAutosave() {
  try {
    const s = await IDB.get('autosave');
    if (!s) return;
    const d = JSON.parse(s);
    if (!d || !d.sheets || !d.sheets.length) return;
    const drop = el('drop');
    const b = document.createElement('div');
    b.style.marginTop = '14px';
    b.innerHTML = '<button class="btn" id="bRestore">Carry on with ' + esc(d.name || 'the last project') + '</button><div style="font-size:12px;color:var(--muted);margin-top:6px">' + d.sheets.length + ' sheet' + (d.sheets.length > 1 ? 's' : '') + ', ' + (d.circuits || []).length + ' circuits — kept in this browser</div>';
    drop.appendChild(b);
    el('bRestore').onclick = () => loadProject(d);
  } catch (e) { /* private window etc. */ }
}

// ------------------------------------------------------------------
// wiring
// ------------------------------------------------------------------
function setTraceH(v) {
  V.traceH = Math.round(Math.max(-5, Math.min(60, v)) * 100) / 100;
  el('hgtIn').value = fmt(V.traceH, 2);
}
function wire() {
  buildRail();
  el('stepsGrid').innerHTML = STEPS.map((s, i) => '<div class="st"><b><span class="n">' + (i + 1) + '</span>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>').join('');
  el('rail').addEventListener('click', ev => { const b = ev.target.closest('.tool'); if (b) setTool(b.dataset.tool); });
  el('bOpenDwg').onclick = () => el('fDwg').click();
  el('bPick').onclick = () => el('fDwg').click();
  el('bPickGrid').onclick = newGridSheet;
  el('bConcept').onclick = newGridSheet;
  el('bPickProj').onclick = () => el('fProj').click();
  el('fDwg').onchange = (ev) => { const f = ev.target.files[0]; ev.target.value = ''; loadDrawingFile(f); };
  el('fProj').onchange = (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { try { loadProject(JSON.parse(fr.result)); } catch (e) { toast('Could not read that file'); } };
    fr.readAsText(f);
  };
  el('bLoad').onclick = () => el('fProj').click();
  el('bSave').onclick = saveProject;
  el('bBasis').onclick = basisDialog;
  el('bHelp').onclick = helpDialog;
  el('bUndo').onclick = undo;
  el('bCheck').onclick = checkDialog;
  el('zIn').onclick = () => setZoom(V.zoom * 1.25);
  el('zOut').onclick = () => setZoom(V.zoom / 1.25);
  el('zFit').onclick = zoomFit;
  el('zRot').onclick = () => rotateDialog();
  el('zLbl').onclick = () => { V.labels = (V.labels + 2) % 3; scheduleRender(); toast(['Labels off', 'Names only', 'All labels'][V.labels]); };
  el('zStack').onclick = () => { V.stackIx = (V.stackIx + 1) % STACK_STEPS.length; el('zStack').textContent = STACK_STEPS[V.stackIx] === 1 ? '1:1' : '×' + STACK_STEPS[V.stackIx]; el('zStack').classList.toggle('on', V.stackIx > 0); scheduleRender(); toast(V.stackIx ? 'Cables drawn ×' + STACK_STEPS[V.stackIx] + ' their diameter, to read the stacking' : 'Cables at true diameter'); };

  const sc = el('scroller');
  sc.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  sc.addEventListener('contextmenu', ev => ev.preventDefault());
  sc.addEventListener('dblclick', ev => { if (V.draft && (V.draft.tool === 'contain' || V.draft.tool === 'tape')) { ev.preventDefault(); finishDraft(); } else if (!V.draft && V.tool === 'select' && !selObject()) setZoom(V.zoom * 1.6, ev); });
  sc.addEventListener('wheel', ev => { ev.preventDefault(); setZoom(V.zoom * Math.pow(1.0018, -ev.deltaY), ev); }, { passive: false });

  el('insp').addEventListener('change', onInspectorChange);
  el('insp').addEventListener('pointerdown', ev => {
    const b = ev.target.closest('[data-act],[data-goto]');
    if (!b || ev.button !== 0) return;
    ev.preventDefault();
    commitActiveField();
    onInspectorClick({ target: b, preventDefault() {} });
  });
  // keyboard activation (Enter / Space on a focused button) still arrives as a click
  el('insp').addEventListener('click', ev => { if (ev.detail === 0) { commitActiveField(); onInspectorClick(ev); } else if (ev.target.closest('[data-goto]')) ev.preventDefault(); });
  el('pal').addEventListener('click', ev => { const b = ev.target.closest('button[data-pk]'); if (!b) return; V.pal[b.dataset.pk] = b.dataset.pv; renderPalette(); scheduleRender(); });
  el('pal').addEventListener('change', ev => { const s2 = ev.target.closest('select[data-pk]'); if (!s2) return; V.pal[s2.dataset.pk] = s2.value; });
  el('status').addEventListener('click', ev => { if (ev.target.closest('[data-act=check]')) checkDialog(); });
  el('sheets').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'bAddDwg') { el('fDwg').click(); return; }
    if (b.id === 'bAddGrid') { newGridSheet(); return; }
    if (b.dataset.sheet) { P.active = b.dataset.sheet; V.draft = null; showSheet(); zoomFit(); renderStatus(); }
  });
  el('sheets').addEventListener('dblclick', ev => { const b = ev.target.closest('button[data-sheet]'); if (b) sheetDialog(b.dataset.sheet); });

  el('hgtIn').addEventListener('change', () => setTraceH(Number(el('hgtIn').value) || 0));
  el('hUp').onclick = () => setTraceH(V.traceH + 0.1);
  el('hDn').onclick = () => setTraceH(V.traceH - 0.1);
  el('hintFin').onclick = finishDraft;
  el('hintX').onclick = () => setTool('select');
  el('orthoChk').onchange = () => { P.settings.ortho = el('orthoChk').checked; };

  el('modalBg').addEventListener('click', ev => {
    if (ev.target === el('modalBg') || ev.target.closest('[data-mx]')) { closeModal(); return; }
    const b = ev.target.closest('[data-mi]');
    if (b) { const a = modalActions[Number(b.dataset.mi)]; if (a && a[1]() !== false) closeModal(); return; }
    const iss = ev.target.closest('[data-issue]');
    if (iss) {
      const i = A.issues[Number(iss.dataset.issue)];
      closeModal();
      if (i.circuit) goTo('circ', i.circuit); else if (i.node) goTo('node', i.node); else if (i.route) goTo('route', i.route);
    }
  });

  // drag and drop
  const stage = el('stage');
  stage.addEventListener('dragover', ev => { ev.preventDefault(); el('drop').classList.add('hot'); });
  stage.addEventListener('dragleave', () => el('drop').classList.remove('hot'));
  stage.addEventListener('drop', ev => {
    ev.preventDefault(); el('drop').classList.remove('hot');
    const f = ev.dataTransfer.files[0]; if (!f) return;
    if (/\.json$/i.test(f.name)) { const fr = new FileReader(); fr.onload = () => { try { loadProject(JSON.parse(fr.result)); } catch (e) { toast('Could not read that file'); } }; fr.readAsText(f); }
    else loadDrawingFile(f);
  });

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', ev => { if (ev.key === 'Alt') { V.alt = false; syncHint(); } if (ev.key === ' ') { V.space = false; } });
  window.addEventListener('blur', () => { V.alt = false; V.space = false; });
  window.addEventListener('beforeunload', ev => { if (V.dirty && P.sheets.length) { ev.preventDefault(); ev.returnValue = ''; } });
  window.addEventListener('resize', scheduleRender);
}
function onKey(ev) {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((ev.target && ev.target.tagName) || '');
  if (ev.key === 'Alt') { V.alt = true; syncHint(); ev.preventDefault(); }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveProject(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !typing) { ev.preventDefault(); undo(); return; }
  if ((ev.ctrlKey || ev.metaKey) && !typing && !el('modalBg').classList.contains('on')) {
    const kk = ev.key.toLowerCase();
    if (kk === 'c') { ev.preventDefault(); copySelection(); return; }
    if (kk === 'v') { ev.preventDefault(); pasteClipboard(); return; }
    if (kk === 'd') { ev.preventDefault(); duplicateSelection(); return; }
    if (kk === 'a') { ev.preventDefault(); if (sheet()) { setTool('select'); selectAll(); } return; }
  }
  if (typing) { if (ev.key === 'Escape') ev.target.blur(); return; }
  if (el('modalBg').classList.contains('on')) { if (ev.key === 'Escape') closeModal(); return; }
  if (ev.key === ' ') { V.space = true; ev.preventDefault(); return; }
  if (ev.key === 'Escape') {
    if (window.Outputs && Outputs.threeOpen()) { Outputs.close3D(); return; }
    if (V.draft) { V.draft = null; V.snap = null; scheduleRender(); syncHint(); return; }
    if (V.tool !== 'select') { setTool('select'); return; }
    select(null); return;
  }
  if (ev.key === 'Enter') { finishDraft(); return; }
  if (ev.key === 'Backspace' && V.draft) {
    ev.preventDefault();
    const d = V.draft;
    if (d.tool === 'cable') { if (d.way.length) { d.way.pop(); d.pts.pop(); } else V.draft = null; }
    else if (d.pts.length) d.pts.pop();
    if (d.pts && !d.pts.length) V.draft = null;
    scheduleRender(); syncHint(); return;
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSelected(); return; }
  if (ev.key === '[' || ev.key === ']') {
    if (V.tool === 'contain' || V.tool === 'cable') { setTraceH(V.traceH + (ev.key === ']' ? 1 : -1) * (ev.shiftKey ? 0.5 : 0.1)); toast('Next point at ' + fmt(V.traceH, 2) + ' m', 1200); scheduleRender(); }
    else if (sheet()) rotateSheet(ev.key === ']' ? 90 : -90);
    return;
  }
  if (ev.key.startsWith('Arrow') && V.sel && V.sel.kind !== 'circ' && V.tool === 'select') {
    ev.preventDefault();
    const step = ppm() * (ev.shiftKey ? 0.5 : 0.05);
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    nudgeSelection(d[0], d[1]);
    return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const map = { v: 'select', s: 'scale', b: 'board', l: 'load', i: 'isolator', d: 'device', r: 'riser', t: 'contain', c: 'cable', m: 'tape' };
  const k = ev.key.toLowerCase();
  if (map[k]) { setTool(map[k]); return; }
  if (k === 'o') { P.settings.ortho = !P.settings.ortho; syncHint(); toast(P.settings.ortho ? 'Square corners on' : 'Free angles'); return; }
  if (k === 'f') { zoomFit(); return; }
  if (k === '?' || ev.key === 'F1') { ev.preventDefault(); helpDialog(); return; }
}

// expose what outputs.js needs
window.CT = {
  get P() { return P; }, get A() { return A; }, get V() { return V; },
  getTK, changed, esc, fmt, el, toast, modal, download, fileBase, circColour, ROUTE_COLS, routePts, nodeById, routeById, circById, select, goTo, measureLen, sheet, ppm, STACK_STEPS, render
};

wire();
solveNow();
showSheet();
renderStatus();
setTool('select');
offerAutosave();
