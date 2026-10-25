/*
 * Paperclip Vector & Sprite Rig: page controller.
 *
 * Wires the three benches (vector, pixel, atlas) to the engine. All maths comes
 * from PaperclipEngine. In the browser this file boots itself; under Node it
 * exports createApp(document, window) so the smoke tests can drive it with a
 * small fake DOM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../engine.js'), require('./data.js'));
  } else {
    root.PaperclipApp = factory(root.PaperclipEngine, root.PaperclipAssets);
    var boot = function () { root.PaperclipApp.instance = root.PaperclipApp.createApp(root.document, root); };
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
}(this, function (E, A) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var PLATE = 120;
  var DEFAULT_PIXEL_BY_SIZE = { 16: 'traveler-walk', 32: 'windswept-sapling' };

  function createApp(doc, win) {
    var byId = function (id) { return doc.getElementById(id); };
    var timers = [];

    /* ---------------------------- small helpers ---------------------------- */

    function on(el, type, fn) {
      if (el) { el.addEventListener(type, fn); }
    }

    function svgEl(tag, attrs) {
      var node = doc.createElementNS(SVG_NS, tag);
      Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      return node;
    }

    function htmlEl(tag, attrs, text) {
      var node = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      if (text !== undefined) { node.textContent = text; }
      return node;
    }

    function clearChildren(node) {
      while (node.firstChild) { node.removeChild(node.firstChild); }
    }

    function cssVar(name, fallback) {
      var value = '';
      if (win.getComputedStyle) {
        value = win.getComputedStyle(doc.documentElement).getPropertyValue(name);
      }
      value = value ? String(value).trim() : '';
      return value === '' ? fallback : value;
    }

    function announce(id, message) {
      var el = byId(id);
      if (el) { el.textContent = message; }
    }

    function round1(v) { return Math.round(v * 10) / 10; }

    function reducedMotion() {
      return Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function saveFile(name, data, type) {
      var blob = new win.Blob([data], { type: type });
      var url = win.URL.createObjectURL(blob);
      var a = doc.createElement('a');
      a.setAttribute('href', url);
      a.setAttribute('download', name);
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      timers.push(win.setTimeout(function () { win.URL.revokeObjectURL(url); }, 4000));
    }

    function copyText(text) {
      if (win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) {
        return win.navigator.clipboard.writeText(text);
      }
      return Promise.reject(new Error('clipboard unavailable'));
    }

    function flashButton(button, okText, failText, promise, restoreText) {
      var label = button.querySelector ? button.querySelector('span') : null;
      var original = restoreText;
      var setLabel = function (t) { if (label) { label.textContent = t; } };
      promise.then(function () {
        button.classList.add('is-success');
        setLabel(okText);
      }, function () {
        button.classList.add('is-error');
        setLabel(failText);
      }).then(function () {
        timers.push(win.setTimeout(function () {
          button.classList.remove('is-success');
          button.classList.remove('is-error');
          setLabel(original);
        }, 1600));
      });
    }

    function checkedValue(name, fallback) {
      var list = doc.querySelectorAll('input[name="' + name + '"]');
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].checked) { return list[i].value; }
      }
      return fallback;
    }

    function setChecked(name, value) {
      var list = doc.querySelectorAll('input[name="' + name + '"]');
      for (var i = 0; i < list.length; i += 1) { list[i].checked = list[i].value === String(value); }
    }

    function fillSelect(select, options) {
      clearChildren(select);
      options.forEach(function (o) {
        var opt = htmlEl('option', { value: o.value }, o.label);
        select.appendChild(opt);
      });
    }

    function scrollToId(id) {
      var target = byId(id);
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      }
    }

    /* ------------------------------ vector bench ----------------------------- */

    var vec = {
      asset: null, layerIndex: 0, nodes: [], base: [], closed: true,
      epsilon: 0.6, precision: 2, mode: 'smooth', comb: true, trace: true,
      selected: 0, drag: null, result: null, els: null
    };

    var vecSvg = byId('vector-plate');
    var ghosts = byId('vector-ghosts');
    var overlay = byId('vector-overlay');

    function layerClass(layer) {
      if (layer.kind === 'stroke') { return 's-' + layer.role + ' art-stroke'; }
      return 'f-' + layer.role + (layer.outline ? ' art-outline' : '');
    }

    function buildGhosts() {
      clearChildren(ghosts);
      vec.asset.layers.forEach(function (layer, i) {
        var attrs = { d: layer.d, 'class': layerClass(layer) + (i === vec.layerIndex ? ' is-active-layer' : '') };
        if (layer.kind === 'stroke') { attrs['stroke-width'] = String(layer.width); }
        if (layer.opacity !== undefined && layer.role !== 'shadow') { attrs.opacity = String(layer.opacity); }
        ghosts.appendChild(svgEl('path', attrs));
      });
    }

    function defaultLayerIndex(asset) {
      for (var i = 0; i < asset.layers.length; i += 1) {
        if (asset.layers[i].role !== 'shadow') { return i; }
      }
      return 0;
    }

    function loadVectorAsset(id, layerIndex) {
      var asset = A.getAsset(id);
      if (!asset || asset.type !== 'vector') { return false; }
      vec.asset = asset;
      var select = byId('vec-asset');
      if (select) { select.value = id; }
      var layerSelect = byId('vec-layer');
      if (layerSelect) {
        fillSelect(layerSelect, asset.layers.map(function (l, i) {
          return { value: String(i), label: (i + 1) + '. ' + l.label };
        }));
      }
      loadVectorLayer(layerIndex === undefined ? defaultLayerIndex(asset) : layerIndex);
      return true;
    }

    function loadVectorLayer(index) {
      var layer = vec.asset.layers[index];
      if (!layer) { return false; }
      vec.layerIndex = index;
      var parsed = E.pathDataToNodes(layer.d);
      vec.nodes = parsed.nodes;
      vec.closed = parsed.closed;
      vec.base = E.cloneNodesForReset ? E.cloneNodesForReset(parsed.nodes) : JSON.parse(JSON.stringify(parsed.nodes));
      vec.selected = 0;
      var layerSelect = byId('vec-layer');
      if (layerSelect) { layerSelect.value = String(index); }
      buildGhosts();
      buildOverlay();
      updateVector();
      var title = byId('plate-title');
      if (title) { title.textContent = vec.asset.name + ', ' + layer.label + ' layer'; }
      announce('vec-status', vec.asset.name + ', ' + layer.label + ' layer loaded with ' + vec.nodes.length + ' nodes.');
      return true;
    }

    function buildOverlay() {
      clearChildren(overlay);
      var els = { nodes: [], handles: [], handleLines: [] };
      els.fill = svgEl('path', { 'class': 'edit-fill' });
      els.trace = svgEl('polyline', { 'class': 'trace' });
      els.keptGroup = svgEl('g', {});
      els.opt = svgEl('path', { 'class': 'opt-path' });
      els.combLines = svgEl('path', { 'class': 'comb-lines' });
      els.combTips = svgEl('path', { 'class': 'comb-tips' });
      els.edit = svgEl('path', { 'class': 'edit-path' });
      els.handleGroup = svgEl('g', {});
      els.nodeGroup = svgEl('g', {});
      [els.fill, els.trace, els.keptGroup, els.opt, els.combLines, els.combTips, els.edit,
        els.handleGroup, els.nodeGroup].forEach(function (n) { overlay.appendChild(n); });
      vec.nodes.forEach(function (n, i) {
        var line = svgEl('path', { 'class': 'handle-line' });
        els.handleLines.push(line);
        els.handleGroup.appendChild(line);
        var pair = [];
        ['in', 'out'].forEach(function (which) {
          var g = svgEl('g', {
            'class': 'handle-g', 'data-kind': 'handle', 'data-index': String(i), 'data-which': which,
            role: 'button', tabindex: i === vec.selected ? '0' : '-1',
            'aria-label': 'Node ' + (i + 1) + ' ' + which + ' handle'
          });
          g.appendChild(svgEl('circle', { 'class': 'hit', r: '3.4' }));
          g.appendChild(svgEl('circle', { 'class': 'handle-vis', r: '1.25' }));
          pair.push(g);
          els.handleGroup.appendChild(g);
        });
        els.handles.push(pair);
      });
      vec.nodes.forEach(function (n, i) {
        var g = svgEl('g', {
          'class': 'node-g', 'data-kind': 'node', 'data-index': String(i),
          role: 'button', tabindex: '0',
          'aria-label': 'Anchor ' + (i + 1) + ' of ' + vec.nodes.length
        });
        g.appendChild(svgEl('circle', { 'class': 'hit', r: '4' }));
        g.appendChild(svgEl('rect', { 'class': 'node-vis', x: '-1.5', y: '-1.5', width: '3', height: '3' }));
        els.nodes.push(g);
        els.nodeGroup.appendChild(g);
      });
      vec.els = els;
    }

    function pointsAttr(points, closed) {
      var parts = points.map(function (p) { return E.formatNumber(p.x, 2) + ',' + E.formatNumber(p.y, 2); });
      if (closed && points.length > 0) { parts.push(parts[0]); }
      return parts.join(' ');
    }

    function updateKept(kept) {
      var group = vec.els.keptGroup;
      while (group.childNodes.length > kept.length) { group.removeChild(group.lastChild); }
      while (group.childNodes.length < kept.length) {
        group.appendChild(svgEl('rect', { 'class': 'kept', width: '1.8', height: '1.8' }));
      }
      kept.forEach(function (p, i) {
        var r = group.childNodes[i];
        r.setAttribute('x', String(p.x - 0.9));
        r.setAttribute('y', String(p.y - 0.9));
      });
    }

    function combPaths(comb) {
      var lines = '';
      var tips = [];
      comb.forEach(function (c) {
        var vx = c.tipX - c.x;
        var vy = c.tipY - c.y;
        var len = Math.hypot(vx, vy);
        var cap = 16;
        var f = len > cap ? cap / len : 1;
        var tx = c.x + vx * f;
        var ty = c.y + vy * f;
        lines += 'M' + E.formatNumber(c.x, 2) + ' ' + E.formatNumber(c.y, 2) +
          'L' + E.formatNumber(tx, 2) + ' ' + E.formatNumber(ty, 2);
        tips.push({ x: tx, y: ty });
      });
      return { lines: lines, tips: tips };
    }

    function updateVector() {
      if (!vec.els || vec.nodes.length === 0) { return; }
      var els = vec.els;
      var d = E.nodesToPathData(vec.nodes, vec.closed, 3);
      els.edit.setAttribute('d', d);
      els.fill.setAttribute('d', vec.closed ? d : '');

      var trace = E.flattenNodes(vec.nodes, vec.closed, 40);
      var result = E.optimizeContour(trace, {
        closed: vec.closed, epsilon: vec.epsilon, precision: vec.precision, cornerAngle: 75
      });
      vec.result = result;
      els.trace.setAttribute('points', pointsAttr(trace, vec.closed));
      els.trace.setAttribute('visibility', vec.trace ? 'visible' : 'hidden');
      els.keptGroup.setAttribute('visibility', vec.trace ? 'visible' : 'hidden');
      updateKept(result.kept);
      els.opt.setAttribute('d', result.d);

      var comb = E.curvatureComb(vec.nodes, vec.closed, 8, 250);
      var paths = combPaths(comb);
      els.combLines.setAttribute('d', paths.lines);
      els.combTips.setAttribute('d', paths.tips.length > 0 ? 'M' + paths.tips.map(function (p) {
        return E.formatNumber(p.x, 2) + ' ' + E.formatNumber(p.y, 2);
      }).join('L') : '');
      els.combLines.setAttribute('visibility', vec.comb ? 'visible' : 'hidden');
      els.combTips.setAttribute('visibility', vec.comb ? 'visible' : 'hidden');

      vec.nodes.forEach(function (n, i) {
        els.nodes[i].setAttribute('transform', 'translate(' + n.x + ' ' + n.y + ')');
        els.nodes[i].classList.toggle('is-selected', i === vec.selected);
        els.nodes[i].setAttribute('aria-label', 'Anchor ' + (i + 1) + ' of ' + vec.nodes.length +
          ', x ' + round1(n.x) + ', y ' + round1(n.y));
        var shown = vec.mode !== 'none';
        var hin = els.handles[i][0];
        var hout = els.handles[i][1];
        hin.setAttribute('transform', 'translate(' + n.inX + ' ' + n.inY + ')');
        hout.setAttribute('transform', 'translate(' + n.outX + ' ' + n.outY + ')');
        var hasIn = Math.hypot(n.inX - n.x, n.inY - n.y) > 0.05;
        var hasOut = Math.hypot(n.outX - n.x, n.outY - n.y) > 0.05;
        hin.setAttribute('visibility', shown && hasIn ? 'visible' : 'hidden');
        hout.setAttribute('visibility', shown && hasOut ? 'visible' : 'hidden');
        hin.setAttribute('tabindex', i === vec.selected && hasIn ? '0' : '-1');
        hout.setAttribute('tabindex', i === vec.selected && hasOut ? '0' : '-1');
        hin.setAttribute('aria-label', 'Node ' + (i + 1) + ' in handle');
        hout.setAttribute('aria-label', 'Node ' + (i + 1) + ' out handle');
        els.handleLines[i].setAttribute('d',
          (hasIn ? 'M' + n.inX + ' ' + n.inY + 'L' + n.x + ' ' + n.y : '') +
          (hasOut ? 'M' + n.x + ' ' + n.y + 'L' + n.outX + ' ' + n.outY : ''));
      });

      var maxK = 0;
      comb.forEach(function (c) { maxK = Math.max(maxK, Math.abs(c.k)); });
      var box = E.nodesBoundingBox(vec.nodes, vec.closed);
      var change = result.bytesBefore === 0 ? 0 : (1 - result.bytesAfter / result.bytesBefore) * 100;
      setText('ro-trace', String(trace.length));
      setText('ro-kept', String(result.nodeCountAfter));
      setText('ro-bytes-before', result.bytesBefore + ' B');
      setText('ro-bytes-after', result.bytesAfter + ' B');
      setText('ro-saved', Math.abs(Math.round(change)) + '% ' + (change >= 0 ? 'smaller' : 'larger'));
      setText('ro-deviation', result.deviation.toFixed(2) + ' units');
      setText('ro-nodes', String(vec.nodes.length));
      setText('ro-length', E.polylineLength(E.flattenNodes(vec.nodes, vec.closed, 48), vec.closed).toFixed(1) + ' units');
      setText('ro-bbox', box.width.toFixed(1) + ' by ' + box.height.toFixed(1));
      setText('ro-kmax', maxK.toFixed(3));
      var out = byId('vec-d');
      if (out) { out.value = result.d; }
    }

    function setText(id, text) {
      var el = byId(id);
      if (el) { el.textContent = text; }
    }

    function plateCoords(evt) {
      var rect = vecSvg.getBoundingClientRect();
      var w = rect.width > 0 ? rect.width : PLATE;
      var h = rect.height > 0 ? rect.height : PLATE;
      var x = ((evt.clientX - rect.left) / w) * PLATE;
      var y = ((evt.clientY - rect.top) / h) * PLATE;
      return { x: round1(E.clamp(x, -8, PLATE + 8)), y: round1(E.clamp(y, -8, PLATE + 8)) };
    }

    function applyDrag(target, pos) {
      if (target.kind === 'node') {
        vec.nodes = E.moveNode(vec.nodes, target.index, pos.x, pos.y);
      } else {
        vec.nodes = E.moveHandle(vec.nodes, target.index, target.which, pos.x, pos.y, vec.mode);
      }
      updateVector();
    }

    function selectNode(index) {
      if (index === vec.selected) { return; }
      vec.selected = index;
      updateVector();
    }

    function findTarget(node) {
      var cur = node;
      while (cur && cur !== vecSvg) {
        if (cur.getAttribute && cur.getAttribute('data-kind')) {
          return {
            kind: cur.getAttribute('data-kind'),
            index: parseInt(cur.getAttribute('data-index'), 10),
            which: cur.getAttribute('data-which'),
            el: cur
          };
        }
        cur = cur.parentNode;
      }
      return null;
    }

    function onPlateDown(evt) {
      var target = findTarget(evt.target);
      if (!target) { return; }
      evt.preventDefault();
      vec.drag = target;
      selectNode(target.index);
      if (vecSvg.setPointerCapture && evt.pointerId !== undefined) {
        try { vecSvg.setPointerCapture(evt.pointerId); } catch (e) { /* capture is optional */ }
      }
      var live = vec.els && vec.els.nodes[target.index];
      if (live && live.focus) { live.focus(); }
    }

    function onPlateMove(evt) {
      if (!vec.drag) { return; }
      applyDrag(vec.drag, plateCoords(evt));
    }

    function onPlateUp() {
      if (!vec.drag) { return; }
      var t = vec.drag;
      vec.drag = null;
      announce('vec-status', 'Moved ' + (t.kind === 'node' ? 'anchor ' : 'handle of node ') + (t.index + 1) +
        '. Simplified path has ' + vec.result.nodeCountAfter + ' nodes.');
    }

    function onPlateKey(evt) {
      var target = findTarget(evt.target);
      if (!target) { return; }
      var step = evt.shiftKey ? 5 : 1;
      var dx = 0;
      var dy = 0;
      if (evt.key === 'ArrowLeft') { dx = -step; } else if (evt.key === 'ArrowRight') { dx = step; }
      else if (evt.key === 'ArrowUp') { dy = -step; } else if (evt.key === 'ArrowDown') { dy = step; }
      else if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        if (target.kind === 'node') { selectNode(target.index); }
        return;
      } else { return; }
      evt.preventDefault();
      var n = vec.nodes[target.index];
      var pos = target.kind === 'node'
        ? { x: n.x + dx, y: n.y + dy }
        : { x: (target.which === 'in' ? n.inX : n.outX) + dx, y: (target.which === 'in' ? n.inY : n.outY) + dy };
      pos.x = round1(E.clamp(pos.x, -8, PLATE + 8));
      pos.y = round1(E.clamp(pos.y, -8, PLATE + 8));
      selectNode(target.index);
      applyDrag(target, pos);
      announce('vec-status', (target.kind === 'node' ? 'Anchor ' : 'Handle of node ') + (target.index + 1) +
        ' at ' + pos.x + ', ' + pos.y + '.');
      var again = vec.els && (target.kind === 'node' ? vec.els.nodes[target.index]
        : vec.els.handles[target.index][target.which === 'in' ? 0 : 1]);
      if (again && again.focus) { again.focus(); }
    }

    function exportVectorSvg() {
      var layers = vec.asset.layers.map(function (l, i) {
        return i === vec.layerIndex ? Object.assign({}, l, { d: vec.result.d }) : l;
      });
      return A.vectorAssetToSvg(Object.assign({}, vec.asset, { layers: layers }));
    }

    function wireVector() {
      var assetSelect = byId('vec-asset');
      if (assetSelect) {
        fillSelect(assetSelect, A.VECTORS.map(function (a) { return { value: a.id, label: a.name }; }));
        on(assetSelect, 'change', function () { loadVectorAsset(assetSelect.value); });
      }
      on(byId('vec-layer'), 'change', function (e) { loadVectorLayer(parseInt(e.target.value, 10)); });
      doc.querySelectorAll('input[name="handle-mode"]').forEach(function (r) {
        on(r, 'change', function () { vec.mode = checkedValue('handle-mode', 'smooth'); });
      });
      var eps = byId('vec-epsilon');
      on(eps, 'input', function () {
        vec.epsilon = parseFloat(eps.value);
        setText('vec-epsilon-out', vec.epsilon.toFixed(2) + ' units');
        updateVector();
      });
      on(eps, 'change', function () {
        announce('vec-status', 'Tolerance ' + vec.epsilon.toFixed(2) + '. ' + vec.result.nodeCountAfter +
          ' of ' + vec.result.nodeCountBefore + ' trace points kept.');
      });
      var prec = byId('vec-precision');
      on(prec, 'input', function () {
        vec.precision = parseInt(prec.value, 10);
        setText('vec-precision-out', String(vec.precision));
        updateVector();
      });
      on(byId('vec-comb'), 'change', function (e) { vec.comb = Boolean(e.target.checked); updateVector(); });
      on(byId('vec-trace'), 'change', function (e) { vec.trace = Boolean(e.target.checked); updateVector(); });
      on(byId('vec-reset'), 'click', function () {
        vec.nodes = JSON.parse(JSON.stringify(vec.base));
        updateVector();
        announce('vec-status', 'Layer reset.');
      });
      on(byId('vec-copy'), 'click', function () {
        var btn = byId('vec-copy');
        flashButton(btn, 'Copied', 'Copy failed', copyText(vec.result.d), 'Copy path');
      });
      on(byId('vec-download'), 'click', function () {
        saveFile(vec.asset.id + '-simplified.svg', exportVectorSvg(), 'image/svg+xml');
        announce('vec-status', 'SVG downloaded.');
      });
      if (vecSvg) {
        on(vecSvg, 'pointerdown', onPlateDown);
        on(vecSvg, 'pointermove', onPlateMove);
        on(vecSvg, 'pointerup', onPlateUp);
        on(vecSvg, 'pointercancel', onPlateUp);
        on(vecSvg, 'keydown', onPlateKey);
      }
    }

    /* ------------------------------ pixel bench ------------------------------ */

    var px = {
      asset: null, frames: [], frame: 0, size: 16, tool: 'pencil', tone: 2, palette: 'archival',
      onion: true, grid: true, fps: 6, playing: false, startedAt: 0, undo: [],
      lineStart: null, cursor: { x: 0, y: 0 }, drag: null, lastCell: null, shown: -1, raf: 0, visible: true
    };
    var pxCanvas = byId('px-canvas');
    var pxPreview = byId('px-preview');

    function pxColors() {
      return E.toneColors(A.TONES, E.getPalette(px.palette).colors);
    }

    function cellSize() { return px.size === 16 ? 20 : 10; }

    function currentGrid() { return px.frames[px.frame]; }

    function drawCells(ctx, grid, colorOf, cell, alpha) {
      ctx.globalAlpha = alpha;
      for (var y = 0; y < grid.height; y += 1) {
        for (var x = 0; x < grid.width; x += 1) {
          var v = grid.data[y * grid.width + x];
          if (v === E.TRANSPARENT) { continue; }
          ctx.fillStyle = colorOf(v);
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawPixelCanvas() {
      if (!pxCanvas || !pxCanvas.getContext) { return; }
      var ctx = pxCanvas.getContext('2d');
      if (!ctx) { return; }
      var cell = cellSize();
      var dim = px.size * cell;
      if (pxCanvas.width !== dim) { pxCanvas.width = dim; pxCanvas.height = dim; }
      var light = cssVar('--paper', '#F8F5EE');
      var dark = cssVar('--tray', '#EFEAE0');
      for (var y = 0; y < px.size; y += 1) {
        for (var x = 0; x < px.size; x += 1) {
          ctx.fillStyle = (x + y) % 2 === 0 ? light : dark;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
      if (px.onion && px.frames.length > 1) {
        var tints = { before: cssVar('--ultramarine', '#2B4C7E'), after: cssVar('--vermilion', '#C84B31') };
        E.onionLayers(px.frames.length, px.frame, { before: 1, after: 1 }).forEach(function (layer) {
          drawCells(ctx, px.frames[layer.index], function () { return tints[layer.side]; }, cell, layer.alpha);
        });
      }
      var colors = pxColors();
      drawCells(ctx, currentGrid(), function (v) { return colors[v]; }, cell, 1);
      if (px.lineStart) {
        var preview = E.bresenhamLine(px.lineStart.x, px.lineStart.y, px.cursor.x, px.cursor.y);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = colors[px.tone];
        preview.forEach(function (p) { ctx.fillRect(p.x * cell, p.y * cell, cell, cell); });
        ctx.globalAlpha = 1;
      }
      if (px.grid) {
        ctx.strokeStyle = cssVar('--rule-strong', '#8F876F');
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 1; i < px.size; i += 1) {
          ctx.moveTo(i * cell + 0.5, 0);
          ctx.lineTo(i * cell + 0.5, dim);
          ctx.moveTo(0, i * cell + 0.5);
          ctx.lineTo(dim, i * cell + 0.5);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = cssVar('--focus', '#2B4C7E');
      ctx.lineWidth = 2;
      ctx.strokeRect(px.cursor.x * cell + 1, px.cursor.y * cell + 1, cell - 2, cell - 2);
    }

    function drawThumb(canvas, grid) {
      if (!canvas.getContext) { return; }
      var ctx = canvas.getContext('2d');
      if (!ctx) { return; }
      canvas.width = grid.width;
      canvas.height = grid.height;
      ctx.clearRect(0, 0, grid.width, grid.height);
      var colors = pxColors();
      drawCells(ctx, grid, function (v) { return colors[v]; }, 1, 1);
    }

    function drawPreview(index) {
      if (!pxPreview || !pxPreview.getContext) { return; }
      var ctx = pxPreview.getContext('2d');
      if (!ctx) { return; }
      var scale = Math.floor(128 / px.size);
      if (pxPreview.width !== px.size * scale) { pxPreview.width = px.size * scale; pxPreview.height = px.size * scale; }
      ctx.clearRect(0, 0, pxPreview.width, pxPreview.height);
      var colors = pxColors();
      drawCells(ctx, px.frames[index], function (v) { return colors[v]; }, scale, 1);
      px.shown = index;
    }

    function buildFrameStrip() {
      var strip = byId('px-frames');
      if (!strip) { return; }
      clearChildren(strip);
      px.frames.forEach(function (grid, i) {
        var btn = htmlEl('button', {
          type: 'button', 'class': 'frame-btn', 'aria-pressed': i === px.frame ? 'true' : 'false',
          'aria-label': 'Frame ' + (i + 1) + ' of ' + px.frames.length
        });
        var canvas = htmlEl('canvas', { 'aria-hidden': 'true' });
        drawThumb(canvas, grid);
        btn.appendChild(canvas);
        btn.appendChild(htmlEl('span', {}, String(i + 1)));
        on(btn, 'click', function () { setFrame(i); });
        strip.appendChild(btn);
      });
    }

    function refreshFrameStrip() {
      var strip = byId('px-frames');
      if (!strip) { return; }
      px.frames.forEach(function (grid, i) {
        var btn = strip.childNodes[i];
        if (!btn) { return; }
        btn.setAttribute('aria-pressed', i === px.frame ? 'true' : 'false');
        drawThumb(btn.firstChild, grid);
      });
    }

    function updatePixelCaption() {
      var caption = byId('px-caption');
      if (caption) {
        caption.textContent = px.asset.name + ', frame ' + (px.frame + 1) + ' of ' + px.frames.length +
          ', ' + px.size + ' by ' + px.size;
      }
      var playBtn = byId('px-play');
      if (playBtn) { playBtn.disabled = px.frames.length < 2; }
    }

    function buildSwatches() {
      var wrap = byId('px-swatches');
      if (!wrap) { return; }
      clearChildren(wrap);
      pxColors().forEach(function (hex, i) {
        var b = htmlEl('button', {
          type: 'button', 'class': 'swatch', 'aria-pressed': i === px.tone ? 'true' : 'false',
          'aria-label': 'Tone ' + (i + 1) + ' of ' + A.TONES + ', colour ' + hex, title: 'Tone ' + (i + 1) + ', ' + hex
        });
        b.style.setProperty('--swatch', hex);
        on(b, 'click', function () { px.tone = i; refreshSwatches(); drawPixelCanvas(); });
        wrap.appendChild(b);
      });
    }

    function refreshSwatches() {
      var wrap = byId('px-swatches');
      if (!wrap) { return; }
      pxColors().forEach(function (hex, i) {
        var b = wrap.childNodes[i];
        if (!b) { return; }
        b.setAttribute('aria-pressed', i === px.tone ? 'true' : 'false');
        b.setAttribute('aria-label', 'Tone ' + (i + 1) + ' of ' + A.TONES + ', colour ' + hex);
        b.setAttribute('title', 'Tone ' + (i + 1) + ', ' + hex);
        b.style.setProperty('--swatch', hex);
      });
    }

    function redrawPixels() {
      drawPixelCanvas();
      drawPreview(Math.min(px.shown < 0 ? px.frame : px.shown, px.frames.length - 1));
      refreshFrameStrip();
      updatePixelCaption();
    }

    function loadPixelAsset(id) {
      var asset = A.getAsset(id);
      if (!asset || asset.type !== 'pixel') { return false; }
      px.asset = asset;
      px.frames = asset.frames.map(E.cloneGrid);
      px.frame = 0;
      px.size = asset.size;
      px.fps = asset.fps;
      px.undo = [];
      px.lineStart = null;
      px.shown = 0;
      px.cursor = { x: 0, y: 0 };
      var select = byId('px-asset');
      if (select) { select.value = id; }
      setChecked('px-size', asset.size);
      var fps = byId('px-fps');
      if (fps) { fps.value = String(asset.fps); }
      setText('px-fps-out', asset.fps + ' fps');
      buildFrameStrip();
      redrawPixels();
      announce('px-status', asset.name + ' loaded, ' + asset.frames.length + ' frames.');
      return true;
    }

    function setFrame(i) {
      px.frame = E.clamp(i, 0, px.frames.length - 1);
      px.lineStart = null;
      if (!px.playing) { px.shown = px.frame; }
      redrawPixels();
    }

    function snapshot() {
      px.undo.push({ frame: px.frame, frames: px.frames.map(E.cloneGrid) });
      if (px.undo.length > 40) { px.undo.shift(); }
    }

    function undo() {
      var s = px.undo.pop();
      if (!s) { announce('px-status', 'Nothing to undo.'); return; }
      px.frames = s.frames;
      px.frame = Math.min(s.frame, px.frames.length - 1);
      buildFrameStrip();
      redrawPixels();
      announce('px-status', 'Undone.');
    }

    function applyTool(x, y, isStart) {
      var grid = currentGrid();
      if (!E.getPixel(grid, x, y) && E.getPixel(grid, x, y) !== 0 && (x < 0 || y < 0 || x >= grid.width || y >= grid.height)) { return; }
      if (px.tool === 'pencil' || px.tool === 'erase') {
        var index = px.tool === 'erase' ? E.TRANSPARENT : px.tone;
        if (px.lastCell && !isStart) {
          E.drawLine(grid, px.lastCell.x, px.lastCell.y, x, y, index);
        } else {
          E.setPixel(grid, x, y, index);
        }
        px.lastCell = { x: x, y: y };
      } else if (px.tool === 'fill') {
        E.floodFillGrid(grid, x, y, px.tone);
      }
    }

    function cellAt(evt) {
      var rect = pxCanvas.getBoundingClientRect();
      var w = rect.width > 0 ? rect.width : pxCanvas.width;
      var h = rect.height > 0 ? rect.height : pxCanvas.height;
      var x = Math.floor(((evt.clientX - rect.left) / w) * px.size);
      var y = Math.floor(((evt.clientY - rect.top) / h) * px.size);
      return { x: E.clamp(x, 0, px.size - 1), y: E.clamp(y, 0, px.size - 1) };
    }

    function onPixelDown(evt) {
      evt.preventDefault();
      var c = cellAt(evt);
      px.cursor = c;
      snapshot();
      px.drag = true;
      px.lastCell = null;
      if (pxCanvas.setPointerCapture && evt.pointerId !== undefined) {
        try { pxCanvas.setPointerCapture(evt.pointerId); } catch (e) { /* optional */ }
      }
      if (px.tool === 'line') {
        px.lineStart = c;
      } else {
        applyTool(c.x, c.y, true);
      }
      redrawPixels();
    }

    function onPixelMove(evt) {
      var c = cellAt(evt);
      var changed = c.x !== px.cursor.x || c.y !== px.cursor.y;
      px.cursor = c;
      if (px.drag && (px.tool === 'pencil' || px.tool === 'erase') && changed) {
        applyTool(c.x, c.y, false);
        redrawPixels();
      } else if (changed) {
        drawPixelCanvas();
      }
    }

    function onPixelUp(evt) {
      if (!px.drag) { return; }
      px.drag = false;
      px.lastCell = null;
      if (px.tool === 'line' && px.lineStart) {
        var c = evt && evt.clientX !== undefined ? cellAt(evt) : px.cursor;
        E.drawLine(currentGrid(), px.lineStart.x, px.lineStart.y, c.x, c.y, px.tone);
        px.lineStart = null;
      }
      redrawPixels();
    }

    function onPixelKey(evt) {
      var k = evt.key;
      var moved = true;
      if (k === 'ArrowLeft') { px.cursor.x = Math.max(0, px.cursor.x - 1); }
      else if (k === 'ArrowRight') { px.cursor.x = Math.min(px.size - 1, px.cursor.x + 1); }
      else if (k === 'ArrowUp') { px.cursor.y = Math.max(0, px.cursor.y - 1); }
      else if (k === 'ArrowDown') { px.cursor.y = Math.min(px.size - 1, px.cursor.y + 1); }
      else { moved = false; }
      if (moved) { evt.preventDefault(); drawPixelCanvas(); return; }
      if ((evt.ctrlKey || evt.metaKey) && (k === 'z' || k === 'Z')) { evt.preventDefault(); undo(); return; }
      if (k === 'Escape') { px.lineStart = null; drawPixelCanvas(); return; }
      if (k === ' ' || k === 'Enter') {
        evt.preventDefault();
        if (px.tool === 'line') {
          if (!px.lineStart) {
            px.lineStart = { x: px.cursor.x, y: px.cursor.y };
          } else {
            snapshot();
            E.drawLine(currentGrid(), px.lineStart.x, px.lineStart.y, px.cursor.x, px.cursor.y, px.tone);
            px.lineStart = null;
          }
        } else {
          snapshot();
          px.lastCell = null;
          applyTool(px.cursor.x, px.cursor.y, true);
        }
        redrawPixels();
      }
    }

    function tick(now) {
      px.raf = 0;
      if (!px.playing) { return; }
      if (px.visible && !doc.hidden && px.frames.length > 1) {
        var index = E.animationFrameIndex(now - px.startedAt, px.fps, px.frames.length);
        if (index !== px.shown) { drawPreview(index); }
      }
      px.raf = win.requestAnimationFrame(tick);
    }

    function setPlaying(playing) {
      px.playing = playing && px.frames.length > 1;
      var btn = byId('px-play');
      if (btn) {
        btn.setAttribute('aria-pressed', px.playing ? 'true' : 'false');
        var label = byId('px-play-label');
        if (label) { label.textContent = px.playing ? 'Pause' : 'Play'; }
      }
      if (px.playing && !px.raf && win.requestAnimationFrame) {
        px.startedAt = win.performance ? win.performance.now() : 0;
        px.raf = win.requestAnimationFrame(tick);
      }
      if (!px.playing) {
        if (px.raf && win.cancelAnimationFrame) { win.cancelAnimationFrame(px.raf); }
        px.raf = 0;
        drawPreview(px.frame);
      }
    }

    function exportColumns() { return Math.min(px.frames.length, 4); }

    function wirePixel() {
      var assetSelect = byId('px-asset');
      if (assetSelect) {
        fillSelect(assetSelect, A.PIXELS.map(function (a) {
          return { value: a.id, label: a.name + ' (' + a.size + ' px)' };
        }));
        on(assetSelect, 'change', function () { loadPixelAsset(assetSelect.value); });
      }
      var palSelect = byId('px-palette');
      if (palSelect) {
        fillSelect(palSelect, E.PALETTES.map(function (p) { return { value: p.id, label: p.name }; }));
        palSelect.value = px.palette;
        on(palSelect, 'change', function () {
          px.palette = palSelect.value;
          refreshSwatches();
          buildFrameStrip();
          redrawPixels();
          announce('px-status', 'Palette ' + E.getPalette(px.palette).name + ' applied.');
        });
      }
      doc.querySelectorAll('input[name="px-size"]').forEach(function (r) {
        on(r, 'change', function () {
          if (r.checked) { loadPixelAsset(DEFAULT_PIXEL_BY_SIZE[r.value]); }
        });
      });
      doc.querySelectorAll('input[name="px-tool"]').forEach(function (r) {
        on(r, 'change', function () {
          px.tool = checkedValue('px-tool', 'pencil');
          px.lineStart = null;
          drawPixelCanvas();
        });
      });
      on(byId('px-onion'), 'change', function (e) { px.onion = Boolean(e.target.checked); drawPixelCanvas(); });
      on(byId('px-grid'), 'change', function (e) { px.grid = Boolean(e.target.checked); drawPixelCanvas(); });
      var fps = byId('px-fps');
      on(fps, 'input', function () {
        px.fps = parseInt(fps.value, 10);
        setText('px-fps-out', px.fps + ' fps');
        px.startedAt = win.performance ? win.performance.now() : 0;
      });
      on(byId('px-play'), 'click', function () { setPlaying(!px.playing); });
      on(byId('px-undo'), 'click', undo);
      on(byId('px-add'), 'click', function () {
        snapshot();
        px.frames.splice(px.frame + 1, 0, E.createGrid(px.size, px.size));
        px.frame += 1;
        buildFrameStrip();
        redrawPixels();
        announce('px-status', 'Blank frame added. ' + px.frames.length + ' frames.');
      });
      on(byId('px-dup'), 'click', function () {
        snapshot();
        px.frames.splice(px.frame + 1, 0, E.cloneGrid(currentGrid()));
        px.frame += 1;
        buildFrameStrip();
        redrawPixels();
        announce('px-status', 'Frame duplicated. ' + px.frames.length + ' frames.');
      });
      on(byId('px-del'), 'click', function () {
        if (px.frames.length < 2) { announce('px-status', 'A sprite needs at least one frame.'); return; }
        snapshot();
        px.frames.splice(px.frame, 1);
        px.frame = Math.min(px.frame, px.frames.length - 1);
        if (px.frames.length < 2) { setPlaying(false); }
        buildFrameStrip();
        redrawPixels();
        announce('px-status', 'Frame deleted. ' + px.frames.length + ' frames.');
      });
      on(byId('px-reset'), 'click', function () { loadPixelAsset(px.asset.id); });
      on(byId('px-png'), 'click', function () {
        var sheet = E.buildSpriteSheetGrid(px.frames, exportColumns());
        saveFile(px.asset.id + '-sheet.png', E.gridToPng(sheet, pxColors(), 1), 'image/png');
        announce('px-status', 'PNG sprite sheet downloaded.');
      });
      on(byId('px-svg'), 'click', function () {
        saveFile(px.asset.id + '-sheet.svg',
          E.exportSpriteSheetSvg(px.frames, pxColors(), { scale: 8, columns: exportColumns() }), 'image/svg+xml');
        announce('px-status', 'SVG sprite sheet downloaded.');
      });
      if (pxCanvas) {
        on(pxCanvas, 'pointerdown', onPixelDown);
        on(pxCanvas, 'pointermove', onPixelMove);
        on(pxCanvas, 'pointerup', onPixelUp);
        on(pxCanvas, 'pointercancel', onPixelUp);
        on(pxCanvas, 'keydown', onPixelKey);
        on(pxCanvas, 'focus', drawPixelCanvas);
      }
      on(doc, 'visibilitychange', function () { px.startedAt = win.performance ? win.performance.now() : 0; });
      var stage = byId('pixel');
      if (stage && win.IntersectionObserver) {
        var io = new win.IntersectionObserver(function (entries) {
          entries.forEach(function (en) { px.visible = en.isIntersecting; });
        });
        io.observe(stage);
      }
    }

    /* ------------------------------ atlas bench ------------------------------ */

    var at = {
      source: 'pixels', count: 32, max: 48, seed: 7, padding: 2, extrude: 1, pot: true,
      sort: 'maxside', limit: 1024, format: 'hash', atlas: null, frames: []
    };
    var atSvg = byId('atlas-svg');

    function atFrames() {
      if (at.source === 'pixels') { return A.pixelAtlasFrames(); }
      return E.generateSampleFrames(at.count, at.seed, 8, at.max);
    }

    function atDescriptor() {
      var name = 'atlas.png';
      if (at.format === 'array') { return E.exportTexturePackerArray(at.atlas, name); }
      if (at.format === 'phaser') { return E.exportPhaserJson(at.atlas, name); }
      if (at.format === 'godot') { return E.exportGodotRegions(at.atlas, name); }
      if (at.format === 'css') { return E.exportCssSprites(at.atlas, name, 'sprite'); }
      return E.exportTexturePackerHash(at.atlas, name);
    }

    function renderAtlas() {
      if (!atSvg) { return; }
      clearChildren(atSvg);
      var atlas = at.atlas;
      if (!atlas.ok || atlas.width === 0) {
        atSvg.setAttribute('viewBox', '0 0 64 64');
        return;
      }
      atSvg.setAttribute('viewBox', '0 0 ' + atlas.width + ' ' + atlas.height);
      var defs = svgEl('defs', {});
      var step = Math.max(2, atlas.width / 40);
      var pattern = svgEl('pattern', {
        id: 'at-hatch', width: String(step), height: String(step), patternUnits: 'userSpaceOnUse',
        patternTransform: 'rotate(45)'
      });
      pattern.appendChild(svgEl('line', { 'class': 'hatch-line', x1: '0', y1: '0', x2: '0', y2: String(step) }));
      defs.appendChild(pattern);
      atSvg.appendChild(defs);
      atSvg.appendChild(svgEl('rect', { 'class': 'at-ground', width: String(atlas.width), height: String(atlas.height) }));
      atSvg.appendChild(svgEl('rect', { 'class': 'at-hatch', width: String(atlas.width), height: String(atlas.height) }));
      atlas.placements.forEach(function (p, i) {
        var cell = svgEl('rect', {
          'class': 'at-cell', x: String(p.cell.x), y: String(p.cell.y), width: String(p.cell.w), height: String(p.cell.h)
        });
        cell.style.setProperty('--i', String(i));
        atSvg.appendChild(cell);
        var rect = svgEl('rect', {
          'class': 'at-rect at-rect-' + (i % 4), x: String(p.x), y: String(p.y), width: String(p.w), height: String(p.h)
        });
        rect.style.setProperty('--i', String(i));
        var title = svgEl('title', {});
        title.textContent = p.name + ', ' + p.w + ' by ' + p.h + ' at ' + p.x + ', ' + p.y;
        rect.appendChild(title);
        atSvg.appendChild(rect);
      });
    }

    function recomputeAtlas() {
      at.frames = atFrames();
      at.atlas = E.packSpriteAtlasMaxRects(at.frames, {
        padding: at.padding, extrude: at.extrude, maxSize: at.limit, powerOfTwo: at.pot, sort: at.sort
      });
      var atlas = at.atlas;
      renderAtlas();
      var meter = byId('at-bar');
      var eff = atlas.ok ? atlas.efficiency : 0;
      if (meter) { meter.style.setProperty('--eff', String(eff)); }
      setText('at-eff', (eff * 100).toFixed(1) + '%');
      if (atlas.ok) {
        var check = E.validateAtlas(atlas);
        setText('at-size', atlas.width + ' by ' + atlas.height);
        setText('at-frames', String(atlas.placements.length));
        setText('at-waste', (atlas.width * atlas.height - atlas.frameArea).toLocaleString('en-US') + ' px');
        setText('at-valid', check.ok ? 'No overlaps, all inside' : check.problems.length + ' problems');
        var cap = byId('atlas-caption');
        if (cap) {
          clearChildren(cap);
          cap.appendChild(htmlEl('span', {}, atlas.width + ' by ' + atlas.height + ' sheet, ' +
            atlas.placements.length + ' frames'));
          cap.appendChild(htmlEl('span', { 'class': 'plate-hint' }, 'Hatching marks wasted pixels. Dashed boxes include padding and extrude.'));
        }
        var out = byId('at-output');
        if (out) { out.value = atDescriptor(); }
      } else {
        setText('at-size', 'does not fit');
        setText('at-frames', '0 of ' + at.frames.length);
        setText('at-waste', 'none');
        setText('at-valid', 'raise the sheet limit');
        var out2 = byId('at-output');
        if (out2) { out2.value = ''; }
      }
      announce('at-status', atlas.ok
        ? 'Packed ' + atlas.placements.length + ' frames into ' + atlas.width + ' by ' + atlas.height +
          ' at ' + (eff * 100).toFixed(1) + ' percent.'
        : 'Frames do not fit within ' + at.limit + ' pixels.');
    }

    function syncAtlasFields() {
      var kit = at.source === 'kit';
      ['at-count-field', 'at-max-field', 'at-seed-field'].forEach(function (id) {
        var el = byId(id);
        if (el) { el.hidden = !kit; }
      });
    }

    function atlasPng() {
      var maps = {};
      if (at.source === 'pixels') {
        A.PIXELS.forEach(function (asset) {
          asset.frames.forEach(function (g, i) { maps[asset.id + '_' + i] = g; });
        });
      }
      var grid = E.buildAtlasGrid(at.atlas, maps, function (i) { return i % A.TONES; });
      return E.gridToPng(grid, E.toneColors(A.TONES, E.getPalette('archival').colors), 1);
    }

    function wireRange(id, outId, suffix, apply) {
      var input = byId(id);
      on(input, 'input', function () {
        var v = parseInt(input.value, 10);
        setText(outId, v + suffix);
        apply(v);
        recomputeAtlas();
      });
    }

    function wireAtlas() {
      doc.querySelectorAll('input[name="at-source"]').forEach(function (r) {
        on(r, 'change', function () {
          at.source = checkedValue('at-source', 'pixels');
          syncAtlasFields();
          recomputeAtlas();
        });
      });
      wireRange('at-count', 'at-count-out', '', function (v) { at.count = v; });
      wireRange('at-max', 'at-max-out', ' px', function (v) { at.max = v; });
      wireRange('at-seed', 'at-seed-out', '', function (v) { at.seed = v; });
      wireRange('at-padding', 'at-padding-out', ' px', function (v) { at.padding = v; });
      wireRange('at-extrude', 'at-extrude-out', ' px', function (v) { at.extrude = v; });
      on(byId('at-sort'), 'change', function (e) { at.sort = e.target.value; recomputeAtlas(); });
      on(byId('at-limit'), 'change', function (e) { at.limit = parseInt(e.target.value, 10); recomputeAtlas(); });
      on(byId('at-pot'), 'change', function (e) { at.pot = Boolean(e.target.checked); recomputeAtlas(); });
      on(byId('at-format'), 'change', function (e) {
        at.format = e.target.value;
        var out = byId('at-output');
        if (out && at.atlas.ok) { out.value = atDescriptor(); }
      });
      on(byId('at-replay'), 'click', function () {
        if (!atSvg) { return; }
        atSvg.classList.remove('is-replay');
        if (atSvg.getBoundingClientRect) { atSvg.getBoundingClientRect(); }
        atSvg.classList.add('is-replay');
      });
      on(byId('at-copy'), 'click', function () {
        var out = byId('at-output');
        flashButton(byId('at-copy'), 'Copied', 'Copy failed', copyText(out ? out.value : ''), 'Copy descriptor');
      });
      on(byId('at-download-json'), 'click', function () {
        var isCss = at.format === 'css';
        saveFile(isCss ? 'atlas.css' : 'atlas.json', atDescriptor(), isCss ? 'text/css' : 'application/json');
        announce('at-status', 'Descriptor downloaded.');
      });
      on(byId('at-download-png'), 'click', function () {
        if (!at.atlas.ok) { announce('at-status', 'Nothing to download, the frames did not fit.'); return; }
        saveFile('atlas.png', atlasPng(), 'image/png');
        announce('at-status', 'Atlas PNG downloaded.');
      });
    }

    /* ----------------------------- specimen shelf ---------------------------- */

    function wireSpecimens() {
      doc.querySelectorAll('.specimen[data-asset]').forEach(function (li) {
        var id = li.getAttribute('data-asset');
        var asset = A.getAsset(id);
        if (!asset) { return; }
        var caption = li.querySelector('figcaption');
        if (!caption) { return; }
        var btn = htmlEl('button', { type: 'button', 'class': 'open-btn' },
          asset.type === 'vector' ? 'Edit in vector bench' : 'Open in pixel bench');
        btn.setAttribute('aria-label', (asset.type === 'vector' ? 'Edit ' : 'Open ') + asset.name +
          (asset.type === 'vector' ? ' in the vector bench' : ' in the pixel bench'));
        on(btn, 'click', function () {
          if (asset.type === 'vector') {
            loadVectorAsset(id);
            scrollToId('top');
          } else {
            loadPixelAsset(id);
            scrollToId('pixel');
          }
        });
        caption.appendChild(btn);
      });
    }

    /* --------------------------------- boot --------------------------------- */

    function init() {
      wireVector();
      wirePixel();
      wireAtlas();
      syncAtlasFields();
      loadVectorAsset('ginkgo-leaf');
      loadPixelAsset(DEFAULT_PIXEL_BY_SIZE[16]);
      buildSwatches();
      recomputeAtlas();
      wireSpecimens();
      setPlaying(!reducedMotion());
    }

    function destroy() {
      if (px.raf && win.cancelAnimationFrame) { win.cancelAnimationFrame(px.raf); }
      px.raf = 0;
      px.playing = false;
      timers.forEach(function (t) { win.clearTimeout(t); });
      timers = [];
    }

    init();

    return {
      vec: vec, px: px, at: at,
      loadVectorAsset: loadVectorAsset,
      loadVectorLayer: loadVectorLayer,
      loadPixelAsset: loadPixelAsset,
      recomputeAtlas: recomputeAtlas,
      setPlaying: setPlaying,
      exportVectorSvg: exportVectorSvg,
      destroy: destroy
    };
  }

  return { createApp: createApp };
}));
