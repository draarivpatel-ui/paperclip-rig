'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const E = require('../engine.js');

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `expected ${a} to be within ${tol} of ${b}`);
const pt = (x, y) => ({ x, y });

const K = 0.5522847498;
function circlePath(r, cx, cy) {
  const k = K * r;
  return `M${cx + r} ${cy}C${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}` +
    `C${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy}` +
    `C${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}` +
    `C${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}Z`;
}

/* ---------------------------- cubic Bezier ------------------------------ */

const ARCH = [pt(0, 0), pt(0, 100), pt(100, 100), pt(100, 0)];

test('evaluateCubicBezier returns the end points at t = 0 and t = 1', () => {
  assert.deepEqual(E.evaluateCubicBezier(...ARCH, 0), pt(0, 0));
  assert.deepEqual(E.evaluateCubicBezier(...ARCH, 1), pt(100, 0));
});

test('evaluateCubicBezier midpoint of the arch is (50, 75)', () => {
  const p = E.evaluateCubicBezier(...ARCH, 0.5);
  near(p.x, 50);
  near(p.y, 75);
});

test('evaluateCubicBezier matches the Bernstein polynomial form', () => {
  const [p0, p1, p2, p3] = [pt(3, -2), pt(17, 40), pt(-8, 22), pt(31, 5)];
  const t = 0.3;
  const u = 1 - t;
  const bx = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
  const by = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
  const p = E.evaluateCubicBezier(p0, p1, p2, p3, t);
  near(p.x, bx, 1e-9);
  near(p.y, by, 1e-9);
});

test('a cubic with evenly spaced collinear controls is a straight line', () => {
  const p = E.evaluateCubicBezier(pt(0, 0), pt(10, 10), pt(20, 20), pt(30, 30), 0.25);
  near(p.x, 7.5);
  near(p.y, 7.5);
});

test('splitCubicBezier halves share the split point and reproduce the curve', () => {
  const t = 0.35;
  const { left, right } = E.splitCubicBezier(...ARCH, t);
  const at = E.evaluateCubicBezier(...ARCH, t);
  assert.deepEqual(left[3], right[0]);
  near(left[3].x, at.x);
  near(left[3].y, at.y);
  const s = 0.6;
  const l = E.evaluateCubicBezier(...left, s);
  const whole1 = E.evaluateCubicBezier(...ARCH, t * s);
  near(l.x, whole1.x, 1e-9);
  near(l.y, whole1.y, 1e-9);
  const r = E.evaluateCubicBezier(...right, s);
  const whole2 = E.evaluateCubicBezier(...ARCH, t + (1 - t) * s);
  near(r.x, whole2.x, 1e-9);
  near(r.y, whole2.y, 1e-9);
});

test('splitCubicBezier keeps the original end points', () => {
  const { left, right } = E.splitCubicBezier(...ARCH, 0.5);
  assert.deepEqual(left[0], ARCH[0]);
  assert.deepEqual(right[3], ARCH[3]);
  assert.notEqual(left[0], ARCH[0]);
});

test('cubicFirstDerivative at the ends is three times the control legs', () => {
  assert.deepEqual(E.cubicFirstDerivative(...ARCH, 0), pt(0, 300));
  assert.deepEqual(E.cubicFirstDerivative(...ARCH, 1), pt(0, -300));
});

test('cubicSecondDerivative at both ends is six times the second difference', () => {
  const d = E.cubicSecondDerivative(...ARCH, 0);
  assert.deepEqual(d, pt(600, -600));
  const e = E.cubicSecondDerivative(...ARCH, 1);
  assert.deepEqual(e, pt(-600, -600));
});

test('curvatureAtCubic of a circle quadrant is close to 1 / r', () => {
  const r = 50;
  const k = K * r;
  const quad = [pt(r, 0), pt(r, k), pt(k, r), pt(0, r)];
  [0.1, 0.5, 0.9].forEach((t) => near(Math.abs(E.curvatureAtCubic(...quad, t)), 1 / r, 0.0004));
});

test('curvatureAtCubic is zero on a straight cubic and for a degenerate one', () => {
  near(E.curvatureAtCubic(pt(0, 0), pt(1, 1), pt(2, 2), pt(3, 3), 0.4), 0, 1e-12);
  assert.equal(E.curvatureAtCubic(pt(5, 5), pt(5, 5), pt(5, 5), pt(5, 5), 0.5), 0);
});

test('curvature flips sign when the curve direction is reversed', () => {
  const fwd = E.curvatureAtCubic(...ARCH, 0.3);
  const rev = E.curvatureAtCubic(ARCH[3], ARCH[2], ARCH[1], ARCH[0], 0.7);
  near(fwd, -rev, 1e-9);
  assert.ok(Math.abs(fwd) > 0);
});

test('flattenCubicBezier returns segments + 1 points including both ends', () => {
  const pts = E.flattenCubicBezier(...ARCH, 10);
  assert.equal(pts.length, 11);
  assert.deepEqual(pts[0], ARCH[0]);
  assert.deepEqual(pts[10], ARCH[3]);
  assert.equal(E.flattenCubicBezier(...ARCH, 0).length, 2);
  assert.equal(E.flattenCubicBezier(...ARCH, 2.9).length, 3);
});

test('cubicBoundingBox of the arch has its peak at 75', () => {
  const b = E.cubicBoundingBox(...ARCH);
  near(b.minX, 0);
  near(b.maxX, 100);
  near(b.minY, 0);
  near(b.maxY, 75);
  near(b.width, 100);
  near(b.height, 75);
});

test('cubicBoundingBox finds an interior extreme from a quadratic derivative', () => {
  const b = E.cubicBoundingBox(pt(0, 0), pt(0, 60), pt(100, 60), pt(100, 0));
  near(b.maxY, 45);
});

test('cubicBoundingBox handles a derivative that is linear in t', () => {
  const b = E.cubicBoundingBox(pt(0, 0), pt(6, 0), pt(2, 0), pt(-12, 0));
  near(b.maxX, 2.7, 1e-9);
  near(b.minX, -12, 1e-9);
});

test('cubicBoundingBox ignores roots outside the open interval (0, 1)', () => {
  const b = E.cubicBoundingBox(pt(0, 0), pt(10, 10), pt(20, 20), pt(30, 30));
  near(b.minX, 0);
  near(b.maxX, 30);
});

test('polylineBoundingBox and its empty case', () => {
  const b = E.polylineBoundingBox([pt(3, 4), pt(-1, 9), pt(7, 2)]);
  assert.deepEqual([b.minX, b.minY, b.maxX, b.maxY, b.width, b.height], [-1, 2, 7, 9, 8, 7]);
  assert.deepEqual(E.polylineBoundingBox([]), { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 });
});

test('polylineLength open and closed', () => {
  const sq = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];
  near(E.polylineLength(sq, false), 30);
  near(E.polylineLength(sq, true), 40);
  near(E.polylineLength([pt(0, 0), pt(3, 4)], true), 5);
  near(E.polylineLength([pt(1, 1)], false), 0);
});

/* ------------------------- Ramer-Douglas-Peucker ------------------------- */

test('perpendicularDistance to a segment, clamped past the ends', () => {
  near(E.perpendicularDistance(pt(5, 5), pt(0, 0), pt(10, 0)), 5);
  near(E.perpendicularDistance(pt(15, 0), pt(0, 0), pt(10, 0)), 5);
  near(E.perpendicularDistance(pt(-3, 4), pt(0, 0), pt(10, 0)), 5);
  near(E.perpendicularDistance(pt(3, 4), pt(1, 1), pt(1, 1)), Math.hypot(2, 3));
});

test('simplifyPolylineRdp collapses collinear points to the two end points', () => {
  const line = [];
  for (let i = 0; i <= 20; i += 1) { line.push(pt(i, 2 * i)); }
  const out = E.simplifyPolylineRdp(line, 0.001);
  assert.deepEqual(out, [pt(0, 0), pt(20, 40)]);
});

test('simplifyPolylineRdp keeps peaks above epsilon and drops them below it', () => {
  const zig = [pt(0, 0), pt(1, 5), pt(2, 0), pt(3, 5), pt(4, 0)];
  assert.equal(E.simplifyPolylineRdp(zig, 1).length, 5);
  assert.equal(E.simplifyPolylineRdp(zig, 6).length, 2);
});

test('simplifyPolylineRdp drops a point exactly epsilon away (strict comparison)', () => {
  const tri = [pt(0, 0), pt(5, 2), pt(10, 0)];
  assert.equal(E.simplifyPolylineRdp(tri, 2).length, 2);
  assert.equal(E.simplifyPolylineRdp(tri, 1.99).length, 3);
});

test('simplifyPolylineRdp with fewer than 3 points returns copies', () => {
  const src = [pt(1, 1), pt(2, 2)];
  const out = E.simplifyPolylineRdp(src, 5);
  assert.deepEqual(out, src);
  assert.notEqual(out[0], src[0]);
  assert.deepEqual(E.simplifyPolylineRdp([], 1), []);
});

test('simplifyPolylineRdp always keeps the first and last point', () => {
  const noisy = [];
  for (let i = 0; i < 50; i += 1) { noisy.push(pt(i, Math.sin(i / 4) * 10)); }
  const out = E.simplifyPolylineRdp(noisy, 100);
  assert.deepEqual(out[0], noisy[0]);
  assert.deepEqual(out[out.length - 1], noisy[49]);
  assert.equal(out.length, 2);
});

test('simplifyPolylineRdp output is an ordered subset within epsilon of the input', () => {
  const trace = [];
  for (let i = 0; i <= 200; i += 1) { trace.push(pt(i, Math.sin(i / 15) * 30)); }
  const eps = 0.8;
  const out = E.simplifyPolylineRdp(trace, eps);
  assert.ok(out.length < trace.length / 3);
  let cursor = 0;
  out.forEach((p) => {
    while (cursor < trace.length && !(trace[cursor].x === p.x && trace[cursor].y === p.y)) { cursor += 1; }
    assert.ok(cursor < trace.length, 'point is not in the input order');
  });
  assert.ok(E.polylineDeviation(trace, out, false) <= eps + 1e-9);
});

test('simplifyPolylineRdp node count never grows when epsilon grows', () => {
  const trace = [];
  for (let i = 0; i <= 300; i += 1) { trace.push(pt(i, Math.sin(i / 9) * 25 + Math.cos(i / 4) * 4)); }
  let last = Infinity;
  [0.05, 0.2, 0.5, 1, 2, 5, 20].forEach((eps) => {
    const n = E.simplifyPolylineRdp(trace, eps).length;
    assert.ok(n <= last);
    last = n;
  });
});

test('simplifyPolylineRdp is iterative and survives a very long input', () => {
  const big = [];
  for (let i = 0; i < 100000; i += 1) { big.push(pt(i, 0)); }
  assert.equal(E.simplifyPolylineRdp(big, 0.5).length, 2);
});

test('simplifyClosedPolylineRdp reduces a padded square ring to its corners', () => {
  const ring = [];
  for (let i = 0; i < 10; i += 1) { ring.push(pt(i * 10, 0)); }
  for (let i = 0; i < 10; i += 1) { ring.push(pt(100, i * 10)); }
  for (let i = 0; i < 10; i += 1) { ring.push(pt(100 - i * 10, 100)); }
  for (let i = 0; i < 10; i += 1) { ring.push(pt(0, 100 - i * 10)); }
  const out = E.simplifyClosedPolylineRdp(ring, 0.5);
  assert.equal(out.length, 4);
  const keys = out.map((p) => `${p.x},${p.y}`).sort();
  assert.deepEqual(keys, ['0,0', '0,100', '100,0', '100,100']);
});

test('simplifyClosedPolylineRdp leaves tiny rings alone', () => {
  const tri = [pt(0, 0), pt(5, 0), pt(0, 5)];
  assert.deepEqual(E.simplifyClosedPolylineRdp(tri, 10), tri);
});

test('polylineDeviation is zero for equal lines and the offset for parallel lines', () => {
  const a = [pt(0, 0), pt(10, 0), pt(20, 0)];
  const b = [pt(0, 3), pt(20, 3)];
  near(E.polylineDeviation(a, a, false), 0);
  near(E.polylineDeviation(a, b, false), 3);
  assert.equal(E.polylineDeviation([], b, false), 0);
});

test('polylineDeviation treats a closed ring as closed', () => {
  const ring = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];
  const probe = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10), pt(0, 5)];
  near(E.polylineDeviation(probe, ring, true), 0);
  near(E.polylineDeviation(probe, ring, false), 5);
});

/* --------------------------- SVG path handling --------------------------- */

test('parseSvgPath reads absolute M L C Z', () => {
  const cmds = E.parseSvgPath('M10 20L30 40C1 2 3 4 5 6Z');
  assert.deepEqual(cmds.map((c) => c.cmd), ['M', 'L', 'C', 'Z']);
  assert.deepEqual(cmds[2].args, [1, 2, 3, 4, 5, 6]);
});

test('parseSvgPath converts relative commands to absolute', () => {
  const cmds = E.parseSvgPath('m10 10l5 5c1 1 2 2 3 3');
  assert.deepEqual(cmds[0].args, [10, 10]);
  assert.deepEqual(cmds[1].args, [15, 15]);
  assert.deepEqual(cmds[2].args, [16, 16, 17, 17, 18, 18]);
});

test('parseSvgPath expands H and V into lines', () => {
  const cmds = E.parseSvgPath('M0 0H10V20h-5v-5');
  assert.deepEqual(cmds.slice(1).map((c) => c.args), [[10, 0], [10, 20], [5, 20], [5, 15]]);
});

test('parseSvgPath treats extra pairs after M as lines', () => {
  const cmds = E.parseSvgPath('M0 0 10 10 20 20');
  assert.deepEqual(cmds.map((c) => c.cmd), ['M', 'L', 'L']);
  const rel = E.parseSvgPath('m1 1 2 2');
  assert.deepEqual(rel[1].args, [3, 3]);
});

test('parseSvgPath reflects the previous control point for S', () => {
  const cmds = E.parseSvgPath('M0 0C0 10 10 10 10 0S20 -10 20 0');
  assert.deepEqual(cmds[2].args.slice(0, 2), [10, -10]);
  const lone = E.parseSvgPath('M5 5S6 6 7 7');
  assert.deepEqual(lone[1].args, [5, 5, 6, 6, 7, 7]);
});

test('parseSvgPath raises quadratic curves to cubics', () => {
  const cmds = E.parseSvgPath('M0 0Q30 60 60 0');
  assert.equal(cmds[1].cmd, 'C');
  assert.deepEqual(cmds[1].args, [20, 40, 40, 40, 60, 0]);
});

test('parseSvgPath handles tight number syntax and exponents', () => {
  const cmds = E.parseSvgPath('M0-5L-3.5.5l1e1-2E0');
  assert.deepEqual(cmds[0].args, [0, -5]);
  assert.deepEqual(cmds[1].args, [-3.5, 0.5]);
  assert.deepEqual(cmds[2].args, [6.5, -1.5]);
});

test('parseSvgPath rejects arcs, missing numbers and a missing start command', () => {
  assert.throws(() => E.parseSvgPath('M0 0A5 5 0 0 1 10 10'), /not supported/);
  assert.throws(() => E.parseSvgPath('M0 0L5'), /missing number/);
  assert.throws(() => E.parseSvgPath('10 10'), /start with a command/);
  assert.throws(() => E.parseSvgPath(42), TypeError);
});

test('computeSvgPathLength of a 3-4-5 line and closed square', () => {
  near(E.computeSvgPathLength('M0 0L3 4'), 5);
  near(E.computeSvgPathLength('M0 0L10 0L10 10L0 10Z'), 40);
  near(E.computeSvgPathLength('M0 0L10 0L10 10L0 10'), 30);
});

test('computeSvgPathLength of a four cubic circle is within 0.1% of the circumference', () => {
  const len = E.computeSvgPathLength(circlePath(50, 60, 60));
  assert.ok(Math.abs(len - Math.PI * 100) / (Math.PI * 100) < 0.001);
});

test('computeSvgPathLength measures several subpaths together', () => {
  near(E.computeSvgPathLength('M0 0L10 0M0 5L0 25'), 30);
});

test('formatNumber rounds, trims and drops leading zeros', () => {
  assert.equal(E.formatNumber(3.14159, 2), '3.14');
  assert.equal(E.formatNumber(2, 2), '2');
  assert.equal(E.formatNumber(0.5, 2), '.5');
  assert.equal(E.formatNumber(-0.5, 3), '-.5');
  assert.equal(E.formatNumber(-0.0001, 2), '0');
  assert.equal(E.formatNumber(1.5, 0), '2');
  assert.equal(E.formatNumber(1.5000, 4), '1.5');
  assert.equal(E.formatNumber(100, 3), '100');
  assert.equal(E.formatNumber(1.23456789012, 20), '1.23456789');
  assert.equal(E.formatNumber(10.5, -3), '11');
});

test('quantizeSvgCoordinates trims digits and shrinks the file', () => {
  const noisy = 'M10.123456 20.654321L30.111111 40.999999L50.5 60.25Z';
  const q = E.quantizeSvgCoordinates(noisy, 1);
  assert.equal(q, 'M10.1 20.7L30.1 41 50.5 60.3Z');
  assert.ok(E.utf8ByteLength(q) < E.utf8ByteLength(noisy));
});

test('quantizeSvgCoordinates is idempotent and keeps the shape', () => {
  const d = circlePath(37.3, 51.7, 48.1);
  const once = E.quantizeSvgCoordinates(d, 2);
  assert.equal(E.quantizeSvgCoordinates(once, 2), once);
  near(E.computeSvgPathLength(once), E.computeSvgPathLength(d), 0.5);
});

test('quantizeSvgCoordinates at precision 0 rounds to integers', () => {
  assert.equal(E.quantizeSvgCoordinates('M0.4 0.6L9.5 9.4', 0), 'M0 1L10 9');
});

test('serialised paths omit repeated command letters and avoid needless spaces', () => {
  assert.equal(E.quantizeSvgCoordinates('M0 0L1 1L2 2', 2), 'M0 0L1 1 2 2');
  assert.equal(E.quantizeSvgCoordinates('M1 -2L-3 -4', 2), 'M1-2L-3-4');
  assert.equal(E.quantizeSvgCoordinates('M0 0L1 1L-2 -2', 2), 'M0 0L1 1-2-2');
});

test('utf8ByteLength counts bytes, not characters', () => {
  assert.equal(E.utf8ByteLength('abc'), 3);
  assert.equal(E.utf8ByteLength('\u00e9'), 2);
  assert.equal(E.utf8ByteLength('\u20ac'), 3);
  assert.equal(E.utf8ByteLength('\ud83d\ude00'), 4);
  assert.equal(E.utf8ByteLength(''), 0);
});

test('countPathNodes ignores a duplicate closing point and sums subpaths', () => {
  assert.equal(E.countPathNodes('M0 0L10 0L10 10L0 0Z'), 3);
  assert.equal(E.countPathNodes('M0 0L10 0L10 10L0 5Z'), 4);
  assert.equal(E.countPathNodes('M0 0L10 0L10 10L0 0'), 4);
  assert.equal(E.countPathNodes('M0 0L1 1M5 5L6 6L7 7'), 5);
  assert.equal(E.countPathNodes('M0 0'), 1);
});

test('pathStats reports nodes, bytes, length and the exact bounding box', () => {
  const d = circlePath(50, 50, 50);
  const s = E.pathStats(d, 2);
  assert.equal(s.nodes, 4);
  assert.equal(s.bytes, E.utf8ByteLength(E.quantizeSvgCoordinates(d, 2)));
  near(s.bbox.minX, 0, 1e-6);
  near(s.bbox.maxX, 100, 1e-6);
  near(s.bbox.maxY, 100, 1e-6);
  assert.ok(Math.abs(s.length - Math.PI * 100) < 0.1);
  assert.equal(E.pathStats('M0 0L4 3').bbox.width, 4);
});

/* ---------------------------- node editing ------------------------------ */

test('pathDataToNodes turns the circle into four closed nodes with handles', () => {
  const { nodes, closed } = E.pathDataToNodes(circlePath(50, 50, 50));
  assert.equal(closed, true);
  assert.equal(nodes.length, 4);
  near(nodes[0].x, 100);
  near(nodes[0].outY, 50 + K * 50, 1e-6);
  near(nodes[0].inY, 50 - K * 50, 1e-6);
});

test('pathDataToNodes keeps an open path open and lines get zero length handles', () => {
  const r = E.pathDataToNodes('M0 0L10 0L10 10');
  assert.equal(r.closed, false);
  assert.equal(r.nodes.length, 3);
  assert.equal(r.nodes[1].inX, r.nodes[1].x);
  assert.equal(r.nodes[1].outY, r.nodes[1].y);
});

test('pathDataToNodes stops at the second subpath', () => {
  assert.equal(E.pathDataToNodes('M0 0L1 1L2 0ZM9 9L8 8').nodes.length, 3);
});

test('nodesToPathData round trips the circle and writes lines for bare segments', () => {
  const d = circlePath(50, 50, 50);
  const { nodes, closed } = E.pathDataToNodes(d);
  assert.equal(E.nodesToPathData(nodes, closed, 3), E.quantizeSvgCoordinates(d, 3));
  const tri = E.pathDataToNodes('M0 0L10 0L5 8Z');
  assert.equal(E.nodesToPathData(tri.nodes, true, 2), 'M0 0L10 0 5 8Z');
  const curvedWrap = E.pathDataToNodes('M0 0L10 0C10 5 5 8 0 8Z');
  assert.equal(E.nodesToPathData(curvedWrap.nodes, true, 2), 'M0 0L10 0C10 5 5 8 0 8Z');
  assert.equal(E.nodesToPathData([], true, 2), '');
});

test('nodesToSegments adds the wrap segment only for closed lists', () => {
  const { nodes } = E.pathDataToNodes(circlePath(10, 0, 0));
  assert.equal(E.nodesToSegments(nodes, true).length, 4);
  assert.equal(E.nodesToSegments(nodes, false).length, 3);
  assert.equal(E.nodesToSegments([nodes[0]], true).length, 0);
});

test('flattenNodes gives segments x steps points for a closed ring', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 50, 50));
  assert.equal(E.flattenNodes(nodes, true, 12).length, 48);
  assert.equal(E.flattenNodes(nodes, false, 12).length, 37);
  assert.equal(E.flattenNodes([nodes[0]], false, 4).length, 1);
});

test('nodesBoundingBox is exact for the circle', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 50, 50));
  const b = E.nodesBoundingBox(nodes, true);
  near(b.minX, 0, 1e-6);
  near(b.maxX, 100, 1e-6);
  near(b.minY, 0, 1e-6);
  near(b.maxY, 100, 1e-6);
});

test('moveNode carries both handles and leaves the input untouched', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 50, 50));
  const before = JSON.stringify(nodes);
  const moved = E.moveNode(nodes, 1, 60, 130);
  assert.equal(JSON.stringify(nodes), before);
  near(moved[1].x, 60);
  near(moved[1].y, 130);
  near(moved[1].outX - moved[1].x, nodes[1].outX - nodes[1].x, 1e-9);
  near(moved[1].inY - moved[1].y, nodes[1].inY - nodes[1].y, 1e-9);
  assert.deepEqual(moved[0], nodes[0]);
});

test('moveHandle in free mode only moves the dragged handle', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 50, 50));
  const out = E.moveHandle(nodes, 0, 'out', 130, 90, 'free');
  assert.equal(out[0].outX, 130);
  assert.equal(out[0].outY, 90);
  assert.equal(out[0].inX, nodes[0].inX);
  assert.equal(out[0].inY, nodes[0].inY);
});

test('moveHandle in smooth mode keeps the handles collinear and the other length', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 50, 50));
  const otherLen = Math.hypot(nodes[0].inX - nodes[0].x, nodes[0].inY - nodes[0].y);
  const out = E.moveHandle(nodes, 0, 'out', 130, 80, 'smooth');
  const vx = out[0].outX - out[0].x;
  const vy = out[0].outY - out[0].y;
  const wx = out[0].inX - out[0].x;
  const wy = out[0].inY - out[0].y;
  near(vx * wy - vy * wx, 0, 1e-6);
  assert.ok(vx * wx + vy * wy < 0);
  near(Math.hypot(wx, wy), otherLen, 1e-9);
});

test('moveHandle in mirrored mode copies the length to the other handle', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 50, 50));
  const out = E.moveHandle(nodes, 2, 'in', 40, 5, 'mirrored');
  const a = Math.hypot(out[2].inX - out[2].x, out[2].inY - out[2].y);
  const b = Math.hypot(out[2].outX - out[2].x, out[2].outY - out[2].y);
  near(a, b, 1e-9);
});

test('moveHandle revives a zero length opposite handle in smooth mode', () => {
  const r = E.pathDataToNodes('M0 0L10 0L10 10');
  const out = E.moveHandle(r.nodes, 1, 'out', 10, 15, 'smooth');
  near(out[1].inY, -15, 1e-9);
  near(out[1].inX, 10, 1e-9);
});

test('moveHandle dragged onto its anchor leaves the other handle alone', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 50, 50));
  const out = E.moveHandle(nodes, 0, 'out', nodes[0].x, nodes[0].y, 'smooth');
  assert.equal(out[0].inX, nodes[0].inX);
  assert.equal(out[0].inY, nodes[0].inY);
});

test('fitSmoothNodes returns bare nodes when there are fewer than three points', () => {
  const nodes = E.fitSmoothNodes([pt(0, 0), pt(10, 0)], {});
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].outX, 0);
});

test('fitSmoothNodes keeps square corners sharp and smooths a round ring', () => {
  const square = E.fitSmoothNodes([pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)], { closed: true, cornerAngle: 60 });
  square.forEach((n) => {
    assert.equal(n.outX, n.x);
    assert.equal(n.inY, n.y);
  });
  const ring = [];
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    ring.push(pt(50 + Math.cos(a) * 40, 50 + Math.sin(a) * 40));
  }
  const smooth = E.fitSmoothNodes(ring, { closed: true, cornerAngle: 60 });
  smooth.forEach((n) => assert.ok(Math.hypot(n.outX - n.x, n.outY - n.y) > 1));
});

test('fitSmoothNodes gives an open path end points with a single handle', () => {
  const nodes = E.fitSmoothNodes([pt(0, 0), pt(10, 5), pt(20, 0), pt(30, 5)], { closed: false });
  assert.equal(nodes[0].inX, 0);
  assert.equal(nodes[nodes.length - 1].outX, 30);
  assert.ok(nodes[1].outX > nodes[1].x);
  assert.ok(nodes[1].inX < nodes[1].x);
});

test('fitSmoothNodes handle length follows the chord and the smoothness option', () => {
  const pts = [pt(0, 0), pt(30, 0), pt(60, 0)];
  const a = E.fitSmoothNodes(pts, { closed: false, smoothness: 1 });
  const b = E.fitSmoothNodes(pts, { closed: false, smoothness: 0.5 });
  near(a[1].outX - a[1].x, 10, 1e-9);
  near(b[1].outX - b[1].x, 5, 1e-9);
});

test('optimizeContour shrinks a dense circle trace and respects epsilon', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 60, 60));
  const trace = E.flattenNodes(nodes, true, 48);
  assert.equal(trace.length, 192);
  const o = E.optimizeContour(trace, { closed: true, epsilon: 0.5, precision: 2 });
  assert.ok(o.nodeCountAfter < 40);
  assert.equal(o.nodeCountBefore, 192);
  assert.ok(o.bytesAfter < o.bytesBefore);
  assert.ok(o.deviation < 1);
  assert.equal(o.d, E.nodesToPathData(o.nodes, true, 2));
  assert.equal(o.bytesAfter, E.utf8ByteLength(o.d));
  assert.equal(o.bytesBefore, E.utf8ByteLength(o.beforeD));
});

test('optimizeContour keeps fewer nodes as epsilon grows', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 60, 60));
  const trace = E.flattenNodes(nodes, true, 48);
  let last = Infinity;
  [0.05, 0.3, 1, 3, 8].forEach((eps) => {
    const o = E.optimizeContour(trace, { closed: true, epsilon: eps });
    assert.ok(o.nodeCountAfter <= last);
    last = o.nodeCountAfter;
  });
  assert.ok(last < 12);
});

test('optimizeContour in lines mode writes only straight segments', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 60, 60));
  const trace = E.flattenNodes(nodes, true, 24);
  const o = E.optimizeContour(trace, { closed: true, epsilon: 1, fit: 'lines' });
  assert.ok(o.d.indexOf('C') < 0);
  assert.ok(o.d.endsWith('Z'));
});

test('optimizeContour works on an open trace', () => {
  const trace = [];
  for (let i = 0; i <= 60; i += 1) { trace.push(pt(i * 2, Math.sin(i / 10) * 20)); }
  const o = E.optimizeContour(trace, { closed: false, epsilon: 0.7 });
  assert.ok(o.d.indexOf('Z') < 0);
  assert.ok(o.nodeCountAfter < trace.length);
  assert.deepEqual(o.kept[0], trace[0]);
});

test('polylineToPathData writes M and L and closes on request', () => {
  assert.equal(E.polylineToPathData([pt(0, 0), pt(5, 5), pt(9, 1)], false, 2), 'M0 0L5 5 9 1');
  assert.equal(E.polylineToPathData([pt(0, 0), pt(5, 5)], true, 2), 'M0 0L5 5Z');
  assert.equal(E.polylineToPathData([], true, 2), '');
});

test('curvatureComb samples every segment and scales the spikes by curvature', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 50, 50));
  const comb = E.curvatureComb(nodes, true, 8, 1000);
  assert.equal(comb.length, 4 * 9);
  comb.forEach((c) => {
    const spike = Math.hypot(c.tipX - c.x, c.tipY - c.y);
    near(spike, Math.abs(c.k) * 1000, 1e-6);
    assert.ok(Math.abs(Math.abs(c.k) - 0.02) < 0.0005);
  });
  assert.equal(E.curvatureComb(nodes, false, 4, 1).length, 3 * 5);
});

test('curvatureComb has no spike on a straight run', () => {
  const r = E.pathDataToNodes('M0 0L40 0');
  const comb = E.curvatureComb(r.nodes, false, 4, 100);
  comb.forEach((c) => {
    assert.equal(c.k, 0);
    assert.equal(c.tipX, c.x);
  });
});

/* ------------------------------ MaxRects -------------------------------- */

const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

test('nextPowerOfTwo', () => {
  assert.deepEqual([1, 2, 3, 5, 64, 65, 1000].map(E.nextPowerOfTwo), [1, 2, 4, 8, 64, 128, 1024]);
});

test('packSpriteAtlasMaxRects fits one 16x16 frame with padding into a 32x32 atlas', () => {
  const a = E.packSpriteAtlasMaxRects([{ name: 'a', w: 16, h: 16 }], { padding: 2, extrude: 1 });
  assert.equal(a.ok, true);
  assert.equal(a.width, 32);
  assert.equal(a.height, 32);
  assert.equal(a.placements[0].x, 1);
  assert.equal(a.placements[0].y, 1);
  assert.deepEqual(a.placements[0].cell, { x: 0, y: 0, w: 20, h: 20 });
});

test('four 16x16 frames with no padding fill a 32x32 atlas completely', () => {
  const frames = [0, 1, 2, 3].map((i) => ({ name: 'f' + i, w: 16, h: 16 }));
  const a = E.packSpriteAtlasMaxRects(frames, { padding: 0, extrude: 0 });
  assert.equal(a.width, 32);
  assert.equal(a.height, 32);
  assert.equal(a.efficiency, 1);
  assert.equal(E.validateAtlas(a).ok, true);
});

test('packing is valid for many seeded frame sets', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const frames = E.generateSampleFrames(10 + seed, seed, 6, 48);
    const a = E.packSpriteAtlasMaxRects(frames, { padding: 2, extrude: 1 });
    assert.equal(a.ok, true, 'seed ' + seed);
    assert.equal(a.placements.length, frames.length);
    const v = E.validateAtlas(a);
    assert.equal(v.ok, true, 'seed ' + seed + ': ' + v.problems.join('; '));
    assert.ok(isPow2(a.width) && isPow2(a.height));
  }
});

test('efficiency equals frame area over atlas area', () => {
  const frames = E.generateSampleFrames(20, 5, 8, 40);
  const a = E.packSpriteAtlasMaxRects(frames, {});
  const area = frames.reduce((s, f) => s + f.w * f.h, 0);
  assert.equal(a.frameArea, area);
  near(a.efficiency, area / (a.width * a.height), 1e-12);
  assert.ok(a.efficiency > 0.3 && a.efficiency <= 1);
});

test('the largest frame is placed first by the default sort', () => {
  const a = E.packSpriteAtlasMaxRects([
    { name: 'small', w: 8, h: 8 }, { name: 'big', w: 40, h: 24 }, { name: 'mid', w: 20, h: 20 }
  ], { padding: 0, extrude: 0 });
  assert.equal(a.placements[0].name, 'big');
  assert.equal(a.placements[0].x, 0);
  assert.equal(a.placements[0].y, 0);
});

test('sort none keeps the input order and area sort orders by area', () => {
  const frames = [{ name: 'tall', w: 4, h: 30 }, { name: 'wide', w: 20, h: 10 }];
  const none = E.packSpriteAtlasMaxRects(frames, { sort: 'none', padding: 0, extrude: 0 });
  assert.equal(none.placements[0].name, 'tall');
  const area = E.packSpriteAtlasMaxRects(frames, { sort: 'area', padding: 0, extrude: 0 });
  assert.equal(area.placements[0].name, 'wide');
  const side = E.packSpriteAtlasMaxRects(frames, { sort: 'maxside', padding: 0, extrude: 0 });
  assert.equal(side.placements[0].name, 'tall');
});

test('equal frames sort by name so the result is deterministic', () => {
  const frames = [{ name: 'b', w: 10, h: 10 }, { name: 'a', w: 10, h: 10 }];
  const a = E.packSpriteAtlasMaxRects(frames, { padding: 0, extrude: 0 });
  assert.deepEqual(a.placements.map((p) => p.name), ['a', 'b']);
});

test('extrude and padding grow every cell', () => {
  const frames = [{ name: 'a', w: 10, h: 12 }];
  const a = E.packSpriteAtlasMaxRects(frames, { padding: 3, extrude: 2 });
  assert.deepEqual([a.placements[0].cell.w, a.placements[0].cell.h], [17, 19]);
  assert.equal(a.placements[0].x, 2);
});

test('a non power of two atlas is trimmed to the used bounds', () => {
  const frames = [{ name: 'a', w: 30, h: 10 }, { name: 'b', w: 30, h: 10 }];
  const a = E.packSpriteAtlasMaxRects(frames, { padding: 0, extrude: 0, powerOfTwo: false, maxSize: 256 });
  assert.equal(a.ok, true);
  assert.equal(a.width, 30);
  assert.equal(a.height, 20);
  assert.equal(a.powerOfTwo, false);
  assert.equal(a.efficiency, 1);
});

test('the smallest area power of two atlas wins, preferring a squarer shape', () => {
  const frames = [0, 1, 2].map((i) => ({ name: 'r' + i, w: 32, h: 8 }));
  const a = E.packSpriteAtlasMaxRects(frames, { padding: 0, extrude: 0 });
  assert.deepEqual([a.width, a.height], [32, 32]);
});

test('frames that cannot fit are reported instead of dropped silently', () => {
  const a = E.packSpriteAtlasMaxRects([{ name: 'huge', w: 500, h: 500 }, { name: 'ok', w: 4, h: 4 }], { maxSize: 64 });
  assert.equal(a.ok, false);
  assert.deepEqual(a.failed.sort(), ['huge', 'ok']);
  assert.equal(a.placements.length, 0);
});

test('an empty list and zero sized frames pack to an empty atlas', () => {
  const empty = E.packSpriteAtlasMaxRects([], {});
  assert.equal(empty.ok, true);
  assert.equal(empty.width, 0);
  const zero = E.packSpriteAtlasMaxRects([{ name: 'z', w: 0, h: 10 }], {});
  assert.equal(zero.placements.length, 0);
  assert.equal(zero.ok, true);
});

test('packing is deterministic', () => {
  const frames = E.generateSampleFrames(30, 99, 5, 50);
  const a = E.packSpriteAtlasMaxRects(frames, {});
  const b = E.packSpriteAtlasMaxRects(frames, {});
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('validateAtlas flags overlaps and out of bounds cells', () => {
  const bad = {
    width: 32, height: 32, extrude: 0,
    placements: [
      { name: 'a', x: 0, y: 0, w: 20, h: 20, cell: { x: 0, y: 0, w: 20, h: 20 } },
      { name: 'b', x: 10, y: 10, w: 20, h: 20, cell: { x: 10, y: 10, w: 20, h: 20 } },
      { name: 'c', x: 30, y: 30, w: 10, h: 10, cell: { x: 30, y: 30, w: 10, h: 10 } }
    ]
  };
  const v = E.validateAtlas(bad);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => p.startsWith('overlap: a and b')));
  assert.ok(v.problems.some((p) => p === 'out of bounds: c'));
});

test('validateAtlas allows cells that only touch edges', () => {
  const touching = {
    width: 20, height: 10, extrude: 0,
    placements: [
      { name: 'a', x: 0, y: 0, w: 10, h: 10, cell: { x: 0, y: 0, w: 10, h: 10 } },
      { name: 'b', x: 10, y: 0, w: 10, h: 10, cell: { x: 10, y: 0, w: 10, h: 10 } }
    ]
  };
  assert.equal(E.validateAtlas(touching).ok, true);
});

function sampleAtlas() {
  return E.packSpriteAtlasMaxRects([
    { name: 'idle 01', w: 16, h: 16 }, { name: 'idle 02', w: 16, h: 16 }, { name: '3d-gem', w: 12, h: 20 }
  ], { padding: 1, extrude: 1 });
}

test('TexturePacker hash export lists every frame with matching rectangles', () => {
  const atlas = sampleAtlas();
  const json = JSON.parse(E.exportTexturePackerHash(atlas, 'sheet.png'));
  assert.equal(Object.keys(json.frames).length, 3);
  atlas.placements.forEach((p) => {
    assert.deepEqual(json.frames[p.name].frame, { x: p.x, y: p.y, w: p.w, h: p.h });
    assert.equal(json.frames[p.name].rotated, false);
    assert.deepEqual(json.frames[p.name].sourceSize, { w: p.w, h: p.h });
  });
  assert.equal(json.meta.image, 'sheet.png');
  assert.deepEqual(json.meta.size, { w: atlas.width, h: atlas.height });
  assert.equal(json.meta.app, 'paperclip-rig');
});

test('TexturePacker array export carries filenames in packing order', () => {
  const atlas = sampleAtlas();
  const json = JSON.parse(E.exportTexturePackerArray(atlas, 'sheet.png'));
  assert.deepEqual(json.frames.map((f) => f.filename), atlas.placements.map((p) => p.name));
});

test('Phaser export uses the multiatlas textures layout', () => {
  const atlas = sampleAtlas();
  const json = JSON.parse(E.exportPhaserJson(atlas, 'sheet.png'));
  assert.equal(json.textures.length, 1);
  assert.equal(json.textures[0].image, 'sheet.png');
  assert.equal(json.textures[0].frames.length, 3);
  assert.deepEqual(json.textures[0].size, { w: atlas.width, h: atlas.height });
  assert.equal(json.textures[0].scale, 1);
});

test('Godot region export lists name and region per frame', () => {
  const atlas = sampleAtlas();
  const json = JSON.parse(E.exportGodotRegions(atlas, 'sheet.png'));
  assert.equal(json.texture, 'sheet.png');
  assert.equal(json.regions.length, 3);
  assert.deepEqual(json.regions[0].region, {
    x: atlas.placements[0].x, y: atlas.placements[0].y, w: atlas.placements[0].w, h: atlas.placements[0].h
  });
});

test('CSS sprite export writes one rule per frame with negative offsets', () => {
  const atlas = sampleAtlas();
  const css = E.exportCssSprites(atlas, 'sheet.png', 'gem');
  assert.ok(css.includes('.gem { background-image: url("sheet.png")'));
  assert.ok(css.includes('image-rendering: pixelated'));
  atlas.placements.forEach((p) => {
    assert.ok(css.includes('background-position: -' + p.x + 'px -' + p.y + 'px'));
    assert.ok(css.includes('width: ' + p.w + 'px; height: ' + p.h + 'px'));
  });
  assert.ok(css.includes('.gem-idle-01 '));
  assert.ok(css.includes('.gem-s-3d-gem '));
  assert.ok(E.exportCssSprites(atlas, 'x.png').includes('.sprite {'));
});

test('seededRandom is reproducible, bounded and seed sensitive', () => {
  const a = E.seededRandom(7);
  const b = E.seededRandom(7);
  const c = E.seededRandom(8);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, [c(), c(), c(), c()]);
  seqA.forEach((v) => assert.ok(v >= 0 && v < 1));
  const spread = E.seededRandom(1);
  let sum = 0;
  for (let i = 0; i < 2000; i += 1) { sum += spread(); }
  assert.ok(Math.abs(sum / 2000 - 0.5) < 0.03);
});

test('generateSampleFrames honours count, size range and zero padded names', () => {
  const frames = E.generateSampleFrames(12, 3, 10, 20);
  assert.equal(frames.length, 12);
  frames.forEach((f) => {
    assert.ok(f.w >= 10 && f.w <= 20 && f.h >= 10 && f.h <= 20);
  });
  assert.equal(frames[0].name, 'frame_00');
  assert.equal(frames[9].name, 'frame_09');
  assert.equal(frames[10].name, 'frame_10');
  assert.deepEqual(frames, E.generateSampleFrames(12, 3, 10, 20));
});

/* ------------------------------ pixel grids ----------------------------- */

test('createGrid fills with transparent by default and cloneGrid is independent', () => {
  const g = E.createGrid(3, 2);
  assert.equal(g.data.length, 6);
  assert.ok(Array.from(g.data).every((v) => v === E.TRANSPARENT));
  const c = E.cloneGrid(g);
  E.setPixel(c, 1, 1, 3);
  assert.equal(E.getPixel(g, 1, 1), E.TRANSPARENT);
  assert.equal(E.getPixel(c, 1, 1), 3);
  assert.equal(E.createGrid(2, 2, 0).data[3], 0);
});

test('getPixel and setPixel are safe out of bounds', () => {
  const g = E.createGrid(4, 4, 1);
  E.setPixel(g, -1, 0, 9);
  E.setPixel(g, 4, 0, 9);
  E.setPixel(g, 0, 4, 9);
  assert.ok(Array.from(g.data).every((v) => v === 1));
  assert.equal(E.getPixel(g, -1, 0), E.TRANSPARENT);
  assert.equal(E.getPixel(g, 3, 3), 1);
  E.setPixel(g, 3, 3, 2);
  assert.equal(E.getPixel(g, 3, 3), 2);
});

test('bresenhamLine covers horizontal, vertical and diagonal runs', () => {
  assert.deepEqual(E.bresenhamLine(0, 0, 4, 0).map((p) => p.x), [0, 1, 2, 3, 4]);
  assert.deepEqual(E.bresenhamLine(2, 5, 2, 1).map((p) => p.y), [5, 4, 3, 2, 1]);
  assert.deepEqual(E.bresenhamLine(0, 0, 3, 3), [pt(0, 0), pt(1, 1), pt(2, 2), pt(3, 3)]);
  assert.deepEqual(E.bresenhamLine(0, 3, 3, 0), [pt(0, 3), pt(1, 2), pt(2, 1), pt(3, 0)]);
});

test('bresenhamLine of a single point and a shallow slope', () => {
  assert.deepEqual(E.bresenhamLine(5, 5, 5, 5), [pt(5, 5)]);
  assert.deepEqual(E.bresenhamLine(0, 0, 5, 2), [pt(0, 0), pt(1, 0), pt(2, 1), pt(3, 1), pt(4, 2), pt(5, 2)]);
});

test('bresenhamLine includes both ends and has max(dx, dy) + 1 points', () => {
  const cases = [[0, 0, 7, 3], [9, 2, 1, 8], [-4, -4, 4, 2], [3, 9, 3, 0], [0, 0, 1, 10]];
  cases.forEach(([x0, y0, x1, y1]) => {
    const line = E.bresenhamLine(x0, y0, x1, y1);
    assert.deepEqual(line[0], pt(x0, y0));
    assert.deepEqual(line[line.length - 1], pt(x1, y1));
    assert.equal(line.length, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
    for (let i = 1; i < line.length; i += 1) {
      assert.ok(Math.abs(line[i].x - line[i - 1].x) <= 1 && Math.abs(line[i].y - line[i - 1].y) <= 1);
    }
  });
});

test('drawLine, drawRect and drawDisc write the expected cells', () => {
  const g = E.createGrid(10, 10);
  E.drawLine(g, 0, 0, 9, 0, 1);
  assert.equal(E.countFilled(g), 10);
  const r = E.createGrid(10, 10);
  E.drawRect(r, 1, 1, 5, 4, 2, true);
  assert.equal(E.countFilled(r), 20);
  const o = E.createGrid(10, 10);
  E.drawRect(o, 1, 1, 5, 4, 2, false);
  assert.equal(E.countFilled(o), 5 * 4 - 3 * 2);
  assert.equal(E.getPixel(o, 3, 2), E.TRANSPARENT);
  const d = E.createGrid(11, 11);
  E.drawDisc(d, 5, 5, 3, 1);
  assert.equal(E.getPixel(d, 5, 5), 1);
  assert.equal(E.getPixel(d, 8, 5), 1);
  assert.equal(E.getPixel(d, 9, 5), E.TRANSPARENT);
  assert.equal(E.getPixel(d, 8, 8), E.TRANSPARENT);
  assert.equal(E.countFilled(d), 29);
});

test('drawDisc is left right and top bottom symmetric', () => {
  const d = E.createGrid(15, 15);
  E.drawDisc(d, 7, 7, 5.5, 3);
  for (let y = 0; y < 15; y += 1) {
    for (let x = 0; x < 15; x += 1) {
      assert.equal(E.getPixel(d, x, y), E.getPixel(d, 14 - x, y));
      assert.equal(E.getPixel(d, x, y), E.getPixel(d, x, 14 - y));
    }
  }
});

test('floodFillGrid fills an enclosed room and stops at the wall', () => {
  const g = E.createGrid(8, 8);
  E.drawRect(g, 1, 1, 6, 6, 1, false);
  const n = E.floodFillGrid(g, 3, 3, 2);
  assert.equal(n, 16);
  assert.equal(E.getPixel(g, 3, 3), 2);
  assert.equal(E.getPixel(g, 0, 0), E.TRANSPARENT);
  assert.equal(E.getPixel(g, 1, 1), 1);
});

test('floodFillGrid is 4-connected and does not leak through diagonal gaps', () => {
  const g = E.createGrid(5, 5);
  [[2, 0], [1, 1], [0, 2]].forEach(([x, y]) => E.setPixel(g, x, y, 1));
  const n = E.floodFillGrid(g, 0, 0, 3);
  assert.equal(n, 3);
  assert.equal(E.getPixel(g, 2, 1), E.TRANSPARENT);
  assert.equal(E.getPixel(g, 1, 0), 3);
});

test('floodFillGrid ignores a same colour fill and out of range starts', () => {
  const g = E.createGrid(4, 4, 2);
  assert.equal(E.floodFillGrid(g, 1, 1, 2), 0);
  assert.equal(E.floodFillGrid(g, -1, 0, 5), 0);
  assert.equal(E.floodFillGrid(g, 4, 4, 5), 0);
  assert.equal(E.floodFillGrid(g, 0, 0, 5), 16);
  assert.ok(Array.from(g.data).every((v) => v === 5));
});

test('floodFillGrid fills a long snake corridor without recursion limits', () => {
  const w = 300;
  const g = E.createGrid(w, 3);
  assert.equal(E.floodFillGrid(g, 0, 1, 1), w * 3);
});

test('gridFromRows maps characters and leaves unknown ones transparent', () => {
  const g = E.gridFromRows(['0.1', '2x0'], { 0: 0, 1: 1, 2: 2 });
  assert.deepEqual(Array.from(g.data), [0, -1, 1, 2, -1, 0]);
  assert.equal(g.width, 3);
  assert.equal(g.height, 2);
  assert.throws(() => E.gridFromRows(['00', '0'], { 0: 0 }), /row 1/);
});

test('mirrorGridX flips left and right and countFilled counts opaque cells', () => {
  const g = E.gridFromRows(['01.', '..2'], { 0: 0, 1: 1, 2: 2 });
  const m = E.mirrorGridX(g);
  assert.deepEqual(Array.from(m.data), [-1, 1, 0, 2, -1, -1]);
  assert.equal(E.countFilled(g), 3);
  assert.equal(E.countFilled(E.createGrid(3, 3)), 0);
});

/* -------------------------------- colour -------------------------------- */

test('hexToRgb and rgbToHex round trip, including short hex', () => {
  assert.deepEqual(E.hexToRgb('#C84B31'), { r: 200, g: 75, b: 49 });
  assert.deepEqual(E.hexToRgb('fff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(E.hexToRgb('#0a0b0c'), { r: 10, g: 11, b: 12 });
  assert.equal(E.rgbToHex({ r: 200, g: 75, b: 49 }), '#c84b31');
  assert.equal(E.rgbToHex({ r: -5, g: 300, b: 0.4 }), '#00ff00');
  assert.equal(E.rgbToHex({ r: 1, g: 2, b: 3 }), '#010203');
});

test('OKLab matches reference values for black, white and red', () => {
  const black = E.rgbToOklab({ r: 0, g: 0, b: 0 });
  const white = E.rgbToOklab({ r: 255, g: 255, b: 255 });
  const red = E.rgbToOklab({ r: 255, g: 0, b: 0 });
  near(black.L, 0, 1e-9);
  near(white.L, 1, 1e-3);
  near(white.a, 0, 2e-3);
  near(white.b, 0, 2e-3);
  near(red.L, 0.62796, 1e-3);
  near(red.a, 0.22486, 1e-3);
  near(red.b, 0.12585, 1e-3);
});

test('CIE Lab matches reference values for black, white and red', () => {
  const black = E.rgbToCieLab({ r: 0, g: 0, b: 0 });
  const white = E.rgbToCieLab({ r: 255, g: 255, b: 255 });
  const red = E.rgbToCieLab({ r: 255, g: 0, b: 0 });
  near(black.L, 0, 1e-6);
  near(white.L, 100, 0.01);
  near(white.a, 0, 0.05);
  near(red.L, 53.24, 0.1);
  near(red.a, 80.09, 0.2);
  near(red.b, 67.2, 0.2);
});

test('OKLab lightness grows with a grey ramp', () => {
  let last = -1;
  [0, 40, 90, 150, 220, 255].forEach((v) => {
    const L = E.rgbToOklab({ r: v, g: v, b: v }).L;
    assert.ok(L > last);
    last = L;
  });
});

test('nearestPaletteIndex returns exact colours and nearby ones', () => {
  const pal = ['#000000', '#ff0000', '#00ff00', '#0000ff'];
  assert.equal(E.nearestPaletteIndex({ r: 0, g: 0, b: 255 }, pal), 3);
  assert.equal(E.nearestPaletteIndex({ r: 230, g: 30, b: 20 }, pal), 1);
  assert.equal(E.nearestPaletteIndex({ r: 10, g: 5, b: 8 }, pal), 0);
  assert.equal(E.nearestPaletteIndex({ r: 30, g: 200, b: 40 }, pal, 'cielab'), 2);
  assert.equal(E.nearestPaletteIndex({ r: 9, g: 9, b: 9 }, ['#090909', '#090909']), 0);
});

test('quantizeRgbaToPalette maps colours and drops low alpha pixels', () => {
  const rgba = new Uint8ClampedArray([
    250, 10, 10, 255, 10, 10, 240, 255,
    10, 240, 10, 127, 12, 12, 238, 128
  ]);
  const g = E.quantizeRgbaToPalette(rgba, 2, 2, ['#ff0000', '#00ff00', '#0000ff']);
  assert.deepEqual(Array.from(g.data), [0, 2, -1, 2]);
});

test('there are six curated palettes with the expected well known colours', () => {
  assert.equal(E.PALETTES.length, 6);
  assert.deepEqual(E.PALETTES.map((p) => p.id), ['archival', 'botanical', 'riso', 'dmg', 'pico8', 'blueprint']);
  assert.deepEqual(E.getPalette('dmg').colors, ['#0f380f', '#306230', '#8bac0f', '#9bbc0f']);
  assert.equal(E.getPalette('pico8').colors.length, 16);
  assert.equal(E.getPalette('pico8').colors[8], '#ff004d');
  E.PALETTES.forEach((p) => {
    p.colors.forEach((c) => assert.match(c, /^#[0-9a-f]{6}$/));
    assert.ok(p.name.length > 3);
    assert.equal(new Set(p.colors).size, p.colors.length);
  });
  assert.equal(E.getPalette('nope'), null);
});

test('lightnessOrder sorts dark to light and is stable for ties', () => {
  assert.deepEqual(E.lightnessOrder(['#ffffff', '#000000', '#808080']), [1, 2, 0]);
  assert.deepEqual(E.lightnessOrder(['#303030', '#303030', '#101010']), [2, 0, 1]);
});

test('remapIndexedPalette maps by lightness rank and keeps transparency', () => {
  const src = E.getPalette('archival').colors;
  const dst = E.getPalette('dmg').colors;
  const g = E.gridFromRows(['0123', '4..0'], { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 });
  const before = Array.from(g.data);
  const r = E.remapIndexedPalette(g, src, dst);
  assert.deepEqual(r.mapping, [0, 1, 2, 2, 3]);
  assert.deepEqual(Array.from(r.grid.data), [0, 1, 2, 2, 3, -1, -1, 0]);
  assert.deepEqual(Array.from(g.data), before);
});

test('remapIndexedPalette to the same palette is the identity', () => {
  const pal = E.getPalette('blueprint').colors;
  const r = E.remapIndexedPalette(E.createGrid(2, 2, 3), pal, pal);
  assert.deepEqual(r.mapping, [0, 1, 2, 3, 4]);
  assert.ok(Array.from(r.grid.data).every((v) => v === 3));
});

test('remapIndexedPalette spreads a few tones across a sixteen colour palette', () => {
  const r = E.remapIndexedPalette(E.createGrid(1, 1, 0), E.getPalette('botanical').colors, E.getPalette('pico8').colors);
  const order = E.lightnessOrder(E.getPalette('pico8').colors);
  assert.deepEqual(r.mapping, [0, 4, 8, 11, 15].map((rank) => order[rank]));
  const single = E.remapIndexedPalette(E.createGrid(1, 1, 0), ['#777777'], E.getPalette('dmg').colors);
  assert.deepEqual(single.mapping, [E.lightnessOrder(E.getPalette('dmg').colors)[0]]);
});

test('toneColors takes colours from the target palette by rank', () => {
  const dmg = E.getPalette('dmg').colors;
  assert.deepEqual(E.toneColors(5, dmg), [dmg[0], dmg[1], dmg[2], dmg[2], dmg[3]]);
  assert.deepEqual(E.toneColors(1, dmg), [dmg[0]]);
  assert.equal(E.toneColors(5, E.getPalette('pico8').colors).length, 5);
});

/* ----------------------------- frames and export ------------------------ */

test('onionLayers lists neighbours with wrap around and fading alpha', () => {
  const l = E.onionLayers(4, 0, { before: 1, after: 1 });
  assert.deepEqual(l.map((x) => x.index), [3, 1]);
  assert.deepEqual(l.map((x) => x.side), ['before', 'after']);
  near(l[0].alpha, 0.38);
  const wide = E.onionLayers(6, 1, { before: 2, after: 2 });
  assert.deepEqual(wide.map((x) => x.index), [5, 0, 2, 3]);
  near(wide[0].alpha, 0.19);
  near(wide[1].alpha, 0.38);
  near(wide[3].alpha, 0.19);
});

test('onionLayers default window, single frame and zero ranges', () => {
  assert.equal(E.onionLayers(4, 2).length, 2);
  assert.deepEqual(E.onionLayers(1, 0, { before: 1, after: 1 }), []);
  assert.deepEqual(E.onionLayers(4, 0, { before: 0, after: 0 }), []);
  assert.deepEqual(E.onionLayers(2, 0, { before: 1, after: 1 }).map((x) => x.index), [1, 1]);
});

test('animationFrameIndex steps at the frame rate and wraps', () => {
  assert.equal(E.animationFrameIndex(0, 6, 4), 0);
  assert.equal(E.animationFrameIndex(170, 6, 4), 1);
  assert.equal(E.animationFrameIndex(1000, 6, 4), 2);
  assert.equal(E.animationFrameIndex(5000, 4, 4), 0);
  assert.equal(E.animationFrameIndex(500, 6, 0), 0);
});

test('gridToRgba scales pixels and skips transparent or unknown tones', () => {
  const g = E.gridFromRows(['0.', '5x'], { 0: 0, 5: 5 });
  const img = E.gridToRgba(g, ['#ff8000'], 2);
  assert.equal(img.width, 4);
  assert.equal(img.height, 4);
  assert.deepEqual(Array.from(img.data.slice(0, 4)), [255, 128, 0, 255]);
  assert.deepEqual(Array.from(img.data.slice(4 * 2, 4 * 2 + 4)), [0, 0, 0, 0]);
  assert.equal(img.data[(2 * 4 + 0) * 4 + 3], 0);
  assert.equal(img.data[(1 * 4 + 1) * 4 + 3], 255);
  assert.equal(E.gridToRgba(g, ['#ff8000']).width, 2);
});

test('buildSpriteSheetGrid lays frames out left to right then down', () => {
  const a = E.createGrid(2, 2, 1);
  const b = E.createGrid(2, 2, 2);
  const c = E.createGrid(2, 2, 3);
  const sheet = E.buildSpriteSheetGrid([a, b, c], 2);
  assert.equal(sheet.width, 4);
  assert.equal(sheet.height, 4);
  assert.equal(E.getPixel(sheet, 0, 0), 1);
  assert.equal(E.getPixel(sheet, 2, 1), 2);
  assert.equal(E.getPixel(sheet, 1, 3), 3);
  assert.equal(E.getPixel(sheet, 3, 3), E.TRANSPARENT);
  assert.equal(E.buildSpriteSheetGrid([a, b], 9).width, 4);
  assert.equal(E.buildSpriteSheetGrid([a, b], 0).height, 4);
});

test('crc32 and adler32 match published check values', () => {
  const enc = (s) => Uint8Array.from(Buffer.from(s));
  assert.equal(E.crc32(enc('123456789')), 0xcbf43926);
  assert.equal(E.crc32(new Uint8Array(0)), 0);
  assert.equal(E.adler32(enc('Wikipedia')), 0x11e60398);
  assert.equal(E.adler32(new Uint8Array(0)), 1);
});

function readChunks(png) {
  const chunks = [];
  let at = 8;
  while (at < png.length) {
    const len = Buffer.from(png).readUInt32BE(at);
    const type = Buffer.from(png.subarray(at + 4, at + 8)).toString('latin1');
    const data = png.subarray(at + 8, at + 8 + len);
    const crc = Buffer.from(png).readUInt32BE(at + 8 + len);
    chunks.push({ type, data, crc, covered: png.subarray(at + 4, at + 8 + len) });
    at += 12 + len;
  }
  return chunks;
}

function decodePng(png) {
  const chunks = readChunks(png);
  const ihdr = Buffer.from(chunks[0].data);
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => Buffer.from(c.data)));
  const raw = zlib.inflateSync(idat);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    assert.equal(raw[y * (w * 4 + 1)], 0, 'filter byte');
    for (let x = 0; x < w * 4; x += 1) { out[y * w * 4 + x] = raw[y * (w * 4 + 1) + 1 + x]; }
  }
  return { w, h, out, chunks, ihdr };
}

test('encodePngRgba writes a valid signature, header and checksummed chunks', () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]);
  const png = E.encodePngRgba(2, 1, rgba);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const d = decodePng(png);
  assert.deepEqual(d.chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  assert.equal(d.w, 2);
  assert.equal(d.h, 1);
  assert.equal(d.ihdr[8], 8);
  assert.equal(d.ihdr[9], 6);
  d.chunks.forEach((c) => assert.equal(E.crc32(c.covered), c.crc));
  assert.deepEqual(Array.from(d.out), Array.from(rgba));
});

test('encodePngRgba splits a large image across several stored blocks and still inflates', () => {
  const w = 200;
  const h = 120;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < rgba.length; i += 1) { rgba[i] = (i * 7 + (i >> 8)) & 255; }
  const png = E.encodePngRgba(w, h, rgba);
  assert.ok(w * h * 4 > 65535 * 1);
  const d = decodePng(png);
  assert.deepEqual(Array.from(d.out), Array.from(rgba));
});

test('encodePngRgba is reproducible byte for byte', () => {
  const rgba = new Uint8ClampedArray(16 * 16 * 4).fill(77);
  assert.deepEqual(Array.from(E.encodePngRgba(16, 16, rgba)), Array.from(E.encodePngRgba(16, 16, rgba)));
});

test('gridToPng decodes to the palette colours at the requested scale', () => {
  const g = E.gridFromRows(['01', '.0'], { 0: 0, 1: 1 });
  const png = E.gridToPng(g, ['#102030', '#aabbcc'], 3);
  const d = decodePng(png);
  assert.equal(d.w, 6);
  assert.equal(d.h, 6);
  assert.deepEqual(Array.from(d.out.slice(0, 4)), [0x10, 0x20, 0x30, 255]);
  assert.deepEqual(Array.from(d.out.slice((0 * 6 + 3) * 4, (0 * 6 + 3) * 4 + 4)), [0xaa, 0xbb, 0xcc, 255]);
  assert.equal(d.out[(3 * 6 + 0) * 4 + 3], 0);
});

test('exportSpriteSheetSvg merges runs, sets the viewBox and scales the size', () => {
  const g = E.gridFromRows(['00.1', '....'], { 0: 0, 1: 1 });
  const svg = E.exportSpriteSheetSvg([g, g], ['#111111', '#222222'], { scale: 4, columns: 2 });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 2"'));
  assert.ok(svg.includes('width="32" height="8"'));
  assert.ok(svg.includes('shape-rendering="crispEdges"'));
  assert.equal((svg.match(/<rect /g) || []).length, 4);
  assert.ok(svg.includes('<rect x="0" y="0" width="2" height="1" fill="#111111"/>'));
  assert.ok(svg.includes('<rect x="7" y="0" width="1" height="1" fill="#222222"/>'));
});

test('exportSpriteSheetSvg stacks rows when there are more frames than columns', () => {
  const g = E.createGrid(2, 2, 0);
  const svg = E.exportSpriteSheetSvg([g, g, g], ['#000000'], { scale: 1, columns: 2 });
  assert.ok(svg.includes('viewBox="0 0 4 4"'));
  assert.ok(svg.includes('<rect x="0" y="2" width="2" height="1"'));
  const defaults = E.exportSpriteSheetSvg([g], ['#000000']);
  assert.ok(defaults.includes('width="16" height="16"'));
});

test('the engine reports its version', () => {
  assert.equal(E.version, '1.0.0');
  assert.equal(E.clamp(5, 0, 3), 3);
  assert.equal(E.clamp(-5, 0, 3), 0);
  assert.equal(E.clamp(2, 0, 3), 2);
  assert.equal(E.lerp(10, 20, 0.25), 12.5);
});

/* ------------------- defaults, edge cases and internals ------------------ */

test('flattenSvgPath defaults to 32 steps per curve and honours an explicit count', () => {
  const d = 'M0 0C0 10 10 10 10 0';
  assert.equal(E.flattenSvgPath(d)[0].points.length, 33);
  assert.equal(E.flattenSvgPath(d, 4)[0].points.length, 5);
  assert.equal(E.flattenSvgPath(d, 1)[0].points.length, 2);
  assert.equal(E.flattenSvgPath('M0 0L5 5Z')[0].closed, true);
  assert.equal(E.flattenSvgPath('M0 0L5 5')[0].closed, false);
});

test('computeSvgPathLength defaults to 64 steps and honours an explicit count', () => {
  const d = 'M0 0C0 10 10 10 10 0';
  near(E.computeSvgPathLength(d, 1), 10);
  assert.equal(E.computeSvgPathLength(d), E.computeSvgPathLength(d, 64));
  assert.ok(E.computeSvgPathLength(d, 1) < E.computeSvgPathLength(d, 8));
  assert.ok(E.computeSvgPathLength(d, 8) < E.computeSvgPathLength(d, 64));
});

test('nodesBoundingBox of one lonely node is that node', () => {
  const b = E.nodesBoundingBox([{ x: 4, y: 7, inX: 4, inY: 7, outX: 4, outY: 7 }], false);
  assert.deepEqual([b.minX, b.minY, b.maxX, b.maxY], [4, 7, 4, 7]);
});

test('pathDataToNodes of an open path stops at the second M', () => {
  const r = E.pathDataToNodes('M0 0L1 1M5 5L6 6');
  assert.equal(r.nodes.length, 2);
  assert.equal(r.closed, false);
});

test('fitSmoothNodes treats missing options as an open path with a 60 degree corner limit', () => {
  const pts = [pt(0, 0), pt(10, 0), pt(20, 0), pt(30, 10)];
  const nodes = E.fitSmoothNodes(pts);
  assert.equal(nodes[0].inX, 0);
  assert.equal(nodes[0].inY, 0);
  assert.equal(nodes[3].outX, 30);
  assert.equal(nodes[3].outY, 10);
  assert.ok(nodes[2].outX > nodes[2].x);
  const explicit = E.fitSmoothNodes(pts, { closed: false });
  assert.deepEqual(explicit, nodes);
});

test('fitSmoothNodes default corner angle is 60 degrees and can be overridden', () => {
  const bend45 = [pt(0, 0), pt(10, 0), pt(20, 10), pt(30, 10)];
  const bend90 = [pt(0, 0), pt(10, 0), pt(10, 10), pt(20, 10)];
  const smooth45 = E.fitSmoothNodes(bend45, { closed: false });
  assert.notEqual(smooth45[1].outX, smooth45[1].x);
  const sharp90 = E.fitSmoothNodes(bend90, { closed: false });
  assert.equal(sharp90[1].outX, sharp90[1].x);
  assert.equal(sharp90[1].inY, sharp90[1].y);
  const loose = E.fitSmoothNodes(bend90, { closed: false, cornerAngle: 100 });
  assert.notEqual(loose[1].outX, loose[1].x);
  const strict = E.fitSmoothNodes(bend45, { closed: false, cornerAngle: 30 });
  assert.equal(strict[1].outX, strict[1].x);
});

test('fitSmoothNodes skips a degenerate tangent where both neighbours coincide', () => {
  const nodes = E.fitSmoothNodes([pt(0, 0), pt(5, 5), pt(0, 0)], { closed: false, cornerAngle: 200 });
  assert.equal(nodes[1].outX, 5);
  assert.equal(nodes[1].inY, 5);
});

test('optimizeContour defaults to epsilon 0.5 and precision 2', () => {
  const { nodes } = E.pathDataToNodes(circlePath(50, 60, 60));
  const trace = E.flattenNodes(nodes, true, 48);
  const implicit = E.optimizeContour(trace, { closed: true });
  const explicit = E.optimizeContour(trace, { closed: true, epsilon: 0.5, precision: 2 });
  assert.equal(implicit.d, explicit.d);
  assert.equal(implicit.nodeCountAfter, explicit.nodeCountAfter);
  const looser = E.optimizeContour(trace, { closed: true, epsilon: 4, precision: 2 });
  assert.ok(looser.nodeCountAfter < implicit.nodeCountAfter);
  const coarse = E.optimizeContour(trace, { closed: true, epsilon: 0.5, precision: 0 });
  assert.ok(coarse.bytesAfter < implicit.bytesAfter);
  const open = E.optimizeContour(trace, {});
  assert.ok(open.d.indexOf('Z') < 0);
});

test('path writers default to two decimals', () => {
  assert.equal(E.polylineToPathData([pt(0, 0), pt(5.123, 5)], false), 'M0 0L5.12 5');
  const r = E.pathDataToNodes('M0 0L5.678 1');
  assert.equal(E.nodesToPathData(r.nodes, false), 'M0 0L5.68 1');
  assert.equal(E.nodesToPathData(r.nodes, false, 0), 'M0 0L6 1');
});

test('MaxRectsBin picks the free rectangle with the smaller long side leftover on a tie', () => {
  const bin = new E.MaxRectsBin(200, 200);
  bin.free = [{ x: 0, y: 0, w: 120, h: 50 }, { x: 100, y: 100, w: 50, h: 100 }];
  const spot = E.MaxRectsBin.prototype.findBssf.call(bin, 40, 40);
  assert.deepEqual(spot, { x: 100, y: 100, w: 40, h: 40 });
  bin.free.reverse();
  assert.deepEqual(E.MaxRectsBin.prototype.findBssf.call(bin, 40, 40), { x: 100, y: 100, w: 40, h: 40 });
});

test('MaxRectsBin prefers the smaller short side leftover and refuses too large frames', () => {
  const bin = new E.MaxRectsBin(100, 100);
  bin.free = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 50, h: 42 }];
  assert.deepEqual(bin.findBssf(40, 40), { x: 0, y: 0, w: 40, h: 40 });
  assert.equal(bin.findBssf(101, 10), null);
  assert.equal(bin.findBssf(10, 101), null);
  assert.deepEqual(bin.findBssf(100, 100), { x: 0, y: 0, w: 100, h: 100 });
});

test('MaxRectsBin.place splits free space and prunes contained rectangles', () => {
  const bin = new E.MaxRectsBin(100, 100);
  bin.place({ x: 0, y: 0, w: 50, h: 50 });
  assert.equal(bin.free.length, 2);
  const keys = bin.free.map((f) => [f.x, f.y, f.w, f.h].join(',')).sort();
  assert.deepEqual(keys, ['0,50,100,50', '50,0,50,100']);
  bin.place({ x: 50, y: 0, w: 50, h: 50 });
  assert.deepEqual(bin.free.map((f) => [f.x, f.y, f.w, f.h].join(',')), ['0,50,100,50']);
  bin.place({ x: 20, y: 60, w: 10, h: 10 });
  assert.equal(bin.free.length, 4);
  bin.free.forEach((f) => assert.equal(
    f.x < 30 && f.x + f.w > 20 && f.y < 70 && f.y + f.h > 60, false
  ));
});

test('pruneFreeRects drops contained and duplicate rectangles but keeps a lone one', () => {
  const big = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(E.pruneFreeRects([big]).length, 1);
  assert.equal(E.pruneFreeRects([big, { x: 0, y: 0, w: 10, h: 10 }]).length, 1);
  assert.equal(E.pruneFreeRects([big, { x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }]).length, 1);
  const flush = [
    { x: 0, y: 0, w: 5, h: 5 }, { x: 5, y: 0, w: 5, h: 5 }, { x: 0, y: 5, w: 5, h: 5 }, { x: 5, y: 5, w: 5, h: 5 },
    { x: 3, y: 3, w: 4, h: 4 }
  ];
  assert.deepEqual(E.pruneFreeRects([big].concat(flush)), [big]);
  const apart = [{ x: 0, y: 0, w: 5, h: 5 }, { x: 6, y: 0, w: 5, h: 5 }];
  assert.equal(E.pruneFreeRects(apart).length, 2);
  const partial = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }];
  assert.equal(E.pruneFreeRects(partial).length, 2);
});

test('atlas exports mark frames as not rotated and not trimmed', () => {
  const atlas = sampleAtlas();
  const json = JSON.parse(E.exportTexturePackerHash(atlas, 's.png'));
  const first = json.frames[atlas.placements[0].name];
  assert.strictEqual(first.rotated, false);
  assert.strictEqual(first.trimmed, false);
  assert.deepEqual(first.spriteSourceSize, { x: 0, y: 0, w: atlas.placements[0].w, h: atlas.placements[0].h });
  assert.equal(json.meta.format, 'RGBA8888');
  assert.equal(json.meta.scale, '1');
});

test('generateSampleFrames reaches both ends of the size range', () => {
  const frames = E.generateSampleFrames(300, 11, 10, 12);
  const widths = new Set(frames.map((f) => f.w));
  const heights = new Set(frames.map((f) => f.h));
  assert.deepEqual(Array.from(widths).sort(), [10, 11, 12]);
  assert.deepEqual(Array.from(heights).sort(), [10, 11, 12]);
});

test('quantizeRgbaToPalette never reuses a cached index for a different colour', () => {
  const rgba = new Uint8ClampedArray([
    9, 9, 9, 255,
    0, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 0, 255
  ]);
  const g = E.quantizeRgbaToPalette(rgba, 4, 1, ['#000000', '#00ff00']);
  assert.deepEqual(Array.from(g.data), [0, 0, 1, 0]);
});

test('OKLab and CIE Lab can disagree about the nearest colour', () => {
  const pal = E.getPalette('pico8').colors;
  const c = { r: 19, g: 195, b: 123 };
  assert.equal(E.nearestPaletteIndex(c, pal), 11);
  assert.equal(E.nearestPaletteIndex(c, pal, 'oklab'), 11);
  assert.equal(E.nearestPaletteIndex(c, pal, 'cielab'), 3);
});

test('buildAtlasGrid copies frames and repeats edge pixels into the extrude border', () => {
  const atlas = E.packSpriteAtlasMaxRects([{ name: 'a', w: 2, h: 2 }], { padding: 0, extrude: 1 });
  const sprite = E.gridFromRows(['01', '23'], { 0: 0, 1: 1, 2: 2, 3: 3 });
  const sheet = E.buildAtlasGrid(atlas, { a: sprite }, () => 4);
  assert.equal(E.getPixel(sheet, 1, 1), 0);
  assert.equal(E.getPixel(sheet, 2, 1), 1);
  assert.equal(E.getPixel(sheet, 1, 2), 2);
  assert.equal(E.getPixel(sheet, 2, 2), 3);
  assert.equal(E.getPixel(sheet, 0, 0), 0);
  assert.equal(E.getPixel(sheet, 3, 0), 1);
  assert.equal(E.getPixel(sheet, 0, 3), 2);
  assert.equal(E.getPixel(sheet, 3, 3), 3);
  assert.equal(E.getPixel(sheet, 3, 1), 1);
});

test('buildAtlasGrid fills frames that have no grid using the fill callback', () => {
  const atlas = E.packSpriteAtlasMaxRects([{ name: 'a', w: 3, h: 3 }, { name: 'b', w: 3, h: 3 }], { padding: 0, extrude: 0 });
  const sheet = E.buildAtlasGrid(atlas, {}, (i) => i);
  atlas.placements.forEach((p, i) => {
    assert.equal(E.getPixel(sheet, p.x, p.y), i);
    assert.equal(E.getPixel(sheet, p.x + 2, p.y + 2), i);
  });
  assert.equal(sheet.width, atlas.width);
});
