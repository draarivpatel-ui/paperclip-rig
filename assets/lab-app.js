/*
 * Paperclip Rig audit and benchmark lab: page controller.
 *
 * Wires the #lab section to the engine through PaperclipLab. Every figure and
 * marker on the section is a real computation on the real fixtures: the RDP
 * Pareto sweep re-runs optimiseContour, the packing sweep re-runs
 * packSpriteAtlasMaxRects and validateAtlas, and the palette matrix reads the
 * same OKLab path the pixel bench uses.
 *
 * In the browser this file boots itself after assets/app.js; under Node it
 * exports createLab(doc, win, host) so the smoke tests can drive it with the
 * same fake DOM pattern as the three benches.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../engine.js'), require('./data.js'), require('../rig-lab.js'));
  } else {
    root.PaperclipLabApp = factory(root.PaperclipEngine, root.PaperclipAssets, root.PaperclipLab);
    var boot = function () {
      var host = root.PaperclipApp && root.PaperclipApp.instance ? root.PaperclipApp.instance : null;
      root.PaperclipLabApp.instance = root.PaperclipLabApp.createLab(root.document, root, host);
    };
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
}(this, function (E, A, L) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CHART_W = 340;
  var CHART_H = 220;
  var MARGIN = { left: 46, right: 14, top: 14, bottom: 32 };
  var PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
  var PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;

  function createLab(doc, win, host) {
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

    function setText(id, text) {
      var el = byId(id);
      if (el) { el.textContent = text; }
    }

    function announce(id, message) {
      var el = byId(id);
      if (el) { el.textContent = message; }
    }

    function reducedMotion() {
      return Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function scrollToId(id) {
      var target = byId(id);
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      }
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

    function fireInput(el) {
      if (!el) { return; }
      if (typeof el.dispatchEvent === 'function' && typeof win.Event === 'function') {
        el.dispatchEvent(new win.Event('input', { bubbles: true }));
      } else if (typeof el.emit === 'function') {
        el.emit('input');
      }
    }

    function fireChange(el) {
      if (!el) { return; }
      if (typeof el.dispatchEvent === 'function' && typeof win.Event === 'function') {
        el.dispatchEvent(new win.Event('change', { bubbles: true }));
      } else if (typeof el.emit === 'function') {
        el.emit('change');
      }
    }

    /* ------------------------------- lab state ------------------------------ */

    var lab = {
      spec: 'ginkgo-leaf', epsIdx: 5, pad: 2, ext: 1, pot: true, src: 'pixels', pal: 'archival',
      computed: null, stamped: null, checks: null,
      dom: { points: [], bars: [], rows: {} }
    };

    function domains() {
      return {
        vectors: A.VECTORS.map(function (v) { return v.id; }),
        palettes: E.PALETTES.map(function (p) { return p.id; })
      };
    }

    function labState() {
      return { spec: lab.spec, epsIdx: lab.epsIdx, pad: lab.pad, ext: lab.ext, pot: lab.pot, src: lab.src, pal: lab.pal };
    }

    function writeHash() {
      var enc = L.encodeState(labState());
      var frag = '#prlab=' + enc;
      if (win.history && win.history.replaceState) {
        win.history.replaceState(null, '', frag);
      } else if (win.location) {
        win.location.hash = frag;
      }
    }

    function readHash() {
      if (!win.location || typeof win.location.hash !== 'string') { return null; }
      var h = win.location.hash;
      if (h.indexOf('#prlab=') !== 0) { return null; }
      return L.decodeState(h.slice(7), domains());
    }

    function applyDecoded(dec) {
      lab.spec = dec.s;
      lab.epsIdx = dec.e;
      lab.pad = dec.p;
      lab.ext = dec.x;
      lab.pot = dec.t;
      lab.src = dec.r;
      lab.pal = dec.c;
    }

    function recompute() {
      lab.computed = L.computeLab(E, A, labState());
      lab.stamped = L.stampedBrief(E, A, labState(), lab.computed);
    }

    /* ------------------------------ pareto chart ---------------------------- */

    function px(v) { return Math.round(v * 100) / 100; }

    function axisTicks(svg, xLabel, yTicks) {
      svg.appendChild(svgEl('line', {
        'class': 'lab-axis-line', x1: MARGIN.left, y1: MARGIN.top,
        x2: MARGIN.left, y2: MARGIN.top + PLOT_H
      }));
      svg.appendChild(svgEl('line', {
        'class': 'lab-axis-line', x1: MARGIN.left, y1: MARGIN.top + PLOT_H,
        x2: MARGIN.left + PLOT_W, y2: MARGIN.top + PLOT_H
      }));
      yTicks.forEach(function (t) {
        var y = MARGIN.top + PLOT_H - t.frac * PLOT_H;
        svg.appendChild(svgEl('line', {
          'class': 'lab-grid-line', x1: MARGIN.left, y1: y, x2: MARGIN.left + PLOT_W, y2: y
        }));
        var tx = svgEl('text', { 'class': 'lab-tick', x: MARGIN.left - 6, y: y + 3, 'text-anchor': 'end' });
        tx.textContent = t.label;
        svg.appendChild(tx);
      });
      var xl = svgEl('text', {
        'class': 'lab-tick lab-tick-x', x: MARGIN.left + PLOT_W, y: CHART_H - 8, 'text-anchor': 'end'
      });
      xl.textContent = xLabel;
      svg.appendChild(xl);
    }

    function renderPareto() {
      var svg = byId('lab-pareto-svg');
      if (!svg) { return; }
      clearChildren(svg);
      var sweep = lab.computed.sweep;
      var maxDrift = 0;
      sweep.forEach(function (p) { maxDrift = Math.max(maxDrift, p.drift); });
      var span = maxDrift > 0 ? maxDrift * 1.06 : 1;
      var X = function (d) { return MARGIN.left + (d / span) * PLOT_W; };
      var Y = function (r) { return MARGIN.top + PLOT_H - r * PLOT_H; };
      axisTicks(svg, 'drift ' + px(maxDrift), [
        { frac: 0, label: '0%' }, { frac: 0.5, label: '50%' }, { frac: 1, label: '100%' }
      ]);
      var poly = sweep.map(function (p) { return px(X(p.drift)) + ',' + px(Y(p.reduction)); }).join(' ');
      svg.appendChild(svgEl('polyline', { 'class': 'lab-curve', points: poly }));
      lab.dom.points = sweep.map(function (p, i) {
        var g = svgEl('g', {
          'class': 'lab-pt' + (i === lab.computed.knee ? ' is-knee' : '') + (i === lab.epsIdx ? ' is-sel' : ''),
          'data-idx': String(i), role: 'button', tabindex: '0',
          'aria-label': 'Tolerance ' + p.epsilon.toFixed(3) + ', kept ' + p.kept + ' of ' +
            p.tracePoints + ', drift ' + p.drift.toFixed(3)
        });
        g.appendChild(svgEl('circle', { 'class': 'lab-hit', cx: px(X(p.drift)), cy: px(Y(p.reduction)), r: '9' }));
        g.appendChild(svgEl('circle', { 'class': 'lab-dot', cx: px(X(p.drift)), cy: px(Y(p.reduction)), r: '3.6' }));
        var act = function () { selectPareto(i); };
        on(g, 'click', act);
        on(g, 'keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectPareto(i);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            selectPareto(Math.max(0, i - 1));
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            selectPareto(Math.min(sweep.length - 1, i + 1));
          }
        });
        svg.appendChild(g);
        return g;
      });
      var caption = byId('lab-pareto-cap');
      if (caption) {
        caption.textContent = lab.computed.asset.name + ', ' + lab.computed.layer.label +
          ' layer, ' + lab.computed.trace.points.length + ' trace points';
      }
    }

    function updateParetoSel() {
      lab.dom.points.forEach(function (g, i) {
        g.classList.toggle('is-sel', i === lab.epsIdx);
        g.classList.toggle('is-knee', i === lab.computed.knee);
      });
      var p = lab.computed.sweep[lab.epsIdx];
      setText('lab-ro-eps', p.epsilon.toFixed(3) + ' units');
      setText('lab-ro-kept', p.kept + ' of ' + p.tracePoints);
      setText('lab-ro-red', (p.reduction * 100).toFixed(1) + '%');
      setText('lab-ro-drift', p.drift.toFixed(3) + ' units');
      var knee = lab.computed.sweep[lab.computed.knee];
      setText('lab-ro-knee', 'tolerance ' + knee.epsilon.toFixed(3));
    }

    function selectPareto(i) {
      lab.epsIdx = i;
      updateParetoSel();
      refreshBrief();
      writeHash();
      announce('lab-status', 'Tolerance ' + lab.computed.sweep[i].epsilon.toFixed(3) + ' selected.');
    }

    /* ------------------------------- atlas chart ---------------------------- */

    function renderAtlas() {
      var svg = byId('lab-atlas-svg');
      if (!svg) { return; }
      clearChildren(svg);
      var rows = lab.computed.atlas;
      axisTicks(svg, 'pad ' + L.PAD_VALUES.join(' '), [
        { frac: 0, label: '0%' }, { frac: 0.5, label: '50%' }, { frac: 1, label: '100%' }
      ]);
      var groupW = PLOT_W / L.PAD_VALUES.length;
      var barW = (groupW - 14) / L.EXTRUDE_VALUES.length;
      lab.dom.bars = [];
      rows.forEach(function (row, i) {
        var gi = L.PAD_VALUES.indexOf(row.pad);
        var bi = L.EXTRUDE_VALUES.indexOf(row.ext);
        var x = MARGIN.left + gi * groupW + 7 + bi * barW;
        var h = Math.max(0, row.efficiency) * PLOT_H;
        var g = svgEl('g', {
          'class': 'lab-bar lab-bar-e' + bi + (row.pad === lab.pad && row.ext === lab.ext ? ' is-sel' : ''),
          'data-pad': String(row.pad), 'data-ext': String(row.ext), role: 'button', tabindex: '0',
          'aria-label': 'Padding ' + row.pad + ', extrude ' + row.ext + ', efficiency ' +
            (row.efficiency * 100).toFixed(1) + '%'
        });
        g.appendChild(svgEl('rect', {
          'class': 'lab-hit', x: x - 1, y: MARGIN.top, width: barW + 2, height: PLOT_H
        }));
        g.appendChild(svgEl('rect', {
          'class': 'lab-fill', x: px(x), y: px(MARGIN.top + PLOT_H - h), width: px(barW - 2), height: px(h)
        }));
        var label = svgEl('text', {
          'class': 'lab-tick lab-tick-x', x: x + barW / 2 - 1, y: CHART_H - 8, 'text-anchor': 'middle'
        });
        label.textContent = bi === 1 ? 'p' + row.pad : '';
        g.appendChild(label);
        var act = function () { selectAtlas(row.pad, row.ext); };
        on(g, 'click', act);
        on(g, 'keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectAtlas(row.pad, row.ext);
          }
        });
        svg.appendChild(g);
        lab.dom.bars.push(g);
      });
      var caption = byId('lab-atlas-cap');
      if (caption) {
        var s = lab.src === 'kit' ? 'seeded UI kit' : 'real sprite frames';
        caption.textContent = lab.computed.frames.length + ' ' + s + ', ' +
          (lab.pot ? 'power of two' : 'tight') + ' sheets';
      }
    }

    function updateAtlasSel() {
      lab.dom.bars.forEach(function (g) {
        var sel = g.getAttribute('data-pad') === String(lab.pad) && g.getAttribute('data-ext') === String(lab.ext);
        g.classList.toggle('is-sel', sel);
      });
      var row = null;
      lab.computed.atlas.forEach(function (r) {
        if (r.pad === lab.pad && r.ext === lab.ext) { row = r; }
      });
      if (!row) { return; }
      setText('lab-at-cfg', 'pad ' + row.pad + ', extrude ' + row.ext);
      setText('lab-at-size', row.width + ' by ' + row.height);
      setText('lab-at-frames', row.frames + ' of ' + row.total);
      setText('lab-at-eff', (row.efficiency * 100).toFixed(1) + '%');
      setText('lab-at-waste', row.waste.toLocaleString('en-US') + ' px (' + (row.wastePct * 100).toFixed(1) + '%)');
      setText('lab-at-valid', row.problems.length === 0 ? 'No overlaps, all inside' : row.problems.length + ' problems');
    }

    function selectAtlas(pad, ext) {
      lab.pad = pad;
      lab.ext = ext;
      updateAtlasSel();
      refreshBrief();
      writeHash();
      announce('lab-status', 'Padding ' + pad + ', extrude ' + ext + ' selected.');
    }

    /* ------------------------------- palette table -------------------------- */

    function renderPalettes() {
      var tbody = byId('lab-palette-rows');
      if (!tbody) { return; }
      clearChildren(tbody);
      lab.dom.rows = {};
      lab.computed.palettes.forEach(function (pal) {
        var tr = htmlEl('tr', {
          'class': 'lab-pal' + (pal.id === lab.pal ? ' is-sel' : ''),
          'data-id': pal.id, tabindex: '0', role: 'button',
          'aria-label': pal.name + ', ' + (pal.monotonic ? 'monotonic' : 'not monotonic') +
            ', contrast ' + pal.contrastRange.toFixed(3)
        });
        var nameTd = htmlEl('td', {}, null);
        nameTd.appendChild(htmlEl('strong', {}, pal.name));
        tr.appendChild(nameTd);
        var toneTd = htmlEl('td', { 'class': 'lab-tones' });
        pal.tones.forEach(function (hex) {
          var sw = htmlEl('span', { 'class': 'lab-tone' });
          sw.style.setProperty('--tone', hex);
          toneTd.appendChild(sw);
        });
        tr.appendChild(toneTd);
        tr.appendChild(htmlEl('td', { 'class': 'lab-num' }, pal.lightness.map(function (l) {
          return l.toFixed(2);
        }).join(' ')));
        tr.appendChild(htmlEl('td', { 'class': 'lab-num' }, pal.minAdjacentDE.toFixed(3)));
        tr.appendChild(htmlEl('td', { 'class': 'lab-num' }, pal.minPairDE.toFixed(3)));
        tr.appendChild(htmlEl('td', { 'class': 'lab-num' }, pal.contrastRange.toFixed(3)));
        var act = function () { selectPalette(pal.id); };
        on(tr, 'click', act);
        on(tr, 'keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectPalette(pal.id);
          }
        });
        tbody.appendChild(tr);
        lab.dom.rows[pal.id] = tr;
      });
    }

    function selectPalette(id) {
      lab.pal = id;
      Object.keys(lab.dom.rows).forEach(function (k) {
        lab.dom.rows[k].classList.toggle('is-sel', k === id);
      });
      refreshBrief();
      writeHash();
      var pal = E.getPalette(id);
      announce('lab-status', 'Palette ' + (pal ? pal.name : id) + ' selected.');
    }

    /* ------------------------------- proof brief ---------------------------- */

    function refreshBrief() {
      lab.stamped = L.stampedBrief(E, A, labState(), lab.computed);
      setText('lab-digest', 'sha256 ' + lab.stamped.digest.slice(0, 20) + '...');
      var code = byId('lab-digest');
      if (code) { code.setAttribute('title', lab.stamped.digest); }
      var out = byId('lab-brief');
      if (out) { out.value = L.briefJson(lab.stamped); }
    }

    /* ------------------------------- self checks ---------------------------- */

    function runChecks() {
      lab.checks = L.selfChecks(E, A);
      var list = byId('lab-test-list');
      var passed = lab.checks.filter(function (c) { return c.pass; }).length;
      if (list) {
        clearChildren(list);
        lab.checks.forEach(function (c) {
          var li = htmlEl('li', { 'class': 'selftest-item' });
          li.appendChild(htmlEl('span', {
            'class': 'selftest-mark ' + (c.pass ? 'pass' : 'fail')
          }, c.pass ? 'pass' : 'FAIL'));
          var body = htmlEl('span', { 'class': 'selftest-name' }, c.name);
          li.appendChild(body);
          if (c.detail) {
            li.appendChild(htmlEl('code', { 'class': 'selftest-detail' }, String(c.detail).slice(0, 90)));
          }
          list.appendChild(li);
        });
      }
      var msg = passed + ' of ' + lab.checks.length + ' checks passed' +
        (passed === lab.checks.length ? '.' : ', ' + (lab.checks.length - passed) + ' failed.');
      setText('lab-test-summary', msg);
      announce('lab-status', msg);
      return lab.checks;
    }

    /* -------------------------------- wiring -------------------------------- */

    function wire() {
      var specSel = byId('lab-spec');
      if (specSel) {
        A.VECTORS.forEach(function (v) {
          specSel.appendChild(htmlEl('option', { value: v.id }, v.name));
        });
        specSel.value = lab.spec;
        on(specSel, 'change', function () {
          lab.spec = specSel.value;
          var asset = A.getAsset(lab.spec);
          var tr = L.specimenTrace(E, L.primaryLayer(asset));
          lab.computed.sweep = L.paretoSweep(E, tr.points, tr.closed);
          lab.computed.knee = L.paretoKneeIndex(lab.computed.sweep);
          lab.computed.asset = asset;
          lab.computed.layer = L.primaryLayer(asset);
          lab.computed.trace = tr;
          if (lab.epsIdx >= lab.computed.sweep.length) { lab.epsIdx = lab.computed.sweep.length - 1; }
          renderPareto();
          updateParetoSel();
          refreshBrief();
          writeHash();
          announce('lab-status', asset.name + ' loaded in the lab.');
        });
      }
      var srcSel = byId('lab-src');
      if (srcSel) {
        srcSel.value = lab.src;
        on(srcSel, 'change', function () {
          lab.src = srcSel.value;
          lab.computed.frames = L.atlasFrames(E, A, lab.src);
          lab.computed.atlas = L.atlasSweep(E, lab.computed.frames, lab.pot);
          renderAtlas();
          updateAtlasSel();
          refreshBrief();
          writeHash();
        });
      }
      var potEl = byId('lab-pot');
      if (potEl) {
        potEl.checked = lab.pot;
        on(potEl, 'change', function () {
          lab.pot = Boolean(potEl.checked);
          lab.computed.atlas = L.atlasSweep(E, lab.computed.frames, lab.pot);
          renderAtlas();
          updateAtlasSel();
          refreshBrief();
          writeHash();
        });
      }
      on(byId('lab-load-vector'), 'click', function () {
        var ok = host && host.loadVectorAsset ? host.loadVectorAsset(lab.spec) : false;
        var epsEl = byId('vec-epsilon');
        if (epsEl) {
          epsEl.value = String(lab.computed.sweep[lab.epsIdx].epsilon.toFixed(2));
          fireInput(epsEl);
        }
        scrollToId('top');
        announce('lab-status', ok ? 'Loaded ' + lab.spec + ' in the vector bench.' : 'Bench link unavailable.');
      });
      on(byId('lab-apply-palette'), 'click', function () {
        var sel = byId('px-palette');
        if (sel) {
          sel.value = lab.pal;
          fireChange(sel);
        }
        scrollToId('pixel');
        announce('lab-status', 'Palette ' + lab.pal + ' applied in the pixel bench.');
      });
      on(byId('lab-verify'), 'click', function () {
        var res = L.verifyPayload(lab.stamped.payload);
        setText('lab-verify-out', res.ok
          ? 'Digest verified: the badge matches a fresh SHA-256 of the canonical brief.'
          : 'Digest mismatch: expected ' + res.expected + ', computed ' + res.actual + '.');
      });
      on(byId('lab-tamper'), 'click', function () {
        var tampered = L.tamperPayload(lab.stamped.payload);
        var newDigest = L.digestOf(tampered);
        setText('lab-verify-out', 'Altered one kept-count by 1. Digest ' + newDigest.slice(0, 20) +
          '... does not match the badge.');
      });
      on(byId('lab-dl-json'), 'click', function () {
        saveFile('paperclip-rig-audit.json', L.briefJson(lab.stamped), 'application/json');
        announce('lab-status', 'Audit JSON downloaded.');
      });
      on(byId('lab-dl-csv'), 'click', function () {
        saveFile('paperclip-rig-audit.csv', L.briefCsv(lab.stamped), 'text/csv');
        announce('lab-status', 'Audit CSV downloaded.');
      });
      on(byId('lab-dl-md'), 'click', function () {
        saveFile('paperclip-rig-audit.md', L.briefMarkdown(lab.stamped), 'text/markdown');
        announce('lab-status', 'Audit Markdown downloaded.');
      });
      on(byId('lab-run-tests'), 'click', runChecks);
      on(win, 'hashchange', function () {
        var dec = readHash();
        if (dec) {
          applyDecoded(dec);
          recompute();
          syncControls();
          renderAll();
          announce('lab-status', 'Lab state restored from the bookmark.');
        }
      });
    }

    function syncControls() {
      var specSel = byId('lab-spec');
      if (specSel) { specSel.value = lab.spec; }
      var srcSel = byId('lab-src');
      if (srcSel) { srcSel.value = lab.src; }
      var potEl = byId('lab-pot');
      if (potEl) { potEl.checked = lab.pot; }
    }

    function renderAll() {
      renderPareto();
      updateParetoSel();
      renderAtlas();
      updateAtlasSel();
      renderPalettes();
      refreshBrief();
    }

    function init() {
      var dec = readHash();
      if (dec) { applyDecoded(dec); }
      wire();
      syncControls();
      recompute();
      renderAll();
    }

    function destroy() {
      timers.forEach(function (t) { win.clearTimeout(t); });
      timers = [];
    }

    init();

    return {
      lab: lab,
      selectPareto: selectPareto,
      selectAtlas: selectAtlas,
      selectPalette: selectPalette,
      runChecks: runChecks,
      refreshBrief: refreshBrief,
      recompute: recompute,
      destroy: destroy
    };
  }

  return { createLab: createLab };
}));
