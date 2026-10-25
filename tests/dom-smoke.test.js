'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const E = require('../engine.js');
const A = require('../assets/data.js');
const { createApp } = require('../assets/app.js');
const { buildFiles } = require('../scripts/export-assets.js');

const ROOT = path.join(__dirname, '..');

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.set = new Set();
  }
  syncFromAttr(val) {
    this.set.clear();
    String(val || '').split(/\s+/).filter(Boolean).forEach((c) => this.set.add(c));
  }
  syncToAttr() {
    this.owner.attributes['class'] = Array.from(this.set).join(' ');
  }
  add(c) {
    this.set.add(c);
    this.syncToAttr();
  }
  remove(c) {
    this.set.delete(c);
    this.syncToAttr();
  }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : Boolean(force);
    if (on) {
      this.set.add(c);
    } else {
      this.set.delete(c);
    }
    this.syncToAttr();
    return on;
  }
  contains(c) {
    return this.set.has(c);
  }
}

function makeCanvasContext() {
  const calls = [];
  return {
    calls,
    fillStyle: '#000',
    strokeStyle: '#000',
    globalAlpha: 1,
    lineWidth: 1,
    fillRect(x, y, w, h) { calls.push(['fillRect', x, y, w, h, this.fillStyle, this.globalAlpha]); },
    clearRect(x, y, w, h) { calls.push(['clearRect', x, y, w, h]); },
    strokeRect(x, y, w, h) { calls.push(['strokeRect', x, y, w, h]); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    stroke() { calls.push(['stroke']); }
  };
}

class FakeElement {
  constructor(tag, id) {
    this.tagName = String(tag || 'DIV').toUpperCase();
    this.id = id || '';
    this.attributes = {};
    if (id) { this.attributes.id = id; }
    this.classList = new FakeClassList(this);
    this.style = {
      props: {},
      setProperty(k, v) { this.props[k] = String(v); },
      getPropertyValue(k) { return this.props[k] || ''; }
    };
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.width = 320;
    this.height = 320;
    this.rect = { left: 0, top: 0, width: 320, height: 320 };
    this._ctx = null;
    this.focused = false;
    this.scrolled = null;
    this.clicked = false;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }

  setAttribute(k, v) {
    const str = String(v);
    this.attributes[k] = str;
    if (k === 'id') { this.id = str; }
    if (k === 'class') { this.classList.syncFromAttr(str); }
    if (k === 'value') { this.value = str; }
  }

  getAttribute(k) {
    return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) { this.listeners[type] = []; }
    this.listeners[type].push(fn);
  }

  emit(type, init) {
    const evt = Object.assign({
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }
    }, init || {});
    (this.listeners[type] || []).slice().forEach((fn) => fn(evt));
    return evt;
  }

  click() {
    this.clicked = true;
    this.emit('click');
  }

  focus() {
    this.focused = true;
    this.emit('focus');
  }

  scrollIntoView(opts) {
    this.scrolled = opts || {};
  }

  getBoundingClientRect() {
    return this.rect;
  }

  setPointerCapture(id) {
    this.capturedPointer = id;
  }

  getContext(kind) {
    if (kind !== '2d') { return null; }
    if (!this._ctx) { this._ctx = makeCanvasContext(); }
    return this._ctx;
  }

  querySelector(sel) {
    const tag = sel.toUpperCase();
    for (let i = 0; i < this.childNodes.length; i += 1) {
      const c = this.childNodes[i];
      if (c.tagName === tag) { return c; }
      const nested = c.querySelector ? c.querySelector(sel) : null;
      if (nested) { return nested; }
    }
    return null;
  }
}

function createHarness(options) {
  const opts = options || {};
  const byId = new Map();
  const radioGroups = new Map();
  const specimens = [];
  const downloads = [];
  const timers = [];
  const rafs = [];
  const observers = [];
  let clipboardText = '';
  let failClipboard = Boolean(opts.failClipboard);
  let nowMs = 100;

  function el(tag, id, attrs) {
    const node = new FakeElement(tag, id);
    if (id) { byId.set(id, node); }
    Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, attrs[k]));
    return node;
  }

  function makeRadioGroup(name, values, checkedVal) {
    const list = values.map((v) => {
      const input = el('input', '', { type: 'radio', name, value: v });
      input.value = String(v);
      input.checked = String(v) === String(checkedVal);
      return input;
    });
    radioGroups.set(name, list);
  }

  // Vector bench elements
  const vecPlate = el('svg', 'vector-plate');
  vecPlate.rect = { left: 0, top: 0, width: 120, height: 120 };
  el('g', 'vector-ghosts');
  el('g', 'vector-overlay');
  el('span', 'plate-title');
  el('select', 'vec-asset');
  el('select', 'vec-layer');
  makeRadioGroup('handle-mode', ['smooth', 'mirrored', 'free'], 'smooth');
  const vecEps = el('input', 'vec-epsilon');
  vecEps.value = '0.6';
  el('output', 'vec-epsilon-out');
  const vecPrec = el('input', 'vec-precision');
  vecPrec.value = '2';
  el('output', 'vec-precision-out');
  const vecComb = el('input', 'vec-comb');
  vecComb.checked = true;
  const vecTrace = el('input', 'vec-trace');
  vecTrace.checked = true;
  ['ro-trace', 'ro-kept', 'ro-bytes-before', 'ro-bytes-after', 'ro-saved',
    'ro-deviation', 'ro-nodes', 'ro-length', 'ro-bbox', 'ro-kmax'].forEach((id) => el('output', id));
  el('textarea', 'vec-d');
  const vecCopy = el('button', 'vec-copy');
  vecCopy.appendChild(el('span', '', {}));
  vecCopy.firstChild.textContent = 'Copy path';
  el('button', 'vec-download');
  el('button', 'vec-reset');
  el('p', 'vec-status');
  el('section', 'top');

  // Pixel bench elements
  el('section', 'pixel');
  const pxCanvas = el('canvas', 'px-canvas');
  pxCanvas.rect = { left: 0, top: 0, width: 320, height: 320 };
  el('p', 'px-caption');
  el('div', 'px-frames');
  el('canvas', 'px-preview');
  const pxPlay = el('button', 'px-play');
  pxPlay.appendChild(el('span', 'px-play-label'));
  const pxFps = el('input', 'px-fps');
  pxFps.value = '6';
  el('output', 'px-fps-out');
  el('select', 'px-asset');
  makeRadioGroup('px-size', ['16', '32'], '16');
  el('select', 'px-palette');
  el('div', 'px-swatches');
  makeRadioGroup('px-tool', ['pencil', 'line', 'fill', 'erase'], 'pencil');
  const pxOnion = el('input', 'px-onion');
  pxOnion.checked = true;
  const pxGrid = el('input', 'px-grid');
  pxGrid.checked = true;
  ['px-undo', 'px-add', 'px-dup', 'px-del', 'px-reset', 'px-png', 'px-svg'].forEach((id) => el('button', id));
  el('p', 'px-status');

  // Atlas bench elements
  el('svg', 'atlas-svg');
  el('figcaption', 'atlas-caption');
  el('output', 'at-eff');
  el('span', 'at-bar');
  ['at-size', 'at-frames', 'at-waste', 'at-valid'].forEach((id) => el('output', id));
  makeRadioGroup('at-source', ['pixels', 'kit'], 'pixels');
  ['at-count-field', 'at-max-field', 'at-seed-field'].forEach((id) => el('div', id));
  const atCount = el('input', 'at-count'); atCount.value = '32'; el('output', 'at-count-out');
  const atMax = el('input', 'at-max'); atMax.value = '48'; el('output', 'at-max-out');
  const atSeed = el('input', 'at-seed'); atSeed.value = '7'; el('output', 'at-seed-out');
  const atPad = el('input', 'at-padding'); atPad.value = '2'; el('output', 'at-padding-out');
  const atExt = el('input', 'at-extrude'); atExt.value = '1'; el('output', 'at-extrude-out');
  const atSort = el('select', 'at-sort'); atSort.value = 'maxside';
  const atLimit = el('select', 'at-limit'); atLimit.value = '1024';
  const atPot = el('input', 'at-pot'); atPot.checked = true;
  el('button', 'at-replay');
  const atFormat = el('select', 'at-format'); atFormat.value = 'hash';
  el('textarea', 'at-output');
  const atCopy = el('button', 'at-copy');
  atCopy.appendChild(el('span', '', {}));
  atCopy.firstChild.textContent = 'Copy descriptor';
  el('button', 'at-download-json');
  el('button', 'at-download-png');
  el('p', 'at-status');

  // Specimens
  A.ALL.forEach((asset) => {
    const li = el('li', '', { 'class': 'specimen', 'data-asset': asset.id });
    const fig = el('figure', '');
    const cap = el('figcaption', '');
    fig.appendChild(cap);
    li.appendChild(fig);
    specimens.push(li);
  });

  const body = el('body', 'body');
  const origAppend = body.appendChild.bind(body);
  body.appendChild = function (child) {
    origAppend(child);
    if (child.tagName === 'A') {
      const origClick = child.click.bind(child);
      child.click = function () {
        origClick();
        downloads.push({
          download: child.getAttribute('download'),
          href: child.getAttribute('href')
        });
      };
    }
    return child;
  };

  const docListeners = {};
  const doc = {
    readyState: 'complete',
    hidden: false,
    documentElement: el('html', 'html'),
    body,
    getElementById(id) { return byId.get(id) || null; },
    createElement(tag) { return new FakeElement(tag); },
    createElementNS(ns, tag) {
      const node = new FakeElement(tag);
      node.namespaceURI = ns;
      return node;
    },
    querySelectorAll(sel) {
      const m = /^input\[name="([^"]+)"\]$/.exec(sel);
      if (m) { return radioGroups.get(m[1]) || []; }
      if (sel === '.specimen[data-asset]') { return specimens; }
      return [];
    },
    addEventListener(type, fn) {
      if (!docListeners[type]) { docListeners[type] = []; }
      docListeners[type].push(fn);
    },
    emit(type, init) {
      (docListeners[type] || []).forEach((fn) => fn(Object.assign({ type }, init || {})));
    }
  };

  const blobs = [];
  const revokedUrls = [];

  class FakeBlob {
    constructor(parts, blobOpts) {
      this.parts = parts;
      this.type = blobOpts ? blobOpts.type : '';
    }
  }

  class FakeIntersectionObserver {
    constructor(cb) {
      this.cb = cb;
      this.observed = [];
      observers.push(this);
    }
    observe(target) {
      this.observed.push(target);
    }
    trigger(isIntersecting) {
      this.cb([{ isIntersecting }]);
    }
  }

  const win = {
    document: doc,
    Blob: FakeBlob,
    URL: {
      createObjectURL(blob) {
        const u = 'blob:fake-' + blobs.length;
        blobs.push({ url: u, blob });
        return u;
      },
      revokeObjectURL(u) {
        revokedUrls.push(u);
      }
    },
    navigator: opts.noClipboard ? {} : {
      clipboard: {
        writeText(text) {
          if (failClipboard) { return Promise.reject(new Error('denied')); }
          clipboardText = String(text);
          return Promise.resolve();
        }
      }
    },
    getComputedStyle() {
      return {
        getPropertyValue(name) {
          const map = {
            '--paper': '#F8F5EE',
            '--tray': '#EFEAE0',
            '--ultramarine': '#2B4C7E',
            '--vermilion': '#C84B31',
            '--rule-strong': '#8F876F',
            '--focus': '#2B4C7E'
          };
          return map[name] || '';
        }
      };
    },
    matchMedia() {
      return { matches: Boolean(opts.reducedMotion) };
    },
    performance: {
      now() { return nowMs; }
    },
    requestAnimationFrame(fn) {
      rafs.push(fn);
      return rafs.length;
    },
    cancelAnimationFrame(id) {
      if (rafs[id - 1]) { rafs[id - 1] = null; }
    },
    setTimeout(fn, ms) {
      timers.push({ fn, ms, cleared: false });
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) { timers[id - 1].cleared = true; }
    },
    IntersectionObserver: FakeIntersectionObserver
  };

  function chooseRadio(name, value) {
    const group = radioGroups.get(name) || [];
    let chosen = null;
    group.forEach((r) => {
      r.checked = r.value === String(value);
      if (r.checked) { chosen = r; }
    });
    if (chosen) { chosen.emit('change'); }
  }

  function flushTimers() {
    timers.slice().forEach((t) => {
      if (!t.cleared) {
        t.cleared = true;
        t.fn();
      }
    });
  }

  function stepRaf(deltaMs) {
    nowMs += deltaMs;
    const pending = rafs.splice(0, rafs.length).filter(Boolean);
    pending.forEach((fn) => fn(nowMs));
  }

  const app = createApp(doc, win);

  return {
    app,
    doc,
    win,
    byId,
    radioGroups,
    specimens,
    downloads,
    blobs,
    revokedUrls,
    timers,
    rafs,
    observers,
    chooseRadio,
    flushTimers,
    stepRaf,
    getClipboard() { return clipboardText; },
    setFailClipboard(v) { failClipboard = v; }
  };
}

/* --------------------- 1. Sample assets and exporter --------------------- */

test('assets/data.js exposes 10 layered vectors and 8 indexed pixel sprites', () => {
  assert.equal(A.VECTORS.length, 10);
  assert.equal(A.PIXELS.length, 8);
  assert.equal(A.ALL.length, 18);
  assert.equal(A.TONES, 5);
  assert.equal(A.VIEWBOX, 120);
  A.VECTORS.forEach((v) => {
    assert.equal(v.type, 'vector');
    assert.ok(v.layers.length >= 2);
    assert.equal(A.getAsset(v.id), v);
    const svg = A.vectorAssetToSvg(v);
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"'));
    assert.ok(svg.includes('<title>' + v.name + '</title>'));
  });
  A.PIXELS.forEach((p) => {
    assert.equal(p.type, 'pixel');
    assert.ok(p.size === 16 || p.size === 32);
    assert.ok(p.frames.length >= 1);
    assert.equal(A.getAsset(p.id), p);
    p.frames.forEach((g) => {
      assert.equal(g.width, p.size);
      assert.equal(g.height, p.size);
      assert.ok(E.countFilled(g) > 0);
    });
  });
  assert.equal(A.getAsset('non-existent'), null);
});

test('pixelAtlasFrames lists every frame of all 8 pixel sprites', () => {
  const frames = A.pixelAtlasFrames();
  const expectedCount = A.PIXELS.reduce((sum, a) => sum + a.frames.length, 0);
  assert.equal(frames.length, expectedCount);
  assert.deepEqual(frames[0], { name: 'traveler-walk_0', w: 16, h: 16 });
  assert.ok(frames.some((f) => f.name === 'windswept-sapling_3' && f.w === 32 && f.h === 32));
});

test('scripts/export-assets.js builds all 26 asset files matching disk', () => {
  const files = buildFiles();
  assert.equal(files.size, 26);
  files.forEach((content, rel) => {
    const full = path.join(ROOT, rel);
    assert.ok(fs.existsSync(full), 'missing file on disk: ' + rel);
    if (Buffer.isBuffer(content)) {
      const disk = fs.readFileSync(full);
      assert.equal(Buffer.compare(content, disk), 0, 'PNG mismatch for ' + rel);
    } else {
      const disk = fs.readFileSync(full, 'utf8');
      assert.equal(content, disk, 'SVG mismatch for ' + rel);
    }
  });
});

/* --------------------- 2. Initialisation and defaults -------------------- */

test('createApp boots with ginkgo-leaf in vector bench, traveler-walk in pixel bench, and packed atlas', () => {
  const h = createHarness();
  assert.equal(h.app.vec.asset.id, 'ginkgo-leaf');
  assert.equal(h.byId.get('plate-title').textContent, 'Ginkgo leaf, Blade layer');
  assert.equal(h.byId.get('vec-asset').childNodes.length, 10);
  assert.equal(h.byId.get('vec-layer').childNodes.length, h.app.vec.asset.layers.length);
  assert.ok(h.byId.get('vec-d').value.startsWith('M'));
  assert.equal(h.app.px.asset.id, 'traveler-walk');
  assert.equal(h.app.px.frames.length, 4);
  assert.equal(h.byId.get('px-swatches').childNodes.length, 5);
  assert.equal(h.byId.get('px-frames').childNodes.length, 4);
  assert.equal(h.app.at.atlas.ok, true);
  assert.equal(h.byId.get('at-valid').textContent, 'No overlaps, all inside');
  h.app.destroy();
});

test('reducedMotion preference prevents automatic walk-cycle playback on boot', () => {
  const normal = createHarness({ reducedMotion: false });
  assert.equal(normal.app.px.playing, true);
  assert.equal(normal.byId.get('px-play').getAttribute('aria-pressed'), 'true');
  normal.app.destroy();

  const reduced = createHarness({ reducedMotion: true });
  assert.equal(reduced.app.px.playing, false);
  assert.equal(reduced.byId.get('px-play').getAttribute('aria-pressed'), 'false');
  reduced.app.destroy();
});

/* -------------------------- 3. Vector bench ------------------------------ */

test('switching vector asset and layer updates plate title, ghosts, overlay and readouts', () => {
  const h = createHarness();
  const assetSel = h.byId.get('vec-asset');
  assetSel.value = 'lantern';
  assetSel.emit('change');
  assert.equal(h.app.vec.asset.id, 'lantern');
  assert.equal(h.byId.get('plate-title').textContent, 'Lantern, Glass layer');
  assert.equal(h.byId.get('vector-ghosts').childNodes.length, h.app.vec.asset.layers.length);

  const layerSel = h.byId.get('vec-layer');
  layerSel.value = '2';
  layerSel.emit('change');
  assert.equal(h.app.vec.layerIndex, 2);
  assert.equal(h.byId.get('plate-title').textContent, 'Lantern, Flame layer');
  assert.equal(h.app.loadVectorAsset('not-a-vector'), false);
  assert.equal(h.app.loadVectorLayer(99), false);
  h.app.destroy();
});

test('every vector asset loads cleanly and exports a standalone SVG with its simplified layer', () => {
  const h = createHarness();
  A.VECTORS.forEach((v) => {
    assert.equal(h.app.loadVectorAsset(v.id), true);
    const svg = h.app.exportVectorSvg();
    assert.ok(svg.includes('<title>' + v.name + '</title>'));
    assert.ok(svg.includes(h.app.vec.result.d));
  });
  h.app.destroy();
});

test('open stroke vector layers render without fill path and keep stroke-width on ghost paths', () => {
  const h = createHarness();
  h.app.loadVectorAsset('paperclip');
  assert.equal(h.app.vec.closed, false);
  assert.equal(h.app.vec.els.fill.getAttribute('d'), '');
  const ghostStroke = h.byId.get('vector-ghosts').firstChild;
  assert.equal(ghostStroke.getAttribute('stroke-width'), '5');
  h.app.destroy();
});

test('vector tolerance and decimal precision sliders recompute path and readouts', () => {
  const h = createHarness();
  const keptBefore = parseInt(h.byId.get('ro-kept').textContent, 10);
  const eps = h.byId.get('vec-epsilon');
  eps.value = '3.5';
  eps.emit('input');
  eps.emit('change');
  assert.equal(h.byId.get('vec-epsilon-out').textContent, '3.50 units');
  const keptAfter = parseInt(h.byId.get('ro-kept').textContent, 10);
  assert.ok(keptAfter < keptBefore);
  assert.ok(h.byId.get('vec-status').textContent.includes('Tolerance 3.50'));

  const dPrec2 = h.byId.get('vec-d').value;
  const prec = h.byId.get('vec-precision');
  prec.value = '0';
  prec.emit('input');
  assert.equal(h.byId.get('vec-precision-out').textContent, '0');
  const dPrec0 = h.byId.get('vec-d').value;
  assert.ok(!dPrec0.includes('.'));
  assert.ok(dPrec0.length < dPrec2.length);
  h.app.destroy();
});

test('curvature comb and trace checkboxes toggle SVG overlay visibility', () => {
  const h = createHarness();
  const comb = h.byId.get('vec-comb');
  const trace = h.byId.get('vec-trace');
  assert.equal(h.app.vec.els.combLines.getAttribute('visibility'), 'visible');
  assert.equal(h.app.vec.els.trace.getAttribute('visibility'), 'visible');

  comb.checked = false;
  comb.emit('change');
  trace.checked = false;
  trace.emit('change');
  assert.equal(h.app.vec.els.combLines.getAttribute('visibility'), 'hidden');
  assert.equal(h.app.vec.els.combTips.getAttribute('visibility'), 'hidden');
  assert.equal(h.app.vec.els.trace.getAttribute('visibility'), 'hidden');
  assert.equal(h.app.vec.els.keptGroup.getAttribute('visibility'), 'hidden');
  h.app.destroy();
});

test('dragging a vector anchor node updates coordinates and resets cleanly', () => {
  const h = createHarness();
  const plate = h.byId.get('vector-plate');
  const nodeEl = h.app.vec.els.nodes[1];
  const origX = h.app.vec.nodes[1].x;
  const origY = h.app.vec.nodes[1].y;

  plate.emit('pointerdown', { target: nodeEl.firstChild, clientX: origX, clientY: origY, pointerId: 1 });
  plate.emit('pointermove', { clientX: 25, clientY: 30 });
  plate.emit('pointerup', {});
  assert.equal(h.app.vec.selected, 1);
  assert.equal(h.app.vec.nodes[1].x, 25);
  assert.equal(h.app.vec.nodes[1].y, 30);
  assert.ok(h.byId.get('vec-status').textContent.includes('Moved anchor 2'));

  h.byId.get('vec-reset').click();
  assert.equal(h.app.vec.nodes[1].x, origX);
  assert.equal(h.app.vec.nodes[1].y, origY);
  assert.equal(h.byId.get('vec-status').textContent, 'Layer reset.');
  h.app.destroy();
});

test('dragging vector handles in smooth, mirrored and free modes obeys handle constraints', () => {
  const h = createHarness();
  const plate = h.byId.get('vector-plate');
  const node = h.app.vec.nodes[1];
  const outHandle = h.app.vec.els.handles[1][1];

  h.chooseRadio('handle-mode', 'mirrored');
  plate.emit('pointerdown', { target: outHandle.firstChild, clientX: node.x, clientY: node.y, pointerId: 2 });
  plate.emit('pointermove', { clientX: node.x + 10, clientY: node.y });
  plate.emit('pointerup', {});
  assert.equal(h.app.vec.nodes[1].outX, Math.round((node.x + 10) * 10) / 10);
  assert.equal(h.app.vec.nodes[1].inX, Math.round((node.x - 10) * 10) / 10);

  h.chooseRadio('handle-mode', 'free');
  const inBefore = h.app.vec.nodes[1].inX;
  plate.emit('pointerdown', { target: outHandle.firstChild, clientX: node.x, clientY: node.y, pointerId: 3 });
  plate.emit('pointermove', { clientX: node.x + 18, clientY: node.y + 4 });
  plate.emit('pointerup', {});
  assert.equal(h.app.vec.nodes[1].inX, inBefore);
  h.app.destroy();
});

test('keyboard arrows nudge vector anchors and handles with Shift step of 5', () => {
  const h = createHarness();
  const plate = h.byId.get('vector-plate');
  const node2 = h.app.vec.els.nodes[2];
  const startX = h.app.vec.nodes[2].x;
  const startY = h.app.vec.nodes[2].y;

  plate.emit('keydown', { target: node2, key: 'Enter' });
  assert.equal(h.app.vec.selected, 2);

  plate.emit('keydown', { target: node2, key: 'ArrowRight', shiftKey: false });
  assert.equal(h.app.vec.nodes[2].x, Math.round((startX + 1) * 10) / 10);

  plate.emit('keydown', { target: node2, key: 'ArrowDown', shiftKey: true });
  assert.equal(h.app.vec.nodes[2].y, Math.round((startY + 5) * 10) / 10);

  plate.emit('keydown', { target: node2, key: 'ArrowUp', shiftKey: false });
  assert.equal(h.app.vec.nodes[2].y, Math.round((startY + 4) * 10) / 10);

  const inHandle = h.app.vec.els.handles[2][0];
  const startInX = h.app.vec.nodes[2].inX;
  plate.emit('keydown', { target: inHandle, key: 'ArrowLeft', shiftKey: false });
  assert.equal(h.app.vec.nodes[2].inX, Math.round((startInX - 1) * 10) / 10);

  plate.emit('keydown', { target: node2, key: 'Tab' });
  plate.emit('keydown', { target: plate, key: 'ArrowLeft' });
  plate.emit('pointerdown', { target: plate, clientX: 10, clientY: 10 });
  h.app.destroy();
});

test('vector copy button writes to clipboard and flashes success or error state', async () => {
  const h = createHarness();
  const copyBtn = h.byId.get('vec-copy');
  copyBtn.click();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.getClipboard(), h.app.vec.result.d);
  assert.equal(copyBtn.classList.contains('is-success'), true);
  assert.equal(copyBtn.firstChild.textContent, 'Copied');
  h.flushTimers();
  assert.equal(copyBtn.classList.contains('is-success'), false);
  assert.equal(copyBtn.firstChild.textContent, 'Copy path');

  h.setFailClipboard(true);
  copyBtn.click();
  await new Promise((r) => setImmediate(r));
  assert.equal(copyBtn.classList.contains('is-error'), true);
  assert.equal(copyBtn.firstChild.textContent, 'Copy failed');
  h.flushTimers();
  h.app.destroy();
});

test('vector download button creates an SVG blob, triggers download and revokes object URL', () => {
  const h = createHarness();
  h.byId.get('vec-download').click();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].download, 'ginkgo-leaf-simplified.svg');
  assert.equal(h.blobs[0].blob.type, 'image/svg+xml');
  assert.ok(String(h.blobs[0].blob.parts[0]).includes('<svg'));
  h.flushTimers();
  assert.equal(h.revokedUrls.length, 1);
  h.app.destroy();
});

/* --------------------------- 4. Pixel bench ------------------------------ */

test('pixel bench switches sprites and canvas sizes between 16x16 and 32x32', () => {
  const h = createHarness();
  h.chooseRadio('px-size', '32');
  assert.equal(h.app.px.asset.id, 'windswept-sapling');
  assert.equal(h.app.px.size, 32);
  assert.ok(h.byId.get('px-caption').textContent.includes('32 by 32'));

  const assetSel = h.byId.get('px-asset');
  assetSel.value = 'treasure-chest';
  assetSel.emit('change');
  assert.equal(h.app.px.asset.id, 'treasure-chest');
  assert.equal(h.app.px.size, 16);
  assert.equal(h.app.loadPixelAsset('unknown-sprite'), false);
  h.app.destroy();
});

test('pixel bench switches palettes and selects tone swatches', () => {
  const h = createHarness();
  const palSel = h.byId.get('px-palette');
  E.PALETTES.forEach((p) => {
    palSel.value = p.id;
    palSel.emit('change');
    assert.equal(h.app.px.palette, p.id);
    assert.ok(h.byId.get('px-status').textContent.includes(p.name));
  });

  const swatch3 = h.byId.get('px-swatches').childNodes[3];
  swatch3.click();
  assert.equal(h.app.px.tone, 3);
  assert.equal(swatch3.getAttribute('aria-pressed'), 'true');
  h.app.destroy();
});

test('pixel canvas supports pencil and erase tools across drag strokes', () => {
  const h = createHarness();
  h.app.loadPixelAsset('heart-container');
  const canvas = h.byId.get('px-canvas');
  h.app.px.tone = 4;

  canvas.emit('pointerdown', { clientX: 5, clientY: 5, pointerId: 1 });
  canvas.emit('pointermove', { clientX: 45, clientY: 5 });
  canvas.emit('pointerup', { clientX: 45, clientY: 5 });
  assert.equal(E.getPixel(h.app.px.frames[0], 0, 0), 4);
  assert.equal(E.getPixel(h.app.px.frames[0], 1, 0), 4);
  assert.equal(E.getPixel(h.app.px.frames[0], 2, 0), 4);

  h.chooseRadio('px-tool', 'erase');
  canvas.emit('pointerdown', { clientX: 25, clientY: 5, pointerId: 1 });
  canvas.emit('pointerup', { clientX: 25, clientY: 5 });
  assert.equal(E.getPixel(h.app.px.frames[0], 1, 0), E.TRANSPARENT);
  h.app.destroy();
});

test('pixel canvas supports Bresenham line and 4-connected flood fill tools', () => {
  const h = createHarness();
  h.app.loadPixelAsset('heart-container');
  const canvas = h.byId.get('px-canvas');

  h.chooseRadio('px-tool', 'line');
  h.app.px.tone = 1;
  canvas.emit('pointerdown', { clientX: 5, clientY: 310, pointerId: 1 });
  canvas.emit('pointermove', { clientX: 65, clientY: 310 });
  canvas.emit('pointerup', { clientX: 65, clientY: 310 });
  for (let x = 0; x <= 3; x += 1) {
    assert.equal(E.getPixel(h.app.px.frames[0], x, 15), 1);
  }

  h.byId.get('px-add').click();
  h.chooseRadio('px-tool', 'fill');
  h.app.px.tone = 2;
  canvas.emit('pointerdown', { clientX: 5, clientY: 5, pointerId: 1 });
  canvas.emit('pointerup', { clientX: 5, clientY: 5 });
  assert.equal(E.countFilled(h.app.px.frames[h.app.px.frame]), 256);
  h.app.destroy();
});

test('pixel canvas keyboard navigation, two-step line tool, Escape cancel and Ctrl+Z undo', () => {
  const h = createHarness();
  h.app.loadPixelAsset('heart-container');
  const canvas = h.byId.get('px-canvas');
  h.chooseRadio('px-tool', 'pencil');
  h.app.px.tone = 3;

  canvas.emit('keydown', { key: 'ArrowRight' });
  canvas.emit('keydown', { key: 'ArrowDown' });
  canvas.emit('keydown', { key: 'ArrowLeft' });
  canvas.emit('keydown', { key: 'ArrowUp' });
  canvas.emit('keydown', { key: 'ArrowRight' });
  canvas.emit('keydown', { key: 'ArrowDown' });
  assert.deepEqual(h.app.px.cursor, { x: 1, y: 1 });
  canvas.emit('keydown', { key: ' ' });
  assert.equal(E.getPixel(h.app.px.frames[0], 1, 1), 3);

  canvas.emit('keydown', { key: 'z', ctrlKey: true });
  assert.equal(E.getPixel(h.app.px.frames[0], 1, 1), E.TRANSPARENT);

  h.chooseRadio('px-tool', 'line');
  canvas.emit('keydown', { key: 'Enter' });
  assert.deepEqual(h.app.px.lineStart, { x: 1, y: 1 });
  canvas.emit('keydown', { key: 'Escape' });
  assert.equal(h.app.px.lineStart, null);

  canvas.emit('keydown', { key: 'Enter' });
  canvas.emit('keydown', { key: 'ArrowRight' });
  canvas.emit('keydown', { key: 'ArrowRight' });
  canvas.emit('keydown', { key: 'Enter' });
  assert.equal(E.getPixel(h.app.px.frames[0], 1, 1), 3);
  assert.equal(E.getPixel(h.app.px.frames[0], 2, 1), 3);
  assert.equal(E.getPixel(h.app.px.frames[0], 3, 1), 3);
  h.app.destroy();
});

test('pixel frame add, duplicate, delete, undo and reset buttons maintain valid state', () => {
  const h = createHarness();
  h.app.loadPixelAsset('door-key');
  assert.equal(h.app.px.frames.length, 1);

  h.byId.get('px-del').click();
  assert.equal(h.app.px.frames.length, 1);
  assert.ok(h.byId.get('px-status').textContent.includes('at least one frame'));

  h.byId.get('px-undo').click();
  assert.equal(h.byId.get('px-status').textContent, 'Nothing to undo.');

  h.byId.get('px-add').click();
  assert.equal(h.app.px.frames.length, 2);
  assert.equal(E.countFilled(h.app.px.frames[1]), 0);

  h.byId.get('px-frames').childNodes[0].click();
  assert.equal(h.app.px.frame, 0);
  h.byId.get('px-dup').click();
  assert.equal(h.app.px.frames.length, 3);
  assert.equal(E.countFilled(h.app.px.frames[1]), E.countFilled(h.app.px.frames[0]));

  h.byId.get('px-del').click();
  assert.equal(h.app.px.frames.length, 2);

  h.byId.get('px-reset').click();
  assert.equal(h.app.px.frames.length, 1);
  h.app.destroy();
});

test('pixel undo stack caps at 40 snapshots without leaking memory', () => {
  const h = createHarness();
  h.app.loadPixelAsset('heart-container');
  const canvas = h.byId.get('px-canvas');
  for (let i = 0; i < 45; i += 1) {
    canvas.emit('keydown', { key: ' ' });
  }
  assert.equal(h.app.px.undo.length, 40);
  h.app.destroy();
});

test('pixel animation loop, speed slider, play/pause toggle and IntersectionObserver work', () => {
  const h = createHarness({ reducedMotion: false });
  assert.equal(h.app.px.playing, true);
  const fps = h.byId.get('px-fps');
  fps.value = '10';
  fps.emit('input');
  assert.equal(h.byId.get('px-fps-out').textContent, '10 fps');

  h.stepRaf(120);
  assert.equal(h.app.px.shown, 1);

  h.byId.get('px-play').click();
  assert.equal(h.app.px.playing, false);
  assert.equal(h.byId.get('px-play-label').textContent, 'Play');
  h.byId.get('px-play').click();
  assert.equal(h.app.px.playing, true);
  assert.equal(h.byId.get('px-play-label').textContent, 'Pause');

  assert.equal(h.observers.length, 1);
  h.observers[0].trigger(false);
  assert.equal(h.app.px.visible, false);
  h.observers[0].trigger(true);
  h.doc.emit('visibilitychange');
  h.app.destroy();
});

test('pixel onion skin, grid checkboxes and PNG/SVG sprite sheet downloads work', () => {
  const h = createHarness();
  const onion = h.byId.get('px-onion');
  const grid = h.byId.get('px-grid');
  onion.checked = false;
  onion.emit('change');
  grid.checked = false;
  grid.emit('change');
  assert.equal(h.app.px.onion, false);
  assert.equal(h.app.px.grid, false);

  h.byId.get('px-png').click();
  h.byId.get('px-svg').click();
  assert.equal(h.downloads.length, 2);
  assert.equal(h.downloads[0].download, 'traveler-walk-sheet.png');
  assert.equal(h.blobs[0].blob.type, 'image/png');
  assert.equal(h.downloads[1].download, 'traveler-walk-sheet.svg');
  assert.equal(h.blobs[1].blob.type, 'image/svg+xml');
  h.app.destroy();
});

/* --------------------------- 5. Atlas bench ------------------------------ */

test('atlas bench switches between pixel samples and seeded UI kit with slider controls', () => {
  const h = createHarness();
  assert.equal(h.byId.get('at-count-field').hidden, true);
  h.chooseRadio('at-source', 'kit');
  assert.equal(h.byId.get('at-count-field').hidden, false);
  assert.equal(h.app.at.frames.length, 32);

  const count = h.byId.get('at-count');
  count.value = '18';
  count.emit('input');
  assert.equal(h.byId.get('at-count-out').textContent, '18');
  assert.equal(h.app.at.atlas.placements.length, 18);

  const seed = h.byId.get('at-seed');
  seed.value = '19';
  seed.emit('input');
  assert.equal(h.byId.get('at-seed-out').textContent, '19');
  assert.equal(h.app.at.seed, 19);

  const pad = h.byId.get('at-padding');
  pad.value = '4';
  pad.emit('input');
  assert.equal(h.byId.get('at-padding-out').textContent, '4 px');
  assert.equal(h.app.at.atlas.padding, 4);

  const ext = h.byId.get('at-extrude');
  ext.value = '2';
  ext.emit('input');
  assert.equal(h.byId.get('at-extrude-out').textContent, '2 px');
  assert.equal(h.app.at.atlas.extrude, 2);

  const sort = h.byId.get('at-sort');
  sort.value = 'area';
  sort.emit('change');
  assert.equal(h.app.at.sort, 'area');

  const pot = h.byId.get('at-pot');
  pot.checked = false;
  pot.emit('change');
  assert.equal(h.app.at.atlas.powerOfTwo, false);
  h.app.destroy();
});

test('atlas bench reports overflow cleanly when frames exceed the chosen sheet limit', () => {
  const h = createHarness();
  h.chooseRadio('at-source', 'kit');
  const count = h.byId.get('at-count'); count.value = '90'; count.emit('input');
  const max = h.byId.get('at-max'); max.value = '96'; max.emit('input');
  const limit = h.byId.get('at-limit'); limit.value = '256'; limit.emit('change');

  assert.equal(h.app.at.atlas.ok, false);
  assert.equal(h.byId.get('at-size').textContent, 'does not fit');
  assert.equal(h.byId.get('at-valid').textContent, 'raise the sheet limit');
  assert.equal(h.byId.get('at-output').value, '');

  h.byId.get('at-download-png').click();
  assert.equal(h.downloads.length, 0);
  assert.ok(h.byId.get('at-status').textContent.includes('did not fit'));
  h.app.destroy();
});

test('atlas bench exports all five descriptor formats, replays animation and downloads PNG/JSON/CSS', async () => {
  const h = createHarness();
  const fmt = h.byId.get('at-format');
  const out = h.byId.get('at-output');

  ['hash', 'array', 'phaser', 'godot'].forEach((f) => {
    fmt.value = f;
    fmt.emit('change');
    const parsed = JSON.parse(out.value);
    assert.equal(typeof parsed, 'object');
  });

  fmt.value = 'css';
  fmt.emit('change');
  assert.ok(out.value.includes('.sprite-traveler-walk_0'));

  h.byId.get('at-download-json').click();
  assert.equal(h.downloads[0].download, 'atlas.css');
  assert.equal(h.blobs[0].blob.type, 'text/css');

  fmt.value = 'hash';
  fmt.emit('change');
  h.byId.get('at-download-json').click();
  assert.equal(h.downloads[1].download, 'atlas.json');
  assert.equal(h.blobs[1].blob.type, 'application/json');

  h.byId.get('at-download-png').click();
  assert.equal(h.downloads[2].download, 'atlas.png');
  assert.equal(h.blobs[2].blob.type, 'image/png');

  h.byId.get('at-replay').click();
  assert.equal(h.byId.get('atlas-svg').classList.contains('is-replay'), true);

  h.byId.get('at-copy').click();
  await new Promise((r) => setImmediate(r));
  assert.ok(h.getClipboard().includes('traveler-walk_0'));
  h.app.destroy();
});

test('atlas PNG export also works when source is the seeded UI kit', () => {
  const h = createHarness();
  h.chooseRadio('at-source', 'kit');
  h.byId.get('at-download-png').click();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].download, 'atlas.png');
  assert.equal(h.blobs[0].blob.type, 'image/png');
  assert.ok(h.blobs[0].blob.parts[0].length > 100);
  h.app.destroy();
});

/* --------------------- 6. Specimen shelf and hygiene --------------------- */

test('specimen shelf buttons open vector and pixel assets in their benches and scroll', () => {
  const h = createHarness();
  assert.equal(h.specimens.length, 18);
  const acornLi = h.specimens.find((li) => li.getAttribute('data-asset') === 'acorn');
  const acornBtn = acornLi.querySelector('figcaption').firstChild;
  assert.equal(acornBtn.textContent, 'Edit in vector bench');
  acornBtn.click();
  assert.equal(h.app.vec.asset.id, 'acorn');
  assert.ok(h.byId.get('top').scrolled !== null);

  const slimeLi = h.specimens.find((li) => li.getAttribute('data-asset') === 'slime-bounce');
  const slimeBtn = slimeLi.querySelector('figcaption').firstChild;
  assert.equal(slimeBtn.textContent, 'Open in pixel bench');
  slimeBtn.click();
  assert.equal(h.app.px.asset.id, 'slime-bounce');
  assert.ok(h.byId.get('pixel').scrolled !== null);
  h.app.destroy();
});

test('missing navigator.clipboard rejects copy cleanly and flashes error state', async () => {
  const h = createHarness({ noClipboard: true });
  const copyBtn = h.byId.get('vec-copy');
  copyBtn.click();
  await new Promise((r) => setImmediate(r));
  assert.equal(copyBtn.classList.contains('is-error'), true);
  h.flushTimers();
  assert.equal(copyBtn.classList.contains('is-error'), false);
  h.app.destroy();
});

test('index.html contains every ID used by assets/app.js and zero banned typography or punctuation', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const requiredIds = [
    'vector-plate', 'vector-ghosts', 'vector-overlay', 'plate-title',
    'vec-asset', 'vec-layer', 'vec-epsilon', 'vec-epsilon-out', 'vec-precision', 'vec-precision-out',
    'vec-comb', 'vec-trace', 'ro-trace', 'ro-kept', 'ro-bytes-before', 'ro-bytes-after', 'ro-saved',
    'ro-deviation', 'ro-nodes', 'ro-length', 'ro-bbox', 'ro-kmax', 'vec-d', 'vec-copy', 'vec-download',
    'vec-reset', 'vec-status', 'px-canvas', 'px-caption', 'px-frames', 'px-preview', 'px-play',
    'px-play-label', 'px-fps', 'px-fps-out', 'px-asset', 'px-palette', 'px-swatches', 'px-onion',
    'px-grid', 'px-undo', 'px-add', 'px-dup', 'px-del', 'px-reset', 'px-png', 'px-svg', 'px-status',
    'atlas-svg', 'atlas-caption', 'at-eff', 'at-bar', 'at-size', 'at-frames', 'at-waste', 'at-valid',
    'at-count-field', 'at-max-field', 'at-seed-field', 'at-count', 'at-count-out', 'at-max', 'at-max-out',
    'at-seed', 'at-seed-out', 'at-padding', 'at-padding-out', 'at-extrude', 'at-extrude-out', 'at-sort',
    'at-limit', 'at-pot', 'at-replay', 'at-format', 'at-output', 'at-copy', 'at-download-json',
    'at-download-png', 'at-status'
  ];
  requiredIds.forEach((id) => {
    assert.ok(html.includes('id="' + id + '"'), 'missing id in index.html: ' + id);
  });

  const textFiles = ['index.html', 'styles.css', 'tokens.css', 'engine.js', 'assets/app.js', 'assets/data.js'];
  textFiles.forEach((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(/[\u2013\u2014]/.test(src), false, 'em or en dash in ' + rel);
  });
});
