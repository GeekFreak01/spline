package fontgen

import (
	"math"

	"github.com/GeekFreak01/spline/internal/project"
)

type vec struct{ x, y float64 }

func (a vec) add(b vec) vec        { return vec{a.x + b.x, a.y + b.y} }
func (a vec) sub(b vec) vec        { return vec{a.x - b.x, a.y - b.y} }
func (a vec) mul(s float64) vec    { return vec{a.x * s, a.y * s} }
func (a vec) dist(b vec) float64   { return math.Hypot(a.x-b.x, a.y-b.y) }
func lerp(a, b vec, t float64) vec { return a.add(b.sub(a).mul(t)) }

// segment is either a straight line (p0→p3) or a cubic Bézier.
type segment struct {
	line           bool
	p0, c1, c2, p3 vec
}

// segments returns the closed list of segments of a contour.
func segments(c project.Contour) []segment {
	n := len(c.Nodes)
	if n < 2 {
		return nil
	}
	out := make([]segment, 0, n)
	for i := 0; i < n; i++ {
		a := c.Nodes[i]
		b := c.Nodes[(i+1)%n]
		s := segment{p0: vec{a.X, a.Y}, p3: vec{b.X, b.Y}}
		if a.Out == nil && b.In == nil {
			s.line = true
		} else {
			s.c1, s.c2 = s.p0, s.p3
			if a.Out != nil {
				s.c1 = vec{a.Out.X, a.Out.Y}
			}
			if b.In != nil {
				s.c2 = vec{b.In.X, b.In.Y}
			}
		}
		out = append(out, s)
	}
	return out
}

func (s segment) at(t float64) vec {
	if s.line {
		return lerp(s.p0, s.p3, t)
	}
	mt := 1 - t
	return s.p0.mul(mt * mt * mt).
		add(s.c1.mul(3 * mt * mt * t)).
		add(s.c2.mul(3 * mt * t * t)).
		add(s.p3.mul(t * t * t))
}

// flatten approximates a contour with a polygon.
func flatten(c project.Contour) []vec {
	var pts []vec
	for _, s := range segments(c) {
		if s.line {
			pts = append(pts, s.p0)
			continue
		}
		const steps = 12
		for i := 0; i < steps; i++ {
			pts = append(pts, s.at(float64(i)/steps))
		}
	}
	return pts
}

// signedArea is positive for counter-clockwise polygons (y axis up).
func signedArea(pts []vec) float64 {
	a := 0.0
	for i := range pts {
		p, q := pts[i], pts[(i+1)%len(pts)]
		a += p.x*q.y - q.x*p.y
	}
	return a / 2
}

func pointInPolygon(p vec, poly []vec) bool {
	in := false
	for i, j := 0, len(poly)-1; i < len(poly); j, i = i, i+1 {
		a, b := poly[i], poly[j]
		if (a.y > p.y) != (b.y > p.y) &&
			p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x {
			in = !in
		}
	}
	return in
}

type box struct{ minX, minY, maxX, maxY float64 }

func polyBox(pts []vec) box {
	b := box{math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)}
	for _, p := range pts {
		b.minX = math.Min(b.minX, p.x)
		b.minY = math.Min(b.minY, p.y)
		b.maxX = math.Max(b.maxX, p.x)
		b.maxY = math.Max(b.maxY, p.y)
	}
	return b
}

func (b box) contains(o box) bool {
	return o.minX >= b.minX && o.maxX <= b.maxX && o.minY >= b.minY && o.maxY <= b.maxY
}

// reverse flips the direction of a contour, keeping its shape.
func reverse(c project.Contour) project.Contour {
	n := len(c.Nodes)
	out := project.Contour{Closed: c.Closed, Nodes: make([]project.Node, n)}
	for i, nd := range c.Nodes {
		nd.In, nd.Out = nd.Out, nd.In
		out.Nodes[n-1-i] = nd
	}
	return out
}

// normalize orients contours with the same rule the editor uses:
// a contour lying completely inside an odd number of other contours is a
// hole and runs clockwise, every other contour runs counter-clockwise.
// Partly overlapping shapes therefore always merge instead of cancelling.
// When ccwOuter is false, all directions are flipped (TrueType convention).
func normalize(cs []project.Contour, ccwOuter bool) []project.Contour {
	keep, rev := normalizePlan(cs, ccwOuter)
	out := make([]project.Contour, len(keep))
	for i, k := range keep {
		out[i] = cs[k]
		if rev[i] {
			out[i] = reverse(cs[k])
		}
	}
	return out
}

// normalizePlan decides which contours stay (by index) and which of them
// turn around; variable fonts apply the same plan to every master so the
// points keep matching.
func normalizePlan(cs []project.Contour, ccwOuter bool) (keep []int, rev []bool) {
	var kept []project.Contour
	var polys [][]vec
	for i, c := range cs {
		p := flatten(c)
		if len(p) < 3 || math.Abs(signedArea(p)) < 1e-6 {
			continue
		}
		kept = append(kept, c)
		keep = append(keep, i)
		polys = append(polys, p)
	}
	boxes := make([]box, len(polys))
	for i, p := range polys {
		boxes[i] = polyBox(p)
	}
	rev = make([]bool, len(kept))
	for i := range kept {
		depth := 0
		for j := range kept {
			if i == j || !boxes[j].contains(boxes[i]) {
				continue
			}
			inside := true
			for _, pt := range polys[i] {
				if !pointInPolygon(pt, polys[j]) {
					inside = false
					break
				}
			}
			if inside {
				depth++
			}
		}
		wantCCW := depth%2 == 0
		if !ccwOuter {
			wantCCW = !wantCCW
		}
		rev[i] = (signedArea(polys[i]) > 0) != wantCCW
	}
	return keep, rev
}

// splitCubic returns the part of the cubic between t0 and t1.
func splitCubic(s segment, t0, t1 float64) segment {
	sub := func(s segment, t float64) (segment, segment) {
		a := lerp(s.p0, s.c1, t)
		b := lerp(s.c1, s.c2, t)
		c := lerp(s.c2, s.p3, t)
		d := lerp(a, b, t)
		e := lerp(b, c, t)
		f := lerp(d, e, t)
		return segment{p0: s.p0, c1: a, c2: d, p3: f}, segment{p0: f, c1: e, c2: c, p3: s.p3}
	}
	if t0 > 0 {
		_, s = sub(s, t0)
		t1 = (t1 - t0) / (1 - t0)
	}
	if t1 < 1 {
		s, _ = sub(s, t1)
	}
	return s
}

// quad is a quadratic Bézier with one control point.
type quad struct{ p0, c, p2 vec }

// cubicToQuads approximates a cubic with quadratic curves (TrueType only
// supports quadratics) so that the error stays below tol font units.
func cubicToQuads(s segment, tol float64) []quad {
	for n := 1; n <= 24; n++ {
		qs := make([]quad, 0, n)
		ok := true
		for i := 0; i < n && ok; i++ {
			part := splitCubic(s, float64(i)/float64(n), float64(i+1)/float64(n))
			c := part.c1.add(part.c2).mul(3).sub(part.p0).sub(part.p3).mul(0.25)
			q := quad{part.p0, c, part.p3}
			for _, t := range []float64{0.2, 0.4, 0.5, 0.6, 0.8} {
				mt := 1 - t
				qp := q.p0.mul(mt * mt).add(q.c.mul(2 * mt * t)).add(q.p2.mul(t * t))
				if qp.dist(part.at(t)) > tol {
					ok = false
					break
				}
			}
			qs = append(qs, q)
		}
		if ok || n == 24 {
			return qs
		}
	}
	return nil
}
