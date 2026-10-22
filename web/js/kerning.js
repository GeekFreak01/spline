// Kerning view: a line of text set with the font's own outlines. The cursor
// sits between two letters; that pair is the one being kerned.
import { tracePath, charOf, glyphBox, hasOutline } from './model.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Kerning keys are glyph names or "@group". The first key of a pair uses
// the right-side group of the first glyph (kernRight), the second key the
// left-side group of the second glyph (kernLeft).
export const isGroup = (key) => key.startsWith('@');
export const groupKey = (name) => (name ? `@${name}` : null);

export function getKern(project, k1, k2) {
  return project.kerning?.[k1]?.[k2] ?? 0;
}

// The rule that applies to a pair of glyphs: the most specific one wins
// (glyph+glyph, glyph+group, group+glyph, group+group). `skip` ignores one
// rule, to see what would apply without it.
export function effectiveKern(project, left, right, skip = null) {
  const L = [left.name, groupKey(left.kernRight)];
  const R = [right.name, groupKey(right.kernLeft)];
  for (const [a, b] of [[L[0], R[0]], [L[0], R[1]], [L[1], R[0]], [L[1], R[1]]]) {
    if (!a || !b || (skip && skip[0] === a && skip[1] === b)) continue;
    const v = project.kerning?.[a]?.[b];
    if (v !== undefined) return { value: v, k1: a, k2: b };
  }
  return { value: 0, k1: null, k2: null };
}

// keepZero stores an explicit 0 (an exception that cancels group kerning).
export function setKern(project, k1, k2, value, keepZero = false) {
  if (!project.kerning) project.kerning = {};
  const v = Math.round(value);
  if (!v && !keepZero) {
    if (project.kerning[k1]) {
      delete project.kerning[k1][k2];
      if (!Object.keys(project.kerning[k1]).length) delete project.kerning[k1];
    }
    return;
  }
  (project.kerning[k1] ||= {})[k2] = v;
}

export function deleteKern(project, k1, k2) { setKern(project, k1, k2, 0, false); }

// Glyphs whose right (side = 'right') or left side belongs to a group.
export function groupMembers(project, name, side) {
  return project.glyphs.filter((g) => (side === 'right' ? g.kernRight : g.kernLeft) === name);
}

// A pair kerned tighter than this share of the narrower glyph's width
// makes "T.T" tighter than "TT".
export const OVERKERN = 0.4;
export const isOverkern = (value, left, right) => value < 0 && -value > OVERKERN * Math.min(left.advance, right.advance);

// All rules: { left, right, value } with glyph names or "@group" keys.
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
    // Edit the pair at group level (true) or as a glyph exception (false).
    this.useGroups = { left: true, right: true };
    // Draw every member of the pair's groups over the pair (see collisions).
    this.showGroupMembers = false;
    this.dpr = window.devicePixelRatio || 1;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => { if (this.hover !== null) { this.hover = null; this.render(); } });
    this.hover = null; // index of the letter whose kerning value is shown
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

  // Sidebearing numbers under the line: an extended-mode option, so they
  // go away with the simple mode even when the box stays ticked.
  metricsShown() { return !!(this.app.extended && this.showMetrics); }

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
    const lineH = (info.ascender - info.descender) * scale * 1.35 + (this.metricsShown() ? 44 : 0);
    const items = [];
    const chars = Array.from(this.text);
    const advOf = (ch) => { const g = this.glyphFor(ch); return (g ? g.advance : info.unitsPerEm * 0.5) * scale; };
    let x = pad, line = 0, prev = null;
    chars.forEach((ch, i) => {
      const g = this.glyphFor(ch);
      const adv = advOf(ch);
      const rule = prev && g ? effectiveKern(p, prev, g) : null;
      const kern = rule ? rule.value * scale : 0;
      // Wrap whole words: at the start of a word, measure it to the next space.
      if (ch !== ' ' && (i === 0 || chars[i - 1] === ' ') && x > pad) {
        let w = 0;
        for (let j = i; j < chars.length && chars[j] !== ' '; j++) w += advOf(chars[j]);
        if (x + w > this.w - pad) { x = pad; line++; }
      }
      // A single word longer than the line still breaks inside.
      if (x + kern + adv > this.w - pad && x > pad && ch !== ' ') { x = pad; line++; }
      x += kern;
      // An exception: a glyph-level rule while that glyph also has a group.
      const exception = !!rule?.k1 && ((!isGroup(rule.k1) && prev.kernRight) || (!isGroup(rule.k2) && g.kernLeft));
      const over = !!rule && isOverkern(rule.value, prev, g);
      items.push({ ch, g, x, adv, kern, exception, over, line, baseline: pad + info.ascender * scale + line * lineH });
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
      this.drag = { sx, start: effectiveKern(this.app.project, pr.left, pr.right).value, pr, pushed: false };
    }
    this.app.onKernCursor?.();
    this.render();
  }

  onMove(e) {
    const { sx } = this.eventPos(e);
    const d = this.drag;
    if (!d) {
      this.canvas.style.cursor = this.items.length ? 'text' : 'default';
      // Hovering a kerned gap shows its value.
      const { sy } = this.eventPos(e);
      const b = this.boundaryAt(sx, sy);
      const it = this.items[b];
      const hit = it?.kern && Math.abs(sx - it.x) < Math.max(8, Math.abs(it.kern) / 2 + 4) ? b : null;
      if (hit !== this.hover) { this.hover = hit; this.render(); }
      return;
    }
    const delta = (sx - d.sx) / this.scale;
    if (!d.pushed && Math.abs(sx - d.sx) < 2) return;
    if (!d.pushed) { this.app.history.pushKerning(this.app.project); d.pushed = true; }
    const step = e.shiftKey ? 1 : 5;
    this.writeKern(d.pr, Math.round((d.start + delta) / step) * step);
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
    this.writeKern(pr, effectiveKern(this.app.project, pr.left, pr.right).value + delta);
    this.app.onKernChanged?.();
    return true;
  }

  // Keys the pair is edited at: groups where available and chosen.
  targetKeys(pr) {
    const k1 = this.useGroups.left && pr.left.kernRight ? groupKey(pr.left.kernRight) : pr.left.name;
    const k2 = this.useGroups.right && pr.right.kernLeft ? groupKey(pr.right.kernLeft) : pr.right.name;
    return [k1, k2];
  }

  writeKern(pr, value) {
    const p = this.app.project;
    const [k1, k2] = this.targetKeys(pr);
    // A zero exception is kept when a broader rule would apply otherwise.
    const broader = effectiveKern(p, pr.left, pr.right, [k1, k2]).value;
    setKern(p, k1, k2, value, !(isGroup(k1) && isGroup(k2)) && broader !== 0);
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
    const tight = css('--dot-blue'), loose = css('--dot-yellow'), danger = css('--danger'), exc = css('--dot-orange');
    const muted = css('--canvas-text');

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
      if (it.g && hasOutline(it.g)) {
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
    });

    // Members of the groups being kerned, faint, on top of the pair: the
    // left group right-aligned to the left letter, the right group from the
    // right letter's origin.
    if (pr && this.showGroupMembers) {
      const L = items[this.cursor - 1], R = items[this.cursor];
      const ghost = (g, x, baseline) => {
        if (!hasOutline(g)) return;
        ctx.save();
        ctx.setTransform(dpr * s, 0, 0, -dpr * s, dpr * x, dpr * baseline);
        ctx.beginPath();
        tracePath(ctx, g, true);
        ctx.restore();
        ctx.fill('nonzero');
      };
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.28;
      if (this.useGroups.left && L.g.kernRight) {
        for (const m of groupMembers(this.app.project, L.g.kernRight, 'right')) if (m !== L.g) ghost(m, L.x + L.adv - m.advance * s, L.baseline);
      }
      if (this.useGroups.right && R.g.kernLeft) {
        for (const m of groupMembers(this.app.project, R.g.kernLeft, 'left')) if (m !== R.g) ghost(m, R.x, R.baseline);
      }
      ctx.globalAlpha = 1;
    }

    // Kerning between letters: a bar from where the gap would be to where it
    // is (blue: tighter, yellow: looser), the value on hover and for the pair
    // at the cursor, a red frame around pairs kerned too tight.
    items.forEach((it, i) => {
      if (!it.kern) return;
      const prev = items[i - 1];
      const v = Math.round(it.kern / s);
      const top = it.baseline - info.ascender * s, bottom = it.baseline - info.descender * s;
      const x0 = Math.min(it.x, it.x - it.kern), w = Math.max(2, Math.abs(it.kern));
      const color = it.over ? danger : v < 0 ? tight : loose;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(x0, top, w, bottom - top);
      ctx.globalAlpha = 1;
      ctx.fillRect(x0, bottom + 4, w, 3);
      if (it.exception) {
        ctx.strokeStyle = exc;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(x0 + 0.5, bottom + 3.5, w - 1, 4);
        ctx.setLineDash([]);
      }
      if (it.over && prev) {
        ctx.strokeStyle = danger;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(prev.x + 0.5, top + 0.5, it.x + it.adv - prev.x - 1, bottom - top - 1);
      }
      if (i === this.hover || (pr && i === this.cursor)) {
        const txt = String(v);
        ctx.font = `11px ${css('--font-mono')}`;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = it.exception ? exc : color;
        ctx.fillText(txt, it.x - tw / 2, bottom + 20);
      }
    });

    // Spacing (extended mode): each letter's width box and its left and
    // right sidebearings under it. The letters around the cursor are the
    // ones Ctrl+arrows change, so their numbers are highlighted.
    if (this.metricsShown()) {
      ctx.font = `11px ${css('--font-mono')}`;
      let rowEnd = [-1e9, -1e9], rowLine = -1;
      items.forEach((it, i) => {
        if (!it.g) return;
        const top = it.baseline - info.ascender * s, bottom = it.baseline - info.descender * s;
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.strokeRect(Math.round(it.x) + 0.5, top + 0.5, Math.round(it.adv), bottom - top);
        ctx.setLineDash([]);
        const box = glyphBox(it.g);
        if (!box || !it.ch.trim()) return;
        const lsb = String(Math.round(box.minX)), rsb = String(Math.round(it.g.advance - box.maxX));
        // Numbers that would touch the previous one drop to a second row.
        const put = (txt, x, hot) => {
          const w = ctx.measureText(txt).width;
          const row = rowEnd[0] < x - 4 || rowEnd[1] >= x - 4 ? 0 : 1;
          rowEnd[row] = x + w;
          ctx.fillStyle = hot ? accent : muted;
          ctx.fillText(txt, x, bottom + 38 + row * 13);
        };
        if (it.line !== rowLine) { rowLine = it.line; rowEnd = [-1e9, -1e9]; }
        put(lsb, it.x + 2, i === this.cursor);
        put(rsb, it.x + it.adv - ctx.measureText(rsb).width - 2, i === this.cursor - 1);
      });
    }

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
