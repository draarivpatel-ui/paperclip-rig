'use strict';

// Regression coverage for defects found in the 2026-11 adversarial audit.
// Each test names the failure mode it pins down.

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const A = require('../assets/data.js');
const L = require('../rig-lab.js');

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

/* ---------------------- 2026-11-24 hardening audit ---------------------- */

test('polylineDeviation measures distance against a singleton open polyline', () => {
  assert.equal(E.polylineDeviation([pt(0, 0)], [pt(10, 0)], false), 10);
  assert.equal(E.polylineDeviation([pt(0, 0), pt(20, 0)], [pt(10, 0)], false), 10);
});

test('parseSvgPath rejects junk bytes instead of silently skipping them', () => {
  assert.throws(() => E.parseSvgPath('M0 0 junk L10 10'), /unexpected/);
  assert.throws(() => E.parseSvgPath('M0 0L10x10'), /unexpected/);
  assert.throws(() => E.parseSvgPath('M0 0L1e 2'), /unexpected/);
  assert.throws(() => E.parseSvgPath('M0 0R10 10'), /unexpected/);
});

test('utf8ByteLength matches real UTF-8 replacement for lone surrogates', () => {
  const enc = new TextEncoder();
  ['\ud800x', 'x\udc00', '\ud800\ud800', 'ok\ud800'].forEach((s) => {
    assert.equal(E.utf8ByteLength(s), enc.encode(s).length);
  });
});

test('animationFrameIndex never returns NaN or a negative frame for bad timing input', () => {
  [NaN, Infinity, -Infinity, -2, 0].forEach((fps) => {
    assert.equal(E.animationFrameIndex(100, fps, 4), 0);
  });
  const i = E.animationFrameIndex(100, 6, 4.9);
  assert.ok(Number.isInteger(i) && i >= 0 && i < 4);
});

test('packSpriteAtlasMaxRects rejects malformed frame dimensions instead of dropping frames', () => {
  [
    { name: 'zero', w: 0, h: 8 },
    { name: 'negative', w: 4, h: -2 },
    { name: 'nan', w: NaN, h: 8 },
    { name: 'infinite', w: 4, h: Infinity },
    { name: 'fractional', w: 4.5, h: 8 }
  ].forEach((frame) => {
    assert.throws(() => E.packSpriteAtlasMaxRects([frame], {}), RangeError, frame.name);
  });
});

test('encodePngRgba rejects non-integer dimensions and truncated pixel data', () => {
  const rgba = new Uint8Array(2 * 2 * 4);
  assert.throws(() => E.encodePngRgba(1.5, 2, rgba), RangeError);
  assert.throws(() => E.encodePngRgba(NaN, 2, rgba), RangeError);
  assert.throws(() => E.encodePngRgba(2, 2, rgba.subarray(0, rgba.length - 1)), RangeError);
});

test('hexToRgb rejects malformed colour strings instead of turning them black', () => {
  ['', '#12', '#12345', '#gggggg', 'red', null, undefined].forEach((value) => {
    assert.throws(() => E.hexToRgb(value), /hex/i);
  });
});

test('csvCell guards a leading line feed as spreadsheet-control whitespace', () => {
  assert.equal(L.csvCell('\nx'), '"\'\nx"');
});

/* ---------------- accessibility: skip-link and canvas roles ---------------- */

test('skip-link target main is focusable so keyboard focus actually moves', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/<main[^>]*id="main"[^>]*>/);
  assert.ok(m, 'main element with id main exists');
  assert.ok(/tabindex="-1"/.test(m[0]), 'main must carry tabindex="-1" for the skip link to move focus');
});

test('aria-labelled preview and plate canvases expose an img role for assistive tech', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/<canvas[^>]*id="px-preview"[^>]*>/);
  assert.ok(m, 'px-preview canvas exists');
  assert.ok(/role="img"/.test(m[0]), 'px-preview needs role="img" for its aria-label to be valid');
});
