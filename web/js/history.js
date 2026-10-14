// Undo / redo. Each step stores a snapshot of one glyph or of the kerning.
const LIMIT = 300;
export const KERNING = '#kerning';

export class History {
  constructor() { this.undoStack = []; this.redoStack = []; }

  clear() { this.undoStack = []; this.redoStack = []; }

  // Call right before changing a glyph.
  push(glyph) { this.#add(snap(glyph)); }

  // Call right before changing kerning values.
  pushKerning(project) { this.#add({ kerning: structuredClone(project.kerning || {}) }); }

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

const snap = (g) => ({ name: g.name, advance: g.advance, contours: structuredClone(g.contours) });
