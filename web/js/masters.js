// Masters (extended mode): the same glyphs drawn several times along an
// axis, e.g. Regular (wght 400) and Bold (wght 700). Everything in between
// is interpolated: instances for export, a variable font, the preview.
//
//   project.axis    = { tag: 'wght', min, max }
//   project.masters = [{ id, name, loc, kerning?, italic?, italicAngle? }]
//                     the first one is the default (always upright)
//   project.styles  = [{ name, weight, width?, italic, export }]   the fonts
//                     the family exports (none: every master and the
//                     standard weights between them)
//
// A family, as in Glyphs: upright masters and italic masters. Upright
// styles blend the upright masters, italic styles the italic ones.
//   glyph.layers    = { [masterId]: { contours, advance } } for the others
//
// While a master other than the default is edited, its outlines sit in
// glyph.contours (so every tool works unchanged) and the default's in
// glyph.layers[defaultId]. Kerning the same way: the edited master's in
// project.kerning, the others' in master.kerning (none = the default's).
// serialize() always writes the default in glyph.contours and
// project.kerning, see saveForm().
import { normalizeDirections, reverseContour } from './model.js';

const clone = (o) => structuredClone(o);

export const hasMasters = (p) => (p.masters?.length || 0) > 1;
export const defaultId = (p) => p.masters?.[0]?.id;
export const activeId = (p) => p.activeMaster || defaultId(p);

const take = (g) => ({ contours: g.contours, advance: g.advance });

// The outline of g in master id, wherever it is stored right now.
export function layerOf(p, g, id) {
  if (id === activeId(p)) return take(g);
  return g.layers?.[id] || take(g);
}

// Makes master id the one being edited.
export function switchMaster(p, id) {
  const cur = activeId(p);
  if (!p.masters?.some((m) => m.id === id) || id === cur) return false;
  for (const g of p.glyphs) {
    g.layers ||= {};
    g.layers[cur] = take(g);
    const next = g.layers[id] || clone(take(g)); // a glyph added later: start as a copy
    g.contours = next.contours;
    g.advance = next.advance;
    delete g.layers[id];
  }
  // Kerning: a master without its own starts as a copy of the default's.
  const master = (x) => p.masters.find((m) => m.id === x);
  const defKern = cur === defaultId(p) ? p.kerning : master(defaultId(p)).kerning;
  master(cur).kerning = p.kerning || {};
  p.kerning = master(id).kerning || clone(defKern || {});
  delete master(id).kerning;
  p.activeMaster = id === defaultId(p) ? undefined : id;
  if (!p.activeMaster) delete p.activeMaster;
  return true;
}

// The project as it is saved: the default master in glyph.contours.
export function saveForm(p) {
  if (!p.activeMaster) return p;
  const q = { ...p, glyphs: p.glyphs.map((g) => {
    const layers = { ...(g.layers || {}) };
    const def = layers[defaultId(p)];
    layers[p.activeMaster] = take(g);
    delete layers[defaultId(p)];
    return { ...g, contours: def ? def.contours : g.contours, advance: def ? def.advance : g.advance, layers };
  }) };
  const defMaster = p.masters.find((m) => m.id === defaultId(p));
  q.kerning = defMaster.kerning || {};
  q.masters = p.masters.map((m) => {
    const c = { ...m };
    if (m.id === p.activeMaster) c.kerning = p.kerning || {};
    if (m === defMaster) delete c.kerning;
    return c;
  });
  delete q.activeMaster;
  return q;
}

// The project's single drawing becomes the default master (no-op when
// there are masters already).
export function ensureMasters(p) {
  if (p.masters?.length) return;
  p.axis ||= { tag: 'wght', min: 100, max: 900 };
  p.masters = [{ id: 'm0', name: p.info.styleName || 'Regular', loc: p.info.weight || 400 }];
}

export function addMaster(p, name, loc, loc2) {
  // Contours in their final direction first: the editor turns them on
  // every edit, and the masters must keep the same point order.
  for (const g of p.glyphs) normalizeDirections(g);
  ensureMasters(p);
  let n = p.masters.length;
  while (p.masters.some((m) => m.id === `m${n}`)) n++;
  const id = `m${n}`;
  p.masters.push({ id, name, loc, ...(p.axis2 ? { loc2: loc2 ?? p.masters[0].loc2 ?? 100 } : {}) });
  // A new master starts as a copy of the default, so it is compatible.
  for (const g of p.glyphs) {
    (g.layers ||= {})[id] = clone(layerOf(p, g, defaultId(p)));
  }
  return id;
}

export function deleteMaster(p, id) {
  if (id === defaultId(p) || !p.masters.some((m) => m.id === id)) return false;
  if (activeId(p) === id) switchMaster(p, defaultId(p));
  p.masters = p.masters.filter((m) => m.id !== id);
  for (const g of p.glyphs) if (g.layers) delete g.layers[id];
  if (p.masters.length < 2) { delete p.masters; delete p.axis; delete p.axis2; for (const g of p.glyphs) delete g.layers; }
  return true;
}

// Why two outlines cannot be interpolated, or '' when they can: the same
// contours, the same number of points, the same handles.
const sameCurves = (x, y) => x.nodes.every((n, k) => !!n.in === !!y.nodes[k].in && !!n.out === !!y.nodes[k].out);

// Contour y in the point order of x: as it is, or turned around (the
// editor may have reversed it), or null when they do not match.
export function matchContour(x, y) {
  if (x.nodes.length !== y.nodes.length || !!x.closed !== !!y.closed) return null;
  if (sameCurves(x, y)) return y;
  const r = clone(y);
  reverseContour(r);
  return sameCurves(x, r) ? r : null;
}

export function incompatibility(a, b) {
  if (a.contours.length !== b.contours.length) return 'contours';
  for (let i = 0; i < a.contours.length; i++) {
    const x = a.contours[i], y = b.contours[i];
    if (x.nodes.length !== y.nodes.length || !!x.closed !== !!y.closed) return 'points';
    if (!matchContour(x, y)) return 'curves';
  }
  return '';
}

// Masters in which glyph g does not match the default: [{ id, why }].
export function problems(p, g) {
  if (!hasMasters(p)) return [];
  const def = layerOf(p, g, defaultId(p));
  return p.masters.slice(1).map((m) => ({ id: m.id, why: incompatibility(def, layerOf(p, g, m.id)) })).filter((x) => x.why);
}

// ---------------------------------------------------------------- blending
//
// The same model fonts use (OpenType variations, fontTools' VariationModel):
// every master except the default gets a region on the axes and a delta;
// the outline anywhere is the default plus each delta times how much the
// location is inside that master's region. A master off both axes (Bold
// Condensed) only adds what the others do not already give it.

export const axesOf = (p) => [p.axis, p.axis2].filter(Boolean);
const locVec = (p, m) => [m.loc, ...(p.axis2 ? [m.loc2 ?? p.masters[0].loc2 ?? p.axis2.def ?? 100] : [])];

function normalizer(p) {
  const ax = axesOf(p), def = locVec(p, p.masters[0]);
  return (vec) => vec.map((v, k) => {
    const lo = ax[k].min, hi = ax[k].max, d = def[k];
    if (v < d) return d > lo ? Math.max(-1, (v - d) / (d - lo)) : 0;
    if (v > d) return hi > d ? Math.min(1, (v - d) / (hi - d)) : 0;
    return 0;
  });
}

// Regions of the masters, in the order their deltas are worked out.
export function variationModel(p) {
  const norm = normalizer(p);
  const ms = p.masters.map((m, i) => ({ id: m.id, i, nl: norm(locVec(p, m)) }));
  const others = ms.slice(1).filter((m) => m.nl.some((v) => v));
  others.sort((a, b) => a.nl.filter(Boolean).length - b.nl.filter(Boolean).length
    || a.nl.reduce((s, v) => s + Math.abs(v), 0) - b.nl.reduce((s, v) => s + Math.abs(v), 0));
  for (const m of others) {
    m.region = m.nl.map((pk, k) => {
      if (!pk) return null;
      let start = 0, end = pk;
      // On a single axis, neighbours on the same side split the axis.
      if (m.nl.filter(Boolean).length === 1) {
        for (const o of others) {
          if (o === m || o.nl.filter(Boolean).length !== 1 || !o.nl[k] || (o.nl[k] > 0) !== (pk > 0)) continue;
          const v = o.nl[k];
          if (Math.abs(v) < Math.abs(pk) && Math.abs(v) > Math.abs(start)) start = v;
          if (Math.abs(v) > Math.abs(pk) && (end === pk || Math.abs(v) < Math.abs(end))) end = v;
        }
      }
      return { start, peak: pk, end };
    });
  }
  return { norm, order: others };
}

export function scalarAt(region, nl) {
  let s = 1;
  region.forEach((r, k) => {
    if (!r) return;
    const v = nl[k];
    if (v === r.peak) return;
    const lo = Math.min(r.start, r.end), hi = Math.max(r.start, r.end);
    if (v < lo || v > hi) { s = 0; return; }
    if ((r.peak > 0 && v < r.peak) || (r.peak < 0 && v > r.peak)) s *= (v - r.start) / (r.peak - r.start);
    else s *= (r.end - v) / (r.end - r.peak);
  });
  return s;
}

// An outline as numbers (points and handles in order, then the width), in
// the point order of `like` (the default master).
function flat(o, like) {
  const out = [];
  o.contours.forEach((c, i) => {
    const m = like ? matchContour(like.contours[i], c) : c;
    for (const n of m.nodes) {
      out.push(n.x, n.y);
      if (n.in) out.push(n.in.x, n.in.y);
      if (n.out) out.push(n.out.x, n.out.y);
    }
  });
  out.push(o.advance);
  return out;
}

function unflat(like, nums) {
  let k = 0;
  const contours = like.contours.map((c) => ({
    ...c, // paint, brush and corners are not blended: they stay as they are
    nodes: c.nodes.map((n) => {
      const q = { ...n, x: nums[k++], y: nums[k++] };
      if (n.in) q.in = { x: nums[k++], y: nums[k++] };
      if (n.out) q.out = { x: nums[k++], y: nums[k++] };
      return q;
    }),
  }));
  return { contours, advance: Math.round(nums[k]) };
}

// A plain project (no masters) at a location: loc on the first axis and
// loc2 on the second. Glyphs drawn differently in some master take the
// default outline.
//
// italic: the instance of the italic masters (null when there are none).
export function instanceAt(p, loc, styleName, loc2, italic = false) {
  const src = italic || p.masters?.some((m) => m.italic) ? familyGroup(p, italic) : saveForm(p);
  if (!src) return null;
  const { norm, order } = variationModel(src);
  const def = src.masters[0];
  const target = norm([loc, ...(src.axis2 ? [loc2 ?? def.loc2 ?? 100] : [])]);
  const scal = order.map((m) => scalarAt(m.region, target));
  const get = (g, id) => (id === def.id ? take(g) : g.layers?.[id] || take(g));
  const q = clone({ ...src, glyphs: [] });
  delete q.masters; delete q.axis; delete q.axis2; delete q.activeMaster;
  q.info = { ...q.info, ...(styleName ? { styleName } : {}), weight: src.axis?.tag === 'wght' ? Math.round(loc) : q.info.weight };
  // A master's slant is positive to the right; a font file counts the other way.
  if (italic) q.info.italicAngle = -(def.italicAngle ?? 10);
  else delete q.info.italicAngle;
  q.glyphs = src.glyphs.map((g) => {
    const base = get(g, def.id);
    const outs = order.map((m) => get(g, m.id));
    let out = base;
    if (outs.every((o) => !incompatibility(base, o))) {
      const b = flat(base);
      // Deltas, each minus what the masters before it already give.
      const deltas = [];
      order.forEach((m, i) => {
        const v = flat(outs[i], base).map((x, k) => x - b[k]);
        for (let j = 0; j < i; j++) {
          const sj = scalarAt(order[j].region, m.nl);
          if (sj) for (let k = 0; k < v.length; k++) v[k] -= sj * deltas[j][k];
        }
        deltas.push(v);
      });
      const r = b.slice();
      deltas.forEach((d, i) => { if (scal[i]) for (let k = 0; k < r.length; k++) r[k] += scal[i] * d[k]; });
      out = unflat(base, r);
    }
    const copy = { ...g, contours: clone(out.contours), advance: out.advance };
    delete copy.layers;
    return copy;
  });
  q.kerning = blendKerning(src, order, scal);
  return q;
}

// Kerning at a location: every entry of every master, blended like the
// outlines. Where a master has no such entry, the pair gets what that
// master gives it through its groups (glyph+group, group+glyph,
// group+group, as in the font), else 0.
function blendKerning(src, order, scal) {
  const def = src.masters[0];
  const kernOf = (m) => (m.id === def.id ? src.kerning : m.kerning ?? src.kerning) || {};
  const byName = new Map(src.glyphs.map((g) => [g.name, g]));
  const sides = (key, prop) => (key.startsWith('@') || !byName.get(key)?.[prop] ? [key] : [key, `@${byName.get(key)[prop]}`]);
  const effective = (k, a, b) => {
    for (const x of sides(a, 'kernRight')) for (const y of sides(b, 'kernLeft')) if (k[x]?.[y] !== undefined) return k[x][y];
    return 0;
  };
  const keys = new Set();
  for (const m of src.masters) for (const [a, row] of Object.entries(kernOf(m))) for (const b of Object.keys(row)) keys.add(`${a}\u0000${b}`);
  const out = {};
  for (const key of keys) {
    const [a, b] = key.split('\u0000');
    const val = (m) => effective(kernOf(m), a, b);
    const base = val(def);
    // order holds { id, i, nl, region }: the master itself is src.masters[i].
    const deltas = [];
    let v = base;
    order.forEach((m, i) => {
      let d = val(src.masters[m.i]) - base;
      for (let j = 0; j < i; j++) d -= scalarAt(order[j].region, m.nl) * deltas[j];
      deltas.push(d);
      v += scal[i] * d;
    });
    (out[a] ||= {})[b] = Math.round(v); // a 0 still cancels a group pair
  }
  return out;
}

// Turns the width axis on (every master at 100) or off.
export function setWidthAxis(p, on) {
  if (on && !p.axis2) {
    p.axis2 = { tag: 'wdth', min: 100, max: 100 };
    for (const m of p.masters || []) m.loc2 ??= 100;
  } else if (!on && p.axis2) {
    delete p.axis2;
    for (const m of p.masters || []) delete m.loc2;
  }
}

// ---------------------------------------------------------------- family

export const isItalicMaster = (m) => !!m?.italic;
export const hasItalic = (p) => !!p.masters?.some(isItalicMaster);

// The upright or the italic masters as a project of their own, in the saved
// form: the group's master nearest the default location is its default.
// null when the group has no master.
export function familyGroup(p, italic) {
  const src = saveForm(p);
  const ms = (src.masters || []).filter((m) => !!m.italic === !!italic);
  if (!ms.length) return null;
  const def = src.masters[0];
  const dist = (m) => Math.abs(m.loc - def.loc) + Math.abs((m.loc2 ?? 100) - (def.loc2 ?? 100));
  const head = [...ms].sort((a, b) => dist(a) - dist(b))[0];
  const order = [head, ...ms.filter((m) => m !== head)];
  const layer = (g, id) => (id === def.id ? take(g) : g.layers?.[id] || take(g));
  const q = { ...src, masters: order.map((m) => ({ ...m })) };
  // Anchors and components are shared by all masters and drawn upright:
  // in an italic they lean with the letters, or accents would miss them.
  const lean = italic ? Math.tan((head.italicAngle ?? 10) * Math.PI / 180) : 0;
  const cy = (p.info.xHeight || 500) / 2;
  const leaning = (g) => (lean ? {
    ...(g.anchors ? { anchors: g.anchors.map((a) => ({ ...a, x: Math.round(a.x + (a.y - cy) * lean) })) } : {}),
    ...(g.components ? { components: g.components.map((c) => ({ ...c, x: Math.round((c.x || 0) + (c.y || 0) * lean) })) } : {}),
  } : {});
  q.kerning = head.id === def.id ? src.kerning : (head.kerning ?? src.kerning);
  delete q.masters[0].kerning;
  q.glyphs = src.glyphs.map((g) => {
    const base = layer(g, head.id);
    const layers = {};
    for (const m of order.slice(1)) layers[m.id] = layer(g, m.id);
    return { ...g, ...leaning(g), contours: base.contours, advance: base.advance, layers };
  });
  return q;
}

// Kerning of master id, wherever it is kept right now.
export function kerningOf(p, id) {
  if (id === activeId(p)) return p.kerning || {};
  const m = p.masters.find((x) => x.id === id);
  if (m?.kerning) return m.kerning;
  const d = p.masters.find((x) => x.id === defaultId(p));
  return (activeId(p) === defaultId(p) ? p.kerning : d?.kerning) || {};
}

// Contours slanted by `angle` degrees to the right, around the middle of
// the x-height (cy), so the letters do not drift sideways.
export function slantContours(cs, angle, cy) {
  const k = Math.tan(angle * Math.PI / 180);
  const s = (q) => ({ x: Math.round(q.x + (q.y - cy) * k), y: q.y });
  return cs.map((c) => ({ ...c, nodes: c.nodes.map((n) => ({ ...n, ...s(n), ...(n.in ? { in: s(n.in) } : {}), ...(n.out ? { out: s(n.out) } : {}) })) }));
}

// Italic companions of the upright masters: each a slanted copy at the
// same place, marked italic. Returns how many were added.
export function addItalicMasters(p, angle, name = (m) => m) {
  ensureMasters(p);
  const cy = (p.info.xHeight || 500) / 2;
  let n = 0;
  for (const m of p.masters.filter((x) => !x.italic)) {
    const same = (x) => x.italic && x.loc === m.loc && (x.loc2 ?? 100) === (m.loc2 ?? 100);
    if (p.masters.some(same)) continue;
    const kern = clone(kerningOf(p, m.id));
    const id = addMaster(p, name(m.name), m.loc, m.loc2);
    const it = p.masters.find((x) => x.id === id);
    it.italic = true;
    it.italicAngle = angle;
    it.kerning = kern;
    for (const g of p.glyphs) {
      const src = layerOf(p, g, m.id);
      g.layers[id] = { contours: slantContours(clone(src.contours), angle, cy), advance: src.advance };
    }
    n++;
  }
  fitAxis(p);
  return n;
}

// The axis ranges follow the masters.
export function fitAxis(p) {
  if (!p.masters?.length) return;
  p.axis.min = Math.min(...p.masters.map((m) => m.loc));
  p.axis.max = Math.max(...p.masters.map((m) => m.loc));
  if (p.axis2) {
    p.axis2.min = Math.min(...p.masters.map((m) => m.loc2 ?? 100));
    p.axis2.max = Math.max(...p.masters.map((m) => m.loc2 ?? 100));
  }
}

export const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };

// "Bold" + italic -> "Bold Italic"; "Regular" + italic -> "Italic".
export function styleNameFor(weight, italic) {
  const w = WEIGHT_NAMES[weight] || String(weight);
  if (!italic) return w;
  return w === 'Regular' ? 'Italic' : `${w} Italic`;
}

// The styles a family exports when none are set: in each group (upright,
// italic) its masters and the standard weights between them.
export function defaultStyles(p) {
  if (!hasMasters(p)) return [];
  const out = [];
  const def2 = p.masters[0].loc2;
  for (const italic of hasItalic(p) ? [false, true] : [false]) {
    const ms = p.masters.filter((m) => !!m.italic === italic);
    const lo = Math.min(...ms.map((m) => m.loc)), hi = Math.max(...ms.map((m) => m.loc));
    const seen = new Set();
    const add = (weight, name, width) => {
      const key = `${weight}/${width ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name, weight, ...(p.axis2 ? { width: width ?? def2 ?? 100 } : {}), italic, export: true });
    };
    // A master on another width keeps its own name ("Bold Condensed").
    for (const m of ms) add(m.loc, p.axis?.tag === 'wght' && WEIGHT_NAMES[m.loc] && (m.loc2 ?? def2) === def2 ? styleNameFor(m.loc, italic) : m.name, m.loc2);
    if (p.axis?.tag === 'wght') for (let w = 100; w <= 900; w += 100) if (w > lo && w < hi) add(w, styleNameFor(w, italic), def2);
  }
  return out.sort((a, b) => (a.italic - b.italic) || (a.weight - b.weight));
}

// Names must differ: the fonts of a family and their files are told apart by them.
export function uniqueStyles(styles) {
  const used = new Set();
  return styles.map((s) => {
    let name = s.name.trim();
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${s.name.trim()} ${n}`;
    used.add(name.toLowerCase());
    return { ...s, name };
  });
}

// The next style to add: the first standard weight the list does not have.
export function nextStyle(p, styles) {
  const w = [400, 500, 300, 600, 700, 200, 800, 100, 900].find((x) => !styles.some((s) => !s.italic && s.weight === x)) ?? 500;
  return { name: styleNameFor(w, false), weight: w, ...(p.axis2 ? { width: p.masters[0].loc2 ?? 100 } : {}), italic: false, export: true };
}

// The styles to export: the project's own list, or the default one.
export const familyStyles = (p) => (p.styles?.length ? p.styles : defaultStyles(p));
