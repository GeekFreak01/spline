import { t, setLang, getLang, onLangChange, applyStatic } from './i18n.js';
import { icon, fillIcons } from './icons.js';
import { CATEGORIES, COLORS } from './glyphsets.js';
import {
  newProject, validateProject, serialize, addGlyphForChar, charOf, isDrawn, svgPath, glyphBox,
  translateGlyph, normalizeDirections,
} from './model.js';
import { History, KERNING } from './history.js';
import { KernView, setKern, deleteKern, kernPairs, effectiveKern, isGroup, groupKey, groupMembers } from './kerning.js';
import { Editor } from './editor.js';
import { importSVG, looksLikeSVG } from './svg.js';
import { setDefaults, keyLabel, comboOf, comboLabel, actionFor, assign, resetAll, bindings, isCustom, BROWSER_RESERVED, TAKEN } from './keys.js';
import { initPanels, layoutPanels, setHidden, isHidden, resetPanels, recordOrder, watchResize } from './panels.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const AUTOSAVE_KEY = 'spline.autosave';
const isMac = /Mac/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

// Default shortcuts; the user can change them in Help → Keyboard Shortcuts.
setDefaults({
  new: [], open: ['Ctrl+O'], save: ['Ctrl+S'], saveAs: ['Ctrl+Shift+S'], importSvg: [], exportTTF: [], exportOTF: [],
  undo: ['Ctrl+Z'], redo: ['Ctrl+Shift+Z', 'Ctrl+Y'], selectAll: ['Ctrl+A'], freeTransform: ['Ctrl+T'],
  zoomIn: ['=', 'Shift+=', 'Num +'], zoomOut: ['-', 'Num -'], zoomFit: ['0', 'Num 0'],
  viewKerning: ['Ctrl+K'], rulers: ['Ctrl+R'], userGuides: ['Ctrl+;'], showGuide: [], showGrid: [],
  snapGrid: ['F9'], snapGuides: ['F10'], prev: ['PageUp'], next: ['PageDown'],
  'tool.select': ['V'], 'tool.pen': ['P'], 'tool.brush': ['B'], 'tool.eraser': ['E'],
  'tool.rect': ['R'], 'tool.ellipse': ['O'], 'tool.knife': ['K'], 'tool.hand': ['H'],
  'op.unite': ['Ctrl+Alt+U'], 'op.subtract': ['Ctrl+Alt+M'], 'op.intersect': ['Ctrl+Alt+I'],
  'op.exclude': ['Ctrl+Alt+E'], 'op.divide': ['Ctrl+Alt+D'], 'op.removeOverlap': ['Ctrl+Alt+O'],
  autoSpacing: [], flipH: [], flipV: [], fontInfo: [], shortcuts: ['F1'],
});

const TOOLS = [
  { id: 'select', icon: 'select', key: 'V' },
  { id: 'pen', icon: 'pen', key: 'P' },
  { id: 'brush', icon: 'brush', key: 'B' },
  { id: 'eraser', icon: 'eraser', key: 'E' },
  { id: 'rect', icon: 'rect', key: 'R' },
  { id: 'ellipse', icon: 'ellipse', key: 'O' },
  { id: 'knife', icon: 'knife', key: 'K' },
  { id: 'hand', icon: 'hand', key: 'H' },
];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const toolName = (id) => t('tool' + cap(id));
const toolTip = (id) => t('tip' + cap(id));

const app = {
  project: null,
  history: new History(),
  selected: new Set(), // glyph names
  anchor: null,
  focusName: null,
  category: 'all',
  colorFilter: null,
  search: '',
  mode: 'grid',
  current: null,
  dirty: false,
  fileHandle: null,
  serverFile: null,
  fileName: null,
};

// ================================================================ helpers

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = icon(kind === 'error' ? 'alert' : 'check', 16) + `<span>${esc(msg)}</span>`;
  $('toasts').append(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); }, kind === 'error' ? 6000 : 2500);
}

// Modal dialog. Resolves with FormData (OK) or null (cancel).
function showDialog({ title, body, okLabel = t('ok'), okClass = 'btn-primary', cancel = true }) {
  const dlg = $('dialog');
  dlg.innerHTML = `<form method="dialog">
    <h2>${esc(title)}</h2>
    <div class="body">${body}</div>
    <div class="actions">
      ${cancel ? `<button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>` : ''}
      <button class="btn ${okClass}" value="ok">${esc(okLabel)}</button>
    </div>
  </form>`;
  return new Promise((resolve) => {
    const form = dlg.querySelector('form');
    let data = null;
    form.addEventListener('submit', (e) => { if (e.submitter?.value === 'ok') data = new FormData(form); });
    dlg.addEventListener('close', () => resolve(data), { once: true });
    dlg.showModal();
    const first = dlg.querySelector('input:not([type=checkbox])');
    if (first) { first.focus(); first.select?.(); }
  });
}

async function confirmDialog(msg, okLabel, danger = true) {
  return !!(await showDialog({ title: msg, body: '', okLabel, okClass: danger ? 'btn-danger' : 'btn-primary' }));
}

function glyphSVG(g, cls = 'glyph') {
  const { ascender: asc, descender: desc } = app.project.info;
  const b = glyphBox(g);
  const minX = Math.min(0, b ? b.minX : 0), maxX = Math.max(g.advance, b ? b.maxX : 0, 1);
  const top = Math.max(asc, b ? b.maxY : 0), bottom = Math.min(desc, b ? b.minY : 0);
  const pad = 30;
  return `<svg class="${cls}" viewBox="${minX - pad} ${-top - pad} ${maxX - minX + 2 * pad} ${top - bottom + 2 * pad}" aria-hidden="true">
    <path transform="scale(1 -1)" d="${svgPath(g)}" fill="currentColor"/></svg>`;
}

const findGlyph = (name) => app.project.glyphs.find((g) => g.name === name);
const hex = (g) => (g.unicode ? g.unicode.toString(16).toUpperCase().padStart(4, '0') : '');
const selectedGlyphs = () => [...app.selected].map(findGlyph).filter(Boolean);

// ================================================================ project state

function setProject(p, { fileName = null, fileHandle = null, serverFile = null } = {}) {
  app.project = p;
  app.fileName = fileName;
  app.fileHandle = fileHandle;
  app.serverFile = serverFile;
  app.history.clear();
  app.selected.clear();
  app.focusName = p.glyphs[0]?.name ?? null;
  setDirty(false);
  showGrid(false);
  renderAll();
  schedulePreview(0);
}

function setDirty(v) {
  app.dirty = v;
  $('dirtyDot').hidden = !v;
  updateTitle();
}

// Page title; inside the desktop window it also becomes the window title.
function updateTitle() {
  if (!app.project) return;
  const title = `${app.dirty ? '• ' : ''}${app.fileName || app.project.info.familyName} — Spline`;
  document.title = title;
  window.splineSetTitle?.(title);
}

let autosaveTimer;
function markChanged() {
  setDirty(true);
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, 700);
  schedulePreview();
}

function autosave() {
  store.set(AUTOSAVE_KEY, JSON.stringify({ fileName: app.fileName, project: serialize(app.project) }));
}

// Editor callbacks.
app.commitGlyph = () => { markChanged(); updateMetricInputs(); };
app.onGlyphMetricsChanged = () => updateMetricInputs();
app.onCursor = (p) => { $('statusPos').textContent = p ? `X ${Math.round(p.x)}   Y ${Math.round(p.y)}` : ''; };
app.onZoom = (s) => { $('statusZoom').textContent = `${Math.round(s * 100)}%`; };

function renderAll() {
  $('fontName').textContent = app.fileName ? `${app.project.info.familyName} — ${app.fileName}` : app.project.info.familyName;
  updateTitle();
  renderMenus();
  if (app.mode === 'grid') {
    renderSidebar();
    renderGrid();
    renderInspector();
    renderGridOptions();
  }
  updateStatus();
}

function updateStatus() {
  $('statusTip').textContent = app.mode === 'editor' ? (editor.xform ? t('tipTransform') : toolTip(editor.tool))
    : app.mode === 'kern' ? t('tipKern') : t('tipGrid');
  $('statusInfo').textContent = t('selectedCount', {
    sel: app.selected.size, n: visibleGlyphs().length, total: app.project.glyphs.length,
  });
  if (app.mode === 'grid') { $('statusPos').textContent = ''; $('statusZoom').textContent = ''; }
}

// ================================================================ menus

function menuDefs() {
  const inEditor = app.mode === 'editor';
  const hasSel = inEditor ? editor.sel.size > 0 : app.selected.size > 0;
  const theme = document.documentElement.dataset.theme;
  return [
    { id: 'menuFile', items: [
      { label: 'new', key: keyLabel('new'), run: newFontDialog },
      { label: 'open', key: keyLabel('open'), run: openDialog },
      '-',
      { label: 'importSvg', key: keyLabel('importSvg'), run: () => pickFiles('svg') },
      { label: 'importSp', run: () => pickFiles('import') },
      '-',
      { label: 'save', key: keyLabel('save'), run: () => save() },
      { label: 'saveAs', key: keyLabel('saveAs'), run: () => save(true) },
      '-',
      { label: 'exportTTF', key: keyLabel('exportTTF'), run: () => exportFont('ttf') },
      { label: 'exportOTF', key: keyLabel('exportOTF'), run: () => exportFont('otf') },
      ...(app.platform?.canAssociate ? ['-', { label: 'associate', check: app.platform.associated, run: associateFiles }] : []),
    ] },
    { id: 'menuEdit', items: [
      { label: 'undo', key: keyLabel('undo'), run: undo, enabled: app.history.undoStack.length > 0 },
      { label: 'redo', key: keyLabel('redo'), run: redo, enabled: app.history.redoStack.length > 0 },
      '-',
      { label: 'cut', key: `${MOD}X`, run: () => document.execCommand('cut'), enabled: inEditor && hasSel },
      { label: 'copy', key: `${MOD}C`, run: () => document.execCommand('copy'), enabled: hasSel || inEditor },
      { label: 'paste', key: `${MOD}V`, run: pasteFromMenu },
      '-',
      { label: 'selectAll', key: keyLabel('selectAll'), run: selectAll },
      { label: 'freeTransform', key: keyLabel('freeTransform'), run: startTransform, enabled: inEditor },
      { label: 'delete', key: 'Del', run: deleteSelection, enabled: hasSel },
    ] },
    { id: 'menuView', items: [
      { label: 'zoomIn', key: keyLabel('zoomIn'), run: () => editor.zoomBy(1.25), enabled: inEditor },
      { label: 'zoomOut', key: keyLabel('zoomOut'), run: () => editor.zoomBy(0.8), enabled: inEditor },
      { label: 'zoomFit', key: keyLabel('zoomFit'), run: () => editor.fit(), enabled: inEditor },
      '-',
      { label: 'viewKerning', key: keyLabel('viewKerning'), check: app.mode === 'kern', run: () => (app.mode === 'kern' ? showGrid() : showKern()) },
      '-',
      { label: 'rulers', key: keyLabel('rulers'), check: editor.showRulers, run: () => toggleView('showRulers') },
      { label: 'userGuides', key: keyLabel('userGuides'), check: editor.showUserGuides, run: () => toggleView('showUserGuides') },
      { label: 'clearGuides', run: clearGuides, enabled: (app.project?.guides?.length || 0) > 0 },
      '-',
      { label: 'showGuide', key: keyLabel('showGuide'), check: editor.showGuide, run: () => toggleView('showGuide') },
      { label: 'showGrid', key: keyLabel('showGrid'), check: editor.showGrid, run: () => toggleView('showGrid') },
      { label: 'snapGrid', key: keyLabel('snapGrid'), check: editor.snapGrid, run: () => toggleView('snapGrid') },
      { label: 'snapGuides', key: keyLabel('snapGuides'), check: editor.snapGuides, run: () => toggleView('snapGuides') },
      '-',
      { label: 'themeDark', check: theme === 'dark', run: () => setTheme('dark') },
      { label: 'themeLight', check: theme === 'light', run: () => setTheme('light') },
      '-',
      { text: 'Русский', check: getLang() === 'ru', run: () => setLang('ru') },
      { text: 'English', check: getLang() === 'en', run: () => setLang('en') },
    ] },
    { id: 'menuGlyph', items: [
      { label: 'addGlyph', run: addGlyphs },
      { label: 'drawGlyph', key: 'Enter', run: () => openEditor([...app.selected][0]), enabled: !inEditor && app.selected.size === 1 },
      { label: 'deleteGlyph', run: deleteSelectedGlyphs, enabled: !inEditor && app.selected.size > 0 },
      '-',
      { label: 'autoSpacing', key: keyLabel('autoSpacing'), run: () => glyphAction('spacing'), enabled: inEditor || app.selected.size > 0 },
      { label: 'flipH', key: keyLabel('flipH'), run: () => applyTransform('flipH'), enabled: inEditor || app.selected.size > 0 },
      { label: 'flipV', key: keyLabel('flipV'), run: () => applyTransform('flipV'), enabled: inEditor || app.selected.size > 0 },
      { label: 'clear', run: () => glyphAction('clear'), enabled: inEditor },
      '-',
      ...PATH_OPS.map((op) => ({ label: op.label, key: keyLabel(`op.${op.id}`), run: () => runPathOp(op.id), enabled: inEditor })),
      '-',
      { label: 'fontInfo', key: keyLabel('fontInfo'), run: editFontInfo },
    ] },
    { id: 'menuWindow', items: [
      ...PANELS.map(([id, label]) => ({ label, check: !isHidden(id), run: () => setHidden(id, !isHidden(id)) })),
      { label: 'preview', check: !$('preview').hidden, run: () => setPreviewHidden(!$('preview').hidden) },
      '-',
      { label: 'resetPanels', run: () => { resetPanels(); setPreviewHidden(false); } },
    ] },
    { id: 'menuHelp', items: [
      { label: 'shortcuts', key: keyLabel('shortcuts'), run: helpDialog },
      ...(app.platform?.web ? [
        { label: 'downloadDesktop', run: () => openPage('releases') },
        ...(app.platform.privacy ? [{ label: 'privacy', run: () => window.open('/privacy.html', '_blank', 'noopener') }] : []),
      ] : [{ label: 'checkUpdates', run: () => checkUpdates(true) }]),
      { label: 'about', run: () => openPage('github') },
    ] },
  ];
}

let openMenu = null; // index of the open menu

function renderMenus() {
  const defs = menuDefs();
  $('menus').innerHTML = defs.map((m, i) => `<div class="menu-root">
    <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="${openMenu === i}" data-menu="${i}">${esc(t(m.id))}</button>
    <div class="menu" role="menu" ${openMenu === i ? '' : 'hidden'}>
      ${m.items.map((it, j) => (it === '-' ? '<hr>' : `<button type="button" role="${it.check !== undefined ? 'menuitemcheckbox' : 'menuitem'}"
        ${it.check !== undefined ? `aria-checked="${!!it.check}"` : ''} data-item="${i}:${j}" ${it.enabled === false ? 'disabled' : ''}>
        <span>${it.check ? icon('check', 14) : ''}</span><span>${esc(it.text || t(it.label))}</span><kbd>${esc(it.key || '')}</kbd></button>`)).join('')}
    </div></div>`).join('');
}

function setMenu(i, focusFirst = false) {
  openMenu = i;
  renderMenus();
  if (i !== null) {
    const btn = $('menus').querySelector(`[data-menu="${i}"]`);
    if (focusFirst) btn.parentElement.querySelector('.menu [role^="menuitem"]:not(:disabled)')?.focus();
    else btn.focus();
  }
}

$('menus').addEventListener('click', (e) => {
  const root = e.target.closest('[data-menu]');
  if (root) { setMenu(openMenu === Number(root.dataset.menu) ? null : Number(root.dataset.menu)); return; }
  const item = e.target.closest('[data-item]');
  if (!item || item.disabled) return;
  const [i, j] = item.dataset.item.split(':').map(Number);
  const def = menuDefs()[i].items[j];
  setMenu(null);
  def.run();
});
$('menus').addEventListener('mouseover', (e) => {
  const root = e.target.closest('[data-menu]');
  if (root && openMenu !== null && Number(root.dataset.menu) !== openMenu) setMenu(Number(root.dataset.menu));
});
$('menus').addEventListener('keydown', (e) => {
  const count = menuDefs().length;
  const items = [...$('menus').querySelectorAll('.menu:not([hidden]) [role^="menuitem"]:not(:disabled)')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); if (openMenu === null) setMenu(Number(e.target.dataset.menu ?? 0), true); else items[(i + 1) % items.length]?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); setMenu(((openMenu ?? 0) + 1) % count, true); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); setMenu(((openMenu ?? 0) - 1 + count) % count, true); }
  if (e.key === 'Escape') { e.preventDefault(); const k = openMenu; setMenu(null); if (k !== null) $('menus').querySelector(`[data-menu="${k}"]`)?.focus(); }
});
document.addEventListener('pointerdown', (e) => { if (openMenu !== null && !e.target.closest('#menus')) setMenu(null); });

function toggleView(prop) {
  editor[prop] = !editor[prop];
  store.set(`spline.${prop}`, editor[prop] ? '1' : '0');
  editor.render();
  if (app.mode === 'editor') renderEditorOptions();
  renderMenus();
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set('spline.theme', theme);
  editor.render();
  renderMenus();
}

// ================================================================ tooltips

let tipTimer;
function showTip(el) {
  const tip = $('tooltip');
  const text = el.dataset.tip;
  if (!text) return;
  tip.innerHTML = esc(text) + (el.dataset.key ? `<kbd>${esc(el.dataset.key)}</kbd>` : '');
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  const left = el.closest('.toolstrip') ? r.right + 6 : Math.min(window.innerWidth - tr.width - 4, Math.max(4, r.left + r.width / 2 - tr.width / 2));
  const top = el.closest('.toolstrip') ? r.top + r.height / 2 - tr.height / 2 : r.bottom + 6;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
function hideTip() { clearTimeout(tipTimer); $('tooltip').hidden = true; }
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest('[data-tip]');
  hideTip();
  if (el) tipTimer = setTimeout(() => showTip(el), 450);
});
document.addEventListener('focusin', (e) => { hideTip(); if (e.target.matches?.('[data-tip]:focus-visible')) showTip(e.target); });
document.addEventListener('pointerdown', hideTip);

// ================================================================ sidebar

function groupOf(ch) {
  return CATEGORIES.slice(1).find((c) => c.test(ch))?.id ?? 'other';
}

function grouped() { return app.category === 'all' && !app.search.trim() && !app.colorFilter; }

function visibleGlyphs() {
  const cat = CATEGORIES.find((c) => c.id === app.category);
  const q = app.search.trim().toLowerCase();
  const list = app.project.glyphs.filter((g) => {
    const ch = charOf(g);
    if (app.category === 'empty') { if (isDrawn(g)) return false; } else if (app.category === 'done') {
      if (!isDrawn(g)) return false;
    } else if (cat && !cat.test(ch)) return false;
    if (app.colorFilter && g.color !== app.colorFilter) return false;
    if (q) {
      const h = g.unicode ? g.unicode.toString(16) : '';
      if (!(ch.toLowerCase() === q || g.name.toLowerCase().includes(q) || h === q.replace(/^(u\+|0+)/, ''))) return false;
    }
    return true;
  });
  if (!grouped()) return list;
  const order = CATEGORIES.slice(1).map((c) => c.id);
  return list
    .map((g, i) => ({ g, i, k: order.indexOf(groupOf(charOf(g))) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.g);
}

function renderSidebar() {
  const glyphs = app.project.glyphs;
  const drawn = glyphs.filter(isDrawn).length;
  $('progressLabel').textContent = t('progress', { n: drawn, total: glyphs.length });
  $('progressFill').style.width = `${glyphs.length ? (drawn / glyphs.length) * 100 : 0}%`;

  const items = [
    ...CATEGORIES.map((c) => ({ id: c.id, n: glyphs.filter((g) => c.test(charOf(g))).length })),
    { id: 'empty', n: glyphs.length - drawn },
    { id: 'done', n: drawn },
  ].filter((c) => c.n > 0 || c.id === 'all' || c.id === app.category);
  $('catList').innerHTML = items.map((c) => `<button type="button" data-cat="${c.id}" aria-current="${c.id === app.category}">
      <span>${esc(t(c.id))}</span><span class="count">${c.n}</span></button>`).join('');

  $('colorFilter').innerHTML = COLORS.map((c) => `<button type="button" class="swatch" data-color="${c}"
      style="background:var(--dot-${c})" aria-pressed="${app.colorFilter === c}" data-tip="${esc(t('colorNames')[c])}"
      aria-label="${esc(t('colorNames')[c])}"></button>`).join('');
  renderSideMetrics();
}

$('catList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  app.category = b.dataset.cat;
  renderSidebar();
  renderGrid();
  updateStatus();
});
$('colorFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (!b) return;
  app.colorFilter = app.colorFilter === b.dataset.color ? null : b.dataset.color;
  renderSidebar();
  renderGrid();
  updateStatus();
});

// Glyphs-style metrics widget: left sidebearing | width | right sidebearing.
function metricInputs(g) {
  const box = glyphBox(g);
  return `<div class="metrics-widget">
    <label><span>${esc(t('lsb'))}</span><input type="number" step="1" data-metric="lsb" value="${box ? Math.round(box.minX) : ''}" ${box ? '' : 'disabled'}></label>
    <label><span>${esc(t('width'))}</span><input type="number" step="1" min="0" data-metric="advance" value="${Math.round(g.advance)}"></label>
    <label><span>${esc(t('rsb'))}</span><input type="number" step="1" data-metric="rsb" value="${box ? Math.round(g.advance - box.maxX) : ''}" ${box ? '' : 'disabled'}></label>
  </div>`;
}

function renderSideMetrics() {
  const el = $('sideMetrics');
  const sel = selectedGlyphs();
  el.innerHTML = sel.length === 1
    ? `<div class="sub-head">${esc(charOf(sel[0]).trim() || sel[0].name)} · ${esc(sel[0].name)}</div>${metricInputs(sel[0])}`
    : '';
}

function applyMetric(g, role, v) {
  if (!Number.isFinite(v)) return;
  const box = glyphBox(g);
  app.history.push(g);
  if (role === 'advance') g.advance = Math.max(0, Math.round(v));
  if (role === 'lsb' && box) { const d = Math.round(v - box.minX); translateGlyph(g, d, 0); g.advance = Math.max(0, g.advance + d); }
  if (role === 'rsb' && box) g.advance = Math.max(0, Math.round(box.maxX + v));
}

function onMetricChange(e) {
  const role = e.target.dataset.metric;
  if (!role) return;
  const g = app.mode === 'editor' ? app.current : selectedGlyphs()[0];
  if (!g) return;
  applyMetric(g, role, Number(e.target.value));
  if (app.mode === 'editor') { editor.afterEdit(false); } else { markChanged(); updateTile(g); renderSideMetrics(); renderInspector(); }
}
$('sideMetrics').addEventListener('change', onMetricChange);

// ================================================================ grid

function tileHTML(g) {
  const ch = charOf(g);
  const drawn = g.contours.length > 0;
  const body = drawn || g.unicode === 32 ? glyphSVG(g) : `<span class="ghost" aria-hidden="true">${esc(ch)}</span>`;
  const label = ch && ch.trim() ? `${ch} ${g.name} ${hex(g)}` : `${g.name} ${hex(g)}`;
  return `<button type="button" class="tile${drawn ? ' drawn' : ''}" role="option" data-name="${esc(g.name)}"
      ${g.color ? `data-color="${g.color}"` : ''} aria-selected="${app.selected.has(g.name)}"
      tabindex="${g.name === app.focusName ? 0 : -1}" aria-label="${esc(label)}">
      ${body}<span class="label"><span>${esc(g.name)}</span><span class="code">${hex(g)}</span></span></button>`;
}

function renderGrid() {
  const list = visibleGlyphs();
  if (list.length && !list.some((g) => g.name === app.focusName)) app.focusName = list[0].name;
  if (!list.length) { $('glyphGrid').innerHTML = '<p class="grid-empty">—</p>'; return; }
  let html = '', group = null;
  for (const g of list) {
    if (grouped()) {
      const k = groupOf(charOf(g));
      if (k !== group) { group = k; html += `<h2 class="grid-section">${esc(t(k))}</h2>`; }
    }
    html += tileHTML(g);
  }
  $('glyphGrid').innerHTML = html;
}

function updateTile(g) {
  const el = $('glyphGrid').querySelector(`[data-name="${CSS.escape(g.name)}"]`);
  if (el) el.outerHTML = tileHTML(g);
}

function selectGlyph(name, e = {}) {
  const list = visibleGlyphs().map((g) => g.name);
  if (e.shiftKey && app.anchor && list.includes(app.anchor)) {
    const [a, b] = [list.indexOf(app.anchor), list.indexOf(name)].sort((x, y) => x - y);
    app.selected = new Set(list.slice(a, b + 1));
  } else if (e.ctrlKey || e.metaKey) {
    if (app.selected.has(name)) app.selected.delete(name); else app.selected.add(name);
    app.anchor = name;
  } else {
    app.selected = new Set([name]);
    app.anchor = name;
  }
  app.focusName = name;
  $('glyphGrid').querySelectorAll('.tile').forEach((el) => {
    el.setAttribute('aria-selected', app.selected.has(el.dataset.name));
    el.tabIndex = el.dataset.name === name ? 0 : -1;
  });
  renderInspector();
  renderSideMetrics();
  updateStatus();
}

$('glyphGrid').addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (tile) selectGlyph(tile.dataset.name, e);
});
$('glyphGrid').addEventListener('dblclick', (e) => {
  const tile = e.target.closest('.tile');
  if (tile) openEditor(tile.dataset.name);
});
$('glyphGrid').addEventListener('keydown', (e) => {
  const list = visibleGlyphs();
  if (!list.length) return;
  let i = list.findIndex((g) => g.name === app.focusName);
  const tiles = [...$('glyphGrid').querySelectorAll('.tile')];
  const top = tiles[0]?.offsetTop;
  const cols = Math.max(1, tiles.findIndex((el) => el.offsetTop !== top) === -1 ? tiles.length : tiles.findIndex((el) => el.offsetTop !== top));
  const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -1e9, End: 1e9 };
  if (e.key in moves) {
    e.preventDefault();
    i = Math.max(0, Math.min(list.length - 1, i + moves[e.key]));
    selectGlyph(list[i].name, { shiftKey: e.shiftKey });
    const el = $('glyphGrid').querySelector(`[data-name="${CSS.escape(list[i].name)}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && app.focusName) {
    e.preventDefault();
    openEditor(app.focusName);
  }
});

function renderGridOptions() {
  const size = store.get('spline.tile', '96');
  $('optionsBar').innerHTML = `
    <div class="group"><label><span class="sr-only">${esc(t('search'))}</span>${icon('search', 15)}
      <input type="search" id="searchInput" placeholder="${esc(t('search'))}" value="${esc(app.search)}" autocomplete="off"></label></div>
    <div class="sep"></div>
    <div class="group">
      <button class="btn" type="button" data-cmd="addGlyph">${icon('plus', 15)}<span>${esc(t('addGlyph'))}</span></button>
      <button class="btn" type="button" data-cmd="importSvg">${icon('open', 15)}<span>${esc(t('importSvg'))}</span></button>
    </div>
    <div class="glyph-nav"><label>${esc(t('tileSize'))}<input type="range" id="tileSize" min="56" max="200" value="${esc(size)}"></label></div>`;
  $('glyphGrid').style.setProperty('--tile', `${size}px`);
}

$('optionsBar').addEventListener('input', (e) => {
  if (e.target.id === 'searchInput') { app.search = e.target.value; renderGrid(); updateStatus(); }
  if (e.target.id === 'tileSize') {
    $('glyphGrid').style.setProperty('--tile', `${e.target.value}px`);
    store.set('spline.tile', e.target.value);
  }
  if (e.target.dataset.opt === 'stabilizer') {
    editor.stabilizer = Number(e.target.value);
    store.set('spline.stabilizer', e.target.value);
    $('stabOut').textContent = e.target.value;
  }
  if (e.target.dataset.opt === 'brush') {
    editor.brushRadius = Number(e.target.value) / 2;
    store.set('spline.brush', String(editor.brushRadius));
    $('optionsBar').querySelectorAll('[data-opt="brush"]').forEach((el) => { if (el !== e.target) el.value = e.target.value; });
    editor.render();
  }
});
$('optionsBar').addEventListener('change', (e) => {
  if (e.target.dataset.xf) {
    editor.setTransformValues({ [e.target.dataset.xf]: Number(e.target.value) });
    return;
  }
  const opt = e.target.dataset.opt;
  if (opt === 'guide' || opt === 'grid') toggleView(opt === 'guide' ? 'showGuide' : 'showGrid');
  if (opt === 'snapGrid' || opt === 'snapGuides') toggleView(opt);
  if (opt === 'gridStep') {
    const v = Math.round(Number(e.target.value));
    if (v >= 1) { editor.gridStep = v; store.set('spline.gridStep', String(v)); editor.render(); }
    e.target.value = editor.gridStep;
  }
});
$('optionsBar').addEventListener('click', (e) => {
  const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
  if (cmd) COMMANDS[cmd]?.();
});

// ================================================================ dock (inspector)

function colorPicker(current) {
  return `<div class="color-filter" data-role="colorPick">
    <button type="button" class="swatch none" data-color="" aria-pressed="${!current}" data-tip="${esc(t('noColor'))}" aria-label="${esc(t('noColor'))}"></button>
    ${COLORS.map((c) => `<button type="button" class="swatch" data-color="${c}" style="background:var(--dot-${c})"
      aria-pressed="${current === c}" data-tip="${esc(t('colorNames')[c])}" aria-label="${esc(t('colorNames')[c])}"></button>`).join('')}
  </div>`;
}

function section(id, title, body, open = true) {
  const saved = store.get(`spline.sec.${id}`);
  const isOpen = saved === null ? open : saved === '1';
  return `<details data-sec="${id}" ${isOpen ? 'open' : ''}><summary>${esc(title)}</summary><div class="section">${body}</div></details>`;
}

function transformSection() {
  const v = xfValues();
  const num = (k, unit, min, max) => `<label class="prop"><span>${esc(t(k))}</span><span class="with-unit">
    <input type="number" data-tf="${k}" value="${v[k]}" step="1" min="${min}" max="${max}"><em>${unit}</em></span></label>`;
  return section('transform', t('transform'), `
    ${num('scale', '%', XF_LIMITS.scale[0], XF_LIMITS.scale[1])}
    ${num('rotate', '°', XF_LIMITS.rotate[0], XF_LIMITS.rotate[1])}
    ${num('slant', '°', XF_LIMITS.slant[0], XF_LIMITS.slant[1])}
    <div class="btn-row">
      <button class="btn" type="button" data-cmd="flipH" data-tip="${esc(t('flipH'))}">${icon('flipH', 15)}<span>↔</span></button>
      <button class="btn" type="button" data-cmd="flipV" data-tip="${esc(t('flipV'))}">${icon('flipV', 15)}<span>↕</span></button>
      <button class="btn" type="button" data-cmd="xfReset" data-tip="${esc(t('xfResetTip'))}">${icon('undo', 15)}<span>${esc(t('xfReset'))}</span></button>
    </div>
`);
}

function fontSection() {
  const i = app.project.info;
  return section('font', t('fontSection'), `
    <dl class="kv">
      <dt>${esc(t('family'))}</dt><dd>${esc(i.familyName)}</dd>
      <dt>${esc(t('ascender'))}</dt><dd>${i.ascender}</dd>
      <dt>${esc(t('capHeight'))}</dt><dd>${i.capHeight}</dd>
      <dt>${esc(t('xHeight'))}</dt><dd>${i.xHeight}</dd>
      <dt>${esc(t('descender'))}</dt><dd>${i.descender}</dd>
    </dl>
    <button class="btn btn-block" type="button" data-cmd="fontInfo">${icon('settings', 15)}<span>${esc(t('fontInfo'))}</span></button>`, false);
}

function renderInspector() {
  renderInspectorBody();
  recordOrder($('inspector'));
  if (app.mode === 'grid') layoutPanels();
}

function renderInspectorBody() {
  const el = $('inspector');
  const sel = selectedGlyphs();
  if (!sel.length) {
    el.innerHTML = section('glyph', t('dimensions'), `<p class="hint">${esc(t('noSelection'))}</p>`) + fontSection();
    return;
  }
  const g = sel[0];
  const head = sel.length === 1
    ? `<div class="big-glyph">${g.contours.length ? glyphSVG(g) : `<span class="ghost">${esc(charOf(g))}</span>`}</div>
       <div class="title-row"><b>${esc(charOf(g).trim() || g.name)}</b><small>${esc(g.name)}${g.unicode ? ` · U+${hex(g)}` : ''}</small></div>`
    : `<div class="title-row"><b>${sel.length}</b><small>${esc(t('glyphs'))}: ${esc(sel.slice(0, 24).map((x) => charOf(x) || x.name).join(' '))}</small></div>`;
  el.innerHTML = section('glyph', t('dimensions'), `${head}
      <div class="prop"><span>${esc(t('color'))}</span>${colorPicker(sel.every((x) => x.color === g.color) ? g.color : undefined)}</div>
      ${groupFields(sel)}`)
    + transformSection()
    + section('actions', t('actions'), `
      ${sel.length === 1 ? `<button class="btn btn-primary btn-block" type="button" data-cmd="draw">${icon('pen', 15)}<span>${esc(t('drawGlyph'))}</span></button>` : ''}
      <button class="btn btn-block" type="button" data-cmd="importSvg">${icon('open', 15)}<span>${esc(t('importSvg'))}</span></button>
      <button class="btn btn-block" type="button" data-cmd="spacing">${icon('spacing', 15)}<span>${esc(t('autoSpacing'))}</span></button>
      <button class="btn btn-block btn-danger" type="button" data-cmd="deleteGlyph">${icon('trash', 15)}<span>${esc(t('deleteGlyph'))}</span></button>`)
    + fontSection();
}

function renderGlyphPanel() {
  renderGlyphPanelBody();
  recordOrder($('glyphPanel'));
  if (app.mode === 'editor') layoutPanels();
}

function renderGlyphPanelBody() {
  const g = app.current;
  if (!g) return;
  $('glyphPanel').innerHTML = section('glyph', t('glyph'), `
      <div class="title-row"><b>${esc(charOf(g).trim() || '␣')}</b><small>${esc(g.name)}${g.unicode ? ` · U+${hex(g)}` : ''}</small></div>
      ${metricInputs(g)}
      <div class="prop"><span>${esc(t('color'))}</span>${colorPicker(g.color)}</div>
      ${groupFields([g])}`)
    + section('selection', t('selection'), '<div id="selBox"></div>')
    + section('pathops', t('pathOps'), `<div class="op-row">${PATH_OPS.map((op) => `<button class="btn btn-icon" type="button"
        data-pathop="${op.id}" data-tip="${esc(t(op.label))}" data-key="${esc(keyLabel(`op.${op.id}`))}" aria-label="${esc(t(op.label))}">${icon(op.icon, 18)}</button>`).join('')}</div>
`)
    + alignSection()
    + transformSection()
    + section('actions', t('actions'), `
      <button class="btn btn-block" type="button" data-cmd="spacing">${icon('spacing', 15)}<span>${esc(t('autoSpacing'))}</span></button>
      <button class="btn btn-block" type="button" data-cmd="importSvg">${icon('open', 15)}<span>${esc(t('importSvg'))}</span></button>
      <button class="btn btn-block btn-danger" type="button" data-cmd="clear">${icon('eraseAll', 15)}<span>${esc(t('clear'))}</span></button>`)
    + fontSection();
}

const ALIGN_OPS = [
  { id: 'left', icon: 'alignLeft', label: 'alLeft' },
  { id: 'hcenter', icon: 'alignHCenter', label: 'alHCenter' },
  { id: 'right', icon: 'alignRight', label: 'alRight' },
  { id: 'top', icon: 'alignTop', label: 'alTop' },
  { id: 'vcenter', icon: 'alignVCenter', label: 'alVCenter' },
  { id: 'bottom', icon: 'alignBottom', label: 'alBottom' },
  { id: 'center', icon: 'alignCenter', label: 'alCenter' },
  { id: 'dist-x', icon: 'distributeX', label: 'alDistX' },
  { id: 'dist-y', icon: 'distributeY', label: 'alDistY' },
];

function alignSection() {
  const btn = (op) => `<button class="btn btn-icon" type="button" data-align="${op.id}"
    data-tip="${esc(t(op.label))}" aria-label="${esc(t(op.label))}">${icon(op.icon, 18)}</button>`;
  return section('align', t('alignment'), `
    <div class="op-row">${ALIGN_OPS.slice(0, 6).map(btn).join('')}</div>
    <div class="op-row">${ALIGN_OPS.slice(6).map(btn).join('')}</div>
    <label class="prop"><span>${esc(t('alignTo'))}</span><select data-align-to>
      <option value="selection" ${editor.alignTo === 'selection' ? 'selected' : ''}>${esc(t(editor.keyContour ? 'alignToKey' : 'alignToSelection'))}</option>
      <option value="frame" ${editor.alignTo === 'frame' ? 'selected' : ''}>${esc(t('alignToFrame'))}</option>
    </select></label>`);
}

function runAlign(id) {
  if (app.mode !== 'editor') return;
  const ok = id.startsWith('dist-') ? editor.distribute(id.slice(5)) : editor.align(id);
  if (!ok) toast(t(id.startsWith('dist-') ? 'alNeedThree' : 'alNothing'), 'error');
}

// The key object changed: update the "relative to" label.
app.onKeyObject = () => {
  const opt = panelQuery('[data-align-to] option[value="selection"]');
  if (opt) opt.textContent = t(editor.keyContour ? 'alignToKey' : 'alignToSelection');
  editor.render();
};

const PATH_OPS = [
  { id: 'unite', icon: 'opUnite', label: 'opUnite' },
  { id: 'subtract', icon: 'opSubtract', label: 'opSubtract' },
  { id: 'intersect', icon: 'opIntersect', label: 'opIntersect' },
  { id: 'exclude', icon: 'opExclude', label: 'opExclude' },
  { id: 'divide', icon: 'opDivide', label: 'opDivide' },
  { id: 'removeOverlap', icon: 'opRemoveOverlap', label: 'opRemoveOverlap' },
];

function runPathOp(kind) {
  if (app.mode !== 'editor') return;
  try {
    if (!editor.pathOp(kind)) toast(t('pathOpNeedTwo'), 'error');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Selection panel: exact coordinates of one point (and its handles) or the
// position and size of several points / whole shapes.
let selKey = '';
const fmt = (v) => (v === undefined ? '' : Math.round(v * 10) / 10);
function selectionHTML(info) {
  if (!info) return `<p class="hint">${esc(t('selectionHint'))}</p>`;
  const f = (k, label) => `<label><span>${esc(label)}</span><input type="number" step="1" data-sel="${k}"></label>`;
  if (info.single) {
    return `<div class="xy-grid">${f('x', 'X')}${f('y', 'Y')}</div>
      ${info.inX !== undefined ? `<div class="sub-head">${esc(t('handleIn'))}</div><div class="xy-grid">${f('inX', 'X')}${f('inY', 'Y')}</div>` : ''}
      ${info.outX !== undefined ? `<div class="sub-head">${esc(t('handleOut'))}</div><div class="xy-grid">${f('outX', 'X')}${f('outY', 'Y')}</div>` : ''}`;
  }
  return `<div class="xy-grid">${f('x', 'X')}${f('y', 'Y')}${f('w', t('w'))}${f('h', t('h'))}</div>
    <label class="check"><input type="checkbox" id="selLock" ${store.get('spline.lockRatio', '1') === '1' ? 'checked' : ''}>${esc(t('keepRatio'))}</label>
    <p class="hint">${esc(t('pointsSelected', { n: info.count }))}</p>`;
}

app.onDraw = () => {
  if (app.mode !== 'editor') return;
  syncTransformFields();
  const box = $('selBox');
  if (!box) return;
  const info = editor.selectionInfo();
  const key = JSON.stringify(info);
  if (key === selKey && box.childElementCount) return;
  selKey = key;
  const shape = info ? (info.single ? `s${info.inX !== undefined}${info.outX !== undefined}` : 'm') : 'n';
  if (box.dataset.shape !== shape || !box.childElementCount) { box.dataset.shape = shape; box.innerHTML = selectionHTML(info); }
  box.querySelectorAll('[data-sel]').forEach((el) => { if (document.activeElement !== el) el.value = fmt(info[el.dataset.sel]); });
};

// Kerning group fields for one or several glyphs (mixed values show "—").
function groupFields(glyphs) {
  const val = (prop) => (glyphs.every((x) => (x[prop] || '') === (glyphs[0][prop] || '')) ? glyphs[0][prop] || '' : null);
  const field = (prop, label) => {
    const v = val(prop);
    return `<label><span>${esc(label)}</span><input type="text" data-kgroup="${prop}" list="${prop}List" spellcheck="false"
      value="${esc(v ?? '')}" placeholder="${v === null ? '—' : esc(t('kernNoGroup'))}"></label>`;
  };
  return `<div class="sub-head">${esc(t('kernGroups'))}</div>
    <div class="prop-pair">${field('kernLeft', t('kgLeft'))}${field('kernRight', t('kgRight'))}</div>
    <button class="btn btn-block" type="button" data-cmd="autoGroups" data-tip="${esc(t('kgAutoTip'))}">${icon('kerning', 15)}<span>${esc(t('kgAuto'))}</span></button>
    ${groupDatalists()}`;
}

// Base letter of a character: "Ё" -> "Е", "é" -> "e".
function baseLetter(ch) {
  const special = { 'Ё': 'Е', 'ё': 'е', 'Й': 'И', 'й': 'и' };
  return special[ch] || ch.normalize('NFD').replace(/\p{M}+/gu, '') || ch;
}

function autoGroups() {
  const targets = app.mode === 'editor' ? [app.current] : selectedGlyphs();
  for (const g of targets) {
    const ch = charOf(g);
    if (!ch.trim()) continue;
    const base = baseLetter(ch);
    const bg = app.project.glyphs.find((x) => x.unicode === base.codePointAt(0)) || g;
    g.kernLeft = bg.kernLeft || bg.name;
    g.kernRight = bg.kernRight || bg.name;
  }
  markChanged();
  if (app.mode === 'editor') renderGlyphPanel(); else renderInspector();
}

function updateMetricInputs() {
  const g = app.mode === 'editor' ? app.current : selectedGlyphs()[0];
  if (!g) return;
  const box = glyphBox(g);
  const vals = { advance: Math.round(g.advance), lsb: box ? Math.round(box.minX) : '', rsb: box ? Math.round(g.advance - box.maxX) : '' };
  document.querySelectorAll('[data-metric]').forEach((el) => {
    if (document.activeElement !== el) el.value = vals[el.dataset.metric];
    el.disabled = el.dataset.metric !== 'advance' && !box;
  });
}

// Panels of the right dock; floating ones live in #floatLayer.
const DOCK_OF = { grid: 'inspector', editor: 'glyphPanel' };
const VIEW_OF = { grid: 'gridView', editor: 'editorView' };
const panelQuery = (sel) => (VIEW_OF[app.mode] && $(VIEW_OF[app.mode]).querySelector(sel)) || $('floatLayer').querySelector(sel);
const PANELS = [['glyph', 'glyph'], ['selection', 'selection'], ['pathops', 'pathOps'], ['align', 'alignment'], ['transform', 'transform'], ['actions', 'actions'], ['font', 'fontSection']];

initPanels({
  layer: $('floatLayer'),
  views: [$('gridView'), $('editorView')],
  active: () => (DOCK_OF[app.mode] ? { view: $(VIEW_OF[app.mode]), dock: $(DOCK_OF[app.mode]) } : null),
  labels: {
    get dock() { return esc(t('panelDock')); }, get close() { return esc(t('panelClose')); }, get collapse() { return esc(t('panelCollapse')); },
  },
  icons: { dock: icon('panelDock', 14), close: icon('close', 14), collapse: icon('chevronRight', 14) },
  panelIcons: {
    glyph: icon('pen', 18), selection: icon('select', 18), pathops: icon('opUnite', 18), align: icon('alignHCenter', 18),
    transform: icon('transform', 18), actions: icon('spacing', 18), font: icon('type', 18),
  },
  onChange: () => renderMenus(),
});
watchResize();

function setPreviewHidden(hidden) {
  $('preview').hidden = hidden;
  store.set('spline.previewHidden', hidden ? '1' : '0');
  renderMenus();
}
$('preview').hidden = store.get('spline.previewHidden') === '1';

for (const dock of [$('inspector'), $('glyphPanel'), $('floatLayer'), ...document.querySelectorAll('[data-zone="left"], [data-zone="top"]')]) {
  dock.addEventListener('toggle', (e) => {
    const sec = e.target.dataset?.sec;
    if (sec) store.set(`spline.sec.${sec}`, e.target.open ? '1' : '0');
  }, true);
  dock.addEventListener('change', (e) => {
    if (e.target.dataset.kgroup) {
      const prop = e.target.dataset.kgroup;
      const v = cleanGroupName(e.target.value);
      for (const g of app.mode === 'editor' ? [app.current] : selectedGlyphs()) {
        if (v) g[prop] = v; else delete g[prop];
      }
      markChanged();
      return;
    }
    if (e.target.dataset.alignTo !== undefined) { editor.alignTo = e.target.value; editor.render(); return; }
    if (e.target.id === 'selLock') store.set('spline.lockRatio', e.target.checked ? '1' : '0');
    if (e.target.dataset.sel) {
      editor.setSelectionValue(e.target.dataset.sel, Number(e.target.value), $('selLock')?.checked);
      selKey = '';
      editor.render();
      return;
    }
    if (e.target.dataset.tf) { liveTransform(true); return; }
    onMetricChange(e);
  });
  dock.addEventListener('input', (e) => { if (e.target.dataset.tf) liveTransform(false); });
  dock.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.tf) { e.preventDefault(); liveTransform(true); }
  });
  dock.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-role="colorPick"] [data-color]');
    if (sw) { setColor(sw.dataset.color); return; }
    const al = e.target.closest('[data-align]');
    if (al) { runAlign(al.dataset.align); return; }
    const po = e.target.closest('[data-pathop]');
    if (po) { runPathOp(po.dataset.pathop); return; }
    const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
    if (cmd) COMMANDS[cmd]?.();
  });
}

function setColor(color) {
  const targets = app.mode === 'editor' ? [app.current] : selectedGlyphs();
  for (const g of targets) {
    if (color) g.color = color; else delete g.color;
    if (app.mode === 'grid') updateTile(g);
  }
  markChanged();
  if (app.mode === 'editor') renderGlyphPanel(); else renderInspector();
}

// ================================================================ transformations

// Target points: selected points in the editor, otherwise whole glyphs.
function transformTargets() {
  if (app.mode === 'editor') {
    const g = app.current;
    const nodes = editor.sel.size ? editor.selectedNodes() : g.contours.flatMap((c) => c.nodes);
    return nodes.length ? [{ g, nodes }] : [];
  }
  return selectedGlyphs().map((g) => ({ g, nodes: g.contours.flatMap((c) => c.nodes) })).filter((x) => x.nodes.length);
}

function applyTransform(kind, value = 0) {
  if (!Number.isFinite(value)) return;
  const targets = transformTargets();
  for (const { g, nodes } of targets) {
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const a = (value * Math.PI) / 180;
    const fn = {
      scale: (p) => ({ x: cx + (p.x - cx) * (value / 100), y: cy + (p.y - cy) * (value / 100) }),
      rotate: (p) => ({
        x: cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a),
        y: cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a),
      }),
      slant: (p) => ({ x: p.x + (p.y - cy) * Math.tan(a), y: p.y }),
      flipH: (p) => ({ x: 2 * cx - p.x, y: p.y }),
      flipV: (p) => ({ x: p.x, y: 2 * cy - p.y }),
    }[kind];
    if (!fn || (kind === 'scale' && value <= 0)) continue;
    app.history.push(g);
    const r = (p) => { const q = fn(p); return { x: Math.round(q.x), y: Math.round(q.y) }; };
    for (const n of nodes) {
      if (n.in) n.in = r(n.in);
      if (n.out) n.out = r(n.out);
      Object.assign(n, r(n));
    }
    if (app.mode === 'grid') { normalizeDirections(g); updateTile(g); }
  }
  if (!targets.length) return;
  if (app.mode === 'editor') editor.afterEdit(); else { markChanged(); renderInspector(); renderSideMetrics(); }
}

// Transform panel with live values: scale, rotation and slant are absolute
// and always computed from the outline as it was when the session began, so
// typing 150 then 120 gives 120 %, not 180 %. A session ends when the targets
// change or are edited in another way; the fields then return to 100 / 0 / 0.
const XF_LIMITS = { scale: [1, 10000], rotate: [-360, 360], slant: [-80, 80] };
const XF_DEFAULT = { scale: 100, rotate: 0, slant: 0 };
let xf = null;

const xfSig = (items) => JSON.stringify(items.map(({ nodes }) => nodes.map((n) => [n.x, n.y, n.in?.x, n.in?.y, n.out?.x, n.out?.y])));

const tfField = (k) => panelQuery(`[data-tf="${k}"]`);

function xfValid() {
  if (!xf) return false;
  const now = transformTargets();
  if (now.length !== xf.items.length) return false;
  for (let i = 0; i < now.length; i++) {
    const a = now[i].nodes, b = xf.items[i].nodes;
    if (now[i].g !== xf.items[i].g || a.length !== b.length || a.some((n, j) => n !== b[j])) return false;
  }
  return xfSig(xf.items) === xf.written;
}

function xfValues() {
  if (!xfValid()) xf = null;
  return xf ? xf.v : XF_DEFAULT;
}

function xfStart() {
  const items = transformTargets().map(({ g, nodes }) => {
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    return {
      g, nodes,
      base: nodes.map((n) => ({ x: n.x, y: n.y, in: n.in && { ...n.in }, out: n.out && { ...n.out } })),
      cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  });
  if (!items.length) return null;
  return { items, v: { ...XF_DEFAULT }, pushed: false, written: xfSig(items) };
}

// Reads the fields and redraws the targets. `final` (Enter, leaving the
// field) also puts clamped values back into the fields.
function liveTransform(final) {
  const v = {};
  for (const k of Object.keys(XF_DEFAULT)) {
    const el = tfField(k);
    const n = Number(el?.value);
    if (el?.value === '' || !Number.isFinite(n)) { if (!final) return; v[k] = xf ? xf.v[k] : XF_DEFAULT[k]; }
    else v[k] = Math.min(XF_LIMITS[k][1], Math.max(XF_LIMITS[k][0], n));
    if (final && el) el.value = v[k];
  }
  if (!xfValid()) xf = xfStart();
  if (!xf) { if (final) toast(t('nothingToTransform'), 'error'); return; }
  xfApply(v);
}

function xfApply(v) {
  if (!xf.pushed) { for (const it of xf.items) app.history.push(it.g); xf.pushed = true; }
  xf.v = v;
  const s = v.scale / 100, k = Math.tan((v.slant * Math.PI) / 180);
  const a = (v.rotate * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  for (const { g, nodes, base, cx, cy } of xf.items) {
    // Scale around the centre of the original box, slant from the baseline
    // (like an italic: points on y = 0 stay), then rotate around the centre.
    const f = (p) => {
      const y = cy + (p.y - cy) * s;
      const x = (p.x - cx) * s + y * k - cy * k, dy = y - cy;
      return { x: Math.round(cx + cy * k + x * cos - dy * sin), y: Math.round(cy + x * sin + dy * cos) };
    };
    nodes.forEach((n, i) => {
      const b = base[i];
      Object.assign(n, f(b));
      if (b.in) n.in = f(b.in); else delete n.in;
      if (b.out) n.out = f(b.out); else delete n.out;
    });
    if (app.mode === 'grid') updateTile(g);
  }
  xf.written = xfSig(xf.items);
  if (app.mode === 'editor') { editor.afterEdit(false); return; }
  markChanged();
  renderSideMetrics();
  const big = panelQuery('.big-glyph');
  if (big && xf.items.length === 1) big.innerHTML = glyphSVG(xf.items[0].g);
}

// Puts the targets back as they were before the session.
function xfReset() {
  if (xfValid()) xfApply({ ...XF_DEFAULT });
  xf = null;
  for (const [k, val] of Object.entries(XF_DEFAULT)) {
    const el = tfField(k);
    if (el) el.value = val;
  }
}

// Called after every redraw: once the targets change, the fields start over.
function syncTransformFields() {
  if (!xf || xfValid()) return;
  xf = null;
  for (const [k, val] of Object.entries(XF_DEFAULT)) {
    const el = tfField(k);
    if (el && document.activeElement !== el) el.value = val;
  }
}

async function glyphAction(act) {
  const targets = app.mode === 'editor' ? [app.current] : selectedGlyphs();
  if (act === 'clear') {
    const g = app.current;
    if (!g?.contours.length || !(await confirmDialog(t('confirmClear'), t('clear')))) return;
    app.history.push(g);
    g.contours = [];
    editor.sel.clear();
    editor.afterEdit(false);
    return;
  }
  if (act === 'spacing') {
    for (const g of targets) {
      const box = glyphBox(g);
      if (!box) continue;
      app.history.push(g);
      const side = Math.round(Math.max(30, (box.maxX - box.minX) * 0.08));
      translateGlyph(g, side - box.minX, 0);
      g.advance = Math.round(box.maxX - box.minX + side * 2);
      if (app.mode === 'grid') updateTile(g);
    }
    if (app.mode === 'editor') editor.afterEdit(false); else { markChanged(); renderInspector(); renderSideMetrics(); }
  }
}

async function deleteSelectedGlyphs() {
  const n = app.selected.size;
  if (!n || !(await confirmDialog(t('confirmDelete', { n }), t('delete')))) return;
  app.project.glyphs = app.project.glyphs.filter((g) => !app.selected.has(g.name));
  app.selected.clear();
  markChanged();
  renderAll();
}

function selectAll() {
  if (app.mode === 'editor') { editor.selectAll(); renderToolbar(); updateStatus(); return; }
  app.selected = new Set(visibleGlyphs().map((g) => g.name));
  renderGrid();
  renderInspector();
  renderSideMetrics();
  updateStatus();
}

function deleteSelection() {
  if (app.mode === 'editor') editor.deleteSelection(); else deleteSelectedGlyphs();
}

// ================================================================ dialogs

async function addGlyphs() {
  const data = await showDialog({
    title: t('addGlyph').replace('…', ''),
    body: `<label class="field">${esc(t('addGlyphHint'))}<input type="text" name="chars" required maxlength="500" autocomplete="off"></label>`,
    okLabel: t('add'),
  });
  if (!data) return;
  const chars = [...new Set(Array.from(String(data.get('chars'))))].filter((c) => c !== '\n');
  const added = chars.map((c) => addGlyphForChar(app.project, c)).filter(Boolean);
  if (!added.length) { toast(t('exists'), 'error'); return; }
  app.category = 'all';
  app.selected = new Set(added.map((g) => g.name));
  app.focusName = added[0].name;
  markChanged();
  if (app.mode === 'editor') showGrid();
  renderAll();
  $('glyphGrid').querySelector(`[data-name="${CSS.escape(added[0].name)}"]`)?.scrollIntoView({ block: 'center' });
}

async function editFontInfo() {
  const i = app.project.info;
  const num = (name, v) => `<label class="field">${esc(t(name))}<input type="number" name="${name}" value="${v}" required step="1"></label>`;
  const data = await showDialog({
    title: t('fontInfo').replace('…', ''),
    body: `<label class="field">${esc(t('family'))}<input type="text" name="familyName" value="${esc(i.familyName)}" required maxlength="60"></label>
      <div class="field-row">
        <label class="field">${esc(t('designer'))}<input type="text" name="designer" value="${esc(i.designer || '')}" maxlength="80"></label>
        <label class="field">${esc(t('version'))}<input type="text" name="version" value="${esc(i.version || '1.000')}" pattern="\\d+\\.\\d+" maxlength="10"></label>
      </div>
      <h3>${esc(t('metrics'))}</h3>
      <div class="field-row">${num('ascender', i.ascender)}${num('capHeight', i.capHeight)}</div>
      <div class="field-row">${num('xHeight', i.xHeight)}${num('descender', i.descender)}</div>`,
  });
  if (!data) return;
  i.familyName = String(data.get('familyName')).trim() || i.familyName;
  i.designer = String(data.get('designer')).trim();
  i.version = String(data.get('version')).trim() || '1.000';
  for (const k of ['ascender', 'capHeight', 'xHeight', 'descender']) {
    const v = Math.round(Number(data.get(k)));
    if (Number.isFinite(v)) i[k] = v;
  }
  if (i.descender > 0) i.descender = -i.descender;
  markChanged();
  renderAll();
  if (app.mode === 'editor') { renderGlyphPanel(); editor.render(); }
}

async function newFontDialog() {
  if (app.dirty && !(await confirmDialog(t('confirmNew'), t('ok'), false))) return;
  const sets = [['latin', 'setLatin'], ['cyrillic', 'setCyrillic'], ['digits', 'setDigits'], ['punct', 'setPunct']];
  const data = await showDialog({
    title: t('newTitle'),
    body: `<label class="field">${esc(t('family'))}<input type="text" name="family" value="${esc(getLang() === 'ru' ? 'Мой шрифт' : 'My Font')}" required maxlength="60"></label>
      <h3>${esc(t('newSets'))}</h3><div class="checks">
      ${sets.map(([id, label]) => `<label class="check"><input type="checkbox" name="sets" value="${id}" checked>${esc(t(label))}</label>`).join('')}
      </div>`,
    okLabel: t('create'),
  });
  if (!data) return;
  setProject(newProject({ family: String(data.get('family')).trim() || 'My Font', sets: data.getAll('sets') }));
  autosave();
}

// Keyboard shortcuts: click a shortcut and press a new one.
const KEY_GROUPS = [
  ['menuFile', ['new', 'open', 'save', 'saveAs', 'importSvg', 'exportTTF', 'exportOTF']],
  ['menuEdit', ['undo', 'redo', 'selectAll', 'freeTransform']],
  ['keysTools', TOOLS.map((tl) => `tool.${tl.id}`)],
  ['menuView', ['zoomIn', 'zoomOut', 'zoomFit', 'viewKerning', 'rulers', 'userGuides', 'showGuide', 'showGrid', 'snapGrid', 'snapGuides', 'prev', 'next']],
  ['menuGlyph', [...PATH_OPS.map((op) => `op.${op.id}`), 'autoSpacing', 'flipH', 'flipV', 'fontInfo']],
  ['menuHelp', ['shortcuts']],
];
const actionLabel = (id) => ACTIONS[id]?.label?.() || t(id);

function keyRowsHTML(filter = '') {
  const f = filter.trim().toLowerCase();
  return KEY_GROUPS.map(([group, ids]) => {
    const rows = ids.filter((id) => !f || actionLabel(id).toLowerCase().includes(f) || bindings(id).some((c) => comboLabel(c).toLowerCase().includes(f)));
    if (!rows.length) return '';
    return `<h3>${esc(t(group))}</h3>${rows.map((id) => {
      const combos = bindings(id);
      const reserved = app.platform?.web && combos.some((c) => BROWSER_RESERVED.has(c));
      return `<div class="key-row"><span>${esc(actionLabel(id))}</span>
        <button type="button" class="key-btn${isCustom(id) ? ' custom' : ''}${reserved ? ' warn' : ''}" data-bind="${id}"
          ${reserved ? `data-tip="${esc(t('keysBrowserTaken'))}"` : ''}>${combos.length ? combos.map((c) => `<kbd>${esc(comboLabel(c))}</kbd>`).join(' ') : `<em>${esc(t('keysNone'))}</em>`}</button></div>`;
    }).join('')}`;
  }).join('');
}

function helpDialog() {
  if ($('dialog').open) return;
  showDialog({
    title: t('shortcuts'),
    cancel: false,
    body: `<p class="hint">${esc(t('keysHint'))}</p>
      ${app.platform?.web ? `<p class="hint warn">${esc(t('keysBrowserNote'))}</p>` : ''}
      <input type="search" class="key-search" placeholder="${esc(t('keysSearch'))}" aria-label="${esc(t('keysSearch'))}">
      <div class="keymap">${keyRowsHTML()}</div>
      <p class="key-msg" aria-live="polite"></p>
      <h3>${esc(t('keysFixedTitle'))}</h3>
      <dl class="keys">${t('keysFixed').map(([k, v]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <button type="button" class="btn" data-keys-reset>${esc(t('keysReset'))}</button>`,
  }).then(() => { keyCapture = null; });
  const dlg = $('dialog');
  const map = dlg.querySelector('.keymap'), msg = dlg.querySelector('.key-msg'), search = dlg.querySelector('.key-search');
  const refresh = () => {
    map.innerHTML = keyRowsHTML(search.value);
    renderMenus();
    if (app.mode === 'editor') { renderToolbar(); renderEditorOptions(); renderGlyphPanel(); }
  };
  search.addEventListener('input', () => { map.innerHTML = keyRowsHTML(search.value); });
  dlg.querySelector('[data-keys-reset]').addEventListener('click', () => { resetAll(); keyCapture = null; msg.textContent = t('keysResetDone'); refresh(); });
  map.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bind]');
    if (!btn) return;
    keyCapture = btn.dataset.bind;
    map.querySelectorAll('.key-btn.capturing').forEach((b) => b.classList.remove('capturing'));
    btn.classList.add('capturing');
    btn.innerHTML = `<em>${esc(t('keysPress'))}</em>`;
    msg.textContent = '';
  });
  // Capture phase: the new shortcut must not also run its old action.
  const onKey = (e) => {
    if (!keyCapture) return;
    e.preventDefault();
    e.stopPropagation();
    const id = keyCapture;
    if (e.key === 'Escape') { keyCapture = null; map.innerHTML = keyRowsHTML(search.value); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      assign(id, null);
      keyCapture = null;
      msg.textContent = t('keysCleared', { a: actionLabel(id) });
      refresh();
      return;
    }
    const combo = comboOf(e);
    if (!combo) return; // a modifier on its own: wait for the key
    keyCapture = null;
    if (TAKEN[combo]) { msg.textContent = t('keysTaken', { k: comboLabel(combo), a: t(TAKEN[combo]) }); map.innerHTML = keyRowsHTML(search.value); return; }
    const other = assign(id, combo);
    msg.textContent = [
      other ? t('keysMoved', { k: comboLabel(combo), a: actionLabel(other) }) : t('keysSet', { k: comboLabel(combo), a: actionLabel(id) }),
      app.platform?.web && BROWSER_RESERVED.has(combo) ? t('keysBrowserTaken') : '',
    ].filter(Boolean).join(' ');
    refresh();
  };
  window.addEventListener('keydown', onKey, true);
  dlg.addEventListener('close', () => window.removeEventListener('keydown', onKey, true), { once: true });
}

// ================================================================ editor

const editor = new Editor(app, $('canvas'));
editor.showGuide = store.get('spline.showGuide', '1') === '1';
editor.showGrid = store.get('spline.showGrid', '1') === '1';
editor.brushRadius = Number(store.get('spline.brush', '40')) || 40;
editor.tool = store.get('spline.tool', 'brush');
editor.showRulers = store.get('spline.showRulers', '0') === '1';
editor.showUserGuides = store.get('spline.showUserGuides', '1') === '1';
editor.gridStep = Math.max(1, Number(store.get('spline.gridStep', '50')) || 50);
editor.snapGrid = store.get('spline.snapGrid', '0') === '1';
editor.snapGuides = store.get('spline.snapGuides', '1') === '1';
editor.stabilizer = Number(store.get('spline.stabilizer', '4'));
if (!Number.isFinite(editor.stabilizer)) editor.stabilizer = 4;
if (!TOOLS.some((x) => x.id === editor.tool)) editor.tool = 'brush';

function renderToolbar() {
  $('toolButtons').innerHTML = TOOLS.map((tl) => `<button type="button" class="tool" role="radio" data-tool="${tl.id}"
      aria-checked="${editor.tool === tl.id}" aria-label="${esc(toolName(tl.id))}" data-tip="${esc(toolName(tl.id))}" data-key="${esc(keyLabel(`tool.${tl.id}`))}">
      ${icon(tl.icon, 18)}</button>`).join('');
  $('backBtn').dataset.tip = t('back');
  $('backBtn').dataset.key = 'Esc';
}

// Options bar while Ctrl+T is active: exact scale and angle.
function renderTransformOptions() {
  const v = editor.transformValues();
  $('optionsBar').innerHTML = `
    <div class="opt-tool">${icon('transform', 16)}<span>${esc(t('freeTransform'))}</span></div>
    <div class="sep"></div>
    <div class="group">
      <label>${esc(t('w'))}<input type="number" data-xf="w" step="1" value="${v.w.toFixed(1)}">%</label>
      <label>${esc(t('h'))}<input type="number" data-xf="h" step="1" value="${v.h.toFixed(1)}">%</label>
      <label>∠<input type="number" data-xf="angle" step="1" value="${v.angle.toFixed(1)}">°</label>
    </div>
    <div class="sep"></div>
    <div class="group">
      <button class="btn btn-primary" type="button" data-cmd="xfApply">${icon('check', 15)}<span>${esc(t('apply'))}</span></button>
      <button class="btn" type="button" data-cmd="xfCancel">${icon('close', 15)}<span>${esc(t('cancel'))}</span></button>
    </div>`;
}

app.onTransformChange = () => {
  if (app.mode !== 'editor') return;
  if (!editor.xform) { renderEditorOptions(); updateStatus(); return; }
  if (!$('optionsBar').querySelector('[data-xf]')) { renderTransformOptions(); updateStatus(); return; }
  const v = editor.transformValues();
  $('optionsBar').querySelectorAll('[data-xf]').forEach((el) => {
    if (document.activeElement !== el) el.value = v[el.dataset.xf].toFixed(1);
  });
};

function startTransform() {
  if (app.mode !== 'editor') return;
  if (!editor.startTransform()) { toast(t('nothingToTransform'), 'error'); return; }
  renderTransformOptions();
  updateStatus();
}

app.onKnifeMiss = () => toast(t('knifeMiss'), 'error');

// Ruler guides belong to the whole font and are saved in the .sp file.
app.onGuidesChanged = () => { markChanged(); renderMenus(); };
app.onGuideEdit = async (g) => {
  const data = await showDialog({
    title: t('guidePosition'),
    body: `<label class="field">${esc(g.axis === 'y' ? t('guideHorizontal') : t('guideVertical'))}
      <input type="number" name="pos" value="${g.pos}" step="1" required></label>
      <label class="check"><input type="checkbox" name="remove">${esc(t('removeGuide'))}</label>`,
  });
  if (!data) return;
  const list = app.project.guides;
  if (data.get('remove')) list.splice(list.indexOf(g), 1);
  else g.pos = Math.round(Number(data.get('pos')));
  app.onGuidesChanged();
  editor.render();
};

async function clearGuides() {
  if (!app.project.guides?.length || !(await confirmDialog(t('confirmClearGuides'), t('clearGuides')))) return;
  app.project.guides = [];
  app.onGuidesChanged();
  editor.render();
}

function renderEditorOptions() {
  const g = app.current;
  if (!g) return;
  if (editor.xform) { renderTransformOptions(); return; }
  const tl = TOOLS.find((x) => x.id === editor.tool);
  const brush = editor.tool === 'brush' || editor.tool === 'eraser';
  $('optionsBar').innerHTML = `
    <div class="opt-tool">${icon(tl.icon, 16)}<span>${esc(toolName(tl.id))}</span></div>
    <div class="sep"></div>
    ${brush ? `<div class="group"><label>${esc(t('brushSize'))}
      <input type="range" data-opt="brush" min="4" max="300" step="2" value="${editor.brushRadius * 2}">
      <input type="number" data-opt="brush" min="4" max="300" step="2" value="${editor.brushRadius * 2}"></label>
      <label data-tip="${esc(t('stabilizerTip'))}">${esc(t('stabilizer'))}
      <input type="range" data-opt="stabilizer" min="0" max="10" step="1" value="${editor.stabilizer}"><output class="mono" id="stabOut">${editor.stabilizer}</output></label>
      </div><div class="sep"></div>` : ''}
    <div class="group">
      <label class="check"><input type="checkbox" data-opt="guide" ${editor.showGuide ? 'checked' : ''}>${esc(t('guide'))}</label>
      <label class="check"><input type="checkbox" data-opt="grid" ${editor.showGrid ? 'checked' : ''}>${esc(t('grid'))}</label>
      <label>${esc(t('gridStep'))}<input type="number" data-opt="gridStep" min="1" max="500" step="1" value="${editor.gridStep}"></label>
    </div>
    <div class="sep"></div>
    <div class="group">
      <span class="opt-label">${esc(t('snap'))}</span>
      <label class="check" data-tip="${esc(t('snapGridTip'))}" data-key="${esc(keyLabel('snapGrid'))}"><input type="checkbox" data-opt="snapGrid" ${editor.snapGrid ? 'checked' : ''}>${esc(t('snapGrid'))}</label>
      <label class="check" data-tip="${esc(t('snapGuidesTip'))}" data-key="${esc(keyLabel('snapGuides'))}"><input type="checkbox" data-opt="snapGuides" ${editor.snapGuides ? 'checked' : ''}>${esc(t('snapGuides'))}</label>
    </div>
    <div class="sep"></div>
    <div class="group">
      <button class="btn btn-icon" type="button" data-cmd="undo" data-tip="${esc(t('undo'))}" data-key="${esc(keyLabel('undo'))}" aria-label="${esc(t('undo'))}">${icon('undo', 15)}</button>
      <button class="btn btn-icon" type="button" data-cmd="redo" data-tip="${esc(t('redo'))}" data-key="${esc(keyLabel('redo'))}" aria-label="${esc(t('redo'))}">${icon('redo', 15)}</button>
    </div>
    <div class="glyph-nav">
      <button class="btn btn-icon" type="button" data-cmd="zoomOut" data-tip="${esc(t('zoomOut'))}" data-key="${esc(keyLabel('zoomOut'))}" aria-label="${esc(t('zoomOut'))}">${icon('zoomOut', 15)}</button>
      <button class="btn btn-icon" type="button" data-cmd="zoomFit" data-tip="${esc(t('zoomFit'))}" data-key="${esc(keyLabel('zoomFit'))}" aria-label="${esc(t('zoomFit'))}">${icon('fit', 15)}</button>
      <button class="btn btn-icon" type="button" data-cmd="zoomIn" data-tip="${esc(t('zoomIn'))}" data-key="${esc(keyLabel('zoomIn'))}" aria-label="${esc(t('zoomIn'))}">${icon('zoomIn', 15)}</button>
      <div class="sep"></div>
      <button class="btn btn-icon" type="button" data-cmd="prev" data-tip="${esc(t('prev'))}" data-key="${esc(keyLabel('prev'))}" aria-label="${esc(t('prev'))}">${icon('chevronLeft', 15)}</button>
      <div class="cur"><b>${esc(charOf(g).trim() || '␣')}</b><small>${esc(g.name)}</small></div>
      <button class="btn btn-icon" type="button" data-cmd="next" data-tip="${esc(t('next'))}" data-key="${esc(keyLabel('next'))}" aria-label="${esc(t('next'))}">${icon('chevronRight', 15)}</button>
    </div>`;
}

function setTool(id) {
  editor.setTool(id);
  store.set('spline.tool', id);
  renderToolbar();
  renderEditorOptions();
  updateStatus();
}

$('toolButtons').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b) setTool(b.dataset.tool);
});
$('backBtn').addEventListener('click', () => history.back());

function setViewTabs() {
  $('tabGlyphs').setAttribute('aria-selected', app.mode !== 'kern');
  $('tabKerning').setAttribute('aria-selected', app.mode === 'kern');
}

function openEditor(name, push = true) {
  const g = findGlyph(name);
  if (!g) return;
  $('kernView').hidden = true;
  app.mode = 'editor';
  setViewTabs();
  app.current = g;
  app.selected = new Set([name]);
  app.focusName = name;
  $('gridView').hidden = true;
  $('editorView').hidden = false;
  if (push) history.pushState({ glyph: name }, '', `#glyph=${encodeURIComponent(name)}`);
  else history.replaceState({ glyph: name }, '', `#glyph=${encodeURIComponent(name)}`);
  renderToolbar();
  renderEditorOptions();
  renderGlyphPanel();
  editor.setTool(editor.tool);
  editor.resize();
  editor.open(g);
  renderMenus();
  updateStatus();
  $('canvas').focus({ preventScroll: true });
}

function showGrid(push = true) {
  if (app.mode === 'editor') { if (editor.xform) editor.commitTransform(); editor.finishPen(); }
  const wasEditor = app.mode !== 'grid';
  app.mode = 'grid';
  app.current = null;
  setViewTabs();
  $('editorView').hidden = true;
  $('kernView').hidden = true;
  $('gridView').hidden = false;
  if (push && wasEditor) history.pushState({}, '', location.pathname);
  if (wasEditor) {
    renderAll();
    const el = $('glyphGrid').querySelector(`[data-name="${CSS.escape(app.focusName || '')}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  }
}

window.addEventListener('popstate', (e) => {
  if (e.state?.glyph && findGlyph(e.state.glyph)) openEditor(e.state.glyph, false);
  else if (e.state?.kern) showKern(false);
  else showGrid(false);
});

// ================================================================ kerning view

const kernView = new KernView(app, $('kernCanvas'));
kernView.text = store.get('spline.kernText') || kernView.text;
kernView.size = Number(store.get('spline.kernSize', '140')) || 140;

const KERN_SAMPLES = {
  latin: 'AVATAR LTYA ToTaTeVaVoWaYo FAWN PALLY',
  lower: 'raven yoke wave aware favor kelvin',
  cyrillic: 'ГАДЮКА ТАТЬЯНА ГОЛЬФ ТУЧА УЛЬЯ ЛАГУНА',
  digits: '11 17 1970 2048 1/4 7,7',
};

function showKern(push = true) {
  if (app.mode === 'editor') { if (editor.xform) editor.commitTransform(); editor.finishPen(); }
  app.mode = 'kern';
  app.current = null;
  setViewTabs();
  $('gridView').hidden = true;
  $('editorView').hidden = true;
  $('kernView').hidden = false;
  if (push) history.pushState({ kern: true }, '', '#kern');
  else history.replaceState({ kern: true }, '', '#kern');
  renderKernOptions();
  renderKernPanel();
  layoutPanels();
  renderMenus();
  updateStatus();
  kernView.resize();
  $('kernCanvas').focus({ preventScroll: true });
}

function renderKernOptions() {
  $('optionsBar').innerHTML = `
    <div class="opt-tool">${icon('kerning', 16)}<span>${esc(t('viewKerning'))}</span></div>
    <div class="sep"></div>
    <div class="group"><label>${esc(t('kernText'))}<input class="kern-text" id="kernText" value="${esc(kernView.text)}" spellcheck="false"></label></div>
    <div class="group"><label>${esc(t('kernSamples'))}<select id="kernSample">
      <option value="">—</option>
      ${Object.keys(KERN_SAMPLES).map((k) => `<option value="${k}">${esc(t('sample_' + k))}</option>`).join('')}
    </select></label></div>
    <div class="glyph-nav"><label>${esc(t('previewSize'))}<input type="range" id="kernSize" min="40" max="400" value="${kernView.size}"></label></div>`;
}

// Readable label of a kerning key: the letter, or "@group".
function kernKeyLabel(key) {
  if (isGroup(key)) return key;
  const g = findGlyph(key);
  return g ? (charOf(g).trim() || g.name) : key;
}

function renderKernPanel() {
  const pr = kernView.pair();
  const p = app.project;
  const all = kernPairs(p);
  const q = (store.get('spline.kernFilter') || '').toLowerCase();
  const list = all.filter((k) => !q || `${kernKeyLabel(k.left)}${kernKeyLabel(k.right)} ${k.left} ${k.right}`.toLowerCase().includes(q))
    .sort((a, b) => Number(isGroup(b.left) && isGroup(b.right)) - Number(isGroup(a.left) && isGroup(a.right))
      || a.left.localeCompare(b.left) || a.right.localeCompare(b.right));
  let pairHTML = `<p class="hint">${esc(t('kernNoPair'))}</p>`;
  if (pr) {
    const rule = effectiveKern(p, pr.left, pr.right);
    const [k1, k2] = kernView.targetKeys(pr);
    const own = p.kerning?.[k1]?.[k2] !== undefined;
    const lc = charOf(pr.left) || pr.left.name, rc = charOf(pr.right) || pr.right.name;
    const side = (which, glyph, ch) => {
      const prop = which === 'left' ? 'kernRight' : 'kernLeft';
      const label = which === 'left' ? t('kernGroupOfRight', { c: ch }) : t('kernGroupOfLeft', { c: ch });
      return `<div class="kside">
        <label class="field-inline"><span>${esc(label)}</span>
          <input type="text" data-pair-group="${which}" list="${prop}List" value="${esc(glyph[prop] || '')}" placeholder="${esc(t('kernNoGroup'))}" spellcheck="false"></label>
        <label class="check"><input type="checkbox" data-use-group="${which}" ${kernView.useGroups[which] ? 'checked' : ''} ${glyph[prop] ? '' : 'disabled'}>${esc(t('kernUseGroup'))}</label>
      </div>`;
    };
    pairHTML = `
      <div class="pair-big"><span>${esc(lc)}</span><span>${esc(rc)}</span></div>
      ${side('left', pr.left, lc)}${side('right', pr.right, rc)}
      <label class="prop"><span>${esc(t('kernValue'))}</span><input type="number" id="kernValue" step="1" value="${rule.value}"></label>
      <p class="hint">${esc(t('kernEditing', { k: `${kernKeyLabel(k1)} — ${kernKeyLabel(k2)}` }))}${rule.k1 && (rule.k1 !== k1 || rule.k2 !== k2)
        ? ` ${esc(t('kernFrom', { k: `${kernKeyLabel(rule.k1)} — ${kernKeyLabel(rule.k2)}` }))}` : ''}</p>
      <div class="step-row">
        <button class="btn" type="button" data-kstep="-10">−10</button><button class="btn" type="button" data-kstep="-1">−1</button>
        <button class="btn" type="button" data-kstep="1">+1</button><button class="btn" type="button" data-kstep="10">+10</button>
      </div>
      <button class="btn btn-block" type="button" data-kstep="reset" ${own ? '' : 'disabled'}>${icon('close', 15)}<span>${esc(t('kernReset'))}</span></button>
      <p class="hint">${esc(t('kernHint'))}</p>`;
  }
  $('kernPanel').innerHTML = section('kernPair', t('kernPair'), pairHTML)
    + section('kernList', `${t('kernAll')} (${all.length})`, `
      <input type="search" id="kernFilter" placeholder="${esc(t('search'))}" value="${esc(q)}">
      <div class="kern-list">${list.length ? list.map((k) => {
        const kind = isGroup(k.left) && isGroup(k.right) ? '' : (isGroup(k.left) || isGroup(k.right) ? 'mixed' : 'glyphs');
        return `<div class="row">
          <button type="button" class="pick" data-kpick data-l="${esc(k.left)}" data-r="${esc(k.right)}">
            <span class="${isGroup(k.left) ? 'kgroup' : ''}">${esc(kernKeyLabel(k.left))}</span>
            <span class="${isGroup(k.right) ? 'kgroup' : ''}">${esc(kernKeyLabel(k.right))}</span>
            ${kind ? `<small class="hint">${esc(t('kernException'))}</small>` : ''}</button>
          <span class="val ${k.value < 0 ? 'neg' : 'pos'}">${k.value}</span>
          <button type="button" class="btn btn-icon" data-kdel data-l="${esc(k.left)}" data-r="${esc(k.right)}" aria-label="${esc(t('delete'))}" data-tip="${esc(t('delete'))}">${icon('close', 13)}</button>
        </div>`;
      }).join('') : `<p class="hint" style="padding:8px">${esc(t('kernEmpty'))}</p>`}</div>`)
    + groupDatalists();
}

// Suggestions for group fields: the groups already used in the font.
function groupDatalists() {
  const opts = (prop) => [...new Set(app.project.glyphs.map((g) => g[prop]).filter(Boolean))].sort()
    .map((n) => `<option value="${esc(n)}"></option>`).join('');
  return `<datalist id="kernLeftList">${opts('kernLeft')}</datalist><datalist id="kernRightList">${opts('kernRight')}</datalist>`;
}

function cleanGroupName(v) { return String(v).trim().replace(/^@+/, ''); }

app.onKernChanged = () => {
  markChanged();
  kernView.render();
  const input = $('kernValue');
  const pr = kernView.pair();
  if (input && pr && document.activeElement !== input) input.value = effectiveKern(app.project, pr.left, pr.right).value;
  clearTimeout(app.kernPanelTimer);
  app.kernPanelTimer = setTimeout(renderKernPanel, 150);
};
app.onKernCursor = () => renderKernPanel();
app.onKernText = () => {
  store.set('spline.kernText', kernView.text);
  const input = $('kernText');
  if (input && document.activeElement !== input) input.value = kernView.text;
  renderKernPanel();
};

$('tabGlyphs').addEventListener('click', () => { if (app.mode !== 'grid') showGrid(); });
$('tabKerning').addEventListener('click', () => { if (app.mode !== 'kern') showKern(); });

$('optionsBar').addEventListener('input', (e) => {
  if (e.target.id === 'kernText') {
    kernView.text = e.target.value;
    kernView.cursor = Math.min(kernView.cursor, Array.from(kernView.text).length);
    store.set('spline.kernText', kernView.text);
    kernView.render();
    renderKernPanel();
  }
  if (e.target.id === 'kernSize') {
    kernView.size = Number(e.target.value);
    store.set('spline.kernSize', e.target.value);
    kernView.render();
  }
});
$('optionsBar').addEventListener('change', (e) => {
  if (e.target.id === 'kernSample' && e.target.value) {
    kernView.text = KERN_SAMPLES[e.target.value];
    kernView.cursor = 2;
    app.onKernText();
    renderKernOptions();
    kernView.render();
  }
});
$('optionsBar').addEventListener('keydown', (e) => {
  if (e.target.id === 'kernText' && e.key === 'Enter') { e.preventDefault(); $('kernCanvas').focus(); }
});

$('kernPanel').addEventListener('change', (e) => {
  const pr = kernView.pair();
  if (!pr) return;
  if (e.target.id === 'kernValue') {
    app.history.pushKerning(app.project);
    kernView.writeKern(pr, Number(e.target.value) || 0);
    app.onKernChanged();
  }
  if (e.target.dataset.useGroup) {
    kernView.useGroups[e.target.dataset.useGroup] = e.target.checked;
    renderKernPanel();
  }
  if (e.target.dataset.pairGroup) {
    // Rename / assign the group right from the pair.
    const which = e.target.dataset.pairGroup;
    const g = which === 'left' ? pr.left : pr.right;
    const prop = which === 'left' ? 'kernRight' : 'kernLeft';
    const v = cleanGroupName(e.target.value);
    if (v) g[prop] = v; else delete g[prop];
    markChanged();
    kernView.render();
    renderKernPanel();
  }
});
$('kernPanel').addEventListener('input', (e) => {
  if (e.target.id === 'kernFilter') {
    store.set('spline.kernFilter', e.target.value);
    const pos = e.target.selectionStart;
    renderKernPanel();
    const f = $('kernFilter');
    f.focus();
    f.setSelectionRange(pos, pos);
  }
});
$('kernPanel').addEventListener('click', (e) => {
  const step = e.target.closest('[data-kstep]')?.dataset.kstep;
  if (step) {
    const pr = kernView.pair();
    if (!pr) return;
    if (step === 'reset') {
      app.history.pushKerning(app.project);
      const [k1, k2] = kernView.targetKeys(pr);
      deleteKern(app.project, k1, k2);
      app.onKernChanged();
    } else kernView.adjust(Number(step));
    return;
  }
  const del = e.target.closest('[data-kdel]');
  if (del) {
    const { l, r } = del.dataset;
    app.history.pushKerning(app.project);
    deleteKern(app.project, l, r);
    app.onKernChanged();
    renderKernPanel();
    return;
  }
  const pick = e.target.closest('[data-kpick]');
  if (pick) {
    // Show the pair in the text line and put the cursor between its letters.
    // For a group, its first member stands in for it.
    const glyphFor = (key, side) => (isGroup(key) ? groupMembers(app.project, key.slice(1), side)[0] : findGlyph(key));
    const l = glyphFor(pick.dataset.l, 'right'), r = glyphFor(pick.dataset.r, 'left');
    if (!l || !r) return;
    kernView.useGroups = { left: isGroup(pick.dataset.l), right: isGroup(pick.dataset.r) };
    const pair = charOf(l) + charOf(r);
    const chars = Array.from(kernView.text);
    let idx = -1;
    for (let i = 0; i + 1 < chars.length; i++) if (chars[i] + chars[i + 1] === pair) { idx = i; break; }
    if (idx < 0) { kernView.text = `${kernView.text} ${pair}`.trim(); idx = Array.from(kernView.text).length - 2; }
    kernView.cursor = idx + 1;
    app.onKernText();
    kernView.render();
    $('kernCanvas').focus();
  }
});

function stepGlyph(dir) {
  const list = visibleGlyphs();
  const all = list.includes(app.current) ? list : app.project.glyphs;
  const i = all.indexOf(app.current);
  const next = all[(i + dir + all.length) % all.length];
  if (next) openEditor(next.name, false);
}

// ================================================================ undo

function undo() { applyHistory(app.history.undo(app.project)); }
function redo() { applyHistory(app.history.redo(app.project)); }
function applyHistory(name) {
  if (!name) return;
  markChanged();
  if (name === KERNING) {
    kernView.render();
    if (app.mode === 'kern') renderKernPanel();
    return;
  }
  if (app.mode === 'editor') {
    if (app.current?.name !== name) openEditor(name, false);
    editor.sel.clear();
    editor.penContour = null;
    editor.render();
    updateMetricInputs();
    syncTransformFields();
  } else {
    const g = findGlyph(name);
    if (g) updateTile(g);
    renderSidebar();
    renderInspector();
  }
}

// ================================================================ files

function projectBlob() { return new Blob([serialize(app.project)], { type: 'application/json' }); }

function safeFileName(ext) {
  return (app.project.info.familyName || 'font').replace(/[\\/:*?"<>|]+/g, '_').trim() + ext;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function save(saveAs = false) {
  try {
    if (app.serverFile && !saveAs) {
      const r = await fetch('/api/file', { method: 'PUT', headers: { 'X-Spline': '1', 'Content-Type': 'application/json' }, body: serialize(app.project) });
      if (!r.ok) throw new Error(await r.text());
      setDirty(false);
      toast(t('savedAs', { name: app.fileName }));
      return;
    }
    if (window.showSaveFilePicker) {
      let handle = saveAs ? null : app.fileHandle;
      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: app.fileName || safeFileName('.sp'),
          types: [{ description: 'Spline project', accept: { 'application/json': ['.sp'] } }],
        });
      }
      const w = await handle.createWritable();
      await w.write(projectBlob());
      await w.close();
      app.fileHandle = handle;
      app.fileName = handle.name;
      app.serverFile = null;
    } else {
      app.fileName = app.fileName || safeFileName('.sp');
      download(projectBlob(), app.fileName);
    }
    setDirty(false);
    autosave();
    renderAll();
    toast(t('savedAs', { name: app.fileName }));
    if (app.platform?.canAssociate && !app.platform.associated && !store.get('spline.assocHint')) {
      store.set('spline.assocHint', '1');
      setTimeout(() => toast(t('associateHint')), 600);
    }
  } catch (err) {
    if (err.name !== 'AbortError') toast(err.message, 'error');
  }
}

async function readProjectFile(file) {
  return validateProject(JSON.parse(await file.text()));
}

async function openFile(file, handle = null) {
  try {
    const p = await readProjectFile(file);
    setProject(p, { fileName: file.name, fileHandle: handle });
    autosave();
    toast(t('opened', { name: p.info.familyName }));
  } catch (err) {
    toast(t('openError', { err: err.message }), 'error');
  }
}

async function openDialog() {
  if (app.dirty && !(await confirmDialog(t('confirmNew'), t('ok'), false))) return;
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Spline project', accept: { 'application/json': ['.sp', '.json'] } }],
      });
      await openFile(await handle.getFile(), handle);
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message, 'error');
    }
    return;
  }
  pickFiles('open');
}

function pickFiles(mode) {
  const input = $('fileInput');
  input.dataset.mode = mode;
  input.accept = mode === 'svg' ? '.svg,image/svg+xml' : '.sp,.json,application/json';
  input.multiple = mode === 'svg';
  input.click();
}

$('fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const mode = e.target.dataset.mode;
  if (mode === 'svg') importSvgFiles(files);
  else if (mode === 'import') {
    try { mergeGlyphs((await readProjectFile(files[0])).glyphs); } catch (err) { toast(t('openError', { err: err.message }), 'error'); }
  } else openFile(files[0]);
});

// Adds or replaces glyphs coming from another project (file or clipboard).
function mergeGlyphs(glyphs) {
  let n = 0;
  for (const src of glyphs) {
    if (!src || !Array.isArray(src.contours)) continue;
    let g = app.project.glyphs.find((x) => (src.unicode && x.unicode === src.unicode) || (!src.unicode && x.name === src.name));
    if (!g) {
      g = { name: src.name, unicode: src.unicode || 0, advance: 600, contours: [] };
      while (app.project.glyphs.some((x) => x.name === g.name)) g.name += '.copy';
      app.project.glyphs.push(g);
    }
    app.history.push(g);
    g.contours = structuredClone(src.contours);
    g.advance = Number.isFinite(src.advance) ? src.advance : g.advance;
    if (src.color) g.color = src.color;
    n++;
  }
  if (!n) return;
  markChanged();
  renderAll();
  toast(t('pasted', { n }));
}

// ---------------------------------------------------------------- SVG import

// Finds the glyph an SVG file belongs to: "A.svg", "uni0416.svg", "Ж.svg",
// a glyph name, or the current/selected glyph.
function svgTarget(fileName, count) {
  const base = fileName.replace(/\.svg$/i, '');
  if (app.mode === 'editor') return app.current;
  const chars = Array.from(base);
  if (chars.length === 1) {
    const cp = base.codePointAt(0);
    return app.project.glyphs.find((g) => g.unicode === cp) || addGlyphForChar(app.project, base);
  }
  const byName = findGlyph(base);
  if (byName) return byName;
  const m = base.match(/^(?:uni|u\+?)([0-9a-f]{4,6})$/i);
  if (m) {
    const ch = String.fromCodePoint(parseInt(m[1], 16));
    return app.project.glyphs.find((g) => g.unicode === ch.codePointAt(0)) || addGlyphForChar(app.project, ch);
  }
  if (count === 1 && app.selected.size === 1) return selectedGlyphs()[0];
  return null;
}

async function importSvgText(text, g) {
  const res = await importSVG(text, app.project.info, charOf(g));
  app.history.push(g);
  const wasEmpty = !g.contours.length;
  g.contours.push(...res.contours);
  if (wasEmpty) g.advance = res.advance;
  normalizeDirections(g);
  return res;
}

async function importSvgFiles(files) {
  let last = null;
  for (const file of files) {
    const g = svgTarget(file.name, files.length);
    if (!g) { toast(t('svgNoTarget', { file: file.name }), 'error'); continue; }
    try {
      const res = await importSvgText(await file.text(), g);
      toast(t(res.traced ? 'svgTraced' : 'svgImported', { name: charOf(g).trim() || g.name }));
      last = g;
    } catch (err) {
      toast(t('svgError', { file: file.name, err: err.message }), 'error');
    }
  }
  if (!last) return;
  if (app.mode === 'editor') { editor.sel.clear(); editor.afterEdit(false); editor.fit(); renderGlyphPanel(); return; }
  markChanged();
  if (files.length === 1) { app.selected = new Set([last.name]); app.focusName = last.name; }
  renderAll();
}

// Windows: register Spline for .sp files (icon in Explorer, double-click).
async function associateFiles() {
  try {
    const r = await fetch('/api/associate', { method: 'POST', headers: { 'X-Spline': '1' } });
    if (!r.ok) throw new Error(await r.text());
    app.platform.associated = true;
    renderMenus();
    toast(t('associated'));
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function exportFont(format) {
  try {
    const r = await fetch(`/api/export?format=${format}`, {
      method: 'POST', headers: { 'X-Spline': '1', 'Content-Type': 'application/json' }, body: serialize(app.project),
    });
    if (!r.ok) throw new Error(await r.text());
    const name = safeFileName('.' + format);
    download(await r.blob(), name);
    toast(t('exported', { name }));
  } catch (err) {
    toast(`${t('previewError')}: ${err.message}`, 'error');
  }
}

// Drag & drop of .sp and .svg files anywhere in the window.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  $('dropOverlay').hidden = false;
});
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropOverlay').hidden = true;
  const files = [...e.dataTransfer.files];
  const svgs = files.filter((f) => /\.svg$/i.test(f.name) || f.type === 'image/svg+xml');
  if (svgs.length) {
    // Dropping on a tile targets that glyph.
    const tile = e.target.closest?.('.tile');
    if (tile && svgs.length === 1 && app.mode === 'grid') app.selected = new Set([tile.dataset.name]);
    importSvgFiles(svgs);
    return;
  }
  const sp = files.find((f) => /\.(sp|json)$/i.test(f.name));
  if (!sp) return;
  if (app.dirty && !(await confirmDialog(t('confirmNew'), t('ok'), false))) return;
  openFile(sp);
});

// ================================================================ clipboard

const typing = (el) => !!el?.matches && (el.matches('input, textarea, select, [contenteditable]') || el.closest('dialog[open]'));

document.addEventListener('copy', (e) => {
  if (typing(document.activeElement)) return;
  let payload;
  if (app.mode === 'editor') {
    payload = { format: 'spline-contours', contours: editor.copyContours() };
  } else {
    const glyphs = selectedGlyphs();
    if (!glyphs.length) return;
    payload = { format: 'spline-glyphs', glyphs };
  }
  e.clipboardData.setData('text/plain', JSON.stringify(payload));
  e.preventDefault();
  toast(t('copied'));
});

document.addEventListener('cut', (e) => {
  if (typing(document.activeElement) || app.mode !== 'editor' || !editor.sel.size) return;
  e.clipboardData.setData('text/plain', JSON.stringify({ format: 'spline-contours', contours: editor.copyContours() }));
  e.preventDefault();
  editor.deleteSelection();
});

document.addEventListener('paste', (e) => {
  if (typing(document.activeElement)) return;
  const text = e.clipboardData.getData('text/plain') || e.clipboardData.getData('image/svg+xml');
  if (text) { e.preventDefault(); handlePasteText(text); }
});

async function pasteFromMenu() {
  try { handlePasteText(await navigator.clipboard.readText()); } catch (err) { toast(err.message, 'error'); }
}

async function handlePasteText(text) {
  if (looksLikeSVG(text)) {
    const g = app.mode === 'editor' ? app.current : (app.selected.size === 1 ? selectedGlyphs()[0] : null);
    if (!g) { toast(t('svgNoTarget', { file: 'SVG' }), 'error'); return; }
    try {
      const res = await importSvgText(text, g);
      toast(t(res.traced ? 'svgTraced' : 'svgImported', { name: charOf(g).trim() || g.name }));
      if (app.mode === 'editor') { editor.sel.clear(); editor.afterEdit(false); } else { markChanged(); updateTile(g); renderInspector(); renderSideMetrics(); }
    } catch (err) { toast(t('svgError', { file: 'SVG', err: err.message }), 'error'); }
    return;
  }
  let data;
  try { data = JSON.parse(text); } catch { return; }
  const glyphs = data.format === 'spline-glyphs' || data.format === 'spline' ? data.glyphs : null;
  if (app.mode === 'editor') {
    if (data.format === 'spline-contours') editor.pasteContours(data.contours);
    else if (glyphs?.length === 1) editor.pasteContours(glyphs[0].contours);
    else if (glyphs) { showGrid(); mergeGlyphs(glyphs); }
  } else if (glyphs) {
    mergeGlyphs(glyphs);
  } else if (data.format === 'spline-contours' && app.selected.size === 1) {
    openEditor([...app.selected][0]);
    editor.pasteContours(data.contours);
  }
}

// ================================================================ commands & keyboard

const COMMANDS = {
  addGlyph: addGlyphs, importSvg: () => pickFiles('svg'), fontInfo: editFontInfo,
  draw: () => openEditor([...app.selected][0]), deleteGlyph: deleteSelectedGlyphs,
  spacing: () => glyphAction('spacing'), clear: () => glyphAction('clear'),
  flipH: () => applyTransform('flipH'), flipV: () => applyTransform('flipV'),
  undo, redo,
  zoomIn: () => editor.zoomBy(1.25), zoomOut: () => editor.zoomBy(0.8), zoomFit: () => editor.fit(),
  prev: () => stepGlyph(-1), next: () => stepGlyph(1),
  autoGroups,
  xfReset, xfApply: () => editor.commitTransform(), xfCancel: () => editor.cancelTransform(),
};

// Letters come from the physical key (e.code), so shortcuts work with any
// keyboard layout: Ctrl+Z is Ctrl+Z even when the Russian layout is active.
const keyOf = (e) => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : (e.key || '').toLowerCase());

// What each reassignable shortcut does. `when` limits it to a mode;
// `always` also works while typing in a field or a dialog.
const inEditorMode = () => app.mode === 'editor';
const ACTIONS = {
  new: { run: newFontDialog }, open: { run: openDialog },
  save: { run: () => save(), always: true }, saveAs: { run: () => save(true), always: true },
  importSvg: { run: () => pickFiles('svg') },
  exportTTF: { run: () => exportFont('ttf') }, exportOTF: { run: () => exportFont('otf') },
  undo: { run: undo }, redo: { run: redo }, selectAll: { run: selectAll },
  freeTransform: { run: startTransform, when: inEditorMode },
  zoomIn: { run: () => editor.zoomBy(1.25), when: inEditorMode },
  zoomOut: { run: () => editor.zoomBy(0.8), when: inEditorMode },
  zoomFit: { run: () => editor.fit(), when: inEditorMode },
  viewKerning: { run: () => (app.mode === 'kern' ? showGrid() : showKern()) },
  rulers: { run: () => toggleView('showRulers') }, userGuides: { run: () => toggleView('showUserGuides') },
  showGuide: { run: () => toggleView('showGuide') }, showGrid: { run: () => toggleView('showGrid') },
  snapGrid: { run: () => toggleView('snapGrid'), always: true },
  snapGuides: { run: () => toggleView('snapGuides'), always: true },
  prev: { run: () => stepGlyph(-1), when: inEditorMode }, next: { run: () => stepGlyph(1), when: inEditorMode },
  ...Object.fromEntries(TOOLS.map((tl) => [`tool.${tl.id}`, { run: () => setTool(tl.id), when: inEditorMode, label: () => toolName(tl.id) }])),
  ...Object.fromEntries(PATH_OPS.map((op) => [`op.${op.id}`, { run: () => runPathOp(op.id), when: inEditorMode, always: true, label: () => t(op.label) }])),
  autoSpacing: { run: () => glyphAction('spacing'), when: () => app.mode === 'editor' || app.selected.size > 0 },
  flipH: { run: () => applyTransform('flipH'), when: () => app.mode === 'editor' || app.selected.size > 0 },
  flipV: { run: () => applyTransform('flipV'), when: () => app.mode === 'editor' || app.selected.size > 0 },
  fontInfo: { run: editFontInfo }, shortcuts: { run: helpDialog, always: true },
};

let keyCapture = null; // the shortcut being reassigned in the shortcuts dialog

document.addEventListener('keydown', (e) => {
  if (keyCapture) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = keyOf(e);
  const combo = comboOf(e);
  const act = combo && ACTIONS[actionFor(combo)];
  if (act) {
    const busy = !act.always && (typing(e.target) || e.target.closest?.('#menus'));
    // In the kerning view plain keys type text.
    const kernText = app.mode === 'kern' && !mod && !e.altKey && combo.replace(/^Shift\+/, '').length === 1;
    if (!busy && !kernText && (!act.when || act.when())) { e.preventDefault(); act.run(); return; }
  }
  if (typing(e.target) || e.target.closest?.('#menus')) return;
  if (app.mode === 'kern') {
    // The canvas works like a text line: type to add letters, arrows move
    // the cursor, Alt+arrows change the kerning (Shift: by 1).
    if (mod) return;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      kernView.adjust((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 10));
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); kernView.moveCursor(e.key === 'ArrowLeft' ? -1 : 1); renderKernPanel(); return; }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); kernView.moveCursor(e.key === 'Home' ? -1e9 : 1e9); renderKernPanel(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); kernView.deleteChar(e.key === 'Delete'); return; }
    if (e.key === 'Escape') { showGrid(); return; }
    if (e.key.length === 1 && !e.altKey && e.target === $('kernCanvas')) { e.preventDefault(); kernView.insertText(e.key); }
    return;
  }
  if (app.mode !== 'editor') {
    if ((e.key === 'Delete' || e.key === 'Backspace') && app.selected.size && e.target.closest?.('#glyphGrid')) {
      e.preventDefault();
      deleteSelectedGlyphs();
    }
    return;
  }
  if (mod || e.altKey) return;
  const step = e.shiftKey ? 10 : 1;
  const arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, step], arrowdown: [0, -step] };
  if (arrows[key]) {
    if (editor.xform ? editor.nudgeTransform(...arrows[key]) : editor.nudge(...arrows[key])) e.preventDefault();
    return;
  }
  switch (e.key) {
    case 'Delete': case 'Backspace': if (editor.deleteSelection()) e.preventDefault(); break;
    case 'Escape': if (!editor.escape()) history.back(); break;
    case 'Enter': if (editor.xform) editor.commitTransform(); else editor.finishPen(); break;
    case ' ':
      if (e.target === $('canvas') || e.target === document.body) {
        e.preventDefault();
        editor.spaceDown = true;
        $('canvas').style.cursor = 'grab';
      }
      break;
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && editor.spaceDown) { editor.spaceDown = false; editor.render(); }
});

// ================================================================ preview

let previewTimer, previewFace, previewSeq = 0;
function schedulePreview(delay = 500) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, delay);
}

async function updatePreview() {
  const msg = $('previewMsg');
  if (!app.project.glyphs.some((g) => g.contours.length)) {
    msg.textContent = t('previewEmpty');
    $('previewOut').hidden = true;
    return;
  }
  const seq = ++previewSeq;
  try {
    const r = await fetch('/api/export?format=ttf', {
      method: 'POST', headers: { 'X-Spline': '1', 'Content-Type': 'application/json' }, body: serialize(app.project),
    });
    if (!r.ok) throw new Error(await r.text());
    const buf = await r.arrayBuffer();
    if (seq !== previewSeq) return;
    const family = `SplinePreview${seq}`;
    const face = new FontFace(family, buf);
    await face.load();
    document.fonts.add(face);
    if (previewFace) document.fonts.delete(previewFace);
    previewFace = face;
    $('previewOut').style.setProperty('--preview-font', `"${family}"`);
    renderPreviewText();
    $('previewOut').hidden = false;
    msg.textContent = '';
  } catch (err) {
    if (seq === previewSeq) msg.textContent = `${t('previewError')}: ${err.message}`;
  }
}

// Drawn glyphs use the new font; missing ones are dimmed in a fallback font.
function renderPreviewText() {
  if (!app.project) return;
  const drawn = new Set(app.project.glyphs.filter((g) => g.contours.length || g.unicode === 32).map((g) => g.unicode));
  const out = $('previewOut');
  out.textContent = '';
  let run = '', runMine = null;
  const flush = () => {
    if (!run) return;
    const span = document.createElement('span');
    span.className = runMine ? 'mine' : 'missing';
    span.textContent = run;
    out.append(span);
    run = '';
  };
  for (const ch of $('previewInput').value) {
    const mine = drawn.has(ch.codePointAt(0)) || ch === '\n';
    if (mine !== runMine) { flush(); runMine = mine; }
    run += ch;
  }
  flush();
}

function initPreview() {
  $('previewInput').value = store.get('spline.previewText') || t('previewText');
  $('previewInput').addEventListener('input', (e) => {
    renderPreviewText();
    store.set('spline.previewText', e.target.value);
  });
  const size = $('previewSize');
  const apply = () => { $('previewOut').style.fontSize = `${size.value}px`; $('previewSizeOut').textContent = size.value; };
  size.addEventListener('input', apply);
  apply();
  const toggle = $('previewToggle');
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', open);
    $('previewBody').hidden = !open;
    store.set('spline.previewOpen', open ? '1' : '0');
    if (app.mode === 'editor') editor.resize();
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  setOpen(store.get('spline.previewOpen', '1') === '1');
}

// ================================================================ start

$('fontNameBtn').addEventListener('click', editFontInfo);
$('exportBtn').addEventListener('click', () => exportFont('ttf'));

function refreshLang() {
  applyStatic();
  $('exportBtn').dataset.tip = t('exportTTF');
  renderAll();
  if (app.mode === 'editor') { renderToolbar(); renderEditorOptions(); renderGlyphPanel(); editor.updateAria(); editor.render(); }
}
onLangChange(refreshLang);

async function start() {
  document.documentElement.dataset.theme = store.get('spline.theme', 'dark');
  fillIcons();
  document.documentElement.lang = getLang();
  applyStatic();
  initPreview();

  let session = null;
  try { session = await (await fetch('/api/session')).json(); } catch { /* opened without the Go server */ }
  app.platform = {
    canAssociate: !!session?.canAssociate, associated: !!session?.associated,
    web: !!session?.web, privacy: !!session?.privacy, // hosted website (spline --web)
  };

  let loaded = false;
  if (session?.filePath) {
    if (session.project) {
      try {
        setProject(validateProject(session.project), { fileName: session.fileName, serverFile: session.filePath });
        loaded = true;
      } catch (err) { toast(t('openError', { err: err.message }), 'error'); }
    } else if (session.error) {
      toast(t('openError', { err: session.error }), 'error');
    } else {
      setProject(newProject({ family: session.fileName.replace(/\.sp$/i, '') }), { fileName: session.fileName, serverFile: session.filePath });
      loaded = true;
    }
  }
  if (!loaded) {
    try {
      const saved = JSON.parse(store.get(AUTOSAVE_KEY) || 'null');
      if (saved?.project) {
        setProject(validateProject(JSON.parse(saved.project)), { fileName: saved.fileName });
        loaded = true;
        if (saved.project.length > 2000) toast(t('restored'));
      }
    } catch { /* broken autosave */ }
  }
  if (!loaded) setProject(newProject({ family: getLang() === 'ru' ? 'Мой шрифт' : 'My Font' }));
  refreshLang();

  const m = location.hash.match(/^#glyph=(.+)$/);
  setViewTabs();
  if (location.hash === '#kern') showKern(false);
  else if (m && findGlyph(decodeURIComponent(m[1]))) openEditor(decodeURIComponent(m[1]), false);
  else history.replaceState({}, '', location.pathname);
  if (!app.platform.web) checkUpdates();
}

// ================================================================ updates

// Opens one of Spline's web pages in the default browser (also works in
// the app window, where window.open would not).
function openPage(page) {
  if (app.platform?.web) {
    window.open(`https://github.com/GeekFreak01/spline${page === 'releases' ? '/releases/latest' : ''}`, '_blank', 'noopener');
    return;
  }
  fetch(`/api/open-page?page=${page}`, { method: 'POST', headers: { 'X-Spline': '1' } })
    .catch(() => window.open(`https://github.com/GeekFreak01/spline${page === 'releases' ? '/releases/latest' : ''}`, '_blank', 'noopener'));
}

let updateInfo = null;

// Checks GitHub for a newer release: automatically once a day, or from the
// Help menu. A badge in the status bar offers the update.
async function checkUpdates(manual = false) {
  const last = Number(store.get('spline.updateChecked', '0'));
  if (!manual && Date.now() - last < 24 * 3600 * 1000) {
    try { updateInfo = JSON.parse(store.get('spline.updateInfo') || 'null'); } catch { updateInfo = null; }
    showUpdateBadge();
    return;
  }
  try {
    const r = await fetch(`/api/update${manual ? '?force=1' : ''}`);
    if (!r.ok) throw new Error(await r.text());
    updateInfo = await r.json();
    if (updateInfo.error) throw new Error(updateInfo.error);
    store.set('spline.updateChecked', String(Date.now()));
    store.set('spline.updateInfo', JSON.stringify(updateInfo));
  } catch (err) {
    if (manual) toast(t('updateCheckFailed', { err: err.message }), 'error');
    return;
  }
  showUpdateBadge();
  if (manual && !updateInfo.available) toast(t('upToDate', { v: updateInfo.current }));
  if (manual && updateInfo.available) installUpdate();
}

function showUpdateBadge() {
  const b = $('updateBadge');
  const show = !!updateInfo?.available && updateInfo.latest !== updateInfo.current;
  b.hidden = !show;
  if (show) b.textContent = t('updateBadge', { v: updateInfo.latest.replace(/^v/, '') });
}

async function installUpdate() {
  if (!updateInfo?.available) return;
  const v = updateInfo.latest.replace(/^v/, '');
  if (!updateInfo.installed) {
    // Portable copy or macOS/Linux: show the release page.
    if (await confirmDialog(t('updatePortable', { v }), t('updateOpenPage'), false)) openPage('releases');
    return;
  }
  const ok = await showDialog({
    title: t('updateTitle', { v }),
    body: `<p>${esc(t('updateBody'))}</p>${app.dirty ? `<p class="hint">${esc(t('updateUnsaved'))}</p>` : ''}`,
    okLabel: t('updateNow'),
  });
  if (!ok) return;
  autosave();
  toast(t('updateDownloading', { v }));
  try {
    const r = await fetch('/api/update/install', { method: 'POST', headers: { 'X-Spline': '1' } });
    if (!r.ok) throw new Error(await r.text());
    toast(t('updateInstalling'));
  } catch (err) {
    toast(t('updateFailed', { err: err.message }), 'error');
  }
}

$('updateBadge').addEventListener('click', installUpdate);

// ================================================================ app window frame

// Inside the Spline window (WebView2) the system title bar is removed and
// the menu bar acts as the title bar: drag to move, double-click to
// maximize, custom minimize / maximize / close buttons, resize at the edges.
function initWindowFrame() {
  if (typeof window.splineWindow !== 'function') return; // regular browser
  const call = async (action, arg = '') => {
    const state = await window.splineWindow(action, arg);
    document.documentElement.classList.toggle('maximized', state === 'maximized');
  };
  document.documentElement.classList.add('native');
  $('winControls').hidden = false;
  $('resizeEdges').hidden = false;
  $('winControls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-win]');
    if (b) call(b.dataset.win);
  });
  const isDragArea = (el) => !el.closest('button, input, select, a, [role="menu"], [role="menuitem"], .view-switch');
  document.querySelector('.menubar').addEventListener('pointerdown', (e) => {
    if (e.button === 0 && e.detail === 1 && isDragArea(e.target)) call('drag');
  });
  document.querySelector('.menubar').addEventListener('dblclick', (e) => {
    if (isDragArea(e.target)) call('toggleMaximize');
  });
  $('resizeEdges').addEventListener('pointerdown', (e) => {
    const edge = e.target.dataset.edge;
    if (edge && e.button === 0) { e.preventDefault(); call('resize', edge); }
  });
  window.addEventListener('resize', () => call('state'));
  call('state');
}
initWindowFrame();

// Lets the program know the editor is still open (it quits after the last
// browser window is closed).
// Desktop only: the local server quits after the last editor page is gone.
const ping = () => fetch('/api/ping', { method: 'POST', headers: { 'X-Spline': '1' } }).then((r) => {
  if (r.status === 404) clearInterval(pingTimer); // hosted website: nothing to keep alive
}).catch(() => {});
ping();
const pingTimer = setInterval(ping, 20000);

start();
