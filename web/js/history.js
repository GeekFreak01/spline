// Undo / redo of glyph edits. Each step stores a snapshot of one glyph.
const LIMIT = 300;

export class History {
  constructor() { this.undoStack = []; this.redoStack = []; }

  clear() { this.undoStack = []; this.redoStack = []; }

  // Call right before changing a glyph.
  push(glyph) {
    this.undoStack.push(snap(glyph));
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  // Returns the name of the restored glyph, or null.
  undo(project) { return this.#move(project, this.undoStack, this.redoStack); }
  redo(project) { return this.#move(project, this.redoStack, this.undoStack); }

  #move(project, from, to) {
    const s = from.pop();
    if (!s) return null;
    const g = project.glyphs.find((x) => x.name === s.name);
    if (!g) return null;
    to.push(snap(g));
    g.contours = structuredClone(s.contours);
    g.advance = s.advance;
    return g.name;
  }
}

const snap = (g) => ({ name: g.name, advance: g.advance, contours: structuredClone(g.contours) });
