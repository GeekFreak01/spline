// SVG import. Filled shapes are converted exactly (paths, rect, circle,
// ellipse, polygon, transforms, arcs). Drawings made of strokes are
// rasterised and traced, so line art also turns into proper outlines.
import { traceCanvas } from './trace.js';

const SKIP_PARENTS = 'defs, clipPath, mask, symbol, marker, pattern, metadata';
const SHAPES = 'path, rect, circle, ellipse, polygon, polyline, line';

// ------------------------------------------------------------ parsing

function parseDocument(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (doc.querySelector('parsererror') || svg.localName !== 'svg') throw new Error('not a valid SVG file');
  // Nothing from the file may run or load: drop scripts, styles, external
  // references and event handlers before the SVG touches our page.
  svg.querySelectorAll('script, style, foreignObject, image, use, a, iframe, animate, set, animateTransform, animateMotion')
    .forEach((el) => el.remove());
  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || /href$/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  }
  return svg;
}

// Computed paint of an element, following inheritance through attributes
// and inline style declarations.
function paint(el, prop) {
  for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
    const style = n.getAttribute('style') || '';
    const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'));
    const v = (m ? m[1] : n.getAttribute(prop))?.trim();
    if (v && v !== 'inherit') return v;
  }
  return prop === 'fill' ? 'black' : 'none';
}

function num(el, name) { return parseFloat(el.getAttribute(name)) || 0; }

function shapeToPath(el) {
  switch (el.localName) {
    case 'path': return el.getAttribute('d') || '';
    case 'rect': {
      const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height');
      let rx = num(el, 'rx'), ry = num(el, 'ry');
      if (!el.hasAttribute('rx')) rx = ry;
      if (!el.hasAttribute('ry')) ry = rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}`
        + `A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}`
        + `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(el, 'cx'), cy = num(el, 'cy');
      const rx = el.localName === 'circle' ? num(el, 'r') : num(el, 'rx');
      const ry = el.localName === 'circle' ? num(el, 'r') : num(el, 'ry');
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'polygon':
    case 'polyline': {
      const p = (el.getAttribute('points') || '').trim();
      return p ? `M${p}${el.localName === 'polygon' ? 'Z' : ''}` : '';
    }
  }
  return '';
}

// Tokenizer aware of compact arc flags ("a1 1 0 01 5 5").
function tokenize(d) {
  const out = [];
  const re = /([MmZzLlHhVvCcSsQqTtAa])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m;
  // Numbers stay strings so arc flags glued together ("01") can be split.
  while ((m = re.exec(d))) out.push(m[1] ? { cmd: m[1] } : m[2]);
  return out;
}

// Returns subpaths as lists of absolute cubic segments.
export function parsePathData(d) {
  const tokens = tokenize(d);
  const paths = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', lastCtrl = null, lastCmd = '';
  let i = 0;

  // Arc flags may be glued to the next number ("01"), split them.
  const flag = () => {
    const t = tokens[i];
    if (typeof t !== 'string') return 0;
    const f = t.replace(/^\+/, '')[0] === '1' ? 1 : 0;
    const rest = t.replace(/^\+/, '').slice(1);
    if (rest) tokens[i] = rest; else i++;
    return f;
  };
  const n = () => { const v = tokens[i++]; return typeof v === 'string' ? Number(v) : 0; };
  const start = (px, py) => { cur = { start: { x: px, y: py }, segs: [], closed: false }; paths.push(cur); };
  const cubic = (c1, c2, p) => {
    if (!cur) start(x, y);
    cur.segs.push({ c1, c2, p });
    x = p.x; y = p.y;
  };
  const line = (px, py) => cubic(null, null, { x: px, y: py });

  while (i < tokens.length) {
    if (typeof tokens[i] === 'object') { cmd = tokens[i++].cmd; } else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        const px = n() + ox, py = n() + oy;
        start(px, py);
        x = sx = px; y = sy = py;
        cmd = rel ? 'l' : 'L'; // following pairs are line-tos
        lastCtrl = null;
        break;
      }
      case 'L': line(n() + ox, n() + oy); lastCtrl = null; break;
      case 'H': line(n() + ox, y); lastCtrl = null; break;
      case 'V': line(x, n() + oy); lastCtrl = null; break;
      case 'C': {
        const c1 = { x: n() + ox, y: n() + oy }, c2 = { x: n() + ox, y: n() + oy }, p = { x: n() + ox, y: n() + oy };
        cubic(c1, c2, p); lastCtrl = c2; break;
      }
      case 'S': {
        const c1 = lastCtrl && /[CS]/i.test(lastCmd) ? { x: 2 * x - lastCtrl.x, y: 2 * y - lastCtrl.y } : { x, y };
        const c2 = { x: n() + ox, y: n() + oy }, p = { x: n() + ox, y: n() + oy };
        cubic(c1, c2, p); lastCtrl = c2; break;
      }
      case 'Q': {
        const q = { x: n() + ox, y: n() + oy }, p = { x: n() + ox, y: n() + oy };
        quad(q, p); lastCtrl = q; break;
      }
      case 'T': {
        const q = lastCtrl && /[QT]/i.test(lastCmd) ? { x: 2 * x - lastCtrl.x, y: 2 * y - lastCtrl.y } : { x, y };
        const p = { x: n() + ox, y: n() + oy };
        quad(q, p); lastCtrl = q; break;
      }
      case 'A': {
        const rx = n(), ry = n(), rot = n(), large = flag(), sweep = flag();
        const p = { x: n() + ox, y: n() + oy };
        for (const s of arcToCubics(x, y, rx, ry, rot, large, sweep, p.x, p.y)) cubic(s[0], s[1], s[2]);
        lastCtrl = null; break;
      }
      case 'Z':
        if (cur) cur.closed = true;
        x = sx; y = sy;
        cur = null;
        lastCtrl = null;
        break;
      default:
        i++;
    }
    lastCmd = cmd;
  }
  return paths.filter((p) => p.segs.length);

  function quad(q, p) {
    cubic({ x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) },
      { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p);
  }
}

// SVG arc (endpoint form) → cubic Béziers, at most 90° each.
function arcToCubics(x1, y1, rx, ry, angle, large, sweep, x2, y2) {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x2, y: y2 }]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (angle * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const step = dt / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const pt = (t) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const dv = (t) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  const out = [];
  for (let s = 0; s < segs; s++) {
    const a = t1 + s * step, b = a + step;
    const p0 = pt(a), p1 = pt(b), d0 = dv(a), d1 = dv(b);
    out.push([{ x: p0.x + k * d0.x, y: p0.y + k * d0.y }, { x: p1.x - k * d1.x, y: p1.y - k * d1.y }, p1]);
  }
  return out;
}

// ------------------------------------------------------------ conversion

const apply = (m, p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
const same = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

function subpathToContour(sp, m) {
  const nodes = [{ ...apply(m, sp.start) }];
  for (const s of sp.segs) {
    const prev = nodes[nodes.length - 1];
    const p = apply(m, s.p);
    const node = { ...p };
    if (s.c1) {
      const c1 = apply(m, s.c1), c2 = apply(m, s.c2);
      if (!(same(c1, prev) && same(c2, p))) { prev.out = c1; node.in = c2; }
    }
    nodes.push(node);
  }
  // A closing point that repeats the start becomes the start node.
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (nodes.length > 1 && same(first, last)) {
    if (last.in) first.in = last.in;
    nodes.pop();
  }
  for (const nd of nodes) {
    if (nd.in && nd.out) {
      const a = Math.atan2(nd.y - nd.in.y, nd.x - nd.in.x), b = Math.atan2(nd.out.y - nd.y, nd.out.x - nd.x);
      nd.smooth = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.05;
    }
  }
  return nodes.length >= 2 ? { closed: true, nodes } : null;
}

// Returns contours in SVG user space (y down) plus how they were made.
async function extract(svg) {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden';
  const live = document.importNode(svg, true);
  host.append(live);
  document.body.append(host);
  try {
    const shapes = [...live.querySelectorAll(SHAPES)].filter((el) => !el.closest(SKIP_PARENTS));
    const stroked = shapes.some((el) => paint(el, 'stroke') !== 'none' && paint(el, 'stroke-width') !== '0');
    if (stroked) return { contours: await rasterTrace(live), traced: true };
    const contours = [];
    for (const el of shapes) {
      if (paint(el, 'fill') === 'none' || el.localName === 'line') continue;
      const m = el.getCTM() || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      for (const sp of parsePathData(shapeToPath(el))) {
        const c = subpathToContour(sp, m);
        if (c) contours.push(c);
      }
    }
    return { contours, traced: false };
  } finally {
    host.remove();
  }
}

// Draws the SVG into a bitmap and traces it (handles strokes, dashes, etc.).
async function rasterTrace(live) {
  const box = live.getBBox();
  if (!box.width || !box.height) return [];
  const size = 1400;
  const pad = 4;
  const scale = (size - pad * 2) / Math.max(box.width, box.height);
  const w = Math.ceil(box.width * scale) + pad * 2, h = Math.ceil(box.height * scale) + pad * 2;
  const clone = live.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${box.x - pad / scale} ${box.y - pad / scale} ${w / scale} ${h / scale}`);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const ox = box.x - pad / scale, oy = box.y - pad / scale;
    return traceCanvas(ctx, w, h, (p) => ({ x: ox + p.x / scale, y: oy + p.y / scale }), 1 / scale);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Which guide lines a character should sit between.
function zoneFor(ch, info) {
  const top = { x: info.xHeight, cap: info.capHeight, asc: Math.round(info.capHeight * 1.06) };
  if (/[acemnorsuvwxzавгеёжзийклмнопстхцчшщъыьэюя]/.test(ch)) return { top: top.x, bottom: 0 };
  if (/[gpqyру]/.test(ch)) return { top: top.x, bottom: info.descender };
  if (/[jдфб]/.test(ch)) return ch === 'б' ? { top: top.asc, bottom: 0 } : { top: ch === 'j' ? top.asc : top.x, bottom: info.descender };
  if (/[bdfhklt]/.test(ch)) return { top: top.asc, bottom: 0 };
  return { top: top.cap, bottom: 0 };
}

// Converts SVG text into glyph contours scaled to the font's guide lines.
// Returns { contours, advance, traced }.
export async function importSVG(text, info, ch = '') {
  const svg = parseDocument(text);
  const { contours, traced } = await extract(svg);
  if (!contours.length) throw new Error('no filled shapes found in the SVG');
  const pts = contours.flatMap((c) => c.nodes.flatMap((n) => [n, n.in, n.out].filter(Boolean)));
  const anchors = contours.flatMap((c) => c.nodes);
  const minX = Math.min(...anchors.map((p) => p.x)), maxX = Math.max(...anchors.map((p) => p.x));
  const minY = Math.min(...anchors.map((p) => p.y)), maxY = Math.max(...anchors.map((p) => p.y));
  const zone = zoneFor(ch, info);
  const s = (zone.top - zone.bottom) / Math.max(1e-6, maxY - minY);
  const side = 50;
  const map = (p) => ({ x: Math.round(side + (p.x - minX) * s), y: Math.round(zone.bottom + (maxY - p.y) * s) });
  for (const p of pts) Object.assign(p, map(p));
  return { contours, advance: Math.round((maxX - minX) * s + side * 2), traced };
}

export const looksLikeSVG = (text) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text);
