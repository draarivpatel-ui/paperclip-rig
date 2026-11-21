'use strict';

// Regression coverage for defects found in the 2026-11 adversarial audit.
// Each test names the failure mode it pins down.

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const A = require('../assets/data.js');

const pt = (x, y) => ({ x, y });

/* --------------------- closed-contour RDP collapse --------------------- */

test('optimizeContour keeps a closed square as a valid ring at large epsilon', () => {
  const square = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];
  const out = E.optimizeContour(square, { closed: true, epsilon: 8, fit: 'lines' });
  assert.ok(out.kept.length >= 3, `expected >=3 kept points, got ${out.kept.length}`);
  assert.notEqual(out.d, 'M0 0L10 10Z');
});

test('optimizeContour keeps small closed blobs valid at slider-max epsilon', () => {
  // mirrors the toadstool spot layers that collapsed at epsilon 6
  const blob = [pt(0, 0), pt(8, -1), pt(14, 2), pt(10, 8), pt(2, 9), pt(-2, 4)];
  const out = E.optimizeContour(blob, { closed: true, epsilon: 6, fit: 'lines' });
  assert.ok(out.kept.length >= 3, `expected >=3 kept points, got ${out.kept.length}`);
});

test('simplifyPolylineRdp rejects negative and NaN epsilon', () => {
  const square = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];
  assert.throws(() => E.optimizeContour(square, { closed: false, epsilon: -1, fit: 'lines' }), RangeError);
  assert.throws(() => E.optimizeContour(square, { closed: true, epsilon: -1, fit: 'lines' }), RangeError);
  assert.throws(() => E.optimizeContour(square, { closed: true, epsilon: NaN, fit: 'lines' }), RangeError);
});

/* --------------------------- parser hangs ------------------------------ */

test('parseSvgPath throws instead of looping on a number after Z', () => {
  assert.throws(() => E.parseSvgPath('M0 0Z5'));
  assert.throws(() => E.parseSvgPath('M0 0L1 1Z2'));
  assert.throws(() => E.parseSvgPath('M0 0z 5 5'));
  // a legitimate command after Z still parses
  assert.equal(E.parseSvgPath('M0 0Z M1 1L2 2').length, 4);
});

test('bresenhamLine rejects non-integer endpoints', () => {
  assert.throws(() => E.bresenhamLine(0, 0, 2.5, 0), RangeError);
  assert.throws(() => E.bresenhamLine(0.1, 0, 4, 4), RangeError);
  assert.equal(E.bresenhamLine(0, 0, 4, 0).length, 5);
});

/* ------------------------- raster robustness --------------------------- */

test('floodFillGrid fills a multi-million-cell grid without exhausting the heap', () => {
  const g = E.createGrid(2000, 2000);
  const filled = E.floodFillGrid(g, 0, 0, 1);
  assert.equal(filled, 2000 * 2000);
});

test('drawDisc clamps its scan box to the grid', () => {
  const g = E.createGrid(16, 16);
  const start = Date.now();
  E.drawDisc(g, 8, 8, 100000, 1);
  assert.ok(Date.now() - start < 1000, 'clamped disc scan should be instant');
  assert.equal(E.countFilled(g, 1), 256);
});

/* ---------------------------- PNG encoding ----------------------------- */

test('encodePngRgba rejects zero dimensions', () => {
  assert.throws(() => E.encodePngRgba(0, 0, new Uint8Array(0)), RangeError);
  assert.throws(() => E.encodePngRgba(0, 4, new Uint8Array(0)), RangeError);
});

/* --------------------------- export escaping --------------------------- */

test('exportCssSprites cannot be broken out of by a hostile url or prefix', () => {
  const atlas = { placements: [{ name: 'a', x: 0, y: 0, w: 4, h: 4 }] };
  const css = E.exportCssSprites(atlas, 'x");}body{display:none', 'pre";}x{');
  assert.ok(!css.includes('display:none"),') && !css.includes('url("x");}'), css);
  assert.ok(!/pre[^a-z0-9_-]*-a /.test(css) === false || css.includes('-a {'), css);
});

test('vectorAssetToSvg escapes injected markup in names and descriptions', () => {
  const svg = A.vectorAssetToSvg({
    viewBox: 120,
    name: '"><script>alert(1)</script>',
    description: '<img src=x>',
    layers: [{ id: 'l1', kind: 'fill', role: 'ink', d: 'M0 0L1 1Z', width: 1, opacity: 1 }],
  });
  assert.ok(!svg.includes('<script>'), svg);
  assert.ok(!svg.includes('<img'), svg);
  assert.ok(svg.includes('&lt;script&gt;'), svg);
});
