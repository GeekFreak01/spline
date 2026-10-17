// Dock panels that can be torn off, moved around and closed, like the panels
// in Photoshop. Each panel is a <details data-sec="id"> in the right dock.
// Drag its header out of the dock and it becomes a floating window; drag the
// window back onto the dock (or press its dock button) to put it back. The
// Window menu shows and hides panels. The layout is kept in localStorage.

const STORE = 'spline.panels';
const DRAG_START = 6; // px before a header drag tears the panel off

let state = {};
try { state = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { state = {}; }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage unavailable */ } };
const st = (id) => (state[id] ||= {});

let layer = null;
let activeDock = () => null;
let labels = {};
let icons = {};
let onChange = () => {};

export function initPanels(opts) {
  layer = opts.layer;
  activeDock = opts.activeDock;
  labels = opts.labels;
  icons = opts.icons;
  onChange = opts.onChange || onChange;
  for (const dock of opts.docks) dock.addEventListener('pointerdown', onDockPointerDown);
  layer.addEventListener('pointerdown', onLayerPointerDown);
  layer.addEventListener('click', onLayerClick);
  window.addEventListener('resize', () => layer.querySelectorAll('.float-panel').forEach(clampWindow));
}

export const isHidden = (id) => !!state[id]?.hidden;
export const isFloating = (id) => !!state[id]?.float;

export function setHidden(id, hidden) {
  st(id).hidden = hidden;
  save();
  layoutPanels();
  onChange();
}

export function resetPanels() {
  state = {};
  save();
  layer.innerHTML = '';
  layoutPanels();
  onChange();
}

function windowFor(id) {
  let w = layer.querySelector(`.float-panel[data-float="${id}"]`);
  if (!w) {
    w = document.createElement('div');
    w.className = 'float-panel';
    w.dataset.float = id;
    w.setAttribute('role', 'dialog');
    w.innerHTML = `<div class="float-head"><span class="float-title"></span>
      <button type="button" class="float-btn" data-panel-dock aria-label="${labels.dock}" data-tip="${labels.dock}">${icons.dock}</button>
      <button type="button" class="float-btn" data-panel-close aria-label="${labels.close}" data-tip="${labels.close}">${icons.close}</button></div>
      <div class="float-body"></div>`;
    layer.append(w);
  }
  const f = st(id).float;
  w.style.left = `${f.x}px`;
  w.style.top = `${f.y}px`;
  if (f.w) w.style.width = `${f.w}px`;
  return w;
}

function clampWindow(w) {
  const r = w.getBoundingClientRect();
  const x = Math.min(Math.max(0, r.left), Math.max(0, innerWidth - 80));
  const y = Math.min(Math.max(0, r.top), Math.max(0, innerHeight - 30));
  w.style.left = `${x}px`;
  w.style.top = `${y}px`;
  const f = state[w.dataset.float]?.float;
  if (f) { f.x = x; f.y = y; }
}

// Called after the active dock is rendered: moves floating panels into their
// windows and hides closed ones.
export function layoutPanels() {
  if (!layer) return;
  const dock = activeDock();
  const present = new Set();
  if (dock) {
    // Sections of this dock: still docked, or already in a window.
    const own = [...dock.querySelectorAll(':scope > details[data-sec]'),
      ...layer.querySelectorAll(`.float-body > details[data-dock="${dock.id}"]`)];
    const seen = new Set();
    for (const d of own) {
      const id = d.dataset.sec;
      // After a re-render the fresh copy in the dock wins over the old one.
      if (seen.has(id)) { d.remove(); continue; }
      seen.add(id);
      d.dataset.dock = dock.id;
      if (!isFloating(id)) {
        d.hidden = isHidden(id);
        if (d.parentElement !== dock) dock.insertBefore(d, nextInDock(dock, id));
        continue;
      }
      present.add(id);
      d.hidden = false;
      d.open = true;
      const w = windowFor(id);
      w.querySelector('.float-title').textContent = d.querySelector('summary')?.textContent || '';
      const body = w.querySelector('.float-body');
      if (body.firstElementChild !== d) body.replaceChildren(d);
      w.hidden = isHidden(id);
    }
  }
  // Windows of panels the current view does not have are removed.
  for (const w of layer.querySelectorAll('.float-panel')) {
    if (!present.has(w.dataset.float)) w.remove();
  }
}

// --- tearing a panel off the dock

function onDockPointerDown(e) {
  const sum = e.target.closest('details[data-sec] > summary');
  if (!sum || e.button !== 0 || e.target.closest('button')) return;
  const d = sum.parentElement;
  const id = d.dataset.sec;
  const x0 = e.clientX, y0 = e.clientY;
  const box = sum.getBoundingClientRect();
  let w = null;
  const move = (ev) => {
    if (!w) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START) return;
      st(id).float = { x: box.left, y: box.top, w: Math.max(240, Math.round(box.width)) };
      layoutPanels();
      w = layer.querySelector(`.float-panel[data-float="${id}"]`);
      if (!w) { cleanup(); return; }
      w.classList.add('dragging');
    }
    placeWindow(w, id, box.left + ev.clientX - x0, box.top + ev.clientY - y0, ev);
  };
  const up = (ev) => {
    cleanup();
    if (!w) return;
    // The click that ends the drag must not fold the panel.
    const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    finishMove(w, id, ev);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// --- moving a floating window

function onLayerPointerDown(e) {
  const head = e.target.closest('.float-head');
  if (!head || e.button !== 0 || e.target.closest('button')) return;
  e.preventDefault();
  const w = head.parentElement;
  const id = w.dataset.float;
  const r = w.getBoundingClientRect();
  const dx = e.clientX - r.left, dy = e.clientY - r.top;
  w.classList.add('dragging');
  layer.append(w); // to the front
  const move = (ev) => placeWindow(w, id, ev.clientX - dx, ev.clientY - dy, ev);
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    finishMove(w, id, ev);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function overDock(ev) {
  const dock = activeDock();
  if (!dock) return false;
  const r = dock.getBoundingClientRect();
  return r.width > 0 && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
}

function placeWindow(w, id, x, y, ev) {
  w.style.left = `${x}px`;
  w.style.top = `${y}px`;
  activeDock()?.classList.toggle('drop-target', overDock(ev));
}

function finishMove(w, id, ev) {
  w.classList.remove('dragging');
  activeDock()?.classList.remove('drop-target');
  if (overDock(ev)) { dockPanel(id); return; }
  clampWindow(w);
  const r = w.getBoundingClientRect();
  st(id).float = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
  save();
}

function dockPanel(id) {
  const w = layer.querySelector(`.float-panel[data-float="${id}"]`);
  const d = w?.querySelector('details[data-sec]');
  delete st(id).float;
  save();
  if (d) {
    const dock = activeDock();
    dock.insertBefore(d, nextInDock(dock, id));
  }
  w?.remove();
  onChange();
}

// The section a returning panel goes before, to keep the original order.
function nextInDock(dock, id) {
  return [...dock.querySelectorAll(':scope > details[data-sec]')]
    .find((x) => (dockOrder.get(x.dataset.sec) ?? 99) > (dockOrder.get(id) ?? 99)) || null;
}

// Order of the sections in the dock, recorded on each render.
const dockOrder = new Map();
export function recordOrder(dock) {
  [...dock.querySelectorAll(':scope > details[data-sec]')].forEach((d, i) => dockOrder.set(d.dataset.sec, i));
}

function onLayerClick(e) {
  const w = e.target.closest('.float-panel');
  if (!w) return;
  const id = w.dataset.float;
  if (e.target.closest('[data-panel-close]')) setHidden(id, true);
  else if (e.target.closest('[data-panel-dock]')) dockPanel(id);
  else if (e.target.closest('.float-body > details > summary')) e.preventDefault(); // stays open
}

// Remembers widths changed with the resize grip.
export function watchResize() {
  if (!layer || typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver((entries) => {
    for (const en of entries) {
      const f = state[en.target.dataset.float]?.float;
      if (f && en.target.isConnected && en.contentRect.width > 0 && !en.target.classList.contains('dragging')) { f.w = Math.round(en.target.getBoundingClientRect().width); save(); }
    }
  });
  new MutationObserver(() => layer.querySelectorAll('.float-panel').forEach((w) => ro.observe(w))).observe(layer, { childList: true });
}
