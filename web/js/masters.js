// Masters (extended mode): the same glyphs drawn several times along an
// axis, e.g. Regular (wght 400) and Bold (wght 700). Everything in between
// is interpolated: instances for export, a variable font, the preview.
//
//   project.axis    = { tag: 'wght', min, max }
//   project.masters = [{ id, name, loc }]   the first one is the default
//   glyph.layers    = { [masterId]: { contours, advance } } for the others
//
// While a master other than the default is edited, its outlines sit in
// glyph.contours (so every tool works unchanged) and the default's in
// glyph.layers[defaultId]. serialize() always writes the default in
// glyph.contours, see saveForm().
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
  delete q.activeMaster;
  return q;
}

export function addMaster(p, name, loc, loc2) {
  // Contours in their final direction first: the editor turns them on
  // every edit, and the masters must keep the same point order.
  for (const g of p.glyphs) normalizeDirections(g);
  if (!p.masters?.length) {
    p.axis ||= { tag: 'wght', min: 100, max: 900 };
    p.masters = [{ id: 'm0', name: p.info.styleName || 'Regular', loc: p.info.weight || 400 }];
  }
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
    closed: c.closed,
    nodes: c.nodes.map((n) => {
      const q = { x: nums[k++], y: nums[k++] };
      if (n.in) q.in = { x: nums[k++], y: nums[k++] };
      if (n.out) q.out = { x: nums[k++], y: nums[k++] };
      if (n.smooth) q.smooth = true;
      return q;
    }),
  }));
  return { contours, advance: Math.round(nums[k]) };
}

// A plain project (no masters) at a location: loc on the first axis and
// loc2 on the second. Glyphs drawn differently in some master take the
// default outline.
export function instanceAt(p, loc, styleName, loc2) {
  const src = saveForm(p);
  const { norm, order } = variationModel(src);
  const def = src.masters[0];
  const target = norm([loc, ...(src.axis2 ? [loc2 ?? def.loc2 ?? 100] : [])]);
  const scal = order.map((m) => scalarAt(m.region, target));
  const get = (g, id) => (id === def.id ? take(g) : g.layers?.[id] || take(g));
  const q = clone({ ...src, glyphs: [] });
  delete q.masters; delete q.axis; delete q.axis2; delete q.activeMaster;
  q.info = { ...q.info, ...(styleName ? { styleName } : {}), weight: src.axis?.tag === 'wght' ? Math.round(loc) : q.info.weight };
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
  return q;
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
