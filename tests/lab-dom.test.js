'use strict';

// Lab controller coverage under the same fake DOM as the benches: markers,
// bars, palette rows, proof buttons, downloads, hash round-trips.

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/data.js');
const E = require('../engine.js');
const L = require('../rig-lab.js');
const { createLab } = require('../assets/lab-app.js');

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
  add(c) { this.set.add(c); this.syncToAttr(); }
  remove(c) { this.set.delete(c); this.syncToAttr(); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : Boolean(force);
    if (on) { this.set.add(c); } else { this.set.delete(c); }
    this.syncToAttr();
    return on;
  }
  contains(c) { return this.set.has(c); }
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
    this.scrolled = null;
  }

  get firstChild() { return this.childNodes[0] || null; }

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
    if (child.parentNode) { child.parentNode.removeChild(child); }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) { this.childNodes.splice(idx, 1); child.parentNode = null; }
    return child;
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) { this.listeners[type] = []; }
    this.listeners[type].push(fn);
  }

  emit(type, init) {
    const evt = Object.assign({
      type, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }
    }, init || {});
    (this.listeners[type] || []).slice().forEach((fn) => fn(evt));
    return evt;
  }

  click() { this.emit('click'); }

  scrollIntoView(opts) { this.scrolled = opts || {}; }
}

const LAB_IDS = [
  'lab-spec', 'lab-pareto-svg', 'lab-pareto-cap',
  'lab-ro-eps', 'lab-ro-kept', 'lab-ro-red', 'lab-ro-drift', 'lab-ro-knee',
  'lab-load-vector',
  'lab-atlas-svg', 'lab-atlas-cap', 'lab-src', 'lab-pot',
  'lab-at-cfg', 'lab-at-size', 'lab-at-frames', 'lab-at-eff', 'lab-at-waste', 'lab-at-valid',
  'lab-palette-rows', 'lab-apply-palette',
  'lab-digest', 'lab-verify', 'lab-tamper', 'lab-dl-json', 'lab-dl-csv', 'lab-dl-md',
  'lab-verify-out', 'lab-brief',
  'lab-run-tests', 'lab-test-summary', 'lab-test-list', 'lab-status',
  'vec-epsilon', 'px-palette', 'top', 'pixel'
];

function createLabHarness(opts) {
  opts = opts || {};
  const byId = new Map();
  const downloads = [];
  const timers = [];

  function el(tag, id) {
    const node = new FakeElement(tag, id);
    if (id) { byId.set(id, node); }
    return node;
  }

  LAB_IDS.forEach((id) => {
    const tag = id === 'lab-brief' ? 'textarea'
      : /svg/.test(id) ? 'svg'
      : /cap/.test(id) ? 'figcaption'
      : /^(lab-spec|lab-src|px-palette)$/.test(id) ? 'select'
      : /^(lab-pot|vec-epsilon)$/.test(id) ? 'input'
      : /^(top|pixel)$/.test(id) ? 'section'
      : /^lab-palette-rows$/.test(id) ? 'tbody'
      : /^lab-(digest|verify-out|test-summary|status|ro-|at-)/.test(id) ? 'output'
      : 'button';
    el(tag, id);
  });
  byId.get('vec-epsilon').value = '0.6';
  ['archival', 'botanical', 'riso', 'dmg', 'pico8', 'blueprint'].forEach((p) => {
    const o = el('option');
    o.setAttribute('value', p);
    byId.get('px-palette').appendChild(o);
  });

  const body = el('body', 'body');
  const origAppend = body.appendChild.bind(body);
  body.appendChild = function (child) {
    origAppend(child);
    if (child.tagName === 'A') {
      const origClick = child.click.bind(child);
      child.click = function () {
        origClick();
        downloads.push({ download: child.getAttribute('download'), href: child.getAttribute('href') });
      };
    }
    return child;
  };

  const doc = {
    readyState: 'complete',
    body,
    getElementById(id) { return byId.get(id) || null; },
    createElement(tag) { return new FakeElement(tag); },
    createElementNS(ns, tag) {
      const node = new FakeElement(tag);
      node.namespaceURI = ns;
      return node;
    }
  };

  const winListeners = {};
  const win = {
    document: doc,
    location: { hash: opts.hash || '' },
    history: { replaceState(a, b, frag) { this.frag = frag; doc.lastFrag = frag; } },
    matchMedia() { return { matches: false }; },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    Blob: class { constructor(parts, o) { this.parts = parts; this.type = o ? o.type : ''; } },
    URL: {
      createObjectURL() { return 'blob:fake'; },
      revokeObjectURL() {}
    },
    addEventListener(type, fn) {
      if (!winListeners[type]) { winListeners[type] = []; }
      winListeners[type].push(fn);
    },
    emit(type, init) {
      (winListeners[type] || []).forEach((fn) => fn(Object.assign({ type }, init || {})));
    }
  };

  const hostCalls = [];
  const host = {
    loadVectorAsset(id) { hostCalls.push(id); return A.getAsset(id) !== null; }
  };

  const lab = createLab(doc, win, host);
  return { lab, doc, win, byId, downloads, hostCalls, body };
}

function childrenWithClass(el, cls) {
  return el.childNodes.filter((c) => c.classList.contains(cls));
}

/* ------------------------------- boot state ------------------------------ */

test('createLab boots with defaults and renders both charts', () => {
  const h = createLabHarness();
  assert.equal(childrenWithClass(h.byId.get('lab-pareto-svg'), 'lab-pt').length, 11);
  assert.equal(childrenWithClass(h.byId.get('lab-atlas-svg'), 'lab-bar').length, 12);
  assert.equal(h.byId.get('lab-palette-rows').childNodes.length, 6);
  assert.equal(h.byId.get('lab-spec').childNodes.length, 10);
  assert.match(h.byId.get('lab-digest').textContent, /^sha256 [0-9a-f]{20}\.\.\.$/);
  h.lab.destroy();
});

test('boot populates readouts from the real sweep', () => {
  const h = createLabHarness();
  const sweep = L.paretoSweep(E, L.specimenTrace(E, L.primaryLayer(A.getAsset('ginkgo-leaf'))).points, true);
  const p = sweep[5];
  assert.equal(h.byId.get('lab-ro-kept').textContent, p.kept + ' of ' + p.tracePoints);
  assert.ok(h.byId.get('lab-pareto-cap').textContent.includes('Ginkgo'));
  assert.ok(h.byId.get('lab-atlas-cap').textContent.includes('real sprite frames'));
  h.lab.destroy();
});

test('the knee marker gets the is-knee class exactly once', () => {
  const h = createLabHarness();
  const pts = childrenWithClass(h.byId.get('lab-pareto-svg'), 'lab-pt');
  const knees = pts.filter((g) => g.classList.contains('is-knee'));
  assert.equal(knees.length, 1);
  assert.equal(knees[0].getAttribute('data-idx'), String(h.lab.lab.computed.knee));
  h.lab.destroy();
});

/* ------------------------------ interactions ----------------------------- */

test('clicking a pareto marker selects it, updates readouts and writes the hash', () => {
  const h = createLabHarness();
  const pts = childrenWithClass(h.byId.get('lab-pareto-svg'), 'lab-pt');
  pts[8].emit('click');
  assert.equal(h.lab.lab.epsIdx, 8);
  assert.ok(pts[8].classList.contains('is-sel'));
  assert.equal(h.byId.get('lab-ro-eps').textContent, L.EPSILONS[8].toFixed(3) + ' units');
  assert.ok(h.win.history.frag.startsWith('#prlab='));
  h.lab.destroy();
});

test('marker keyboard: Enter selects, arrows move the selection', () => {
  const h = createLabHarness();
  const pts = childrenWithClass(h.byId.get('lab-pareto-svg'), 'lab-pt');
  pts[3].emit('keydown', { key: 'Enter' });
  assert.equal(h.lab.lab.epsIdx, 3);
  pts[3].emit('keydown', { key: 'ArrowRight' });
  assert.equal(h.lab.lab.epsIdx, 4);
  pts[4].emit('keydown', { key: 'ArrowLeft' });
  assert.equal(h.lab.lab.epsIdx, 3);
  pts[0].emit('keydown', { key: ' ' });
  assert.equal(h.lab.lab.epsIdx, 0);
  h.lab.destroy();
});

test('changing the specimen select rebuilds the sweep and chart', () => {
  const h = createLabHarness();
  const sel = h.byId.get('lab-spec');
  sel.value = 'toadstool';
  sel.emit('change');
  assert.equal(h.lab.lab.spec, 'toadstool');
  assert.equal(childrenWithClass(h.byId.get('lab-pareto-svg'), 'lab-pt').length, 11);
  assert.ok(h.byId.get('lab-pareto-cap').textContent.includes('Toadstool'));
  const fresh = L.paretoSweep(E, L.specimenTrace(E, L.primaryLayer(A.getAsset('toadstool'))).points,
    L.specimenTrace(E, L.primaryLayer(A.getAsset('toadstool'))).closed);
  assert.equal(h.lab.lab.computed.sweep.length, fresh.length);
  h.lab.destroy();
});

test('clicking an atlas bar selects the pad/extrude pair and updates readouts', () => {
  const h = createLabHarness();
  const bars = childrenWithClass(h.byId.get('lab-atlas-svg'), 'lab-bar');
  const target = bars.find((g) => g.getAttribute('data-pad') === '4' && g.getAttribute('data-ext') === '2');
  target.emit('click');
  assert.equal(h.lab.lab.pad, 4);
  assert.equal(h.lab.lab.ext, 2);
  assert.ok(target.classList.contains('is-sel'));
  assert.equal(h.byId.get('lab-at-cfg').textContent, 'pad 4, extrude 2');
  assert.equal(h.byId.get('lab-at-valid').textContent, 'No overlaps, all inside');
  h.lab.destroy();
});

test('the pot checkbox re-runs the sweep and toggles sheet size', () => {
  const h = createLabHarness();
  const potSizes = h.byId.get('lab-at-size').textContent;
  const pot = h.byId.get('lab-pot');
  pot.checked = false;
  pot.emit('change');
  assert.equal(h.lab.lab.pot, false);
  const tight = h.byId.get('lab-at-size').textContent;
  assert.notEqual(tight, potSizes);
  assert.ok(h.byId.get('lab-atlas-cap').textContent.includes('tight'));
  h.lab.destroy();
});

test('switching frame source to the kit re-renders the caption', () => {
  const h = createLabHarness();
  const sel = h.byId.get('lab-src');
  sel.value = 'kit';
  sel.emit('change');
  assert.equal(h.lab.lab.src, 'kit');
  assert.ok(h.byId.get('lab-atlas-cap').textContent.includes('seeded UI kit'));
  h.lab.destroy();
});

test('clicking a palette row selects it and marks it in the table', () => {
  const h = createLabHarness();
  const rows = h.byId.get('lab-palette-rows').childNodes;
  rows[3].emit('click');
  assert.equal(h.lab.lab.pal, 'dmg');
  assert.ok(rows[3].classList.contains('is-sel'));
  assert.ok(!rows[0].classList.contains('is-sel'));
  rows[0].emit('keydown', { key: 'Enter' });
  assert.equal(h.lab.lab.pal, 'archival');
  h.lab.destroy();
});

test('each palette row carries swatches and numeric metrics', () => {
  const h = createLabHarness();
  const row = h.byId.get('lab-palette-rows').childNodes[0];
  assert.equal(row.childNodes.length, 6);
  const swatches = row.childNodes[1].childNodes;
  assert.equal(swatches.length, 5);
  assert.ok(swatches.every((s) => s.style.props['--tone'].startsWith('#')));
  h.lab.destroy();
});

/* ------------------------------ proof brief ------------------------------ */

test('digest badge and textarea carry the same stamped digest', () => {
  const h = createLabHarness();
  const digest = h.lab.lab.stamped.digest;
  assert.ok(h.byId.get('lab-brief').value.includes(digest));
  assert.ok(h.byId.get('lab-digest').textContent.includes(digest.slice(0, 20)));
  h.lab.destroy();
});

test('verify button reports a verified digest', () => {
  const h = createLabHarness();
  h.byId.get('lab-verify').emit('click');
  assert.ok(h.byId.get('lab-verify-out').textContent.startsWith('Digest verified'));
  h.lab.destroy();
});

test('tamper button reports a digest mismatch', () => {
  const h = createLabHarness();
  h.byId.get('lab-tamper').emit('click');
  const msg = h.byId.get('lab-verify-out').textContent;
  assert.ok(msg.includes('does not match the badge'));
  assert.match(msg, /Digest [0-9a-f]{20}\.\.\./);
  h.lab.destroy();
});

test('state changes re-stamp the digest identically across surfaces', () => {
  const h = createLabHarness();
  const rows = h.byId.get('lab-palette-rows').childNodes;
  rows[2].emit('click');
  const digest = h.lab.lab.stamped.digest;
  assert.ok(h.byId.get('lab-brief').value.includes(digest));
  h.byId.get('lab-verify').emit('click');
  assert.ok(h.byId.get('lab-verify-out').textContent.startsWith('Digest verified'));
  h.lab.destroy();
});

test('download buttons queue JSON, CSV and Markdown files', () => {
  const h = createLabHarness();
  h.byId.get('lab-dl-json').emit('click');
  h.byId.get('lab-dl-csv').emit('click');
  h.byId.get('lab-dl-md').emit('click');
  assert.deepEqual(h.downloads.map((d) => d.download), [
    'paperclip-rig-audit.json', 'paperclip-rig-audit.csv', 'paperclip-rig-audit.md'
  ]);
  assert.ok(h.downloads.every((d) => d.href === 'blob:fake'));
  h.lab.destroy();
});

/* ------------------------------- self tests ------------------------------ */

test('self-test runner lists all checks and reports an all-pass summary', () => {
  const h = createLabHarness();
  h.byId.get('lab-run-tests').emit('click');
  const list = h.byId.get('lab-test-list');
  assert.ok(list.childNodes.length >= 18);
  list.childNodes.forEach((li) => {
    const mark = li.childNodes[0];
    assert.ok(mark.classList.contains('pass'), mark.textContent);
    assert.equal(mark.textContent, 'pass');
  });
  assert.match(h.byId.get('lab-test-summary').textContent, /^(\d+) of \1 checks passed\.$/);
  assert.ok(h.byId.get('lab-status').textContent.includes('checks passed'));
  h.lab.destroy();
});

/* ------------------------------ bench wiring ----------------------------- */

test('load in vector bench forwards the specimen and tolerance', () => {
  const h = createLabHarness();
  const pts = childrenWithClass(h.byId.get('lab-pareto-svg'), 'lab-pt');
  pts[8].emit('click');
  h.byId.get('lab-load-vector').emit('click');
  assert.deepEqual(h.hostCalls, ['ginkgo-leaf']);
  assert.equal(h.byId.get('vec-epsilon').value, L.EPSILONS[8].toFixed(2));
  assert.ok(h.byId.get('top').scrolled);
  h.lab.destroy();
});

test('apply palette sets the pixel bench select and scrolls to it', () => {
  const h = createLabHarness();
  h.byId.get('lab-palette-rows').childNodes[4].emit('click');
  h.byId.get('lab-apply-palette').emit('click');
  assert.equal(h.byId.get('px-palette').value, 'pico8');
  assert.ok(h.byId.get('pixel').scrolled);
  h.lab.destroy();
});

/* ------------------------------ hash codec ------------------------------- */

test('a valid #prlab= hash at boot restores every field', () => {
  const enc = L.encodeState({ spec: 'lantern', epsIdx: 7, pad: 4, ext: 2, pot: false, src: 'kit', pal: 'blueprint' });
  const h = createLabHarness({ hash: '#prlab=' + enc });
  assert.equal(h.lab.lab.spec, 'lantern');
  assert.equal(h.lab.lab.epsIdx, 7);
  assert.equal(h.lab.lab.pad, 4);
  assert.equal(h.lab.lab.ext, 2);
  assert.equal(h.lab.lab.pot, false);
  assert.equal(h.lab.lab.src, 'kit');
  assert.equal(h.lab.lab.pal, 'blueprint');
  assert.equal(h.byId.get('lab-spec').value, 'lantern');
  h.lab.destroy();
});

test('corrupt, wrong-version and hostile hashes fall back to defaults', () => {
  ['#prlab=!!!not-base64', '#prlab=' + L.b64urlEncode(L.utf8Encode('{"v":9}')),
    '#prlab=' + L.b64urlEncode(L.utf8Encode('{"v":1,"__proto__":1,"s":"acorn","e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}')),
    '#other-hash'].forEach((hash) => {
    const h = createLabHarness({ hash });
    assert.equal(h.lab.lab.spec, 'ginkgo-leaf', hash);
    h.lab.destroy();
  });
});

test('the written hash decodes back to the exact live state', () => {
  const h = createLabHarness();
  h.lab.selectPalette('pico8');
  h.lab.selectAtlas(4, 2);
  const frag = h.win.history.frag;
  assert.ok(frag.startsWith('#prlab='));
  const dec = L.decodeState(frag.slice(7), {
    vectors: A.VECTORS.map((v) => v.id),
    palettes: E.PALETTES.map((p) => p.id)
  });
  assert.equal(dec.s, h.lab.lab.spec);
  assert.equal(dec.p, 4);
  assert.equal(dec.x, 2);
  assert.equal(dec.c, 'pico8');
  h.lab.destroy();
});
