// Brush & eraser: paints into a bitmap, then traces the bitmap back into
// smooth Bézier contours. Working in pixels makes unions, holes and erasing
// robust, which is exactly what freehand drawing needs.
import { fitCubic, vec } from './fit.js';
import { tracePath, flatten, polyBox } from './model.js';

const RES = 2; // font units per pixel

// contours: existing contours to merge with; stroke: [{x,y}] in font units.
// Returns new contours that replace `contours`.
export function applyStroke(contours, stroke, radius, erase) {
  const pts = stroke.length === 1 ? [stroke[0], { x: stroke[0].x + 0.01, y: stroke[0].y }] : stroke;
  const sb = polyBox(pts);
  let b = { minX: sb.minX - radius, minY: sb.minY - radius, maxX: sb.maxX + radius, maxY: sb.maxY + radius };
  for (const c of contours) {
    const cb = polyBox(flatten(c, 6));
    b = { minX: Math.min(b.minX, cb.minX), minY: Math.min(b.minY, cb.minY), maxX: Math.max(b.maxX, cb.maxX), maxY: Math.max(b.maxY, cb.maxY) };
  }
  const pad = 4 * RES;
  b.minX -= pad; b.minY -= pad; b.maxX += pad; b.maxY += pad;
  const w = Math.ceil((b.maxX - b.minX) / RES);
  const h = Math.ceil((b.maxY - b.minY) / RES);
  if (w <= 0 || h <= 0 || w * h > 16e6) return contours;

  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(1 / RES, 0, 0, -1 / RES, -b.minX / RES, b.maxY / RES);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  if (contours.length) {
    ctx.beginPath();
    tracePath(ctx, { contours });
    ctx.fill('nonzero');
  }
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.lineWidth = radius * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();

  return traceCanvas(ctx, w, h, (p) => ({ x: b.minX + p.x * RES, y: b.maxY - p.y * RES }), RES);
}

// Traces everything painted on a canvas (alpha > 50%) into contours.
// toFont maps pixel corners to font units; upp = font units per pixel.
export function traceCanvas(ctx, w, h, toFont, upp) {
  const data = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return traceMask(mask, w, h)
    .filter((loop) => loop.length >= 8)
    .map((loop) => loopToContour(loop.map(toFont), upp))
    .filter(Boolean);
}

// Follows pixel edges so that filled pixels are always on the same side.
// Returns closed loops of pixel-corner coordinates.
function traceMask(mask, w, h) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  const W = w + 1;
  // Outgoing edges per vertex: direction 0=right 1=down 2=left 3=up.
  const out = new Map();
  const addEdge = (x, y, d) => {
    const k = y * W + x;
    let v = out.get(k);
    if (!v) out.set(k, (v = []));
    v.push(d);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (!at(x, y - 1)) addEdge(x, y, 0);
      if (!at(x + 1, y)) addEdge(x + 1, y, 1);
      if (!at(x, y + 1)) addEdge(x + 1, y + 1, 2);
      if (!at(x - 1, y)) addEdge(x, y + 1, 3);
    }
  }
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const loops = [];
  for (const [start, dirs] of out) {
    while (dirs.length) {
      let k = start;
      let d = dirs.pop();
      const loop = [];
      for (let guard = 0; guard < 4 * w * h + 8; guard++) {
        const x = k % W, y = (k - x) / W;
        loop.push({ x, y });
        const nk = (y + DY[d]) * W + (x + DX[d]);
        const next = out.get(nk);
        if (!next || !next.length) break;
        // At a saddle prefer turning right, keeping diagonal pixels apart.
        let pick = next.indexOf((d + 1) % 4);
        if (pick < 0) pick = next.indexOf(d);
        if (pick < 0) pick = next.indexOf((d + 3) % 4);
        if (pick < 0) pick = 0;
        d = next.splice(pick, 1)[0];
        k = nk;
        if (k === start) break;
      }
      if (loop.length > 2) loops.push(loop);
    }
  }
  return loops;
}

// Turns a jagged pixel loop into a smooth contour of Bézier nodes.
function loopToContour(raw, upp) {
  // Midpoints of pixel edges remove the staircase, then a light smoothing.
  let pts = raw.map((p, i) => {
    const q = raw[(i + 1) % raw.length];
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  });
  for (let pass = 0; pass < 4; pass++) {
    pts = pts.map((p, i) => {
      const a = pts[(i - 1 + pts.length) % pts.length], c = pts[(i + 1) % pts.length];
      return { x: (a.x + 2 * p.x + c.x) / 4, y: (a.y + 2 * p.y + c.y) / 4 };
    });
  }
  const n = pts.length;
  if (n < 6) return null;

  // Corners: sharp turns measured over a few pixels.
  const K = 3;
  const turn = pts.map((p, i) => {
    const a = vec.norm(vec.sub(p, pts[(i - K + n) % n]));
    const c = vec.norm(vec.sub(pts[(i + K) % n], p));
    return Math.acos(Math.max(-1, Math.min(1, vec.dot(a, c))));
  });
  const corners = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < 0.95) continue;
    let isMax = true;
    for (let j = -K; j <= K; j++) if (turn[(i + j + n) % n] > turn[i]) { isMax = false; break; }
    if (isMax && (!corners.length || i - corners[corners.length - 1] > K)) corners.push(i);
  }
  let splits = corners.slice();
  const smoothSplits = splits.length === 0;
  if (smoothSplits) splits = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4)];
  const isCorner = new Set(smoothSplits ? [] : corners);

  const tangent = (i, dir) => {
    // dir=+1: forward tangent leaving i; dir=-1: tangent pointing back into the previous run.
    if (isCorner.has(i)) {
      const j = (i + dir * K + n) % n;
      return vec.norm(vec.sub(pts[j], pts[i]));
    }
    const fwd = vec.norm(vec.sub(pts[(i + K) % n], pts[(i - K + n) % n]));
    return dir > 0 ? fwd : vec.mul(fwd, -1);
  };

  const tol = 3 * upp; // generous: fewer points are easier to edit
  const curves = [];
  const smoothStart = [];
  for (let s = 0; s < splits.length; s++) {
    const i0 = splits[s];
    const i1 = splits[(s + 1) % splits.length];
    const run = [];
    for (let i = i0; ; i = (i + 1) % n) {
      run.push(pts[i]);
      if ((i === i1 && run.length > 1) || run.length > n + 1) break;
    }
    fitCubic(run, tangent(i0, 1), tangent(i1, -1), tol).forEach((c, k) => {
      curves.push(c);
      smoothStart.push(k > 0 || !isCorner.has(i0));
    });
  }
  // Curve k starts at node k; its second control point is node k+1's "in".
  const r = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  const nodes = curves.map((c, k) => {
    const prev = curves[(k - 1 + curves.length) % curves.length];
    return { ...r(c[0]), in: r(prev[2]), out: r(c[1]), smooth: smoothStart[k] };
  });
  return { closed: true, nodes };
}
