// Undo / redo. Each step stores a snapshot of one glyph or of the kerning.
const LIMIT = 300;
export const KERNING = '#kerning';
export const GROUPS = '#groups';

export class History {
  constructor() { this.undoStack = []; this.redoStack = []; }

  clear() { this.undoStack = []; this.redoStack = []; }

  // Call right before changing a glyph.
  push(glyph) { this.#add(snap(glyph)); }

  // Call right before changing kerning values.
  pushKerning(project) { this.#add({ kerning: structuredClone(project.kerning || {}) }); }

  // Call right before changing kerning groups or substitution rules
  // (renaming a group also renames its kerning keys, so the kerning is
  // kept too).
  pushGroups(project) { this.#add(groupsSnap(project)); }

  #add(s) {
    this.undoStack.push(s);
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
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
    return g.name;
  }
}

const groupsSnap = (p) => ({
  groups: Object.fromEntries(p.glyphs.map((g) => [g.name, [g.kernLeft || '', g.kernRight || '']])),
  kerning: structuredClone(p.kerning || {}),
  contextual: structuredClone(p.contextual || []),
  ligatures: structuredClone(p.ligatures || []),
});
const snap = (g) => ({ name: g.name, advance: g.advance, contours: structuredClone(g.contours) });
