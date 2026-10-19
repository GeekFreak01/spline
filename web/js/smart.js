// Smart parts (extended mode): a glyph used as a component that changes
// with sliders. Each property ("Length", "Height"...) has a second drawing
// of the part at its maximum; the glyph itself is the part at every
// minimum. A component sets values, and the part is blended:
//
//   outline = base + Σ t_i · (state_i − base),  t_i = (value − min) / (max − min)
//
//   glyph.smart = { props: [{ name, min, max }], states: { [name]: { contours } } }
//   component.props = { [name]: value }
//
// While a state is edited it sits in glyph.contours (all tools work) and
// the base in glyph.smart.base; saveSmart() puts them back for saving.
import { incompatibility, matchContour } from './masters.js';

const clone = (o) => structuredClone(o);

export const isSmart = (g) => !!g?.smart?.props?.length;
export const editingState = (g) => g?.smart?.editing || null;

// The contours of state `name` (null = the base), wherever they are now.
export function stateOf(g, name) {
  const ed = editingState(g);
  if ((name || null) === ed) return g.contours;
  if (!name) return g.smart.base;
  return g.smart.states[name]?.contours || (ed ? g.smart.base : g.contours);
}

// Starts editing state `name` (null = the base). Returns false when nothing changes.
export function editState(g, name) {
  const cur = editingState(g);
  name = name || null;
  if (cur === name) return false;
  // Put the current drawing back where it belongs.
  if (cur) g.smart.states[cur] = { contours: g.contours };
  else g.smart.base = g.contours;
  g.contours = name ? clone(g.smart.states[name]?.contours || g.smart.base) : g.smart.base;
  if (name) delete g.smart.states[name];
  if (name) g.smart.editing = name; else { delete g.smart.editing; delete g.smart.base; }
  return true;
}

// A copy of the project with every smart part in its base state.
export function saveSmart(p) {
  if (!p.glyphs.some(editingState)) return p;
  return {
    ...p,
    glyphs: p.glyphs.map((g) => {
      if (!editingState(g)) return g;
      const smart = { ...g.smart, states: { ...g.smart.states, [g.smart.editing]: { contours: g.contours } } };
      const base = smart.base;
      delete smart.editing; delete smart.base;
      return { ...g, contours: base, smart };
    }),
  };
}

export function addProp(g, name, min = 0, max = 100) {
  g.smart ||= { props: [], states: {} };
  if (g.smart.props.some((x) => x.name === name)) return false;
  g.smart.props.push({ name, min, max });
  g.smart.states[name] = { contours: clone(stateOf(g, null)) };
  return true;
}

export function removeProp(g, name) {
  if (!isSmart(g)) return;
  if (editingState(g) === name) editState(g, null);
  g.smart.props = g.smart.props.filter((x) => x.name !== name);
  delete g.smart.states[name];
  if (!g.smart.props.length) { if (editingState(g)) editState(g, null); delete g.smart; }
}

// Which property states cannot be blended with the base: [{ name, why }].
export function smartProblems(g) {
  if (!isSmart(g)) return [];
  const base = { contours: stateOf(g, null) };
  return g.smart.props
    .map((x) => ({ name: x.name, why: incompatibility(base, { contours: stateOf(g, x.name) }) }))
    .filter((x) => x.why);
}

// The part's contours for the values in props.
export function smartOutline(g, props = {}) {
  const base = stateOf(g, null);
  if (!isSmart(g)) return base;
  const out = clone(base);
  for (const pr of g.smart.props) {
    const v = props[pr.name] ?? pr.min;
    const t = (v - pr.min) / ((pr.max - pr.min) || 1);
    if (!t) continue;
    const st = stateOf(g, pr.name);
    if (incompatibility({ contours: base }, { contours: st })) continue;
    out.forEach((c, i) => {
      const m = matchContour(base[i], st[i]);
      c.nodes.forEach((n, k) => {
        const a = base[i].nodes[k], b = m.nodes[k];
        n.x += (b.x - a.x) * t; n.y += (b.y - a.y) * t;
        if (n.in) { n.in.x += (b.in.x - a.in.x) * t; n.in.y += (b.in.y - a.in.y) * t; }
        if (n.out) { n.out.x += (b.out.x - a.out.x) * t; n.out.y += (b.out.y - a.out.y) * t; }
      });
    });
  }
  return out;
}
