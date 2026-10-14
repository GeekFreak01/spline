import { t, setLang, getLang, onLangChange, applyStatic } from './i18n.js';
import { icon, fillIcons } from './icons.js';
import { CATEGORIES, COLORS } from './glyphsets.js';
import {
  newProject, validateProject, serialize, addGlyphForChar, charOf, isDrawn, svgPath, glyphBox,
  translateGlyph, transformGlyph, normalizeDirections,
} from './model.js';
import { History } from './history.js';
import { Editor } from './editor.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const AUTOSAVE_KEY = 'spline.autosave';

const TOOLS = [
  { id: 'brush', icon: 'brush', key: 'B' },
  { id: 'eraser', icon: 'eraser', key: 'E' },
  { id: 'pen', icon: 'pen', key: 'P' },
  { id: 'select', icon: 'select', key: 'V' },
  { id: 'rect', icon: 'rect', key: 'R' },
  { id: 'ellipse', icon: 'ellipse', key: 'O' },
  { id: 'hand', icon: 'hand', key: 'H' },
];
const toolName = (id) => t('tool' + id[0].toUpperCase() + id.slice(1));
const toolTip = (id) => t('tip' + id[0].toUpperCase() + id.slice(1));

const app = {
  project: null,
  history: new History(),
  selected: new Set(), // glyph names
  anchor: null, // for shift-range selection
  focusName: null,
  category: 'all',
  colorFilter: null,
  search: '',
  mode: 'grid',
  current: null, // glyph in the editor
  dirty: false,
  fileHandle: null, // File System Access handle
  serverFile: null, // path when opened from the command line
  fileName: null,
};

// ================================================================ helpers

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = icon(kind === 'error' ? 'alert' : 'check') + `<span>${esc(msg)}</span>`;
  $('toasts').append(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); }, kind === 'error' ? 5000 : 2600);
}

// Shows a modal. `body` is HTML; resolves with FormData (submit) or null.
function showDialog({ title, body, okLabel = t('ok'), okClass = 'btn-primary', cancel = true }) {
  const dlg = $('dialog');
  dlg.innerHTML = `<form method="dialog">
    <h2>${esc(title)}</h2>
    ${body}
    <div class="actions">
      ${cancel ? `<button class="btn btn-ghost" value="cancel" formnovalidate>${esc(t('cancel'))}</button>` : ''}
      <button class="btn ${okClass}" value="ok">${esc(okLabel)}</button>
    </div>
  </form>`;
  return new Promise((resolve) => {
    const form = dlg.querySelector('form');
    let data = null;
    form.addEventListener('submit', (e) => {
      if (e.submitter?.value === 'ok') data = new FormData(form);
    });
    dlg.addEventListener('close', () => resolve(data), { once: true });
    dlg.showModal();
    const first = dlg.querySelector('input:not([type=checkbox])');
    if (first) { first.focus(); first.select?.(); }
  });
}

async function confirmDialog(msg, okLabel, danger = true) {
  const r = await showDialog({ title: msg, body: '', okLabel, okClass: danger ? 'btn-danger' : 'btn-primary' });
  return !!r;
}

function glyphSVG(g, cls = 'glyph') {
  const { ascender: asc, descender: desc } = app.project.info;
  const b = glyphBox(g);
  const minX = Math.min(0, b ? b.minX : 0), maxX = Math.max(g.advance, b ? b.maxX : 0, 1);
  const top = Math.max(asc, b ? b.maxY : 0), bottom = Math.min(desc, b ? b.minY : 0);
  const pad = 40;
  return `<svg class="${cls}" viewBox="${minX - pad} ${-top - pad} ${maxX - minX + 2 * pad} ${top - bottom + 2 * pad}" aria-hidden="true">
    <path transform="scale(1 -1)" d="${svgPath(g)}" fill="currentColor"/></svg>`;
}

const findGlyph = (name) => app.project.glyphs.find((g) => g.name === name);

// ================================================================ state changes

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
}

let autosaveTimer;
function markChanged() {
  setDirty(true);
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, 700);
  schedulePreview();
}

function autosave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ fileName: app.fileName, project: serialize(app.project) }));
  } catch { /* storage full or blocked */ }
}

// Called by the editor after every edit.
app.commitGlyph = () => {
  markChanged();
  updatePanelMetrics();
};
app.onGlyphMetricsChanged = () => updatePanelMetrics();

function renderAll() {
  $('fontName').textContent = app.project.info.familyName;
  document.title = `${app.project.info.familyName} — Spline`;
  renderSidebar();
  renderGrid();
  renderInspector();
}

// ================================================================ sidebar

function visibleGlyphs() {
  const cat = CATEGORIES.find((c) => c.id === app.category);
  const q = app.search.trim().toLowerCase();
  return app.project.glyphs.filter((g) => {
    const ch = charOf(g);
    if (app.category === 'empty') { if (isDrawn(g)) return false; } else if (app.category === 'done') {
      if (!isDrawn(g)) return false;
    } else if (cat && !cat.test(ch)) return false;
    if (app.colorFilter && g.color !== app.colorFilter) return false;
    if (q) {
      const hex = g.unicode ? g.unicode.toString(16) : '';
      if (!(ch.toLowerCase() === q || g.name.toLowerCase().includes(q) || hex === q.replace(/^u\+/, ''))) return false;
    }
    return true;
  });
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
      style="background:var(--dot-${c})" aria-pressed="${app.colorFilter === c}" title="${esc(t('colorNames')[c])}"
      aria-label="${esc(t('colorNames')[c])}"></button>`).join('');
}

$('catList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  app.category = b.dataset.cat;
  renderSidebar();
  renderGrid();
});
$('colorFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (!b) return;
  app.colorFilter = app.colorFilter === b.dataset.color ? null : b.dataset.color;
  renderSidebar();
  renderGrid();
});
$('searchInput').addEventListener('input', (e) => { app.search = e.target.value; renderGrid(); });

// ================================================================ grid

function tileHTML(g) {
  const ch = charOf(g);
  const drawn = g.contours.length > 0;
  const body = drawn || g.unicode === 32 ? glyphSVG(g) : `<span class="ghost" aria-hidden="true">${esc(ch)}</span>`;
  const label = ch && ch.trim() ? `${ch} · ${g.name}` : g.name;
  return `<button type="button" class="tile" role="option" data-name="${esc(g.name)}"
      ${g.color ? `data-color="${g.color}"` : ''} aria-selected="${app.selected.has(g.name)}"
      tabindex="${g.name === app.focusName ? 0 : -1}" aria-label="${esc(label)}">
      ${drawn ? `<span class="done-dot">${icon('check', 16)}</span>` : ''}
      ${body}<span class="label">${esc(g.name)}</span></button>`;
}

function renderGrid() {
  const list = visibleGlyphs();
  if (list.length && !list.some((g) => g.name === app.focusName)) app.focusName = list[0].name;
  $('glyphGrid').innerHTML = list.length ? list.map(tileHTML).join('') : `<p class="grid-empty">—</p>`;
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
  const cols = getComputedStyle($('glyphGrid')).gridTemplateColumns.split(' ').length;
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
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && app.selected.size) {
    e.preventDefault();
    deleteSelectedGlyphs();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    app.selected = new Set(list.map((g) => g.name));
    renderGrid();
    renderInspector();
  }
});

// ================================================================ inspector (grid)

function colorPicker(current) {
  return `<div class="field"><span>${esc(t('color'))}</span><div class="color-filter" data-role="colorPick">
    <button type="button" class="swatch none" data-color="" aria-pressed="${!current}" title="${esc(t('noColor'))}" aria-label="${esc(t('noColor'))}"></button>
    ${COLORS.map((c) => `<button type="button" class="swatch" data-color="${c}" style="background:var(--dot-${c})"
      aria-pressed="${current === c}" title="${esc(t('colorNames')[c])}" aria-label="${esc(t('colorNames')[c])}"></button>`).join('')}
  </div></div>`;
}

function renderInspector() {
  const el = $('inspector');
  const sel = [...app.selected].map(findGlyph).filter(Boolean);
  if (!sel.length) {
    const info = app.project.info;
    el.innerHTML = `<h2>${esc(info.familyName)}</h2>
      <p class="hint">${esc(t('noSelection'))}</p>
      <p class="hint">${esc(t('helpIntro'))}</p>
      <button class="btn btn-ghost btn-block" type="button" data-act="info">${icon('settings')}<span>${esc(t('fontInfo'))}</span></button>
      <button class="btn btn-ghost btn-block" type="button" data-act="import">${icon('open')}<span>${esc(t('importGlyphs'))}</span></button>`;
    return;
  }
  if (sel.length === 1) {
    const g = sel[0];
    const ch = charOf(g);
    const drawn = g.contours.length > 0;
    el.innerHTML = `<div class="big-glyph">${drawn ? glyphSVG(g) : `<span class="ghost">${esc(ch)}</span>`}</div>
      <h2>${esc(ch && ch.trim() ? ch : g.name)}</h2>
      <div class="field-row">
        <label class="field"><span>${esc(t('name'))}</span><input value="${esc(g.name)}" readonly></label>
        <label class="field"><span>${esc(t('unicode'))}</span><input value="${g.unicode ? 'U+' + g.unicode.toString(16).toUpperCase().padStart(4, '0') : '—'}" readonly></label>
      </div>
      <label class="field"><span>${esc(t('width'))}</span><input type="number" min="0" max="5000" step="10" value="${Math.round(g.advance)}" data-role="width"></label>
      ${colorPicker(g.color)}
      <div class="panel-actions">
        <button class="btn btn-primary btn-block" type="button" data-act="draw">${icon('brush')}<span>${esc(t('drawGlyph'))}</span></button>
        <button class="btn btn-danger btn-block" type="button" data-act="delete">${icon('trash')}<span>${esc(t('deleteGlyph'))}</span></button>
      </div>`;
    return;
  }
  el.innerHTML = `<h2>${sel.length} × ${esc(t('glyph'))}</h2>
    <p class="hint">${esc(sel.map((g) => charOf(g) || g.name).join(' '))}</p>
    ${colorPicker(sel.every((g) => g.color === sel[0].color) ? sel[0].color : undefined)}
    <button class="btn btn-danger btn-block" type="button" data-act="delete">${icon('trash')}<span>${esc(t('deleteGlyph'))}</span></button>`;
}

$('inspector').addEventListener('click', (e) => {
  const sw = e.target.closest('[data-role="colorPick"] [data-color]');
  if (sw) {
    for (const name of app.selected) {
      const g = findGlyph(name);
      if (!g) continue;
      if (sw.dataset.color) g.color = sw.dataset.color; else delete g.color;
      updateTile(g);
    }
    markChanged();
    renderInspector();
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'draw') openEditor([...app.selected][0]);
  if (act === 'delete') deleteSelectedGlyphs();
  if (act === 'info') editFontInfo();
  if (act === 'import') importGlyphs();
});
$('inspector').addEventListener('change', (e) => {
  if (e.target.dataset.role !== 'width') return;
  const g = findGlyph([...app.selected][0]);
  const v = Number(e.target.value);
  if (!g || !Number.isFinite(v) || v < 0) return;
  app.history.push(g);
  g.advance = Math.round(v);
  updateTile(g);
  markChanged();
});

async function deleteSelectedGlyphs() {
  const n = app.selected.size;
  if (!n || !(await confirmDialog(t('confirmDelete', { n }), t('delete')))) return;
  app.project.glyphs = app.project.glyphs.filter((g) => !app.selected.has(g.name));
  app.selected.clear();
  markChanged();
  renderAll();
}

// ================================================================ dialogs

async function addGlyphs() {
  const data = await showDialog({
    title: t('addGlyph'),
    body: `<label class="field"><span>${esc(t('addGlyphHint'))}</span><input type="text" name="chars" required maxlength="200" autocomplete="off"></label>`,
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
  renderAll();
  $('glyphGrid').querySelector(`[data-name="${CSS.escape(added[0].name)}"]`)?.scrollIntoView({ block: 'center' });
}

async function editFontInfo() {
  const i = app.project.info;
  const num = (name, label, v) => `<label class="field"><span>${esc(t(label))}</span><input type="number" name="${name}" value="${v}" required step="10"></label>`;
  const data = await showDialog({
    title: t('fontInfo'),
    body: `<label class="field"><span>${esc(t('family'))}</span><input type="text" name="familyName" value="${esc(i.familyName)}" required maxlength="60"></label>
      <div class="field-row">
        <label class="field"><span>${esc(t('designer'))}</span><input type="text" name="designer" value="${esc(i.designer || '')}" maxlength="80"></label>
        <label class="field"><span>${esc(t('version'))}</span><input type="text" name="version" value="${esc(i.version || '1.000')}" pattern="\\d+\\.\\d+" maxlength="10"></label>
      </div>
      <h3>${esc(t('metrics'))}</h3>
      <div class="field-row">${num('ascender', 'ascender', i.ascender)}${num('capHeight', 'capHeight', i.capHeight)}</div>
      <div class="field-row">${num('xHeight', 'xHeight', i.xHeight)}${num('descender', 'descender', i.descender)}</div>`,
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
  if (app.mode === 'editor') editor.render();
}

async function newFontDialog() {
  if (app.dirty && !(await confirmDialog(t('confirmNew'), t('new')))) return;
  const sets = [['latin', 'setLatin'], ['cyrillic', 'setCyrillic'], ['digits', 'setDigits'], ['punct', 'setPunct']];
  const data = await showDialog({
    title: t('newTitle'),
    body: `<label class="field"><span>${esc(t('family'))}</span><input type="text" name="family" value="${esc(getLang() === 'ru' ? 'Мой шрифт' : 'My Font')}" required maxlength="60"></label>
      <fieldset class="field" style="border:0;padding:0;margin:0"><span>${esc(t('newSets'))}</span><div class="checks">
      ${sets.map(([id, label]) => `<label class="toggle"><input type="checkbox" name="sets" value="${id}" checked>${esc(t(label))}</label>`).join('')}
      </div></fieldset>`,
    okLabel: t('create'),
  });
  if (!data) return;
  setProject(newProject({ family: String(data.get('family')).trim() || 'My Font', sets: data.getAll('sets') }));
  autosave();
}

function helpDialog() {
  showDialog({
    title: t('help'),
    cancel: false,
    body: `<p>${esc(t('helpIntro'))}</p><h3>${esc(t('shortcuts'))}</h3>
      <dl class="keys">${t('keysList').map(([k, v]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(v)}</dd>`).join('')}</dl>`,
  });
}

// ================================================================ editor

const editor = new Editor(app, $('canvas'));

function renderToolbar() {
  $('toolButtons').innerHTML = TOOLS.map((tl) => `<button type="button" class="tool" role="radio" data-tool="${tl.id}"
      aria-checked="${editor.tool === tl.id}" title="${esc(toolName(tl.id))} (${tl.key})">
      ${icon(tl.icon, 22)}<span>${esc(toolName(tl.id))}</span><kbd>${tl.key}</kbd></button>`).join('');
  $('toolTip').textContent = toolTip(editor.tool);
}

function setTool(id) {
  editor.setTool(id);
  renderToolbar();
  renderGlyphPanel();
}

$('toolButtons').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b) setTool(b.dataset.tool);
});

function openEditor(name, push = true) {
  const g = findGlyph(name);
  if (!g) return;
  app.mode = 'editor';
  app.current = g;
  app.selected = new Set([name]);
  app.focusName = name;
  $('gridView').hidden = true;
  $('editorView').hidden = false;
  const ch = charOf(g);
  $('editorChar').textContent = ch && ch.trim() ? ch : '␣';
  $('editorName').textContent = g.name;
  if (push) history.pushState({ glyph: name }, '', `#glyph=${encodeURIComponent(name)}`);
  else history.replaceState({ glyph: name }, '', `#glyph=${encodeURIComponent(name)}`);
  renderToolbar();
  editor.resize();
  editor.open(g);
  renderGlyphPanel();
  $('canvas').focus({ preventScroll: true });
}

function showGrid(push = true) {
  if (app.mode === 'editor') editor.finishPen();
  const wasEditor = app.mode === 'editor';
  app.mode = 'grid';
  app.current = null;
  $('editorView').hidden = true;
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
  else showGrid(false);
});

function stepGlyph(dir) {
  const list = visibleGlyphs();
  const all = list.some((g) => g === app.current) ? list : app.project.glyphs;
  const i = all.indexOf(app.current);
  const next = all[(i + dir + all.length) % all.length];
  if (next) openEditor(next.name, false);
}

$('backBtn').addEventListener('click', () => history.back());
$('prevGlyph').addEventListener('click', () => stepGlyph(-1));
$('nextGlyph').addEventListener('click', () => stepGlyph(1));
$('zoomIn').addEventListener('click', () => editor.zoomBy(1.25));
$('zoomOut').addEventListener('click', () => editor.zoomBy(0.8));
$('zoomFit').addEventListener('click', () => editor.fit());
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);

function renderGlyphPanel() {
  const g = app.current;
  if (!g) return;
  const brush = editor.tool === 'brush' || editor.tool === 'eraser';
  $('glyphPanel').innerHTML = `
    ${brush ? `<label class="range"><span>${esc(t('brushSize'))}: <output id="brushOut">${editor.brushRadius * 2}</output></span>
      <input type="range" min="10" max="240" step="2" value="${editor.brushRadius * 2}" data-role="brush"></label>` : ''}
    <label class="toggle"><input type="checkbox" data-role="guide" ${editor.showGuide ? 'checked' : ''}>${esc(t('guide'))}</label>
    <label class="field"><span>${esc(t('width'))}</span><input type="number" min="0" max="5000" step="10" data-role="advance"></label>
    <div class="field-row">
      <label class="field"><span>${esc(t('lsb'))}</span><input type="number" step="10" data-role="lsb"></label>
      <label class="field"><span>${esc(t('rsb'))}</span><input type="number" step="10" data-role="rsb"></label>
    </div>
    ${colorPicker(g.color)}
    <div class="panel-actions">
      <button class="btn btn-ghost btn-block" type="button" data-act="spacing">${icon('spacing')}<span>${esc(t('autoSpacing'))}</span></button>
      <div class="row">
        <button class="btn btn-ghost" type="button" data-act="flipH">${icon('flipH')}<span>${esc(t('flipH'))}</span></button>
        <button class="btn btn-ghost" type="button" data-act="flipV">${icon('flipV')}<span>${esc(t('flipV'))}</span></button>
      </div>
      <button class="btn btn-danger btn-block" type="button" data-act="clear">${icon('eraseAll')}<span>${esc(t('clear'))}</span></button>
    </div>`;
  updatePanelMetrics();
}

function updatePanelMetrics() {
  const g = app.current;
  if (!g || app.mode !== 'editor') return;
  const box = glyphBox(g);
  const set = (role, v) => {
    const el = $('glyphPanel').querySelector(`[data-role="${role}"]`);
    if (el && document.activeElement !== el) el.value = v;
  };
  set('advance', Math.round(g.advance));
  set('lsb', box ? Math.round(box.minX) : '');
  set('rsb', box ? Math.round(g.advance - box.maxX) : '');
}

$('glyphPanel').addEventListener('input', (e) => {
  const role = e.target.dataset.role;
  if (role === 'brush') {
    editor.brushRadius = Number(e.target.value) / 2;
    $('brushOut').textContent = e.target.value;
    editor.render();
  }
  if (role === 'guide') { editor.showGuide = e.target.checked; editor.render(); }
});
$('glyphPanel').addEventListener('change', (e) => {
  const g = app.current;
  const role = e.target.dataset.role;
  const v = Math.round(Number(e.target.value));
  if (!g || !['advance', 'lsb', 'rsb'].includes(role) || !Number.isFinite(v)) return;
  const box = glyphBox(g);
  app.history.push(g);
  if (role === 'advance') g.advance = Math.max(0, v);
  if (role === 'lsb' && box) { const d = v - box.minX; translateGlyph(g, d, 0); g.advance = Math.max(0, g.advance + d); }
  if (role === 'rsb' && box) g.advance = Math.max(0, Math.round(box.maxX + v));
  editor.afterEdit(false);
});
$('glyphPanel').addEventListener('click', async (e) => {
  const g = app.current;
  if (!g) return;
  const sw = e.target.closest('[data-role="colorPick"] [data-color]');
  if (sw) {
    if (sw.dataset.color) g.color = sw.dataset.color; else delete g.color;
    markChanged();
    renderGlyphPanel();
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  const box = glyphBox(g);
  if (!act || (!box && act !== 'clear')) return;
  if (act === 'clear') {
    if (!g.contours.length || !(await confirmDialog(t('confirmClear'), t('clear')))) return;
    app.history.push(g);
    g.contours = [];
  } else {
    app.history.push(g);
    if (act === 'spacing') {
      const side = Math.round(Math.max(30, (box.maxX - box.minX) * 0.08));
      translateGlyph(g, side - box.minX, 0);
      g.advance = Math.round(box.maxX - box.minX + side * 2);
    }
    if (act === 'flipH') transformGlyph(g, (p) => ({ ...p, x: box.minX + box.maxX - p.x }));
    if (act === 'flipV') transformGlyph(g, (p) => ({ ...p, y: box.minY + box.maxY - p.y }));
  }
  normalizeDirections(g);
  editor.sel.clear();
  editor.afterEdit(false);
});

// ================================================================ undo

function undo() { applyHistory(app.history.undo(app.project)); }
function redo() { applyHistory(app.history.redo(app.project)); }
function applyHistory(name) {
  if (!name) return;
  markChanged();
  if (app.mode === 'editor') {
    if (app.current?.name !== name) openEditor(name, false);
    editor.sel.clear();
    editor.penContour = null;
    editor.render();
    updatePanelMetrics();
  } else {
    const g = findGlyph(name);
    if (g) updateTile(g);
    renderSidebar();
    renderInspector();
  }
}

// ================================================================ files

function projectBlob() {
  return new Blob([serialize(app.project)], { type: 'application/json' });
}

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
    toast(t('savedAs', { name: app.fileName }));
  } catch (err) {
    if (err.name !== 'AbortError') toast(err.message, 'error');
  }
}

async function readProjectFile(file) {
  const text = await file.text();
  return validateProject(JSON.parse(text));
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
  if (app.dirty && !(await confirmDialog(t('confirmNew'), t('open'), false))) return;
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
  $('fileInput').dataset.mode = 'open';
  $('fileInput').click();
}

function importGlyphs() {
  $('fileInput').dataset.mode = 'import';
  $('fileInput').click();
}

$('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (e.target.dataset.mode === 'import') {
    try { mergeGlyphs((await readProjectFile(file)).glyphs); } catch (err) { toast(t('openError', { err: err.message }), 'error'); }
  } else {
    openFile(file);
  }
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

// Drag & drop of .sp files anywhere in the window.
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
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (app.dirty && !(await confirmDialog(t('confirmNew'), t('open'), false))) return;
  openFile(file);
});

// ================================================================ clipboard

const typing = (el) => el && (el.matches('input, textarea, select, [contenteditable]') || el.closest('dialog[open]'));

document.addEventListener('copy', (e) => {
  if (typing(document.activeElement)) return;
  let payload;
  if (app.mode === 'editor') {
    payload = { format: 'spline-contours', contours: editor.copyContours() };
  } else {
    const glyphs = [...app.selected].map(findGlyph).filter(Boolean);
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
  let data;
  try { data = JSON.parse(e.clipboardData.getData('text/plain')); } catch { return; }
  e.preventDefault();
  const glyphs = data.format === 'spline-glyphs' ? data.glyphs : data.format === 'spline' ? data.glyphs : null;
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
});

// ================================================================ keyboard

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 's') { e.preventDefault(); save(e.shiftKey); return; }
  if (typing(e.target)) return;
  if (mod && key === 'o') { e.preventDefault(); openDialog(); return; }
  if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (mod && key === 'z') { e.preventDefault(); undo(); return; }
  if (app.mode !== 'editor') return;

  if (mod && key === 'a') { e.preventDefault(); editor.selectAll(); return; }
  if (mod) return;
  const tool = TOOLS.find((tl) => tl.key.toLowerCase() === key);
  if (tool && !e.altKey) { setTool(tool.id); return; }
  const step = e.shiftKey ? 10 : 1;
  const arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, step], arrowdown: [0, -step] };
  if (arrows[key]) { if (editor.nudge(...arrows[key])) e.preventDefault(); return; }
  switch (e.key) {
    case 'Delete': case 'Backspace': if (editor.deleteSelection()) e.preventDefault(); break;
    case 'Escape': if (!editor.escape()) history.back(); break;
    case 'Enter': editor.finishPen(); break;
    case 'PageUp': e.preventDefault(); stepGlyph(-1); break;
    case 'PageDown': e.preventDefault(); stepGlyph(1); break;
    case '+': case '=': editor.zoomBy(1.25); break;
    case '-': editor.zoomBy(0.8); break;
    case '0': editor.fit(); break;
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
function schedulePreview(delay = 600) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, delay);
}

async function updatePreview() {
  const msg = $('previewMsg');
  if (!app.project.glyphs.some((g) => g.contours.length)) {
    msg.textContent = t('previewEmpty');
    $('previewOut').style.fontFamily = '';
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

// Letters that are drawn use the new font; the rest are shown faded so it
// is obvious what is still missing.
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
  let text = '';
  try { text = localStorage.getItem('spline.previewText') || ''; } catch { /* ignore */ }
  $('previewInput').value = text || t('previewText');
  renderPreviewText();
  $('previewInput').addEventListener('input', (e) => {
    renderPreviewText();
    try { localStorage.setItem('spline.previewText', e.target.value); } catch { /* ignore */ }
  });
  const size = $('previewSize');
  const apply = () => { $('previewOut').style.fontSize = `${size.value}px`; };
  size.addEventListener('input', apply);
  apply();
}

// ================================================================ top bar

$('newBtn').addEventListener('click', newFontDialog);
$('openBtn').addEventListener('click', openDialog);
$('saveBtn').addEventListener('click', () => save());
$('helpBtn').addEventListener('click', helpDialog);
$('fontNameBtn').addEventListener('click', editFontInfo);
$('addGlyphBtn').addEventListener('click', addGlyphs);

const exportBtn = $('exportBtn'), exportMenu = $('exportMenu');
function toggleMenu(open) {
  exportMenu.hidden = !open;
  exportBtn.setAttribute('aria-expanded', open);
  if (open) exportMenu.querySelector('button').focus();
}
exportBtn.addEventListener('click', () => toggleMenu(exportMenu.hidden));
exportMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-format]');
  if (!b) return;
  toggleMenu(false);
  exportFont(b.dataset.format);
});
exportMenu.addEventListener('keydown', (e) => {
  const items = [...exportMenu.querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  if (e.key === 'Escape') { toggleMenu(false); exportBtn.focus(); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) toggleMenu(false); });

document.querySelector('.lang-switch').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lang]');
  if (b) setLang(b.dataset.lang);
});

function refreshLang() {
  document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === getLang()));
  renderAll();
  if (app.mode === 'editor') { renderToolbar(); renderGlyphPanel(); editor.updateAria(); editor.render(); }
}
onLangChange(refreshLang);

// ================================================================ start

async function start() {
  fillIcons();
  document.documentElement.lang = getLang();
  applyStatic();
  initPreview();

  let session = null;
  try { session = await (await fetch('/api/session')).json(); } catch { /* opened without the Go server */ }

  let loaded = false;
  if (session?.filePath) {
    if (session.project) {
      try {
        setProject(validateProject(session.project), {
          fileName: session.fileName, serverFile: session.filePath,
        });
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
      const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
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
  if (m && findGlyph(decodeURIComponent(m[1]))) openEditor(decodeURIComponent(m[1]), false);
  else history.replaceState({}, '', location.pathname);
}

start();
