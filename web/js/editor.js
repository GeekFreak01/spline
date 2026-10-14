// Canvas glyph editor: select, pen, brush, eraser, rectangle, ellipse, hand.
import {
  segments, pointAt, tracePath, flatten, polyBox, normalizeDirections, insertNode,
  rectContour, ellipseContour, movePoint, charOf,
} from './model.js';
import { applyStroke } from './trace.js';
import { unite, subtract, removeOverlap, shapesOf, pathOperation } from './boolean.js';
import { t } from './i18n.js';

const HIT = 9; // px
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Ctrl (Cmd on Mac) or Alt: work on one side of a point only.
const isCuspKey = (e) => e.ctrlKey || e.metaKey || e.altKey;

// Shift: snap the direction from `o` to `p` to a multiple of 45°.
function snap45(o, p) {
  const dx = p.x - o.x, dy = p.y - o.y;
  const len = Math.hypot(dx, dy);
  if (!len) return { x: p.x, y: p.y };
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  // Project onto the snapped direction so the point stays under the cursor.
  const proj = dx * Math.cos(a) + dy * Math.sin(a);
  return { x: o.x + Math.cos(a) * proj, y: o.y + Math.sin(a) * proj };
}

export class Editor {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.glyph = null;
    this.tool = 'brush';
    this.brushRadius = 45;
    this.showGuide = true;
    this.showGrid = true;
    this.gridStep = 50;      // font units
    this.snapGrid = false;   // snap to grid intersections
    this.snapGuides = true;  // snap to metric lines and sidebearings
    this.stabilizer = 4;     // 0..10, smooths brush input
    this.snapMark = null;    // last snapped point, drawn as a marker
    this.view = { scale: 0.5, ox: 0, oy: 0 };
    this.sel = new Set(); // "contourIndex:nodeIndex"
    this.drag = null;
    this.penContour = null;
    this.hover = null; // font coords of the pointer
    this.spaceDown = false;
    this.dpr = window.devicePixelRatio || 1;
    this.hitCtx = document.createElement('canvas').getContext('2d');

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.app.onCursor?.(null); this.render(); });
    canvas.addEventListener('dblclick', (e) => this.onDblClick(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  // ---------------------------------------------------------------- setup

  open(glyph) {
    this.finishPen();
    this.glyph = glyph;
    this.sel.clear();
    this.drag = null;
    this.fit();
    this.updateAria();
  }

  updateAria() {
    if (!this.glyph) return;
    this.canvas.setAttribute('aria-label', `${t('glyph')} ${charOf(this.glyph) || this.glyph.name}`);
  }

  setTool(tool) {
    if (tool !== 'pen') this.finishPen();
    this.tool = tool;
    this.canvas.dataset.tool = tool;
    this.render();
  }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    const first = !this.canvas.width;
    this.canvas.width = Math.max(1, Math.round(box.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(box.height * this.dpr));
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
    this.w = box.width;
    this.h = box.height;
    if (first || this.needsFit) this.fit();
    this.render();
  }

  fit() {
    if (!this.glyph || !this.w) { this.needsFit = true; return; }
    this.needsFit = false;
    const info = this.app.project.info;
    const top = info.ascender + 80, bottom = info.descender - 60;
    const width = Math.max(this.glyph.advance, 300);
    const pad = 48;
    const scale = Math.min((this.w - pad * 2) / width, (this.h - pad * 2) / (top - bottom));
    this.view.scale = Math.max(0.05, scale);
    this.app.onZoom?.(this.view.scale);
    this.view.ox = (this.w - width * this.view.scale) / 2;
    this.view.oy = pad + top * this.view.scale + ((this.h - pad * 2) - (top - bottom) * this.view.scale) / 2;
    this.render();
  }

  zoomBy(f, sx = this.w / 2, sy = this.h / 2) {
    const v = this.view;
    const ns = Math.min(20, Math.max(0.03, v.scale * f));
    const k = ns / v.scale;
    v.ox = sx - (sx - v.ox) * k;
    v.oy = sy - (sy - v.oy) * k;
    v.scale = ns;
    this.app.onZoom?.(ns);
    this.render();
  }

  // ---------------------------------------------------------------- coords

  toScreen(p) { return { x: this.view.ox + p.x * this.view.scale, y: this.view.oy - p.y * this.view.scale }; }

  toFont(sx, sy) { return { x: (sx - this.view.ox) / this.view.scale, y: (this.view.oy - sy) / this.view.scale }; }

  eventPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  // ---------------------------------------------------------------- hit tests

  nodeAt(sx, sy) {
    const cs = this.glyph.contours;
    for (let ci = cs.length - 1; ci >= 0; ci--) {
      for (let ni = 0; ni < cs[ci].nodes.length; ni++) {
        const s = this.toScreen(cs[ci].nodes[ni]);
        if (Math.hypot(s.x - sx, s.y - sy) <= HIT) return { ci, ni };
      }
    }
    return null;
  }

  handleAt(sx, sy) {
    if (!this.showsPoints()) return null;
    const cs = this.glyph.contours;
    for (let ci = cs.length - 1; ci >= 0; ci--) {
      for (let ni = 0; ni < cs[ci].nodes.length; ni++) {
        const n = cs[ci].nodes[ni];
        for (const which of ['in', 'out']) {
          if (!n[which]) continue;
          const s = this.toScreen(n[which]);
          if (Math.hypot(s.x - sx, s.y - sy) <= HIT - 2) return { ci, ni, which };
        }
      }
    }
    return null;
  }

  contourAt(sx, sy) {
    const p = this.toFont(sx, sy);
    const cs = this.glyph.contours;
    for (let ci = cs.length - 1; ci >= 0; ci--) {
      const ctx = this.hitCtx;
      ctx.beginPath();
      tracePath(ctx, { contours: [{ ...cs[ci], closed: true }] });
      if (ctx.isPointInPath(p.x, p.y)) return ci;
    }
    return -1;
  }

  segmentAt(sx, sy) {
    let best = null;
    this.glyph.contours.forEach((c, ci) => {
      for (const s of segments(c)) {
        for (let k = 1; k < 40; k++) {
          const tt = k / 40;
          const q = this.toScreen(pointAt(s, tt));
          const d = Math.hypot(q.x - sx, q.y - sy);
          if (d <= HIT && (!best || d < best.d)) best = { d, ci, s, t: tt };
        }
      }
    });
    return best;
  }

  nearAdvance(sx) {
    return Math.abs(sx - this.toScreen({ x: this.glyph.advance, y: 0 }).x) <= 6;
  }

  showsPoints() { return this.tool === 'select' || this.tool === 'pen'; }

  // ---------------------------------------------------------------- pointer

  activeTool() { return this.spaceDown ? 'hand' : this.tool; }

  checkpoint() {
    if (this.drag && !this.drag.saved) {
      this.app.history.push(this.glyph);
      this.drag.saved = true;
    }
  }

  // Snaps a point like a CAD program: to a guide line (baseline, x-height,
  // cap height, ascender, descender, sidebearings) when it is close, and to
  // the grid intersections when grid snapping is on.
  snap(p, { guides = true } = {}) {
    let { x, y } = p;
    let hx = false, hy = false;
    if (this.snapGuides && guides && this.glyph) {
      const info = this.app.project.info;
      const tol = 7 / this.view.scale;
      const near = (v, list) => {
        let best = null;
        for (const c of list) if (Math.abs(v - c) <= tol && (best === null || Math.abs(v - c) < Math.abs(v - best))) best = c;
        return best;
      };
      const gy = near(y, [info.ascender, info.capHeight, info.xHeight, 0, info.descender]);
      const gx = near(x, [0, this.glyph.advance]);
      if (gy !== null) { y = gy; hy = true; }
      if (gx !== null) { x = gx; hx = true; }
    }
    if (this.snapGrid) {
      const st = this.gridStep;
      if (!hx) { x = Math.round(x / st) * st; hx = true; }
      if (!hy) { y = Math.round(y / st) * st; hy = true; }
    }
    this.snapMark = hx || hy ? { x, y } : null;
    return { x, y };
  }

  onDown(e) {
    if (!this.glyph || e.button > 1) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus({ preventScroll: true });
    const { sx, sy } = this.eventPos(e);
    const p = this.toFont(sx, sy);
    const tool = e.button === 1 ? 'hand' : this.activeTool();

    if (tool === 'hand') {
      this.drag = { kind: 'pan', sx, sy, ox: this.view.ox, oy: this.view.oy };
    } else if (tool === 'select') {
      this.downSelect(e, sx, sy, p);
    } else if (tool === 'pen') {
      this.downPen(e, sx, sy, p);
    } else if (tool === 'rect' || tool === 'ellipse') {
      const sp = this.snap(p);
      this.drag = { kind: 'shape', tool, start: sp, end: sp };
    } else if (tool === 'brush' || tool === 'eraser') {
      this.drag = { kind: 'stroke', erase: tool === 'eraser', points: [p], start: p, lastS: { sx, sy } };
    }
    this.render();
  }

  downSelect(e, sx, sy, p) {
    const h = this.handleAt(sx, sy);
    if (h) {
      this.drag = { kind: 'handle', ...h, start: p, cusp: isCuspKey(e) };
      return;
    }
    const n = this.nodeAt(sx, sy);
    if (n) {
      const key = `${n.ci}:${n.ni}`;
      if (e.shiftKey) {
        if (this.sel.has(key)) this.sel.delete(key); else this.sel.add(key);
      } else if (!this.sel.has(key)) {
        this.sel = new Set([key]);
      }
      // Ctrl/Alt-click on a point makes it sharp on both sides.
      const grabbed = this.glyph.contours[n.ci].nodes[n.ni];
      this.drag = {
        kind: 'move', start: p, applied: { x: 0, y: 0 }, ref: { x: grabbed.x, y: grabbed.y },
        cuspNode: isCuspKey(e) ? n : null,
      };
      return;
    }
    if (this.nearAdvance(sx)) {
      this.drag = { kind: 'advance' };
      return;
    }
    const ci = this.contourAt(sx, sy);
    if (ci >= 0) {
      const keys = this.glyph.contours[ci].nodes.map((_, ni) => `${ci}:${ni}`);
      const all = keys.every((k) => this.sel.has(k));
      if (!e.shiftKey && !all) this.sel = new Set();
      keys.forEach((k) => this.sel.add(k));
      const first = this.glyph.contours[ci].nodes[0];
      this.drag = { kind: 'move', start: p, applied: { x: 0, y: 0 }, ref: { x: first.x, y: first.y } };
      return;
    }
    if (!e.shiftKey) this.sel.clear();
    this.drag = { kind: 'marquee', start: { sx, sy }, end: { sx, sy }, base: new Set(this.sel) };
  }

  downPen(e, sx, sy, p) {
    const cs = this.glyph.contours;
    const open = this.penContour !== null ? cs[this.penContour] : null;
    if (open && open.nodes.length >= 2) {
      const first = this.toScreen(open.nodes[0]);
      if (Math.hypot(first.x - sx, first.y - sy) <= HIT) {
        this.app.history.push(this.glyph);
        open.closed = true;
        this.penContour = null;
        this.afterEdit();
        return;
      }
    }
    // Clicking the point just placed removes its outgoing handle: the curve
    // comes in round and leaves sharp. Dragging redraws only that handle.
    const last = open?.nodes[open.nodes.length - 1];
    if (last) {
      const ls = this.toScreen(last);
      if (Math.hypot(ls.x - sx, ls.y - sy) <= HIT) {
        this.app.history.push(this.glyph);
        delete last.out;
        last.smooth = false;
        this.drag = { kind: 'penHandle', node: last, start: { sx, sy }, saved: true, outOnly: true };
        return;
      }
    }
    this.app.history.push(this.glyph);
    if (e.shiftKey && last) p = snap45(last, p);
    else p = this.snap(p);
    const node = { x: Math.round(p.x), y: Math.round(p.y) };
    if (open) {
      open.nodes.push(node);
    } else {
      cs.push({ closed: false, nodes: [node] });
      this.penContour = cs.length - 1;
    }
    const ci = this.penContour;
    this.sel = new Set([`${ci}:${cs[ci].nodes.length - 1}`]);
    this.drag = { kind: 'penHandle', node, start: { sx, sy }, saved: true };
  }

  onMove(e) {
    if (!this.glyph) return;
    const { sx, sy } = this.eventPos(e);
    const p = this.toFont(sx, sy);
    this.hover = p;
    this.app.onCursor?.(p);
    const d = this.drag;
    if (!d) {
      // Preview where a new point would land.
      const t0 = this.activeTool();
      if (t0 === 'pen' || t0 === 'rect' || t0 === 'ellipse') this.app.onCursor?.(this.snap(p));
      else this.snapMark = null;
      this.updateCursor(sx, sy);
      this.render();
      return;
    }
    switch (d.kind) {
      case 'pan':
        this.view.ox = d.ox + sx - d.sx;
        this.view.oy = d.oy + sy - d.sy;
        break;
      case 'move': {
        // Shift keeps the movement horizontal, vertical or diagonal.
        let total = { x: p.x - d.start.x, y: p.y - d.start.y };
        if (e.shiftKey) {
          total = snap45({ x: 0, y: 0 }, total);
        } else {
          // The grabbed point lands exactly on the grid / guide line.
          const target = this.snap({ x: d.ref.x + total.x, y: d.ref.y + total.y });
          total = { x: target.x - d.ref.x, y: target.y - d.ref.y };
        }
        const dx = total.x - d.applied.x, dy = total.y - d.applied.y;
        if (!d.moved && Math.hypot(total.x, total.y) * this.view.scale < 2) break;
        if (dx || dy) {
          this.checkpoint();
          for (const n of this.selectedNodes()) movePoint(n, dx, dy, true);
          d.applied = total;
          d.moved = true;
        }
        break;
      }
      case 'handle': {
        if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) * this.view.scale < 2) break;
        this.checkpoint();
        const n = this.glyph.contours[d.ci].nodes[d.ni];
        const hp = e.shiftKey ? snap45(n, p) : this.snap(p);
        n[d.which] = { x: hp.x, y: hp.y };
        const other = d.which === 'in' ? 'out' : 'in';
        // Ctrl/Alt breaks the link: only this side of the point changes.
        if (d.cusp || isCuspKey(e)) n.smooth = false;
        if (n.smooth && n[other]) {
          const len = Math.hypot(n[other].x - n.x, n[other].y - n.y);
          const vx = n.x - p.x, vy = n.y - p.y;
          const l = Math.hypot(vx, vy) || 1;
          n[other] = { x: n.x + (vx / l) * len, y: n.y + (vy / l) * len };
          n[d.which] = { x: hp.x, y: hp.y };
        }
        d.moved = true;
        break;
      }
      case 'advance':
        this.checkpoint();
        this.glyph.advance = Math.max(0, Math.round(this.snapGrid ? this.snap(p, { guides: false }).x : p.x));
        d.moved = true;
        this.app.onGlyphMetricsChanged?.();
        break;
      case 'marquee':
        d.end = { sx, sy };
        break;
      case 'penHandle':
        if (Math.hypot(sx - d.start.sx, sy - d.start.sy) > 3) {
          const hp = e.shiftKey ? snap45(d.node, p) : this.snap(p);
          d.node.out = { x: hp.x, y: hp.y };
          // Ctrl/Alt: only the outgoing handle, the incoming side stays as it is.
          if (d.outOnly || isCuspKey(e)) {
            d.outOnly = true;
            d.node.smooth = false;
          } else {
            d.node.in = { x: 2 * d.node.x - hp.x, y: 2 * d.node.y - hp.y };
            d.node.smooth = true;
          }
        }
        break;
      case 'shape':
        d.end = this.snap(p);
        d.shift = e.shiftKey;
        break;
      case 'stroke': {
        // Coalesced events give smoother strokes with a pen or fast mouse.
        if (e.shiftKey) { // straight stroke from the starting point
          d.points = [d.start, snap45(d.start, p)];
          d.straight = true;
          break;
        }
        if (d.straight) { d.points = [d.start]; d.straight = false; }
        // The stabilizer lets the stroke trail behind the pointer, which
        // removes hand jitter (like a "lazy brush" in drawing programs).
        const k = 1 - Math.min(10, Math.max(0, this.stabilizer)) * 0.085;
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of evs.length ? evs : [e]) {
          const q = this.eventPos(ev);
          if (Math.hypot(q.sx - d.lastS.sx, q.sy - d.lastS.sy) < 1.5) continue;
          const raw = this.toFont(q.sx, q.sy);
          const last = d.points[d.points.length - 1];
          d.points.push({ x: last.x + (raw.x - last.x) * k, y: last.y + (raw.y - last.y) * k });
          d.lastS = q;
        }
        break;
      }
    }
    this.render();
  }

  onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.glyph) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    switch (d.kind) {
      case 'move':
        if (d.moved) { this.roundSelection(); this.afterEdit(); } else if (d.cuspNode) {
          // Ctrl/Alt-click on a point: sharp corner on both sides.
          const n = this.glyph.contours[d.cuspNode.ci].nodes[d.cuspNode.ni];
          this.app.history.push(this.glyph);
          delete n.in; delete n.out; n.smooth = false;
          this.afterEdit();
        }
        break;
      case 'handle':
        if (d.moved) { this.roundSelection(); this.afterEdit(); } else if (d.cusp) {
          // Ctrl/Alt-click on a handle removes it: that side becomes sharp,
          // the other side keeps its curve.
          const n = this.glyph.contours[d.ci].nodes[d.ni];
          this.app.history.push(this.glyph);
          delete n[d.which];
          n.smooth = false;
          this.afterEdit();
        }
        break;
      case 'advance':
        if (d.moved) this.afterEdit();
        break;
      case 'marquee': {
        const x0 = Math.min(d.start.sx, d.end.sx), x1 = Math.max(d.start.sx, d.end.sx);
        const y0 = Math.min(d.start.sy, d.end.sy), y1 = Math.max(d.start.sy, d.end.sy);
        this.sel = new Set(d.base);
        this.glyph.contours.forEach((c, ci) => c.nodes.forEach((n, ni) => {
          const s = this.toScreen(n);
          if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) this.sel.add(`${ci}:${ni}`);
        }));
        break;
      }
      case 'penHandle':
        this.afterEdit(false);
        break;
      case 'shape': {
        let { start: a, end: b } = d;
        if (d.shift) {
          const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          b = { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s };
        }
        if (Math.abs(b.x - a.x) < 4 || Math.abs(b.y - a.y) < 4) break;
        const r = (v) => Math.round(v);
        const make = d.tool === 'rect' ? rectContour : ellipseContour;
        this.app.history.push(this.glyph);
        this.glyph.contours.push(make(r(a.x), r(a.y), r(b.x), r(b.y)));
        this.afterEdit();
        break;
      }
      case 'stroke':
        this.finishStroke(d);
        break;
    }
    this.render();
  }

  // A brush stroke is traced on its own and then merged into the outline by
  // a vector union (or subtracted for the eraser). Parts of the outline away
  // from the stroke keep their exact curves.
  finishStroke(d) {
    const r = this.brushRadius;
    const strokeShape = applyStroke([], d.points, r, false);
    if (!strokeShape.length) return;
    let area = polyBox(strokeShape.flatMap((c) => flatten(c, 6)));
    const cs = this.glyph.contours.filter((c) => c.closed && c.nodes.length >= 2);
    const boxes = cs.map((c) => polyBox(flatten(c, 6)));
    const hit = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
    // Touched contours plus everything overlapping them, so the holes of a
    // touched outline stay with it.
    const affected = new Set();
    let grew = true;
    while (grew) {
      grew = false;
      cs.forEach((c, i) => {
        if (!affected.has(i) && hit(boxes[i], area)) {
          affected.add(i);
          area = {
            minX: Math.min(area.minX, boxes[i].minX), minY: Math.min(area.minY, boxes[i].minY),
            maxX: Math.max(area.maxX, boxes[i].maxX), maxY: Math.max(area.maxY, boxes[i].maxY),
          };
          grew = true;
        }
      });
    }
    if (d.erase && affected.size === 0) return;
    const base = [...affected].map((i) => cs[i]);
    let merged;
    try {
      merged = d.erase ? subtract(base, strokeShape) : (base.length ? unite(base, strokeShape) : strokeShape);
    } catch (err) {
      // Fall back to re-tracing the bitmap if the vector operation fails.
      console.warn('boolean operation failed, re-tracing', err);
      merged = applyStroke(base, d.points, r, d.erase);
    }
    this.app.history.push(this.glyph);
    const gone = new Set(base);
    this.glyph.contours = [...this.glyph.contours.filter((c) => !gone.has(c)), ...merged];
    this.sel.clear();
    this.afterEdit();
  }

  // Vector-editor path operations on the selected contours (or all of them).
  pathOp(kind) {
    const cs = this.glyph.contours;
    const closed = cs.map((c, i) => (c.closed && c.nodes.length >= 2 ? i : -1)).filter((i) => i >= 0);
    let picked = new Set([...this.sel].map((k) => Number(k.split(':')[0])).filter((i) => closed.includes(i)));
    if (kind === 'removeOverlap' || !picked.size) picked = new Set(closed);
    let result, used;
    if (kind === 'removeOverlap') {
      used = picked;
      result = removeOverlap([...picked].map((i) => cs[i]));
    } else {
      const shapes = shapesOf(cs, picked);
      if (shapes.length < 2 && kind !== 'unite') return false;
      result = pathOperation(kind, shapes.map((sh) => sh.map((i) => cs[i])));
      used = new Set(shapes.flat());
    }
    if (!result) return false;
    this.app.history.push(this.glyph);
    const keep = cs.filter((_, i) => !used.has(i));
    this.glyph.contours = [...keep, ...result];
    this.sel = new Set();
    for (let ci = keep.length; ci < this.glyph.contours.length; ci++) {
      this.glyph.contours[ci].nodes.forEach((_, ni) => this.sel.add(`${ci}:${ni}`));
    }
    this.penContour = null;
    this.afterEdit();
    return true;
  }

  // Numbers for the selection panel: one point (with its handles) or the
  // bounding box of several points.
  selectionInfo() {
    const nodes = this.selectedNodes();
    if (!nodes.length) return null;
    if (nodes.length === 1) {
      const n = nodes[0];
      return { single: true, x: n.x, y: n.y, inX: n.in?.x, inY: n.in?.y, outX: n.out?.x, outY: n.out?.y };
    }
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { single: false, count: nodes.length, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  // Applies a value typed into the selection panel.
  setSelectionValue(field, v, keepRatio = false) {
    const nodes = this.selectedNodes();
    const info = this.selectionInfo();
    if (!info || !Number.isFinite(v)) return;
    this.app.history.push(this.glyph);
    if (info.single) {
      const n = nodes[0];
      if (field === 'x') movePoint(n, v - n.x, 0, true);
      if (field === 'y') movePoint(n, 0, v - n.y, true);
      const h = { inX: ['in', 'x'], inY: ['in', 'y'], outX: ['out', 'x'], outY: ['out', 'y'] }[field];
      if (h) {
        if (!n[h[0]]) n[h[0]] = { x: n.x, y: n.y };
        n[h[0]][h[1]] = v;
        n.smooth = false;
      }
    } else {
      let dx = 0, dy = 0, sx = 1, sy = 1;
      if (field === 'x') dx = v - info.x;
      if (field === 'y') dy = v - info.y;
      if (field === 'w' && info.w > 0 && v > 0) { sx = v / info.w; if (keepRatio) sy = sx; }
      if (field === 'h' && info.h > 0 && v > 0) { sy = v / info.h; if (keepRatio) sx = sy; }
      const f = (p) => ({
        x: Math.round(info.x + (p.x - info.x) * sx + dx),
        y: Math.round(info.y + (p.y - info.y) * sy + dy),
      });
      for (const n of nodes) {
        if (n.in) n.in = f(n.in);
        if (n.out) n.out = f(n.out);
        Object.assign(n, f(n));
      }
    }
    this.afterEdit();
  }

  onDblClick(e) {
    if (!this.glyph || this.tool !== 'select') return;
    const { sx, sy } = this.eventPos(e);
    const n = this.nodeAt(sx, sy);
    if (n) {
      this.app.history.push(this.glyph);
      this.toggleSmooth(this.glyph.contours[n.ci], n.ni);
      this.afterEdit();
      return;
    }
    const seg = this.segmentAt(sx, sy);
    if (seg) {
      this.app.history.push(this.glyph);
      const c = this.glyph.contours[seg.ci];
      insertNode(c, seg.s, seg.t);
      this.sel = new Set([`${seg.ci}:${seg.s.i + 1}`]);
      this.roundSelection();
      this.afterEdit();
    }
  }

  toggleSmooth(c, ni) {
    const n = c.nodes[ni];
    if (n.smooth) { n.smooth = false; return; }
    n.smooth = true;
    const len = c.nodes.length;
    const prev = c.nodes[(ni - 1 + len) % len], next = c.nodes[(ni + 1) % len];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l;
    const lin = n.in ? Math.hypot(n.in.x - n.x, n.in.y - n.y) : Math.hypot(n.x - prev.x, n.y - prev.y) / 3;
    const lout = n.out ? Math.hypot(n.out.x - n.x, n.out.y - n.y) : Math.hypot(next.x - n.x, next.y - n.y) / 3;
    n.in = { x: Math.round(n.x - ux * lin), y: Math.round(n.y - uy * lin) };
    n.out = { x: Math.round(n.x + ux * lout), y: Math.round(n.y + uy * lout) };
  }

  onWheel(e) {
    e.preventDefault();
    const { sx, sy } = this.eventPos(e);
    if (e.shiftKey && !e.ctrlKey) {
      this.view.ox -= e.deltaY;
      this.render();
      return;
    }
    this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), sx, sy);
  }

  updateCursor(sx, sy) {
    const tool = this.activeTool();
    let cur = 'crosshair';
    if (tool === 'hand') cur = this.drag ? 'grabbing' : 'grab';
    else if (tool === 'brush' || tool === 'eraser') cur = 'none';
    else if (tool === 'select') {
      if (this.handleAt(sx, sy) || this.nodeAt(sx, sy)) cur = 'pointer';
      else if (this.nearAdvance(sx)) cur = 'ew-resize';
      else if (this.contourAt(sx, sy) >= 0) cur = 'move';
      else cur = 'default';
    }
    this.canvas.style.cursor = cur;
  }

  // ---------------------------------------------------------------- edits

  selectedNodes() {
    const out = [];
    for (const key of this.sel) {
      const [ci, ni] = key.split(':').map(Number);
      const n = this.glyph.contours[ci]?.nodes[ni];
      if (n) out.push(n);
    }
    return out;
  }

  roundSelection() {
    const r = (o) => { o.x = Math.round(o.x); o.y = Math.round(o.y); };
    for (const n of this.selectedNodes()) {
      r(n);
      if (n.in) r(n.in);
      if (n.out) r(n.out);
    }
  }

  afterEdit(normalize = true) {
    if (normalize) {
      const cs = this.glyph.contours;
      for (const c of normalizeDirections(this.glyph)) {
        const ci = cs.indexOf(c), last = c.nodes.length - 1;
        this.sel = new Set([...this.sel].map((k) => {
          const [a, b] = k.split(':').map(Number);
          return a === ci ? `${a}:${last - b}` : k;
        }));
      }
    }
    this.app.commitGlyph(this.glyph);
    this.render();
  }

  finishPen() {
    if (this.penContour === null || !this.glyph) { this.penContour = null; return; }
    const c = this.glyph.contours[this.penContour];
    this.penContour = null;
    if (!c) return;
    if (c.nodes.length >= 3) c.closed = true;
    else this.glyph.contours.splice(this.glyph.contours.indexOf(c), 1);
    this.sel.clear();
    this.afterEdit();
  }

  selectAll() {
    this.sel = new Set();
    this.glyph.contours.forEach((c, ci) => c.nodes.forEach((_, ni) => this.sel.add(`${ci}:${ni}`)));
    if (this.tool !== 'select') this.setTool('select');
    this.render();
  }

  deleteSelection() {
    if (!this.sel.size) return false;
    this.app.history.push(this.glyph);
    const byContour = new Map();
    for (const key of this.sel) {
      const [ci, ni] = key.split(':').map(Number);
      if (!byContour.has(ci)) byContour.set(ci, new Set());
      byContour.get(ci).add(ni);
    }
    this.glyph.contours = this.glyph.contours
      .map((c, ci) => {
        const del = byContour.get(ci);
        if (!del) return c;
        return { ...c, nodes: c.nodes.filter((_, ni) => !del.has(ni)) };
      })
      .filter((c) => c.nodes.length >= (c.closed ? 3 : 1));
    this.sel.clear();
    this.penContour = null;
    this.afterEdit();
    return true;
  }

  nudge(dx, dy) {
    const nodes = this.selectedNodes();
    if (!nodes.length) return false;
    this.app.history.push(this.glyph);
    for (const n of nodes) movePoint(n, dx, dy, true);
    this.afterEdit();
    return true;
  }

  // Contours to copy: the selected ones, or the whole glyph.
  copyContours() {
    const set = new Set([...this.sel].map((k) => Number(k.split(':')[0])));
    const cs = set.size ? this.glyph.contours.filter((_, i) => set.has(i)) : this.glyph.contours;
    return structuredClone(cs);
  }

  pasteContours(cs) {
    if (!cs?.length) return;
    this.app.history.push(this.glyph);
    const start = this.glyph.contours.length;
    this.glyph.contours.push(...structuredClone(cs));
    this.sel = new Set();
    for (let ci = start; ci < this.glyph.contours.length; ci++) {
      this.glyph.contours[ci].nodes.forEach((_, ni) => this.sel.add(`${ci}:${ni}`));
    }
    this.setTool('select');
    this.afterEdit();
  }

  // Returns true when Escape was used up by the editor.
  escape() {
    if (this.penContour !== null) { this.finishPen(); return true; }
    if (this.sel.size) { this.sel.clear(); this.render(); return true; }
    return false;
  }

  // ---------------------------------------------------------------- drawing

  render() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    const { ctx, dpr } = this;
    const g = this.glyph;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!g) return;
    const colors = {
      line: css('--canvas-line'), metric: css('--canvas-metric'), text: css('--canvas-text'),
      ink: css('--canvas-ink'), primary: css('--accent'), accent: css('--dot-orange'),
      guide: css('--canvas-guide'), handle: css('--canvas-handle'), bg: css('--canvas-bg'),
      grid: css('--canvas-grid'), gridMajor: css('--canvas-grid-major'), nodeFill: css('--canvas-node-fill'),
    };
    const info = this.app.project.info;
    const S = (p) => this.toScreen(p);
    const x0 = S({ x: 0, y: 0 }).x, xa = S({ x: g.advance, y: 0 }).x;

    // Glyph body area.
    ctx.fillStyle = colors.bg;
    const yAsc = S({ x: 0, y: info.ascender }).y, yDesc = S({ x: 0, y: info.descender }).y;
    ctx.fillRect(x0, yAsc, xa - x0, yDesc - yAsc);

    // Measurement grid (AutoCAD-style): minor lines every step, major lines
    // every 5 steps. Minor lines are hidden when they would be too dense.
    if (this.showGrid) {
      const step = this.gridStep;
      const a = this.toFont(0, this.h), b = this.toFont(this.w, 0);
      for (const major of [false, true]) {
        const st = major ? step * 5 : step;
        if (st * this.view.scale < 6) continue;
        ctx.strokeStyle = major ? colors.gridMajor : colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = Math.ceil(a.x / st) * st; x <= b.x; x += st) {
          const sx = Math.round(S({ x, y: 0 }).x) + 0.5;
          ctx.moveTo(sx, 0); ctx.lineTo(sx, this.h);
        }
        for (let y = Math.ceil(a.y / st) * st; y <= b.y; y += st) {
          const sy = Math.round(S({ x: 0, y }).y) + 0.5;
          ctx.moveTo(0, sy); ctx.lineTo(this.w, sy);
        }
        ctx.stroke();
      }
    }

    // Metric lines with labels.
    ctx.font = `11px ${css('--font-ui')}`;
    ctx.textBaseline = 'bottom';
    const L = t('guideLines');
    const lines = [
      [info.ascender, L.asc], [info.capHeight, L.cap], [info.xHeight, L.x], [0, L.base], [info.descender, L.desc],
    ];
    for (const [y, label] of lines) {
      const sy = Math.round(S({ x: 0, y }).y) + 0.5;
      ctx.strokeStyle = y === 0 ? colors.metric : colors.line;
      ctx.lineWidth = y === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(this.w, sy);
      ctx.stroke();
      ctx.fillStyle = colors.text;
      ctx.fillText(label, 10, sy - 3);
    }
    ctx.strokeStyle = colors.metric;
    ctx.lineWidth = 1.5;
    for (const x of [x0, xa]) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, this.h);
      ctx.stroke();
    }
    // Width handle on the baseline.
    ctx.fillStyle = colors.metric;
    const by = S({ x: 0, y: 0 }).y;
    ctx.beginPath();
    ctx.moveTo(xa, by - 9); ctx.lineTo(xa + 7, by); ctx.lineTo(xa, by + 9); ctx.lineTo(xa - 7, by); ctx.closePath();
    ctx.fill();

    // Guide letter.
    const ch = charOf(g);
    if (this.showGuide && ch && ch.trim()) {
      const px = this.guideFontSize(info.capHeight * this.view.scale);
      ctx.font = `${px}px ${css('--font-guide')}`;
      ctx.textBaseline = 'alphabetic';
      const w = ctx.measureText(ch).width;
      ctx.fillStyle = colors.guide;
      ctx.fillText(ch, (x0 + xa) / 2 - w / 2, by);
    }

    // Outline.
    const v = this.view;
    ctx.save();
    ctx.setTransform(dpr * v.scale, 0, 0, -dpr * v.scale, dpr * v.ox, dpr * v.oy);
    ctx.beginPath();
    tracePath(ctx, g, true);
    ctx.restore();
    const points = this.showsPoints();
    ctx.fillStyle = colors.ink;
    ctx.globalAlpha = points ? 0.22 : 0.92;
    ctx.fill('nonzero');
    ctx.globalAlpha = 1;
    if (points) {
      ctx.save();
      ctx.setTransform(dpr * v.scale, 0, 0, -dpr * v.scale, dpr * v.ox, dpr * v.oy);
      ctx.beginPath();
      tracePath(ctx, g);
      ctx.restore();
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      this.drawPoints(colors);
    }

    this.drawOverlay(colors);

    // Snap marker: a small cross where the point is held.
    const showMark = this.snapMark && (this.drag ? ['move', 'handle', 'shape', 'penHandle'].includes(this.drag.kind)
      : ['pen', 'rect', 'ellipse'].includes(this.activeTool()) && this.hover);
    if (showMark) {
      const m = S(this.snapMark);
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(m.x - 7, m.y); ctx.lineTo(m.x + 7, m.y);
      ctx.moveTo(m.x, m.y - 7); ctx.lineTo(m.x, m.y + 7);
      ctx.stroke();
    }
    if (this.drag?.kind === 'move' && this.drag.moved && this.snapMark) {
      const m = S(this.snapMark);
      this.label(`${Math.round(this.snapMark.x)}, ${Math.round(this.snapMark.y)}`, m.x + 10, m.y + 10, colors);
    }
    this.app.onDraw?.();
  }

  // Small dark tag with text (sizes, coordinates) next to the cursor.
  label(text, x, y, colors) {
    const ctx = this.ctx;
    ctx.font = `11px ${css('--font-mono')}`;
    ctx.textBaseline = 'top';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x, y, w, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x + 5, y + 3);
    ctx.textBaseline = 'alphabetic';
  }

  guideFontSize(capPx) {
    if (!this.capRatio) {
      const c = this.hitCtx;
      c.font = `100px ${css('--font-guide')}`;
      const m = c.measureText('H');
      this.capRatio = (m.actualBoundingBoxAscent || 70) / 100;
    }
    return capPx / this.capRatio;
  }

  drawPoints(colors) {
    const ctx = this.ctx;
    this.glyph.contours.forEach((c, ci) => {
      c.nodes.forEach((n, ni) => {
        const s = this.toScreen(n);
        ctx.strokeStyle = colors.handle;
        ctx.lineWidth = 1;
        for (const which of ['in', 'out']) {
          if (!n[which]) continue;
          const h = this.toScreen(n[which]);
          ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(h.x, h.y); ctx.stroke();
          ctx.beginPath(); ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = colors.nodeFill; ctx.fill(); ctx.stroke();
        }
        const selected = this.sel.has(`${ci}:${ni}`);
        const first = ni === 0 && !c.closed;
        const r = first ? 7 : 5;
        ctx.beginPath();
        if (n.smooth) ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        else ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
        ctx.fillStyle = selected ? colors.primary : colors.nodeFill;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = first ? colors.accent : colors.primary;
        ctx.stroke();
      });
    });
  }

  drawOverlay(colors) {
    const ctx = this.ctx;
    const d = this.drag;
    const tool = this.activeTool();
    if (d?.kind === 'marquee') {
      const x = Math.min(d.start.sx, d.end.sx), y = Math.min(d.start.sy, d.end.sy);
      ctx.fillStyle = 'rgba(37,99,235,0.08)';
      ctx.strokeStyle = colors.primary;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, Math.abs(d.end.sx - d.start.sx), Math.abs(d.end.sy - d.start.sy));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(d.end.sx - d.start.sx), Math.abs(d.end.sy - d.start.sy));
      ctx.setLineDash([]);
    }
    if (d?.kind === 'shape') {
      let b = d.end;
      if (d.shift) {
        const s = Math.max(Math.abs(b.x - d.start.x), Math.abs(b.y - d.start.y));
        b = { x: d.start.x + Math.sign(b.x - d.start.x || 1) * s, y: d.start.y + Math.sign(b.y - d.start.y || 1) * s };
      }
      const p = this.toScreen(d.start), q = this.toScreen(b);
      ctx.fillStyle = colors.ink;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      if (d.tool === 'rect') ctx.rect(p.x, p.y, q.x - p.x, q.y - p.y);
      else ctx.ellipse((p.x + q.x) / 2, (p.y + q.y) / 2, Math.abs(q.x - p.x) / 2, Math.abs(q.y - p.y) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // Live size of the shape.
      const w = Math.round(Math.abs(b.x - d.start.x)), h = Math.round(Math.abs(b.y - d.start.y));
      this.label(`${w} × ${h}`, Math.max(p.x, q.x) + 8, Math.max(p.y, q.y) + 8, colors);
    }
    if (d?.kind === 'stroke') {
      ctx.strokeStyle = d.erase ? 'rgba(220,38,38,0.35)' : colors.ink;
      ctx.globalAlpha = d.erase ? 1 : 0.92;
      ctx.lineWidth = this.brushRadius * 2 * this.view.scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      d.points.forEach((p, i) => {
        const s = this.toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      if (d.points.length === 1) { const s = this.toScreen(d.points[0]); ctx.lineTo(s.x + 0.01, s.y); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if ((tool === 'brush' || tool === 'eraser') && this.hover) {
      const s = this.toScreen(this.hover);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(2, this.brushRadius * this.view.scale), 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = tool === 'eraser' ? '#DC2626' : colors.primary;
      ctx.stroke();
    }
    if (tool === 'pen' && this.penContour !== null && this.hover && !d) {
      const c = this.glyph.contours[this.penContour];
      const last = c?.nodes[c.nodes.length - 1];
      if (last) {
        const a = this.toScreen(last), b = this.toScreen(this.hover);
        ctx.strokeStyle = colors.primary;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}
