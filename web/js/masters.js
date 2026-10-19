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

export function addMaster(p, name, loc) {
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
  p.masters.push({ id, name, loc });
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
  if (p.masters.length < 2) { delete p.masters; delete p.axis; for (const g of p.glyphs) delete g.layers; }
  return true;
}

// Why two outlines cannot be interpolated, or '' when they can: the same
// contours, the same number of points, the same handles.
const sameCurves = (x, y) => x.nodes.every((n, k) => !!n.in === !!y.nodes[k].in && !!n.out === !!y.nodes[k].out);

// Contour y in the point order of x: as it is, or turned around (the
// editor may have reversed it), or null when they do not match.
function matchContour(x, y) {
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

const lerp = (a, b, t) => a + (b - a) * t;
function lerpOutline(a, b, t) {
  return {
    advance: Math.round(lerp(a.advance, b.advance, t)),
    contours: a.contours.map((c, i) => {
      const mc = matchContour(c, b.contours[i]);
      return {
        closed: c.closed,
        nodes: c.nodes.map((n, k) => {
          const m = mc.nodes[k];
          const q = { x: lerp(n.x, m.x, t), y: lerp(n.y, m.y, t) };
          if (n.in) q.in = { x: lerp(n.in.x, m.in.x, t), y: lerp(n.in.y, m.in.y, t) };
          if (n.out) q.out = { x: lerp(n.out.x, m.out.x, t), y: lerp(n.out.y, m.out.y, t) };
          if (n.smooth) q.smooth = true;
          return q;
        }),
      };
    }),
  };
}

// A plain project (no masters) at location loc of the axis. Glyphs that
// cannot be interpolated take the nearest master.
export function instanceAt(p, loc, styleName) {
  const src = saveForm(p);
  const ms = [...src.masters].sort((a, b) => a.loc - b.loc);
  let i = 0;
  while (i < ms.length - 2 && loc > ms[i + 1].loc) i++;
  const A = ms[i], B = ms[i + 1];
  const t = Math.max(0, Math.min(1, (loc - A.loc) / ((B.loc - A.loc) || 1)));
  const def = src.masters[0].id;
  const get = (g, id) => (id === def ? take(g) : g.layers?.[id] || take(g));
  const q = clone({ ...src, glyphs: [] });
  delete q.masters; delete q.axis; delete q.activeMaster;
  q.info = { ...q.info, ...(styleName ? { styleName } : {}), weight: q.axis?.tag === 'wght' || src.axis?.tag === 'wght' ? Math.round(loc) : q.info.weight };
  q.glyphs = src.glyphs.map((g) => {
    const a = get(g, A.id), b = get(g, B.id);
    const out = incompatibility(a, b) ? (t < 0.5 ? a : b) : lerpOutline(a, b, t);
    const copy = { ...g, contours: clone(out.contours), advance: out.advance };
    delete copy.layers;
    return copy;
  });
  return q;
}
