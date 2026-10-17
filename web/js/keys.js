// Keyboard shortcuts that the user can reassign (Help → Keyboard Shortcuts).
// A combo is a string like "Ctrl+Shift+Z": modifiers in the order Ctrl, Alt,
// Shift, then the key. Keys come from the physical key (e.code), so a
// shortcut works with any layout. Cmd on macOS counts as Ctrl.

const isMac = /Mac/.test(navigator.platform);
const STORE = 'spline.keys';

const CODE_NAMES = {
  Semicolon: ';', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  BracketLeft: '[', BracketRight: ']', Quote: "'", Backquote: '`',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
  PageUp: 'PageUp', PageDown: 'PageDown', Home: 'Home', End: 'End', Insert: 'Insert', Tab: 'Tab',
};

// Keys with a fixed meaning (points, dialogs, panning) are not offered.
const FIXED = new Set(['Escape', 'Enter', 'NumpadEnter', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace']);

function keyName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return CODE_NAMES[code] || null;
}

// The combo of a key press, or null for keys that cannot be assigned.
export function comboOf(e) {
  if (FIXED.has(e.code)) return null;
  const k = keyName(e.code);
  if (!k) return null;
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
}

// "Ctrl+Shift+Z" as shown in menus and tips ("⌘⇧Z" on macOS).
export function comboLabel(c) {
  if (!c) return '';
  const mods = [];
  let key = c;
  for (let m; (m = /^(Ctrl|Alt|Shift)\+(.+)$/.exec(key));) { mods.push(m[1]); key = m[2]; }
  const shown = key === '=' ? '+' : key === '-' ? '−' : key;
  if (isMac) return mods.map((m) => ({ Ctrl: '⌘', Alt: '⌥', Shift: '⇧' }[m])).join('') + shown;
  return [...mods, shown].join('+');
}

// Combos the browser itself keeps: a page never sees them (except in full
// screen, F11).
export const BROWSER_RESERVED = new Set(['Ctrl+T', 'Ctrl+W', 'Ctrl+N', 'Ctrl+Shift+T', 'Ctrl+Shift+W', 'Ctrl+Shift+N', 'Ctrl+Tab', 'Ctrl+Shift+Tab']);

// Combos with a fixed meaning elsewhere (clipboard).
export const TAKEN = { 'Ctrl+C': 'copy', 'Ctrl+X': 'cut', 'Ctrl+V': 'paste' };

let defaults = {};
let custom = {};
try { custom = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { custom = {}; }

export function setDefaults(map) { defaults = map; }

export function bindings(id) { return custom[id] || defaults[id] || []; }
export function keyLabel(id) { return comboLabel(bindings(id)[0]); }
export function isCustom(id) { return !!custom[id]; }

function persist() {
  try { localStorage.setItem(STORE, JSON.stringify(custom)); } catch { /* storage unavailable */ }
}

// Assigns `combo` to `id` (null clears it). Another action that used the
// combo loses it; its id is returned so the caller can say so.
export function assign(id, combo) {
  let taken = null;
  if (combo) {
    for (const other of Object.keys(defaults)) {
      if (other === id || !bindings(other).includes(combo)) continue;
      custom[other] = bindings(other).filter((c) => c !== combo);
      taken = other;
    }
  }
  custom[id] = combo ? [combo] : [];
  persist();
  return taken;
}

export function resetAll() { custom = {}; persist(); }

// The action bound to a combo, if any.
export function actionFor(combo) {
  for (const id of Object.keys(defaults)) if (bindings(id).includes(combo)) return id;
  return null;
}
