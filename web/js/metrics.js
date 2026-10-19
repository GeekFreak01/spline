// Metric keys (extended mode), as in Glyphs: a sidebearing or width that
// follows another glyph instead of a fixed number.
//
//   =n        same as the left (or right) side of n
//   =o+10     o's side plus 10 (also -, *, /)
//   =|o       the opposite side of o: the left side takes o's right side
//   =|        the glyph's own opposite side (symmetric letters: A, O, V)
//   =50       a fixed value
//
// A glyph can be named by its name or by its character (=н works for uni043D).
import { glyphBox, translateGlyph } from './model.js';

export const KEY_FIELDS = { lsb: 'lsbKey', rsb: 'rsbKey', advance: 'widthKey' };
const KEY_RE = /^=(\|)?([^+\-*/]*?)\s*(?:([+\-*/])\s*(-?\d+(?:\.\d+)?))?$/;

export function findGlyph(project, ref) {
  return project.glyphs.find((g) => g.name === ref)
    || ([...ref].length === 1 ? project.glyphs.find((g) => g.unicode === ref.codePointAt(0)) : null);
}

export function sides(g) {
  const box = glyphBox(g);
  return box ? { lsb: box.minX, rsb: g.advance - box.maxX, advance: g.advance } : { lsb: null, rsb: null, advance: g.advance };
}

export const isKey = (s) => typeof s === 'string' && KEY_RE.test(s.trim());

// The value a key asks for, or null when it cannot be worked out.
export function evalKey(project, g, role, key) {
  const m = KEY_RE.exec(String(key).trim());
  if (!m) return null;
  const [, flip, refRaw, op, numRaw] = m;
  const ref = refRaw.trim();
  let v;
  if (!flip && /^\d+(\.\d+)?$/.test(ref) && !op) return Math.round(Number(ref)); // "=50"
  if (!ref && !flip) {
    v = Number(numRaw ?? NaN);
    if (op === '-') v = -v; // "=-20"
    else if (op) return null;
    return Number.isFinite(v) ? v : null;
  }
  const src = ref ? findGlyph(project, ref) : g;
  if (!src) return null;
  const s = sides(src);
  const side = role === 'advance' ? 'advance' : flip ? (role === 'lsb' ? 'rsb' : 'lsb') : role;
  if (!ref && side === role) return null; // "=" alone means nothing
  v = s[side];
  if (v === null) return null;
  const n = Number(numRaw);
  if (op === '+') v += n;
  if (op === '-') v -= n;
  if (op === '*') v *= n;
  if (op === '/' && n) v /= n;
  return Math.round(v);
}

// Sets a sidebearing or width of g; returns whether something changed.
export function setMetric(g, role, v) {
  const box = glyphBox(g);
  v = Math.round(v);
  if (role === 'advance') {
    if (g.advance === Math.max(0, v)) return false;
    g.advance = Math.max(0, v);
    return true;
  }
  if (!box) return false;
  if (role === 'lsb') {
    const d = Math.round(v - box.minX);
    if (!d) return false;
    translateGlyph(g, d, 0);
    g.advance = Math.max(0, g.advance + d);
    return true;
  }
  const adv = Math.max(0, Math.round(box.maxX + v));
  if (adv === g.advance) return false;
  g.advance = adv;
  return true;
}

// Which keys of g do not match their glyph right now.
export function outOfSync(project, g) {
  const out = [];
  const now = sides(g);
  for (const [role, field] of Object.entries(KEY_FIELDS)) {
    if (!g[field]) continue;
    const v = evalKey(project, g, role, g[field]);
    if (v !== null && now[role] !== null && Math.round(now[role]) !== v) out.push(role);
  }
  return out;
}

// Applies the keys of the given glyphs (several passes, so chains like
// m = n, n = H settle). `before(g)` runs once before a glyph is changed.
export function updateMetrics(project, glyphs, before = () => {}) {
  const changed = new Set();
  for (let pass = 0; pass < 4; pass++) {
    let any = false;
    for (const g of glyphs) {
      for (const role of ['lsb', 'rsb', 'advance']) {
        const key = g[KEY_FIELDS[role]];
        if (!key) continue;
        const v = evalKey(project, g, role, key);
        if (v === null) continue;
        const now = sides(g)[role];
        if (now === null || Math.round(now) === v) continue;
        if (!changed.has(g)) before(g);
        setMetric(g, role, v);
        changed.add(g);
        any = true;
      }
    }
    if (!any) break;
  }
  return [...changed];
}
