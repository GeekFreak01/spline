import { t, setLang, getLang, onLangChange, applyStatic } from './i18n.js';
import { icon, fillIcons } from './icons.js';
import { CATEGORIES, COLORS } from './glyphsets.js';
import {
  newProject, validateProject, serialize, addGlyphForChar, charOf, isDrawn, svgPath, glyphBox,
  translateGlyph, normalizeDirections, hasOutline, rectContour, ellipseContour,
} from './model.js';
import { refreshComponents, usedBy, decompose } from './components.js';
import { isCornerGlyph, isBrushGlyph } from './parts.js';
import { isSmart, editingState, editState, saveSmart, addProp, removeProp, smartProblems } from './smart.js';
import { hasMasters, activeId, defaultId, switchMaster, saveForm, addMaster, deleteMaster, problems, instanceAt, matchContour, setWidthAxis } from './masters.js';
import { offsetContours, roundCorners, strokeContours, fitCurves } from './filters.js';
import { removeOverlap, shapesOf } from './boolean.js';
import { suggestedAnchors, defaultAnchor, attachOffset, anchorOf, isMarkGlyph } from './anchors.js';
import { History, KERNING, GROUPS } from './history.js';
import { KernView, setKern, deleteKern, kernPairs, effectiveKern, isGroup, groupKey, groupMembers, isOverkern } from './kerning.js';
import { Editor } from './editor.js';
import { importSVG, looksLikeSVG } from './svg.js';
import { proposeGroups, letterKind, pairGap } from './shape.js';
import { setDefaults, keyLabel, comboOf, comboLabel, actionFor, assign, resetAll, bindings, isCustom, BROWSER_RESERVED, TAKEN } from './keys.js';
import { initPanels, layoutPanels, setHidden, isHidden, resetPanels, recordOrder, watchResize, openWindow } from './panels.js';
import { recompose, composeInfo } from './compose.js';
import { simplifyContours, addExtremesTo } from './simplify.js';
import { KEY_FIELDS, isKey, outOfSync, updateMetrics, setMetric, sides } from './metrics.js';

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
  simplify: [], new: [], open: ['Ctrl+O'], save: ['Ctrl+S'], saveAs: ['Ctrl+Shift+S'], importSvg: [], exportTTF: [], exportOTF: [], exportWOFF: [], exportWOFF2: [], specialForm: [],
  undo: ['Ctrl+Z'], redo: ['Ctrl+Shift+Z', 'Ctrl+Y'], selectAll: ['Ctrl+A'], freeTransform: ['Ctrl+T'],
  invertSelection: ['Ctrl+Shift+I'], addExtremes: ['Ctrl+Shift+E'], makeFirst: [], alignPoints: ['Ctrl+Shift+A'], breakContour: [], joinContours: [], bgCopy: [], updateMetrics: ['Ctrl+Alt+M'],
  zoomIn: ['=', 'Shift+=', 'Num +'], zoomOut: ['-', 'Num -'], zoomFit: ['0', 'Num 0'],
  viewKerning: ['Ctrl+K'], rulers: ['Ctrl+R'], userGuides: ['Ctrl+;'], showGuide: [], showGrid: [],
  snapGrid: ['F9'], snapGuides: ['F10'], prev: ['PageUp'], next: ['PageDown'],
  'tool.measure': ['M'], selShapeCycle: ['Shift+V'], 'tool.pixel': ['G'], 'tool.select': ['V'], 'tool.pen': ['P'], 'tool.brush': ['B'], 'tool.eraser': ['E'],
  'tool.rect': ['R'], 'tool.ellipse': ['O'], 'tool.knife': ['K'], 'tool.hand': ['H'],
  'op.unite': ['Ctrl+Alt+U'], 'op.subtract': ['Ctrl+Alt+M'], 'op.intersect': ['Ctrl+Alt+I'],
  'op.exclude': ['Ctrl+Alt+E'], 'op.divide': ['Ctrl+Alt+D'], 'op.removeOverlap': ['Ctrl+Alt+O'],
  autoSpacing: [], flipH: [], flipV: [], fontInfo: [], groups: [], newVariant: [], newLigature: [], shapeGroups: [], shortcuts: ['F1'],
  kernShowGroups: ['Alt+G'], kernNextSample: ['Ctrl+]'], kernPrevSample: ['Ctrl+['],
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
  { id: 'measure', icon: 'ruler', key: 'M', ext: true },
  { id: 'pixel', icon: 'pixel', key: 'G', ext: true },
];
const visibleTools = () => TOOLS.filter((tl) => !tl.ext || app.extended);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const toolName = (id) => t('tool' + cap(id));
const toolTip = (id) => t('tip' + cap(id));

const app = {
  project: null,
  // Extended mode adds the tools of the "Ultimate" update; the simple mode
  // stays as it was. Kept in the settings, not in the project.
  extended: (() => { try { return localStorage.getItem('spline.extended') === '1'; } catch { return false; } })(),
  gridView: (() => { try { return localStorage.getItem('spline.gridView') || 'tiles'; } catch { return 'tiles'; } })(),
  smartFilter: null, tagFilter: null, tableSort: null,
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

// Where dialogs of a kind (cls) were dragged to: they open there again.
const dialogPos = new Map();

function placeDialog(dlg, x, y) {
  const r = dlg.getBoundingClientRect();
  x = Math.max(0, Math.min(innerWidth - r.width, x));
  y = Math.max(0, Math.min(innerHeight - 40, y));
  Object.assign(dlg.style, { margin: '0', left: `${x}px`, top: `${y}px` });
  return { x, y };
}

// Dialogs move by their title, like windows.
function dragDialog(dlg, cls) {
  const head = dlg.querySelector('h2');
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = dlg.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const at = placeDialog(dlg, ev.clientX - dx, ev.clientY - dy);
      if (cls) dialogPos.set(cls, at);
    };
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });
}

// Modal dialog. Resolves with FormData (OK) or null (cancel).
function showDialog({ title, body, okLabel = t('ok'), okClass = 'btn-primary', cancel = true, onOpen = null, cls = '' }) {
  const dlg = $('dialog');
  dlg.className = `dialog ${cls}`.trim();
  dlg.removeAttribute('style');
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
    // Enter in a field is OK (the browser would take the first button, Cancel).
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.shiftKey || !e.target.matches('input:not([type=checkbox]):not([type=radio]), select')) return;
      e.preventDefault();
      form.querySelector('button[value=ok]').click();
    });
    dlg.addEventListener('close', () => resolve(data), { once: true });
    dlg.showModal();
    dragDialog(dlg, cls);
    const pos = cls && dialogPos.get(cls);
    if (pos) placeDialog(dlg, pos.x, pos.y);
    onOpen?.(dlg);
    const first = dlg.querySelector('input:not([type=checkbox])');
    if (first) { first.focus(); first.select?.(); }
  });
}

async function confirmDialog(msg, okLabel, danger = true) {
  return !!(await showDialog({ title: msg, body: '', okLabel, okClass: danger ? 'btn-danger' : 'btn-primary' }));
}

function glyphSVG(g, cls = 'glyph') {
  const { ascender: asc, descender: desc } = app.project.info;
  const pal = app.project.palette;
  const painted = pal?.length && g.contours.some((c) => c.paint);
  const b = glyphBox(g);
  const minX = Math.min(0, b ? b.minX : 0), maxX = Math.max(g.advance, b ? b.maxX : 0, 1);
  const top = Math.max(asc, b ? b.maxY : 0), bottom = Math.min(desc, b ? b.minY : 0);
  const pad = 30;
  return `<svg class="${cls}" viewBox="${minX - pad} ${-top - pad} ${maxX - minX + 2 * pad} ${top - bottom + 2 * pad}" aria-hidden="true">
    ${painted ? paintGroups(g).map(([paint, cs]) => `<path transform="scale(1 -1)" d="${svgPath({ contours: cs })}" fill="${paint ? esc(pal[paint - 1]) : 'currentColor'}"/>`).join('')
      : `<path transform="scale(1 -1)" d="${svgPath(g)}" fill="currentColor"/>`}</svg>`;
}

const findGlyph = (name) => app.project.glyphs.find((g) => g.name === name);
const hex = (g) => (g.unicode ? g.unicode.toString(16).toUpperCase().padStart(4, '0') : '');
const selectedGlyphs = () => [...app.selected].map(findGlyph).filter(Boolean);

// ================================================================ project state

function setProject(p, { fileName = null, fileHandle = null, serverFile = null } = {}) {
  refreshComponents(p);
  recompose(p);
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
  const touched = new Set([...refreshComponents(app.project), ...recompose(app.project)]);
  if (app.mode === 'grid') touched.forEach(updateTile);
  setDirty(true);
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, 700);
  schedulePreview();
}

function autosave() {
  store.set(AUTOSAVE_KEY, JSON.stringify({ fileName: app.fileName, project: projectJSON() }));
}

// Editor callbacks.
app.commitGlyph = (g) => {
  markChanged();
  if (app.extended && hasMasters(app.project) && g) queueMicrotask(() => { if (app.current === g) renderGlyphPanel(); });
  if (editor.preview) queueMicrotask(previewFilter);
  updateMetricInputs();
  if (g && composeState(g) !== $('glyphPanel').querySelector('[data-compose]')?.dataset.compose) renderGlyphPanel();
  else if (app.extended && g?.anchors?.length) renderGlyphPanel();
};
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
      { label: 'openFont', run: () => pickFiles('font') },
      '-',
      { label: 'importSvg', key: keyLabel('importSvg'), run: () => pickFiles('svg') },
      { label: 'importSp', run: () => pickFiles('import') },
      '-',
      { label: 'save', key: keyLabel('save'), run: () => save() },
      { label: 'saveAs', key: keyLabel('saveAs'), run: () => save(true) },
      '-',
      { label: 'exportTTF', key: keyLabel('exportTTF'), run: () => exportFont('ttf') },
      { label: 'exportOTF', key: keyLabel('exportOTF'), run: () => exportFont('otf') },
      { label: 'exportWOFF2', key: keyLabel('exportWOFF2'), run: () => exportFont('woff2'), ext: true },
      { label: 'exportWOFF', key: keyLabel('exportWOFF'), run: () => exportFont('woff'), ext: true },
      { label: 'msExport', run: exportInstances, enabled: hasMasters(app.project || {}), ext: true },
      { label: 'vfExport', run: exportVariable, enabled: hasMasters(app.project || {}), ext: true },
      ...(app.platform?.canInstall ? [{ label: 'installFont', run: installFont }] : []),
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
      { label: 'invertSelection', key: keyLabel('invertSelection'), run: () => editor.invertSelection(), enabled: inEditor, ext: true },
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
      { label: 'extendedMode', check: app.extended, run: () => setExtended(!app.extended) },
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
      { label: 'simplify', key: keyLabel('simplify'), run: simplifyGlyphs, enabled: inEditor || app.selected.size > 0 },
      { label: 'flipH', key: keyLabel('flipH'), run: () => applyTransform('flipH'), enabled: inEditor || app.selected.size > 0 },
      { label: 'flipV', key: keyLabel('flipV'), run: () => applyTransform('flipV'), enabled: inEditor || app.selected.size > 0 },
      { label: 'clear', run: () => glyphAction('clear'), enabled: inEditor },
      { label: 'ulMenu', run: () => pickFiles('image'), enabled: inEditor || app.selected.size === 1 },
      '-',
      { label: 'addExtremes', key: keyLabel('addExtremes'), run: addExtremes, enabled: inEditor, ext: true },
      { label: 'makeFirst', key: keyLabel('makeFirst'), run: makeFirst, enabled: inEditor && editor.sel.size === 1, ext: true },
      { label: 'alignPoints', key: keyLabel('alignPoints'), run: alignPoints, enabled: inEditor && editor.sel.size > 1, ext: true },
      { label: 'breakContour', key: keyLabel('breakContour'), run: breakContour, enabled: inEditor && editor.sel.size === 1, ext: true },
      { label: 'joinContours', key: keyLabel('joinContours'), run: joinContours, enabled: inEditor && editor.sel.size > 0, ext: true },
      { label: 'bgCopy', key: keyLabel('bgCopy'), run: () => backgroundOp('copy'), enabled: inEditor, ext: true },
      { label: 'bgSwap', run: () => backgroundOp('swap'), enabled: inEditor, ext: true },
      { label: 'cmAddMenu', run: addComponentDialog, enabled: inEditor, ext: true },
      { label: 'msMenu', run: mastersDialog, ext: true },
      '-',
      { label: 'wAnchors', run: () => openWindow('anchors'), enabled: inEditor, ext: true },
      { label: 'wPaint', run: () => openWindow('paint'), enabled: inEditor, ext: true },
      { label: 'wSmart', run: () => openWindow('smart'), enabled: inEditor && canBeSmart(app.current), ext: true },
      { label: 'wBackground', run: () => openWindow('background'), enabled: inEditor, ext: true },
      { label: 'cmDecomposeMenu', run: decomposeCurrent, enabled: inEditor && !!app.current?.components?.length, ext: true },
      { label: 'updateMetrics', key: keyLabel('updateMetrics'), run: updateAllMetrics, ext: true },
      '-',
      ...PATH_OPS.map((op) => ({ label: op.label, key: keyLabel(`op.${op.id}`), run: () => runPathOp(op.id), enabled: inEditor })),
      '-',
      { label: 'varNewMenu', key: keyLabel('newVariant'), run: newVariant, enabled: inEditor || app.selected.size === 1 },
      { label: 'sfMenu', key: keyLabel('specialForm'), run: () => specialFormDialog(), enabled: inEditor || app.selected.size === 1, ext: true },
      { label: 'ligNewMenu', key: keyLabel('newLigature'), run: newLigature },
      { label: 'kgTitleMenu', key: keyLabel('groups'), run: () => groupsDialog() },
      { label: 'sgMenu', key: keyLabel('shapeGroups'), run: shapeGroupsDialog },
      { label: 'fontInfo', key: keyLabel('fontInfo'), run: editFontInfo },
    ] },
    { id: 'menuFilter', items: [
      { text: `${t('fl_offset')}…`, run: () => openFilter('offset'), enabled: inEditor, ext: true },
      { text: `${t('fl_round')}…`, run: () => openFilter('round'), enabled: inEditor, ext: true },
      { text: `${t('fl_stroke')}…`, run: () => openFilter('stroke'), enabled: inEditor, ext: true },
      { text: `${t('fl_fit')}…`, run: () => openFilter('fit'), enabled: inEditor, ext: true },
      '-',
      { label: 'tmMenu', run: transformMetricsDialog, enabled: inEditor || app.selected.size > 0, ext: true },
    ] },
    { id: 'menuWindow', items: [
      // Only the panels of the current view: glyphs or kerning.
      ...PANELS.filter(([id]) => id.startsWith('kern') === (app.mode === 'kern'))
        .map(([id, label]) => ({ label, check: !isHidden(id), run: () => setHidden(id, !isHidden(id)) })),
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

// Menu items marked `ext` exist only in the extended mode.
function visibleItems(items) {
  const out = items.filter((it) => it === '-' || !it.ext || app.extended);
  return out.filter((it, i) => it !== '-' || (i > 0 && out[i - 1] !== '-' && i < out.length - 1));
}

function shownMenus() {
  return menuDefs().map((m) => ({ ...m, items: visibleItems(m.items) })).filter((m) => m.items.length);
}

function renderMenus() {
  const defs = shownMenus();
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
  const def = shownMenus()[i].items[j];
  setMenu(null);
  def.run();
});
$('menus').addEventListener('mouseover', (e) => {
  const root = e.target.closest('[data-menu]');
  if (root && openMenu !== null && Number(root.dataset.menu) !== openMenu) setMenu(Number(root.dataset.menu));
});
$('menus').addEventListener('keydown', (e) => {
  const count = shownMenus().length;
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

function grouped() { return app.category === 'all' && !app.search.trim() && !app.colorFilter && !app.smartFilter && !app.tagFilter && !(app.extended && app.gridView === 'table'); }

function visibleGlyphs() {
  const cat = CATEGORIES.find((c) => c.id === app.category);
  const q = app.search.trim().toLowerCase();
  const list = app.project.glyphs.filter((g) => {
    const ch = charOf(g);
    if (app.category === 'empty') { if (isDrawn(g)) return false; } else if (app.category === 'done') {
      if (!isDrawn(g)) return false;
    } else if (cat && !cat.test(ch)) return false;
    if (app.colorFilter && g.color !== app.colorFilter) return false;
    if (app.extended && app.smartFilter && !SMART_FILTERS[app.smartFilter]?.(g)) return false;
    if (app.extended && app.tagFilter && !g.tags?.includes(app.tagFilter)) return false;
    if (q) {
      const h = g.unicode ? g.unicode.toString(16) : '';
      const extra = app.extended && ((g.note || '').toLowerCase().includes(q) || g.tags?.some((x) => x.toLowerCase().includes(q)));
      if (!(ch.toLowerCase() === q || g.name.toLowerCase().includes(q) || h === q.replace(/^(u\+|0+)/, '') || extra)) return false;
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
  renderSmartFilters();
  renderSideMetrics();
}

// Extended mode: quick filters and tags in the sidebar.
const SMART_FILTERS = {
  forms: (g) => !!formOf(g.name),
  components: (g) => !!g.components?.length,
  notes: (g) => !!g.note,
  noExport: (g) => !!g.noExport,
  stale: (g) => outOfSync(app.project, g).length > 0,
};
function renderSmartFilters() {
  const el = $('smartFilters');
  if (!el) return;
  if (!app.extended) { el.innerHTML = ''; return; }
  const glyphs = app.project.glyphs;
  const items = Object.entries(SMART_FILTERS).map(([id, fn]) => ({ id, n: glyphs.filter(fn).length })).filter((x) => x.n || app.smartFilter === x.id);
  const tags = [...new Set(glyphs.flatMap((g) => g.tags || []))].sort();
  el.innerHTML = (items.length ? `<div class="sub-head">${esc(t('sfiTitle'))}</div><nav class="cat-list">${items.map((x) => `<button type="button" data-smart="${x.id}" aria-current="${app.smartFilter === x.id}">
      <span>${esc(t('sfi_' + x.id))}</span><span class="count">${x.n}</span></button>`).join('')}</nav>` : '')
    + (tags.length ? `<div class="sub-head">${esc(t('tagsTitle'))}</div><div class="tag-list">${tags.map((x) => `<button type="button" class="tag" data-tag="${esc(x)}" aria-pressed="${app.tagFilter === x}">${esc(x)}</button>`).join('')}</div>` : '');
}
$('smartFilters').addEventListener('click', (e) => {
  const sm = e.target.closest('[data-smart]'), tg = e.target.closest('[data-tag]');
  if (sm) app.smartFilter = app.smartFilter === sm.dataset.smart ? null : sm.dataset.smart;
  else if (tg) app.tagFilter = app.tagFilter === tg.dataset.tag ? null : tg.dataset.tag;
  else return;
  renderSidebar();
  renderGrid();
  updateStatus();
});

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
  </div>${app.extended ? metricKeysHTML(g) : ''}`;
}

function renderSideMetrics() {
  const el = $('sideMetrics');
  const sel = selectedGlyphs();
  el.innerHTML = sel.length === 1
    ? `<div class="sub-head">${esc(charOf(sel[0]).trim() || sel[0].name)} · ${esc(sel[0].name)}</div>${metricInputs(sel[0])}`
    : '';
}

// Extended mode: keys under the numbers (=n, =o+10, =|o). A key that no
// longer matches its glyph is marked; "Update Metrics" applies it.
function metricKeysHTML(g) {
  const stale = new Set(outOfSync(app.project, g));
  const f = (role) => `<input type="text" data-mkey="${role}" aria-label="${esc(t('mkLabel') + ': ' + t(role === 'advance' ? 'width' : role))}" value="${esc(g[KEY_FIELDS[role]] || '')}" placeholder="=n"
    class="${stale.has(role) ? 'stale' : ''}" data-tip="${esc(t(stale.has(role) ? 'mkStale' : 'mkTip'))}" spellcheck="false" autocomplete="off">`;
  return `<div class="sub-head mkeys-head" data-tip="${esc(t('mkTip'))}">${esc(t('mkLabel'))}</div>
    <div class="metrics-widget mkeys">${f('lsb')}${f('advance')}${f('rsb')}</div>`;
}

function onMetricKeyChange(e) {
  const role = e.target.dataset.mkey;
  const g = app.mode === 'editor' ? app.current : selectedGlyphs()[0];
  if (!role || !g) return;
  const v = e.target.value.trim();
  if (v && !isKey(v)) { toast(t('mkBad'), 'error'); e.target.value = g[KEY_FIELDS[role]] || ''; return; }
  app.history.push(g);
  if (v) g[KEY_FIELDS[role]] = v; else delete g[KEY_FIELDS[role]];
  updateMetrics(app.project, [g]);
  if (app.mode === 'editor') { editor.afterEdit(false); renderGlyphPanel(); } else { markChanged(); updateTile(g); renderSideMetrics(); renderInspector(); }
}

function updateAllMetrics() {
  const changed = updateMetrics(app.project, app.project.glyphs, (g) => app.history.push(g));
  if (changed.length) {
    markChanged();
    if (app.mode === 'editor') { editor.render(); renderGlyphPanel(); } else { changed.forEach(updateTile); renderSideMetrics(); renderInspector(); }
  }
  toast(changed.length ? t('mkUpdated', { n: changed.length }) : t('mkNothing'));
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
  if (e.target.dataset.mkey) { onMetricKeyChange(e); return; }
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
  const drawn = hasOutline(g);
  const body = drawn || g.unicode === 32 ? glyphSVG(g)
    : g.image ? `<img class="ref" src="${esc(g.image.data)}" alt="" aria-hidden="true">`
      : `<span class="ghost" aria-hidden="true">${esc(ch)}</span>`;
  const label = ch && ch.trim() ? `${ch} ${g.name} ${hex(g)}` : `${g.name} ${hex(g)}`;
  return `<button type="button" class="tile${drawn ? ' drawn' : ''}" role="option" data-name="${esc(g.name)}"
      ${g.color ? `data-color="${g.color}"` : ''} aria-selected="${app.selected.has(g.name)}"
      tabindex="${g.name === app.focusName ? 0 : -1}" aria-label="${esc(label)}">
      ${body}<span class="label"><span>${esc(g.name)}</span><span class="code">${hex(g)}</span></span></button>`;
}

function setGridView(v) {
  app.gridView = v;
  store.set('spline.gridView', v);
  renderGridOptions();
  renderGrid();
}

// Extended mode: the glyph list as a table, editable in place.
const TABLE_COLS = ['glyph', 'name', 'unicode', 'advance', 'lsb', 'rsb', 'tags', 'note', 'export'];
function tableHTML(list) {
  const [col, dir] = (app.tableSort || 'order:1').split(':');
  const val = {
    name: (g) => g.name, unicode: (g) => g.unicode || 1e9, advance: (g) => g.advance,
    lsb: (g) => sides(g).lsb ?? -1e9, rsb: (g) => sides(g).rsb ?? -1e9, tags: (g) => (g.tags || []).join(','), note: (g) => g.note || '',
    export: (g) => (g.noExport ? 1 : 0),
  }[col];
  const rows = val ? [...list].sort((a, b) => {
    const x = val(a), y = val(b);
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * Number(dir);
  }) : list;
  const head = TABLE_COLS.map((c) => c === 'glyph' ? '<th></th>' : `<th><button type="button" data-sort="${c}" aria-sort="${col === c ? (dir === '1' ? 'ascending' : 'descending') : 'none'}">${esc(t('tc_' + c))}${col === c ? (dir === '1' ? ' ▲' : ' ▼') : ''}</button></th>`).join('');
  const num = (g, k, v) => `<input type="number" step="1" data-cell="${k}" aria-label="${esc(t('tc_' + k))} ${esc(g.name)}" value="${v === null ? '' : Math.round(v)}" ${v === null ? 'disabled' : ''}>`;
  const body = rows.map((g) => {
    const sd = sides(g);
    return `<tr class="trow" data-name="${esc(g.name)}" aria-selected="${app.selected.has(g.name)}">
      <td class="tg">${hasOutline(g) ? glyphSVG(g, 'tglyph') : `<span class="ghost">${esc(charOf(g))}</span>`}</td>
      <td><input type="text" data-cell="name" aria-label="${esc(t('tc_name'))} ${esc(g.name)}" value="${esc(g.name)}" spellcheck="false"></td>
      <td><input type="text" data-cell="unicode" aria-label="Unicode ${esc(g.name)}" value="${g.unicode ? 'U+' + hex(g) : ''}" placeholder="—" spellcheck="false"></td>
      <td>${num(g, 'advance', g.advance)}</td><td>${num(g, 'lsb', sd.lsb)}</td><td>${num(g, 'rsb', sd.rsb)}</td>
      <td><input type="text" data-cell="tags" aria-label="${esc(t('tc_tags'))} ${esc(g.name)}" value="${esc((g.tags || []).join(', '))}" spellcheck="false"></td>
      <td><input type="text" data-cell="note" aria-label="${esc(t('tc_note'))} ${esc(g.name)}" value="${esc(g.note || '')}"></td>
      <td><input type="checkbox" data-cell="export" ${g.noExport ? '' : 'checked'} aria-label="${esc(t('tc_export'))}"></td>
    </tr>`;
  }).join('');
  return `<table class="glyph-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function onTableChange(e) {
  const cell = e.target.dataset.cell;
  const row = e.target.closest('.trow');
  const g = row && findGlyph(row.dataset.name);
  if (!cell || !g) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
  if (cell === 'name') { if (!renameGlyph(g, v)) e.target.value = g.name; return; }
  if (cell === 'unicode') { if (!setUnicode(g, v)) e.target.value = g.unicode ? 'U+' + hex(g) : ''; return; }
  app.history.push(g);
  if (cell === 'tags') setTags(g, v);
  if (cell === 'note') { if (v) g.note = v; else delete g.note; }
  if (cell === 'export') { if (v) delete g.noExport; else g.noExport = true; }
  if (['advance', 'lsb', 'rsb'].includes(cell) && Number.isFinite(Number(v)) && v !== '') setMetric(g, cell, Number(v));
  markChanged();
  renderSmartFilters();
  if (['advance', 'lsb', 'rsb'].includes(cell)) renderGrid();
}

function renderGrid() {
  if (app.extended && app.gridView === 'table') {
    $('glyphGrid').classList.add('as-table');
    $('glyphGrid').innerHTML = tableHTML(visibleGlyphs());
    return;
  }
  $('glyphGrid').classList.remove('as-table');
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
  $('glyphGrid').querySelectorAll('.tile, .trow').forEach((el) => {
    el.setAttribute('aria-selected', app.selected.has(el.dataset.name));
    el.tabIndex = el.dataset.name === name ? 0 : -1;
  });
  renderInspector();
  renderSideMetrics();
  updateStatus();
  if (app.extended) renderPreviewText();
}

$('glyphGrid').addEventListener('click', (e) => {
  const sort = e.target.closest('[data-sort]');
  if (sort) {
    const [col, dir] = (app.tableSort || 'order:1').split(':');
    app.tableSort = `${sort.dataset.sort}:${col === sort.dataset.sort ? -Number(dir) : 1}`;
    renderGrid();
    return;
  }
  if (e.target.closest('input')) return;
  const tile = e.target.closest('.tile, .trow');
  if (tile) selectGlyph(tile.dataset.name, e);
});
$('glyphGrid').addEventListener('change', onTableChange);
// Editing a cell selects its row, so the side panel shows that glyph.
$('glyphGrid').addEventListener('focusin', (e) => {
  const row = e.target.closest('.trow');
  if (row && e.target.matches('input') && !(app.selected.size === 1 && app.selected.has(row.dataset.name))) selectGlyph(row.dataset.name);
});
$('glyphGrid').addEventListener('dblclick', (e) => {
  if (e.target.closest('input')) return;
  const tile = e.target.closest('.tile, .trow');
  if (tile) openEditor(tile.dataset.name);
});
$('glyphGrid').addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return; // editing a table cell
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
    ${app.extended ? `<div class="sep"></div><div class="group"><div class="seg" role="radiogroup" aria-label="${esc(t('gvTitle'))}">
      <button type="button" role="radio" data-cmd="gvTiles" aria-checked="${app.gridView !== 'table'}">${icon('grid', 14)} ${esc(t('gvTiles'))}</button>
      <button type="button" role="radio" data-cmd="gvTable" aria-checked="${app.gridView === 'table'}">${icon('rows', 14)} ${esc(t('gvTable'))}</button></div></div>` : ''}
    ${masterBarHTML()}
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
  if (opt === 'pixelSize') {
    const v = Math.round(Number(e.target.value));
    if (v >= 4 && v <= 500) { editor.pixelSize = v; store.set('spline.pixelSize', String(v)); editor.render(); }
    e.target.value = editor.pixelSize;
  }
  if (opt === 'gridStep') {
    const v = Math.round(Number(e.target.value));
    if (v >= 1) { editor.gridStep = v; store.set('spline.gridStep', String(v)); editor.render(); }
    e.target.value = editor.gridStep;
  }
});
$('optionsBar').addEventListener('click', (e) => {
  const m = e.target.closest('[data-master]');
  if (m) { selectMaster(m.dataset.master); return; }
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

function section(id, title, body, open = true, tip = '') {
  const saved = store.get(`spline.sec.${id}`);
  const isOpen = saved === null ? open : saved === '1';
  return `<details data-sec="${id}" ${isOpen ? 'open' : ''}><summary${tip ? ` data-tip="${esc(tip)}"` : ''}>${esc(title)}</summary><div class="section">${body}</div></details>`;
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
    el.innerHTML = section('glyph', t('glyph'), `<p class="hint">${esc(t('noSelection'))}</p>`) + fontSection();
    return;
  }
  const g = sel[0];
  const head = sel.length === 1
    ? `<div class="big-glyph">${hasOutline(g) ? glyphSVG(g) : `<span class="ghost">${esc(charOf(g))}</span>`}</div>
       <div class="title-row"><b>${esc(charOf(g).trim() || g.name)}</b><small>${esc(g.name)}${g.unicode ? ` · U+${hex(g)}` : ''}</small></div>`
    : `<div class="title-row"><b>${sel.length}</b><small>${esc(t('glyphs'))}: ${esc(sel.slice(0, 24).map((x) => charOf(x) || x.name).join(' '))}</small></div>`;
  // One section for everything about the glyph (in the extended mode also
  // its name, code, tags, note and export).
  el.innerHTML = section('glyph', t('glyph'), `${head}
      ${sel.length === 1 ? composeNoteHTML(g) : ''}
      ${app.extended && sel.length === 1 ? infoFieldsHTML(g) : ''}
      <div class="prop"><span>${esc(t('color'))}</span>${colorPicker(sel.every((x) => x.color === g.color) ? g.color : undefined)}</div>
      ${groupFields(sel)}`)
    + (app.extended ? batchSection(sel) : '')
    + transformSection()
    + section('actions', t('actions'), `
      ${sel.length === 1 ? `<button class="btn btn-primary btn-block" type="button" data-cmd="draw">${icon('pen', 15)}<span>${esc(t('drawGlyph'))}</span></button>` : ''}
      <button class="btn btn-block" type="button" data-cmd="importSvg">${icon('open', 15)}<span>${esc(t('importSvg'))}</span></button>
      <button class="btn btn-block" type="button" data-cmd="spacing">${icon('spacing', 15)}<span>${esc(t('autoSpacing'))}</span></button>
      <button class="btn btn-block" type="button" data-cmd="simplify">${icon('simplify', 15)}<span>${esc(t('simplify'))}</span></button>
      ${app.extended ? `<button class="btn btn-block" type="button" data-cmd="duplicate">${icon('plus', 15)}<span>${esc(t(sel.length > 1 ? 'dupGlyphs' : 'dupGlyph'))}</span></button>` : ''}
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
      ${composeNoteHTML(g)}
      ${metricInputs(g)}
      <div class="prop"><span>${esc(t('color'))}</span>${colorPicker(g.color)}</div>
      ${groupFields([g])}`)
    + section('selection', t('selection'), '<div id="selBox"></div>')
    // Path operations and alignment: one section, a small gap between them.
    + section('pathops', t('pathOps'), `<div class="op-row">${PATH_OPS.map((op) => `<button class="btn btn-icon" type="button"
        data-pathop="${op.id}" data-tip="${esc(t(op.label))}" data-key="${esc(keyLabel(`op.${op.id}`))}" aria-label="${esc(t(op.label))}">${icon(op.icon, 18)}</button>`).join('')}</div>
      ${alignHTML()}`)
    // Extended mode: everyday point tools first, then parts, then the rest.
    + (app.extended ? pointsSection() + componentsSection(g) + smartSection(g) + anchorsSection(g) + paintSection(g) + backgroundSection(g) : '')
    + transformSection()
    + variantsSection(g)
    + underlaySection(g)
    + section('actions', t('actions'), `
      <button class="btn btn-block" type="button" data-cmd="spacing">${icon('spacing', 15)}<span>${esc(t('autoSpacing'))}</span></button>
      <button class="btn btn-block" type="button" data-cmd="simplify" data-tip="${esc(t('simplifyTip'))}">${icon('simplify', 15)}<span>${esc(t('simplify'))}</span></button>
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

function alignHTML() {
  const btn = (op) => `<button class="btn btn-icon" type="button" data-align="${op.id}"
    data-tip="${esc(t(op.label))}" aria-label="${esc(t(op.label))}">${icon(op.icon, 18)}</button>`;
  return `
    <div class="op-row op-gap">${ALIGN_OPS.slice(0, 6).map(btn).join('')}</div>
    <div class="op-row">${ALIGN_OPS.slice(6).map(btn).join('')}</div>
    <label class="prop"><span>${esc(t('alignTo'))}</span><select data-align-to>
      <option value="selection" ${editor.alignTo === 'selection' ? 'selected' : ''}>${esc(t(editor.keyContour ? 'alignToKey' : 'alignToSelection'))}</option>
      <option value="frame" ${editor.alignTo === 'frame' ? 'selected' : ''}>${esc(t('alignToFrame'))}</option>
    </select></label>`;
}

function runAlign(id) {
  endTransform();
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
  endTransform();
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

let partsKey = '';
app.onDraw = () => {
  if (app.mode !== 'editor') return;
  if (app.extended) {
    const k = [...editor.sel].join(',');
    if (k !== partsKey) {
      partsKey = k;
      const sec = panelQuery('details[data-sec="points"] .section');
      if (sec) {
        const old = sec.querySelector('.parts');
        const html = `<div class="parts">${partsHTML()}</div>`;
        if (old) old.outerHTML = html; else sec.querySelector('.hint:last-child')?.insertAdjacentHTML('beforebegin', html);
      }
    }
  }
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
    // Who else shares the group: makes clear what kerning it will get.
    let note = '';
    if (v) {
      const others = groupMembers(app.project, v, prop === 'kernLeft' ? 'left' : 'right').filter((g) => !glyphs.includes(g));
      if (others.length) note = t('kgMembers', { m: membersText(others, 10) });
    }
    return `<label><span>${esc(label)}</span><input type="text" data-kgroup="${prop}" list="${prop}List" spellcheck="false"
      value="${esc(v ?? '')}" placeholder="${v === null ? '—' : esc(t('kernNoGroup'))}">${note ? `<small class="kg-note">${esc(note)}</small>` : ''}</label>`;
  };
  return `<div class="sub-head">${esc(t('kernGroups'))}</div>
    <div class="prop-pair">${field('kernLeft', t('kgLeft'))}${field('kernRight', t('kgRight'))}</div>
    <div class="btn-row">
      <button class="btn" type="button" data-cmd="autoGroups" data-tip="${esc(t('kgAutoTip'))}">${icon('kerning', 15)}<span>${esc(t('kgAuto'))}</span></button>
      <button class="btn" type="button" data-cmd="groups" data-tip="${esc(t('kgTitle'))}">${icon('grid', 15)}<span>${esc(t('kgOpen'))}</span></button>
    </div>
    ${groupDatalists()}`;
}

// Base letter of a character: "Ё" -> "Е", "é" -> "e".
function baseLetter(ch) {
  const special = { 'Ё': 'Е', 'ё': 'е', 'Й': 'И', 'й': 'и' };
  return special[ch] || ch.normalize('NFD').replace(/\p{M}+/gu, '') || ch;
}

function autoGroups() {
  const targets = app.mode === 'editor' ? [app.current] : selectedGlyphs();
  app.history.pushGroups(app.project);
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
const DOCK_OF = { grid: 'inspector', editor: 'glyphPanel', kern: 'kernPanel' };
const VIEW_OF = { grid: 'gridView', editor: 'editorView', kern: 'kernView' };
const panelQuery = (sel) => (VIEW_OF[app.mode] && $(VIEW_OF[app.mode]).querySelector(sel)) || $('floatLayer').querySelector(sel);
const PANELS = [['glyph', 'glyph'], ['selection', 'selection'], ['pathops', 'pathOps'], ['transform', 'transform'], ['batch', 'btTitleShort'], ['paint', 'pnTitle'], ['components', 'cmTitle'], ['smart', 'smTitle'], ['anchors', 'anTitle'], ['points', 'ptTitle'], ['background', 'bgTitle'], ['variants', 'varTitle'], ['underlay', 'ulTitle'], ['actions', 'actions'], ['font', 'fontSection'],
  ['kernPair', 'kernPair'], ['kernSpacing', 'kernSpacing'], ['kernSuggest', 'ksTitle'], ['kernList', 'kernAll']];

initPanels({
  layer: $('floatLayer'),
  views: [$('gridView'), $('editorView'), $('kernView')],
  active: () => (DOCK_OF[app.mode] ? { view: $(VIEW_OF[app.mode]), dock: $(DOCK_OF[app.mode]) } : null),
  labels: {
    get dock() { return esc(t('panelDock')); }, get close() { return esc(t('panelClose')); }, get collapse() { return esc(t('panelCollapse')); },
  },
  icons: { dock: icon('panelDock', 14), close: icon('close', 14), collapse: icon('chevronRight', 14) },
  panelIcons: {
    glyph: icon('pen', 18), selection: icon('select', 18), pathops: icon('opUnite', 18), align: icon('alignHCenter', 18),
    transform: icon('transform', 18), variants: icon('variants', 18), underlay: icon('image', 18), points: icon('points', 18), background: icon('layers', 18), components: icon('components', 18), smart: icon('sliders', 18), anchors: icon('anchor', 18), info: icon('type', 18), batch: icon('check', 18), filters: icon('filter', 18), paint: icon('palette', 18), actions: icon('spacing', 18), font: icon('type', 18),
    kernPair: icon('kerning', 18), kernSpacing: icon('spacing', 18), kernSuggest: icon('check', 18), kernList: icon('search', 18),
  },
  onChange: () => renderMenus(),
  // Used now and then: opened from the menus as windows, not kept in the dock.
  defaults: Object.fromEntries(['paint', 'smart', 'anchors', 'background'].map((id) => [id, { place: 'float', hidden: true }])),
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
    if (onVariantsChange(e)) return;
    if (e.target.dataset.info && onInfoChange(e)) return;
    if (e.target.dataset.batchTag !== undefined) {
      const tag = e.target.value.trim();
      if (!tag) return;
      app.history.pushGroups(app.project);
      for (const g of selectedGlyphs()) setTags(g, [...(g.tags || []), tag].join(','));
      markChanged(); renderSidebar(); renderInspector();
      toast(t('btTagged', { tag }));
      return;
    }
    if (e.target.dataset.part) { setPart(e.target.dataset.part, e.target.value); return; }
    if (e.target.dataset.paintEdit !== undefined) {
      app.project.palette[Number(e.target.dataset.paintEdit)] = e.target.value.toUpperCase();
      markChanged();
      editor.render();
      renderGlyphPanel();
      return;
    }
    if (e.target.dataset.cmprop) { setCompProp(e.target.dataset.cmprop, Number(e.target.value), true); return; }
    if (e.target.dataset.smRange) { setPropRange(e.target.dataset.smRange, e.target.value); return; }
    if (e.target.dataset.cmpos) { moveComponent(e.target.dataset.cmpos, Number(e.target.value)); return; }
    if (e.target.dataset.anpos) { setAnchorValue(e.target.dataset.anpos, e.target.value); return; }
    if (e.target.dataset.ul) { setUnderlayValue(e.target.dataset.ul, Number(e.target.value), true); return; }
    if (e.target.id === 'bgShow') { editor.showBackground = e.target.checked; store.set('spline.showBackground', e.target.checked ? '1' : '0'); editor.render(); return; }
    if (e.target.dataset.kgroup) {
      const prop = e.target.dataset.kgroup;
      const v = cleanGroupName(e.target.value);
      app.history.pushGroups(app.project);
      for (const g of app.mode === 'editor' ? [app.current] : selectedGlyphs()) {
        if (v) g[prop] = v; else delete g[prop];
      }
      markChanged();
      if (app.mode === 'editor') renderGlyphPanel(); else renderInspector();
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
  dock.addEventListener('input', (e) => {
    if (e.target.dataset.cmprop) setCompProp(e.target.dataset.cmprop, Number(e.target.value), false);
    if (e.target.dataset.tf) liveTransform(false);
    if (e.target.dataset.ul === 'opacity') setUnderlayValue('opacity', Number(e.target.value), false);
  });
  dock.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.tf) { e.preventDefault(); liveTransform(true); }
  });
  dock.addEventListener('click', (e) => {
    if (onVariantsClick(e)) return;
    if (snapshotClick(e)) return;
    if (componentClick(e)) return;
    if (anchorClick(e)) return;
    if (paintClick(e)) return;
    if (smartClick(e)) return;
    const sw = e.target.closest('[data-role="colorPick"] [data-color]');
    if (sw) { setColor(sw.dataset.color); return; }
    const al = e.target.closest('[data-align]');
    if (al) { runAlign(al.dataset.align); return; }
    const po = e.target.closest('[data-pathop]');
    if (po) { runPathOp(po.dataset.pathop); return; }
    const mk = e.target.closest('[data-make-glyph]');
    if (mk) { makeGlyph(mk.dataset.makeGlyph); return; }
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
  endTransform();
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
  endTransform();
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
  endTransform();
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
  dropRulesOf(app.selected);
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

// Extended mode: glyphs by code and range. Presets cover whole alphabets.
const AG_PRESETS = [
  ['latin1', 'U+00C0-00FF'], ['latinExtA', 'U+0100-017F'], ['cyrillic', 'U+0400-045F'],
  ['cyrillicExt', 'U+0460-04FF'], ['greek', 'U+0391-03C9'], ['punctExt', 'U+2010-2027, U+2030-203A, U+20AC, U+2116, U+2122'],
];

// "U+0410-044F, uni0401, А-Я, A-Z" -> characters; null when unreadable.
function parseCodes(text) {
  const hex = (h) => parseInt(h.replace(/^(U\+|uni|u)/i, ''), 16);
  const out = [];
  for (const tok of text.split(/[,;\s]+/).filter(Boolean)) {
    let m;
    if ((m = /^(?:U\+|uni|u)([0-9a-f]{4,6})(?:[-–:](?:U\+|uni|u)?([0-9a-f]{4,6}))?$/i.exec(tok))) {
      const a = hex(m[1]), b = m[2] ? hex(m[2]) : a;
      if (!(a <= b) || b - a > 3000) return null;
      for (let c = a; c <= b; c++) if (!(c >= 0xd800 && c <= 0xdfff)) out.push(String.fromCodePoint(c));
    } else if ((m = /^(.)[-–](.)$/u.exec(tok))) {
      const a = m[1].codePointAt(0), b = m[2].codePointAt(0);
      if (!(a <= b) || b - a > 3000) return null;
      for (let c = a; c <= b; c++) out.push(String.fromCodePoint(c));
    } else if ([...tok].length === 1) {
      out.push(tok);
    } else return null;
  }
  // Only real characters: letters, marks, digits, punctuation, symbols.
  return out.filter((c) => /[\p{L}\p{M}\p{N}\p{P}\p{S}]/u.test(c)).slice(0, 3000);
}

async function addGlyphs() {
  const data = await showDialog({
    title: t('addGlyph').replace('…', ''),
    body: `<label class="field">${esc(t('addGlyphHint'))}<input type="text" name="chars" ${app.extended ? '' : 'required'} maxlength="500" autocomplete="off"></label>
      ${app.extended ? `<label class="field">${esc(t('agCodes'))}<input type="text" name="codes" id="agCodes" maxlength="500" autocomplete="off" placeholder="U+0400-045F, uni0490, А-Я"></label>
      <div class="ag-presets">${AG_PRESETS.map(([id, codes]) => `<button class="btn" type="button" data-ag="${codes}">${esc(t('ag_' + id))}</button>`).join('')}</div>` : ''}`,
    okLabel: t('add'),
    onOpen: (dlg) => dlg.querySelectorAll('[data-ag]').forEach((b) => b.addEventListener('click', () => {
      const f = dlg.querySelector('#agCodes');
      f.value = [f.value.trim(), b.dataset.ag].filter(Boolean).join(', ');
    })),
  });
  if (!data) return;
  const typed = Array.from(String(data.get('chars') || ''));
  const coded = app.extended ? parseCodes(String(data.get('codes') || '')) : [];
  if (coded === null) { toast(t('agBad'), 'error'); return; }
  const chars = [...new Set([...typed, ...coded])].filter((c) => c !== '\n' && c.trim());
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
      <div class="field-row">${num('xHeight', i.xHeight)}${num('descender', i.descender)}</div>
      ${app.extended ? fontInfoExtended(i) : ''}`,
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
  if (app.extended) readFontInfoExtended(i, data);
  markChanged();
  renderAll();
  if (app.mode === 'editor') { renderGlyphPanel(); editor.render(); }
}

// Extended mode: rights, style and line metrics of the font.
const FI_TEXT = ['copyright', 'trademark', 'manufacturer', 'vendorURL', 'license', 'licenseURL', 'description'];
const FI_NUM = ['italicAngle', 'lineGap', 'underlinePosition', 'underlineThickness'];
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function fontInfoExtended(i) {
  const text = (k, long) => `<label class="field">${esc(t('fi_' + k))}${long
    ? `<textarea name="${k}" rows="2" maxlength="5000">${esc(i[k] || '')}</textarea>`
    : `<input type="text" name="${k}" value="${esc(i[k] || '')}" maxlength="500">`}</label>`;
  const num = (k) => `<label class="field" data-tip="${esc(t('fi_' + k + 'Tip'))}">${esc(t('fi_' + k))}<input type="number" name="${k}" value="${i[k] ?? ''}" step="${k === 'italicAngle' ? '0.5' : '1'}" placeholder="${k === 'italicAngle' ? '0' : t('fiAuto')}"></label>`;
  return `<h3>${esc(t('fiStyle'))}</h3>
    <div class="field-row">
      <label class="field">${esc(t('fi_weight'))}<select name="weight">${WEIGHTS.map((w) => `<option value="${w}" ${(i.weight || 400) === w ? 'selected' : ''}>${w} · ${esc(t('weightNames')[w])}</option>`).join('')}</select></label>
      ${num('italicAngle')}
    </div>
    <div class="field-row">${num('lineGap')}${num('underlinePosition')}</div>
    <div class="field-row">${num('underlineThickness')}<span></span></div>
    <h3>${esc(t('fiRights'))}</h3>
    ${text('copyright')}
    <div class="field-row">${text('manufacturer')}${text('trademark')}</div>
    <div class="field-row">${text('license')}${text('licenseURL')}</div>
    ${text('vendorURL')}
    ${text('description', true)}`;
}

function readFontInfoExtended(i, data) {
  for (const k of FI_TEXT) {
    const v = String(data.get(k) || '').trim();
    if (v) i[k] = v; else delete i[k];
  }
  const w = Number(data.get('weight'));
  if (w && w !== 400) i.weight = w; else delete i.weight;
  for (const k of FI_NUM) {
    const raw = String(data.get(k) ?? '').trim();
    const v = Number(raw);
    if (raw !== '' && Number.isFinite(v) && v !== 0) i[k] = k === 'italicAngle' ? Math.max(-45, Math.min(45, v)) : Math.round(v);
    else delete i[k];
  }
}

async function newFontDialog() {
  if (app.dirty && !(await confirmDialog(t('confirmNew'), t('ok'), false))) return;
  const sets = [['latin', 'setLatin'], ['cyrillic', 'setCyrillic'], ['digits', 'setDigits'], ['punct', 'setPunct'], ['accents', 'setAccents']];
  const data = await showDialog({
    title: t('newTitle'),
    body: `<label class="field">${esc(t('family'))}<input type="text" name="family" value="${esc(getLang() === 'ru' ? 'Мой шрифт' : 'My Font')}" required maxlength="60"></label>
      <h3>${esc(t('newSets'))}</h3><div class="checks">
      ${sets.map(([id, label]) => `<label class="check"><input type="checkbox" name="sets" value="${id}" ${id === 'accents' ? '' : 'checked'}>${esc(t(label))}</label>`).join('')}
      </div>`,
    okLabel: t('create'),
  });
  if (!data) return;
  setProject(newProject({ family: String(data.get('family')).trim() || 'My Font', sets: data.getAll('sets') }));
  autosave();
}

// Keyboard shortcuts: click a shortcut and press a new one.
const KEY_GROUPS = [
  ['menuFile', ['new', 'open', 'save', 'saveAs', 'importSvg', 'exportTTF', 'exportOTF', 'exportWOFF2', 'exportWOFF']],
  ['menuEdit', ['undo', 'redo', 'selectAll', 'freeTransform']],
  ['keysTools', TOOLS.map((tl) => `tool.${tl.id}`)],
  ['viewKerning', ['viewKerning', 'kernShowGroups', 'kernNextSample', 'kernPrevSample']],
  ['menuView', ['zoomIn', 'zoomOut', 'zoomFit', 'rulers', 'userGuides', 'showGuide', 'showGrid', 'snapGrid', 'snapGuides', 'prev', 'next']],
  ['menuGlyph', [...PATH_OPS.map((op) => `op.${op.id}`), 'autoSpacing', 'simplify', 'flipH', 'flipV', 'newVariant', 'newLigature', 'groups', 'shapeGroups', 'fontInfo']],
  ['extTools', ['tool.measure', 'tool.pixel', 'selShapeCycle', 'invertSelection', 'addExtremes', 'makeFirst', 'alignPoints', 'breakContour', 'joinContours', 'bgCopy', 'updateMetrics']],
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
editor.extended = app.extended;
editor.pixelSize = Number(store.get('spline.pixelSize', '50')) || 50;
editor.pixelErase = false;
editor.selectShape = store.get('spline.selectShape', 'rect');
editor.showBackground = store.get('spline.showBackground', '1') === '1';
document.documentElement.dataset.mode = app.extended ? 'extended' : 'simple';
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
  if (!app.extended && editor.tool === 'measure') editor.setTool('select');
  $('toolButtons').innerHTML = visibleTools().map((tl) => {
    const fly = app.extended && tl.id === 'select';
    const name = fly ? `${toolName(tl.id)}: ${t(editor.selectShape === 'lasso' ? 'selLasso' : 'selRect')}` : toolName(tl.id);
    return `<button type="button" class="tool${fly ? ' has-flyout' : ''}" role="radio" data-tool="${tl.id}"
      aria-checked="${editor.tool === tl.id}" aria-label="${esc(name)}" data-tip="${esc(name)}" data-key="${esc(keyLabel(`tool.${tl.id}`))}"${fly ? ' aria-haspopup="menu"' : ''}>
      ${icon(fly && editor.selectShape === 'lasso' ? 'lasso' : tl.icon, 18)}</button>`;
  }).join('');
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

// Extended mode: snapping is one magnet button (lit while on) with a small
// menu; F9 and F10 switch it without opening anything.
let snapMenuOpen = false;
function snapButtonHTML() {
  const on = editor.snapGrid || editor.snapGuides;
  const row = (opt, label, key) => `<label class="check"><input type="checkbox" data-opt="${opt}" ${editor[opt] ? 'checked' : ''}>${esc(t(label))}<kbd>${esc(keyLabel(key))}</kbd></label>`;
  return `<div class="group snap-pop">
    <button class="btn btn-icon" type="button" data-cmd="snapMenu" aria-pressed="${on}" aria-expanded="${snapMenuOpen}" aria-label="${esc(t('snap'))}"
      data-tip="${esc(t('snap'))}: ${esc(t('snapGrid'))} ${esc(keyLabel('snapGrid'))}, ${esc(t('snapGuides'))} ${esc(keyLabel('snapGuides'))}">${icon('magnet', 15)}</button>
    <div class="snap-menu" ${snapMenuOpen ? '' : 'hidden'}>${row('snapGrid', 'snapGrid', 'snapGrid')}${row('snapGuides', 'snapGuides', 'snapGuides')}</div>
  </div>`;
}
document.addEventListener('pointerdown', (e) => {
  if (snapMenuOpen && !e.target.closest('.snap-pop')) { snapMenuOpen = false; if (app.mode === 'editor') renderEditorOptions(); }
});

function renderEditorOptions() {
  drawEditorOptions();
  // The snap menu hangs below its button (the bar itself scrolls).
  const menu = $('optionsBar').querySelector('.snap-menu:not([hidden])');
  if (menu) {
    const r = menu.previousElementSibling.getBoundingClientRect();
    Object.assign(menu.style, { position: 'fixed', left: `${r.left}px`, top: `${r.bottom + 6}px` });
  }
}

function drawEditorOptions() {
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
    ${editor.tool === 'pixel' ? `<div class="group">
      <label data-tip="${esc(t('pxSizeTip'))}">${esc(t('pxSize'))}<input type="number" data-opt="pixelSize" min="4" max="500" step="1" value="${editor.pixelSize}"></label>
      <div class="seg" role="radiogroup">
        <button type="button" role="radio" data-cmd="pxDraw" aria-checked="${!editor.pixelErase}">${esc(t('pxDraw'))}</button>
        <button type="button" role="radio" data-cmd="pxErase" aria-checked="${editor.pixelErase}" data-tip="${esc(t('pxEraseTip'))}">${esc(t('pxErase'))}</button>
      </div></div><div class="sep"></div>` : ''}
    ${masterBarHTML()}
    <div class="group">
      <label class="check"><input type="checkbox" data-opt="guide" ${editor.showGuide ? 'checked' : ''}>${esc(t('guide'))}</label>
      <label class="check"><input type="checkbox" data-opt="grid" ${editor.showGrid ? 'checked' : ''}>${esc(t('grid'))}</label>
      <label>${esc(t('gridStep'))}<input type="number" data-opt="gridStep" min="1" max="500" step="1" value="${editor.gridStep}"></label>
    </div>
    <div class="sep"></div>
    ${app.extended ? snapButtonHTML() : `<div class="group">
      <span class="opt-label">${esc(t('snap'))}</span>
      <label class="check" data-tip="${esc(t('snapGridTip'))}" data-key="${esc(keyLabel('snapGrid'))}"><input type="checkbox" data-opt="snapGrid" ${editor.snapGrid ? 'checked' : ''}>${esc(t('snapGrid'))}</label>
      <label class="check" data-tip="${esc(t('snapGuidesTip'))}" data-key="${esc(keyLabel('snapGuides'))}"><input type="checkbox" data-opt="snapGuides" ${editor.snapGuides ? 'checked' : ''}>${esc(t('snapGuides'))}</label>
    </div>`}
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

app.selectTool = (id) => setTool(id);
function setTool(id) {
  editor.setTool(id);
  store.set('spline.tool', id);
  renderToolbar();
  renderEditorOptions();
  updateStatus();
}

$('toolButtons').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b && !flyoutJustOpened) setTool(b.dataset.tool);
  flyoutJustOpened = false;
});

// Tool flyout, as in Photoshop: right-click or hold the Select tool to pick
// rectangle or lasso selection.
let flyoutTimer = 0, flyoutJustOpened = false;
const flyout = document.createElement('div');
flyout.className = 'tool-flyout';
flyout.setAttribute('role', 'menu');
flyout.hidden = true;
document.body.append(flyout);

function openToolFlyout(btn) {
  const item = (shape, ic, label) => `<button type="button" role="menuitemradio" data-shape="${shape}" aria-checked="${editor.selectShape === shape}">
    ${icon(ic, 16)}<span>${esc(t(label))}</span><kbd>${esc(keyLabel('selShapeCycle'))}</kbd></button>`;
  flyout.innerHTML = item('rect', 'select', 'selRect') + item('lasso', 'lasso', 'selLasso');
  const r = btn.getBoundingClientRect();
  flyout.style.left = `${r.right + 4}px`;
  flyout.style.top = `${r.top}px`;
  flyout.hidden = false;
  flyout.querySelector('[aria-checked="true"]')?.focus();
}
const closeToolFlyout = () => { flyout.hidden = true; };

$('toolButtons').addEventListener('contextmenu', (e) => {
  const b = e.target.closest('.has-flyout');
  if (!b) return;
  e.preventDefault();
  openToolFlyout(b);
});
$('toolButtons').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.has-flyout');
  if (!b || e.button !== 0) return;
  clearTimeout(flyoutTimer);
  flyoutTimer = setTimeout(() => { flyoutJustOpened = true; openToolFlyout(b); }, 350);
});
for (const ev of ['pointerup', 'pointerleave']) $('toolButtons').addEventListener(ev, () => clearTimeout(flyoutTimer));
flyout.addEventListener('click', (e) => {
  const b = e.target.closest('[data-shape]');
  if (!b) return;
  closeToolFlyout();
  setSelectShape(b.dataset.shape);
  setTool('select');
});
flyout.addEventListener('keydown', (e) => {
  const items = [...flyout.querySelectorAll('[data-shape]')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
  if (e.key === 'Escape') { e.stopPropagation(); closeToolFlyout(); }
});
document.addEventListener('pointerdown', (e) => {
  if (!flyout.hidden && !flyout.contains(e.target) && !e.target.closest?.('.has-flyout')) closeToolFlyout();
}, true);
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
  editor.preview = null;
  filterState.active = false;
  if (app.extended) queueMicrotask(previewFilter);
  renderMenus();
  updateStatus();
  renderPreviewText();
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
  renderPreviewText();
}

window.addEventListener('popstate', (e) => {
  if (e.state?.glyph && findGlyph(e.state.glyph)) openEditor(e.state.glyph, false);
  else if (e.state?.kern) showKern(false);
  else showGrid(false);
});

// ================================================================ kerning view

const kernView = new KernView(app, $('kernCanvas'));
kernView.showGroupMembers = store.get('spline.kernShowGroups') === '1';
kernView.showMetrics = store.get('spline.kernShowMetrics') === '1';

function toggleKernGroups(on = !kernView.showGroupMembers) {
  kernView.showGroupMembers = on;
  store.set('spline.kernShowGroups', on ? '1' : '0');
  const box = $('kernShowGroups');
  if (box) box.checked = on;
  kernView.render();
}
kernView.text = store.get('spline.kernText') || kernView.text;
kernView.size = Number(store.get('spline.kernSize', '140')) || 140;

const KERN_SAMPLES = {
  latin: 'AVATAR LTYA ToTaTeVaVoWaYo FAWN PALLY',
  lower: 'raven yoke wave aware favor kelvin',
  cyrillic: 'ГАДЮКА ТАТЬЯНА ГОЛЬФ ТУЧА УЛЬЯ ЛАГУНА',
  cyrLower: 'гадюка татьяна гольф туча улья лагуна',
  mixed: 'Ta Te To Tu Va Ve Vo Wa Yo Ту Та Го Уо Ля',
  punct: 'T. T, V. Y, L’ «Т» Г. У, P. F, r. y. 7. 1)',
  digits: '11 17 1970 2048 1/4 7,7',
};

// A line for one letter: framed by control letters that need no kerning
// ("HHXHH OOXOO"), then next to every letter of its kind ("XAXBXC…X").
function letterSample(g) {
  const ch = charOf(g);
  if (!ch.trim()) return '';
  const kinds = [
    [/^[A-Z]$/, 'HO', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'], [/^[a-z]$/, 'no', 'abcdefghijklmnopqrstuvwxyz'],
    [/^[А-ЯЁ]$/, 'НО', 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'], [/^[а-яё]$/, 'но', 'абвгдежзийклмнопрстуфхцчшщъыьэюя'],
    [/^[0-9]$/, '01', '0123456789'],
  ];
  const [, ctl, set] = kinds.find(([re]) => re.test(ch)) || [null, 'HO', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
  const have = Array.from(set).filter((c) => app.project.glyphs.some((x) => x.unicode === c.codePointAt(0)));
  const [a, b] = Array.from(ctl);
  return `${a}${a}${ch}${a}${a} ${b}${b}${ch}${b}${b} ${have.map((c) => ch + c).join('')}${ch}`;
}

// The preview button of the extended mode: the glyph being edited between
// control letters, written with "*" so it follows the open glyph.
function previewAroundCurrent() {
  const g = app.current;
  const sample = g ? letterSample(g) : '';
  const ctl = sample ? sample.slice(0, 2)[0] + sample.slice(6, 7) : 'HO';
  const [a, b] = Array.from(ctl);
  $('previewInput').value = `${a}${a}*${a}${a} ${b}${b}*${b}${b} ${a}*${b}*${a}`;
  store.set('spline.previewText', $('previewInput').value);
  renderPreviewText();
}
$('previewCurrent').addEventListener('click', previewAroundCurrent);
$('previewFeats').addEventListener('input', (e) => {
  if (e.target.dataset.pfAxis === undefined) return;
  if (e.target.dataset.pfAxis === '2') app.previewLoc2 = Number(e.target.value);
  else app.previewLoc = Number(e.target.value);
  app.previewLoc ??= app.project.masters?.find((m) => m.id === activeId(app.project))?.loc;
  e.target.nextElementSibling.textContent = e.target.value;
  schedulePreview(120);
});
$('previewFeats').addEventListener('change', (e) => {
  if (e.target.dataset.pf) { if (e.target.checked) previewFeats.add(e.target.dataset.pf); else previewFeats.delete(e.target.dataset.pf); }
  if (e.target.dataset.pfLang !== undefined) previewLang = e.target.value;
  applyPreviewFeatures();
});

// Puts a sample in the line: one of KERN_SAMPLES or "letter" (for the
// letter after the cursor).
function setKernSample(id) {
  let text = KERN_SAMPLES[id];
  if (id === 'letter') {
    const pr = kernView.pair();
    const g = pr?.right || kernView.items.find((it) => it.g)?.g;
    text = g && letterSample(g);
  }
  if (!text) return;
  kernView.text = text;
  kernView.cursor = 2;
  kernView.sample = id;
  app.onKernText();
  renderKernOptions();
  kernView.render();
}

// Next / previous sample (keyboard).
function stepKernSample(dir) {
  const ids = [...Object.keys(KERN_SAMPLES), 'letter'];
  const i = ids.indexOf(kernView.sample);
  setKernSample(ids[(i + dir + ids.length) % ids.length] ?? ids[0]);
}

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
    ${hasMasters(app.project) ? masterBarHTML() : ''}
    <div class="group"><label>${esc(t('kernText'))}<input class="kern-text" id="kernText" value="${esc(kernView.text)}" spellcheck="false"></label></div>
    <div class="group"><label>${esc(t('kernSamples'))}<select id="kernSample">
      <option value="">—</option>
      ${[...Object.keys(KERN_SAMPLES), 'letter'].map((k) => `<option value="${k}" ${kernView.sample === k ? 'selected' : ''}>${esc(t('sample_' + k))}</option>`).join('')}
    </select></label></div>
    <label class="check" data-tip="${esc(t('kernShowGroupsTip'))}" data-key="${esc(keyLabel('kernShowGroups'))}"><input type="checkbox" id="kernShowGroups" ${kernView.showGroupMembers ? 'checked' : ''}>${esc(t('kernShowGroups'))}</label>
    ${app.extended ? `<label class="check" data-tip="${esc(t('kernShowMetricsTip'))}"><input type="checkbox" id="kernShowMetrics" ${kernView.showMetrics ? 'checked' : ''}>${esc(t('kernShowMetrics'))}</label>` : ''}
    <div class="glyph-nav"><label>${esc(t('previewSize'))}<input type="range" id="kernSize" min="40" max="400" value="${kernView.size}"></label></div>`;
}

// Readable label of a kerning key: the letter, or "@group".
function kernKeyLabel(key) {
  if (isGroup(key)) return key;
  const g = findGlyph(key);
  return g ? (charOf(g).trim() || g.name) : key;
}

const glyphLabel = (g) => charOf(g).trim() || g.name;

// Glyphs a kerning key stands for: the glyph itself, or the members of the
// group (the left key of a pair uses right-side groups and vice versa).
function keyGlyphs(key, side) {
  if (!isGroup(key)) { const g = findGlyph(key); return g ? [g] : []; }
  return groupMembers(app.project, key.slice(1), side);
}

// "А À Á Â +5"
function membersText(glyphs, max = 12) {
  const shown = glyphs.slice(0, max).map(glyphLabel).join(' ');
  return glyphs.length > max ? `${shown} +${glyphs.length - max}` : shown;
}

const isException = (k) => !(isGroup(k.left) && isGroup(k.right));

function pairIsOverkern(k) {
  const L = keyGlyphs(k.left, 'right'), R = keyGlyphs(k.right, 'left');
  if (!L.length || !R.length) return false;
  const minAdv = (gs) => gs.reduce((m, g) => Math.min(m, g.advance), Infinity);
  return isOverkern(k.value, { advance: minAdv(L) }, { advance: minAdv(R) });
}

function kernPairHTML(pr) {
  const p = app.project;
  if (!pr) return `<p class="hint">${esc(t('kernNoPair'))}</p>`;
  const rule = effectiveKern(p, pr.left, pr.right);
  const [k1, k2] = kernView.targetKeys(pr);
  const own = p.kerning?.[k1]?.[k2] !== undefined;
  // One letter of the pair: big, its group on the side facing the other
  // letter, and whether the value is for that group or for this letter.
  const side = (which, glyph) => {
    const prop = which === 'left' ? 'kernRight' : 'kernLeft';
    const gside = which === 'left' ? 'right' : 'left';
    const name = glyph[prop];
    const members = name ? groupMembers(p, name, gside) : [];
    const useGroup = kernView.useGroups[which] && !!name;
    const ch = glyphLabel(glyph);
    const MAX = 6;
    const more = members.length > MAX
      ? ` <button type="button" class="kp-more" data-kg-open="${gside}:${esc(name)}" data-tip="${esc(t('kgOpenAll'))}">+${members.length - MAX}</button>` : '';
    return `<div class="kp-side">
      <div class="kp-letter">${esc(ch)}</div>
      <label class="kp-field"><span>${esc(t(which === 'left' ? 'kpGroupRight' : 'kpGroupLeft'))}</span>
        <input type="text" data-pair-group="${which}" list="${prop}List" value="${esc(name || '')}" placeholder="${esc(t('kernNoGroup'))}" spellcheck="false"></label>
      ${name ? `<div class="seg seg-sm" role="radiogroup" aria-label="${esc(t('kernScopeLabel'))}">
          <button type="button" role="radio" data-scope="${which}" data-v="group" aria-checked="${useGroup}" data-tip="${esc(t('kpGroupTip', { m: membersText(members) }))}">${esc(t('kpGroup'))}</button>
          <button type="button" role="radio" data-scope="${which}" data-v="glyph" aria-checked="${!useGroup}" data-tip="${esc(t('kernOnlyHint'))}">${esc(t('kpLetter'))}</button>
        </div>
        <div class="kp-members">${esc(members.slice(0, MAX).map(glyphLabel).join(' '))}${more}</div>` : ''}
    </div>`;
  };
  const n = keyGlyphs(k1, 'right').length * keyGlyphs(k2, 'left').length;
  const from = rule.k1 && (rule.k1 !== k1 || rule.k2 !== k2)
    ? ` ${t('kernFrom', { k: `${kernKeyLabel(rule.k1)} — ${kernKeyLabel(rule.k2)}` })}` : '';
  return `
    <div class="kp-sides">${side('left', pr.left)}${side('right', pr.right)}</div>
    <div class="kp-value">
      <button class="btn" type="button" data-kstep="-10" aria-label="−10">−10</button>
      <button class="btn" type="button" data-kstep="-1" aria-label="−1">−1</button>
      <input type="number" id="kernValue" step="1" value="${rule.value}" aria-label="${esc(t('kernValue'))}">
      <button class="btn" type="button" data-kstep="1" aria-label="+1">+1</button>
      <button class="btn" type="button" data-kstep="10" aria-label="+10">+10</button>
    </div>
    <div class="kp-meta">
      <span class="hint">${esc((n > 1 ? t('kernScopeN', { n }) : t('kernScope1')) + from)}</span>
      ${own ? `<button class="btn btn-icon" type="button" data-kstep="reset" aria-label="${esc(t('kernReset'))}" data-tip="${esc(t('kernReset'))}">${icon('trash', 14)}</button>` : ''}
    </div>
    ${isOverkern(rule.value, pr.left, pr.right) ? `<p class="hint warn">${esc(t('kernOverTip'))}</p>` : ''}
    <button class="link-btn" type="button" data-kgroups>${icon('grid', 14)}<span>${esc(t('kgOpenAll'))}</span></button>`;
}

// Sidebearings of both letters of the pair, editable right in the line.
function kernSpacingHTML(pr) {
  const row = (which, g) => {
    const box = glyphBox(g);
    const f = (role, label, v, dis) => `<label><span>${esc(label)}</span><input type="number" step="1" data-kmetric="${which}:${role}" value="${v}" ${dis ? 'disabled' : ''}></label>`;
    return `<div class="kspace"><b>${esc(glyphLabel(g))}</b>
      ${f('lsb', t('lsb'), box ? Math.round(box.minX) : '', !box)}${f('advance', t('width'), Math.round(g.advance))}${f('rsb', t('rsb'), box ? Math.round(g.advance - box.maxX) : '', !box)}</div>`;
  };
  return row('left', pr.left) + row('right', pr.right);
}

function kernListHTML(pr) {
  const p = app.project;
  const all = kernPairs(p);
  const q = (store.get('spline.kernFilter') || '').toLowerCase();
  const show = store.get('spline.kernShow', 'all');
  const [sortBy, dir] = (store.get('spline.kernSort') || 'left:1').split(':');
  const near = pr && {
    L: [pr.left.name, groupKey(pr.left.kernRight)].filter(Boolean),
    R: [pr.right.name, groupKey(pr.right.kernLeft)].filter(Boolean),
  };
  const list = all.filter((k) => (!q || `${kernKeyLabel(k.left)}${kernKeyLabel(k.right)} ${k.left} ${k.right}`.toLowerCase().includes(q))
    && (show !== 'exc' || isException(k))
    && (show !== 'over' || pairIsOverkern(k))
    && (show !== 'pair' || (near && (near.L.includes(k.left) || near.R.includes(k.right)))));
  const key = { left: (k) => kernKeyLabel(k.left), right: (k) => kernKeyLabel(k.right) };
  list.sort((a, b) => (sortBy === 'value' ? a.value - b.value : key[sortBy](a).localeCompare(key[sortBy](b)) || a.value - b.value) * Number(dir));
  const head = (id, label) => `<button type="button" data-ksort="${id}" aria-sort="${sortBy === id ? (dir === '1' ? 'ascending' : 'descending') : 'none'}">${esc(label)}${sortBy === id ? (dir === '1' ? ' ↑' : ' ↓') : ''}</button>`;
  const opt = (v, label) => `<option value="${v}" ${show === v ? 'selected' : ''}>${esc(t(label))}</option>`;
  return `
    <div class="kern-tools">
      <input type="search" id="kernFilter" placeholder="${esc(t('search'))}" value="${esc(q)}">
      <select id="kernShow" aria-label="${esc(t('kernShowLabel'))}">${opt('all', 'kernShowAll')}${opt('exc', 'kernShowExc')}${opt('pair', 'kernShowPair')}${opt('over', 'kernShowOver')}</select>
    </div>
    <div class="kern-list">
      <div class="row head"><div class="pick">${head('left', t('kernColLeft'))}${head('right', t('kernColRight'))}</div>${head('value', t('kernColValue'))}<span></span></div>
      ${list.length ? list.map((k) => {
        const over = pairIsOverkern(k);
        return `<div class="row${isException(k) ? ' exc' : ''}${over ? ' over' : ''}">
          <button type="button" class="pick" data-kpick data-l="${esc(k.left)}" data-r="${esc(k.right)}" ${isException(k) ? `data-tip="${esc(t('kernException'))}"` : ''}>
            <span class="${isGroup(k.left) ? 'kgroup' : 'kglyph'}">${esc(kernKeyLabel(k.left))}</span>
            <span class="${isGroup(k.right) ? 'kgroup' : 'kglyph'}">${esc(kernKeyLabel(k.right))}</span></button>
          <span class="val ${k.value < 0 ? 'neg' : 'pos'}" ${over ? `data-tip="${esc(t('kernOverTip'))}"` : ''}>${k.value}</span>
          <button type="button" class="btn btn-icon" data-kdel data-l="${esc(k.left)}" data-r="${esc(k.right)}" aria-label="${esc(t('delete'))}" data-tip="${esc(t('delete'))}">${icon('close', 13)}</button>
        </div>`;
      }).join('') : `<p class="hint" style="padding:8px">${esc(t(all.length ? 'kernNoMatch' : 'kernEmpty'))}</p>`}</div>
    <div class="btn-row">
      <button class="btn" type="button" data-kclean data-tip="${esc(t('kernCleanTip'))}">${esc(t('kernClean'))}</button>
      <button class="btn" type="button" data-kcompress data-tip="${esc(t('kernCompressTip'))}">${esc(t('kernCompress'))}</button>
    </div>`;
}

// The kerning panel's sections may sit in the dock, in another dock place
// of the kerning view or in a floating window: listen in all of them.
function onKernPanels(type, fn) {
  for (const el of [$('kernPanel'), $('floatLayer'), ...$('kernView').querySelectorAll('[data-zone]')]) {
    el.addEventListener(type, (e) => { if (app.mode === 'kern') fn(e); });
  }
}

function renderKernPanel() {
  const pr = kernView.pair();
  const n = kernPairs(app.project).length;
  $('kernPanel').innerHTML = section('kernPair', t('kernPair'), kernPairHTML(pr))
    + (pr ? section('kernSpacing', t('kernSpacing'), kernSpacingHTML(pr), true, t('kernSpacingHint') + (app.extended ? ' ' + t('kernSpacingKeys') : '')) : '')
    + section('kernSuggest', t('ksTitle'), kernSuggestHTML(), true, t('ksHint'))
    + section('kernList', `${t('kernAll')} (${n})`, kernListHTML(pr))
    + groupDatalists();
  recordOrder($('kernPanel'));
  if (app.mode === 'kern') layoutPanels();
}

// Removes pairs whose glyphs were deleted or whose groups have no members.
function cleanKerning() {
  const dead = kernPairs(app.project).filter((k) => !keyGlyphs(k.left, 'right').length || !keyGlyphs(k.right, 'left').length);
  finishKernCleanup(dead);
}

// Removes exceptions that change nothing: every pair they decide would get
// the same value from the broader rule anyway.
function compressKerning() {
  const p = app.project;
  const redundant = kernPairs(p).filter((k) => {
    if (!isException(k)) return false;
    let decides = false;
    for (const l of keyGlyphs(k.left, 'right')) {
      for (const r of keyGlyphs(k.right, 'left')) {
        const now = effectiveKern(p, l, r);
        if (now.k1 !== k.left || now.k2 !== k.right) continue; // a more specific rule wins there
        decides = true;
        if (effectiveKern(p, l, r, [k.left, k.right]).value !== k.value) return false;
      }
    }
    return decides;
  });
  finishKernCleanup(redundant);
}

function finishKernCleanup(pairs) {
  if (!pairs.length) { toast(t('kernNothing')); return; }
  app.history.pushKerning(app.project);
  for (const k of pairs) deleteKern(app.project, k.left, k.right);
  app.onKernChanged();
  renderKernPanel();
  toast(t('kernRemoved', { n: pairs.length }));
}

// ---------------------------------------------------------------- variants and ligatures

// A variant is a glyph named "<base>.<suffix>" without a character of its
// own ("о.alt"); contextual rules put it in place of the base glyph when the
// neighbours match ('calt' in the font). A ligature glyph replaces a
// sequence of letters ('liga'). Browsers, text editors and design apps apply
// both by default, so the Preview shows them right away.

// The glyph a variant belongs to, or null.
function variantBase(g) {
  const i = g.name.indexOf('.');
  return i > 0 ? findGlyph(g.name.slice(0, i)) : null;
}

// "о.alt" rather than "uni043E.alt".
function variantLabel(g) {
  const base = variantBase(g);
  return base ? glyphLabel(base) + g.name.slice(base.name.length) : g.name;
}

const variantsOf = (g) => app.project.glyphs.filter((x) => x.name.startsWith(`${g.name}.`));
const ligatureOf = (g) => app.project.ligatures.find((l) => l.use === g.name);

// "бвг" or "бвг o.alt" -> glyph names; unknown characters are reported.
function parseGlyphList(text) {
  const names = [], unknown = [];
  for (const token of String(text).trim().split(/\s+/).filter(Boolean)) {
    if (findGlyph(token)) { names.push(token); continue; }
    for (const ch of Array.from(token)) {
      const g = app.project.glyphs.find((x) => x.unicode === ch.codePointAt(0));
      if (g) names.push(g.name); else unknown.push(ch);
    }
  }
  return { names: [...new Set(names)], unknown };
}

// Glyph names -> "бвг o.alt" (characters together, names apart).
function glyphListText(names) {
  let out = '';
  for (const n of names) {
    const g = findGlyph(n);
    const ch = g && charOf(g).trim();
    out += ch ? ch : ` ${n} `;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function uniqueGlyphName(base) {
  let name = base;
  for (let i = 2; findGlyph(name); i++) name = `${base}${i}`;
  return name;
}

// Copies the glyph into a new variant and opens it, with an empty rule to
// fill in.
function newVariant() {
  const base = app.mode === 'editor' ? (variantBase(app.current) || app.current) : selectedGlyphs()[0];
  if (!base) return;
  const g = {
    name: uniqueGlyphName(`${base.name}.alt`), advance: base.advance, contours: structuredClone(base.contours),
    ...(base.kernLeft ? { kernLeft: base.kernLeft } : {}), ...(base.kernRight ? { kernRight: base.kernRight } : {}),
  };
  app.history.pushGroups(app.project);
  app.project.glyphs.splice(app.project.glyphs.indexOf(base) + 1, 0, g);
  app.project.contextual.push({ glyph: base.name, use: g.name, prev: [], next: [] });
  markChanged();
  toast(t('varCreated', { n: variantLabel(g) }));
  openEditor(g.name);
}

// Extended mode: special forms. A copy of the glyph named "base.suffix",
// switched on by an OpenType feature (small caps, old-style figures, a
// stylistic set, the Bulgarian form...). See internal/fontgen/forms.go.
const SPECIAL_FORMS = [
  ['sc', 'smcp'], ['case', 'case'], ['onum', 'onum'], ['lnum', 'lnum'], ['tnum', 'tnum'], ['pnum', 'pnum'],
  ['sups', 'sups'], ['subs', 'subs'], ['numr', 'numr'], ['dnom', 'dnom'], ['zero', 'zero'], ['ordn', 'ordn'],
  ['swsh', 'swsh'], ['salt', 'salt'], ['ss01', 'ss'], ['cv01', 'cv'], ['loclBGR', 'loclBGR'], ['loclSRB', 'loclSRB'],
];

// What a glyph name's suffix switches on: { tag, label } or null.
function formOf(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return null;
  const suf = name.slice(i + 1);
  let m;
  if ((m = /^ss(0[1-9]|1\d|20)$/.exec(suf))) return { tag: suf, label: t('sf_ss', { n: Number(m[1]) }) };
  if ((m = /^cv(\d\d)$/.exec(suf)) && m[1] !== '00') return { tag: suf, label: t('sf_cv', { n: Number(m[1]) }) };
  if (/^locl[A-Z]{3}$/.test(suf)) return { tag: 'locl', lang: suf.slice(4), label: t('sf_' + suf, {}) === 'sf_' + suf ? t('sf_locl', { l: suf.slice(4) }) : t('sf_' + suf) };
  const f = SPECIAL_FORMS.find(([s]) => s === suf);
  return f ? { tag: f[1], label: t('sf_' + suf) } : null;
}

async function specialFormDialog() {
  const base = app.mode === 'editor' ? (variantBase(app.current) || app.current) : selectedGlyphs()[0];
  if (!base) return;
  const cards = SPECIAL_FORMS.map(([suf], k) => `<label class="sf-card"><input type="radio" name="suf" value="${suf}" ${k === 0 ? 'checked' : ''}>
      <b>${esc(t('sf_' + suf, { n: 1 }))}</b><small>${esc(t('sf_' + suf + 'Tip'))}</small></label>`).join('');
  const data = await showDialog({
    title: t('sfTitle', { c: glyphLabel(base) }),
    body: `<div class="sf-grid">${cards}</div>
      <label class="field sf-num">${esc(t('sfSet'))}<input type="number" name="n" min="1" max="20" value="1"></label>`,
    okLabel: t('create'),
  });
  if (!data) return;
  let suf = String(data.get('suf'));
  const n = Math.max(1, Math.min(20, Number(data.get('n')) || 1));
  if (suf === 'ss01') suf = `ss${String(n).padStart(2, '0')}`;
  if (suf === 'cv01') suf = `cv${String(n).padStart(2, '0')}`;
  const name = `${base.name}.${suf}`;
  if (findGlyph(name)) { openEditor(name); return; }
  const g = {
    name, advance: base.advance, contours: structuredClone(base.contours),
    ...(base.kernLeft ? { kernLeft: base.kernLeft } : {}), ...(base.kernRight ? { kernRight: base.kernRight } : {}),
  };
  app.history.pushGroups(app.project);
  app.project.glyphs.splice(app.project.glyphs.indexOf(base) + 1, 0, g);
  markChanged();
  toast(t('sfCreated', { name, what: formOf(name).label }));
  openEditor(g.name);
}

// Asks for a sequence of letters and makes a ligature glyph for it, drawn
// first as the letters side by side.
async function newLigature() {
  const data = await showDialog({
    title: t('ligNew'),
    body: `<label class="field">${esc(t('ligLetters'))}<input type="text" name="seq" required spellcheck="false" placeholder="ши, ffi, ТТ"></label>
      <p class="hint">${esc(t('ligNewHint'))}</p>`,
    okLabel: t('create'),
  });
  if (!data) return;
  const { names, unknown } = parseGlyphList(data.get('seq'));
  if (unknown.length) toast(t('varUnknown', { c: unknown.join(' ') }), 'error');
  if (names.length < 2) { toast(t('ligNeedTwo'), 'error'); return; }
  const existing = app.project.ligatures.find((l) => l.glyphs.join(' ') === names.join(' '));
  if (existing) { openEditor(existing.use); return; }
  const parts = names.map(findGlyph);
  let x = 0;
  const contours = [];
  for (const p of parts) {
    for (const c of p.contours) {
      const cc = structuredClone(c);
      for (const n of cc.nodes) for (const q of [n, n.in, n.out]) if (q) q.x += x;
      contours.push(cc);
    }
    x += p.advance;
  }
  const g = { name: uniqueGlyphName(names.join('_')), advance: x, contours };
  app.history.pushGroups(app.project);
  app.project.glyphs.push(g);
  app.project.ligatures.push({ glyphs: names, use: g.name });
  markChanged();
  openEditor(g.name);
}

// Rules mentioning deleted glyphs go with them.
function dropRulesOf(names) {
  const gone = (n) => names.has(n);
  const p = app.project;
  p.contextual = p.contextual.filter((r) => !gone(r.glyph) && !gone(r.use))
    .map((r) => ({ ...r, prev: r.prev.filter((n) => !gone(n)), next: r.next.filter((n) => !gone(n)) }));
  p.ligatures = p.ligatures.filter((l) => !gone(l.use) && !l.glyphs.some(gone));
}

// Panel section in the editor: what this glyph has or is.
function variantsSection(g) {
  const p = app.project;
  const base = variantBase(g);
  const lig = ligatureOf(g);
  let body = '';
  if (lig) {
    body = `<div class="sub-head">${esc(t('ligIs'))}</div>
      <label class="prop"><span>${esc(t('ligLetters'))}</span><input type="text" data-lig-seq value="${esc(glyphListText(lig.glyphs))}" spellcheck="false"></label>
      <button class="btn btn-block btn-danger" type="button" data-lig-del>${icon('close', 15)}<span>${esc(t('ligDelete'))}</span></button>`;
  } else if (base && app.extended && formOf(g.name) && !p.contextual.some((r) => r.use === g.name)) {
    body = `<div class="var-base">${glyphSVG(base, 'var-mini')}<span>${esc(t('varOf', { c: glyphLabel(base) }))}</span>
        <button class="btn" type="button" data-open-glyph="${esc(base.name)}">${esc(t('varOpenBase'))}</button></div>
      <p class="hint">${esc(t('sfIs', { what: formOf(g.name).label, tag: formOf(g.name).tag }))}</p>`;
  } else if (base) {
    const rules = p.contextual.map((r, i) => ({ r, i })).filter(({ r }) => r.use === g.name);
    body = `<div class="var-base">${glyphSVG(base, 'var-mini')}<span>${esc(t('varOf', { c: glyphLabel(base) }))}</span>
        <button class="btn" type="button" data-open-glyph="${esc(base.name)}">${esc(t('varOpenBase'))}</button></div>
      <div class="sub-head">${esc(t('varWhen'))}</div>
      ${rules.map(({ r, i }) => `<div class="var-rule" data-rule="${i}">
        <label><span>${esc(t('varPrev'))}</span><input type="text" data-rule-prev="${i}" value="${esc(glyphListText(r.prev))}" placeholder="${esc(t('varAny'))}" spellcheck="false"></label>
        <label><span>${esc(t('varNext'))}</span><input type="text" data-rule-next="${i}" value="${esc(glyphListText(r.next))}" placeholder="${esc(t('varAny'))}" spellcheck="false"></label>
        <button class="btn btn-icon" type="button" data-rule-del="${i}" aria-label="${esc(t('varRuleDelete'))}" data-tip="${esc(t('varRuleDelete'))}">${icon('close', 14)}</button>
        ${!r.prev.length && !r.next.length ? `<p class="hint warn">${esc(t('varEmptyRule'))}</p>` : ''}
      </div>`).join('')}
      <button class="btn btn-block" type="button" data-rule-add>${icon('plus', 15)}<span>${esc(t('varRuleAdd'))}</span></button>`;
  } else {
    const vars = variantsOf(g);
    const summary = (v) => {
      const rules = p.contextual.filter((r) => r.use === v.name && (r.prev.length || r.next.length));
      if (!rules.length) return t('varNoRules');
      return rules.map((r) => [r.prev.length ? t('varAfterShort', { l: glyphListText(r.prev) }) : '', r.next.length ? t('varBeforeShort', { l: glyphListText(r.next) }) : '']
        .filter(Boolean).join(', ')).join('; ');
    };
    body = `${vars.length ? `<div class="var-list">${vars.map((v) => `<button type="button" class="var-item" data-open-glyph="${esc(v.name)}">
        ${glyphSVG(v, 'var-mini')}<span><b>${esc(variantLabel(v))}</b><small>${esc(summary(v))}</small></span></button>`).join('')}</div>`
      : `<p class="hint">${esc(t('varNone'))}</p>`}
      <button class="btn btn-block" type="button" data-cmd="newVariant">${icon('plus', 15)}<span>${esc(t('varNew'))}</span></button>
      <button class="btn btn-block" type="button" data-cmd="newLigature">${icon('plus', 15)}<span>${esc(t('ligNew'))}</span></button>`;
  }
  return section('variants', t('varTitle'), body, true, t(ligatureOf(g) ? 'ligHint' : 'varHint'));
}

// Edits from the panel section.
function onVariantsChange(e) {
  const p = app.project;
  const el = e.target;
  const prevI = el.dataset.rulePrev, nextI = el.dataset.ruleNext;
  if (prevI !== undefined || nextI !== undefined) {
    const { names, unknown } = parseGlyphList(el.value);
    if (unknown.length) toast(t('varUnknown', { c: unknown.join(' ') }), 'error');
    app.history.pushGroups(p);
    const r = p.contextual[Number(prevI ?? nextI)];
    if (prevI !== undefined) r.prev = names; else r.next = names;
    markChanged();
    renderGlyphPanel();
    return true;
  }
  if (el.dataset.ligSeq !== undefined) {
    const { names, unknown } = parseGlyphList(el.value);
    if (unknown.length) toast(t('varUnknown', { c: unknown.join(' ') }), 'error');
    if (names.length < 2) { toast(t('ligNeedTwo'), 'error'); renderGlyphPanel(); return true; }
    app.history.pushGroups(p);
    ligatureOf(app.current).glyphs = names;
    markChanged();
    renderGlyphPanel();
    return true;
  }
  return false;
}

function onVariantsClick(e) {
  const p = app.project;
  const open = e.target.closest('[data-open-glyph]');
  if (open) { openEditor(open.dataset.openGlyph); return true; }
  if (e.target.closest('[data-rule-add]')) {
    const base = variantBase(app.current);
    if (!base) return true;
    app.history.pushGroups(p);
    p.contextual.push({ glyph: base.name, use: app.current.name, prev: [], next: [] });
    markChanged();
    renderGlyphPanel();
    return true;
  }
  const del = e.target.closest('[data-rule-del]');
  if (del) {
    app.history.pushGroups(p);
    p.contextual.splice(Number(del.dataset.ruleDel), 1);
    markChanged();
    renderGlyphPanel();
    return true;
  }
  if (e.target.closest('[data-lig-del]')) {
    app.history.pushGroups(p);
    p.ligatures = p.ligatures.filter((l) => l.use !== app.current.name);
    markChanged();
    renderGlyphPanel();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- shape helpers

// Groups by shape: compares the left and right side profiles of the drawn
// letters and proposes groups; letters with accents follow their base.
const sg = { tolerance: null };

function shapeGroupsProposal() {
  const p = app.project, info = p.info;
  const bases = p.glyphs.filter((g) => {
    const ch = charOf(g);
    return hasOutline(g) && letterKind(ch) && baseLetter(ch) === ch;
  });
  const result = {};
  for (const side of ['left', 'right']) {
    const prop = SIDE_PROP[side];
    result[side] = proposeGroups(bases, info, side, sg.tolerance).map((members) => {
      // Keep a name the members already share most, so kerning stays.
      const count = new Map();
      for (const m of members) if (m[prop]) count.set(m[prop], (count.get(m[prop]) || 0) + 1);
      const keep = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const sorted = [...members].sort((a, b) => a.unicode - b.unicode);
      return { name: keep || cleanGroupName(glyphLabel(sorted[0])), members: sorted, on: members.length > 1 };
    }).sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name));
  }
  return result;
}

function shapeGroupsDialog() {
  if ($('dialog').open) $('dialog').close();
  sg.tolerance ??= Math.round(app.project.info.unitsPerEm * 0.03);
  let prop = shapeGroupsProposal();
  const colHTML = (side) => {
    const multi = prop[side].filter((c) => c.members.length > 1);
    const singles = prop[side].filter((c) => c.members.length === 1);
    return `<section class="kg-col"><h3>${esc(t(side === 'left' ? 'kgLeftSides' : 'kgRightSides'))}</h3>
      <div class="kg-list">${multi.map((c) => {
        const i = prop[side].indexOf(c);
        return `<div class="kg-card">
          <div class="kg-card-head"><label class="check"><input type="checkbox" data-sg-on="${side}:${i}" ${c.on ? 'checked' : ''}>${esc(t('sgUse'))}</label>
            <input type="text" class="kg-name" data-sg-name="${side}:${i}" value="${esc(c.name)}" spellcheck="false" aria-label="${esc(t('kgRename'))}"></div>
          <div class="kg-chips">${c.members.map((g) => `<span class="kg-chip">${esc(glyphLabel(g))}</span>`).join('')}</div></div>`;
      }).join('') || `<p class="hint">${esc(t('sgNone'))}</p>`}
      ${singles.length ? `<p class="hint">${esc(t('sgSingles', { l: singles.map((c) => glyphLabel(c.members[0])).join(' ') }))}</p>` : ''}</div></section>`;
  };
  const render = () => { $('sgCols').innerHTML = colHTML('left') + colHTML('right'); };
  showDialog({
    title: t('sgTitle'),
    okLabel: t('sgApply'),
    body: `<div class="kg-dialog">
      <p class="hint">${esc(t('sgHelp'))}</p>
      <label class="sg-tol"><span>${esc(t('sgStrict'))}</span>
        <input type="range" id="sgTol" min="8" max="${Math.round(app.project.info.unitsPerEm * 0.1)}" value="${sg.tolerance}">
        <span>${esc(t('sgLoose'))}</span><output id="sgTolOut">${sg.tolerance}</output></label>
      <div class="kg-cols" id="sgCols"></div></div>`,
  }).then((data) => {
    if (!data) return;
    const p = app.project;
    app.history.pushGroups(p);
    let n = 0;
    for (const side of ['left', 'right']) {
      const key = SIDE_PROP[side];
      for (const c of prop[side]) {
        if (!c.on || !c.name) continue;
        for (const m of c.members) {
          // The letter and its accented forms (À, Á… follow A).
          for (const g of p.glyphs) {
            const ch = charOf(g);
            if (g === m || (ch && baseLetter(ch) === charOf(m) && g !== m)) { g[key] = c.name; n++; }
          }
        }
      }
    }
    markChanged();
    toast(t('sgApplied', { n }));
    if (app.mode === 'kern') { renderKernPanel(); kernView.render(); } else if (app.mode === 'editor') renderGlyphPanel(); else renderInspector();
  });
  const dlg = $('dialog');
  dlg.classList.add('wide');
  // Another dialog may already be open in its place when this one's close
  // event arrives.
  dlg.addEventListener('close', () => { if (!dlg.open) dlg.classList.remove('wide'); }, { once: true });
  dlg.querySelector('form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[type=text]')) { e.preventDefault(); e.target.blur(); }
  }, true); // before showDialog's Enter = OK
  render();
  const body = dlg.querySelector('.kg-dialog');
  body.addEventListener('input', (e) => {
    if (e.target.id !== 'sgTol') return;
    sg.tolerance = Number(e.target.value);
    $('sgTolOut').textContent = sg.tolerance;
    prop = shapeGroupsProposal();
    render();
  });
  body.addEventListener('change', (e) => {
    const on = e.target.dataset.sgOn, name = e.target.dataset.sgName;
    if (on) { const [side, i] = on.split(':'); prop[side][i].on = e.target.checked; }
    if (name) { const [side, i] = name.split(':'); prop[side][i].name = cleanGroupName(e.target.value); }
  });
}

// Kerning suggestions for the line. Each side of a letter has the spacing
// the designer gave it, measured next to its control letter ("H", "n",
// "Н", "н"); a pair needs kerning when its letters together stand further
// apart (or closer) than those two spacings add up to: "LL", "oo", "Hn"
// get nothing, "AV", "To", "LT" get negative values.
let kernSuggestions = [];

function suggestKerning() {
  const p = app.project, info = p.info;
  const items = kernView.layout();
  const zone = [info.descender, info.ascender];
  // The control letter of a kind: "n" for lowercase, "H" for the rest, in
  // the letter's own script.
  const refOf = (g, kind) => {
    const cyr = /[а-яёА-ЯЁ]/.test(charOf(g));
    const c = kind === 'small' ? (cyr ? 'н' : 'n') : (cyr ? 'Н' : 'H');
    return p.glyphs.find((x) => x.unicode === c.codePointAt(0) && hasOutline(x))
      || p.glyphs.find((x) => x.unicode === (kind === 'small' ? 110 : 72) && hasOutline(x));
  };
  const kindOf = (g) => letterKind(charOf(g)) || 'other';
  // How much white a side brings next to its own control letter, minus
  // half of the control pair: the spacing the designer gave that side.
  const side = (g, which) => {
    const ref = refOf(g, kindOf(g));
    if (!ref) return null;
    const pair = which === 'right' ? pairGap(g, ref, zone) : pairGap(ref, g, zone);
    const own = pairGap(ref, ref, zone);
    return pair && own ? { v: pair.close - own.close / 2, tight: own.tight } : null;
  };
  const out = [], seen = new Set();
  for (let i = 1; i < items.length; i++) {
    const L = items[i - 1].g, R = items[i].g;
    if (!L || !R || !hasOutline(L) || !hasOutline(R) || !charOf(L).trim() || !charOf(R).trim()) continue;
    const a = side(L, 'right'), b = side(R, 'left'), have = pairGap(L, R, zone);
    if (!a || !b || !have) continue;
    // The eye does not read a gap as fully as geometry does (a diagonal
    // channel looks narrower than it is), so only part of the difference.
    let s = 0.4 * (a.v + b.v - have.close);
    // Kerning never pulls the closest rows nearer than about a third of
    // the normal gap (it only limits, it does not push letters apart).
    const minTight = Math.min(a.tight, b.tight) * 0.35;
    if (s < 0 && have.tight + s < minTight) s = Math.min(0, minTight - have.tight);
    s = Math.round(s / 5) * 5;
    if (Math.abs(s) < 10) s = 0;
    if (isOverkern(s, L, R)) s = -Math.floor(0.4 * Math.min(L.advance, R.advance) / 5) * 5;
    const k1 = L.kernRight ? groupKey(L.kernRight) : L.name, k2 = R.kernLeft ? groupKey(R.kernLeft) : R.name;
    const key = `${k1} ${k2}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const now = effectiveKern(p, L, R).value;
    if (Math.abs(s - now) >= 10) out.push({ L, R, k1, k2, now, value: s, at: i });
  }
  kernSuggestions = out;
  renderKernPanel();
  if (!out.length) toast(t('ksNone'));
}

function kernSuggestHTML() {
  return `<button class="btn btn-block" type="button" data-ks-run>${icon('kerning', 15)}<span>${esc(t('ksRun'))}</span></button>
    ${kernSuggestions.length ? `<div class="ks-list">${kernSuggestions.map((s, i) => `<div class="ks-row">
        <button type="button" class="ks-pair" data-ks-go="${i}" data-tip="${esc(`${kernKeyLabel(s.k1)} — ${kernKeyLabel(s.k2)}`)}">${esc(glyphLabel(s.L) + glyphLabel(s.R))}</button>
        <span class="ks-val">${s.now} → <b class="${s.value < 0 ? 'neg' : 'pos'}">${s.value}</b></span>
        <button type="button" class="btn btn-icon" data-ks-ok="${i}" aria-label="${esc(t('ksAccept'))}" data-tip="${esc(t('ksAccept'))}">${icon('check', 14)}</button>
        <button type="button" class="btn btn-icon" data-ks-no="${i}" aria-label="${esc(t('ksReject'))}" data-tip="${esc(t('ksReject'))}">${icon('close', 14)}</button>
      </div>`).join('')}</div>
      <div class="btn-row"><button class="btn" type="button" data-ks-all>${esc(t('ksAcceptAll'))}</button><button class="btn" type="button" data-ks-clear>${esc(t('ksClear'))}</button></div>` : ''}`;
}

function acceptSuggestions(list) {
  if (!list.length) return;
  app.history.pushKerning(app.project);
  for (const s of list) setKern(app.project, s.k1, s.k2, s.value, !(isGroup(s.k1) && isGroup(s.k2)));
  kernSuggestions = kernSuggestions.filter((s) => !list.includes(s));
  app.onKernChanged();
  renderKernPanel();
}

function onSuggestClick(e) {
  if (e.target.closest('[data-ks-run]')) { suggestKerning(); return true; }
  if (e.target.closest('[data-ks-all]')) { acceptSuggestions([...kernSuggestions]); return true; }
  if (e.target.closest('[data-ks-clear]')) { kernSuggestions = []; renderKernPanel(); return true; }
  const ok = e.target.closest('[data-ks-ok]');
  if (ok) { acceptSuggestions([kernSuggestions[Number(ok.dataset.ksOk)]]); return true; }
  const no = e.target.closest('[data-ks-no]');
  if (no) { kernSuggestions.splice(Number(no.dataset.ksNo), 1); renderKernPanel(); return true; }
  const go = e.target.closest('[data-ks-go]');
  if (go) {
    kernView.cursor = kernSuggestions[Number(go.dataset.ksGo)].at;
    kernView.useGroups = { left: true, right: true };
    renderKernPanel();
    kernView.render();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- groups window

// Kerning groups of one side at a time: the groups in a list, the letters
// of the chosen group next to it. Letters are added by typing them, by
// selecting and moving them, or by dragging them onto a group in the list.
const kg = { side: 'left', current: null, sel: new Set(), search: '', cat: 'all', last: null };
const SIDE_PROP = { left: 'kernLeft', right: 'kernRight' };

// Groups of one side: Map name -> glyphs ("" = without a group).
function sideGroups(side) {
  const prop = SIDE_PROP[side];
  const groups = new Map([['', []]]);
  for (const g of app.project.glyphs) {
    const k = g[prop] || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  return groups;
}

// side / name: open on that side with that group chosen.
function groupsDialog(side, name) {
  if ($('dialog').open) return;
  kg.sel.clear();
  kg.current = name ?? null;
  if (side === 'left' || side === 'right') kg.side = side;
  showDialog({
    title: t('kgTitle'),
    cancel: false,
    body: `<div class="kg-dialog" id="kgBody">${groupsBodyHTML()}</div>`,
  }).then(() => {
    if (app.mode === 'kern') { renderKernPanel(); kernView.render(); }
    else if (app.mode === 'editor') renderGlyphPanel(); else renderInspector();
  });
  const dlg = $('dialog');
  dlg.classList.add('wide');
  // Another dialog may already be open in its place when this one's close
  // event arrives.
  dlg.addEventListener('close', () => { if (!dlg.open) dlg.classList.remove('wide'); }, { once: true });
  // The dialog is a form: Enter in a field must not close it.
  dlg.querySelector('form').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input')) return;
    e.preventDefault();
    if (e.target.id === 'kgAddInput') addLettersToGroup(e.target.value); else e.target.blur();
  }, true); // before showDialog's Enter = OK
  const body = $('kgBody');
  body.addEventListener('input', (e) => {
    if (e.target.id === 'kgSearch') { kg.search = e.target.value; refreshGroupsDialog(true); }
  });
  body.addEventListener('change', (e) => {
    if (e.target.id === 'kgCat') { kg.cat = e.target.value; refreshGroupsDialog(); }
    if (e.target.dataset.kgRename !== undefined) {
      const to = cleanGroupName(e.target.value);
      renameGroup(kg.side, e.target.dataset.kgRename, to);
      if (to) kg.current = to;
      refreshGroupsDialog();
    }
    if (e.target.dataset.kgMove !== undefined) moveToGroup(kg.side, [...kg.sel], e.target.value);
  });
  body.addEventListener('click', (e) => {
    const side = e.target.closest('[data-kg-side]');
    if (side) { kg.side = side.dataset.kgSide; kg.current = null; kg.sel.clear(); refreshGroupsDialog(); return; }
    const row = e.target.closest('[data-kg-group]');
    if (row) { kg.current = row.dataset.kgGroup; kg.sel.clear(); refreshGroupsDialog(); return; }
    const chip = e.target.closest('.kg-chip');
    if (chip) { selectChip(chip, e); return; }
    if (e.target.closest('[data-kg-add]')) { addLettersToGroup($('kgAddInput').value); return; }
    if (e.target.closest('[data-kg-new]')) { moveToGroup(kg.side, [...kg.sel], '__new'); return; }
    if (e.target.closest('[data-kg-ungroup]')) { moveToGroup(kg.side, [...kg.sel], '__none'); return; }
    if (e.target.closest('[data-kg-dissolve]')) {
      moveToGroup(kg.side, sideGroups(kg.side).get(kg.current).map((g) => g.name), '__none');
      kg.current = '';
      refreshGroupsDialog();
      return;
    }
    if (e.target.closest('[data-sg-open]')) { shapeGroupsDialog(); return; }
    if (e.target.closest('[data-kg-base]')) { autoGroupsAll(); refreshGroupsDialog(); }
  });
  body.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.kg-chip');
    if (!chip) return;
    if (!kg.sel.has(chip.dataset.glyph)) { kg.sel.clear(); kg.sel.add(chip.dataset.glyph); }
    e.dataTransfer.setData('text/plain', JSON.stringify([...kg.sel]));
    e.dataTransfer.effectAllowed = 'move';
  });
  body.addEventListener('dragend', () => body.querySelectorAll('.drop').forEach((c) => c.classList.remove('drop')));
  body.addEventListener('dragover', (e) => {
    const row = e.target.closest('[data-kg-group], [data-kg-new]');
    if (!row) return;
    e.preventDefault();
    body.querySelectorAll('.drop').forEach((c) => c !== row && c.classList.remove('drop'));
    row.classList.add('drop');
  });
  body.addEventListener('drop', (e) => {
    const row = e.target.closest('[data-kg-group], [data-kg-new]');
    if (!row) return;
    e.preventDefault();
    let names;
    try { names = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    moveToGroup(kg.side, names, row.dataset.kgNew !== undefined ? '__new' : (row.dataset.kgGroup || '__none'));
  });
}

// keepFocus: re-render while typing in the search field.
function refreshGroupsDialog(keepFocus = false) {
  const body = $('kgBody');
  if (!body || !$('dialog').open) return;
  const list = body.querySelector('.kg-list');
  const scroll = list ? list.scrollTop : 0;
  const caret = keepFocus ? $('kgSearch')?.selectionStart : null;
  body.innerHTML = groupsBodyHTML();
  const l = body.querySelector('.kg-list');
  if (l) l.scrollTop = scroll;
  if (keepFocus) { const s = $('kgSearch'); s.focus(); s.setSelectionRange(caret, caret); }
}

function selectChip(chip, e) {
  const name = chip.dataset.glyph, sel = kg.sel;
  if (e.shiftKey && kg.last) {
    const chips = [...chip.parentElement.querySelectorAll('.kg-chip')].map((c) => c.dataset.glyph);
    const a = chips.indexOf(kg.last), b = chips.indexOf(name);
    if (a >= 0) for (const n of chips.slice(Math.min(a, b), Math.max(a, b) + 1)) sel.add(n);
    else sel.add(name);
  } else if (e.ctrlKey || e.metaKey || sel.size) {
    // Plain clicks add to the selection too: picking letters one by one is
    // the usual way to fill a group.
    if (sel.has(name)) sel.delete(name); else sel.add(name);
  } else {
    sel.add(name);
  }
  kg.last = name;
  refreshGroupsDialog();
}

// Glyphs shown: the chosen category and the search.
function groupsVisible(g) {
  const cat = CATEGORIES.find((c) => c.id === kg.cat);
  if (cat && cat.id !== 'all' && !cat.test(charOf(g))) return false;
  const q = kg.search.trim().toLowerCase();
  return !q || charOf(g).toLowerCase() === q || g.name.toLowerCase().includes(q);
}

// Number of kerning rules that use a group.
function groupRuleCount(side, name) {
  const key = `@${name}`, k = app.project.kerning || {};
  if (side === 'right') return Object.keys(k[key] || {}).length;
  return Object.values(k).reduce((n, rights) => n + (key in rights ? 1 : 0), 0);
}

function groupsBodyHTML() {
  const side = kg.side;
  const groups = sideGroups(side);
  const names = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const q = kg.search.trim().toLowerCase();
  const shown = names.filter((n) => !q || n.toLowerCase().includes(q) || groups.get(n).some((g) => charOf(g).toLowerCase() === q));
  if (kg.current === null || (kg.current && !groups.has(kg.current))) kg.current = names[0] ?? '';
  const tab = (id, label) => `<button type="button" role="tab" data-kg-side="${id}" aria-selected="${side === id}">${esc(t(label))}</button>`;
  const head = `<div class="kg-top">
      <div class="seg" role="tablist">${tab('left', 'kgSideLeft')}${tab('right', 'kgSideRight')}</div>
      <input type="search" id="kgSearch" placeholder="${esc(t('kgSearch'))}" aria-label="${esc(t('kgSearch'))}" value="${esc(kg.search)}">
      ${names.length ? `<button type="button" class="btn" data-sg-open>${icon('kerning', 15)}<span>${esc(t('sgMenu'))}</span></button>` : ''}
    </div>
    <p class="hint">${esc(t(side === 'left' ? 'kgLeftSidesHint' : 'kgRightSidesHint'))}</p>`;

  // No groups yet: a clear way to start instead of a wall of letters.
  if (!names.length) {
    return `${head}<div class="kg-empty">
      <b>${esc(t('kgEmptyTitle'))}</b><p>${esc(t('kgEmptyText'))}</p>
      <div class="btn-row"><button type="button" class="btn btn-primary" data-sg-open>${icon('kerning', 15)}<span>${esc(t('sgMenu'))}</span></button>
      <button type="button" class="btn" data-kg-base>${esc(t('kgByBase'))}</button></div></div>`;
  }

  const row = (n, label, count, extra = '') => `<button type="button" class="kg-row" data-kg-group="${esc(n)}" aria-current="${kg.current === n}">
      <span>${esc(label)}</span><small>${count}${extra}</small></button>`;
  const list = `<nav class="kg-list" aria-label="${esc(t('kgTitle'))}">
      ${row('', t('kgNone'), groups.get('').length)}
      ${shown.map((n) => row(n, n, groups.get(n).length)).join('')}
      <div class="kg-row kg-new" data-kg-new>${icon('plus', 13)}<span>${esc(t('kgDropNew'))}</span></div>
    </nav>`;

  const cur = kg.current;
  const members = (groups.get(cur) || []).filter(groupsVisible);
  const chip = (g) => `<button type="button" class="kg-chip${kg.sel.has(g.name) ? ' sel' : ''}" draggable="true"
      data-glyph="${esc(g.name)}" aria-pressed="${kg.sel.has(g.name)}" data-tip="${esc(g.name)}">${esc(glyphLabel(g))}</button>`;
  const all = names;
  const selBar = kg.sel.size ? `<div class="kg-bar">
      <span>${esc(t('kgSelected', { n: kg.sel.size }))}</span>
      <select data-kg-move aria-label="${esc(t('kgMoveTo'))}">
        <option value="" selected disabled>${esc(t('kgMoveTo'))}</option>
        ${all.filter((n) => n !== cur).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
      </select>
      <button type="button" class="btn" data-kg-new>${esc(t('kgNewGroup'))}</button>
      ${cur ? `<button type="button" class="btn" data-kg-ungroup>${esc(t('kgUngroup'))}</button>` : ''}
    </div>` : '';
  const main = cur
    ? `<div class="kg-main-head">
        <input type="text" class="kg-name" data-kg-rename="${esc(cur)}" value="${esc(cur)}" spellcheck="false" aria-label="${esc(t('kgRename'))}">
        <small>${esc((() => { const n = groupRuleCount(side, cur); return n ? t('kgRules', { n }) : t('kgNoRules'); })())}</small>
        <button type="button" class="btn btn-icon" data-kg-dissolve aria-label="${esc(t('kgDissolve'))}" data-tip="${esc(t('kgDissolve'))}">${icon('trash', 15)}</button>
      </div>
      <div class="kg-chips">${members.map(chip).join('') || `<p class="hint">${esc(t('kgNoMembers'))}</p>`}</div>
      ${selBar}
      <div class="kg-add">
        <input type="text" id="kgAddInput" placeholder="${esc(t('kgAddPlaceholder'))}" aria-label="${esc(t('kgAddLetters'))}" spellcheck="false">
        <button type="button" class="btn" data-kg-add>${icon('plus', 14)}<span>${esc(t('kgAdd'))}</span></button>
      </div>`
    : `<div class="kg-main-head"><b>${esc(t('kgNone'))}</b>
        <select id="kgCat" aria-label="${esc(t('categories'))}">${CATEGORIES.filter((c) => c.id !== 'empty' && c.id !== 'done')
          .map((c) => `<option value="${c.id}" ${kg.cat === c.id ? 'selected' : ''}>${esc(t(c.id))}</option>`).join('')}</select></div>
      ${selBar || `<p class="hint">${esc(t('kgUngroupedHint'))}</p>`}
      <div class="kg-chips">${members.map(chip).join('')}</div>`;
  return `${head}<div class="kg-split">${list}<section class="kg-main">${main}</section></div>`;
}

// Typed letters ("ОСЭЮ") go into the current group.
function addLettersToGroup(text) {
  const { names, unknown } = parseGlyphList(text);
  if (unknown.length) toast(t('varUnknown', { c: unknown.join(' ') }), 'error');
  if (!names.length || !kg.current) return;
  moveToGroup(kg.side, names, kg.current);
}

// "Groups from base letter" for every glyph of the font.
function autoGroupsAll() {
  app.history.pushGroups(app.project);
  for (const g of app.project.glyphs) {
    const ch = charOf(g);
    if (!ch.trim()) continue;
    const bg = app.project.glyphs.find((x) => x.unicode === baseLetter(ch).codePointAt(0)) || g;
    g.kernLeft = bg.kernLeft || bg.name;
    g.kernRight = bg.kernRight || bg.name;
  }
  markChanged();
}

// Puts glyphs into a group ("" or "__none" removes them, "__new" makes a
// new group named after the first glyph).
function moveToGroup(side, names, target) {
  const prop = SIDE_PROP[side];
  const glyphs = names.map(findGlyph).filter(Boolean);
  if (!glyphs.length) return;
  let group = target === '__none' ? '' : target;
  if (target === '__new') {
    const base = cleanGroupName(glyphLabel(glyphs[0])) || glyphs[0].name;
    const used = new Set(app.project.glyphs.map((g) => g[prop]).filter(Boolean));
    group = base;
    for (let i = 2; used.has(group); i++) group = `${base}${i}`;
  }
  app.history.pushGroups(app.project);
  for (const g of glyphs) { if (group) g[prop] = group; else delete g[prop]; }
  kg.sel.clear();
  if (target === '__new') kg.current = group; // show the new group
  markChanged();
  refreshGroupsDialog();
}

// Renames a group on one side, with its kerning rules. Renaming into an
// existing group merges them; rules the target already has stay.
function renameGroup(side, from, to) {
  if (!to || to === from) { refreshGroupsDialog(); return; }
  const prop = SIDE_PROP[side], p = app.project;
  app.history.pushGroups(p);
  for (const g of p.glyphs) if (g[prop] === from) g[prop] = to;
  const a = `@${from}`, b = `@${to}`, k = p.kerning || {};
  if (side === 'right' && k[a]) {
    k[b] = { ...k[a], ...(k[b] || {}) };
    delete k[a];
  }
  if (side === 'left') {
    for (const rights of Object.values(k)) {
      if (!(a in rights)) continue;
      if (!(b in rights)) rights[b] = rights[a];
      delete rights[a];
    }
  }
  markChanged();
  refreshGroupsDialog();
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
  if (e.target.id === 'kernSample' && e.target.value) setKernSample(e.target.value);
  if (e.target.id === 'kernShowGroups') toggleKernGroups(e.target.checked);
  if (e.target.id === 'kernShowMetrics') {
    kernView.showMetrics = e.target.checked;
    store.set('spline.kernShowMetrics', e.target.checked ? '1' : '0');
    kernView.render();
  }
});
$('optionsBar').addEventListener('keydown', (e) => {
  if (e.target.id === 'kernText' && e.key === 'Enter') { e.preventDefault(); $('kernCanvas').focus(); }
});

onKernPanels('change', (e) => {
  const pr = kernView.pair();
  if (!pr) return;
  if (e.target.id === 'kernValue') {
    app.history.pushKerning(app.project);
    kernView.writeKern(pr, Number(e.target.value) || 0);
    app.onKernChanged();
  }
  if (e.target.id === 'kernShow') { store.set('spline.kernShow', e.target.value); renderKernPanel(); }
  if (e.target.dataset.kmetric) {
    const [which, role] = e.target.dataset.kmetric.split(':');
    const g = which === 'left' ? pr.left : pr.right;
    applyMetric(g, role, Number(e.target.value));
    markChanged();
    kernView.render();
    renderKernPanel();
  }
  if (e.target.dataset.pairGroup) {
    // Rename / assign the group right from the pair.
    const which = e.target.dataset.pairGroup;
    const g = which === 'left' ? pr.left : pr.right;
    const prop = which === 'left' ? 'kernRight' : 'kernLeft';
    const v = cleanGroupName(e.target.value);
    app.history.pushGroups(app.project);
    if (v) g[prop] = v; else delete g[prop];
    markChanged();
    kernView.render();
    renderKernPanel();
  }
});
// Delete / Backspace on a row of the pair list removes that pair.
onKernPanels('keydown', (e) => {
  const pick = e.target.closest?.('[data-kpick]');
  if (!pick || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
  e.preventDefault();
  const rows = [...document.querySelectorAll('#kernView [data-kpick], #floatLayer [data-kpick]')];
  const i = rows.indexOf(pick);
  app.history.pushKerning(app.project);
  deleteKern(app.project, pick.dataset.l, pick.dataset.r);
  app.onKernChanged();
  renderKernPanel();
  const after = document.querySelectorAll('#kernView [data-kpick], #floatLayer [data-kpick]');
  after[Math.min(i, after.length - 1)]?.focus();
});
onKernPanels('input', (e) => {
  if (e.target.id === 'kernFilter') {
    store.set('spline.kernFilter', e.target.value);
    const pos = e.target.selectionStart;
    renderKernPanel();
    const f = $('kernFilter');
    f.focus();
    f.setSelectionRange(pos, pos);
  }
});
onKernPanels('click', (e) => {
  if (onSuggestClick(e)) return;
  const scope = e.target.closest('[data-scope]');
  if (scope) {
    kernView.useGroups[scope.dataset.scope] = scope.dataset.v === 'group';
    renderKernPanel();
    kernView.render();
    return;
  }
  const sort = e.target.closest('[data-ksort]')?.dataset.ksort;
  if (sort) {
    const [by, dir] = (store.get('spline.kernSort') || 'left:1').split(':');
    store.set('spline.kernSort', `${sort}:${by === sort ? -Number(dir) : 1}`);
    renderKernPanel();
    return;
  }
  if (e.target.closest('[data-kclean]')) { cleanKerning(); return; }
  if (e.target.closest('[data-kgroups]')) { groupsDialog(); return; }
  const kgOpen = e.target.closest('[data-kg-open]');
  if (kgOpen) { const [sd, ...nm] = kgOpen.dataset.kgOpen.split(':'); groupsDialog(sd, nm.join(':')); return; }
  if (e.target.closest('[data-kcompress]')) { compressKerning(); return; }
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

// Ctrl+Z during free transform cancels the transform itself (the glyph
// returns to how it was before Ctrl+T), like in Photoshop.
function undo() {
  if (app.mode === 'editor' && editor.xform) { editor.cancelTransform(); return; }
  applyHistory(app.history.undo(app.project));
}
function redo() {
  if (app.mode === 'editor' && editor.xform) editor.commitTransform();
  applyHistory(app.history.redo(app.project));
}

// Other edits apply an open free transform first, so it cannot undo them.
const endTransform = () => { if (app.mode === 'editor' && editor.xform) editor.commitTransform(); };
function applyHistory(name) {
  if (!name) return;
  markChanged();
  if (name === KERNING || name === GROUPS) {
    kernView.render();
    if (app.mode === 'kern') renderKernPanel();
    if (name === GROUPS) {
      if (app.mode === 'editor') renderGlyphPanel(); else if (app.mode === 'grid') renderInspector();
      refreshGroupsDialog();
    }
    return;
  }
  if (app.mode === 'editor') {
    if (app.current?.name !== name) openEditor(name, false);
    editor.sel.clear();
    editor.penContour = null;
    editor.render();
    renderGlyphPanel(); // components, notes and keys may have changed
    syncTransformFields();
  } else {
    const g = findGlyph(name);
    if (g) updateTile(g);
    renderSidebar();
    renderInspector();
  }
}

// ================================================================ extended mode

// Glyph names: letters, digits, dot, underscore and hyphen, as in fonts.
const NAME_RE = /^[A-Za-z_][A-Za-z0-9._-]{0,62}$/;

// Renames a glyph and every place that refers to it: kerning, variants,
// ligatures, components, metric keys.
function renameGlyph(g, name) {
  if (name === g.name) return true;
  if (!NAME_RE.test(name)) { toast(t('rnBad'), 'error'); return false; }
  if (findGlyph(name)) { toast(t('rnTaken', { name }), 'error'); return false; }
  const p = app.project, old = g.name;
  app.history.pushGroups(p);
  app.history.push(g);
  const swap = (x) => (x === old ? name : x);
  const kern = {};
  for (const [l, row] of Object.entries(p.kerning || {})) {
    const r2 = (kern[swap(l)] ||= {});
    for (const [r, v] of Object.entries(row)) r2[swap(r)] = v;
  }
  p.kerning = kern;
  for (const r of p.contextual) { r.glyph = swap(r.glyph); r.use = swap(r.use); r.prev = r.prev.map(swap); r.next = r.next.map(swap); }
  for (const l of p.ligatures) { l.glyphs = l.glyphs.map(swap); l.use = swap(l.use); }
  const esc2 = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRe = new RegExp('^=(\\|)?' + esc2 + '(?=$|[-+*/\\s])');
  for (const x of p.glyphs) {
    for (const k of x.components || []) k.glyph = swap(k.glyph);
    for (const f of Object.values(KEY_FIELDS)) if (x[f]) x[f] = x[f].replace(keyRe, `=$1${name}`);
    if (x.compose) x.compose = { base: swap(x.compose.base), marks: x.compose.marks.map(swap) };
  }
  g.name = name;
  if (app.selected.delete(old)) app.selected.add(name);
  if (app.focusName === old) app.focusName = name;
  markChanged();
  renderGrid();
  renderInspector();
  return true;
}

function setUnicode(g, text) {
  if (!text) { app.history.push(g); delete g.unicode; markChanged(); renderGrid(); return true; }
  const m = /^(?:U\+|0x)?([0-9a-f]{1,6})$/i.exec(text) || ([...text].length === 1 ? [null, text.codePointAt(0).toString(16)] : null);
  const cp = m && parseInt(m[1], 16);
  if (!cp || cp > 0x10ffff) { toast(t('ucBad'), 'error'); return false; }
  const other = app.project.glyphs.find((x) => x !== g && x.unicode === cp);
  if (other) { toast(t('ucTaken', { name: other.name }), 'error'); return false; }
  app.history.push(g);
  g.unicode = cp;
  markChanged();
  renderGrid();
  return true;
}

function setTags(g, text) {
  const tags = [...new Set(String(text).split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 20);
  if (tags.length) g.tags = tags; else delete g.tags;
}

function infoFieldsHTML(g) {
  return `<label class="prop"><span>${esc(t('tc_name'))}</span><input type="text" data-info="name" value="${esc(g.name)}" spellcheck="false"></label>
    <label class="prop"><span>Unicode</span><input type="text" data-info="unicode" value="${g.unicode ? 'U+' + hex(g) : ''}" placeholder="—" spellcheck="false"></label>
    <label class="prop"><span>${esc(t('tc_tags'))}</span><input type="text" data-info="tags" value="${esc((g.tags || []).join(', '))}" placeholder="${esc(t('tagsPh'))}" spellcheck="false"></label>
    <label class="prop"><span>${esc(t('tc_note'))}</span><input type="text" data-info="note" value="${esc(g.note || '')}"></label>
    <label class="check" data-tip="${esc(t('exportTip'))}"><input type="checkbox" data-info="export" ${g.noExport ? '' : 'checked'}>${esc(t('exportIn'))}</label>`;
}

function onInfoChange(e) {
  const k = e.target.dataset.info;
  const g = selectedGlyphs()[0];
  if (!k || !g) return false;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
  if (k === 'name') { if (!renameGlyph(g, v)) e.target.value = g.name; return true; }
  if (k === 'unicode') { if (!setUnicode(g, v)) e.target.value = g.unicode ? 'U+' + hex(g) : ''; return true; }
  app.history.push(g);
  if (k === 'tags') setTags(g, v);
  if (k === 'note') { if (v) g.note = v; else delete g.note; }
  if (k === 'export') { if (v) delete g.noExport; else g.noExport = true; }
  markChanged();
  renderSmartFilters();
  updateTile(g);
  return true;
}

// Copies the selected glyphs under new names (without Unicode).
function duplicateGlyphs() {
  const sel = selectedGlyphs();
  if (!sel.length) return;
  app.history.pushGroups(app.project);
  const made = [];
  for (const g of sel) {
    const copy = structuredClone(g);
    copy.name = uniqueGlyphName(`${g.name}.copy`);
    delete copy.unicode;
    delete copy.compose;
    app.project.glyphs.splice(app.project.glyphs.indexOf(g) + 1, 0, copy);
    made.push(copy.name);
  }
  app.selected = new Set(made);
  markChanged();
  renderAll();
  toast(t('dupDone', { n: made.length }));
}

// Batch commands for the selected glyphs (extended mode).
function batchSection(sel) {
  const b = (cmd, label) => `<button class="btn" type="button" data-cmd="${cmd}" data-tip="${esc(t(label + 'Tip'))}">${esc(t(label))}</button>`;
  return section('batch', t('btTitle', { n: sel.length }), `
    <div class="btn-row">${b('btExtremes', 'btExtremes')}${b('btRound', 'btRound')}</div>
    <div class="btn-row">${b('btMetrics', 'btMetrics')}${b('btDecompose', 'btDecompose')}</div>
    <button class="btn btn-block" type="button" data-cmd="tmOpen">${icon('spacing', 15)}<span>${esc(t('tmMenu'))}</span></button>
    ${sel.length > 1 ? `<label class="prop"><span>${esc(t('btTag'))}</span><input type="text" data-batch-tag placeholder="${esc(t('tagsPh'))}" spellcheck="false"></label>
    <div class="btn-row">${b('btExportOff', 'btExportOff')}${b('btExportOn', 'btExportOn')}</div>` : ''}`, false);
}

function batch(op) {
  const sel = selectedGlyphs();
  let n = 0;
  for (const g of sel) {
    if (op === 'extremes') {
      const copy = structuredClone(g.contours);
      if (!addExtremesTo(copy)) continue;
      app.history.push(g); g.contours = copy;
    } else if (op === 'round') {
      const copy = structuredClone(g.contours);
      for (const c of copy) for (const nd of c.nodes) for (const q of [nd, nd.in, nd.out]) if (q) { q.x = Math.round(q.x); q.y = Math.round(q.y); }
      if (JSON.stringify(copy) === JSON.stringify(g.contours)) continue;
      app.history.push(g); g.contours = copy;
    } else if (op === 'decompose') {
      if (!g.components?.length) continue;
      app.history.push(g); decompose(g);
    } else if (op === 'exportOff' || op === 'exportOn') {
      if (!!g.noExport === (op === 'exportOff')) continue;
      app.history.push(g);
      if (op === 'exportOff') g.noExport = true; else delete g.noExport;
    }
    n++;
    updateTile(g);
  }
  if (op === 'metrics') n = updateMetrics(app.project, sel, (g) => app.history.push(g)).length;
  if (n) { markChanged(); renderGrid(); renderSidebar(); renderInspector(); }
  toast(t('btDone', { n }));
}

function setExtended(on) {
  app.extended = on;
  editor.extended = on;
  store.set('spline.extended', on ? '1' : '0');
  document.documentElement.dataset.mode = on ? 'extended' : 'simple';
  renderAll();
  if (app.mode === 'grid') renderGridOptions();
  if (app.mode === 'editor') { renderToolbar(); renderEditorOptions(); renderGlyphPanel(); editor.render(); }
  if (app.mode === 'kern') { renderKernOptions(); renderKernPanel(); kernView.render(); }
  renderPreviewText();
  toast(t(on ? 'extOn' : 'extOff'));
}

function breakContour() {
  endTransform();
  if (app.mode === 'editor' && !editor.breakAt()) toast(t('breakHint'), 'error');
}

function joinContours() {
  endTransform();
  if (app.mode === 'editor' && !editor.joinEnds()) toast(t('joinHint'), 'error');
}

// Background layer: a copy of the outline to compare against while
// redrawing. It is kept in the project but never exported.
function backgroundOp(op) {
  endTransform();
  const g = app.current;
  if (app.mode !== 'editor' || !g) return;
  if (op === 'clear' && !g.background?.length) return;
  app.history.push(g);
  if (op === 'copy') g.background = structuredClone(g.contours);
  if (op === 'swap') [g.contours, g.background] = [g.background || [], structuredClone(g.contours)];
  if (op === 'clear' || !g.background?.length) delete g.background;
  editor.sel.clear();
  editor.showBackground = true;
  store.set('spline.showBackground', '1');
  editor.afterEdit(op === 'swap');
  renderGlyphPanel();
  if (op === 'copy') toast(t('bgCopied'));
}

function pointsSection() {
  const b = (cmd, label, key) => `<button class="btn" type="button" data-cmd="${cmd}" data-tip="${esc(t(label + 'Tip'))}"${key ? ` data-key="${esc(keyLabel(key))}"` : ''}>${esc(t(label + 'Short'))}</button>`;
  return section('points', t('ptTitle'), `
    <div class="btn-row">${b('ptExtremes', 'addExtremes', 'addExtremes')}${b('ptAlign', 'alignPoints', 'alignPoints')}</div>
    <div class="btn-row">${b('ptBreak', 'breakContour', 'breakContour')}${b('ptJoin', 'joinContours', 'joinContours')}</div>
    <div class="btn-row">${b('ptEven', 'evenHandles', 'evenHandles')}${b('ptFirst', 'makeFirst', 'makeFirst')}</div>
    <div class="btn-row">${b('ptInvert', 'invertSelection', 'invertSelection')}</div>
    <div class="parts">${partsHTML()}</div>`, true, t('ptHint'));
}

// Corner details and brushes for the selection (see parts.js).
function partsHTML() {
  const g = app.current;
  if (!g || isCornerGlyph(g) || isBrushGlyph(g)) return '';
  const keys = [...editor.sel].map((k) => k.split(':').map(Number));
  const corners = app.project.glyphs.filter(isCornerGlyph), brushes = app.project.glyphs.filter(isBrushGlyph);
  const opt = (list, cur) => `<option value="">${esc(t('ptNone'))}</option>${list.map((x) => `<option value="${esc(x.name)}" ${cur === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`;
  let html = '';
  if (keys.length === 1) {
    const [ci, ni] = keys[0];
    const n = g.contours[ci]?.nodes[ni];
    if (n && !n.smooth) {
      html += `<div class="sub-head">${esc(t('ptCorner'))}</div><div class="part-row">
        <select data-part="corner" data-tip="${esc(t('ptCornerTip'))}">${opt(corners, n.corner)}</select>
        <button class="btn" type="button" data-cmd="newCorner">${icon('plus', 14)}<span>${esc(t('ptNewCorner'))}</span></button></div>`;
    }
  }
  const cis = [...new Set(keys.map(([ci]) => ci))];
  if (cis.length === 1 && g.contours[cis[0]]) {
    const c = g.contours[cis[0]];
    html += `<div class="sub-head">${esc(t('ptBrush'))}</div><div class="part-row">
      <select data-part="brush" data-tip="${esc(t('ptBrushTip'))}">${opt(brushes, c.brush)}</select>
      <button class="btn" type="button" data-cmd="newBrush">${icon('plus', 14)}<span>${esc(t('ptNewBrush'))}</span></button></div>`;
  }
  return html;
}

function setPart(kind, name) {
  const g = app.current;
  const keys = [...editor.sel].map((k) => k.split(':').map(Number));
  if (!g || !keys.length) return;
  app.history.push(g);
  if (kind === 'corner') {
    const [ci, ni] = keys[0];
    const n = g.contours[ci].nodes[ni];
    if (name) n.corner = name; else delete n.corner;
  } else {
    const [ci, ni] = keys[0];
    const c = g.contours[ci];
    if (name) {
      // A brush runs along an open line: a closed contour opens at the
      // selected point.
      if (c.closed) {
        c.nodes = [...c.nodes.slice(ni), ...c.nodes.slice(0, ni)];
        delete c.nodes[0].in;
        delete c.nodes[c.nodes.length - 1].out;
        c.closed = false;
        editor.sel = new Set([`${ci}:0`]);
      }
      c.brush = name;
    } else delete c.brush;
  }
  editor.afterEdit(false);
  renderGlyphPanel();
}

// A new detail glyph (left out of the font), with a sample shape to start.
function newPartGlyph(kind) {
  const base = kind === 'corner' ? '_corner.serif' : '_brush.stroke';
  const name = uniqueGlyphName(base);
  const sample = kind === 'corner' ? [rectContour(-60, 0, 20, 30)] : [ellipseContour(0, -30, 300, 30)];
  const g = { name, advance: 0, contours: sample, noExport: true };
  app.history.pushGroups(app.project);
  app.project.glyphs.push(g);
  // Use it right away on the current selection.
  if (app.current && editor.sel.size) setPart(kind, name);
  markChanged();
  toast(t(kind === 'corner' ? 'ptCornerMade' : 'ptBrushMade', { name }));
}

function backgroundSection(g) {
  const has = !!g.background?.length;
  return section('background', t('bgTitle'), `
    <label class="check"><input type="checkbox" id="bgShow" ${editor.showBackground ? 'checked' : ''} ${has ? '' : 'disabled'}>${esc(t('bgShow'))}</label>
    <button class="btn btn-block" type="button" data-cmd="bgCopy">${icon('layers', 15)}<span>${esc(t('bgCopy'))}</span></button>
    <div class="btn-row">
      <button class="btn" type="button" data-cmd="bgSwap" ${has ? '' : 'disabled'}>${esc(t('bgSwapShort'))}</button>
      <button class="btn" type="button" data-cmd="bgClear" ${has ? '' : 'disabled'}>${esc(t('bgClear'))}</button>
    </div>
    <div class="sub-head">${esc(t('snapTitle'))}</div>
    ${(g.snapshots || []).map((sn, i) => `<div class="snap-row">
      <span>${esc(sn.name)}</span>
      <button class="btn" type="button" data-snap-restore="${i}" data-tip="${esc(t('snapRestoreTip'))}">${esc(t('snapRestore'))}</button>
      <button class="btn btn-icon" type="button" data-snap-delete="${i}" aria-label="${esc(t('snapDelete'))}" data-tip="${esc(t('snapDelete'))}">${icon('trash', 14)}</button>
    </div>`).join('')}
    <button class="btn btn-block" type="button" data-cmd="snapSave" data-tip="${esc(t('snapHint'))}">${icon('plus', 15)}<span>${esc(t('snapSave'))}</span></button>`, false, t('bgHint'));
}

// ================================================================ masters

function masterBarHTML() {
  if (!app.extended) return '';
  const p = app.project;
  if (!hasMasters(p)) {
    return `<div class="group"><button class="btn" type="button" data-cmd="mastersDialog" data-tip="${esc(t('msAddTip'))}">${icon('layers', 14)}<span>${esc(t('msMasters'))}</span></button></div><div class="sep"></div>`;
  }
  const act = activeId(p);
  return `<div class="group"><div class="seg" role="radiogroup" aria-label="${esc(t('msMasters'))}">
    ${p.masters.map((m) => `<button type="button" role="radio" data-master="${esc(m.id)}" aria-checked="${m.id === act}" data-tip="${esc(p.axis.tag)} ${m.loc}${p.axis2 ? ` · ${esc(p.axis2.tag)} ${m.loc2}` : ''}">${esc(m.name)}</button>`).join('')}
    </div><button class="btn btn-icon" type="button" data-cmd="mastersDialog" aria-label="${esc(t('msMenu'))}" data-tip="${esc(t('msMenu'))}">${icon('settings', 14)}</button></div><div class="sep"></div>`;
}

function selectMaster(id) {
  endTransform();
  if (!switchMaster(app.project, id)) return;
  // Undo steps hold outlines of the master they were made in.
  app.history.clear();
  refreshComponents(app.project);
  recompose(app.project);
  markChanged();
  renderAll();
  if (app.mode === 'editor') { renderEditorOptions(); renderGlyphPanel(); editor.sel.clear(); editor.render(); updateMetricInputs(); }
  if (app.mode === 'grid') renderGridOptions();
  // Kerning belongs to the master too.
  if (app.mode === 'kern') { renderKernOptions(); renderKernPanel(); kernView.render(); }
}

async function mastersDialog() {
  const p = app.project;
  const ms = p.masters || [];
  const w2 = !!p.axis2;
  const loc2 = (name, v) => (w2 ? `<input type="number" name="${name}" value="${v ?? ''}" step="1" placeholder="100" aria-label="${esc(t('msLoc2'))}">` : '');
  const rows = ms.map((m, i) => `<div class="field-row ms-row${w2 ? ' two' : ''}">
      <input type="text" name="name${i}" value="${esc(m.name)}" aria-label="${esc(t('msName'))}" required maxlength="40">
      <input type="number" name="loc${i}" value="${m.loc}" step="1" aria-label="${esc(t('msLoc'))}">
      ${loc2(`loc2_${i}`, m.loc2)}
      <label class="check"><input type="checkbox" name="del${i}" ${i === 0 ? 'disabled' : ''}>${esc(t('msDelete'))}</label></div>`).join('');
  const data = await showDialog({
    title: t('msMasters'),
    body: `${ms.length ? `<div class="field-row ms-row ms-head${w2 ? ' two' : ''}"><span>${esc(t('msName'))}</span><span>${esc(t('msLoc'))}</span>${w2 ? `<span>${esc(t('msLoc2'))}</span>` : ''}<span></span></div>${rows}` : ''}
      <h3>${esc(t('msNew'))}</h3>
      <div class="field-row ms-row${w2 ? ' two' : ''}">
        <input type="text" name="newName" placeholder="Bold" maxlength="40" aria-label="${esc(t('msName'))}">
        <input type="number" name="newLoc" placeholder="700" step="1" aria-label="${esc(t('msLoc'))}">${loc2('newLoc2', '')}<span></span></div>
      ${ms.length ? `<label class="check"><input type="checkbox" name="axis2" ${w2 ? 'checked' : ''}>${esc(t('msAxis2'))}</label>` : ''}`,
    okLabel: t('ok'),
  });
  if (!data) return;
  ms.forEach((m, i) => {
    m.name = String(data.get(`name${i}`) || m.name).trim() || m.name;
    const v = Number(data.get(`loc${i}`));
    if (Number.isFinite(v)) m.loc = Math.round(v);
    const v2 = Number(data.get(`loc2_${i}`));
    if (w2 && Number.isFinite(v2) && String(data.get(`loc2_${i}`)).trim() !== '') m.loc2 = Math.round(v2);
  });
  if (ms.length) setWidthAxis(p, !!data.get('axis2'));
  for (const m of [...ms].reverse()) if (data.get(`del${ms.indexOf(m)}`)) deleteMaster(p, m.id);
  const nn = String(data.get('newName') || '').trim();
  if (nn) {
    const loc = Number(data.get('newLoc'));
    const l2 = Number(data.get('newLoc2'));
    addMaster(p, nn, Number.isFinite(loc) && String(data.get('newLoc')).trim() !== '' ? Math.round(loc) : 700,
      p.axis2 && String(data.get('newLoc2') || '').trim() !== '' && Number.isFinite(l2) ? Math.round(l2) : undefined);
  }
  if (p.masters) {
    p.axis.min = Math.min(...p.masters.map((m) => m.loc));
    p.axis.max = Math.max(...p.masters.map((m) => m.loc));
    if (p.axis2) {
      p.axis2.min = Math.min(...p.masters.map((m) => m.loc2));
      p.axis2.max = Math.max(...p.masters.map((m) => m.loc2));
    }
  }
  app.history.clear();
  markChanged();
  renderAll();
  if (app.mode === 'editor') { renderEditorOptions(); renderGlyphPanel(); }
  if (app.mode === 'grid') renderGridOptions();
  renderPreviewText();
}

// The project for a variable font: every master's full outline (with
// components and composed letters) in glyph.layers, its contours in the
// default's point order.
// Smart parts back to their base drawing (before blending masters).
function settleSmart() {
  for (const g of app.project.glyphs) if (editingState(g)) editState(g, null);
}

function variableJSON() {
  settleSmart();
  const p = app.project;
  const q = saveForm(p);
  refreshComponents(q); recompose(q);
  const full = (g) => [...g.contours.filter((c) => !c.brush), ...(g.refContours || [])];
  const def = new Map(q.glyphs.map((g) => [g.name, full(g)]));
  const out = { ...q, glyphs: q.glyphs.map((g) => ({ ...g, layers: {} })) };
  const byName = new Map(out.glyphs.map((g) => [g.name, g]));
  for (const m of p.masters.slice(1)) {
    const inst = instanceAt(p, m.loc, undefined, m.loc2);
    refreshComponents(inst); recompose(inst);
    for (const g of inst.glyphs) {
      const base = def.get(g.name) || [];
      const cs = full(g).map((c, i) => (base[i] && matchContour(base[i], c)) || c);
      byName.get(g.name).layers[m.id] = { contours: cs, advance: g.advance };
    }
  }
  return serialize(out);
}

async function exportVariable() {
  if (!hasMasters(app.project)) return;
  try {
    const r = await fetch('/api/export?format=variable', {
      method: 'POST', headers: { 'X-Spline': '1', 'Content-Type': 'application/json' }, body: variableJSON(),
    });
    if (!r.ok) throw new Error(await r.text());
    const name = safeFileName('-VF.ttf');
    download(await r.blob(), name);
    toast(t('exported', { name }));
  } catch (err) {
    toast(`${t('previewError')}: ${err.message}`, 'error');
  }
}

// Instances: every master plus the steps between them, each a font file.
async function exportInstances() {
  settleSmart();
  const p = app.project;
  if (!hasMasters(p)) return;
  const ms = [...p.masters].sort((a, b) => a.loc - b.loc);
  const names = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
  const def2 = p.masters[0].loc2;
  const list = ms.map((m) => [m.loc, m.name, m.loc2]);
  const seen = new Set(list.map(([l, , l2]) => `${l}/${l2}`));
  if (p.axis.tag === 'wght') {
    for (let w = 100; w <= 900; w += 100) {
      if (w > ms[0].loc && w < ms[ms.length - 1].loc && !seen.has(`${w}/${def2}`)) { seen.add(`${w}/${def2}`); list.push([w, names[w], def2]); }
    }
  }
  let n = 0;
  for (const [loc, name, loc2] of list.sort((a, b) => a[0] - b[0])) {
    const q = instanceAt(p, loc, name, loc2);
    refreshComponents(q); recompose(q);
    try {
      const r = await fetch('/api/export?format=ttf', { method: 'POST', headers: { 'X-Spline': '1', 'Content-Type': 'application/json' }, body: serialize(q) });
      if (!r.ok) throw new Error(await r.text());
      download(await r.blob(), safeFileName(`-${name.replace(/\s+/g, '')}.ttf`));
      n++;
    } catch (err) { toast(`${name}: ${err.message}`, 'error'); }
  }
  toast(t('msExported', { n }));
}

// ================================================================ colour fonts

// Contours of g by colour, in the order the colours first appear (as the
// font draws them): [[paint, contours], ...]; 0 is the text colour.
function paintGroups(g) {
  const map = new Map();
  if (g.refContours?.length) map.set(0, [...g.refContours]);
  for (const c of g.contours) {
    const k = c.paint && c.paint <= (app.project.palette?.length || 0) ? c.paint : 0;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  return [...map];
}
app.paintGroups = paintGroups;

const DEFAULT_PALETTE = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#8E24AA'];

function paintSection(g) {
  const pal = app.project.palette || [];
  const sw = (i) => `<div class="pn-sw">
      <button type="button" class="swatch" data-paint="${i + 1}" style="background:${esc(pal[i])}" aria-label="${esc(t('pnUse'))} ${esc(pal[i])}" data-tip="${esc(t('pnUse'))}"></button>
      <input type="color" data-paint-edit="${i}" value="${esc(pal[i].slice(0, 7))}" aria-label="${esc(t('pnEdit'))}" data-tip="${esc(t('pnEdit'))}"></div>`;
  return section('paint', t('pnTitle'), `
    <div class="pn-row">
      <button type="button" class="swatch none" data-paint="0" aria-label="${esc(t('pnNone'))}" data-tip="${esc(t('pnNone'))}"></button>
      ${pal.map((_, i) => sw(i)).join('')}
      <button type="button" class="btn btn-icon" data-paint-add aria-label="${esc(t('pnAdd'))}" data-tip="${esc(t('pnAdd'))}">${icon('plus', 14)}</button>
    </div>`, !!g.contours.some((c) => c.paint), t('pnHint'));
}

// Paints the shapes with selected points (with their holes), or the whole
// glyph. paint 0 = the text colour.
function setPaint(paint) {
  const g = app.current;
  if (!g || !g.contours.length) return;
  const picked = new Set([...editor.sel].map((k) => Number(k.split(':')[0])));
  const idx = picked.size ? shapesOf(g.contours, picked).flat() : g.contours.map((_, i) => i);
  app.history.push(g);
  for (const i of idx) { if (paint) g.contours[i].paint = paint; else delete g.contours[i].paint; }
  editor.afterEdit(false);
  renderGlyphPanel();
}

function paintClick(e) {
  const b = e.target.closest('[data-paint]'), add = e.target.closest('[data-paint-add]');
  if (add) {
    const pal = (app.project.palette ||= []);
    pal.push(DEFAULT_PALETTE[pal.length % DEFAULT_PALETTE.length]);
    markChanged();
    renderGlyphPanel();
    return true;
  }
  if (!b) return false;
  if (!app.project.palette?.length && Number(b.dataset.paint) > 0) return true;
  setPaint(Number(b.dataset.paint));
  return true;
}

// ================================================================ filters

// Shape filters: a kind, its value, a live dashed preview on the canvas and
// Apply. They work on the contours with selected points, or the whole glyph.
const FILTERS = {
  offset: { min: -100, max: 100, def: 20, unit: '', overlap: true },
  round: { min: 2, max: 200, def: 40, unit: '' },
  stroke: { min: 2, max: 200, def: 40, unit: '', overlap: true },
  fit: { min: 20, max: 100, def: 55, unit: '%' },
};
// `active`: the preview shows only after the user touches the filter.
const filterState = { kind: 'offset', values: {}, overlap: true, active: false, preview: true };
const filterValue = (k) => filterState.values[k] ?? FILTERS[k].def;

function filterInput(g) {
  const picked = new Set([...editor.sel].map((key) => Number(key.split(':')[0])));
  const idx = g.contours.map((_, i) => i).filter((i) => !picked.size || picked.has(i));
  return { idx, contours: idx.map((i) => g.contours[i]) };
}

function runFilter(contours) {
  const k = filterState.kind, v = filterValue(k);
  let out = { offset: () => offsetContours(contours, v), round: () => roundCorners(contours, v), stroke: () => strokeContours(contours, v), fit: () => fitCurves(contours, v) }[k]();
  // With masters the points must stay the same for blending, so overlaps stay.
  if (FILTERS[k].overlap && filterState.overlap && !hasMasters(app.project)) { try { out = removeOverlap(out); } catch { /* keep as is */ } }
  return out;
}

function previewFilter() {
  const g = app.current;
  if (!app.extended || app.mode !== 'editor' || !g || !filterState.active || !filterState.preview) { editor.preview = null; editor.render(); return; }
  const { contours } = filterInput(g);
  try { editor.preview = contours.length ? runFilter(contours) : null; } catch { editor.preview = null; }
  editor.render();
}

app.onPreviewCancel = () => { filterState.active = false; };

// Filter menu: each filter in its own dialog, as in Photoshop: its value,
// Preview at the bottom, Cancel / Apply. The canvas shows the result live.
async function openFilter(kind) {
  endTransform();
  if (app.mode !== 'editor' || !app.current) return;
  const f = FILTERS[kind];
  filterState.kind = kind;
  filterState.active = true;
  const v = filterValue(kind);
  const data = await showDialog({
    title: t('fl_' + kind),
    cls: 'filter-dlg',
    body: `<label class="prop"><span>${esc(t('fl_' + kind + 'Value'))}</span><span class="with-unit">
        <input type="range" data-fl="value" min="${f.min}" max="${f.max}" step="1" value="${v}">
        <input type="number" data-fl="value" min="${f.min}" max="${f.max}" step="1" value="${v}">${f.unit ? `<em>${f.unit}</em>` : ''}</span></label>
      ${f.overlap && !hasMasters(app.project) ? `<label class="check"><input type="checkbox" data-fl="overlap" ${filterState.overlap ? 'checked' : ''}>${esc(t('flOverlap'))}</label>` : ''}
      <label class="check fl-preview"><input type="checkbox" data-fl="preview" ${filterState.preview ? 'checked' : ''}>${esc(t('flPreview'))}</label>`,
    okLabel: t('flApply'),
    onOpen: (dlg) => {
      const on = (e) => {
        const el = e.target;
        if (el.dataset.fl === 'preview') { filterState.preview = el.checked; previewFilter(); return; }
        if (el.dataset.fl === 'overlap') { filterState.overlap = el.checked; previewFilter(); return; }
        if (el.dataset.fl !== 'value') return;
        const x = Math.max(f.min, Math.min(f.max, Math.round(Number(el.value))));
        if (!Number.isFinite(x)) return;
        filterState.values[kind] = x;
        dlg.querySelectorAll('[data-fl="value"]').forEach((o) => { if (o !== el) o.value = x; });
        previewFilter();
      };
      dlg.addEventListener('input', on);
      dlg.addEventListener('change', on);
      previewFilter();
    },
  });
  if (data) applyFilter();
  filterState.active = false;
  editor.preview = null;
  editor.render();
}

function applyFilter() {
  endTransform();
  const g = app.current;
  if (!g) return;
  const { idx, contours } = filterInput(g);
  if (!contours.length) { toast(t('flNothing'), 'error'); return; }
  let out;
  try { out = runFilter(contours); } catch (err) { toast(err.message, 'error'); return; }
  app.history.push(g);
  const keep = g.contours.filter((_, i) => !idx.includes(i));
  g.contours = [...keep, ...out];
  // Weight on the whole glyph keeps its sidebearings: the width grows too.
  if (filterState.kind === 'offset' && !keep.length) {
    const d = filterValue('offset');
    translateGlyph(g, d, 0);
    g.advance = Math.max(0, g.advance + 2 * d);
  }
  editor.sel.clear();
  editor.preview = null;
  filterState.active = false;
  editor.afterEdit();
  toast(t('flApplied', { name: t('fl_' + filterState.kind) }));
}

// Transform Metrics: width and sidebearings for many glyphs at once.
async function transformMetricsDialog() {
  const sel = app.mode === 'editor' ? [app.current] : selectedGlyphs();
  if (!sel.length) { toast(t('ulPickGlyph'), 'error'); return; }
  const row = (k) => `<div class="field-row tm-row"><span>${esc(t(k === 'advance' ? 'width' : k))}</span>
    <select name="${k}Mode"><option value="keep">${esc(t('tmKeep'))}</option><option value="set">${esc(t('tmSet'))}</option><option value="add">${esc(t('tmAdd'))}</option></select>
    <input type="number" name="${k}" step="1" value="0"></div>`;
  const data = await showDialog({
    title: t('tmTitle', { n: sel.length }),
    body: `${row('lsb')}${row('rsb')}${row('advance')}
      <label class="check"><input type="checkbox" name="center">${esc(t('tmCenter'))}</label>`,
    okLabel: t('flApply'),
  });
  if (!data) return;
  let n = 0;
  for (const g of sel) {
    const before = JSON.stringify([g.contours, g.advance]);
    app.history.push(g);
    for (const k of ['lsb', 'rsb', 'advance']) {
      const mode = data.get(k + 'Mode'), v = Number(data.get(k)) || 0;
      if (mode === 'keep') continue;
      const now = sides(g)[k];
      if (now === null) continue;
      setMetric(g, k, mode === 'set' ? v : now + v);
    }
    if (data.get('center')) {
      const sd = sides(g);
      if (sd.lsb !== null) setMetric(g, 'lsb', (sd.lsb + sd.rsb) / 2);
    }
    if (JSON.stringify([g.contours, g.advance]) !== before) { n++; updateTile(g); }
  }
  markChanged();
  if (app.mode === 'editor') { editor.render(); updateMetricInputs(); } else { renderInspector(); renderSideMetrics(); }
  toast(t('btDone', { n }));
}

// ================================================================ components

function componentsSection(g) {
  const label = (name) => { const x = findGlyph(name); return x ? (charOf(x).trim() || x.name) : name; };
  const rows = (g.components || []).map((k, i) => `<div class="cm-row">
      <button class="btn cm-name" type="button" data-cm-open="${esc(k.glyph)}" data-tip="${esc(t('cmOpenTip'))}">${esc(label(k.glyph))}</button>
      <label><span>X</span><input type="number" step="1" data-cmpos="${i}:x" value="${Math.round(k.x)}"></label>
      <label><span>Y</span><input type="number" step="1" data-cmpos="${i}:y" value="${Math.round(k.y)}"></label>
      <button class="btn btn-icon" type="button" data-cm-remove="${i}" aria-label="${esc(t('cmRemove'))}" data-tip="${esc(t('cmRemove'))}">${icon('close', 14)}</button>
    </div>${smartSliders(k, i)}`).join('');
  const users = usedBy(app.project, g.name);
  return section('components', t('cmTitle'), `
    ${rows}
    <div class="btn-row">
      <button class="btn" type="button" data-cmd="cmAdd" data-tip="${esc(t('cmHint'))}">${icon('plus', 15)}<span>${esc(t('cmAddShort'))}</span></button>
      <button class="btn" type="button" data-cmd="cmDecompose" data-tip="${esc(t('cmDecomposeTip'))}" ${g.components?.length ? '' : 'disabled'}>${esc(t('cmDecompose'))}</button>
    </div>
    ${users.length ? `<div class="sub-head">${esc(t('cmUsedBy'))}</div><div class="cm-users">${users.map((u) => `<button class="btn" type="button" data-cm-open="${esc(u.name)}">${esc(charOf(u).trim() || u.name)}</button>`).join('')}</div>` : ''}`,
  !!(g.components?.length || users.length), t('cmHint'));
}

function componentClick(e) {
  const open = e.target.closest('[data-cm-open]'), rm = e.target.closest('[data-cm-remove]');
  if (open) { openEditor(open.dataset.cmOpen); return true; }
  if (!rm) return false;
  const g = app.current;
  app.history.push(g);
  g.components.splice(Number(rm.dataset.cmRemove), 1);
  if (!g.components.length) delete g.components;
  markChanged();
  afterGlyphChange(g);
  return true;
}

function moveComponent(spec, v) {
  const g = app.current;
  const [i, axis] = spec.split(':');
  const k = g?.components?.[Number(i)];
  if (!k || !Number.isFinite(v)) return;
  app.history.push(g);
  k[axis] = Math.round(v);
  markChanged();
  updateMetricInputs();
  editor.render();
}

// Adds a glyph as a component. A mark goes over the middle of what is
// already drawn, raised for capitals, like the automatic letters.
async function addComponentDialog() {
  const g = app.current;
  if (!g) return;
  const opts = app.project.glyphs.filter((x) => x !== g).map((x) => `<option value="${esc(charOf(x).trim() || x.name)}">${esc(x.name)}</option>`).join('');
  const data = await showDialog({
    title: t('cmAddTitle'),
    body: `<label class="field">${esc(t('cmAddLabel'))}<input type="text" name="glyph" list="cmList" required autocomplete="off" placeholder="A, uni0410, grave"></label>
      <datalist id="cmList">${opts}</datalist>`,
    okLabel: t('cmAddShort'),
  });
  if (!data) return;
  const ref = String(data.get('glyph')).trim();
  const src = findGlyph(ref) || ([...ref].length === 1 ? app.project.glyphs.find((x) => x.unicode === ref.codePointAt(0)) : null);
  if (!src || src === g) { toast(t('cmNotFound', { name: ref }), 'error'); return; }
  if (src.components?.some((k) => k.glyph === g.name)) { toast(t('cmLoop'), 'error'); return; }
  let x = 0, y = 0;
  // An automatic letter (compose.js) becomes one built from components.
  const wasAuto = !!g.compose;
  app.history.push(g);
  if (wasAuto) g.contours = [];
  const box = glyphBox(g), sb = glyphBox(src);
  if (box && sb) {
    // Something is there already: centre the new part over it.
    x = Math.round((box.minX + box.maxX) / 2 - (sb.minX + sb.maxX) / 2);
    const ch = charOf(g);
    const mark = /\p{Sk}|\p{Mn}/u.test(charOf(src));
    const fi = app.project.info;
    if (mark && ch && ch === ch.toUpperCase() && ch !== ch.toLowerCase()) y = fi.capHeight - fi.xHeight;
  }
  // Anchors win over the guess: the mark's _top onto the letter's top.
  const baseComp = g.components?.[0] && findGlyph(g.components[0].glyph);
  const at = baseComp && attachOffset(baseComp, src);
  if (at) { x = Math.round(at.dx + g.components[0].x); y = Math.round(at.dy + g.components[0].y); }
  (g.components ||= []).push({ glyph: src.name, x, y });
  if (!box) g.advance = src.advance;
  delete g.compose;
  g.composeOff = true;
  markChanged();
  afterGlyphChange(g);
}

function decomposeCurrent() {
  const g = app.current;
  if (!g?.components?.length) return;
  app.history.push(g);
  decompose(g);
  editor.afterEdit();
  renderGlyphPanel();
  toast(t('cmDecomposed'));
}

// ================================================================ smart parts

function smartSliders(k, i) {
  const src = findGlyph(k.glyph);
  if (!isSmart(src)) return '';
  return src.smart.props.map((pr) => {
    const v = k.props?.[pr.name] ?? pr.min;
    return `<label class="prop sm-slider"><span>${esc(pr.name)}</span><span class="with-unit">
      <input type="range" data-cmprop="${i}:${esc(pr.name)}" min="${pr.min}" max="${pr.max}" step="1" value="${v}"><output class="mono">${v}</output></span></label>`;
  }).join('');
}

// Dragging a slider shows the change live; the release makes one undo step.
let compPropSaved = false;
function setCompProp(spec, v, commit) {
  const g = app.current;
  const [i, name] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];
  const k = g?.components?.[Number(i)];
  if (!k || !Number.isFinite(v)) return;
  if (!compPropSaved) { app.history.push(g); compPropSaved = true; }
  (k.props ||= {})[name] = v;
  refreshComponents(app.project);
  editor.render();
  const out = panelQuery(`[data-cmprop="${CSS.escape(spec)}"]`)?.nextElementSibling;
  if (out) out.textContent = v;
  if (commit) { compPropSaved = false; markChanged(); updateMetricInputs(); }
}

// A glyph can become a smart part when it is a part: "_name", not exported or used by others.
function canBeSmart(g) {
  return !!g && (isSmart(g) || g.name.startsWith('_') || g.noExport || usedBy(app.project, g.name).length > 0);
}

function smartSection(g) {
  if (!isSmart(g)) {
    if (!canBeSmart(g)) return '';
    return section('smart', t('smTitle'), `
      <button class="btn btn-block" type="button" data-cmd="smAdd">${icon('plus', 15)}<span>${esc(t('smAddProp'))}</span></button>`, false, t('smHint'));
  }
  const ed = editingState(g);
  const bad = smartProblems(g);
  const st = (name, label) => `<button type="button" role="radio" data-sm-state="${esc(name)}" aria-checked="${(ed || '') === name}">${esc(label)}</button>`;
  return section('smart', t('smTitle'), `
    <div class="sub-head">${esc(t('smDrawing'))}</div>
    <div class="seg seg-wrap sm-states" role="radiogroup">${st('', t('smBase'))}${g.smart.props.map((pr) => st(pr.name, pr.name)).join('')}</div>
    ${bad.length ? `<div class="compose-note warn"><p>${esc(t('smIncompat', { list: bad.map((b) => b.name).join(', ') }))}</p></div>` : ''}
    ${g.smart.props.map((pr) => `<div class="cm-row sm-row">
      <span class="an-name">${esc(pr.name)}</span>
      <label><span>↓</span><input type="number" data-sm-range="${esc(pr.name)}:min" value="${pr.min}" aria-label="${esc(t('smMin'))}"></label>
      <label><span>↑</span><input type="number" data-sm-range="${esc(pr.name)}:max" value="${pr.max}" aria-label="${esc(t('smMax'))}"></label>
      <button class="btn btn-icon" type="button" data-sm-remove="${esc(pr.name)}" aria-label="${esc(t('smRemove'))}" data-tip="${esc(t('smRemove'))}">${icon('close', 14)}</button>
    </div>`).join('')}
    <button class="btn btn-block" type="button" data-cmd="smAdd">${icon('plus', 15)}<span>${esc(t('smAddProp'))}</span></button>`, true, t('smHint'));
}

function afterSmartChange(g) {
  app.history.clear(); // undo steps hold the drawing of one state
  refreshComponents(app.project);
  markChanged();
  editor.sel.clear();
  editor.render();
  renderGlyphPanel();
}

function smartClick(e) {
  const g = app.current;
  const st = e.target.closest('[data-sm-state]'), rm = e.target.closest('[data-sm-remove]');
  if (!g || (!st && !rm)) return false;
  endTransform();
  if (st) { if (editState(g, st.dataset.smState || null)) afterSmartChange(g); }
  else { removeProp(g, rm.dataset.smRemove); afterSmartChange(g); }
  return true;
}

function setPropRange(spec, value) {
  const g = app.current;
  const [name, end] = [spec.slice(0, spec.lastIndexOf(':')), spec.slice(spec.lastIndexOf(':') + 1)];
  const pr = g?.smart?.props.find((x) => x.name === name);
  const v = Number(value);
  if (!pr || !Number.isFinite(v)) return;
  pr[end] = Math.round(v);
  refreshComponents(app.project);
  markChanged();
}

async function addPropDialog() {
  const g = app.current;
  if (!g) return;
  const data = await showDialog({
    title: t('smAddProp'),
    body: `<label class="field">${esc(t('smName'))}<input type="text" name="name" required maxlength="24" placeholder="${esc(t('smNamePh'))}"></label>
      <div class="field-row"><label class="field">${esc(t('smMin'))}<input type="number" name="min" value="0"></label>
      <label class="field">${esc(t('smMax'))}<input type="number" name="max" value="100"></label></div>`,
    okLabel: t('add'),
  });
  if (!data) return;
  const name = String(data.get('name')).trim();
  const min = Math.round(Number(data.get('min')) || 0), max = Math.round(Number(data.get('max')) || 100);
  if (!name || max === min) return;
  endTransform();
  if (!addProp(g, name, min, max)) { toast(t('smTaken', { name }), 'error'); return; }
  editState(g, name); // draw the new state right away
  afterSmartChange(g);
  toast(t('smDrawNow', { name }));
}

// ================================================================ anchors

const ANCHOR_LABEL = { top: 'anTop', bottom: 'anBottom', _top: 'anMarkTop', _bottom: 'anMarkBottom', entry: 'anEntry', exit: 'anExit' };

function anchorsSection(g) {
  const rows = (g.anchors || []).map((a, i) => `<div class="cm-row">
      <span class="an-name" data-tip="${esc(t((ANCHOR_LABEL[a.name] || 'anCustom') + 'Tip'))}">${esc(a.name)}</span>
      <label><span>X</span><input type="number" step="1" data-anpos="${i}:x" value="${Math.round(a.x)}"></label>
      <label><span>Y</span><input type="number" step="1" data-anpos="${i}:y" value="${Math.round(a.y)}"></label>
      <button class="btn btn-icon" type="button" data-an-remove="${i}" aria-label="${esc(t('anRemove'))}" data-tip="${esc(t('anRemove'))}">${icon('close', 14)}</button>
    </div>`).join('');
  const add = suggestedAnchors(g).map((n) => `<button class="btn" type="button" data-an-add="${n}" data-tip="${esc(t(ANCHOR_LABEL[n] + 'Tip'))}">${esc(t(ANCHOR_LABEL[n]))}</button>`).join('');
  return section('anchors', t('anTitle'), `
    ${rows}
    ${add ? `<div class="sub-head">${esc(t('anAdd'))}</div><div class="ag-presets">${add}</div>` : ''}
    <button class="btn btn-block" type="button" data-cmd="anAuto" data-tip="${esc(t('anAutoTip'))}">${icon('check', 15)}<span>${esc(t('anAuto'))}</span></button>`, !!g.anchors?.length, t('anHint'));
}

function anchorsChanged(g) {
  markChanged();
  editor.render();
  renderGlyphPanel();
}

function anchorClick(e) {
  const g = app.current;
  const add = e.target.closest('[data-an-add]'), rm = e.target.closest('[data-an-remove]');
  if (!g || (!add && !rm)) return false;
  app.history.push(g);
  if (add) (g.anchors ||= []).push(defaultAnchor(g, add.dataset.anAdd));
  else {
    g.anchors.splice(Number(rm.dataset.anRemove), 1);
    if (!g.anchors.length) delete g.anchors;
  }
  anchorsChanged(g);
  return true;
}

function setAnchorValue(spec, v) {
  const g = app.current;
  const [i, axis] = spec.split(':');
  const a = g?.anchors?.[Number(i)];
  if (!a || !Number.isFinite(Number(v))) return;
  app.history.push(g);
  a[axis] = Math.round(Number(v));
  anchorsChanged(g);
}

// Puts the usual anchors on the open glyph: top and bottom on letters,
// _top on marks. Existing anchors stay where they are.
function autoAnchors() {
  const g = app.current;
  if (!g) return;
  // A mark below the baseline half (cedilla, ogonek) attaches at the bottom.
  const box = glyphBox(g);
  const below = box && box.maxY < app.project.info.xHeight / 2;
  const names = (isMarkGlyph(g) ? [below ? '_bottom' : '_top'] : ['top', 'bottom']).filter((n) => !anchorOf(g, n));
  if (!names.length) { toast(t('anNothing')); return; }
  app.history.push(g);
  for (const n of names) (g.anchors ||= []).push(defaultAnchor(g, n));
  anchorsChanged(g);
  toast(t('anAdded', { list: names.join(', ') }));
}

// Snapshots: saved versions of a glyph to come back to (extended mode).
function saveSnapshot() {
  const g = app.current;
  if (!g) return;
  const list = (g.snapshots ||= []);
  const time = new Date().toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' });
  list.push({ name: `${t('snapName')} ${list.length + 1} · ${time}`, contours: structuredClone(g.contours), advance: g.advance });
  if (list.length > 20) list.shift();
  markChanged();
  renderGlyphPanel();
}

function snapshotClick(e) {
  const g = app.current;
  const r = e.target.closest('[data-snap-restore]'), d = e.target.closest('[data-snap-delete]');
  if (!g || (!r && !d)) return false;
  const i = Number((r || d).dataset[r ? 'snapRestore' : 'snapDelete']);
  const sn = g.snapshots?.[i];
  if (!sn) return true;
  if (r) {
    app.history.push(g);
    g.contours = structuredClone(sn.contours);
    g.advance = sn.advance;
    editor.sel.clear();
    editor.afterEdit(false);
    toast(t('snapRestored', { name: sn.name }));
  } else {
    g.snapshots.splice(i, 1);
    if (!g.snapshots.length) delete g.snapshots;
    markChanged();
  }
  renderGlyphPanel();
  return true;
}

function evenHandles() {
  endTransform();
  if (app.mode === 'editor' && !editor.evenHandles()) toast(t('evenHandlesHint'), 'error');
}

function setSelectShape(shape) {
  editor.selectShape = shape;
  store.set('spline.selectShape', shape);
  renderToolbar();
}

// Ctrl+arrows in the kerning line (extended mode).
function spaceInLine(role, delta) {
  kernView.layout();
  const it = kernView.items[role === 'lsb' ? kernView.cursor : kernView.cursor - 1];
  const g = it?.g;
  const box = g && glyphBox(g);
  if (!box) return;
  app.history.push(g);
  setMetric(g, role, (role === 'lsb' ? box.minX : g.advance - box.maxX) + delta);
  markChanged();
  kernView.render();
  renderKernPanel();
}

function addExtremes() {
  endTransform();
  if (app.mode !== 'editor') return;
  const n = editor.addExtremes();
  toast(n ? t('extremesAdded', { n }) : t('extremesNone'));
}

function makeFirst() {
  endTransform();
  if (app.mode === 'editor' && !editor.makeFirst()) toast(t('makeFirstHint'), 'error');
}

function alignPoints() {
  endTransform();
  if (app.mode === 'editor' && !editor.alignPoints()) toast(t('alignPointsHint'), 'error');
}

// ================================================================ letters from parts

const glyphByChar = (ch) => app.project.glyphs.find((x) => x.unicode === ch.codePointAt(0));
const composeState = (g) => (g.compose ? 'auto' : g.composeOff ? 'manual' : 'none');

// Й = И + ˘: tells how the letter is made and offers the other way.
function mastersNoteHTML(g) {
  const bad = app.extended ? problems(app.project, g) : [];
  if (!bad.length) return '';
  const name = (id) => app.project.masters.find((m) => m.id === id)?.name || id;
  return `<div class="compose-note warn" data-tip="${esc(t('msIncompatTip'))}"><p>${esc(t('msIncompat', { list: bad.map((b) => `${name(b.id)} (${t('msWhy_' + b.why)})`).join(', ') }))}</p></div>`;
}

function composeNoteHTML(g) {
  const ms = mastersNoteHTML(g);
  if (ms) return ms;
  if (app.extended && (isCornerGlyph(g) || isBrushGlyph(g))) {
    return `<div class="compose-note"><p>${esc(t(isCornerGlyph(g) ? 'ptCornerGlyphHint' : 'ptBrushGlyphHint'))}</p></div>`;
  }
  if (g.components?.length) return ''; // built from components by hand
  const info = composeInfo(app.project, g);
  if (!info) return '';
  const parts = [info.baseChar, ...info.markChars].join(' + ');
  const note = (text, buttons = '') => `<div class="compose-note" data-compose="${composeState(g)}">
    <p>${esc(text)}</p>${buttons}</div>`;
  if (g.compose) {
    return note(t('cmpAuto', { parts }),
      `<button class="btn btn-block" type="button" data-cmd="composeOff">${icon('pen', 15)}<span>${esc(t('cmpManual'))}</span></button>`);
  }
  if (g.composeOff || g.contours.length) {
    if (info.missing.length) return '';
    return note(t('cmpCan', { parts }),
      `<button class="btn btn-block" type="button" data-cmd="composeOn">${icon('check', 15)}<span>${esc(t('cmpOn'))}</span></button>`);
  }
  return note(t('cmpWait', { parts }), info.missing.map((ch) => `<button class="btn btn-block" type="button" data-make-glyph="${esc(ch)}">
    ${icon(glyphByChar(ch) ? 'pen' : 'plus', 15)}<span>${esc(t(glyphByChar(ch) ? 'cmpDraw' : 'cmpCreate', { ch }))}</span></button>`).join(''));
}

function setComposed(on) {
  const g = app.mode === 'editor' ? app.current : selectedGlyphs()[0];
  if (!g) return;
  app.history.push(g); // a composed letter becomes a hand-drawn one here
  if (on) { delete g.composeOff; g.contours = []; }
  if (app.mode === 'editor') editor.sel.clear();
  markChanged(); // builds the letter again when it is composed
  afterGlyphChange(g);
}

// Opens a letter, adding it to the font first when needed.
function makeGlyph(ch) {
  let g = glyphByChar(ch);
  if (!g) { g = addGlyphForChar(app.project, ch); markChanged(); }
  if (g) openEditor(g.name);
}

function afterGlyphChange(g) {
  if (app.mode === 'editor') {
    renderGlyphPanel();
    updateMetricInputs();
    editor.render();
  } else {
    updateTile(g);
    renderInspector();
    renderSideMetrics();
  }
}

// ================================================================ simplify

// Removes points that do not change the shape: in the editor from the
// contours with selected points (or the whole letter), in the grid from
// every selected letter.
function simplifyGlyphs() {
  endTransform();
  const tol = Math.max(1, app.project.info.unitsPerEm * 0.0015);
  let removed = 0;
  if (app.mode === 'editor') {
    const g = app.current;
    const picked = new Set([...editor.sel].map((k) => Number(k.split(':')[0])));
    const contours = picked.size ? g.contours.filter((_, i) => picked.has(i)) : g.contours;
    const copy = structuredClone(contours);
    removed = simplifyContours(copy, tol);
    if (removed) {
      app.history.push(g);
      const idx = contours.map((c) => g.contours.indexOf(c));
      idx.forEach((ci, k) => { g.contours[ci] = copy[k]; });
      editor.sel.clear();
      editor.afterEdit();
    }
  } else {
    for (const g of selectedGlyphs()) {
      const copy = structuredClone(g.contours);
      const n = simplifyContours(copy, tol);
      if (!n) continue;
      app.history.push(g);
      g.contours = copy;
      removed += n;
      updateTile(g);
    }
    if (removed) { markChanged(); renderInspector(); }
  }
  toast(removed ? t('simplified', { n: removed }) : t('simplifyNothing'));
}

// ================================================================ underlay

// A scan or photo under the outline to trace over. Kept in the project,
// never exported. Large pictures are scaled down so the file stays small.
const UL_MAX = 1600;

function underlayTarget() {
  if (app.mode === 'editor') return app.current;
  return app.selected.size === 1 ? findGlyph([...app.selected][0]) : null;
}

async function loadPicture(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url; });
    const k = Math.min(1, UL_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    let data;
    if (file.type === 'image/png' || file.type === 'image/gif') {
      ctx.drawImage(img, 0, 0, w, h);
      data = cv.toDataURL('image/png');
    }
    if (!data || data.length > 2e6) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      data = cv.toDataURL('image/jpeg', 0.85);
    }
    return { data, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Fits the picture between two metric lines, keeping its horizontal centre.
function placeUnderlay(g, kind, cx = g.image.x + g.image.w / 2) {
  const fi = app.project.info, im = g.image;
  const [bottom, top] = { x: [0, fi.xHeight], all: [fi.descender, fi.ascender] }[kind] || [0, fi.capHeight];
  const ratio = im.w / im.h;
  im.h = top - bottom;
  im.w = Math.round(im.h * ratio);
  im.y = bottom;
  im.x = Math.round(cx - im.w / 2);
}

async function setUnderlay(g, file) {
  if (!g) { toast(t('ulPickGlyph'), 'error'); return; }
  let pic;
  try { pic = await loadPicture(file); } catch { toast(t('ulError'), 'error'); return; }
  g.image = { data: pic.data, x: 0, y: 0, w: pic.w, h: pic.h, opacity: g.image?.opacity ?? 0.4 };
  const ch = charOf(g);
  placeUnderlay(g, ch && ch === ch.toLowerCase() && ch !== ch.toUpperCase() ? 'x' : 'cap', g.advance / 2);
  markChanged();
  afterGlyphChange(g);
  if (app.mode !== 'editor') toast(t('ulAdded', { ch: ch || g.name }));
}

function setUnderlayValue(key, v, commit) {
  const g = underlayTarget(), im = g?.image;
  if (!im || !Number.isFinite(v)) return;
  if (key === 'opacity') im.opacity = Math.min(1, Math.max(0.05, v / 100));
  if (key === 'x' || key === 'y') im[key] = Math.round(v);
  if (key === 'h' && v >= 1) { const r = im.w / im.h; im.h = Math.round(v); im.w = Math.round(im.h * r); }
  editor.render();
  if (commit) markChanged();
}

function fitUnderlay(kind) {
  const g = underlayTarget();
  if (!g?.image) return;
  placeUnderlay(g, kind);
  markChanged();
  afterGlyphChange(g);
}

function removeUnderlay() {
  const g = underlayTarget();
  if (!g?.image) return;
  delete g.image;
  markChanged();
  afterGlyphChange(g);
}

function underlaySection(g) {
  const im = g.image;
  const num = (k, label, v) => `<label><span>${esc(label)}</span><input type="number" step="1" data-ul="${k}" value="${Math.round(v)}"></label>`;
  return section('underlay', t('ulTitle'), im ? `
    <label class="prop"><span>${esc(t('ulOpacity'))}</span><input type="range" min="5" max="100" step="5" data-ul="opacity" value="${Math.round((im.opacity ?? 0.4) * 100)}"></label>
    <div class="xy-grid">${num('x', 'X', im.x)}${num('y', 'Y', im.y)}${num('h', t('h'), im.h)}</div>
    <div class="sub-head">${esc(t('ulFit'))}</div>
    <div class="btn-row">
      <button class="btn" type="button" data-cmd="ulFitCap">${esc(t('ulFitCap'))}</button>
      <button class="btn" type="button" data-cmd="ulFitX">${esc(t('ulFitX'))}</button>
    </div>
    <button class="btn btn-block" type="button" data-cmd="ulFitAll">${esc(t('ulFitAll'))}</button>
    <button class="btn btn-block" type="button" data-cmd="ulLoad">${icon('image', 15)}<span>${esc(t('ulReplace'))}</span></button>
    <button class="btn btn-block btn-danger" type="button" data-cmd="ulRemove">${icon('trash', 15)}<span>${esc(t('ulRemove'))}</span></button>`
    : `<button class="btn btn-block" type="button" data-cmd="ulLoad" data-tip="${esc(t('ulHint'))}">${icon('image', 15)}<span>${esc(t('ulLoad'))}</span></button>`, !!im);
}

// ================================================================ fonts: open TTF/OTF, install

const isFontFile = (f) => /\.(ttf|otf)$/i.test(f?.name || '');

// A ready font opens as a new project (not saved yet).
async function openFontFile(file, ask = false) {
  if (ask && app.dirty && !(await confirmDialog(t('confirmNew'), t('ok'), false))) return;
  try {
    const r = await fetch('/api/import-font', {
      method: 'POST', headers: { 'X-Spline': '1', 'Content-Type': 'application/octet-stream' }, body: file,
    });
    if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
    const { project, skipped } = await r.json();
    const p = validateProject(project);
    setProject(p);
    autosave();
    toast(t('fontOpened', { name: p.info.familyName, n: p.glyphs.length }) + (skipped ? ` ${t('fontSkipped', { n: skipped })}` : ''));
  } catch (err) {
    toast(t('openError', { err: err.message }), 'error');
  }
}

// Builds the font and installs it for the current user, so it shows up in
// Word, Photoshop and other programs.
async function installFont() {
  try {
    const r = await fetch('/api/install-font', {
      method: 'POST', headers: { 'X-Spline': '1', 'Content-Type': 'application/json' }, body: projectJSON(),
    });
    if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
    const { name } = await r.json();
    toast(t('installed', { name }));
  } catch (err) {
    toast(t('installError', { err: err.message }), 'error');
  }
}

// ================================================================ files

// The project as JSON for saving and export: the default master in place,
// components and composed letters rebuilt for it.
function projectJSON(p = app.project) {
  const q = saveForm(saveSmart(p));
  if (q !== p) { refreshComponents(q); recompose(q); }
  return serialize(q);
}

function projectBlob() { return new Blob([projectJSON()], { type: 'application/json' }); }

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
      const r = await fetch('/api/file', { method: 'PUT', headers: { 'X-Spline': '1', 'Content-Type': 'application/json' }, body: projectJSON() });
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
        types: [
          { description: 'Spline project', accept: { 'application/json': ['.sp', '.json'] } },
          { description: 'TrueType / OpenType', accept: { 'font/ttf': ['.ttf', '.otf'] } },
        ],
      });
      const file = await handle.getFile();
      if (isFontFile(file)) await openFontFile(file); else await openFile(file, handle);
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
  input.accept = { svg: '.svg,image/svg+xml', image: 'image/png,image/jpeg,image/webp,image/gif', font: '.ttf,.otf' }[mode]
    || '.sp,.json,.ttf,.otf,application/json';
  input.multiple = mode === 'svg';
  input.click();
}

$('fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const mode = e.target.dataset.mode;
  if (mode === 'svg') importSvgFiles(files);
  else if (mode === 'image') setUnderlay(underlayTarget(), files[0]);
  else if (isFontFile(files[0])) openFontFile(files[0], mode === 'font');
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
      method: 'POST', headers: { 'X-Spline': '1', 'Content-Type': 'application/json' }, body: projectJSON(),
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
  const pic = files.find((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
  if (pic) {
    const tile = e.target.closest?.('.tile');
    setUnderlay(tile ? findGlyph(tile.dataset.name) : underlayTarget(), pic);
    return;
  }
  const font = files.find(isFontFile);
  if (font) { openFontFile(font, true); return; }
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
  autoGroups, groups: () => groupsDialog(), newVariant, newLigature,
  xfReset, xfApply: () => editor.commitTransform(), xfCancel: () => editor.cancelTransform(),
  simplify: simplifyGlyphs, composeOff: () => setComposed(false), composeOn: () => setComposed(true),
  ulLoad: () => pickFiles('image'), ulRemove: removeUnderlay,
  ptExtremes: addExtremes, ptFirst: makeFirst, ptAlign: alignPoints, ptInvert: () => editor.invertSelection(),
  ptBreak: breakContour, ptJoin: joinContours, bgCopy: () => backgroundOp('copy'), bgSwap: () => backgroundOp('swap'),
  bgClear: () => backgroundOp('clear'),
  ptEven: evenHandles, snapSave: saveSnapshot, gvTiles: () => setGridView('tiles'), gvTable: () => setGridView('table'),
  duplicate: duplicateGlyphs, tmOpen: transformMetricsDialog, btExtremes: () => batch('extremes'), btRound: () => batch('round'), btMetrics: () => batch('metrics'),
  btDecompose: () => batch('decompose'), btExportOff: () => batch('exportOff'), btExportOn: () => batch('exportOn'), cmAdd: addComponentDialog, cmDecompose: decomposeCurrent,
  anAuto: autoAnchors, smAdd: addPropDialog,
  snapMenu: () => { snapMenuOpen = !snapMenuOpen; renderEditorOptions(); },
  pxDraw: () => { editor.pixelErase = false; renderEditorOptions(); }, pxErase: () => { editor.pixelErase = true; renderEditorOptions(); },
  newCorner: () => newPartGlyph('corner'), newBrush: () => newPartGlyph('brush'),
  mastersDialog: () => mastersDialog(), exportInstances: () => exportInstances(),
  ulFitCap: () => fitUnderlay('cap'), ulFitX: () => fitUnderlay('x'), ulFitAll: () => fitUnderlay('all'),
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
  simplify: { run: simplifyGlyphs, when: () => app.mode === 'editor' || app.selected.size > 0 },
  exportTTF: { run: () => exportFont('ttf') }, exportOTF: { run: () => exportFont('otf') },
  exportWOFF: { run: () => exportFont('woff'), when: () => app.extended },
  exportWOFF2: { run: () => exportFont('woff2'), when: () => app.extended },
  specialForm: { run: () => specialFormDialog(), when: () => app.extended && (app.mode === 'editor' || app.selected.size === 1) },
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
  ...Object.fromEntries(TOOLS.map((tl) => [`tool.${tl.id}`, { run: () => setTool(tl.id), when: () => inEditorMode() && (!tl.ext || app.extended), label: () => toolName(tl.id) }])),
  ...Object.fromEntries(PATH_OPS.map((op) => [`op.${op.id}`, { run: () => runPathOp(op.id), when: inEditorMode, always: true, label: () => t(op.label) }])),
  autoSpacing: { run: () => glyphAction('spacing'), when: () => app.mode === 'editor' || app.selected.size > 0 },
  flipH: { run: () => applyTransform('flipH'), when: () => app.mode === 'editor' || app.selected.size > 0 },
  flipV: { run: () => applyTransform('flipV'), when: () => app.mode === 'editor' || app.selected.size > 0 },
  kernShowGroups: { run: () => toggleKernGroups(), when: () => app.mode === 'kern', label: () => t('kernShowGroups') },
  kernNextSample: { run: () => stepKernSample(1), when: () => app.mode === 'kern', label: () => t('kernNextSample') },
  kernPrevSample: { run: () => stepKernSample(-1), when: () => app.mode === 'kern', label: () => t('kernPrevSample') },
  newVariant: { run: newVariant, when: () => app.mode === 'editor' || app.selected.size === 1, label: () => t('varNewMenu') },
  newLigature: { run: newLigature, label: () => t('ligNewMenu') },
  shapeGroups: { run: shapeGroupsDialog, label: () => t('sgMenu') },
  invertSelection: { run: () => editor.invertSelection(), when: () => app.extended && inEditorMode() },
  selShapeCycle: { run: () => { setSelectShape(editor.selectShape === 'lasso' ? 'rect' : 'lasso'); setTool('select'); }, when: () => app.extended && inEditorMode() },
  addExtremes: { run: addExtremes, when: () => app.extended && inEditorMode() },
  makeFirst: { run: makeFirst, when: () => app.extended && inEditorMode() },
  alignPoints: { run: alignPoints, when: () => app.extended && inEditorMode() },
  updateMetrics: { run: updateAllMetrics, when: () => app.extended },
  breakContour: { run: breakContour, when: () => app.extended && inEditorMode() },
  joinContours: { run: joinContours, when: () => app.extended && inEditorMode() },
  bgCopy: { run: () => backgroundOp('copy'), when: () => app.extended && inEditorMode() },
  fontInfo: { run: editFontInfo }, groups: { run: () => groupsDialog(), label: () => t('kgTitle') }, shortcuts: { run: helpDialog, always: true },
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
    // Extended mode: Ctrl+arrows change the left side of the letter after
    // the cursor, Ctrl+Shift+arrows the right side of the letter before it.
    if (app.extended && mod && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      spaceInLine(e.shiftKey ? 'rsb' : 'lsb', e.key === 'ArrowLeft' ? -10 : 10);
      return;
    }
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
  if (app.extended && e.key === 'Tab' && !mod && !e.altKey && !editor.xform) {
    e.preventDefault();
    editor.selectStep(e.shiftKey ? -1 : 1);
    return;
  }
  if (app.extended && (mod || e.altKey) && !(mod && e.altKey) && /^arrow/.test(key)) {
    // Ctrl+arrows: by 100; Alt+arrows: points without their handles.
    const st = mod ? 100 : e.shiftKey ? 10 : 1;
    const d = { arrowleft: [-st, 0], arrowright: [st, 0], arrowup: [0, st], arrowdown: [0, -st] }[key];
    const ok = editor.xform ? editor.nudgeTransform(...d) : mod ? editor.nudge(...d) : editor.nudgeNodesOnly(...d);
    if (ok) e.preventDefault();
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
  if (!app.project.glyphs.some(hasOutline)) {
    msg.textContent = t('previewEmpty');
    $('previewOut').hidden = true;
    return;
  }
  const seq = ++previewSeq;
  try {
    let body = projectJSON();
    if (app.extended && hasMasters(app.project) && app.previewLoc !== undefined) {
      const q = instanceAt(app.project, app.previewLoc, undefined, app.previewLoc2);
      refreshComponents(q); recompose(q);
      body = serialize(q);
    }
    const r = await fetch('/api/export?format=ttf', {
      method: 'POST', headers: { 'X-Spline': '1', 'Content-Type': 'application/json' }, body,
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
// Extended mode: "*" in the preview text stands for the glyph open in the
// editor, so "HH*HH OO*OO" shows it between control letters.
function previewText() {
  const text = $('previewInput').value;
  const g = app.mode === 'editor' ? app.current : app.selected.size === 1 ? findGlyph([...app.selected][0]) : null;
  const cur = app.extended && g ? charOf(g) || charOf(variantBase(g) || g) : '';
  return cur ? text.replaceAll('*', cur) : text;
}

// Extended mode: switches for the features the font has (from special
// forms), applied to the preview with font-feature-settings.
const previewFeats = new Set();
let previewLang = '';
function renderPreviewFeatures() {
  const bar = $('previewFeats');
  if (!bar) return;
  const found = new Map();
  if (app.extended) for (const g of app.project.glyphs) { const f = formOf(g.name); if (f && !found.has(f.tag + (f.lang || ''))) found.set(f.tag + (f.lang || ''), f); }
  // Numerators and denominators also make fractions: "1/2" with frac on.
  if (found.has('numr') && found.has('dnom')) found.set('frac', { tag: 'frac', label: t('pfFrac') });
  const axis = app.extended && hasMasters(app.project) ? app.project.axis : null;
  if (!found.size && !axis) { bar.innerHTML = ''; bar.hidden = true; return; }
  bar.hidden = false;
  const loc = app.previewLoc ?? app.project.masters?.find((m) => m.id === activeId(app.project))?.loc;
  const axis2 = axis && app.project.axis2;
  const loc2 = app.previewLoc2 ?? app.project.masters?.find((m) => m.id === activeId(app.project))?.loc2;
  const axisHTML = (axis ? `<label data-tip="${esc(t('msPreviewTip'))}">${esc(axis.tag)}<input type="range" data-pf-axis="1" min="${axis.min}" max="${axis.max}" step="1" value="${loc}"><output class="mono">${loc}</output></label>` : '')
    + (axis2 && axis2.min < axis2.max ? `<label data-tip="${esc(t('msPreviewTip'))}">${esc(axis2.tag)}<input type="range" data-pf-axis="2" min="${axis2.min}" max="${axis2.max}" step="1" value="${loc2}"><output class="mono">${loc2}</output></label>` : '');
  const tags = [...found.values()].filter((f) => f.tag !== 'locl');
  const langs = [...found.values()].filter((f) => f.tag === 'locl');
  bar.innerHTML = axisHTML + (tags.length || langs.length ? `<span class="opt-label">${esc(t('pfTitle'))}</span>` : '')
    + tags.map((f) => `<label class="check" data-tip="${esc(f.tag)}"><input type="checkbox" data-pf="${f.tag}" ${previewFeats.has(f.tag) ? 'checked' : ''}>${esc(f.label)}</label>`).join('')
    + (langs.length ? `<label>${esc(t('pfLang'))}<select data-pf-lang><option value="">—</option>${langs.map((f) => `<option value="${f.lang}" ${previewLang === f.lang ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>` : '');
}

function applyPreviewFeatures() {
  const out = $('previewOut');
  out.style.fontFeatureSettings = [...previewFeats].map((f) => `"${f}" 1`).join(', ');
  out.lang = { BGR: 'bg', SRB: 'sr', MKD: 'mk', UKR: 'uk' }[previewLang] || '';
}

function renderPreviewText() {
  if (!app.project) return;
  renderPreviewFeatures();
  applyPreviewFeatures();
  const drawn = new Set(app.project.glyphs.filter((g) => hasOutline(g) || g.unicode === 32).map((g) => g.unicode));
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
  for (const ch of previewText()) {
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
    canAssociate: !!session?.canAssociate, associated: !!session?.associated, canInstall: !!session?.canInstall,
    web: !!session?.web, privacy: !!session?.privacy, // hosted website (spline --web)
    version: session?.version || '',
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
  if (!app.platform.web) {
    checkUpdates();
    setInterval(() => checkUpdates(), 3 * 3600 * 1000);
  }
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

// "v1.2.3" newer than "v1.2.0"?
function newerVersion(a, b) {
  const pa = /^v?(\d+)\.(\d+)\.(\d+)/.exec(a || ''), pb = /^v?(\d+)\.(\d+)\.(\d+)/.exec(b || '');
  if (!pa || !pb) return false;
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) > Number(pb[i]);
  return false;
}

// Checks GitHub for a newer release: at start, every few hours while the
// app is open, and from the Help menu. A badge in the status bar links to
// the release page.
async function checkUpdates(manual = false) {
  try {
    // The Go side keeps GitHub's answer for an hour, so asking often is cheap.
    const r = await fetch(`/api/update${manual ? '?force=1' : ''}`);
    if (!r.ok) throw new Error(await r.text());
    updateInfo = await r.json();
    if (updateInfo.error) throw new Error(updateInfo.error);
  } catch (err) {
    if (manual) toast(t('updateCheckFailed', { err: err.message }), 'error');
    return;
  }
  showUpdateBadge();
  if (manual && !updateAvailable()) toast(t('upToDate', { v: updateInfo.current }));
  if (manual && updateAvailable()) openUpdatePage();
}

const updateAvailable = () => !!updateInfo && newerVersion(updateInfo.latest, app.platform.version || updateInfo.current);

function showUpdateBadge() {
  const b = $('updateBadge');
  const show = updateAvailable();
  b.hidden = !show;
  if (show) {
    b.textContent = t('updateBadge', { v: updateInfo.latest.replace(/^v/, '') });
    b.dataset.tip = t('updateBadgeTip');
  }
}

// The latest release on GitHub: download the installer there.
function openUpdatePage() { openPage('releases'); }

$('updateBadge').addEventListener('click', openUpdatePage);

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
