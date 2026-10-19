// Canvas glyph editor: select, pen, brush, eraser, rectangle, ellipse, hand.
import {
  segments, pointAt, tracePath, flatten, polyBox, normalizeDirections, insertNode,
  rectContour, ellipseContour, movePoint, charOf, reverseContour, pointInPolygon,
} from './model.js';
import { applyStroke } from './trace.js';
import { openCorner, reconnect, deleteSegment } from './corners.js';
import { addExtremesTo } from './simplify.js';
import { unite, subtract, removeOverlap, shapesOf, pathOperation, knifeCut } from './boolean.js';
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

const RULER = 20; // ruler thickness, px
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round"><g stroke="black" stroke-width="4"><path d="M20 12a8 8 0 1 1-2.6-5.9L20 8.5"/><path d="M20 3.5v5h-5"/></g><g stroke="white" stroke-width="2"><path d="M20 12a8 8 0 1 1-2.6-5.9L20 8.5"/><path d="M20 3.5v5h-5"/></g></svg>')}") 12 12, crosshair`;

function pointInQuad(p, q) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if ((q[i].y > p.y) !== (q[j].y > p.y) && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
  }
  return inside;
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
    this.xform = null;       // free transform (Ctrl+T) state
    this.keyContour = null;  // key object for alignment (click a selected shape again)
    this.alignTo = 'selection'; // 'selection' (or key object) | 'frame'
    this.showRulers = false; // Ctrl+R
    this.showUserGuides = true;
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
    if (this.xform) this.commitTransform();
    this.finishPen();
    this.glyph = glyph;
    this.measure = null;
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
    if (this.xform && tool !== 'hand') this.commitTransform();
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

  // Extended mode: the anchor under the cursor (index), or -1.
  anchorAt(sx, sy) {
    if (!this.extended) return -1;
    const list = this.glyph.anchors || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const s = this.toScreen(list[i]);
      if (Math.abs(s.x - sx) <= 7 && Math.abs(s.y - sy) <= 7) return i;
    }
    return -1;
  }

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
      const ug = this.showUserGuides ? this.guides() : [];
      const gy = near(y, [info.ascender, info.capHeight, info.xHeight, 0, info.descender, ...ug.filter((g) => g.axis === 'y').map((g) => g.pos)]);
      const gx = near(x, [0, this.glyph.advance, ...ug.filter((g) => g.axis === 'x').map((g) => g.pos)]);
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

    const zone = this.rulerZone(sx, sy);
    const guide = !zone && !this.xform && (tool === 'select' || e.ctrlKey || e.metaKey) ? this.guideAt(sx, sy) : null;
    if (zone && e.button === 0) {
      // Pull a new guide out of a ruler: the top one gives a horizontal
      // guide, the left one a vertical guide.
      const g = { axis: zone === 'top' ? 'y' : 'x', pos: zone === 'top' ? p.y : p.x };
      this.drag = { kind: 'guide', guide: g, isNew: true };
    } else if (guide && e.button === 0) {
      this.drag = { kind: 'guide', guide };
    } else if (this.xform && tool !== 'hand') {
      this.downTransform(e, sx, sy, p);
    } else if (tool === 'hand') {
      this.drag = { kind: 'pan', sx, sy, ox: this.view.ox, oy: this.view.oy };
    } else if (tool === 'knife') {
      const sp = this.snap(p);
      this.drag = { kind: 'knife', start: sp, end: sp };
    } else if (tool === 'pixel') {
      // Pixel tool: cells on a square grid; Alt (or the Erase option) clears.
      this.drag = { kind: 'pixel', erase: e.altKey || this.pixelErase, cells: new Map() };
      this.addPixel(p);
    } else if (tool === 'measure') {
      const sp = this.snap(p);
      this.measure = { start: sp, end: sp };
      this.drag = { kind: 'measure' };
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
    const ai = this.anchorAt(sx, sy);
    if (ai >= 0) {
      this.drag = { kind: 'anchor', index: ai, start: p };
      return;
    }
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
      const several = new Set([...this.sel].map((k) => k.split(':')[0])).size > 1;
      if (!e.shiftKey && !all) { this.sel = new Set(); this.keyContour = null; }
      keys.forEach((k) => this.sel.add(k));
      const first = this.glyph.contours[ci].nodes[0];
      this.drag = {
        kind: 'move', start: p, applied: { x: 0, y: 0 }, ref: { x: first.x, y: first.y },
        // A click (no drag) on a shape that was already selected together
        // with others makes it the key object, like in Illustrator.
        keyCandidate: all && several && !e.shiftKey ? this.glyph.contours[ci] : null,
      };
      return;
    }
    if (!e.shiftKey) this.sel.clear();
    this.drag = { kind: 'marquee', start: { sx, sy }, end: { sx, sy }, base: new Set(this.sel) };
    // Extended mode: a free-hand lasso instead of a rectangle.
    if (this.extended && this.selectShape === 'lasso') this.drag.lasso = [{ sx, sy }];
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
      case 'knife':
        d.end = e.shiftKey ? snap45(d.start, p) : this.snap(p);
        break;
      case 'pixel': {
        // Fill every cell between the last point and this one.
        const last = d.last || p, steps = Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / (this.pixelSize / 2)) || 1;
        for (let k = 1; k <= steps; k++) this.addPixel({ x: last.x + (p.x - last.x) * k / steps, y: last.y + (p.y - last.y) * k / steps });
        break;
      }
      case 'measure':
        this.measure.end = e.shiftKey ? snap45(this.measure.start, p) : this.snap(p);
        break;
      case 'guide': {
        let v = d.guide.axis === 'y' ? p.y : p.x;
        if (this.snapGrid) v = Math.round(v / this.gridStep) * this.gridStep;
        d.guide.pos = Math.round(v);
        d.overRuler = !!this.rulerZone(sx, sy) || sx < 0 || sy < 0;
        if (d.isNew && !d.added && !d.overRuler) { this.guides().push(d.guide); d.added = true; }
        break;
      }
      case 'xmove': case 'xscale': case 'xrotate':
        this.moveTransform(d, e, p);
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
          // An open end sticks to another open end (then joins on release).
          const end = this.extended && this.openEndNear({ x: d.ref.x + p.x - d.start.x, y: d.ref.y + p.y - d.start.y });
          if (end) total = { x: end[2].x - d.ref.x, y: end[2].y - d.ref.y };
        }
        const dx = total.x - d.applied.x, dy = total.y - d.applied.y;
        if (!d.moved && Math.hypot(total.x, total.y) * this.view.scale < 2) break;
        if (dx || dy) {
          this.checkpoint();
          if (this.extended && e.altKey && !d.duplicated) { this.duplicateSelection(); d.duplicated = true; d.cuspNode = null; }
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
      case 'anchor': {
        if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) * this.view.scale < 2) break;
        this.checkpoint();
        const a = this.glyph.anchors[d.index];
        const q = e.shiftKey ? snap45(d.start, p) : this.snap(p);
        a.x = Math.round(q.x); a.y = Math.round(q.y);
        d.moved = true;
        this.app.onAnchorsChanged?.();
        break;
      }
      case 'marquee':
        d.end = { sx, sy };
        d.lasso?.push({ sx, sy });
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
      case 'knife':
        this.knife(d.start, d.end);
        break;
      case 'pixel':
        this.commitPixels(d);
        break;
      case 'guide': {
        const list = this.guides();
        // Dropping a guide back on a ruler removes it.
        if (d.overRuler) { const i = list.indexOf(d.guide); if (i >= 0) list.splice(i, 1); }
        if (d.added || !d.isNew) this.app.onGuidesChanged?.();
        break;
      }
      case 'xmove': case 'xscale': case 'xrotate':
        this.app.onTransformChange?.();
        break;
      case 'move':
        if (!d.moved && d.keyCandidate) {
          this.keyContour = this.keyContour === d.keyCandidate ? null : d.keyCandidate;
          this.app.onKeyObject?.(!!this.keyContour);
        }
        if (d.moved && this.extended && this.joinDroppedEnd()) break;
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
      case 'anchor':
        if (d.moved) this.afterEdit(false);
        break;
      case 'marquee': {
        const x0 = Math.min(d.start.sx, d.end.sx), x1 = Math.max(d.start.sx, d.end.sx);
        const y0 = Math.min(d.start.sy, d.end.sy), y1 = Math.max(d.start.sy, d.end.sy);
        this.sel = new Set(d.base);
        const poly = d.lasso?.map((q) => ({ x: q.sx, y: q.sy }));
        this.glyph.contours.forEach((c, ci) => c.nodes.forEach((n, ni) => {
          const s = this.toScreen(n);
          const inside = poly ? poly.length > 2 && pointInPolygon(s, poly) : s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
          if (inside) this.sel.add(`${ci}:${ni}`);
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

  // ---------------------------------------------------------------- rulers & guides

  guides() {
    const p = this.app.project;
    if (!Array.isArray(p.guides)) p.guides = [];
    return p.guides;
  }

  rulerZone(sx, sy) {
    if (!this.showRulers) return null;
    if (sx < RULER && sy < RULER) return 'corner';
    if (sy < RULER) return 'top';
    if (sx < RULER) return 'left';
    return null;
  }

  guideAt(sx, sy) {
    if (!this.showUserGuides) return null;
    let best = null, bestD = 5;
    for (const g of this.guides()) {
      const d = g.axis === 'y' ? Math.abs(this.toScreen({ x: 0, y: g.pos }).y - sy) : Math.abs(this.toScreen({ x: g.pos, y: 0 }).x - sx);
      if (d <= bestD) { best = g; bestD = d; }
    }
    return best;
  }

  drawUserGuides(colors) {
    const ctx = this.ctx;
    const list = this.showUserGuides ? this.guides() : [];
    const dragging = this.drag?.kind === 'guide' ? this.drag.guide : null;
    ctx.lineWidth = 1;
    for (const g of [...list, ...(dragging && !list.includes(dragging) ? [dragging] : [])]) {
      ctx.strokeStyle = g === dragging && this.drag.overRuler ? colors.text : colors.userGuide;
      ctx.beginPath();
      if (g.axis === 'y') {
        const y = Math.round(this.toScreen({ x: 0, y: g.pos }).y) + 0.5;
        ctx.moveTo(0, y); ctx.lineTo(this.w, y);
      } else {
        const x = Math.round(this.toScreen({ x: g.pos, y: 0 }).x) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, this.h);
      }
      ctx.stroke();
    }
    if (dragging && !this.drag.overRuler) {
      const s = this.toScreen({ x: dragging.pos, y: dragging.pos });
      const at = dragging.axis === 'y' ? { x: RULER + 8, y: s.y + 6 } : { x: s.x + 6, y: RULER + 8 };
      this.label(`${dragging.axis === 'y' ? 'Y' : 'X'} ${dragging.pos}`, at.x, at.y, colors);
    }
  }

  // Photoshop-like rulers in font units along the top and left edges.
  drawRulers(colors) {
    const ctx = this.ctx;
    const scale = this.view.scale;
    // Label every `major` units, with at least ~60 px between labels.
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const major = steps.find((s) => s * scale >= 60) || 10000;
    const minor = major / ([25, 250, 2500].includes(major) ? 5 : 10);
    ctx.fillStyle = colors.rulerBg;
    ctx.fillRect(0, 0, this.w, RULER);
    ctx.fillRect(0, 0, RULER, this.h);
    ctx.strokeStyle = colors.rulerLine;
    ctx.fillStyle = colors.rulerText;
    ctx.lineWidth = 1;
    ctx.font = `10px ${css('--font-ui')}`;
    ctx.textBaseline = 'top';
    ctx.beginPath();
    const a = this.toFont(RULER, this.h), b = this.toFont(this.w, RULER);
    for (let v = Math.floor(a.x / minor) * minor; v <= b.x; v += minor) {
      const x = Math.round(this.toScreen({ x: v, y: 0 }).x) + 0.5;
      if (x < RULER) continue;
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      ctx.moveTo(x, RULER); ctx.lineTo(x, isMajor ? 2 : RULER - 5);
      if (isMajor) ctx.fillText(String(Math.round(v)), x + 3, 2);
    }
    for (let v = Math.floor(a.y / minor) * minor; v <= b.y; v += minor) {
      const y = Math.round(this.toScreen({ x: 0, y: v }).y) + 0.5;
      if (y < RULER) continue;
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      ctx.moveTo(RULER, y); ctx.lineTo(isMajor ? 2 : RULER - 5, y);
      if (isMajor) {
        ctx.save();
        ctx.translate(2, y - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(Math.round(v)), 0, 0);
        ctx.restore();
      }
    }
    // Borders and the pointer position.
    ctx.moveTo(0, RULER + 0.5); ctx.lineTo(this.w, RULER + 0.5);
    ctx.moveTo(RULER + 0.5, 0); ctx.lineTo(RULER + 0.5, this.h);
    ctx.stroke();
    if (this.hover) {
      const s = this.toScreen(this.hover);
      ctx.strokeStyle = colors.primary;
      ctx.beginPath();
      ctx.moveTo(Math.round(s.x) + 0.5, 0); ctx.lineTo(Math.round(s.x) + 0.5, RULER);
      ctx.moveTo(0, Math.round(s.y) + 0.5); ctx.lineTo(RULER, Math.round(s.y) + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = colors.rulerBg;
    ctx.fillRect(0, 0, RULER, RULER);
    ctx.textBaseline = 'alphabetic';
  }

  // Knife: cuts the contours crossed by the segment a→b into pieces.
  knife(a, b) {
    if (Math.hypot(b.x - a.x, b.y - a.y) * this.view.scale < 4) return;
    const seg = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    const cs = this.glyph.contours.filter((c) => c.closed && c.nodes.length >= 2);
    const boxes = cs.map((c) => polyBox(flatten(c, 6)));
    const hit = (u, v) => u.minX <= v.maxX && u.maxX >= v.minX && u.minY <= v.maxY && u.maxY >= v.minY;
    let area = seg;
    const affected = new Set();
    for (let grew = true; grew;) {
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
    const base = [...affected].map((i) => cs[i]);
    const pieces = base.length ? knifeCut(base, a, b) : null;
    if (!pieces) { this.app.onKnifeMiss?.(); return; }
    this.app.history.push(this.glyph);
    const gone = new Set(base);
    const keep = this.glyph.contours.filter((c) => !gone.has(c));
    this.glyph.contours = [...keep, ...pieces];
    this.sel = new Set();
    this.afterEdit();
  }

  // ---------------------------------------------------------------- free transform

  // Starts Ctrl+T on the selected points (or the whole glyph). The result is
  // world = c + R(angle)·S(sx, sy)·(p − c) + t, applied to the original points.
  startTransform() {
    if (!this.glyph) return false;
    if (this.xform) return true;
    this.finishPen();
    let nodes = this.selectedNodes();
    if (!nodes.length) nodes = this.glyph.contours.flatMap((c) => c.nodes);
    if (!nodes.length) return false;
    const pts = nodes.flatMap((n) => [n, n.in, n.out].filter(Boolean));
    const box = polyBox(pts);
    if (box.maxX - box.minX < 1e-6 && box.maxY - box.minY < 1e-6) return false;
    this.app.history.push(this.glyph);
    this.xform = {
      nodes,
      orig: nodes.map((n) => ({ x: n.x, y: n.y, in: n.in && { ...n.in }, out: n.out && { ...n.out } })),
      box,
      c: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
      sx: 1, sy: 1, angle: 0, tx: 0, ty: 0,
    };
    this.render();
    return true;
  }

  xformStale() {
    const live = new Set(this.glyph.contours.flatMap((c) => c.nodes));
    return this.xform.nodes.some((n) => !live.has(n));
  }

  xWorld(p) {
    const x = this.xform, cos = Math.cos(x.angle), sin = Math.sin(x.angle);
    const vx = (p.x - x.c.x) * x.sx, vy = (p.y - x.c.y) * x.sy;
    return { x: x.c.x + vx * cos - vy * sin + x.tx, y: x.c.y + vx * sin + vy * cos + x.ty };
  }

  applyTransform() {
    const x = this.xform;
    x.nodes.forEach((n, i) => {
      const o = x.orig[i];
      Object.assign(n, this.xWorld(o));
      if (o.in) n.in = this.xWorld(o.in); else delete n.in;
      if (o.out) n.out = this.xWorld(o.out); else delete n.out;
    });
  }

  // Handles in original coordinates: corners and edge middles.
  xHandles() {
    const b = this.xform.box, mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
    return [
      { id: 'nw', p: { x: b.minX, y: b.maxY }, fx: -1, fy: 1 }, { id: 'n', p: { x: mx, y: b.maxY }, fx: 0, fy: 1 },
      { id: 'ne', p: { x: b.maxX, y: b.maxY }, fx: 1, fy: 1 }, { id: 'e', p: { x: b.maxX, y: my }, fx: 1, fy: 0 },
      { id: 'se', p: { x: b.maxX, y: b.minY }, fx: 1, fy: -1 }, { id: 's', p: { x: mx, y: b.minY }, fx: 0, fy: -1 },
      { id: 'sw', p: { x: b.minX, y: b.minY }, fx: -1, fy: -1 }, { id: 'w', p: { x: b.minX, y: my }, fx: -1, fy: 0 },
    ];
  }

  xHit(sx, sy) {
    for (const h of this.xHandles()) {
      const w = this.toScreen(this.xWorld(h.p));
      if (Math.abs(w.x - sx) <= 7 && Math.abs(w.y - sy) <= 7) return { kind: 'scale', h };
    }
    const corners = ['nw', 'ne', 'se', 'sw'].map((id) => this.toScreen(this.xWorld(this.xHandles().find((h) => h.id === id).p)));
    const inside = pointInQuad({ x: sx, y: sy }, corners);
    return { kind: inside ? 'move' : 'rotate' };
  }

  downTransform(e, sx, sy, p) {
    const hit = this.xHit(sx, sy);
    const x = this.xform;
    const base = { sx: x.sx, sy: x.sy, angle: x.angle, tx: x.tx, ty: x.ty };
    if (hit.kind === 'scale') {
      const b = x.box;
      // Anchor: the opposite handle (or the centre with Alt), fixed in the world.
      const a = { x: hit.h.fx ? (hit.h.fx > 0 ? b.minX : b.maxX) : x.c.x, y: hit.h.fy ? (hit.h.fy > 0 ? b.minY : b.maxY) : x.c.y };
      this.drag = { kind: 'xscale', h: hit.h, a, base };
    } else if (hit.kind === 'move') {
      // The box point nearest to where it was grabbed (a corner, an edge
      // middle or the centre) is the one that snaps to the grid and guides.
      const refs = [...this.xHandles().map((h) => h.p), x.c].map((q) => this.xWorld(q));
      const ref = refs.reduce((a, b) => (Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a));
      this.drag = { kind: 'xmove', start: p, ref, base };
    } else {
      const cw = this.xWorld(x.c);
      this.drag = { kind: 'xrotate', start: Math.atan2(p.y - cw.y, p.x - cw.x), base };
    }
  }

  moveTransform(d, e, p) {
    const x = this.xform;
    Object.assign(x, d.base);
    if (d.kind === 'xmove') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (e.shiftKey) { ({ x: dx, y: dy } = snap45({ x: 0, y: 0 }, { x: dx, y: dy })); this.snapMark = null; } else {
        const to = this.snap({ x: d.ref.x + dx, y: d.ref.y + dy });
        dx = to.x - d.ref.x; dy = to.y - d.ref.y;
      }
      x.tx += dx; x.ty += dy;
    } else if (d.kind === 'xrotate') {
      const cw = this.xWorld(x.c);
      let ang = d.base.angle + Math.atan2(p.y - cw.y, p.x - cw.x) - d.start;
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12); // 15° steps
      x.angle = ang;
    } else {
      p = this.snap(p); // the dragged handle lands on the grid or a guide
      const fromCenter = e.altKey;
      const a = fromCenter ? x.c : d.a;
      const aw = this.xWorld(a); // stays where it is
      // Pointer in the box's own (rotated, unscaled) frame, relative to the anchor.
      const cos = Math.cos(x.angle), sin = Math.sin(x.angle);
      const vx = p.x - aw.x, vy = p.y - aw.y;
      const lx = vx * cos + vy * sin, ly = -vx * sin + vy * cos;
      const hx = d.h.p.x - a.x, hy = d.h.p.y - a.y;
      let sx = d.h.fx && Math.abs(hx) > 1e-9 ? lx / hx : d.base.sx;
      let sy = d.h.fy && Math.abs(hy) > 1e-9 ? ly / hy : d.base.sy;
      if (e.shiftKey) { // keep proportions
        if (d.h.fx && d.h.fy) { const k = Math.abs(sx / d.base.sx) > Math.abs(sy / d.base.sy) ? sx / d.base.sx : sy / d.base.sy; sx = d.base.sx * k; sy = d.base.sy * k; }
        else if (d.h.fx) sy = d.base.sy * (sx / d.base.sx);
        else sx = d.base.sx * (sy / d.base.sy);
      }
      if (Math.abs(sx) < 1e-3) sx = 1e-3 * Math.sign(sx || 1);
      if (Math.abs(sy) < 1e-3) sy = 1e-3 * Math.sign(sy || 1);
      x.sx = sx; x.sy = sy;
      // Shift so the anchor did not move.
      const now = this.xWorld(a);
      x.tx += aw.x - now.x; x.ty += aw.y - now.y;
    }
    this.applyTransform();
    this.app.onTransformChange?.();
  }

  // Arrow keys during Ctrl+T move the transformed selection.
  nudgeTransform(dx, dy) {
    if (!this.xform) return false;
    this.xform.tx += dx;
    this.xform.ty += dy;
    this.applyTransform();
    this.render();
    this.app.onTransformChange?.();
    return true;
  }

  // Exact values from the options bar (percent and degrees, around the centre).
  setTransformValues({ w, h, angle }) {
    const x = this.xform;
    if (!x) return;
    const cw = this.xWorld(x.c);
    if (Number.isFinite(w) && w !== 0) x.sx = w / 100;
    if (Number.isFinite(h) && h !== 0) x.sy = h / 100;
    if (Number.isFinite(angle)) x.angle = (angle * Math.PI) / 180;
    const now = this.xWorld(x.c);
    x.tx += cw.x - now.x; x.ty += cw.y - now.y;
    this.applyTransform();
    this.render();
  }

  transformValues() {
    const x = this.xform;
    return x && { w: x.sx * 100, h: x.sy * 100, angle: (x.angle * 180) / Math.PI };
  }

  commitTransform() {
    if (!this.xform) return;
    this.applyTransform();
    for (const n of this.xform.nodes) {
      n.x = Math.round(n.x); n.y = Math.round(n.y);
      if (n.in) n.in = { x: Math.round(n.in.x), y: Math.round(n.in.y) };
      if (n.out) n.out = { x: Math.round(n.out.x), y: Math.round(n.out.y) };
    }
    this.xform = null;
    this.afterEdit();
    this.app.onTransformChange?.();
  }

  cancelTransform() {
    const x = this.xform;
    if (!x) return;
    x.nodes.forEach((n, i) => {
      const o = x.orig[i];
      n.x = o.x; n.y = o.y;
      if (o.in) n.in = o.in; else delete n.in;
      if (o.out) n.out = o.out; else delete n.out;
    });
    this.xform = null;
    this.app.history.undoStack.pop(); // nothing changed
    this.render();
    this.app.onTransformChange?.();
  }

  drawTransform(colors) {
    const ctx = this.ctx;
    const hs = this.xHandles().map((h) => ({ ...h, s: this.toScreen(this.xWorld(h.p)) }));
    const corner = (id) => hs.find((h) => h.id === id).s;
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ['nw', 'ne', 'se', 'sw'].forEach((id, i) => { const c = corner(id); if (i) ctx.lineTo(c.x, c.y); else ctx.moveTo(c.x, c.y); });
    ctx.closePath();
    ctx.stroke();
    for (const h of hs) {
      ctx.fillStyle = colors.nodeFill;
      ctx.fillRect(h.s.x - 4, h.s.y - 4, 8, 8);
      ctx.strokeRect(h.s.x - 4 + 0.5, h.s.y - 4 + 0.5, 7, 7);
    }
    const c = this.toScreen(this.xWorld(this.xform.c));
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.moveTo(c.x - 7, c.y); ctx.lineTo(c.x + 7, c.y);
    ctx.moveTo(c.x, c.y - 7); ctx.lineTo(c.x, c.y + 7);
    ctx.stroke();
    const v = this.transformValues();
    if (this.drag?.kind?.startsWith('x')) {
      const txt = this.drag.kind === 'xrotate' ? `${v.angle.toFixed(1)}°` : `${v.w.toFixed(1)}% × ${v.h.toFixed(1)}%`;
      this.label(txt, c.x + 10, c.y + 10, colors);
    }
  }

  // ---------------------------------------------------------------- alignment

  // Shapes to align: the selected contours grouped with their holes, or the
  // whole glyph as one shape when nothing is selected.
  alignShapes() {
    const cs = this.glyph.contours;
    const picked = new Set([...this.sel].map((k) => Number(k.split(':')[0])).filter((i) => cs[i]?.nodes.length));
    const groups = picked.size ? shapesOf(cs, picked) : (cs.length ? [cs.map((_, i) => i)] : []);
    return groups.map((idx) => {
      const contours = idx.map((i) => cs[i]);
      return { contours, box: polyBox(contours.flatMap((c) => flatten(c, 16))) };
    });
  }

  // The blue frame of the glyph: its width and the ascender..descender band.
  frameBox() {
    const info = this.app.project.info;
    return { minX: 0, maxX: this.glyph.advance, minY: info.descender, maxY: info.ascender };
  }

  keyShape(shapes) {
    if (!this.keyContour) return null;
    return shapes.find((s) => s.contours.includes(this.keyContour)) || null;
  }

  // kind: left | hcenter | right | top | vcenter | bottom | center
  align(kind) {
    const shapes = this.alignShapes();
    if (!shapes.length) return false;
    const key = this.alignTo === 'selection' ? this.keyShape(shapes) : null;
    let ref;
    if (this.alignTo === 'frame' || shapes.length === 1 && !key) ref = this.frameBox();
    else if (key) ref = key.box;
    else {
      ref = shapes.reduce((b, s) => ({
        minX: Math.min(b.minX, s.box.minX), minY: Math.min(b.minY, s.box.minY),
        maxX: Math.max(b.maxX, s.box.maxX), maxY: Math.max(b.maxY, s.box.maxY),
      }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    }
    const cx = (b) => (b.minX + b.maxX) / 2, cy = (b) => (b.minY + b.maxY) / 2;
    this.app.history.push(this.glyph);
    for (const s of shapes) {
      if (s === key) continue;
      const b = s.box;
      let dx = 0, dy = 0;
      if (kind === 'left') dx = ref.minX - b.minX;
      if (kind === 'right') dx = ref.maxX - b.maxX;
      if (kind === 'hcenter' || kind === 'center') dx = cx(ref) - cx(b);
      if (kind === 'top') dy = ref.maxY - b.maxY;
      if (kind === 'bottom') dy = ref.minY - b.minY;
      if (kind === 'vcenter' || kind === 'center') dy = cy(ref) - cy(b);
      this.moveShape(s, Math.round(dx), Math.round(dy));
    }
    this.afterEdit();
    return true;
  }

  // Equal gaps between three or more shapes; the outermost ones stay put.
  distribute(axis) {
    const shapes = this.alignShapes();
    if (shapes.length < 3) return false;
    const lo = axis === 'x' ? 'minX' : 'minY', hi = axis === 'x' ? 'maxX' : 'maxY';
    shapes.sort((a, b) => a.box[lo] - b.box[lo]);
    const span = Math.max(...shapes.map((s) => s.box[hi])) - shapes[0].box[lo];
    const sizes = shapes.reduce((sum, s) => sum + (s.box[hi] - s.box[lo]), 0);
    const gap = (span - sizes) / (shapes.length - 1);
    this.app.history.push(this.glyph);
    let pos = shapes[0].box[hi] + gap;
    for (const s of shapes.slice(1, -1)) {
      const d = Math.round(pos - s.box[lo]);
      this.moveShape(s, axis === 'x' ? d : 0, axis === 'y' ? d : 0);
      pos += (s.box[hi] - s.box[lo]) + gap;
    }
    this.afterEdit();
    return true;
  }

  moveShape(s, dx, dy) {
    if (!dx && !dy) return;
    for (const c of s.contours) for (const n of c.nodes) movePoint(n, dx, dy, true);
  }

  drawKeyObject(colors) {
    if (!this.keyContour || this.alignTo !== 'selection') return;
    const ci = this.glyph.contours.indexOf(this.keyContour);
    if (ci < 0 || ![...this.sel].some((k) => k.startsWith(`${ci}:`))) return;
    const shape = this.keyShape(this.alignShapes());
    if (!shape) return;
    const a = this.toScreen({ x: shape.box.minX, y: shape.box.maxY });
    const b = this.toScreen({ x: shape.box.maxX, y: shape.box.minY });
    const ctx = this.ctx;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(a.x - 4, a.y - 4, b.x - a.x + 8, b.y - a.y + 8);
    ctx.setLineDash([]);
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
    if (this.xform) { this.commitTransform(); return; }
    {
      const { sx, sy } = this.eventPos(e);
      const g = this.rulerZone(sx, sy) ? null : this.guideAt(sx, sy);
      if (g) { this.app.onGuideEdit?.(g); return; }
    }
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
    const zone = this.rulerZone(sx, sy);
    if (zone) { this.canvas.style.cursor = zone === 'top' ? 'row-resize' : 'col-resize'; return; }
    if (this.activeTool() === 'select' && !this.xform) {
      const g = this.guideAt(sx, sy);
      if (g && !this.nodeAt(sx, sy) && !this.handleAt(sx, sy)) { this.canvas.style.cursor = g.axis === 'y' ? 'row-resize' : 'col-resize'; return; }
    }
    const tool = this.activeTool();
    let cur = 'crosshair';
    if (this.xform && tool !== 'hand') {
      const hit = this.xHit(sx, sy);
      const dirs = { n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' };
      this.canvas.style.cursor = hit.kind === 'scale' ? `${dirs[hit.h.id]}-resize` : hit.kind === 'move' ? 'move' : ROTATE_CURSOR;
      return;
    }
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
    if (this.tool !== 'select') (this.app.selectTool || ((id) => this.setTool(id)))('select');
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

  // ---------------------------------------------------------------- extended mode

  // Tab / Shift+Tab: the next or previous point of the contour.
  selectStep(dir) {
    const cs = this.glyph.contours;
    if (!cs.some((c) => c.nodes.length)) return false;
    let ci = 0, ni = dir > 0 ? -1 : 0;
    if (this.sel.size) [ci, ni] = [...this.sel].pop().split(':').map(Number);
    else ci = cs.findIndex((c) => c.nodes.length);
    const n = cs[ci].nodes.length;
    ni = (ni + dir + n) % n;
    this.sel = new Set([`${ci}:${ni}`]);
    if (this.tool !== 'select') (this.app.selectTool || ((id) => this.setTool(id)))('select');
    this.render();
    return true;
  }

  invertSelection() {
    const all = new Set();
    this.glyph.contours.forEach((c, ci) => c.nodes.forEach((_, ni) => all.add(`${ci}:${ni}`)));
    this.sel = new Set([...all].filter((k) => !this.sel.has(k)));
    if (this.tool !== 'select') (this.app.selectTool || ((id) => this.setTool(id)))('select');
    this.render();
  }

  // Contours with a selected point, or every contour.
  pickedContours() {
    const set = new Set([...this.sel].map((k) => Number(k.split(':')[0])));
    return this.glyph.contours.filter((_, i) => !set.size || set.has(i));
  }

  // Adds points where a curve is horizontal or vertical (its extremes):
  // fonts render and hint best with them.
  addExtremes() {
    const targets = new Set(this.pickedContours().map((c) => this.glyph.contours.indexOf(c)));
    const copy = structuredClone(this.glyph.contours);
    const added = addExtremesTo(copy, targets);
    if (!added) return 0;
    this.app.history.push(this.glyph);
    this.glyph.contours = copy;
    this.sel.clear();
    this.afterEdit(false);
    return added;
  }

  // Makes the selected point the start of its contour.
  makeFirst() {
    if (this.sel.size !== 1) return false;
    const [ci, ni] = [...this.sel][0].split(':').map(Number);
    const c = this.glyph.contours[ci];
    if (!c?.closed || ni === 0) return false;
    this.app.history.push(this.glyph);
    c.nodes = [...c.nodes.slice(ni), ...c.nodes.slice(0, ni)];
    this.sel = new Set([`${ci}:0`]);
    this.afterEdit(false);
    return true;
  }

  // Lines up the selected points: same y when they are spread wider than
  // tall, otherwise same x (at their average).
  alignPoints() {
    const nodes = this.selectedNodes();
    if (nodes.length < 2) return false;
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const horiz = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    const avg = Math.round((horiz ? ys : xs).reduce((a, b) => a + b, 0) / nodes.length);
    this.app.history.push(this.glyph);
    for (const n of nodes) movePoint(n, horiz ? 0 : avg - n.x, horiz ? avg - n.y : 0, true);
    this.afterEdit();
    return true;
  }

  // Alt-drag: the contours with selected points are copied first and the
  // copies are what moves.
  duplicateSelection() {
    const cs = this.glyph.contours;
    const picked = [...new Set([...this.sel].map((k) => Number(k.split(':')[0])))].sort((a, b) => a - b);
    const sel = new Set();
    for (const ci of picked) {
      cs.push(structuredClone(cs[ci]));
      cs[cs.length - 1].nodes.forEach((_, ni) => sel.add(`${cs.length - 1}:${ni}`));
    }
    this.sel = sel;
  }

  // Opens a closed contour at the selected point: the point becomes both
  // ends of the open path.
  breakAt() {
    if (this.sel.size !== 1) return false;
    const [ci, ni] = [...this.sel][0].split(':').map(Number);
    const c = this.glyph.contours[ci];
    if (!c?.closed || c.nodes.length < 2) return false;
    this.app.history.push(this.glyph);
    const nodes = [...c.nodes.slice(ni), ...c.nodes.slice(0, ni)];
    const end = structuredClone(nodes[0]);
    delete nodes[0].in;
    delete end.out;
    nodes[0].smooth = false;
    end.smooth = false;
    c.nodes = [...nodes, end];
    c.closed = false;
    this.sel = new Set([`${ci}:0`, `${ci}:${c.nodes.length - 1}`]);
    this.afterEdit(false);
    return true;
  }

  // Closes an open contour, or joins two open contours at their selected
  // ends into one.
  joinEnds() {
    const cs = this.glyph.contours;
    const keys = [...this.sel].map((k) => k.split(':').map(Number));
    const open = [...new Set(keys.map(([ci]) => ci))].filter((ci) => cs[ci] && !cs[ci].closed);
    if (open.length === 1) {
      const c = cs[open[0]];
      if (c.nodes.length < 3) return false;
      this.app.history.push(this.glyph);
      const a = c.nodes[0], b = c.nodes[c.nodes.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1) { if (b.in) a.in = b.in; c.nodes.pop(); a.smooth = lined(a); }
      c.closed = true;
      this.sel.clear();
      this.afterEdit();
      return true;
    }
    if (open.length !== 2) return false;
    const endOf = (ci) => {
      const ni = keys.find(([c]) => c === ci)[1];
      return ni === 0 ? 'start' : ni === cs[ci].nodes.length - 1 ? 'end' : null;
    };
    const [i1, i2] = open;
    const e1 = endOf(i1), e2 = endOf(i2);
    if (!e1 || !e2) return false;
    this.app.history.push(this.glyph);
    const A = structuredClone(cs[i1]), B = structuredClone(cs[i2]);
    if (e1 === 'start') reverseContour(A); // A must end at the joined point
    if (e2 === 'end') reverseContour(B); // B must start there
    const a = A.nodes[A.nodes.length - 1], b = B.nodes[0];
    let nodes;
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1) {
      if (b.out) a.out = b.out;
      a.smooth = lined(a);
      nodes = [...A.nodes, ...B.nodes.slice(1)];
    } else nodes = [...A.nodes, ...B.nodes];
    this.glyph.contours = cs.filter((_, i) => i !== i1 && i !== i2);
    this.glyph.contours.push({ closed: false, nodes });
    this.sel.clear();
    this.afterEdit(false);
    return true;
  }

  // An open end dropped onto another open end (of its own contour or of
  // another one) joins them, like closing a path in Illustrator.
  // The open end (of another contour, or the other end of its own) within
  // a few pixels of p, while one open end is selected: [contour, index,
  // node] or null.
  openEndNear(p, px = 10) {
    if (this.sel.size !== 1) return null;
    const cs = this.glyph.contours;
    const [ci, ni] = [...this.sel][0].split(':').map(Number);
    const isEnd = (c, i) => c && !c.closed && c.nodes.length > 1 && (i === 0 || i === c.nodes.length - 1);
    if (!isEnd(cs[ci], ni)) return null;
    const me = this.toScreen(p);
    let hit = null, best = px;
    cs.forEach((c, cj) => {
      if (c.closed) return;
      for (const nj of [0, c.nodes.length - 1]) {
        if ((cj === ci && nj === ni) || (cj === ci && c.nodes.length < 3)) continue;
        const s = this.toScreen(c.nodes[nj]);
        const dist = Math.hypot(s.x - me.x, s.y - me.y);
        if (dist <= best) { best = dist; hit = [cj, nj, c.nodes[nj]]; }
      }
    });
    return hit;
  }

  joinDroppedEnd() {
    if (this.sel.size !== 1) return false;
    const cs = this.glyph.contours;
    const [ci, ni] = [...this.sel][0].split(':').map(Number);
    const near = this.openEndNear(cs[ci].nodes[ni], 2);
    if (!near) return false;
    const hit = near.slice(0, 2);
    const target = cs[hit[0]].nodes[hit[1]];
    movePoint(cs[ci].nodes[ni], target.x - cs[ci].nodes[ni].x, target.y - cs[ci].nodes[ni].y, true);
    this.sel = new Set([`${ci}:${ni}`, `${hit[0]}:${hit[1]}`]);
    // The move is already one undo step; the join is the next.
    this.afterEdit(false);
    return this.joinEnds();
  }

  // Open Corner: every selected sharp point turns into crossing "ears".
  openCorners(d = 30) {
    const keys = [...this.sel].map((k) => k.split(':').map(Number)).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const copy = structuredClone(this.glyph.contours);
    let n = 0;
    for (const [ci, ni] of keys) {
      const node = copy[ci]?.nodes[ni];
      if (node && !node.smooth && openCorner(copy[ci], ni, d)) n++;
    }
    if (!n) return 0;
    this.app.history.push(this.glyph);
    this.glyph.contours = copy;
    this.sel.clear();
    this.afterEdit(false);
    return n;
  }

  // Reconnect: each pair of selected neighbouring points (ears) becomes
  // one sharp point where the segments around them cross.
  reconnectEars() {
    const byContour = new Map();
    for (const k of this.sel) {
      const [ci, ni] = k.split(':').map(Number);
      if (!byContour.has(ci)) byContour.set(ci, []);
      byContour.get(ci).push(ni);
    }
    const copy = structuredClone(this.glyph.contours);
    let n = 0;
    for (const [ci, list] of byContour) {
      const c = copy[ci];
      const set = new Set(list);
      // From the end, so the indexes in front stay valid.
      for (const i of [...set].sort((a, b) => b - a)) {
        const j = i + 1 < c.nodes.length ? i + 1 : c.closed ? 0 : -1;
        if (j < 0 || !set.has(j) || !set.has(i)) continue;
        if (reconnect(c, i)) { n++; set.delete(i); set.delete(j); }
      }
    }
    if (!n) return 0;
    this.app.history.push(this.glyph);
    this.glyph.contours = copy;
    this.sel.clear();
    this.afterEdit(false);
    return n;
  }

  // Alt+Delete: removes the segment between two selected neighbouring
  // points (a closed contour opens there, an open one splits in two).
  deleteSegmentBetween() {
    if (this.sel.size !== 2) return false;
    const [[c1, i], [c2, j]] = [...this.sel].map((k) => k.split(':').map(Number));
    if (c1 !== c2) return false;
    const parts = deleteSegment(this.glyph.contours[c1], i, j);
    if (!parts) return false;
    this.app.history.push(this.glyph);
    this.glyph.contours.splice(c1, 1, ...parts);
    this.sel.clear();
    this.afterEdit(false);
    return true;
  }

  // Makes the handles of the selected points even: on one line through the
  // point and of equal length. A point with one handle gets the mirrored
  // second one.
  evenHandles() {
    const nodes = this.selectedNodes().filter((n) => n.in || n.out);
    if (!nodes.length) return false;
    this.app.history.push(this.glyph);
    for (const n of nodes) {
      const a = n.in || { x: 2 * n.x - n.out.x, y: 2 * n.y - n.out.y };
      const b = n.out || { x: 2 * n.x - n.in.x, y: 2 * n.y - n.in.y };
      let dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const len = (Math.hypot(a.x - n.x, a.y - n.y) + Math.hypot(b.x - n.x, b.y - n.y)) / 2;
      n.in = { x: Math.round(n.x - dx * len), y: Math.round(n.y - dy * len) };
      n.out = { x: Math.round(n.x + dx * len), y: Math.round(n.y + dy * len) };
      n.smooth = true;
    }
    this.afterEdit(false);
    return true;
  }

  // ---------------------------------------------------------------- pixels

  addPixel(p) {
    const d = this.drag;
    const cx = Math.floor(p.x / this.pixelSize), cy = Math.floor(p.y / this.pixelSize);
    d.cells.set(`${cx}:${cy}`, [cx, cy]);
    d.last = p;
  }

  commitPixels(d) {
    if (!d.cells.size) return;
    const s = this.pixelSize;
    const cells = [...d.cells.values()].map(([cx, cy]) => rectContour(cx * s, cy * s, (cx + 1) * s, (cy + 1) * s));
    this.app.history.push(this.glyph);
    const own = this.glyph.contours.filter((c) => c.closed);
    const open = this.glyph.contours.filter((c) => !c.closed);
    let res;
    try {
      res = d.erase ? (own.length ? subtract(own, cells) : own) : (own.length ? unite(own, cells) : removeOverlap(cells));
    } catch { res = d.erase ? own : [...own, ...cells]; }
    this.glyph.contours = [...res, ...open];
    this.sel.clear();
    this.afterEdit();
  }

  drawPixelGrid(colors) {
    const ctx = this.ctx, s = this.pixelSize;
    if (s * this.view.scale < 5) return;
    const a = this.toFont(0, this.h), b = this.toFont(this.w, 0);
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(a.x / s) * s; x <= b.x; x += s) { const sx = Math.round(this.toScreen({ x, y: 0 }).x) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, this.h); }
    for (let y = Math.ceil(a.y / s) * s; y <= b.y; y += s) { const sy = Math.round(this.toScreen({ x: 0, y }).y) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(this.w, sy); }
    ctx.stroke();
  }

  // Alt+arrows: move only the points, their handles stay.
  nudgeNodesOnly(dx, dy) {
    const nodes = this.selectedNodes();
    if (!nodes.length) return false;
    this.app.history.push(this.glyph);
    for (const n of nodes) movePoint(n, dx, dy, false);
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
    if (this.xform) { this.cancelTransform(); return true; }
    if (this.measure) { this.measure = null; this.render(); return true; }
    if (this.preview) { this.preview = null; this.app.onPreviewCancel?.(); this.render(); return true; }
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
      userGuide: css('--canvas-user-guide'), rulerBg: css('--ruler-bg'), rulerLine: css('--ruler-line'), rulerText: css('--ruler-text'),
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

    // Reference picture to trace over (not part of the font).
    const im = g.image && imageOf(g.image.data, () => this.render());
    if (im) {
      const tl = S({ x: g.image.x, y: g.image.y + g.image.h });
      ctx.globalAlpha = g.image.opacity ?? 0.4;
      ctx.drawImage(im, tl.x, tl.y, g.image.w * this.view.scale, g.image.h * this.view.scale);
      ctx.globalAlpha = 1;
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
      ctx.fillText(label, this.showRulers ? RULER + 6 : 10, sy - 3);
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

    // Background layer (extended mode): a dashed outline to compare with.
    const v = this.view;
    if (this.extended && this.showBackground && g.background?.length) {
      ctx.save();
      ctx.setTransform(dpr * v.scale, 0, 0, -dpr * v.scale, dpr * v.ox, dpr * v.oy);
      ctx.beginPath();
      tracePath(ctx, { contours: g.background }, true);
      ctx.restore();
      ctx.fillStyle = colors.accent;
      ctx.globalAlpha = 0.1;
      ctx.fill('nonzero');
      ctx.globalAlpha = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Outline.
    ctx.save();
    ctx.setTransform(dpr * v.scale, 0, 0, -dpr * v.scale, dpr * v.ox, dpr * v.oy);
    ctx.beginPath();
    tracePath(ctx, g, true);
    ctx.restore();
    const points = this.showsPoints();
    const pal = this.app.project.palette;
    if (pal?.length && g.contours.some((c) => c.paint)) {
      // Colour font: each colour group in its own colour, as the font draws it.
      ctx.save();
      ctx.setTransform(dpr * v.scale, 0, 0, -dpr * v.scale, dpr * v.ox, dpr * v.oy);
      ctx.globalAlpha = points ? 0.35 : 0.95;
      for (const [paint, cs] of this.app.paintGroups(g)) {
        const path = new Path2D();
        tracePath(path, { contours: cs }, true);
        ctx.fillStyle = paint ? pal[paint - 1] : colors.ink;
        ctx.fill(path, 'nonzero');
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = colors.ink;
      ctx.globalAlpha = points ? 0.22 : 0.92;
      ctx.fill('nonzero');
      ctx.globalAlpha = 1;
    }
    // A filter's result before it is applied: a dashed outline.
    if (this.preview?.length) {
      ctx.save();
      ctx.setTransform(dpr * v.scale, 0, 0, -dpr * v.scale, dpr * v.ox, dpr * v.oy);
      const pv = new Path2D();
      tracePath(pv, { contours: this.preview });
      ctx.restore();
      ctx.save();
      ctx.setTransform(dpr * v.scale, 0, 0, -dpr * v.scale, dpr * v.ox, dpr * v.oy);
      ctx.fillStyle = colors.accent;
      ctx.globalAlpha = 0.12;
      ctx.fill(pv, 'nonzero');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2 / v.scale;
      ctx.setLineDash([6 / v.scale, 4 / v.scale]);
      ctx.stroke(pv);
      ctx.restore();
    }
    // Components: drawn like the rest, outlined dashed (not editable here).
    if (g.refContours?.length) {
      ctx.save();
      ctx.setTransform(dpr * v.scale, 0, 0, -dpr * v.scale, dpr * v.ox, dpr * v.oy);
      const p2 = new Path2D();
      tracePath(p2, { contours: g.refContours }, true);
      ctx.restore();
      ctx.save();
      ctx.setTransform(dpr * v.scale, 0, 0, -dpr * v.scale, dpr * v.ox, dpr * v.oy);
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 1.5 / v.scale;
      ctx.setLineDash([6 / v.scale, 4 / v.scale]);
      ctx.stroke(p2);
      ctx.restore();
    }
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

    this.drawAnchors(colors);
    this.drawUserGuides(colors);
    this.drawOverlay(colors);

    // Snap marker: a small cross where the point is held.
    const showMark = this.snapMark && (this.drag ? ['move', 'handle', 'shape', 'penHandle', 'xmove', 'xscale'].includes(this.drag.kind)
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
    if (this.showRulers) this.drawRulers(colors);
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
    // Extended mode: points lying exactly on a font line get a ring.
    const fi = this.app.project.info;
    const lines = this.extended ? new Set([0, fi.xHeight, fi.capHeight, fi.ascender, fi.descender]) : null;
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
        if (n.corner) {
          ctx.beginPath();
          ctx.moveTo(s.x + r + 3, s.y - r - 3); ctx.lineTo(s.x + r + 9, s.y - r - 3); ctx.lineTo(s.x + r + 3, s.y - r - 9); ctx.closePath();
          ctx.fillStyle = colors.accent;
          ctx.fill();
        }
        if (lines?.has(n.y)) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, r + 4, 0, Math.PI * 2);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = colors.accent;
          ctx.stroke();
        }
      });
    });
  }

  // Anchors: a diamond with the name, the mark anchors ("_top") hollow.
  drawAnchors(colors) {
    if (!this.extended || !this.glyph.anchors?.length) return;
    const ctx = this.ctx;
    ctx.font = `600 11px ${getComputedStyle(document.documentElement).getPropertyValue('--font-ui') || 'sans-serif'}`;
    for (const a of this.glyph.anchors) {
      const s = this.toScreen(a);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x + 6, s.y); ctx.lineTo(s.x, s.y + 6); ctx.lineTo(s.x - 6, s.y); ctx.closePath();
      ctx.fillStyle = a.name.startsWith('_') ? colors.bg : colors.accent;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors.accent;
      ctx.stroke();
      ctx.fillStyle = colors.accent;
      ctx.fillText(a.name, s.x + 9, s.y - 6);
    }
  }

  // The measuring line: its length and angle, and where it crosses the
  // outline, with the distance between each pair of crossings.
  drawMeasure(colors) {
    const m = this.measure;
    if (!m || (m.start.x === m.end.x && m.start.y === m.end.y)) return;
    const ctx = this.ctx;
    const a = this.toScreen(m.start), b = this.toScreen(m.end);
    const label = (text, x, y, strong) => {
      ctx.font = `${strong ? 600 : 500} 11px ${getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || 'monospace'}`;
      const w = ctx.measureText(text).width + 8;
      ctx.fillStyle = strong ? colors.accent : 'rgba(20,20,24,0.85)';
      ctx.fillRect(x - w / 2, y - 9, w, 17);
      ctx.fillStyle = strong ? '#111' : colors.accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    };
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const hits = [0, 1];
    const dxm = m.end.x - m.start.x, dym = m.end.y - m.start.y;
    for (const c of this.glyph.contours) {
      if (c.nodes.length < 2) continue;
      const pts = flatten(c, 24);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        const ex = q.x - p.x, ey = q.y - p.y;
        const den = dxm * ey - dym * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p.x - m.start.x) * ey - (p.y - m.start.y) * ex) / den;
        const u = ((p.x - m.start.x) * dym - (p.y - m.start.y) * dxm) / den;
        if (t > 0.001 && t < 0.999 && u >= 0 && u < 1) hits.push(t);
      }
    }
    hits.sort((x, y) => x - y);
    const len = Math.hypot(dxm, dym);
    for (let i = 1; i < hits.length; i++) {
      const t0 = hits[i - 1], t1 = hits[i];
      const seg = (t1 - t0) * len;
      if (seg * this.view.scale < 24) continue;
      const mx = a.x + (b.x - a.x) * (t0 + t1) / 2, my = a.y + (b.y - a.y) * (t0 + t1) / 2;
      label(String(Math.round(seg)), mx, my - 12, false);
    }
    for (const t of hits.slice(1, -1)) {
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = colors.accent; ctx.fill();
    }
    for (const pt of [a, b]) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fillStyle = colors.accent; ctx.fill(); }
    const ang = Math.round(Math.atan2(dym, dxm) * 1800 / Math.PI) / 10;
    label(`${Math.round(len)}  ·  ${ang}°  ·  Δx ${Math.round(dxm)}  Δy ${Math.round(dym)}`, b.x, b.y + 22, true);
  }

  drawOverlay(colors) {
    const ctx = this.ctx;
    const d = this.drag;
    const tool = this.activeTool();
    this.drawMeasure(colors);
    if (tool === 'pixel') this.drawPixelGrid(colors);
    if (d?.kind === 'pixel') {
      const ctx2 = this.ctx, sz = this.pixelSize * this.view.scale;
      ctx2.fillStyle = d.erase ? 'rgba(220,60,60,0.45)' : colors.primary;
      ctx2.globalAlpha = d.erase ? 1 : 0.6;
      for (const [cx, cy] of d.cells.values()) {
        const s0 = this.toScreen({ x: cx * this.pixelSize, y: (cy + 1) * this.pixelSize });
        ctx2.fillRect(s0.x, s0.y, sz, sz);
      }
      ctx2.globalAlpha = 1;
    }
    if (d?.kind === 'marquee' && d.lasso) {
      ctx.fillStyle = 'rgba(37,99,235,0.08)';
      ctx.strokeStyle = colors.primary;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      d.lasso.forEach((q, i) => (i ? ctx.lineTo(q.sx, q.sy) : ctx.moveTo(q.sx, q.sy)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (d?.kind === 'marquee') {
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
    if (d?.kind === 'knife') {
      const p = this.toScreen(d.start), q = this.toScreen(d.end);
      ctx.strokeStyle = '#F26B6B';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    // The glyph's points were replaced under an open free transform (undo,
    // another edit): the box would move points that are gone, so drop it.
    if (this.xform && this.xformStale()) { this.xform = null; this.app.onTransformChange?.(); }
    if (this.xform) this.drawTransform(colors);
    this.drawKeyObject(colors);
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

// Decoded pictures by data URL; onload redraws whoever asked first.
const images = new Map();
export function imageOf(data, onload) {
  let im = images.get(data);
  if (!im) {
    if (images.size > 40) images.clear();
    im = new Image();
    im.onload = onload;
    im.src = data;
    images.set(data, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}


// A point whose two handles lie on one line through it is smooth.
function lined(n) {
  if (!n.in || !n.out) return false;
  const a = Math.atan2(n.y - n.in.y, n.x - n.in.x), b = Math.atan2(n.out.y - n.y, n.out.x - n.x);
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.05;
}
