/* adi Cable Trace — rotating a sheet, picking several things at once, and
 * copy / paste. Loaded after app.js and shares its globals (P, A, V, …).
 */
'use strict';

// ------------------------------------------------------------------
// rotating the drawing
// ------------------------------------------------------------------
// The turn is baked into the image and every traced point on the sheet is
// turned with it, so hit testing, snapping, the 3D and the outputs never need
// to know. Every turn is drawn from the image as it was first loaded, never
// from the last rotated copy, so nudging a scan straight does not soften it.
// Rotation keeps distances, so the scale is untouched.
V.orig = {};   // sheet id → { src, w, h, rot } as first loaded
V.baked = {};  // sheet id → rotation the current src carries

function rotDims(w, h, deg) {
  const a = deg * Math.PI / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return { w: Math.round(w * c + h * s), h: Math.round(w * s + h * c) };
}
function bakeImage(s, total) {
  if (!s.src) return Promise.resolve();
  const o = V.orig[s.id] || (V.orig[s.id] = { src: s.src, w: s.w, h: s.h, rot: V.baked[s.id] != null ? V.baked[s.id] : (s.rot || 0) });
  const delta = total - o.rot;
  if (Math.abs(delta) < 1e-9) { s.src = o.src; s.w = o.w; s.h = o.h; V.baked[s.id] = total; return Promise.resolve(); }
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const d = rotDims(o.w, o.h, delta);
      const cv = document.createElement('canvas');
      cv.width = d.w; cv.height = d.h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, d.w, d.h);
      ctx.translate(d.w / 2, d.h / 2);
      ctx.rotate(delta * Math.PI / 180);
      ctx.drawImage(img, -o.w / 2, -o.h / 2);
      s.src = cv.toDataURL('image/jpeg', 0.88);
      s.w = d.w; s.h = d.h;
      V.baked[s.id] = total;
      res();
    };
    img.onerror = () => res();
    img.src = o.src;
  });
}
function turnPoints(sid, deg, cOld, cNew) {
  const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const t = (p) => { const x = p.x - cOld.x, y = p.y - cOld.y; p.x = cNew.x + x * ca - y * sa; p.y = cNew.y + x * sa + y * ca; };
  P.nodes.forEach(n => { if (n.sheet === sid) t(n); });
  P.routes.forEach(r => { if (r.sheet === sid) r.pts.forEach(t); });
  P.measures.forEach(m => { if (m.sheet === sid) m.pts.forEach(t); });
  P.circuits.forEach(c => Object.values(c.legs || {}).forEach(l => (l.way || []).forEach(w => { if (w.s === sid) t(w); })));
}
async function rotateSheet(deg) {
  const s = sheet();
  if (!s || !deg) return;
  pushUndo();
  const from = s.rot || 0;
  const total = Math.round((from + deg) * 1000) / 1000;
  const cOld = { x: s.w / 2, y: s.h / 2 };
  let dims;
  if (s.src) {
    const o = V.orig[s.id] || (V.orig[s.id] = { src: s.src, w: s.w, h: s.h, rot: V.baked[s.id] != null ? V.baked[s.id] : from });
    dims = rotDims(o.w, o.h, total - o.rot);
  } else {
    dims = rotDims(s.w, s.h, deg);
  }
  const cNew = { x: dims.w / 2, y: dims.h / 2 };
  turnPoints(s.id, deg, cOld, cNew);
  s.rot = ((total % 360) + 360) % 360;
  if (s.src) await bakeImage(s, s.rot); else { s.w = dims.w; s.h = dims.h; }
  el('dwg').setAttribute('data-sheet', '');
  showSheet();
  changed();
}
// after an undo the geometry is back but the image may still be turned
function ensureBaked() {
  P.sheets.forEach(s => {
    if (!s.src) return;
    const have = V.baked[s.id] != null ? V.baked[s.id] : (s.rot || 0);
    if (Math.abs(have - (s.rot || 0)) > 1e-9) {
      bakeImage(s, s.rot || 0).then(() => { el('dwg').setAttribute('data-sheet', ''); showSheet(); });
    }
  });
}
function rotateDialog() {
  const s = sheet();
  if (!s) return;
  modal('Rotate the drawing', '<p class="note">Everything traced on this sheet turns with it. The scale is unchanged. Now at <b>' + fmt(s.rot || 0, 1) + '°</b>.</p>'
    + '<div class="insp-actions">'
    + [[-90, '↺ 90°'], [90, '↻ 90°'], [180, '180°'], [-1, '−1°'], [1, '+1°'], [-0.1, '−0.1°'], [0.1, '+0.1°']].map(b => '<button class="btn ghost sm" data-rot="' + b[0] + '">' + b[1] + '</button>').join('')
    + '</div><div class="f" style="margin-top:12px"><label>Turn by</label><div class="unit"><input id="rotBy" type="number" step="0.1" placeholder="e.g. 2.5"><span>° clockwise</span></div></div>'
    + '<p class="note">Keys: <b>[</b> and <b>]</b> turn a quarter when you are not tracing.</p>',
  [['Close', () => true, 'ghost'], ['Turn', () => { const v = Number(el('rotBy').value); if (v) rotateSheet(v); return true; }, 'go']]);
}
el('modal').addEventListener('click', ev => {
  const b = ev.target.closest('[data-rot]');
  if (!b) return;
  rotateSheet(Number(b.dataset.rot)).then(() => { const n = document.querySelector('#modal .note b'); if (n) n.textContent = fmt(sheet().rot || 0, 1) + '°'; });
});

// ------------------------------------------------------------------
// multi-select
// ------------------------------------------------------------------
function emptyMulti() { return { kind: 'multi', nodes: [], routes: [], measures: [] }; }
function multiOf() {
  const s = V.sel;
  if (!s) return emptyMulti();
  if (s.kind === 'multi') return s;
  const m = emptyMulti();
  if (s.kind === 'node') m.nodes.push(s.id);
  if (s.kind === 'route') m.routes.push(s.id);
  if (s.kind === 'measure') m.measures.push(s.id);
  return m;
}
function multiCount(m) { return m.nodes.length + m.routes.length + m.measures.length; }
function settle(m) {
  const n = multiCount(m);
  if (!n) return null;
  if (n === 1) {
    if (m.nodes.length) return { kind: 'node', id: m.nodes[0] };
    if (m.routes.length) return { kind: 'route', id: m.routes[0] };
    return { kind: 'measure', id: m.measures[0] };
  }
  return m;
}
function inMulti(kind, id) {
  const s = V.sel;
  if (!s) return false;
  if (s.kind === 'multi') return (s[kind + 's'] || []).includes(id);
  return s.kind === kind && s.id === id;
}
function toggleIn(kind, id) {
  const m = multiOf();
  const list = m[kind + 's'];
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.push(id);
  V.sel = settle(m);
  scheduleRender(); renderInspector();
}
function hitPick(p) {
  const n = hitNode(p);
  if (n) return { kind: 'node', id: n.id };
  const sg = hitRouteSeg(p, 8);
  if (sg) return { kind: 'route', id: sg.route.id };
  const m = hitMeasure(p);
  if (m) return { kind: 'measure', id: m.id };
  return null;
}
function selectInBox(a, b, add) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const inside = (q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
  const m = add ? multiOf() : emptyMulti();
  const push = (list, id) => { if (!list.includes(id)) list.push(id); };
  P.nodes.forEach(n => { if (n.sheet === P.active && inside(n)) push(m.nodes, n.id); });
  P.routes.forEach(r => { if (r.sheet === P.active && routePts(r).every(inside)) push(m.routes, r.id); });
  P.measures.forEach(me => { if (me.sheet === P.active && me.pts.every(inside)) push(m.measures, me.id); });
  V.sel = settle(m);
  scheduleRender(); renderInspector();
  const n = multiCount(m);
  if (n > 1) toast(n + ' picked — drag to move, Ctrl+C / Ctrl+D to copy, Del to delete');
}
function selectAll() {
  const m = emptyMulti();
  P.nodes.forEach(n => { if (n.sheet === P.active) m.nodes.push(n.id); });
  P.routes.forEach(r => { if (r.sheet === P.active) m.routes.push(r.id); });
  P.measures.forEach(me => { if (me.sheet === P.active) m.measures.push(me.id); });
  V.sel = settle(m);
  scheduleRender(); renderInspector();
}

// The select tool's press: shift toggles, a press on something already
// picked drags the group, open paper draws a lasso.
function selectDown(ev, p) {
  if (ev.shiftKey) {
    const h = hitPick(p);
    if (h) { toggleIn(h.kind, h.id); return; }
    V.drag = { kind: 'lasso', a: p, b: p, add: true };
    return;
  }
  const s = V.sel;
  if (s && s.kind === 'multi') {
    const h = hitPick(p);
    if (h && inMulti(h.kind, h.id)) { startGroupDrag(p); return; }
  }
  const hit = selectAt(p);
  if (hit && hit.kind === 'node') { V.drag = { kind: 'node', id: hit.n.id, start: p, moved: false, ox: hit.n.x, oy: hit.n.y }; }
  else if (hit && hit.kind === 'routept') { V.drag = { kind: 'pt', rid: V.sel.id, i: hit.rp.i, start: p, moved: false }; }
  else if (hit && hit.kind === 'route') { startGroupDrag(p); }
  else if (!hit) { select(null); V.drag = { kind: 'lasso', a: p, b: p, add: false }; }
}

// what moves when a group moves: the units, every unjoined point of the
// picked runs, tape lines, and the free waypoints of cables whose ends all move
function groupTargets() {
  const m = multiOf();
  const nodes = new Set(m.nodes), routes = new Set(m.routes);
  const pts = [];
  P.nodes.forEach(n => { if (nodes.has(n.id)) pts.push(n); });
  P.routes.forEach(r => { if (routes.has(r.id)) r.pts.forEach(q => { if (!q.link) pts.push(q); }); });
  P.measures.forEach(me => { if (m.measures.includes(me.id)) me.pts.forEach(q => pts.push(q)); });
  P.circuits.forEach(c => {
    const ends = [c.board, c.iso, c.target].filter(Boolean);
    if (!ends.length || !ends.every(id => nodes.has(id))) return;
    Object.values(c.legs || {}).forEach(l => (l.way || []).forEach(w => { if (w.s) pts.push(w); }));
  });
  return pts;
}
function startGroupDrag(p) {
  const pts = groupTargets();
  V.drag = { kind: 'group', start: p, moved: false, pts, orig: pts.map(q => ({ x: q.x, y: q.y })) };
}
function dragGroup(dx, dy) {
  V.drag.pts.forEach((q, i) => { q.x = V.drag.orig[i].x + dx; q.y = V.drag.orig[i].y + dy; });
}
function nudgeSelection(dx, dy) {
  if (!V.sel || V.sel.kind === 'circ') return;
  pushUndo();
  const pts = groupTargets();
  pts.forEach(q => { q.x += dx; q.y += dy; });
  changed();
}

function deleteMulti(m) {
  pushUndo();
  m.measures.forEach(id => { P.measures = P.measures.filter(x => x.id !== id); });
  m.routes.forEach(id => { const r = routeById(id); if (!r) return; solveNow(); r.pts.forEach(pt => unrefPoint(pt.id)); P.routes = P.routes.filter(x => x.id !== id); });
  m.nodes.forEach(id => removeNode(id));
  V.sel = null;
  changed();
}

function multiForm(m) {
  const nodes = m.nodes.map(nodeById).filter(Boolean);
  const routes = m.routes.map(routeById).filter(Boolean);
  const kinds = {};
  nodes.forEach(n => { kinds[n.kind] = (kinds[n.kind] || 0) + 1; });
  const words = Object.keys(kinds).map(k => kinds[k] + ' ' + k + (kinds[k] > 1 ? 's' : '')).concat(routes.length ? [routes.length + ' containment run' + (routes.length > 1 ? 's' : '')] : [], m.measures.length ? [m.measures.length + ' tape'] : []);
  let h = '<div class="insp-hd"><div style="min-width:0;flex:1"><div class="kind">Selection</div><h3>' + multiCount(m) + ' items</h3></div><button class="btn ghost sm" data-act="close">✕</button></div><div class="insp-bd">';
  h += '<p class="note">' + esc(words.join(', ')) + '</p>';
  h += '<p class="note">Drag any picked item to move them all. Arrow keys nudge 50 mm (Shift 500 mm). Shift-click adds or removes one.</p>';
  h += '<h4>Set for all</h4>';
  h += F('Height', '<div class="unit"><input data-o="multi" data-k="h" data-ty="num" type="number" step="0.05" placeholder="leave"><span>m</span></div>');
  if (routes.length) {
    h += F('Containment', sel('multi', 'type', '', [['', '— leave —']].concat(Object.keys(E.CONTAINMENT).map(k => [k, E.CONTAINMENT[k].label]))));
    h += F('Finish', sel('multi', 'finish', '', [['', '— leave —']].concat(Object.keys(E.FINISHES).filter(k => k !== 'pvc').map(k => [k, E.FINISHES[k]]))));
    h += F('Fixing', sel('multi', 'mount', '', [['', '— leave —']].concat(Object.keys(E.MOUNTS).map(k => [k, E.MOUNTS[k]]))));
    h += F('Ambient', '<div class="unit"><input data-o="multi" data-k="amb" data-ty="num" type="number" placeholder="leave"><span>°C</span></div>');
  }
  if (kinds.isolator) {
    h += F('Isolator enclosure', sel('multi', 'enclosure', '', [['', '— leave —']].concat(Object.keys(E.ISOLATOR_ENCLOSURES).map(k => [k, E.ISOLATOR_ENCLOSURES[k]]))));
    h += F('Isolator IP', sel('multi', 'ip', '', [['', '— leave —']].concat(E.ISOLATOR_IP.map(x => [x, x]))));
  }
  if (kinds.load) {
    h += F('Load supply', sel('multi', 'phase', '', [['', '— leave —'], [3, 'Three phase'], [1, 'Single phase']]));
    h += F('Motor starting', sel('multi', 'drive', '', [['', '— leave —']].concat(Object.keys(E.DRIVES).filter(d => d !== 'NA').map(d => [d, E.DRIVES[d].label]))));
  }
  if (nodes.length) h += F('Outdoor', sel('multi', 'outdoor', '', [['', '— leave —'], ['true', 'Yes'], ['false', 'No']]));
  h += '<div class="insp-actions"><button class="btn ghost sm" data-act="dup">Duplicate (Ctrl+D)</button><button class="btn ghost sm" data-act="copy">Copy (Ctrl+C)</button><button class="btn danger sm" data-act="delete">Delete all</button></div>';
  h += '</div>';
  return h;
}
function applyMulti(k, v) {
  const m = V.sel;
  if (!m || m.kind !== 'multi' || v == null || v === '') return;
  pushUndo();
  const nodes = m.nodes.map(nodeById).filter(Boolean);
  const routes = m.routes.map(routeById).filter(Boolean);
  if (k === 'h') {
    nodes.forEach(n => { if (n.kind !== 'riser') n.h = v; });
    routes.forEach(r => r.pts.forEach(q => { q.h = v; }));
  } else if (k === 'type') {
    routes.forEach(r => { r.type = v; r.width = null; r.duty = E.CONTAINMENT[v].defaultDuty; r.mount = defaultMount(v); });
  } else if (k === 'finish' || k === 'mount' || k === 'amb') {
    routes.forEach(r => { r[k] = v; });
  } else if (k === 'enclosure' || k === 'ip') {
    nodes.forEach(n => { if (n.kind === 'isolator') n[k] = v; });
  } else if (k === 'phase' || k === 'drive') {
    nodes.forEach(n => { if (n.kind === 'load' && (k !== 'drive' || (E.LOAD_KINDS[n.loadKind] || {}).motor)) n[k] = v; });
  } else if (k === 'outdoor') {
    nodes.forEach(n => { n.outdoor = v === true || v === 'true'; });
  }
  changed();
}

// ------------------------------------------------------------------
// copy, paste, duplicate
// ------------------------------------------------------------------
// The clipboard is in localStorage, in metres about the centre of what was
// copied, so it survives a reload and pastes at the right size on another
// sheet at another scale. Containment joints inside the copy are kept;
// joints to things left behind are let go. A cable comes with the copy when
// every end of it does.
const CLIP_KEY = 'adi-cable-trace-clip';
function packSelection() {
  const m = multiOf();
  if (!multiCount(m)) return null;
  const k = ppm();
  const nodes = m.nodes.map(nodeById).filter(Boolean);
  const routes = m.routes.map(routeById).filter(Boolean);
  const measures = m.measures.map(id => P.measures.find(x => x.id === id)).filter(Boolean);
  const all = [];
  nodes.forEach(n => all.push(n));
  routes.forEach(r => routePts(r).forEach(q => all.push(q)));
  measures.forEach(me => me.pts.forEach(q => all.push(q)));
  const xs = all.map(q => q.x), ys = all.map(q => q.y);
  const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const toM = (q) => ({ x: (q.x - c.x) / k, y: (q.y - c.y) / k });
  const nodeIds = new Set(nodes.map(n => n.id));
  const ptIds = new Set();
  routes.forEach(r => r.pts.forEach(q => ptIds.add(q.id)));
  const pack = {
    app: 'adi-cable-trace-clip',
    nodes: nodes.map(n => Object.assign({}, n, toM(n))),
    routes: routes.map(r => Object.assign({}, r, {
      pts: r.pts.map(q => {
        const pos = C.ptPos(A.ix, q.id) || q;
        const o = Object.assign({}, q, toM(pos));
        if (o.link && !((o.link.startsWith('p:') && ptIds.has(o.link.slice(2))) || (o.link.startsWith('n:') && nodeIds.has(o.link.slice(2))))) delete o.link;
        return o;
      })
    })),
    measures: measures.map(me => Object.assign({}, me, { pts: me.pts.map(toM) })),
    // a cable comes along when its load end (and isolator) is copied; if the
    // board was left behind the copy is fed from the same board and its
    // supply re-routes itself through the containment
    circuits: P.circuits.filter(cc => cc.target && nodeIds.has(cc.target) && (!cc.iso || nodeIds.has(cc.iso))).map(cc => {
      const o = JSON.parse(JSON.stringify(cc));
      if (o.board && !nodeIds.has(o.board) && o.legs && o.legs.main) { o.legs.main.way = []; delete o.legs.main.direct; }
      Object.values(o.legs || {}).forEach(l => {
        l.way = (l.way || []).map(w => {
          if (w.p) return ptIds.has(w.p) ? w : null;
          if (w.r) return nodeIds.has(w.r) ? w : null;
          return Object.assign({}, w, toM(w));
        }).filter(Boolean);
      });
      return o;
    })
  };
  return pack;
}
function copySelection() {
  const pack = packSelection();
  if (!pack) { toast('Pick something to copy'); return; }
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(pack)); } catch (e) { V.clip = pack; }
  V.clip = pack;
  toast('Copied ' + summary(pack) + ' — Ctrl+V pastes at the cursor');
}
function summary(pack) {
  const bits = [];
  if (pack.nodes.length) bits.push(pack.nodes.length + ' unit' + (pack.nodes.length > 1 ? 's' : ''));
  if (pack.routes.length) bits.push(pack.routes.length + ' run' + (pack.routes.length > 1 ? 's' : ''));
  if (pack.circuits.length) bits.push(pack.circuits.length + ' cable' + (pack.circuits.length > 1 ? 's' : ''));
  if (pack.measures.length) bits.push(pack.measures.length + ' tape');
  return bits.join(', ');
}
function readClip() {
  try { const s = localStorage.getItem(CLIP_KEY); if (s) return JSON.parse(s); } catch (e) { /* storage blocked */ }
  return V.clip || null;
}
function freshName(name, used) {
  const m = /^(.*?)(\d+)$/.exec(name || '');
  const base = m ? m[1] : (name || 'X');
  let i = m ? Number(m[2]) + 1 : 1;
  while (used.has(base + i)) i++;
  used.add(base + i);
  return base + i;
}
function placePack(pack, at) {
  if (!sheet()) { toast('Open a sheet first'); return; }
  pushUndo();
  const k = ppm();
  const toPx = (q) => ({ x: at.x + q.x * k, y: at.y + q.y * k });
  const idMap = new Map();
  const newId = (old, pre) => { const id = C.nid(P, pre); idMap.set(old, id); return id; };
  const used = new Set(P.nodes.map(n => n.name));
  const routeNames = new Set(P.routes.map(r => r.name));
  const out = emptyMulti();
  pack.nodes.forEach(n => {
    const o = Object.assign({}, n, toPx(n), { id: newId(n.id, 'n'), sheet: P.active });
    if (o.kind === 'riser') { o.riser = nextRiser(); o.name = 'Riser ' + o.riser; }
    else o.name = freshName(n.name, used);
    P.nodes.push(o); out.nodes.push(o.id);
  });
  pack.routes.forEach(r => r.pts.forEach(q => idMap.set(q.id, C.nid(P, 'p'))));
  pack.routes.forEach(r => {
    const o = Object.assign({}, r, { id: newId(r.id, 'r'), sheet: P.active, name: freshName(r.name, routeNames) });
    o.pts = r.pts.map(q => {
      const np = Object.assign({}, q, toPx(q), { id: idMap.get(q.id) });
      if (q.link) np.link = q.link.slice(0, 2) + idMap.get(q.link.slice(2));
      return np;
    });
    P.routes.push(o); out.routes.push(o.id);
  });
  pack.measures.forEach(me => {
    const o = { id: C.nid(P, 'm'), sheet: P.active, pts: me.pts.map(toPx) };
    P.measures.push(o); out.measures.push(o.id);
  });
  pack.circuits.forEach(cc => {
    const o = JSON.parse(JSON.stringify(cc));
    o.id = C.nid(P, 'c');
    ['board', 'iso', 'target'].forEach(f => { if (o[f]) o[f] = idMap.get(o[f]) || (nodeById(o[f]) ? o[f] : null); });
    if (!o.board && !o.target) return;
    o.refAuto = true;
    Object.values(o.legs || {}).forEach(l => {
      l.way = (l.way || []).map(w => {
        if (w.p) return idMap.get(w.p) ? { p: idMap.get(w.p) } : null;
        if (w.r) return idMap.get(w.r) ? { r: idMap.get(w.r) } : null;
        return Object.assign({}, w, toPx(w), { s: P.active });
      }).filter(Boolean);
    });
    P.circuits.push(o);
  });
  V.sel = settle(out);
  changed();
  toast('Pasted ' + summary(pack));
}
function pasteClipboard() {
  const pack = readClip();
  if (!pack || pack.app !== 'adi-cable-trace-clip') { toast('Nothing copied yet'); return; }
  let at = V.lastCursor;
  if (!at) {
    const sc = el('scroller');
    at = { x: (sc.scrollLeft + sc.clientWidth / 2) / V.zoom, y: (sc.scrollTop + sc.clientHeight / 2) / V.zoom };
  }
  placePack(pack, at);
}
function duplicateSelection() {
  const pack = packSelection();
  if (!pack) { toast('Pick something to duplicate'); return; }
  // the centre of the copy, one metre down and right of the original
  const m = multiOf();
  const all = [];
  m.nodes.map(nodeById).filter(Boolean).forEach(n => all.push(n));
  m.routes.map(routeById).filter(Boolean).forEach(r => routePts(r).forEach(q => all.push(q)));
  m.measures.forEach(id => { const me = P.measures.find(x => x.id === id); if (me) me.pts.forEach(q => all.push(q)); });
  const xs = all.map(q => q.x), ys = all.map(q => q.y);
  const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2 + ppm(), y: (Math.min(...ys) + Math.max(...ys)) / 2 + ppm() };
  placePack(pack, c);
}
