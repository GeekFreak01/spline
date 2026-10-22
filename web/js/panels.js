// Dock panels that can be rearranged like the panels in Photoshop. Each
// panel is a <details data-sec="id"> rendered into the right dock; after each
// render layoutPanels() moves it to where the user put it:
//
//   right  — the right dock (default)
//   left   — a column on the left side of the work area
//   top    — a strip above the work area (only panels made of button rows)
//   icons  — an icon in the strip next to the right dock; a click opens the
//            panel in a flyout
//   float  — a free window
//
// Drag a panel header (or an icon) to move it: while dragging, the place it
// will snap to is outlined. Dropped on another panel's header it joins it as
// a tab, as in Photoshop; dragging a tab out makes it a panel again. The
// Window menu shows and hides panels. The layout is kept in localStorage.

const STORE = 'spline.panels';
const DRAG_START = 6;   // px before a drag tears a panel off
const EDGE = 48;        // px from the left/top edge of the work area that dock there
const STRIP = 36;       // width of the icon strip
const LEFT_W = 260;     // width of the left column
export const TOP_ALLOWED = new Set(['pathops']);

let state = {};
try { state = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { state = {}; }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage unavailable */ } };
const st = (id) => (state[id] ||= {});

let layer = null;
let active = () => null; // { view, dock } of the current mode, or null
let labels = {};
let icons = {};
let panelIcons = {};
let onChange = () => {};
let hint = null;
let openFlyout = null;
// Panels that start as closed windows (opened from a menu), by id.
let defaults = {};

export function initPanels(opts) {
  ({ layer, active, labels, icons, panelIcons } = opts);
  onChange = opts.onChange || onChange;
  defaults = opts.defaults || {};
  for (const view of opts.views) {
    view.addEventListener('pointerdown', onZonePointerDown);
    view.addEventListener('click', onZoneClick, true);
  }
  layer.addEventListener('pointerdown', onLayerPointerDown);
  layer.addEventListener('click', onLayerClick);
  document.addEventListener('pointerdown', (e) => {
    if (openFlyout && !e.target.closest('.flyout, .panel-icon')) closeFlyout();
  });
  window.addEventListener('resize', () => layer.querySelectorAll('.float-panel:not(.flyout)').forEach(clampWindow));
  hint = document.createElement('div');
  hint.className = 'drop-hint';
  hint.hidden = true;
  layer.append(hint);
}

export const isHidden = (id) => !!(state[id]?.hidden ?? defaults[id]?.hidden);

// --- tab groups: { ids: [lead, ...], tab: active id }. The lead (first id)
// keeps the place, the rank and the window of the whole group.

const groups = () => (state._groups ||= []);
const groupOf = (id) => groups().find((g) => g.ids.includes(id));
const leadOf = (id) => groupOf(id)?.ids[0] ?? id;

function leaveGroup(id) {
  const g = groupOf(id);
  if (!g) return;
  const i = g.ids.indexOf(id);
  g.ids.splice(i, 1);
  if (i === 0 && g.ids.length) {
    // The next tab takes over the place of the group.
    const from = st(id), to = st(g.ids[0]);
    for (const k of ['place', 'float', 'rank']) {
      if (from[k] !== undefined) to[k] = JSON.parse(JSON.stringify(from[k])); else delete to[k];
    }
  }
  if (g.tab === id) g.tab = g.ids[0];
  if (g.ids.length < 2) state._groups = groups().filter((x) => x !== g);
}

// Puts panels `ids` as tabs into the group of `target`; the first becomes the
// active tab.
function joinGroup(ids, target) {
  ids = ids.filter((x) => x !== target);
  if (!ids.length) return;
  for (const id of ids) leaveGroup(id);
  let g = groupOf(target);
  if (!g) { g = { ids: [target] }; groups().push(g); }
  g.ids.push(...ids);
  g.tab = ids[0];
  for (const id of ids) st(id).hidden = false;
}

function setTab(id) {
  const g = groupOf(id);
  if (!g || g.tab === id) return;
  // The new tab is folded or unfolded like the one it replaces.
  const dock = containers()?.dock.id;
  const find = (x) => document.querySelector(`details[data-sec="${x}"][data-dock="${dock}"]`);
  const was = find(g.tab), now = find(id);
  if (was && now) now.open = was.open;
  g.tab = id;
  save();
  layoutPanels();
}

const placeOf = (id) => {
  const g = groupOf(id);
  const lead = g ? g.ids[0] : id;
  const p = state[lead]?.place || defaults[lead]?.place || (state[lead]?.float ? 'float' : 'right');
  return p === 'top' && (g || !TOP_ALLOWED.has(id)) ? 'right' : p;
};

export function setHidden(id, hidden) {
  st(id).hidden = hidden;
  if (hidden && openFlyout === id) openFlyout = null;
  save();
  layoutPanels();
  onChange();
}

// Opens a panel as a window in front (or unfolds it where it is docked),
// like Photoshop's Window menu.
export function openWindow(id) {
  const asked = id;
  st(id).hidden = false;
  const g = groupOf(id);
  if (g) { g.tab = id; id = g.ids[0]; }
  const s = st(id);
  if (!g) s.hidden = false;
  if (!s.place) s.place = defaults[id]?.place || 'right';
  if (s.place === 'float' && !s.float) {
    // Next to the right dock, each new window a step lower than the last.
    const n = [...layer.querySelectorAll('.float-panel:not(.flyout)')].filter((w) => !w.hidden).length;
    const right = containers()?.dock.getBoundingClientRect().left || innerWidth - 280;
    s.float = { x: Math.max(20, Math.round(right - 292 - n * 36)), y: 96 + n * 44, w: 280 };
  }
  save();
  layoutPanels();
  const w = layer.querySelector(`.float-panel[data-float="${id}"]`);
  if (w) { layer.insertBefore(w, hint); fitHeight(w); }
  const d = w?.querySelector(`details[data-sec="${asked}"]`) || document.querySelector(`details[data-sec="${asked}"]:not([hidden])`);
  if (d) { d.open = true; if (!w) d.scrollIntoView({ block: 'nearest' }); }
  onChange();
}

export function resetPanels() {
  state = {};
  openFlyout = null;
  save();
  layoutPanels();
  onChange();
}

function setPlace(id, place) {
  st(id).place = place;
  if (place !== 'icons' && openFlyout === id) openFlyout = null;
  save();
  layoutPanels();
  onChange();
}

// --- containers

const zone = (view, name) => view.querySelector(`[data-zone="${name}"]`);

function containers() {
  const a = active();
  if (!a) return null;
  return { ...a, left: zone(a.view, 'left'), top: zone(a.view, 'top'), icons: zone(a.view, 'icons'), center: a.view.querySelector('.center'), row: a.view.querySelector('.center-row') };
}

function windowFor(id, flyout) {
  let w = layer.querySelector(`.float-panel[data-float="${id}"]`);
  if (w && w.classList.contains('flyout') !== flyout) { w.remove(); w = null; }
  if (!w) {
    w = document.createElement('div');
    w.className = flyout ? 'float-panel flyout' : 'float-panel';
    w.dataset.float = id;
    w.setAttribute('role', 'dialog');
    w.innerHTML = `<div class="float-head"><span class="float-title"></span>
      <button type="button" class="float-btn" data-panel-dock aria-label="${labels.dock}" data-tip="${labels.dock}">${icons.dock}</button>
      <button type="button" class="float-btn" data-panel-close aria-label="${flyout ? labels.collapse : labels.close}" data-tip="${flyout ? labels.collapse : labels.close}">${flyout ? icons.collapse : icons.close}</button></div>
      <div class="float-body"></div>`;
    layer.insertBefore(w, hint);
  }
  if (!flyout) {
    const f = st(id).float || { x: 200, y: 120 };
    w.style.left = `${f.x}px`;
    w.style.top = `${f.y}px`;
    if (f.w) w.style.width = `${f.w}px`;
  }
  return w;
}

// A window never runs past the bottom of the screen: its body scrolls.
const fitHeight = (w) => { w.style.maxHeight = `${Math.max(120, innerHeight - w.getBoundingClientRect().top - 12)}px`; };

function clampWindow(w) {
  const r = w.getBoundingClientRect();
  const x = Math.min(Math.max(0, r.left), Math.max(0, innerWidth - 80));
  const y = Math.min(Math.max(0, r.top), Math.max(0, innerHeight - 30));
  w.style.left = `${x}px`;
  w.style.top = `${y}px`;
  fitHeight(w);
  const f = state[w.dataset.float]?.float;
  if (f) { f.x = x; f.y = y; }
}

// Called after the active dock is rendered: moves every panel to its place.
export function layoutPanels() {
  if (!layer) return;
  const c = containers();
  const present = new Set();
  if (c) {
    const { view, dock } = c;
    // Sections of this dock wherever they are now; after a re-render the
    // fresh copy in the dock comes first and wins over the old one.
    const own = [...dock.querySelectorAll(':scope > details[data-sec]'),
      ...view.querySelectorAll(`[data-zone] > details[data-dock="${dock.id}"]`),
      ...layer.querySelectorAll(`.float-body > details[data-dock="${dock.id}"]`)];
    const byId = new Map();
    for (const d of own) {
      const id = d.dataset.sec;
      if (byId.has(id)) { d.remove(); continue; }
      byId.set(id, d);
      d.dataset.dock = dock.id;
      const sum = d.querySelector(':scope > summary');
      if (sum && !sum.classList.contains('tabs')) d.dataset.title = sum.textContent.trim();
    }
    const titleOf = (id) => byId.get(id)?.dataset.title || '';
    // Members of a group that are in this dock, the shown ones and the active tab.
    const tabsOf = (id) => {
      const g = groupOf(id);
      const mates = g ? g.ids.filter((x) => byId.has(x)) : [id];
      const shown = mates.filter((x) => !isHidden(x));
      const tab = shown.length > 1 ? (shown.includes(g.tab) ? g.tab : shown[0]) : null;
      return { mates, shown, tab };
    };
    const iconIds = [];
    const windows = new Map();
    for (const [id, d] of byId) {
      const { shown, tab } = tabsOf(id);
      d.classList.toggle('tab-off', !!tab && id !== tab);
      const sum = d.querySelector(':scope > summary');
      if (sum) {
        if (tab === id) setTabs(sum, shown, id, titleOf);
        else if (sum.classList.contains('tabs')) { sum.classList.remove('tabs'); sum.removeAttribute('role'); sum.textContent = d.dataset.title; }
      }
      const place = placeOf(id);
      const hidden = isHidden(id);
      if (place === 'right' || place === 'left' || place === 'top') {
        const box = place === 'right' ? dock : c[place];
        d.hidden = hidden;
        if (place === 'top') d.open = true;
        if (d.parentElement !== box) box.insertBefore(d, nextIn(box, id));
        continue;
      }
      // A window (free, or the flyout of an icon), one for the whole group.
      const lead = leadOf(id);
      if (!windows.has(lead)) windows.set(lead, { place, ids: [] });
      windows.get(lead).ids.push(id);
    }
    for (const [lead, { place, ids }] of windows) {
      present.add(lead);
      const flyout = place === 'icons';
      const w = windowFor(lead, flyout);
      const { shown, tab } = tabsOf(ids[0]);
      const title = w.querySelector('.float-title');
      if (tab) setTabs(title, shown, tab, titleOf);
      else { title.classList.remove('tabs'); title.removeAttribute('role'); title.textContent = titleOf(shown[0] || ids[0]); }
      const body = w.querySelector('.float-body');
      const kids = ids.map((x) => byId.get(x));
      if (body.children.length !== kids.length || kids.some((d, i) => body.children[i] !== d)) body.replaceChildren(...kids);
      for (const d of kids) { d.hidden = isHidden(d.dataset.sec); d.open = true; }
      const hidden = !shown.length;
      w.hidden = hidden || (flyout && openFlyout !== lead);
      if (!w.hidden) fitHeight(w);
      if (flyout && !hidden) iconIds.push([lead, titleOf(tab || shown[0])]);
    }
    sortBox(dock);
    sortBox(c.left);
    iconIds.sort((a, b) => rankOf(a[0]) - rankOf(b[0]));
    c.icons.innerHTML = iconIds.map(([id, title]) => `<button type="button" class="panel-icon" data-panel-icon="${id}"
      aria-pressed="${openFlyout === id}" aria-label="${title}" data-tip="${title}">${panelIcons[id] || ''}</button>`).join('');
    if (openFlyout && present.has(openFlyout)) positionFlyout(openFlyout);
  }
  for (const w of layer.querySelectorAll('.float-panel')) {
    if (!present.has(w.dataset.float)) w.remove();
  }
}

const escHTML = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// A header turned into a row of tabs.
function setTabs(el, ids, active, titleOf) {
  el.classList.add('tabs');
  el.setAttribute('role', 'tablist');
  el.innerHTML = ids.map((x) => `<span class="tab" role="tab" data-tab="${x}" aria-selected="${x === active}" data-tip="${escHTML(titleOf(x))}">${escHTML(titleOf(x))}</span>`).join('');
}

// --- icon strip and flyouts

function positionFlyout(id) {
  const c = containers();
  const w = layer.querySelector(`.float-panel[data-float="${id}"]`);
  const btn = c?.icons.querySelector(`[data-panel-icon="${id}"]`);
  if (!w || !btn) return;
  const b = btn.getBoundingClientRect(), bar = c.icons.getBoundingClientRect();
  const width = w.getBoundingClientRect().width || 260;
  w.style.left = `${Math.max(0, bar.left - width - 4)}px`;
  w.style.top = `${Math.max(0, Math.min(b.top, innerHeight - w.getBoundingClientRect().height - 30))}px`;
  fitHeight(w);
}

function toggleFlyout(id) {
  openFlyout = openFlyout === id ? null : id;
  layoutPanels();
}

function closeFlyout() {
  openFlyout = null;
  layoutPanels();
}

// --- dragging

function onZonePointerDown(e) {
  if (e.button !== 0) return;
  const icon = e.target.closest('[data-panel-icon]');
  const sum = !icon && e.target.closest('[data-zone] > details[data-sec] > summary, .dock > details[data-sec] > summary');
  if ((!icon && !sum) || (sum && e.target.closest('button'))) return;
  // A tab tears off alone; the rest of a header moves the whole group.
  const tab = sum && e.target.closest('[data-tab]');
  const id = icon ? icon.dataset.panelIcon : tab ? tab.dataset.tab : leadOf(sum.parentElement.dataset.sec);
  const from = (icon || sum).getBoundingClientRect();
  startDrag(e, id, { x: from.left, y: from.top, w: Math.max(240, Math.round(sum ? from.width : 260)) }, false, !!tab);
}

function onLayerPointerDown(e) {
  const head = e.target.closest('.float-head');
  if (!head || e.button !== 0 || e.target.closest('button')) return;
  e.preventDefault();
  const w = head.parentElement;
  const r = w.getBoundingClientRect();
  const tab = e.target.closest('[data-tab]');
  if (tab) startDrag(e, tab.dataset.tab, { x: r.left, y: r.top, w: Math.round(r.width) }, false, true);
  else startDrag(e, w.dataset.float, { x: r.left, y: r.top, w: Math.round(r.width) }, true);
}

// Drags a panel: it turns into a free window once the pointer has moved a
// little, and on release snaps to the outlined place.
function startDrag(e, id, from, isWindow, tear = false) {
  const x0 = e.clientX, y0 = e.clientY;
  let w = isWindow ? layer.querySelector(`.float-panel[data-float="${id}"]`) : null;
  let moved = false;
  const move = (ev) => {
    if (!moved) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START) return;
      moved = true;
      if (tear) { leaveGroup(id); w = null; }
      if (!w || w.classList.contains('flyout')) {
        st(id).float = { x: from.x, y: from.y, w: from.w };
        st(id).place = 'float';
        if (openFlyout === id) openFlyout = null;
        layoutPanels();
        w = layer.querySelector(`.float-panel[data-float="${id}"]`);
        if (!w) { cleanup(); return; }
      }
      w.classList.add('dragging');
      layer.insertBefore(w, hint); // to the front
    }
    w.style.left = `${from.x + ev.clientX - x0}px`;
    w.style.top = `${from.y + ev.clientY - y0}px`;
    showHint(dropTarget(id, ev));
  };
  const up = (ev) => {
    cleanup();
    if (!moved) return;
    // The click that ends the drag must not fold the panel or open a flyout.
    const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    const target = dropTarget(id, ev);
    showHint(null);
    w?.classList.remove('dragging');
    if (target?.join) {
      joinGroup(groupOf(id)?.ids.slice() || [id], target.join);
      save();
      layoutPanels();
      onChange();
      return;
    }
    if (target) {
      if (target.container) placeAt(id, target.container, target.before);
      setPlace(id, target.place);
      return;
    }
    if (w) {
      clampWindow(w);
      const r = w.getBoundingClientRect();
      st(id).float = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
    }
    st(id).place = 'float';
    save();
    onChange();
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

const inside = (r, x, y) => r && r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

// Where a panel dropped at the pointer would go, with the outline to show.
function dropTarget(id, ev) {
  const c = containers();
  if (!c || !c.center) return null;
  const x = ev.clientX, y = ev.clientY;
  // On another panel's header: join it as a tab.
  const el = document.elementsFromPoint(x, y).find((n) => !n.closest('.float-panel.dragging, .drop-hint'));
  const head = el?.closest('.float-panel:not(.flyout) > .float-head, .dock > details[data-sec] > summary, [data-zone="left"] > details[data-sec] > summary');
  if (head) {
    const other = head.classList.contains('float-head') ? head.parentElement.dataset.float : head.parentElement.dataset.sec;
    if (leadOf(other) !== leadOf(id)) return { join: other, box: head.getBoundingClientRect() };
  }
  const dockR = c.dock.getBoundingClientRect();
  const rowR = c.row.getBoundingClientRect();
  const centerR = c.center.getBoundingClientRect();
  const iconsR = c.icons.childElementCount ? c.icons.getBoundingClientRect()
    : rect(rowR.right - STRIP, rowR.top, STRIP, rowR.height);
  if (inside(iconsR, x, y)) return { place: 'icons', box: iconsR };
  if (inside(dockR, x, y)) return insertion(id, 'right', c.dock, dockR, y);
  if (TOP_ALLOWED.has(id)) {
    const topR = c.top.childElementCount ? c.top.getBoundingClientRect() : rect(centerR.left, centerR.top, centerR.width, 40);
    if (inside(rect(centerR.left, centerR.top, centerR.width, Math.max(EDGE, topR.height)), x, y)) return { place: 'top', box: topR };
  }
  const leftR = c.left.childElementCount ? c.left.getBoundingClientRect() : rect(rowR.left, rowR.top, LEFT_W, rowR.height);
  if (inside(rect(rowR.left, rowR.top, Math.max(EDGE, c.left.childElementCount ? leftR.width : 0), rowR.height), x, y)) {
    return c.left.childElementCount ? insertion(id, 'left', c.left, leftR, y) : { place: 'left', box: leftR };
  }
  return null;
}

// Inside a column the hint is a line between sections: the panel goes there.
function insertion(id, place, box, r, y) {
  const secs = [...box.querySelectorAll(':scope > details[data-sec]')].filter((d) => d.dataset.sec !== id && !d.hidden && !d.classList.contains('tab-off'));
  let before = null, lineY = r.top;
  for (const d of secs) {
    const b = d.getBoundingClientRect();
    if (y < b.top + b.height / 2) { before = d.dataset.sec; lineY = b.top; break; }
    lineY = b.bottom;
  }
  return { place, container: box, before, box: rect(r.left + 4, Math.max(r.top, lineY - 2), r.width - 8, 4) };
}

function showHint(target) {
  if (!hint) return;
  hint.hidden = !target;
  if (!target) return;
  const b = target.box;
  Object.assign(hint.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
}

// --- order

// Sort key of a section: where the user put it, else the render order.
// Tabs of a group follow their lead.
const baseRank = (id) => state[id]?.rank ?? order.get(id);
const rankOf = (id) => {
  const g = groupOf(id);
  if (!g) return baseRank(id) ?? 99;
  const lead = g.ids.map(baseRank).find((r) => r !== undefined) ?? 99;
  return lead + (g.ids.indexOf(id) + 1) / 100;
};

// The section a returning panel goes before, to keep the order.
function nextIn(box, id) {
  return [...box.querySelectorAll(':scope > details[data-sec]')]
    .find((x) => rankOf(x.dataset.sec) > rankOf(id)) || null;
}

// Puts the sections of a column in the user's order (when there is one).
function sortBox(box) {
  const kids = [...box.querySelectorAll(':scope > details[data-sec]')];
  if (!groups().length && !kids.some((d) => state[d.dataset.sec]?.rank !== undefined)) return;
  const sorted = [...kids].sort((a, b) => rankOf(a.dataset.sec) - rankOf(b.dataset.sec));
  if (sorted.every((d, i) => d === kids[i])) return;
  const anchor = kids[kids.length - 1].nextSibling;
  for (const d of sorted) box.insertBefore(d, anchor);
}

// Drops panel id into a column before section `before` (null = at the
// end): every section there gets a rank, so the order stays.
function placeAt(id, box, before) {
  id = leadOf(id);
  const ids = [...new Set([...box.querySelectorAll(':scope > details[data-sec]')].map((d) => leadOf(d.dataset.sec)))].filter((x) => x !== id);
  const at = before ? ids.indexOf(leadOf(before)) : -1;
  ids.splice(at < 0 ? ids.length : at, 0, id);
  ids.forEach((x, i) => { st(x).rank = i; });
}

// Order of the sections in the dock, recorded on each render.
const order = new Map();
export function recordOrder(dock) {
  [...dock.querySelectorAll(':scope > details[data-sec]')].forEach((d, i) => order.set(d.dataset.sec, i));
}

// --- clicks

function onZoneClick(e) {
  const icon = e.target.closest('[data-panel-icon]');
  if (icon) { toggleFlyout(icon.dataset.panelIcon); return; }
  // A tab: another one is picked; the active one folds the group as usual.
  const tab = e.target.closest('summary [data-tab]');
  if (tab && tab.getAttribute('aria-selected') !== 'true') { e.preventDefault(); setTab(tab.dataset.tab); return; }
  // The top strip has no folding.
  if (e.target.closest('[data-zone="top"] > details > summary')) e.preventDefault();
}

function onLayerClick(e) {
  const w = e.target.closest('.float-panel');
  if (!w) return;
  const id = w.dataset.float;
  const tab = e.target.closest('[data-tab]');
  if (tab) { setTab(tab.dataset.tab); return; }
  if (e.target.closest('[data-panel-close]')) {
    if (w.classList.contains('flyout')) closeFlyout();
    else {
      for (const x of groupOf(id)?.ids || [id]) st(x).hidden = true;
      setHidden(id, true);
    }
  } else if (e.target.closest('[data-panel-dock]')) setPlace(id, 'right');
  else if (e.target.closest('.float-body > details > summary')) e.preventDefault(); // stays open
}

// Remembers widths changed with the resize grip.
export function watchResize() {
  if (!layer || typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver((entries) => {
    for (const en of entries) {
      if (en.target.classList.contains('flyout')) continue;
      const f = state[en.target.dataset.float]?.float;
      if (f && en.target.isConnected && en.contentRect.width > 0 && !en.target.classList.contains('dragging')) { f.w = Math.round(en.target.getBoundingClientRect().width); save(); }
    }
  });
  new MutationObserver(() => layer.querySelectorAll('.float-panel').forEach((w) => ro.observe(w))).observe(layer, { childList: true });
}
