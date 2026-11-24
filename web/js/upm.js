// Scales the whole font to another units-per-em (1000 -> 2048 and back):
// outlines in every master, backgrounds and snapshots, widths, anchors,
// components, guides, notes, the reference image, kerning, font lines and
// the numbers in metric keys. Coordinates are rounded to whole units.

const LENGTHS = ['advance', 'pos', 'r', 'x2', 'y2', 'w', 'h'];

// Every object with an x and a y is a point; LENGTHS are sizes. Slider
// values of smart parts (props) and colours are left alone.
function walk(o, k, skip = '') {
  if (Array.isArray(o)) { for (const v of o) walk(v, k); return; }
  if (!o || typeof o !== 'object') return;
  const point = Number.isFinite(o.x) && Number.isFinite(o.y);
  for (const [key, v] of Object.entries(o)) {
    if (key === 'props' || key === skip) continue;
    if (typeof v === 'number') {
      if ((point && (key === 'x' || key === 'y')) || LENGTHS.includes(key)) o[key] = Math.round(v * k);
    } else if (v && typeof v === 'object') walk(v, k);
  }
}

// "=o+10" -> "=o+20": numbers added, subtracted or given on their own; a
// factor ("=o*2") stays as it is.
export function scaleKey(key, k) {
  return key.replace(/([=+-]\s*)(\d+(?:\.\d+)?)(?![\w.])/g, (m, op, n) => op + Math.round(Number(n) * k));
}

const INFO = ['ascender', 'descender', 'xHeight', 'capHeight', 'lineGap', 'underlinePosition', 'underlineThickness', 'overshoot'];
const KEYS = ['lsbKey', 'rsbKey', 'widthKey'];

export function scaleProject(p, upm) {
  const k = upm / p.info.unitsPerEm;
  if (!(k > 0) || k === 1) return false;
  for (const f of INFO) if (Number.isFinite(p.info[f])) p.info[f] = Math.round(p.info[f] * k);
  p.info.unitsPerEm = upm;
  for (const g of p.glyphs) {
    walk(g, k, 'smart');
    if (g.smart) walk(g.smart.states, k);
    for (const f of KEYS) if (g[f]) g[f] = scaleKey(g[f], k);
  }
  walk(p.guides || [], k);
  const kern = (table) => { for (const row of Object.values(table || {})) for (const r of Object.keys(row)) row[r] = Math.round(row[r] * k); };
  kern(p.kerning);
  for (const m of p.masters || []) kern(m.kerning);
  return true;
}
