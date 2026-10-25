/*
 * Paperclip Vector & Sprite Rig: deterministic engine.
 *
 * One UMD file, no dependencies. It loads as a plain <script> in the browser
 * (global PaperclipEngine) and as a CommonJS module under Node (node:test).
 *
 * Three groups of functions live here:
 *   1. Vector: cubic Bezier maths (De Casteljau), Ramer-Douglas-Peucker
 *      simplification, SVG path parsing, measuring and precision-controlled
 *      serialisation, node and handle editing helpers, curvature comb.
 *   2. Atlas: MaxRects bin packing with the Best Short Side Fit rule, plus
 *      TexturePacker style, Phaser style and CSS exports.
 *   3. Pixel: Bresenham lines, 4-connected flood fill, OKLab and CIE Lab
 *      palette quantising, lightness-rank palette remapping, a dependency-free
 *      PNG encoder and SVG sprite sheet export.
 *
 * Every function is pure and deterministic. The same input always gives the
 * same output, which is what the test suite relies on.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PaperclipEngine = factory();
  }
}(this, function () {
  'use strict';

  var EPS = 1e-9;
  var TRANSPARENT = -1;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function clamp(v, lo, hi) {
    if (v < lo) { return lo; }
    if (v > hi) { return hi; }
    return v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpPoint(a, b, t) {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  }

  function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function clonePoint(p) {
    return { x: p.x, y: p.y };
  }

  /* ------------------------------------------------------------------ */
  /* Cubic Bezier maths                                                  */
  /* ------------------------------------------------------------------ */

  /** De Casteljau evaluation of a cubic Bezier at parameter t. */
  function evaluateCubicBezier(p0, p1, p2, p3, t) {
    var a = lerpPoint(p0, p1, t);
    var b = lerpPoint(p1, p2, t);
    var c = lerpPoint(p2, p3, t);
    var d = lerpPoint(a, b, t);
    var e = lerpPoint(b, c, t);
    return lerpPoint(d, e, t);
  }

  /** De Casteljau subdivision. Returns the two cubic halves at t. */
  function splitCubicBezier(p0, p1, p2, p3, t) {
    var a = lerpPoint(p0, p1, t);
    var b = lerpPoint(p1, p2, t);
    var c = lerpPoint(p2, p3, t);
    var d = lerpPoint(a, b, t);
    var e = lerpPoint(b, c, t);
    var f = lerpPoint(d, e, t);
    return {
      left: [clonePoint(p0), a, d, f],
      right: [clonePoint(f), e, c, clonePoint(p3)]
    };
  }

  /** First derivative of a cubic Bezier. */
  function cubicFirstDerivative(p0, p1, p2, p3, t) {
    var u = 1 - t;
    var k0 = 3 * u * u;
    var k1 = 6 * u * t;
    var k2 = 3 * t * t;
    return {
      x: k0 * (p1.x - p0.x) + k1 * (p2.x - p1.x) + k2 * (p3.x - p2.x),
      y: k0 * (p1.y - p0.y) + k1 * (p2.y - p1.y) + k2 * (p3.y - p2.y)
    };
  }

  function cubicSecondDerivative(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return {
      x: 6 * (u * (p2.x - 2 * p1.x + p0.x) + t * (p3.x - 2 * p2.x + p1.x)),
      y: 6 * (u * (p2.y - 2 * p1.y + p0.y) + t * (p3.y - 2 * p2.y + p1.y))
    };
  }

  /** Signed curvature of a cubic Bezier at t. Zero where the speed vanishes. */
  function curvatureAtCubic(p0, p1, p2, p3, t) {
    var d1 = cubicFirstDerivative(p0, p1, p2, p3, t);
    var d2 = cubicSecondDerivative(p0, p1, p2, p3, t);
    var speed2 = d1.x * d1.x + d1.y * d1.y;
    if (speed2 < EPS) { return 0; }
    return (d1.x * d2.y - d1.y * d2.x) / Math.pow(speed2, 1.5);
  }

  /** Flatten a cubic into evenly spaced points, both end points included. */
  function flattenCubicBezier(p0, p1, p2, p3, segments) {
    var n = Math.max(1, Math.floor(segments));
    var out = [];
    for (var i = 0; i <= n; i += 1) {
      out.push(evaluateCubicBezier(p0, p1, p2, p3, i / n));
    }
    return out;
  }

  function quadraticRoots(a, b, c) {
    if (Math.abs(a) < EPS) {
      if (Math.abs(b) < EPS) { return []; }
      return [-c / b];
    }
    var disc = b * b - 4 * a * c;
    if (disc < 0) { return []; }
    var root = Math.sqrt(disc);
    return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
  }

  /** Exact axis aligned bounding box of one cubic, from derivative roots. */
  function cubicBoundingBox(p0, p1, p2, p3) {
    var ts = [0, 1];
    ['x', 'y'].forEach(function (axis) {
      var a = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis];
      var b = 2 * (p0[axis] - 2 * p1[axis] + p2[axis]);
      var c = p1[axis] - p0[axis];
      quadraticRoots(a, b, c).forEach(function (t) {
        if (t > 0 && t < 1) { ts.push(t); }
      });
    });
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    ts.forEach(function (t) {
      var p = evaluateCubicBezier(p0, p1, p2, p3, t);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, width: maxX - minX, height: maxY - minY };
  }

  function polylineBoundingBox(points) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    points.forEach(function (p) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    if (points.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, width: maxX - minX, height: maxY - minY };
  }

  function unionBoxes(a, b) {
    if (!a) { return b; }
    var minX = Math.min(a.minX, b.minX);
    var minY = Math.min(a.minY, b.minY);
    var maxX = Math.max(a.maxX, b.maxX);
    var maxY = Math.max(a.maxY, b.maxY);
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, width: maxX - minX, height: maxY - minY };
  }

  function polylineLength(points, closed) {
    var total = 0;
    for (var i = 1; i < points.length; i += 1) {
      total += distance(points[i - 1], points[i]);
    }
    if (closed && points.length > 2) {
      total += distance(points[points.length - 1], points[0]);
    }
    return total;
  }

  /* ------------------------------------------------------------------ */
  /* Ramer-Douglas-Peucker                                               */
  /* ------------------------------------------------------------------ */

  /** Distance from point p to the segment a-b (clamped to the segment). */
  function perpendicularDistance(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    if (len2 < EPS) { return distance(p, a); }
    var t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  /**
   * Ramer-Douglas-Peucker simplification of an open polyline. Iterative, so
   * a long trace cannot blow the call stack. End points are always kept.
   */
  function simplifyPolylineRdp(points, epsilon) {
    var n = points.length;
    if (n < 3) { return points.map(clonePoint); }
    var keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;
    var stack = [[0, n - 1]];
    while (stack.length > 0) {
      var range = stack.pop();
      var start = range[0];
      var end = range[1];
      var worst = 0;
      var index = start;
      for (var i = start + 1; i < end; i += 1) {
        var d = perpendicularDistance(points[i], points[start], points[end]);
        if (d > worst) {
          worst = d;
          index = i;
        }
      }
      if (worst > epsilon) {
        keep[index] = 1;
        stack.push([start, index]);
        stack.push([index, end]);
      }
    }
    var out = [];
    for (var j = 0; j < n; j += 1) {
      if (keep[j] === 1) { out.push(clonePoint(points[j])); }
    }
    return out;
  }

  /**
   * RDP for a closed ring. An open run would collapse a ring whose first and
   * last points match, so the ring is cut at the point farthest from the
   * first point and each half is simplified on its own.
   */
  function simplifyClosedPolylineRdp(points, epsilon) {
    var n = points.length;
    if (n < 4) { return points.map(clonePoint); }
    var far = 0;
    var best = 0;
    for (var i = 1; i < n; i += 1) {
      var d = distance(points[0], points[i]);
      if (d > best) {
        best = d;
        far = i;
      }
    }
    var first = simplifyPolylineRdp(points.slice(0, far + 1), epsilon);
    var second = simplifyPolylineRdp(points.slice(far).concat([points[0]]), epsilon);
    return first.concat(second.slice(1, second.length - 1));
  }

  /** Largest distance from the vertices of a to the polyline b. */
  function oneSidedDeviation(a, b, closed) {
    var worst = 0;
    var segs = closed ? b.length : b.length - 1;
    a.forEach(function (p) {
      var nearest = Infinity;
      for (var i = 0; i < segs; i += 1) {
        var d = perpendicularDistance(p, b[i], b[(i + 1) % b.length]);
        if (d < nearest) { nearest = d; }
      }
      if (nearest > worst && nearest !== Infinity) { worst = nearest; }
    });
    return worst;
  }

  /** Symmetric (Hausdorff style) deviation between two polylines. */
  function polylineDeviation(a, b, closed) {
    if (a.length === 0 || b.length === 0) { return 0; }
    return Math.max(oneSidedDeviation(a, b, closed), oneSidedDeviation(b, a, closed));
  }

  /* ------------------------------------------------------------------ */
  /* SVG path parsing, measuring and serialising                         */
  /* ------------------------------------------------------------------ */

  var TOKEN_RE = /([MmLlHhVvCcSsQqZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  var ARG_COUNT = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, Z: 0 };

  /**
   * Parse path data into absolute M, L, C and Z commands.
   * Supports M L H V C S Q Z in both cases. Arcs are rejected on purpose.
   */
  function parseSvgPath(d) {
    if (typeof d !== 'string') { throw new TypeError('path data must be a string'); }
    var tokens = [];
    var match;
    TOKEN_RE.lastIndex = 0;
    while ((match = TOKEN_RE.exec(d)) !== null) {
      if (match[1] !== undefined) {
        tokens.push({ cmd: match[1] });
      } else {
        tokens.push({ num: parseFloat(match[2]) });
      }
    }
    if (/[AaTt]/.test(d)) { throw new Error('arc and smooth quadratic commands are not supported'); }
    var out = [];
    var cx = 0;
    var cy = 0;
    var sx = 0;
    var sy = 0;
    var lastCtrl = null;
    var i = 0;
    var cmd = null;
    while (i < tokens.length) {
      if (tokens[i].cmd !== undefined) {
        cmd = tokens[i].cmd;
        i += 1;
        if (cmd === 'Z' || cmd === 'z') {
          out.push({ cmd: 'Z', args: [] });
          cx = sx;
          cy = sy;
          lastCtrl = null;
          continue;
        }
      } else if (cmd === null) {
        throw new Error('path data must start with a command');
      }
      var upper = cmd.toUpperCase();
      var need = ARG_COUNT[upper];
      var args = [];
      for (var k = 0; k < need; k += 1) {
        var tok = tokens[i + k];
        if (tok === undefined || tok.num === undefined) {
          throw new Error('missing number for command ' + cmd);
        }
        args.push(tok.num);
      }
      i += need;
      var rel = cmd !== upper;
      var ox = rel ? cx : 0;
      var oy = rel ? cy : 0;
      if (upper === 'M') {
        cx = args[0] + ox;
        cy = args[1] + oy;
        sx = cx;
        sy = cy;
        out.push({ cmd: 'M', args: [cx, cy] });
        cmd = rel ? 'l' : 'L';
        lastCtrl = null;
      } else if (upper === 'L') {
        cx = args[0] + ox;
        cy = args[1] + oy;
        out.push({ cmd: 'L', args: [cx, cy] });
        lastCtrl = null;
      } else if (upper === 'H') {
        cx = args[0] + ox;
        out.push({ cmd: 'L', args: [cx, cy] });
        lastCtrl = null;
      } else if (upper === 'V') {
        cy = args[0] + oy;
        out.push({ cmd: 'L', args: [cx, cy] });
        lastCtrl = null;
      } else if (upper === 'C') {
        var c1x = args[0] + ox;
        var c1y = args[1] + oy;
        var c2x = args[2] + ox;
        var c2y = args[3] + oy;
        cx = args[4] + ox;
        cy = args[5] + oy;
        out.push({ cmd: 'C', args: [c1x, c1y, c2x, c2y, cx, cy] });
        lastCtrl = { x: c2x, y: c2y };
      } else if (upper === 'S') {
        var r1x = lastCtrl ? 2 * cx - lastCtrl.x : cx;
        var r1y = lastCtrl ? 2 * cy - lastCtrl.y : cy;
        var s2x = args[0] + ox;
        var s2y = args[1] + oy;
        cx = args[2] + ox;
        cy = args[3] + oy;
        out.push({ cmd: 'C', args: [r1x, r1y, s2x, s2y, cx, cy] });
        lastCtrl = { x: s2x, y: s2y };
      } else if (upper === 'Q') {
        var qx = args[0] + ox;
        var qy = args[1] + oy;
        var ex = args[2] + ox;
        var ey = args[3] + oy;
        out.push({
          cmd: 'C',
          args: [
            cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy),
            ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey),
            ex, ey
          ]
        });
        cx = ex;
        cy = ey;
        lastCtrl = null;
      }
    }
    return out;
  }

  /** Flatten parsed commands into polylines, one per subpath. */
  function flattenCommands(commands, segmentsPerCurve) {
    var subpaths = [];
    var current = null;
    var cx = 0;
    var cy = 0;
    commands.forEach(function (c) {
      if (c.cmd === 'M') {
        current = { points: [{ x: c.args[0], y: c.args[1] }], closed: false };
        subpaths.push(current);
        cx = c.args[0];
        cy = c.args[1];
      } else if (c.cmd === 'L' && current) {
        current.points.push({ x: c.args[0], y: c.args[1] });
        cx = c.args[0];
        cy = c.args[1];
      } else if (c.cmd === 'C' && current) {
        var pts = flattenCubicBezier(
          { x: cx, y: cy },
          { x: c.args[0], y: c.args[1] },
          { x: c.args[2], y: c.args[3] },
          { x: c.args[4], y: c.args[5] },
          segmentsPerCurve
        );
        for (var i = 1; i < pts.length; i += 1) { current.points.push(pts[i]); }
        cx = c.args[4];
        cy = c.args[5];
      } else if (c.cmd === 'Z' && current) {
        current.closed = true;
        cx = current.points[0].x;
        cy = current.points[0].y;
      }
    });
    return subpaths;
  }

  function flattenSvgPath(d, segmentsPerCurve) {
    return flattenCommands(parseSvgPath(d), segmentsPerCurve === undefined ? 32 : segmentsPerCurve);
  }

  /** Length of an SVG path, measured on a flattened copy (default 64 steps per curve). */
  function computeSvgPathLength(d, segmentsPerCurve) {
    var steps = segmentsPerCurve === undefined ? 64 : segmentsPerCurve;
    var total = 0;
    flattenSvgPath(d, steps).forEach(function (sp) {
      total += polylineLength(sp.points, sp.closed);
    });
    return total;
  }

  /** Format one number: rounded to precision decimals, trailing zeros trimmed, no leading zero. */
  function formatNumber(value, precision) {
    var p = clamp(Math.round(precision), 0, 8);
    var s = value.toFixed(p);
    if (s.indexOf('.') >= 0) {
      s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    if (s === '-0' || s === '') { s = '0'; }
    s = s.replace(/^(-?)0\./, '$1.');
    return s;
  }

  function joinNumbers(values, precision) {
    var out = '';
    values.forEach(function (v, i) {
      var s = formatNumber(v, precision);
      if (i > 0 && s.charAt(0) !== '-') { out += ' '; }
      out += s;
    });
    return out;
  }

  /** Serialise absolute commands, repeating no command letter when it repeats. */
  function serializeCommands(commands, precision) {
    var out = '';
    var prev = '';
    commands.forEach(function (c) {
      if (c.cmd === 'Z') {
        out += 'Z';
        prev = 'Z';
        return;
      }
      var body = joinNumbers(c.args, precision);
      if (c.cmd === prev) {
        out += (body.charAt(0) === '-' ? '' : ' ') + body;
      } else {
        out += c.cmd + body;
      }
      prev = c.cmd;
    });
    return out;
  }

  /** Re-serialise path data with every coordinate rounded to a fixed precision. */
  function quantizeSvgCoordinates(d, precision) {
    return serializeCommands(parseSvgPath(d), precision);
  }

  function utf8ByteLength(str) {
    var bytes = 0;
    for (var i = 0; i < str.length; i += 1) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  /** Number of anchor points in path data (a closing line back to the start is not counted twice). */
  function countPathNodes(d) {
    var count = 0;
    var subpaths = [];
    var current = null;
    parseSvgPath(d).forEach(function (c) {
      if (c.cmd === 'M') {
        current = { n: 1, first: [c.args[0], c.args[1]], last: [c.args[0], c.args[1]], closed: false };
        subpaths.push(current);
      } else if (c.cmd === 'Z' && current) {
        current.closed = true;
      } else if (current) {
        current.n += 1;
        current.last = [c.args[c.args.length - 2], c.args[c.args.length - 1]];
      }
    });
    subpaths.forEach(function (sp) {
      var dupe = sp.closed && sp.n > 1 &&
        Math.abs(sp.first[0] - sp.last[0]) < 1e-6 && Math.abs(sp.first[1] - sp.last[1]) < 1e-6;
      count += dupe ? sp.n - 1 : sp.n;
    });
    return count;
  }

  /** Quick statistics for an SVG path string. */
  function pathStats(d, precision) {
    var q = precision === undefined ? d : quantizeSvgCoordinates(d, precision);
    var box = null;
    var cx = 0;
    var cy = 0;
    parseSvgPath(d).forEach(function (c) {
      if (c.cmd === 'M' || c.cmd === 'L') {
        var pb = polylineBoundingBox([{ x: c.args[0], y: c.args[1] }]);
        box = unionBoxes(box, pb);
        cx = c.args[0];
        cy = c.args[1];
      } else if (c.cmd === 'C') {
        box = unionBoxes(box, cubicBoundingBox(
          { x: cx, y: cy },
          { x: c.args[0], y: c.args[1] },
          { x: c.args[2], y: c.args[3] },
          { x: c.args[4], y: c.args[5] }
        ));
        cx = c.args[4];
        cy = c.args[5];
      }
    });
    return {
      nodes: countPathNodes(d),
      bytes: utf8ByteLength(q),
      length: computeSvgPathLength(d),
      bbox: box || polylineBoundingBox([])
    };
  }

  /* ------------------------------------------------------------------ */
  /* Node and handle model (what the editor drags)                       */
  /* ------------------------------------------------------------------ */

  function makeNode(x, y) {
    return { x: x, y: y, inX: x, inY: y, outX: x, outY: y };
  }

  function cloneNodes(nodes) {
    return nodes.map(function (n) {
      return { x: n.x, y: n.y, inX: n.inX, inY: n.inY, outX: n.outX, outY: n.outY };
    });
  }

  /** Turn a single subpath of path data into editable nodes with in and out handles. */
  function pathDataToNodes(d) {
    var commands = parseSvgPath(d);
    var nodes = [];
    var closed = false;
    var started = false;
    for (var i = 0; i < commands.length; i += 1) {
      var c = commands[i];
      if (c.cmd === 'M') {
        if (started) { break; }
        started = true;
        nodes.push(makeNode(c.args[0], c.args[1]));
      } else if (c.cmd === 'L') {
        nodes.push(makeNode(c.args[0], c.args[1]));
      } else if (c.cmd === 'C') {
        var prev = nodes[nodes.length - 1];
        prev.outX = c.args[0];
        prev.outY = c.args[1];
        var node = makeNode(c.args[4], c.args[5]);
        node.inX = c.args[2];
        node.inY = c.args[3];
        nodes.push(node);
      } else if (c.cmd === 'Z') {
        closed = true;
        break;
      }
    }
    if (closed && nodes.length > 1) {
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
        first.inX = last.inX;
        first.inY = last.inY;
        nodes.pop();
      }
    }
    return { nodes: nodes, closed: closed };
  }

  function nodeSegment(a, b) {
    return [
      { x: a.x, y: a.y },
      { x: a.outX, y: a.outY },
      { x: b.inX, y: b.inY },
      { x: b.x, y: b.y }
    ];
  }

  /** The cubic segments of a node list. A closed list adds the wrap-around segment. */
  function nodesToSegments(nodes, closed) {
    var segs = [];
    for (var i = 0; i < nodes.length - 1; i += 1) {
      segs.push(nodeSegment(nodes[i], nodes[i + 1]));
    }
    if (closed && nodes.length > 1) {
      segs.push(nodeSegment(nodes[nodes.length - 1], nodes[0]));
    }
    return segs;
  }

  function isStraight(seg) {
    return Math.abs(seg[1].x - seg[0].x) < 1e-6 && Math.abs(seg[1].y - seg[0].y) < 1e-6 &&
      Math.abs(seg[2].x - seg[3].x) < 1e-6 && Math.abs(seg[2].y - seg[3].y) < 1e-6;
  }

  /** Serialise nodes as path data. Segments with no handles become lines. */
  function nodesToPathData(nodes, closed, precision) {
    if (nodes.length === 0) { return ''; }
    var cmds = [{ cmd: 'M', args: [nodes[0].x, nodes[0].y] }];
    var segments = nodesToSegments(nodes, closed);
    segments.forEach(function (seg, idx) {
      var wrap = closed && idx === segments.length - 1;
      if (isStraight(seg)) {
        if (!wrap) { cmds.push({ cmd: 'L', args: [seg[3].x, seg[3].y] }); }
      } else {
        cmds.push({ cmd: 'C', args: [seg[1].x, seg[1].y, seg[2].x, seg[2].y, seg[3].x, seg[3].y] });
      }
    });
    if (closed) { cmds.push({ cmd: 'Z', args: [] }); }
    return serializeCommands(cmds, precision === undefined ? 2 : precision);
  }

  /** Flatten nodes to a polyline. A closed ring does not repeat its first point. */
  function flattenNodes(nodes, closed, segmentsPerCurve) {
    var segs = nodesToSegments(nodes, closed);
    if (segs.length === 0) { return nodes.map(function (n) { return { x: n.x, y: n.y }; }); }
    var out = [];
    segs.forEach(function (seg, idx) {
      var pts = flattenCubicBezier(seg[0], seg[1], seg[2], seg[3], segmentsPerCurve);
      var from = idx === 0 ? 0 : 1;
      for (var i = from; i < pts.length; i += 1) { out.push(pts[i]); }
    });
    if (closed) { out.pop(); }
    return out;
  }

  function nodesBoundingBox(nodes, closed) {
    var segs = nodesToSegments(nodes, closed);
    if (segs.length === 0) { return polylineBoundingBox(nodes); }
    var box = null;
    segs.forEach(function (seg) {
      box = unionBoxes(box, cubicBoundingBox(seg[0], seg[1], seg[2], seg[3]));
    });
    return box;
  }

  /** Move an anchor and carry both of its handles along. */
  function moveNode(nodes, index, x, y) {
    var out = cloneNodes(nodes);
    var n = out[index];
    var dx = x - n.x;
    var dy = y - n.y;
    n.x = x;
    n.y = y;
    n.inX += dx;
    n.inY += dy;
    n.outX += dx;
    n.outY += dy;
    return out;
  }

  /**
   * Move one handle. mode is 'free', 'smooth' (opposite handle stays collinear,
   * keeps its own length) or 'mirrored' (opposite handle copies the length).
   */
  function moveHandle(nodes, index, which, x, y, mode) {
    var out = cloneNodes(nodes);
    var n = out[index];
    var other = which === 'in' ? 'out' : 'in';
    var kx = which + 'X';
    var ky = which + 'Y';
    var ox = other + 'X';
    var oy = other + 'Y';
    n[kx] = x;
    n[ky] = y;
    if (mode === 'smooth' || mode === 'mirrored') {
      var vx = x - n.x;
      var vy = y - n.y;
      var len = Math.hypot(vx, vy);
      if (len > EPS) {
        var otherLen = mode === 'mirrored' ? len : Math.hypot(n[ox] - n.x, n[oy] - n.y);
        if (otherLen < EPS) { otherLen = len; }
        n[ox] = n.x - (vx / len) * otherLen;
        n[oy] = n.y - (vy / len) * otherLen;
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Curve fitting through simplified points                             */
  /* ------------------------------------------------------------------ */

  function turnAngleDegrees(prev, cur, next) {
    var ax = cur.x - prev.x;
    var ay = cur.y - prev.y;
    var bx = next.x - cur.x;
    var by = next.y - cur.y;
    var la = Math.hypot(ax, ay);
    var lb = Math.hypot(bx, by);
    if (la < EPS || lb < EPS) { return 0; }
    var cos = clamp((ax * bx + ay * by) / (la * lb), -1, 1);
    return (Math.acos(cos) * 180) / Math.PI;
  }

  /**
   * Fit a smooth cubic spline through points. Tangents follow the neighbours
   * (Catmull-Rom direction) and handle lengths are a third of the adjacent
   * chord. A turn sharper than cornerAngle degrees stays a corner.
   */
  function fitSmoothNodes(points, options) {
    var opts = options || {};
    var closed = opts.closed === true;
    var cornerAngle = opts.cornerAngle === undefined ? 60 : opts.cornerAngle;
    var smoothness = opts.smoothness === undefined ? 1 : opts.smoothness;
    var n = points.length;
    var nodes = points.map(function (p) { return makeNode(p.x, p.y); });
    if (n < 3) { return nodes; }
    for (var i = 0; i < n; i += 1) {
      var prev = points[closed ? (i + n - 1) % n : Math.max(i - 1, 0)];
      var next = points[closed ? (i + 1) % n : Math.min(i + 1, n - 1)];
      var cur = points[i];
      if (turnAngleDegrees(prev, cur, next) > cornerAngle) { continue; }
      var tx = next.x - prev.x;
      var ty = next.y - prev.y;
      var tl = Math.hypot(tx, ty);
      if (tl < EPS) { continue; }
      var dx = tx / tl;
      var dy = ty / tl;
      var lenOut = distance(cur, next) * smoothness / 3;
      var lenIn = distance(cur, prev) * smoothness / 3;
      var node = nodes[i];
      node.outX = cur.x + dx * lenOut;
      node.outY = cur.y + dy * lenOut;
      node.inX = cur.x - dx * lenIn;
      node.inY = cur.y - dy * lenIn;
    }
    return nodes;
  }

  /**
   * The full optimiser: flatten a curve to a dense trace, simplify the trace
   * with RDP, refit smooth cubics, and report what it cost and saved.
   * The "before" figures describe the dense trace written as a polyline.
   */
  function optimizeContour(trace, options) {
    var opts = options || {};
    var closed = opts.closed === true;
    var epsilon = opts.epsilon === undefined ? 0.5 : opts.epsilon;
    var precision = opts.precision === undefined ? 2 : opts.precision;
    var kept = closed ? simplifyClosedPolylineRdp(trace, epsilon) : simplifyPolylineRdp(trace, epsilon);
    var nodes = opts.fit === 'lines' ? kept.map(function (p) { return makeNode(p.x, p.y); })
      : fitSmoothNodes(kept, { closed: closed, cornerAngle: opts.cornerAngle, smoothness: opts.smoothness });
    var d = nodesToPathData(nodes, closed, precision);
    var before = polylineToPathData(trace, closed, precision);
    var rebuilt = flattenNodes(nodes, closed, 12);
    return {
      kept: kept,
      nodes: nodes,
      d: d,
      beforeD: before,
      nodeCountBefore: trace.length,
      nodeCountAfter: kept.length,
      bytesBefore: utf8ByteLength(before),
      bytesAfter: utf8ByteLength(d),
      deviation: polylineDeviation(trace, rebuilt, closed)
    };
  }

  function polylineToPathData(points, closed, precision) {
    if (points.length === 0) { return ''; }
    var cmds = [{ cmd: 'M', args: [points[0].x, points[0].y] }];
    for (var i = 1; i < points.length; i += 1) {
      cmds.push({ cmd: 'L', args: [points[i].x, points[i].y] });
    }
    if (closed) { cmds.push({ cmd: 'Z', args: [] }); }
    return serializeCommands(cmds, precision === undefined ? 2 : precision);
  }

  /**
   * Curvature comb: for each sample on the curve a short spike along the
   * normal, as long as the curvature times scale. Used to judge fairness.
   */
  function curvatureComb(nodes, closed, samplesPerSegment, scale) {
    var out = [];
    var per = Math.max(1, Math.floor(samplesPerSegment));
    nodesToSegments(nodes, closed).forEach(function (seg) {
      for (var i = 0; i <= per; i += 1) {
        var t = i / per;
        var p = evaluateCubicBezier(seg[0], seg[1], seg[2], seg[3], t);
        var d1 = cubicFirstDerivative(seg[0], seg[1], seg[2], seg[3], t);
        var speed = Math.hypot(d1.x, d1.y);
        var k = curvatureAtCubic(seg[0], seg[1], seg[2], seg[3], t);
        var nx = speed < EPS ? 0 : -d1.y / speed;
        var ny = speed < EPS ? 0 : d1.x / speed;
        out.push({ x: p.x, y: p.y, k: k, tipX: p.x + nx * k * scale, tipY: p.y + ny * k * scale });
      }
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* MaxRects sprite atlas packer                                        */
  /* ------------------------------------------------------------------ */

  function nextPowerOfTwo(n) {
    var v = 1;
    while (v < n) { v *= 2; }
    return v;
  }

  function intersects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function contains(outer, inner) {
    return inner.x >= outer.x && inner.y >= outer.y &&
      inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
  }

  function MaxRectsBin(width, height) {
    this.width = width;
    this.height = height;
    this.free = [{ x: 0, y: 0, w: width, h: height }];
  }

  /** Best Short Side Fit: smallest leftover on the shorter side, long side breaks ties. */
  MaxRectsBin.prototype.findBssf = function (w, h) {
    var best = null;
    var bestShort = Infinity;
    var bestLong = Infinity;
    for (var i = 0; i < this.free.length; i += 1) {
      var f = this.free[i];
      if (f.w >= w && f.h >= h) {
        var leftW = f.w - w;
        var leftH = f.h - h;
        var shortSide = Math.min(leftW, leftH);
        var longSide = Math.max(leftW, leftH);
        if (shortSide < bestShort || (shortSide === bestShort && longSide < bestLong)) {
          best = { x: f.x, y: f.y, w: w, h: h };
          bestShort = shortSide;
          bestLong = longSide;
        }
      }
    }
    return best;
  };

  MaxRectsBin.prototype.place = function (rect) {
    var next = [];
    for (var i = 0; i < this.free.length; i += 1) {
      var f = this.free[i];
      if (!intersects(f, rect)) {
        next.push(f);
        continue;
      }
      if (rect.x > f.x) {
        next.push({ x: f.x, y: f.y, w: rect.x - f.x, h: f.h });
      }
      if (rect.x + rect.w < f.x + f.w) {
        next.push({ x: rect.x + rect.w, y: f.y, w: f.x + f.w - (rect.x + rect.w), h: f.h });
      }
      if (rect.y > f.y) {
        next.push({ x: f.x, y: f.y, w: f.w, h: rect.y - f.y });
      }
      if (rect.y + rect.h < f.y + f.h) {
        next.push({ x: f.x, y: rect.y + rect.h, w: f.w, h: f.y + f.h - (rect.y + rect.h) });
      }
    }
    this.free = pruneFreeRects(next);
  };

  function pruneFreeRects(rects) {
    var out = [];
    for (var i = 0; i < rects.length; i += 1) {
      var redundant = false;
      for (var j = 0; j < rects.length; j += 1) {
        if (i !== j && contains(rects[j], rects[i])) {
          var identical = rects[i].x === rects[j].x && rects[i].y === rects[j].y &&
            rects[i].w === rects[j].w && rects[i].h === rects[j].h;
          if (!identical || j < i) {
            redundant = true;
            break;
          }
        }
      }
      if (!redundant) { out.push(rects[i]); }
    }
    return out;
  }

  function sortFrames(frames, mode) {
    var list = frames.slice();
    if (mode === 'none') { return list; }
    list.sort(function (a, b) {
      var ka = mode === 'area' ? a.w * a.h : Math.max(a.w, a.h);
      var kb = mode === 'area' ? b.w * b.h : Math.max(b.w, b.h);
      if (kb !== ka) { return kb - ka; }
      if (b.w * b.h !== a.w * a.h) { return b.w * b.h - a.w * a.h; }
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return list;
  }

  function tryPack(sorted, width, height, extrude, padding) {
    var bin = new MaxRectsBin(width, height);
    var placements = [];
    for (var i = 0; i < sorted.length; i += 1) {
      var f = sorted[i];
      var cw = f.w + 2 * extrude + padding;
      var ch = f.h + 2 * extrude + padding;
      var spot = bin.findBssf(cw, ch);
      if (spot === null) { return null; }
      bin.place(spot);
      placements.push({
        name: f.name,
        x: spot.x + extrude,
        y: spot.y + extrude,
        w: f.w,
        h: f.h,
        cell: { x: spot.x, y: spot.y, w: cw, h: ch }
      });
    }
    return placements;
  }

  /**
   * Pack rectangular frames into the smallest atlas.
   * frames: [{ name, w, h }]. options: padding (gap kept between frames),
   * extrude (border pixels reserved around every frame), maxSize, powerOfTwo,
   * sort ('maxside', 'area' or 'none').
   * Returns { ok, width, height, placements, failed, efficiency, ... }.
   */
  function packSpriteAtlasMaxRects(frames, options) {
    var opts = options || {};
    var padding = opts.padding === undefined ? 2 : Math.max(0, Math.floor(opts.padding));
    var extrude = opts.extrude === undefined ? 1 : Math.max(0, Math.floor(opts.extrude));
    var maxSize = opts.maxSize === undefined ? 2048 : opts.maxSize;
    var powerOfTwo = opts.powerOfTwo !== false;
    var sortMode = opts.sort === undefined ? 'maxside' : opts.sort;
    var clean = frames.filter(function (f) { return f.w > 0 && f.h > 0; });
    var sorted = sortFrames(clean, sortMode);
    var frameArea = 0;
    var cellArea = 0;
    var widest = 0;
    var tallest = 0;
    sorted.forEach(function (f) {
      frameArea += f.w * f.h;
      cellArea += (f.w + 2 * extrude + padding) * (f.h + 2 * extrude + padding);
      widest = Math.max(widest, f.w + 2 * extrude + padding);
      tallest = Math.max(tallest, f.h + 2 * extrude + padding);
    });
    var result = {
      ok: false, width: 0, height: 0, placements: [], failed: [],
      frameArea: frameArea, efficiency: 0, padding: padding, extrude: extrude, powerOfTwo: powerOfTwo
    };
    if (sorted.length === 0) {
      result.ok = true;
      return result;
    }
    var placed = null;
    var width = 0;
    var height = 0;
    if (powerOfTwo) {
      var sizes = [];
      for (var w = 1; w <= maxSize; w *= 2) {
        for (var h = 1; h <= maxSize; h *= 2) {
          if (w >= widest && h >= tallest && w * h >= cellArea) { sizes.push([w, h]); }
        }
      }
      sizes.sort(function (a, b) {
        var areaDiff = a[0] * a[1] - b[0] * b[1];
        if (areaDiff !== 0) { return areaDiff; }
        return Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]);
      });
      for (var s = 0; s < sizes.length; s += 1) {
        placed = tryPack(sorted, sizes[s][0], sizes[s][1], extrude, padding);
        if (placed !== null) {
          width = sizes[s][0];
          height = sizes[s][1];
          break;
        }
      }
    } else {
      var side = Math.max(widest, tallest, Math.ceil(Math.sqrt(cellArea)));
      while (side <= maxSize && placed === null) {
        placed = tryPack(sorted, side, side, extrude, padding);
        side += Math.max(1, Math.floor(side / 32));
      }
      if (placed === null) {
        placed = tryPack(sorted, maxSize, maxSize, extrude, padding);
      }
      if (placed !== null) {
        placed.forEach(function (p) {
          width = Math.max(width, p.x + p.w + extrude);
          height = Math.max(height, p.y + p.h + extrude);
        });
      }
    }
    if (placed === null) {
      result.failed = sorted.map(function (f) { return f.name; });
      return result;
    }
    result.ok = true;
    result.width = width;
    result.height = height;
    result.placements = placed;
    result.efficiency = frameArea / (width * height);
    return result;
  }

  /** Checks that every frame sits inside the atlas and no two cells overlap. */
  function validateAtlas(atlas) {
    var problems = [];
    var list = atlas.placements;
    list.forEach(function (p) {
      var cell = p.cell;
      if (cell.x < 0 || cell.y < 0 || p.x + p.w + atlas.extrude > atlas.width ||
          p.y + p.h + atlas.extrude > atlas.height) {
        problems.push('out of bounds: ' + p.name);
      }
    });
    for (var i = 0; i < list.length; i += 1) {
      for (var j = i + 1; j < list.length; j += 1) {
        if (intersects(list[i].cell, list[j].cell)) {
          problems.push('overlap: ' + list[i].name + ' and ' + list[j].name);
        }
      }
    }
    return { ok: problems.length === 0, problems: problems };
  }

  function atlasMeta(atlas, imageName) {
    return {
      app: 'paperclip-rig',
      version: '1.0.0',
      image: imageName,
      format: 'RGBA8888',
      size: { w: atlas.width, h: atlas.height },
      scale: '1'
    };
  }

  function frameEntry(p) {
    return {
      frame: { x: p.x, y: p.y, w: p.w, h: p.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: p.w, h: p.h },
      sourceSize: { w: p.w, h: p.h }
    };
  }

  /** TexturePacker JSON (Hash) layout. */
  function exportTexturePackerHash(atlas, imageName) {
    var frames = {};
    atlas.placements.forEach(function (p) { frames[p.name] = frameEntry(p); });
    return JSON.stringify({ frames: frames, meta: atlasMeta(atlas, imageName) }, null, 2);
  }

  /** TexturePacker JSON (Array) layout. */
  function exportTexturePackerArray(atlas, imageName) {
    var frames = atlas.placements.map(function (p) {
      var e = frameEntry(p);
      e.filename = p.name;
      return e;
    });
    return JSON.stringify({ frames: frames, meta: atlasMeta(atlas, imageName) }, null, 2);
  }

  /** Phaser 3 multiatlas layout (one texture entry). */
  function exportPhaserJson(atlas, imageName) {
    var frames = atlas.placements.map(function (p) {
      var e = frameEntry(p);
      e.filename = p.name;
      return e;
    });
    return JSON.stringify({
      textures: [{
        image: imageName,
        format: 'RGBA8888',
        size: { w: atlas.width, h: atlas.height },
        scale: 1,
        frames: frames
      }],
      meta: { app: 'paperclip-rig', version: '1.0.0' }
    }, null, 2);
  }

  /** Plain region list meant for a small Godot import script. This is our own schema. */
  function exportGodotRegions(atlas, imageName) {
    return JSON.stringify({
      texture: imageName,
      size: { w: atlas.width, h: atlas.height },
      regions: atlas.placements.map(function (p) {
        return { name: p.name, region: { x: p.x, y: p.y, w: p.w, h: p.h } };
      })
    }, null, 2);
  }

  function cssIdent(name) {
    var id = String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (id === '' || /^[0-9]/.test(id)) { id = 's-' + id; }
    return id;
  }

  /** CSS sprite rules: one class per frame using background-position. */
  function exportCssSprites(atlas, imageUrl, prefix) {
    var pre = prefix === undefined ? 'sprite' : prefix;
    var lines = [];
    lines.push('.' + pre + ' { background-image: url("' + imageUrl + '"); background-repeat: no-repeat; image-rendering: pixelated; display: inline-block; }');
    atlas.placements.forEach(function (p) {
      lines.push('.' + pre + '-' + cssIdent(p.name) + ' { width: ' + p.w + 'px; height: ' + p.h +
        'px; background-position: -' + p.x + 'px -' + p.y + 'px; }');
    });
    return lines.join('\n') + '\n';
  }

  /** Small deterministic PRNG so sample frame sets are reproducible. */
  function seededRandom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A reproducible set of UI-kit sized rectangles for the packing demo. */
  function generateSampleFrames(count, seed, minSize, maxSize) {
    var rand = seededRandom(seed);
    var frames = [];
    for (var i = 0; i < count; i += 1) {
      var w = minSize + Math.floor(rand() * (maxSize - minSize + 1));
      var h = minSize + Math.floor(rand() * (maxSize - minSize + 1));
      frames.push({ name: 'frame_' + (i < 10 ? '0' : '') + i, w: w, h: h });
    }
    return frames;
  }

  /* ------------------------------------------------------------------ */
  /* Pixel grids and drawing primitives                                  */
  /* ------------------------------------------------------------------ */

  function createGrid(width, height, fill) {
    var data = new Int16Array(width * height);
    data.fill(fill === undefined ? TRANSPARENT : fill);
    return { width: width, height: height, data: data };
  }

  function cloneGrid(grid) {
    return { width: grid.width, height: grid.height, data: Int16Array.from(grid.data) };
  }

  function inBounds(grid, x, y) {
    return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
  }

  function getPixel(grid, x, y) {
    if (!inBounds(grid, x, y)) { return TRANSPARENT; }
    return grid.data[y * grid.width + x];
  }

  function setPixel(grid, x, y, index) {
    if (inBounds(grid, x, y)) { grid.data[y * grid.width + x] = index; }
  }

  /** Integer points of Bresenham's line from (x0, y0) to (x1, y1), both ends included. */
  function bresenhamLine(x0, y0, x1, y1) {
    var points = [];
    var dx = Math.abs(x1 - x0);
    var dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1;
    var sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    var x = x0;
    var y = y0;
    for (;;) {
      points.push({ x: x, y: y });
      if (x === x1 && y === y1) { break; }
      var e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return points;
  }

  function drawLine(grid, x0, y0, x1, y1, index) {
    bresenhamLine(x0, y0, x1, y1).forEach(function (p) { setPixel(grid, p.x, p.y, index); });
    return grid;
  }

  function drawRect(grid, x, y, w, h, index, filled) {
    for (var j = 0; j < h; j += 1) {
      for (var i = 0; i < w; i += 1) {
        var edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
        if (filled || edge) { setPixel(grid, x + i, y + j, index); }
      }
    }
    return grid;
  }

  /** Filled disc by distance test, deterministic and symmetric. */
  function drawDisc(grid, cx, cy, radius, index) {
    var r2 = radius * radius;
    for (var j = Math.floor(cy - radius); j <= Math.ceil(cy + radius); j += 1) {
      for (var i = Math.floor(cx - radius); i <= Math.ceil(cx + radius); i += 1) {
        var dx = i - cx;
        var dy = j - cy;
        if (dx * dx + dy * dy <= r2) { setPixel(grid, i, j, index); }
      }
    }
    return grid;
  }

  /** 4-connected queue flood fill. Returns how many cells changed. */
  function floodFillGrid(grid, x, y, newIndex) {
    if (!inBounds(grid, x, y)) { return 0; }
    var target = getPixel(grid, x, y);
    if (target === newIndex) { return 0; }
    var queue = [[x, y]];
    var head = 0;
    var filled = 0;
    setPixel(grid, x, y, newIndex);
    while (head < queue.length) {
      var cell = queue[head];
      head += 1;
      filled += 1;
      var nbrs = [[cell[0] + 1, cell[1]], [cell[0] - 1, cell[1]], [cell[0], cell[1] + 1], [cell[0], cell[1] - 1]];
      for (var k = 0; k < 4; k += 1) {
        var nx = nbrs[k][0];
        var ny = nbrs[k][1];
        if (inBounds(grid, nx, ny) && getPixel(grid, nx, ny) === target) {
          setPixel(grid, nx, ny, newIndex);
          queue.push([nx, ny]);
        }
      }
    }
    return filled;
  }

  /** Build a grid from rows of characters. charMap maps a character to an index. */
  function gridFromRows(rows, charMap) {
    var h = rows.length;
    var w = h > 0 ? rows[0].length : 0;
    var grid = createGrid(w, h, TRANSPARENT);
    rows.forEach(function (row, y) {
      if (row.length !== w) { throw new Error('row ' + y + ' has length ' + row.length + ', expected ' + w); }
      for (var x = 0; x < w; x += 1) {
        var ch = row.charAt(x);
        if (Object.prototype.hasOwnProperty.call(charMap, ch)) {
          grid.data[y * w + x] = charMap[ch];
        }
      }
    });
    return grid;
  }

  function countFilled(grid) {
    var n = 0;
    for (var i = 0; i < grid.data.length; i += 1) {
      if (grid.data[i] !== TRANSPARENT) { n += 1; }
    }
    return n;
  }

  function mirrorGridX(grid) {
    var out = createGrid(grid.width, grid.height, TRANSPARENT);
    for (var y = 0; y < grid.height; y += 1) {
      for (var x = 0; x < grid.width; x += 1) {
        out.data[y * grid.width + (grid.width - 1 - x)] = grid.data[y * grid.width + x];
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Colour: OKLab, CIE Lab, palettes                                    */
  /* ------------------------------------------------------------------ */

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) { h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); }
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(rgb) {
    function part(v) {
      var s = clamp(Math.round(v), 0, 255).toString(16);
      return s.length === 1 ? '0' + s : s;
    }
    return '#' + part(rgb.r) + part(rgb.g) + part(rgb.b);
  }

  function srgbToLinear(c) {
    var v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function rgbToOklab(rgb) {
    var r = srgbToLinear(rgb.r);
    var g = srgbToLinear(rgb.g);
    var b = srgbToLinear(rgb.b);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return {
      L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    };
  }

  function rgbToCieLab(rgb) {
    var r = srgbToLinear(rgb.r);
    var g = srgbToLinear(rgb.g);
    var b = srgbToLinear(rgb.b);
    var x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    var y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    var z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
    return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
  }

  function labDistance(p, q) {
    return Math.sqrt((p.L - q.L) * (p.L - q.L) + (p.a - q.a) * (p.a - q.a) + (p.b - q.b) * (p.b - q.b));
  }

  function toLab(rgb, metric) {
    return metric === 'cielab' ? rgbToCieLab(rgb) : rgbToOklab(rgb);
  }

  /** Index of the palette colour closest to rgb. metric is 'oklab' (default) or 'cielab'. */
  function nearestPaletteIndex(rgb, paletteHex, metric) {
    var target = toLab(rgb, metric);
    var best = 0;
    var bestDist = Infinity;
    paletteHex.forEach(function (hex, i) {
      var dist = labDistance(target, toLab(hexToRgb(hex), metric));
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  /** Quantise RGBA pixels to a palette. Alpha under 128 becomes transparent. */
  function quantizeRgbaToPalette(rgba, width, height, paletteHex, metric) {
    var grid = createGrid(width, height, TRANSPARENT);
    var cache = {};
    for (var i = 0; i < width * height; i += 1) {
      var o = i * 4;
      if (rgba[o + 3] < 128) { continue; }
      var key = rgba[o] + ',' + rgba[o + 1] + ',' + rgba[o + 2];
      if (cache[key] === undefined) {
        cache[key] = nearestPaletteIndex({ r: rgba[o], g: rgba[o + 1], b: rgba[o + 2] }, paletteHex, metric);
      }
      grid.data[i] = cache[key];
    }
    return grid;
  }

  var PALETTES = [
    { id: 'archival', name: 'Archival ink', colors: ['#161615', '#4a463e', '#c84b31', '#d9cdb4', '#f8f5ee'] },
    { id: 'botanical', name: 'Botanical plate', colors: ['#1d2b1f', '#24594c', '#5c8a5b', '#a9c28a', '#eef0d6'] },
    { id: 'riso', name: 'Risograph trio', colors: ['#1e2a5a', '#0078bf', '#ff48b0', '#ffe800', '#f5f0e1'] },
    { id: 'dmg', name: 'Game Boy DMG', colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
    {
      id: 'pico8',
      name: 'Pico-8',
      colors: [
        '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
        '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'
      ]
    },
    { id: 'blueprint', name: 'Blueprint', colors: ['#0b2545', '#13315c', '#1f5aa6', '#8da9c4', '#eef4ed'] }
  ];

  function getPalette(id) {
    for (var i = 0; i < PALETTES.length; i += 1) {
      if (PALETTES[i].id === id) { return PALETTES[i]; }
    }
    return null;
  }

  /** Palette indexes ordered from darkest to lightest by OKLab lightness. */
  function lightnessOrder(paletteHex) {
    var order = paletteHex.map(function (hex, i) {
      return { i: i, L: rgbToOklab(hexToRgb(hex)).L };
    });
    order.sort(function (a, b) { return a.L - b.L || a.i - b.i; });
    return order.map(function (o) { return o.i; });
  }

  /**
   * Remap an indexed grid from one palette to another by lightness rank:
   * the darkest source colour maps to the darkest target, the lightest to the
   * lightest, and the ranks in between are spread evenly.
   * Returns { grid, mapping } where mapping[oldIndex] is the new index.
   */
  function remapIndexedPalette(grid, srcPaletteHex, dstPaletteHex) {
    var srcOrder = lightnessOrder(srcPaletteHex);
    var dstOrder = lightnessOrder(dstPaletteHex);
    var n = srcOrder.length;
    var m = dstOrder.length;
    var mapping = new Array(n);
    srcOrder.forEach(function (srcIndex, rank) {
      var dstRank = n === 1 ? 0 : Math.round((rank * (m - 1)) / (n - 1));
      mapping[srcIndex] = dstOrder[dstRank];
    });
    var out = createGrid(grid.width, grid.height, TRANSPARENT);
    for (var i = 0; i < grid.data.length; i += 1) {
      var v = grid.data[i];
      out.data[i] = v === TRANSPARENT ? TRANSPARENT : mapping[v];
    }
    return { grid: out, mapping: mapping };
  }

  /** Colours for tone indexes 0..toneCount minus one, taken from a target palette by lightness rank. */
  function toneColors(toneCount, dstPaletteHex) {
    var m = dstPaletteHex.length;
    var order = lightnessOrder(dstPaletteHex);
    var out = [];
    for (var t = 0; t < toneCount; t += 1) {
      var rank = toneCount === 1 ? 0 : Math.round((t * (m - 1)) / (toneCount - 1));
      out.push(dstPaletteHex[order[rank]]);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Frames, onion skin, export                                          */
  /* ------------------------------------------------------------------ */

  /** Which layers to draw for onion skinning, nearest neighbours strongest. */
  function onionLayers(frameCount, current, options) {
    var opts = options || {};
    var before = opts.before === undefined ? 1 : opts.before;
    var after = opts.after === undefined ? 1 : opts.after;
    var layers = [];
    for (var b = before; b >= 1; b -= 1) {
      layers.push({ index: ((current - b) % frameCount + frameCount) % frameCount, alpha: 0.38 / b, side: 'before' });
    }
    for (var a = 1; a <= after; a += 1) {
      layers.push({ index: (current + a) % frameCount, alpha: 0.38 / a, side: 'after' });
    }
    return layers.filter(function (l) { return frameCount > 1 && l.index !== current; });
  }

  function animationFrameIndex(elapsedMs, fps, frameCount) {
    if (frameCount < 1) { return 0; }
    /* A requestAnimationFrame timestamp marks the start of the frame, so it can
       be a few milliseconds earlier than the performance.now() taken when play
       began. A negative elapsed time would give index -1 and an undefined frame. */
    var ms = elapsedMs > 0 ? elapsedMs : 0;
    return Math.floor((ms / 1000) * fps) % frameCount;
  }

  /** Expand an indexed grid to RGBA bytes at an integer scale. */
  function gridToRgba(grid, colorsHex, scale) {
    var s = scale === undefined ? 1 : scale;
    var w = grid.width * s;
    var h = grid.height * s;
    var out = new Uint8ClampedArray(w * h * 4);
    var rgb = colorsHex.map(hexToRgb);
    for (var y = 0; y < h; y += 1) {
      for (var x = 0; x < w; x += 1) {
        var v = grid.data[Math.floor(y / s) * grid.width + Math.floor(x / s)];
        if (v === TRANSPARENT || rgb[v] === undefined) { continue; }
        var o = (y * w + x) * 4;
        out[o] = rgb[v].r;
        out[o + 1] = rgb[v].g;
        out[o + 2] = rgb[v].b;
        out[o + 3] = 255;
      }
    }
    return { width: w, height: h, data: out };
  }

  /**
   * Paint an atlas into one indexed grid. Frames come from gridsByName; a frame
   * with no grid is filled with fillIndex(i). The extrude border repeats the
   * outermost pixels of the frame, which is what stops texture bleeding.
   */
  function buildAtlasGrid(atlas, gridsByName, fillIndex) {
    var out = createGrid(atlas.width, atlas.height, TRANSPARENT);
    atlas.placements.forEach(function (p, i) {
      var src = gridsByName[p.name];
      var e = atlas.extrude;
      for (var y = -e; y < p.h + e; y += 1) {
        for (var x = -e; x < p.w + e; x += 1) {
          var sx = clamp(x, 0, p.w - 1);
          var sy = clamp(y, 0, p.h - 1);
          var value = src ? src.data[sy * src.width + sx] : fillIndex(i);
          setPixel(out, p.x + x, p.y + y, value);
        }
      }
    });
    return out;
  }

  /** Lay frames out in a grid of columns, returning one indexed grid. */
  function buildSpriteSheetGrid(frames, columns) {
    var cols = Math.max(1, Math.min(columns, frames.length));
    var rows = Math.ceil(frames.length / cols);
    var fw = frames[0].width;
    var fh = frames[0].height;
    var sheet = createGrid(fw * cols, fh * rows, TRANSPARENT);
    frames.forEach(function (f, i) {
      var ox = (i % cols) * fw;
      var oy = Math.floor(i / cols) * fh;
      for (var y = 0; y < fh; y += 1) {
        for (var x = 0; x < fw; x += 1) {
          sheet.data[(oy + y) * sheet.width + ox + x] = f.data[y * fw + x];
        }
      }
    });
    return sheet;
  }

  var crcTable = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n += 1) {
      var c = n;
      for (var k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  }());

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i += 1) {
      c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function adler32(bytes) {
    var a = 1;
    var b = 0;
    for (var i = 0; i < bytes.length; i += 1) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  function writeUint32(arr, offset, value) {
    arr[offset] = (value >>> 24) & 255;
    arr[offset + 1] = (value >>> 16) & 255;
    arr[offset + 2] = (value >>> 8) & 255;
    arr[offset + 3] = value & 255;
  }

  function pngChunk(type, data) {
    var out = new Uint8Array(12 + data.length);
    writeUint32(out, 0, data.length);
    for (var i = 0; i < 4; i += 1) { out[4 + i] = type.charCodeAt(i); }
    out.set(data, 8);
    writeUint32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  /**
   * Encode RGBA pixels as a PNG using stored (uncompressed) deflate blocks.
   * Files are larger than a compressing encoder would make, but the output is
   * byte-for-byte reproducible and needs no library in the browser or Node.
   */
  function encodePngRgba(width, height, rgba) {
    var stride = width * 4 + 1;
    var raw = new Uint8Array(stride * height);
    for (var y = 0; y < height; y += 1) {
      raw[y * stride] = 0;
      for (var x = 0; x < width * 4; x += 1) {
        raw[y * stride + 1 + x] = rgba[y * width * 4 + x];
      }
    }
    var blocks = Math.max(1, Math.ceil(raw.length / 65535));
    var z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
    var p = 0;
    z[p] = 0x78;
    z[p + 1] = 0x01;
    p += 2;
    for (var b = 0; b < blocks; b += 1) {
      var start = b * 65535;
      var len = Math.min(65535, raw.length - start);
      var last = b === blocks - 1 ? 1 : 0;
      z[p] = last;
      z[p + 1] = len & 255;
      z[p + 2] = (len >>> 8) & 255;
      z[p + 3] = (~len) & 255;
      z[p + 4] = ((~len) >>> 8) & 255;
      p += 5;
      z.set(raw.subarray(start, start + len), p);
      p += len;
    }
    writeUint32(z, p, adler32(raw));
    var ihdr = new Uint8Array(13);
    writeUint32(ihdr, 0, width);
    writeUint32(ihdr, 4, height);
    ihdr[8] = 8;
    ihdr[9] = 6;
    var parts = [
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', z),
      pngChunk('IEND', new Uint8Array(0))
    ];
    var total = 0;
    parts.forEach(function (part) { total += part.length; });
    var png = new Uint8Array(total);
    var at = 0;
    parts.forEach(function (part) {
      png.set(part, at);
      at += part.length;
    });
    return png;
  }

  /** Indexed grid straight to PNG bytes. */
  function gridToPng(grid, colorsHex, scale) {
    var img = gridToRgba(grid, colorsHex, scale);
    return encodePngRgba(img.width, img.height, img.data);
  }

  /** SVG for one grid. Horizontal runs of one colour merge into a single rect. */
  function gridToSvgRects(grid, colorsHex, offsetX, offsetY) {
    var out = '';
    for (var y = 0; y < grid.height; y += 1) {
      var x = 0;
      while (x < grid.width) {
        var v = grid.data[y * grid.width + x];
        if (v === TRANSPARENT) {
          x += 1;
          continue;
        }
        var run = 1;
        while (x + run < grid.width && grid.data[y * grid.width + x + run] === v) { run += 1; }
        out += '<rect x="' + (offsetX + x) + '" y="' + (offsetY + y) + '" width="' + run +
          '" height="1" fill="' + colorsHex[v] + '"/>';
        x += run;
      }
    }
    return out;
  }

  /** A sprite sheet as one SVG, frames in a grid of columns. */
  function exportSpriteSheetSvg(frames, colorsHex, options) {
    var opts = options || {};
    var scale = opts.scale === undefined ? 8 : opts.scale;
    var cols = Math.max(1, Math.min(opts.columns === undefined ? frames.length : opts.columns, frames.length));
    var rows = Math.ceil(frames.length / cols);
    var fw = frames[0].width;
    var fh = frames[0].height;
    var body = '';
    frames.forEach(function (f, i) {
      body += gridToSvgRects(f, colorsHex, (i % cols) * fw, Math.floor(i / cols) * fh);
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (fw * cols) + ' ' + (fh * rows) +
      '" width="' + (fw * cols * scale) + '" height="' + (fh * rows * scale) +
      '" shape-rendering="crispEdges">' + body + '</svg>';
  }

  return {
    version: '1.0.0',
    TRANSPARENT: TRANSPARENT,
    PALETTES: PALETTES,
    clamp: clamp,
    lerp: lerp,
    evaluateCubicBezier: evaluateCubicBezier,
    splitCubicBezier: splitCubicBezier,
    cubicFirstDerivative: cubicFirstDerivative,
    cubicSecondDerivative: cubicSecondDerivative,
    curvatureAtCubic: curvatureAtCubic,
    flattenCubicBezier: flattenCubicBezier,
    cubicBoundingBox: cubicBoundingBox,
    polylineBoundingBox: polylineBoundingBox,
    polylineLength: polylineLength,
    perpendicularDistance: perpendicularDistance,
    simplifyPolylineRdp: simplifyPolylineRdp,
    simplifyClosedPolylineRdp: simplifyClosedPolylineRdp,
    polylineDeviation: polylineDeviation,
    parseSvgPath: parseSvgPath,
    flattenSvgPath: flattenSvgPath,
    computeSvgPathLength: computeSvgPathLength,
    formatNumber: formatNumber,
    quantizeSvgCoordinates: quantizeSvgCoordinates,
    utf8ByteLength: utf8ByteLength,
    countPathNodes: countPathNodes,
    pathStats: pathStats,
    pathDataToNodes: pathDataToNodes,
    nodesToPathData: nodesToPathData,
    nodesToSegments: nodesToSegments,
    flattenNodes: flattenNodes,
    nodesBoundingBox: nodesBoundingBox,
    moveNode: moveNode,
    moveHandle: moveHandle,
    fitSmoothNodes: fitSmoothNodes,
    optimizeContour: optimizeContour,
    polylineToPathData: polylineToPathData,
    curvatureComb: curvatureComb,
    nextPowerOfTwo: nextPowerOfTwo,
    MaxRectsBin: MaxRectsBin,
    pruneFreeRects: pruneFreeRects,
    packSpriteAtlasMaxRects: packSpriteAtlasMaxRects,
    validateAtlas: validateAtlas,
    exportTexturePackerHash: exportTexturePackerHash,
    exportTexturePackerArray: exportTexturePackerArray,
    exportPhaserJson: exportPhaserJson,
    exportGodotRegions: exportGodotRegions,
    exportCssSprites: exportCssSprites,
    seededRandom: seededRandom,
    generateSampleFrames: generateSampleFrames,
    createGrid: createGrid,
    cloneGrid: cloneGrid,
    getPixel: getPixel,
    setPixel: setPixel,
    bresenhamLine: bresenhamLine,
    drawLine: drawLine,
    drawRect: drawRect,
    drawDisc: drawDisc,
    floodFillGrid: floodFillGrid,
    gridFromRows: gridFromRows,
    countFilled: countFilled,
    mirrorGridX: mirrorGridX,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    rgbToOklab: rgbToOklab,
    rgbToCieLab: rgbToCieLab,
    nearestPaletteIndex: nearestPaletteIndex,
    quantizeRgbaToPalette: quantizeRgbaToPalette,
    getPalette: getPalette,
    lightnessOrder: lightnessOrder,
    remapIndexedPalette: remapIndexedPalette,
    toneColors: toneColors,
    onionLayers: onionLayers,
    animationFrameIndex: animationFrameIndex,
    gridToRgba: gridToRgba,
    buildSpriteSheetGrid: buildSpriteSheetGrid,
    buildAtlasGrid: buildAtlasGrid,
    crc32: crc32,
    adler32: adler32,
    encodePngRgba: encodePngRgba,
    gridToPng: gridToPng,
    exportSpriteSheetSvg: exportSpriteSheetSvg
  };
}));
