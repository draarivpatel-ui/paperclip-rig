/*
 * Paperclip Vector & Sprite Rig: the 18 sample assets.
 *
 * Ten layered vector assets and eight pixel assets. They are authored in
 * code: vector outlines are lists of anchor points that the engine fits with
 * cubic Beziers, and pixel sprites are drawn with the engine's own primitives
 * (Bresenham lines, discs, rectangles). They are test fixtures and starting
 * points for the editors. They are not hand-drawn art; see NOTES.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../engine.js'));
  } else {
    root.PaperclipAssets = factory(root.PaperclipEngine);
  }
}(this, function (E) {
  'use strict';

  var ROLE_HEX = {
    ink: '#161615',
    vermilion: '#C84B31',
    viridian: '#24594C',
    ultramarine: '#2B4C7E',
    paper: '#F8F5EE',
    tray: '#EFEAE0'
  };

  var VIEWBOX = 120;
  var TONES = 5;

  /* ------------------------------ vector -------------------------------- */

  function ellipse(cx, cy, rx, ry, n) {
    var pts = [];
    for (var i = 0; i < n; i += 1) {
      var a = (i / n) * Math.PI * 2;
      pts.push([round2(cx + Math.cos(a) * rx), round2(cy + Math.sin(a) * ry)]);
    }
    return pts;
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function fill(id, label, role, points, extra) {
    return Object.assign({ id: id, label: label, kind: 'fill', role: role, points: points, corner: 50 }, extra || {});
  }

  function stroke(id, label, role, points, width, extra) {
    return Object.assign({ id: id, label: label, kind: 'stroke', role: role, points: points, width: width, corner: 60 }, extra || {});
  }

  function shadowOf(layer) {
    return Object.assign({}, layer, {
      id: layer.id + '-shadow',
      label: layer.label + ' shadow',
      role: 'shadow',
      dx: 3,
      dy: 4,
      outline: false
    });
  }

  function withShadow(layer) {
    return [shadowOf(layer), layer];
  }

  function starPoints(cx, cy) {
    var pts = [];
    for (var i = 0; i < 16; i += 1) {
      var angle = -Math.PI / 2 + (i / 16) * Math.PI * 2;
      var r;
      if (i % 4 === 0) { r = 52; } else if (i % 2 === 0) { r = 34; } else { r = 12; }
      pts.push([round2(cx + Math.cos(angle) * r), round2(cy + Math.sin(angle) * r)]);
    }
    return pts;
  }

  function scallopPoints() {
    var pts = [[60, 104]];
    var peaks = 7;
    for (var i = 0; i <= peaks * 2; i += 1) {
      var t = i / (peaks * 2);
      var angle = Math.PI * (1.08 + t * 0.84);
      var r = i % 2 === 0 ? 62 : 52;
      pts.push([round2(60 + Math.cos(angle) * r), round2(98 + Math.sin(angle) * r)]);
    }
    return pts;
  }

  function ribs() {
    var out = [];
    for (var i = 0; i <= 6; i += 1) {
      var t = (i * 2 + 1) / 14;
      var angle = Math.PI * (1.08 + t * 0.84);
      out.push(stroke('rib-' + i, 'Rib ' + (i + 1), 'paper',
        [[60, 100], [round2(60 + Math.cos(angle) * 54), round2(98 + Math.sin(angle) * 54)]], 1.4, { opacity: 0.7 }));
    }
    return out;
  }

  var VECTOR_SPECS = [
    {
      id: 'ginkgo-leaf', name: 'Ginkgo leaf',
      description: 'A fan shaped leaf with a notch, a stem and three ink veins.',
      layers: [].concat(
        withShadow(fill('blade', 'Blade', 'viridian', [[60, 106], [40, 78], [22, 50], [30, 26], [48, 20], [60, 34], [72, 20], [90, 26], [98, 50], [80, 78]], { outline: true, corner: 62 })),
        [
          stroke('vein-mid', 'Middle vein', 'ink', [[60, 102], [60, 60], [60, 38]], 1.6, { opacity: 0.8 }),
          stroke('vein-left', 'Left vein', 'ink', [[60, 102], [44, 66], [32, 38]], 1.6, { opacity: 0.8 }),
          stroke('vein-right', 'Right vein', 'ink', [[60, 102], [76, 66], [90, 38]], 1.6, { opacity: 0.8 }),
          stroke('stem', 'Stem', 'ink', [[60, 106], [60, 116]], 3)
        ])
    },
    {
      id: 'acorn', name: 'Acorn',
      description: 'An acorn with a dark cap, a vermilion nut and a short stalk.',
      layers: [].concat(
        withShadow(fill('nut', 'Nut', 'vermilion', [[60, 104], [44, 92], [36, 72], [38, 56], [60, 50], [82, 56], [84, 72], [76, 92]], { outline: true, corner: 62 })),
        [
          fill('cap', 'Cap', 'ink', [[32, 54], [34, 38], [46, 28], [60, 26], [74, 28], [86, 38], [88, 54], [74, 58], [60, 60], [46, 58]], { corner: 70 }),
          stroke('stalk', 'Stalk', 'ink', [[60, 26], [62, 14], [70, 10]], 4),
          stroke('shine', 'Highlight', 'paper', [[46, 64], [46, 78]], 2.4, { opacity: 0.6 })
        ])
    },
    {
      id: 'paperclip', name: 'Paperclip',
      description: 'A wire paperclip drawn as one ink stroke with a soft offset shadow.',
      layers: [].concat(
        [shadowOf(stroke('wire', 'Wire', 'ink', [[60, 34], [60, 84], [50, 96], [40, 84], [40, 26], [52, 12], [68, 12], [80, 26], [80, 92], [66, 108], [52, 108]], 5, { corner: 90 }))],
        [stroke('wire', 'Wire', 'ink', [[60, 34], [60, 84], [50, 96], [40, 84], [40, 26], [52, 12], [68, 12], [80, 26], [80, 92], [66, 108], [52, 108]], 5, { corner: 90 })])
    },
    {
      id: 'toadstool', name: 'Toadstool',
      description: 'A vermilion cap with paper spots on a pale stem.',
      layers: [].concat(
        withShadow(fill('stem', 'Stem', 'paper', [[46, 76], [44, 94], [40, 106], [80, 106], [76, 94], [74, 76]], { outline: true, corner: 40 })),
        [
          fill('cap', 'Cap', 'vermilion', [[18, 70], [22, 50], [36, 34], [60, 26], [84, 34], [98, 50], [102, 70], [80, 76], [60, 78], [40, 76]], { outline: true, corner: 75 }),
          fill('spot-a', 'Spot A', 'paper', ellipse(44, 50, 7, 5, 8), { corner: 180 }),
          fill('spot-b', 'Spot B', 'paper', ellipse(68, 42, 8, 6, 8), { corner: 180 }),
          fill('spot-c', 'Spot C', 'paper', ellipse(84, 58, 5, 4, 8), { corner: 180 }),
          fill('spot-d', 'Spot D', 'paper', ellipse(56, 62, 5, 3.6, 8), { corner: 180 })
        ])
    },
    {
      id: 'skeleton-key', name: 'Skeleton key',
      description: 'An ultramarine key with a round bow and two teeth.',
      layers: [].concat(
        [shadowOf(stroke('shaft', 'Shaft', 'ultramarine', [[56, 56], [100, 100]], 8, { corner: 90 }))],
        [
          stroke('shaft', 'Shaft', 'ultramarine', [[56, 56], [100, 100]], 8, { corner: 90 }),
          stroke('tooth-a', 'Tooth A', 'ultramarine', [[84, 84], [96, 72]], 6, { corner: 90 }),
          stroke('tooth-b', 'Tooth B', 'ultramarine', [[94, 94], [106, 82]], 6, { corner: 90 }),
          fill('bow', 'Bow', 'ultramarine', ellipse(40, 40, 24, 24, 10), { outline: true, corner: 180 }),
          fill('hole', 'Hole', 'tray', ellipse(40, 40, 11, 11, 8), { outline: true, corner: 180 })
        ])
    },
    {
      id: 'compass-rose', name: 'Compass rose',
      description: 'An eight point ultramarine star inside a thin ring with a vermilion north needle.',
      layers: [
        stroke('ring', 'Ring', 'ink', ellipse(60, 60, 57, 57, 10), 1.6, { closed: true, corner: 180 }),
        fill('star', 'Star', 'ultramarine', starPoints(60, 60), { outline: true, corner: 25 }),
        fill('needle', 'North needle', 'vermilion', [[60, 8], [67, 58], [53, 58]], { corner: 40 }),
        fill('hub', 'Hub', 'paper', ellipse(60, 60, 5, 5, 6), { outline: true, corner: 180 })
      ]
    },
    {
      id: 'lantern', name: 'Lantern',
      description: 'A glass lantern with an ink frame, a paper flame and a carry handle.',
      layers: [].concat(
        withShadow(fill('glass', 'Glass', 'vermilion', [[38, 40], [82, 40], [90, 78], [84, 98], [36, 98], [30, 78]], { outline: true, corner: 30 })),
        [
          fill('flame', 'Flame', 'paper', [[60, 52], [68, 66], [66, 80], [60, 86], [54, 80], [52, 66]], { corner: 40 }),
          stroke('bar-left', 'Left bar', 'ink', [[48, 40], [46, 98]], 2.2),
          stroke('bar-right', 'Right bar', 'ink', [[72, 40], [74, 98]], 2.2),
          fill('base', 'Base', 'ink', [[32, 98], [88, 98], [84, 108], [36, 108]], { corner: 30 }),
          fill('cap', 'Cap', 'ink', [[34, 40], [86, 40], [78, 30], [42, 30]], { corner: 30 }),
          stroke('handle', 'Handle', 'ink', [[44, 30], [60, 10], [76, 30]], 3, { corner: 120 })
        ])
    },
    {
      id: 'scallop-shell', name: 'Scallop shell',
      description: 'A fan shell with seven scalloped lobes and pale ribs.',
      layers: [].concat(
        withShadow(fill('shell', 'Shell', 'vermilion', scallopPoints(), { outline: true, corner: 35 })),
        ribs())
    },
    {
      id: 'potion-flask', name: 'Potion flask',
      description: 'A round ultramarine flask with a viridian liquid line and a vermilion cork.',
      layers: [].concat(
        withShadow(fill('flask', 'Flask', 'ultramarine', [[52, 18], [68, 18], [68, 40], [88, 72], [86, 96], [60, 106], [34, 96], [32, 72], [52, 40]], { outline: true, corner: 55 })),
        [
          fill('liquid', 'Liquid', 'viridian', [[36, 78], [48, 72], [60, 78], [74, 72], [86, 78], [84, 96], [60, 104], [36, 96]], { corner: 70 }),
          fill('cork', 'Cork', 'vermilion', [[49, 10], [71, 10], [69, 20], [51, 20]], { outline: true, corner: 30 }),
          fill('bubble-a', 'Bubble A', 'paper', ellipse(52, 88, 3.4, 3.4, 6), { corner: 180, opacity: 0.8 }),
          fill('bubble-b', 'Bubble B', 'paper', ellipse(68, 92, 2.4, 2.4, 6), { corner: 180, opacity: 0.8 })
        ])
    },
    {
      id: 'quill-feather', name: 'Quill feather',
      description: 'An ultramarine feather vane on an ink quill with pale barbs.',
      layers: [].concat(
        withShadow(fill('vane', 'Vane', 'ultramarine', [[30, 106], [26, 78], [34, 48], [56, 24], [86, 12], [84, 40], [76, 68], [58, 90], [40, 100]], { outline: true, corner: 62 })),
        [
          stroke('quill', 'Quill', 'ink', [[28, 112], [46, 76], [66, 44], [86, 12]], 2.4, { corner: 120 }),
          stroke('barb-a', 'Barb A', 'paper', [[44, 78], [34, 58]], 1.4, { opacity: 0.6 }),
          stroke('barb-b', 'Barb B', 'paper', [[56, 60], [48, 40]], 1.4, { opacity: 0.6 }),
          stroke('barb-c', 'Barb C', 'paper', [[68, 44], [66, 24]], 1.4, { opacity: 0.6 })
        ])
    }
  ];

  function layerPoints(spec) {
    return spec.points.map(function (p) { return { x: p[0] + (spec.dx || 0), y: p[1] + (spec.dy || 0) }; });
  }

  function buildLayer(spec) {
    var closed = spec.closed === undefined ? spec.kind === 'fill' : spec.closed;
    var nodes = E.fitSmoothNodes(layerPoints(spec), { closed: closed, cornerAngle: spec.corner });
    return {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      role: spec.role,
      width: spec.width,
      opacity: spec.opacity,
      outline: spec.outline === true,
      closed: closed,
      d: E.nodesToPathData(nodes, closed, 2)
    };
  }

  function buildVectorAsset(spec) {
    return {
      type: 'vector',
      id: spec.id,
      name: spec.name,
      description: spec.description,
      viewBox: VIEWBOX,
      layers: spec.layers.map(buildLayer)
    };
  }

  function hexFor(layer) {
    return layer.role === 'shadow' ? ROLE_HEX.ink : ROLE_HEX[layer.role];
  }

  /** A standalone SVG file for one vector asset, using concrete hex colours. */
  function vectorAssetToSvg(asset) {
    var body = asset.layers.map(function (l) {
      var op = l.role === 'shadow' ? 0.14 : l.opacity;
      var attrs = ' d="' + l.d + '"';
      if (l.kind === 'stroke') {
        attrs += ' fill="none" stroke="' + hexFor(l) + '" stroke-width="' + l.width + '" stroke-linecap="round" stroke-linejoin="round"';
      } else {
        attrs += ' fill="' + hexFor(l) + '"';
        if (l.outline) { attrs += ' stroke="' + ROLE_HEX.ink + '" stroke-width="1.6" stroke-linejoin="round"'; }
      }
      if (op !== undefined) { attrs += ' opacity="' + op + '"'; }
      return '  <path id="' + l.id + '"' + attrs + '/>';
    }).join('\n');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + asset.viewBox + ' ' + asset.viewBox +
      '" width="240" height="240" role="img" aria-label="' + asset.name + '">\n  <title>' + asset.name +
      '</title>\n  <desc>' + asset.description + '</desc>\n' + body + '\n</svg>\n';
  }

  /* ------------------------------- pixel -------------------------------- */

  function heartFrames() {
    var rows = [
      '................',
      '................',
      '..0000....0000..',
      '.011110..011110.',
      '.01222100122210.',
      '.01232222222210.',
      '.01222222222210.',
      '.01222222222210.',
      '..012222222210..',
      '...0122222210...',
      '....01222210....',
      '.....012210.....',
      '......0110......',
      '.......00.......',
      '................',
      '................'
    ];
    var map = { '0': 0, '1': 1, '2': 2, '3': 3, '4': 4 };
    return [E.gridFromRows(rows, map)];
  }

  function keyFrames() {
    var g = E.createGrid(16, 16);
    E.drawDisc(g, 5, 8, 4.4, 0);
    E.drawDisc(g, 5, 8, 3.2, 2);
    E.drawDisc(g, 5, 8, 1.4, E.TRANSPARENT);
    E.setPixel(g, 3, 6, 4);
    E.setPixel(g, 4, 5, 3);
    E.drawRect(g, 9, 7, 7, 3, 0, true);
    E.drawRect(g, 10, 8, 5, 1, 2, true);
    E.drawRect(g, 12, 10, 2, 3, 0, true);
    E.drawRect(g, 12, 10, 1, 2, 2, true);
    E.drawRect(g, 14, 10, 1, 2, 0, true);
    return [g];
  }

  function potionFrames() {
    var g = E.createGrid(16, 16);
    E.drawRect(g, 6, 3, 4, 4, 0, true);
    E.drawRect(g, 7, 3, 2, 4, 3, true);
    E.drawDisc(g, 8, 10.5, 5.2, 0);
    E.drawDisc(g, 8, 10.5, 4.2, 2);
    for (var y = 11; y < 15; y += 1) {
      for (var x = 3; x < 13; x += 1) {
        if (E.getPixel(g, x, y) === 2) { E.setPixel(g, x, y, 3); }
      }
    }
    E.drawRect(g, 6, 1, 4, 2, 0, true);
    E.drawRect(g, 7, 1, 2, 1, 1, true);
    E.setPixel(g, 5, 9, 4);
    E.setPixel(g, 6, 8, 4);
    return [g];
  }

  function chestFrames() {
    var g = E.createGrid(16, 16);
    E.drawRect(g, 2, 5, 12, 9, 0, true);
    E.drawRect(g, 3, 6, 10, 7, 2, true);
    E.drawRect(g, 3, 6, 10, 3, 3, true);
    E.drawRect(g, 3, 12, 10, 1, 1, true);
    E.drawRect(g, 3, 9, 10, 1, 0, true);
    E.drawRect(g, 7, 6, 2, 7, 1, true);
    E.drawRect(g, 7, 9, 2, 2, 4, true);
    return [g];
  }

  function mushroomFrames() {
    var g = E.createGrid(16, 16);
    E.drawDisc(g, 8, 7, 6.2, 0);
    E.drawDisc(g, 8, 7, 5.2, 2);
    for (var y = 11; y < 16; y += 1) {
      for (var x = 0; x < 16; x += 1) { E.setPixel(g, x, y, E.TRANSPARENT); }
    }
    E.drawRect(g, 3, 10, 10, 1, 0, true);
    E.drawRect(g, 6, 11, 4, 4, 0, true);
    E.drawRect(g, 7, 11, 2, 4, 4, true);
    E.setPixel(g, 5, 5, 4);
    E.setPixel(g, 9, 4, 4);
    E.setPixel(g, 11, 7, 4);
    E.setPixel(g, 4, 8, 3);
    return [g];
  }

  function blob(g, cx, baseY, halfW, h) {
    var top = baseY - h + 1;
    for (var y = top; y <= baseY; y += 1) {
      var t = h === 1 ? 1 : (y - top) / (h - 1);
      var half = Math.round(halfW * Math.sqrt(1 - (1 - t) * (1 - t)));
      for (var x = cx - half - 1; x <= cx + half + 1; x += 1) { E.setPixel(g, x, y, 0); }
    }
    for (var y2 = top + 1; y2 < baseY; y2 += 1) {
      var t2 = (y2 - top) / (h - 1);
      var half2 = Math.round(halfW * Math.sqrt(1 - (1 - t2) * (1 - t2)));
      for (var x2 = cx - half2; x2 <= cx + half2; x2 += 1) { E.setPixel(g, x2, y2, 2); }
    }
  }

  function slimeFrames() {
    var a = E.createGrid(16, 16);
    blob(a, 8, 14, 5, 10);
    E.drawRect(a, 5, 6, 2, 3, 3, true);
    E.setPixel(a, 6, 8, 0);
    E.setPixel(a, 10, 8, 0);
    E.setPixel(a, 6, 7, 4);
    var b = E.createGrid(16, 16);
    blob(b, 8, 14, 7, 7);
    E.drawRect(b, 4, 9, 2, 2, 3, true);
    E.setPixel(b, 5, 11, 0);
    E.setPixel(b, 11, 11, 0);
    E.setPixel(b, 5, 10, 4);
    return [a, b];
  }

  function walkerFrames() {
    var feet = [
      { lx: 3, rx: 12, bob: 0, armL: 2, armR: 13 },
      { lx: 6, rx: 9, bob: 1, armL: 4, armR: 11 },
      { lx: 12, rx: 3, bob: 0, armL: 13, armR: 2 },
      { lx: 9, rx: 6, bob: 1, armL: 11, armR: 4 }
    ];
    return feet.map(function (f) {
      var g = E.createGrid(16, 16);
      var b = f.bob;
      E.drawLine(g, 6, 12 + b, f.lx, 15, 0);
      E.drawLine(g, 10, 12 + b, f.rx, 15, 0);
      E.setPixel(g, f.lx, 15, 1);
      E.setPixel(g, f.rx, 15, 1);
      E.drawLine(g, 5, 9 + b, f.armL, 12 + b, 0);
      E.drawLine(g, 11, 9 + b, f.armR, 12 + b, 0);
      E.drawRect(g, 5, 7 + b, 6, 6, 0, true);
      E.drawRect(g, 6, 8 + b, 4, 4, 2, true);
      E.drawRect(g, 6, 11 + b, 4, 1, 1, true);
      E.drawDisc(g, 8, 4 + b, 3.6, 0);
      E.drawDisc(g, 8, 4 + b, 2.6, 3);
      E.drawRect(g, 5, 1 + b, 7, 2, 1, true);
      E.setPixel(g, 9, 4 + b, 0);
      E.setPixel(g, 10, 4 + b, 0);
      return g;
    });
  }

  function saplingFrames() {
    var sways = [-1, 0, 1, 0];
    return sways.map(function (sway) {
      var g = E.createGrid(32, 32);
      E.drawRect(g, 3, 28, 26, 3, 1, true);
      E.drawRect(g, 3, 28, 26, 1, 2, true);
      E.drawLine(g, 16, 28, 16 + sway, 14, 1);
      E.drawLine(g, 17, 28, 17 + sway, 14, 0);
      E.drawLine(g, 15, 28, 15 + sway, 14, 0);
      E.drawLine(g, 16 + sway, 20, 10 + sway, 15, 0);
      E.drawLine(g, 16 + sway, 22, 23 + sway, 16, 0);
      var blobs = [[16, 10, 8], [9, 14, 5.5], [23, 14, 5.5], [16, 15, 5]];
      blobs.forEach(function (c) { E.drawDisc(g, c[0] + sway, c[1], c[2] + 1, 0); });
      blobs.forEach(function (c) { E.drawDisc(g, c[0] + sway, c[1], c[2], 2); });
      E.drawDisc(g, 13 + sway, 7, 2.6, 3);
      E.drawDisc(g, 20 + sway, 12, 1.6, 3);
      E.setPixel(g, 12 + sway, 16, 4);
      E.setPixel(g, 21 + sway, 10, 4);
      E.setPixel(g, 17 + sway, 6, 4);
      return g;
    });
  }

  var PIXEL_SPECS = [
    { id: 'traveler-walk', name: 'Traveler walk cycle', size: 16, fps: 6, frames: walkerFrames },
    { id: 'slime-bounce', name: 'Slime bounce', size: 16, fps: 3, frames: slimeFrames },
    { id: 'heart-container', name: 'Heart container', size: 16, fps: 1, frames: heartFrames },
    { id: 'door-key', name: 'Door key', size: 16, fps: 1, frames: keyFrames },
    { id: 'potion-bottle', name: 'Potion bottle', size: 16, fps: 1, frames: potionFrames },
    { id: 'treasure-chest', name: 'Treasure chest', size: 16, fps: 1, frames: chestFrames },
    { id: 'toadstool-pixel', name: 'Toadstool', size: 16, fps: 1, frames: mushroomFrames },
    { id: 'windswept-sapling', name: 'Windswept sapling', size: 32, fps: 4, frames: saplingFrames }
  ];

  function buildPixelAsset(spec) {
    return {
      type: 'pixel',
      id: spec.id,
      name: spec.name,
      size: spec.size,
      fps: spec.fps,
      tones: TONES,
      frames: spec.frames()
    };
  }

  var VECTORS = VECTOR_SPECS.map(buildVectorAsset);
  var PIXELS = PIXEL_SPECS.map(buildPixelAsset);

  function getAsset(id) {
    var all = VECTORS.concat(PIXELS);
    for (var i = 0; i < all.length; i += 1) {
      if (all[i].id === id) { return all[i]; }
    }
    return null;
  }

  /** Frames of every pixel asset, named for the atlas demo. */
  function pixelAtlasFrames() {
    var out = [];
    PIXELS.forEach(function (a) {
      a.frames.forEach(function (g, i) {
        out.push({ name: a.id + '_' + i, w: g.width, h: g.height });
      });
    });
    return out;
  }

  return {
    ROLE_HEX: ROLE_HEX,
    VIEWBOX: VIEWBOX,
    TONES: TONES,
    VECTORS: VECTORS,
    PIXELS: PIXELS,
    ALL: VECTORS.concat(PIXELS),
    getAsset: getAsset,
    vectorAssetToSvg: vectorAssetToSvg,
    pixelAtlasFrames: pixelAtlasFrames
  };
}));
