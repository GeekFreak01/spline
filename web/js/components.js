// Components (extended mode): a glyph drawn inside another glyph as a live
// reference. À = A + grave: redraw A and À follows. Unlike the automatic
// letters of compose.js, the user places components and can move them.
//
// glyph.components = [{ glyph, x, y }] is the data; glyph.refContours is
// the outline built from it, used for drawing, measuring and export. It is
// rebuilt here whenever the project changes.
import { clone } from './model.js';

const MAX_DEPTH = 6; // components inside components, but no endless loops

function build(project, g, byName, depth, seen) {
  const out = [];
  for (const k of g.components || []) {
    const src = byName.get(k.glyph);
    if (!src || seen.has(src.name) || depth > MAX_DEPTH) continue;
    const parts = [...src.contours, ...build(project, src, byName, depth + 1, new Set([...seen, src.name]))];
    for (const c of clone(parts)) {
      for (const n of c.nodes) {
        for (const p of [n, n.in, n.out]) if (p) { p.x = Math.round(p.x + k.x); p.y = Math.round(p.y + k.y); }
      }
      out.push(c);
    }
  }
  return out;
}

// Rebuilds refContours of every glyph with components; returns the glyphs
// whose outline changed.
export function refreshComponents(project) {
  const byName = new Map(project.glyphs.map((g) => [g.name, g]));
  const changed = [];
  for (const g of project.glyphs) {
    if (!g.components?.length) {
      if (g.refContours) { delete g.refContours; changed.push(g); }
      continue;
    }
    const next = build(project, g, byName, 0, new Set([g.name]));
    if (JSON.stringify(next) === JSON.stringify(g.refContours || [])) continue;
    if (next.length) g.refContours = next; else delete g.refContours;
    changed.push(g);
  }
  return changed;
}

// Glyphs that use `name` as a component.
export function usedBy(project, name) {
  return project.glyphs.filter((g) => g.components?.some((k) => k.glyph === name));
}

// Turns the components of g into its own, editable contours.
export function decompose(g) {
  g.contours = [...g.contours, ...clone(g.refContours || [])];
  delete g.components;
  delete g.refContours;
}
