// Undo / redo. Each step stores a snapshot of one glyph or of the kerning.
const LIMIT = 300;
// About this many points in all snapshots together (~100 bytes each): a
// complex glyph with masters and a background is MBs per step.
const POINT_LIMIT = 1_500_000;

// Points in a snapshot: its outlines, the other masters, the background.
function weigh(s) {
  let n = 0;
  const add = (cs) => { for (const c of cs || []) n += c.nodes?.length || 0; };
  add(s.contours);
  add(s.background);
  for (const l of Object.values(s.layers || {})) add(l.contours);
  return n + 1;
}
export const KERNING = '#kerning';
export const GROUPS = '#groups';

export class History {
  constructor() { this.undoStack = []; this.redoStack = []; }

  clear() { this.undoStack = []; this.redoStack = []; }

  // Call right before changing a glyph. A letter built from parts (see
  // compose.js) that is edited by hand stops following its parts.
  push(glyph) {
    this.#add(snap(glyph));
    if (glyph.compose) { delete glyph.compose; glyph.composeOff = true; }
  }

  // Call right before changing kerning values.
  pushKerning(project) { this.#add({ kerning: structuredClone(project.kerning || {}) }); }

  // Call right before changing kerning groups or substitution rules
  // (renaming a group also renames its kerning keys, so the kerning is
  // kept too).
  pushGroups(project) { this.#add(groupsSnap(project)); }

  #add(s) {
    s.weight = weigh(s);
    this.undoStack.push(s);
    let total = this.undoStack.reduce((a, x) => a + (x.weight || 1), 0);
    while (this.undoStack.length > 1 && (this.undoStack.length > LIMIT || total > POINT_LIMIT)) {
      total -= this.undoStack.shift().weight || 1;
    }
    this.redoStack = [];
  }

  // Returns the name of the restored glyph (or KERNING), or null.
  undo(project) { return this.#move(project, this.undoStack, this.redoStack); }
  redo(project) { return this.#move(project, this.redoStack, this.undoStack); }

  #move(project, from, to) {
    const s = from.pop();
    if (!s) return null;
    if (s.groups) {
      to.push(groupsSnap(project));
      for (const g of project.glyphs) {
        const [l, r] = s.groups[g.name] || [];
        if (l) g.kernLeft = l; else delete g.kernLeft;
        if (r) g.kernRight = r; else delete g.kernRight;
      }
      project.kerning = structuredClone(s.kerning);
      project.contextual = structuredClone(s.contextual);
      project.ligatures = structuredClone(s.ligatures);
      return GROUPS;
    }
    if (s.kerning) {
      to.push({ kerning: structuredClone(project.kerning || {}) });
      project.kerning = structuredClone(s.kerning);
      return KERNING;
    }
    const g = project.glyphs.find((x) => x.name === s.name);
    if (!g) return null;
    to.push(snap(g));
    g.contours = structuredClone(s.contours);
    g.advance = s.advance;
    if (s.compose) g.compose = structuredClone(s.compose); else delete g.compose;
    if (s.composeOff) g.composeOff = true; else delete g.composeOff;
    if (s.anchors) g.anchors = structuredClone(s.anchors); else delete g.anchors;
    if (s.components) g.components = structuredClone(s.components); else delete g.components;
    if (s.background) g.background = structuredClone(s.background); else delete g.background;
    // Other masters' outlines: "edit all masters" changes them too.
    if (s.layers) g.layers = structuredClone(s.layers); else delete g.layers;
    return g.name;
  }
}

const groupsSnap = (p) => ({
  groups: Object.fromEntries(p.glyphs.map((g) => [g.name, [g.kernLeft || '', g.kernRight || '']])),
  kerning: structuredClone(p.kerning || {}),
  contextual: structuredClone(p.contextual || []),
  ligatures: structuredClone(p.ligatures || []),
});
const snap = (g) => ({
  name: g.name, advance: g.advance, contours: structuredClone(g.contours),
  compose: g.compose && structuredClone(g.compose), composeOff: !!g.composeOff,
  background: g.background && structuredClone(g.background),
  components: g.components && structuredClone(g.components),
  anchors: g.anchors && structuredClone(g.anchors),
  layers: g.layers && structuredClone(g.layers),
});
