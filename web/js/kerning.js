// Kerning view: a line of text set with the font's own outlines. The cursor
// sits between two letters; that pair is the one being kerned.
import { tracePath, charOf } from './model.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function getKern(project, left, right) {
  return project.kerning?.[left]?.[right] ?? 0;
}

export function setKern(project, left, right, value) {
  if (!project.kerning) project.kerning = {};
  const v = Math.round(value);
  if (!v) {
    if (project.kerning[left]) {
      delete project.kerning[left][right];
      if (!Object.keys(project.kerning[left]).length) delete project.kerning[left];
    }
    return;
  }
  (project.kerning[left] ||= {})[right] = v;
}

export function kernPairs(project) {
  const out = [];
  for (const [l, rights] of Object.entries(project.kerning || {})) {
    for (const [r, v] of Object.entries(rights)) out.push({ left: l, right: r, value: v });
  }
  return out;
}

export class KernView {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.text = 'AVATAR LTYA ToTaVoWa ГАДЮКА ТАТЬЯНА';
    this.cursor = 2;
    this.size = 140; // px per em
    this.drag = null;
    this.items = [];
    this.dpr = window.devicePixelRatio || 1;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    if (!box.width) return;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(box.width * this.dpr);
    this.canvas.height = Math.round(box.height * this.dpr);
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
    this.w = box.width;
    this.h = box.height;
    this.render();
  }

  glyphFor(ch) {
    const cp = ch.codePointAt(0);
    return this.app.project.glyphs.find((g) => g.unicode === cp) || null;
  }

  // The pair at the cursor: { left, right } glyphs, or null.
  pair() {
    this.layout();
    const a = this.items[this.cursor - 1], b = this.items[this.cursor];
    return a?.g && b?.g ? { left: a.g, right: b.g } : null;
  }

  // Positions every character, wrapping lines to the canvas width.
  layout() {
    const p = this.app.project, info = p.info;
    if (!this.w) this.w = this.canvas.parentElement.getBoundingClientRect().width || 800;
    const scale = this.size / info.unitsPerEm;
    const pad = 32;
    const lineH = (info.ascender - info.descender) * scale * 1.35;
    const items = [];
    const chars = Array.from(this.text);
    const advOf = (ch) => { const g = this.glyphFor(ch); return (g ? g.advance : info.unitsPerEm * 0.5) * scale; };
    let x = pad, line = 0, prev = null;
    chars.forEach((ch, i) => {
      const g = this.glyphFor(ch);
      const adv = advOf(ch);
      const kern = prev && g ? getKern(p, prev.name, g.name) * scale : 0;
      // Wrap whole words: at the start of a word, measure it to the next space.
      if (ch !== ' ' && (i === 0 || chars[i - 1] === ' ') && x > pad) {
        let w = 0;
        for (let j = i; j < chars.length && chars[j] !== ' '; j++) w += advOf(chars[j]);
        if (x + w > this.w - pad) { x = pad; line++; }
      }
      // A single word longer than the line still breaks inside.
      if (x + kern + adv > this.w - pad && x > pad && ch !== ' ') { x = pad; line++; }
      x += kern;
      items.push({ ch, g, x, adv, kern, line, baseline: pad + info.ascender * scale + line * lineH });
      x += adv;
      prev = g;
    });
    this.scale = scale;
    this.lineH = lineH;
    this.items = items;
    this.endX = x;
    return items;
  }

  // Cursor boundary closest to a screen point.
  boundaryAt(sx, sy) {
    this.layout();
    if (!this.items.length) return 0;
    let best = 0, bestD = Infinity;
    for (let i = 0; i <= this.items.length; i++) {
      const it = this.items[i] || this.items[i - 1];
      const bx = this.items[i] ? it.x : it.x + it.adv;
      const top = it.baseline - this.app.project.info.ascender * this.scale;
      const dy = sy < top ? top - sy : sy > top + this.lineH ? sy - top - this.lineH : 0;
      const d = Math.abs(sx - bx) + dy * 4;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  eventPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  onDown(e) {
    this.canvas.focus({ preventScroll: true });
    const { sx, sy } = this.eventPos(e);
    this.cursor = this.boundaryAt(sx, sy);
    const pr = this.pair();
    // Dragging sets the kerning of the pair at the cursor.
    if (pr) {
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { sx, start: getKern(this.app.project, pr.left.name, pr.right.name), pr, pushed: false };
    }
    this.app.onKernCursor?.();
    this.render();
  }

  onMove(e) {
    const { sx } = this.eventPos(e);
    const d = this.drag;
    if (!d) {
      this.canvas.style.cursor = this.items.length ? 'text' : 'default';
      return;
    }
    const delta = (sx - d.sx) / this.scale;
    if (!d.pushed && Math.abs(sx - d.sx) < 2) return;
    if (!d.pushed) { this.app.history.pushKerning(this.app.project); d.pushed = true; }
    const step = e.shiftKey ? 1 : 5;
    setKern(this.app.project, d.pr.left.name, d.pr.right.name, Math.round((d.start + delta) / step) * step);
    this.canvas.style.cursor = 'ew-resize';
    this.app.onKernChanged?.();
  }

  onUp(e) {
    if (!this.drag) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* released */ }
    this.drag = null;
  }

  // Keyboard helpers used by the app.
  moveCursor(delta) {
    this.layout();
    this.cursor = Math.max(0, Math.min(this.items.length, this.cursor + delta));
    this.render();
  }

  adjust(delta) {
    const pr = this.pair();
    if (!pr) return false;
    this.app.history.pushKerning(this.app.project);
    setKern(this.app.project, pr.left.name, pr.right.name, getKern(this.app.project, pr.left.name, pr.right.name) + delta);
    this.app.onKernChanged?.();
    return true;
  }

  insertText(str) {
    const chars = Array.from(this.text);
    chars.splice(this.cursor, 0, ...Array.from(str));
    this.text = chars.join('');
    this.cursor += Array.from(str).length;
    this.app.onKernText?.();
    this.render();
  }

  deleteChar(forward) {
    const chars = Array.from(this.text);
    const i = forward ? this.cursor : this.cursor - 1;
    if (i < 0 || i >= chars.length) return;
    chars.splice(i, 1);
    this.text = chars.join('');
    if (!forward) this.cursor--;
    this.app.onKernText?.();
    this.render();
  }

  render() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    if (!this.w || !this.app.project) return;
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const items = this.layout();
    const info = this.app.project.info;
    const s = this.scale;
    const ink = css('--canvas-ink'), line = css('--canvas-line'), accent = css('--accent');
    const neg = css('--danger'), pos = css('--ok'), muted = css('--canvas-text');

    // Baselines.
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    const lines = new Set(items.map((it) => it.baseline));
    ctx.beginPath();
    for (const b of lines) { ctx.moveTo(0, Math.round(b) + 0.5); ctx.lineTo(this.w, Math.round(b) + 0.5); }
    ctx.stroke();

    const pr = this.pair();
    items.forEach((it, i) => {
      const top = it.baseline - info.ascender * s;
      // Highlight the pair being kerned.
      if (pr && (i === this.cursor - 1 || i === this.cursor)) {
        ctx.fillStyle = css('--accent-soft');
        ctx.fillRect(it.x, top, it.adv, (info.ascender - info.descender) * s);
      }
      if (it.g && it.g.contours.length) {
        ctx.save();
        ctx.setTransform(dpr * s, 0, 0, -dpr * s, dpr * it.x, dpr * it.baseline);
        ctx.beginPath();
        tracePath(ctx, it.g, true);
        ctx.restore();
        ctx.fillStyle = ink;
        ctx.fill('nonzero');
      } else if (it.ch.trim()) {
        // Not drawn yet: a faint system-font letter as a placeholder.
        ctx.fillStyle = muted;
        ctx.globalAlpha = 0.45;
        ctx.font = `${info.capHeight * s * 1.4}px ${css('--font-guide')}`;
        ctx.fillText(charOf(it.g) || it.ch, it.x, it.baseline);
        ctx.globalAlpha = 1;
      }
      // Kerning value under the pair.
      if (it.kern) {
        const v = Math.round(it.kern / s);
        ctx.font = `11px ${css('--font-mono')}`;
        ctx.fillStyle = v < 0 ? neg : pos;
        const txt = String(v);
        ctx.fillText(txt, it.x - ctx.measureText(txt).width / 2, it.baseline - info.descender * s + 14);
      }
    });

    // Cursor.
    const c = items[this.cursor] || items[this.cursor - 1];
    if (c) {
      const x = items[this.cursor] ? c.x : c.x + c.adv;
      const top = c.baseline - info.ascender * s;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, top);
      ctx.lineTo(Math.round(x) + 0.5, c.baseline - info.descender * s);
      ctx.stroke();
    }
  }
}
