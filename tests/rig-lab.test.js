'use strict';

// Lab module coverage: SHA-256 against Node crypto at every boundary length,
// the canonicaliser, both sweep engines, the palette audit, exporters, the
// proof digest surfaces and the hostile-input codec.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require('../engine.js');
const A = require('../assets/data.js');
const L = require('../rig-lab.js');

const DOMAINS = {
  vectors: A.VECTORS.map((v) => v.id),
  palettes: E.PALETTES.map((p) => p.id)
};

function refSha(bytes) {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function pseudoBytes(n, seed) {
  const out = new Uint8Array(n);
  let a = seed >>> 0;
  for (let i = 0; i < n; i += 1) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = (t ^ (t >>> 14)) >>> 24;
  }
  return out;
}

/* ------------------------- SHA-256 parity sweep ------------------------- */

for (let len = 0; len <= 160; len += 1) {
  test(`sha256Hex matches Node crypto at ${len}-byte boundary length`, () => {
    const bytes = pseudoBytes(len, len * 31 + 7);
    assert.equal(L.sha256Hex(bytes), refSha(bytes));
  });
}

test('sha256Hex matches Node crypto on ASCII strings of several sizes', () => {
  ['', 'a', 'abc', 'The quick brown fox jumps over the lazy dog', 'x'.repeat(55), 'y'.repeat(56),
    'z'.repeat(64), 'w'.repeat(119), 'q'.repeat(128), 'm'.repeat(1000)].forEach((s) => {
    assert.equal(L.sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  });
});

test('sha256Hex matches Node crypto on multibyte UTF-8 strings', () => {
  ['caf\u00e9', '\u00fc\u00df\u00e9', '\u20ac100', 'na\u00efve r\u00e9sum\u00e9'].forEach((s) => {
    assert.equal(L.sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  });
});

test('sha256Hex matches FIPS known-answer vectors', () => {
  assert.equal(L.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(L.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
  assert.equal(L.sha256Hex(msg), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  const long = 'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';
  assert.equal(L.sha256Hex(long), 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
});

test('sha256Hex matches crypto on the 1,000,000-a vector', () => {
  const s = 'a'.repeat(1000000);
  assert.equal(L.sha256Hex(s), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('utf8Encode round-trips through utf8Decode for ASCII and multibyte text', () => {
  ['', 'hello', 'caf\u00e9', '\u00fcmlaut', 'line\nbreak'].forEach((s) => {
    assert.equal(L.utf8Decode(L.utf8Encode(s)), s);
  });
});

test('b64urlEncode uses url-safe alphabet and b64urlDecode inverts it', () => {
  const bytes = pseudoBytes(40, 99);
  const enc = L.b64urlEncode(bytes);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(enc));
  assert.deepEqual(Array.from(L.b64urlDecode(enc)), Array.from(bytes));
});

test('b64urlEncode output never contains +, / or = padding', () => {
  for (const n of [1, 2, 3, 4, 5, 17, 33]) {
    const enc = L.b64urlEncode(pseudoBytes(n, n));
    assert.ok(!/[+/=]/.test(enc), enc);
  }
});

test('b64urlDecode rejects hostile and malformed strings', () => {
  assert.equal(L.b64urlDecode(''), null);
  assert.equal(L.b64urlDecode('A'), null);
  assert.equal(L.b64urlDecode('!!!!!'), null);
  assert.equal(L.b64urlDecode('a+b/c='), null);
  assert.equal(L.b64urlDecode('abcde'), null);
  assert.equal(L.b64urlDecode('x'.repeat(9000)), null);
  assert.equal(L.b64urlDecode(null), null);
  assert.equal(L.b64urlDecode(42), null);
});

/* --------------------------- canonicaliser ---------------------------- */

test('canonicalize sorts keys at every depth deterministically', () => {
  const a = L.canonicalize({ b: 1, a: { d: [3, 2], c: { z: 0, y: 1 } } });
  const b = L.canonicalize({ a: { c: { y: 1, z: 0 }, d: [3, 2] }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":{"y":1,"z":0},"d":[3,2]},"b":1}');
});

test('canonicalize handles cycles, shared references and depth bounds', () => {
  const cyc = { a: 1 };
  cyc.self = cyc;
  assert.equal(L.canonicalize(cyc), '{"a":1,"self":"<cycle>"}');
  const shared = { x: 1 };
  assert.equal(L.canonicalize({ p: shared, q: shared }), '{"p":{"x":1},"q":{"x":1}}');
  let deep = {};
  let cur = deep;
  for (let i = 0; i < 300; i += 1) { cur.n = {}; cur = cur.n; }
  const out = L.canonicalize(deep);
  assert.ok(out.includes('<depth>'));
  assert.ok(out.length < 10000);
});

test('canonicalize encodes __proto__ keys as data without polluting', () => {
  const obj = JSON.parse('{"__proto__":{"polluted":1},"safe":2}');
  const out = L.canonicalize(obj);
  assert.ok(out.includes('"__proto__":{"polluted":1}'));
  assert.equal({}.polluted, undefined);
});

test('canonicalize drops functions, symbols and undefined; nulls non-finite numbers', () => {
  assert.equal(L.canonicalize({ f() {}, s: Symbol('x'), u: undefined, n: null }), '{"n":null}');
  assert.equal(L.canonicalize({ a: NaN, b: Infinity, c: -Infinity, d: 1.5 }), '{"a":null,"b":null,"c":null,"d":1.5}');
  assert.equal(L.canonicalize(undefined), 'null');
  assert.equal(L.canonicalize(function () {}), 'null');
});

test('canonicalize encodes typed arrays as number arrays', () => {
  assert.equal(L.canonicalize(new Int16Array([-1, 0, 7])), '[-1,0,7]');
  assert.equal(L.canonicalize({ g: new Uint8Array([9, 8]) }), '{"g":[9,8]}');
});

test('digestOf is stable across key insertion order', () => {
  const d1 = L.digestOf({ a: 1, b: 2 });
  const d2 = L.digestOf({ b: 2, a: 1 });
  assert.equal(d1, d2);
  assert.match(d1, /^[0-9a-f]{64}$/);
});

/* ----------------------------- epsilons ------------------------------- */

test('logSpacedEpsilons produces the standard 11-step 0.05 to 6.00 sweep', () => {
  const eps = L.EPSILONS;
  assert.equal(eps.length, 11);
  assert.ok(Math.abs(eps[0] - 0.05) < 1e-9);
  assert.ok(Math.abs(eps[10] - 6) < 1e-9);
  for (let i = 1; i < eps.length; i += 1) {
    assert.ok(eps[i] > eps[i - 1], `step ${i}`);
    const ratio = eps[i] / eps[i - 1];
    assert.ok(Math.abs(ratio - Math.pow(120, 0.1)) < 1e-6, `ratio ${ratio}`);
  }
});

/* --------------------------- pareto sweeps ---------------------------- */

A.VECTORS.forEach((asset) => {
  const layer = L.primaryLayer(asset);
  const tr = L.specimenTrace(E, layer);
  const sweep = L.paretoSweep(E, tr.points, tr.closed);

  test(`pareto sweep for ${asset.id} has 11 ordered points with valid figures`, () => {
    assert.equal(sweep.length, 11);
    assert.ok(tr.points.length > 0);
    sweep.forEach((p, i) => {
      assert.equal(p.index, i);
      assert.ok(p.kept >= 2, `kept ${p.kept}`);
      assert.ok(p.kept <= p.tracePoints);
      assert.ok(p.reduction >= 0 && p.reduction <= 1);
      assert.ok(Number.isFinite(p.drift) && p.drift >= 0);
      assert.ok(p.bytesBefore > 0 && p.bytesAfter > 0);
    });
  });

  test(`pareto kept count for ${asset.id} is non-increasing as tolerance grows`, () => {
    for (let i = 1; i < sweep.length; i += 1) {
      assert.ok(sweep[i].kept <= sweep[i - 1].kept,
        `step ${i}: ${sweep[i].kept} > ${sweep[i - 1].kept}`);
    }
  });

  test(`pareto drift for ${asset.id} stays bounded and knee index is valid`, () => {
    const knee = L.paretoKneeIndex(sweep);
    assert.ok(knee >= 0 && knee < sweep.length);
    sweep.forEach((p) => {
      assert.ok(p.drift <= Math.max(1, tr.points.length), `drift ${p.drift}`);
    });
  });
});

test('paretoKneeIndex handles degenerate sweeps without throwing', () => {
  assert.equal(L.paretoKneeIndex([]), 0);
  assert.equal(L.paretoKneeIndex([{ drift: 0, reduction: 0 }]), 0);
  const flat = [
    { drift: 0, reduction: 0.5 }, { drift: 0, reduction: 0.5 }, { drift: 0, reduction: 0.5 }
  ];
  assert.equal(L.paretoKneeIndex(flat), 0);
});

test('specimenTrace flattens the same layer the bench edits', () => {
  const asset = A.getAsset('ginkgo-leaf');
  const tr = L.specimenTrace(E, L.primaryLayer(asset));
  assert.ok(tr.points.length > 100);
  assert.equal(tr.closed, true);
});

/* ----------------------------- atlas sweep ---------------------------- */

const PADS = [0, 1, 2, 4];
const EXTS = [0, 1, 2];

test('atlasConfigList enumerates all 12 pad/extrude pairs', () => {
  const list = L.atlasConfigList();
  assert.equal(list.length, 12);
  assert.deepEqual(list[0], { pad: 0, ext: 0 });
  assert.deepEqual(list[11], { pad: 4, ext: 2 });
});

test('atlasFrames returns real sprite frames or the seeded kit', () => {
  const px = L.atlasFrames(E, A, 'pixels');
  const kit = L.atlasFrames(E, A, 'kit');
  assert.equal(px.length, A.pixelAtlasFrames().length);
  assert.equal(kit.length, 32);
  assert.equal(L.atlasFrames(E, A, 'anything-else').length, px.length);
});

for (const src of ['pixels', 'kit']) {
  const frames = L.atlasFrames(E, A, src);
  for (const pot of [true, false]) {
    for (const pad of PADS) {
      for (const ext of EXTS) {
        test(`atlas ${src} pad=${pad} ext=${ext} pot=${pot} packs with zero overlaps`, () => {
          const row = L.packRow(E, frames, pad, ext, pot);
          assert.ok(row.packed, 'pack failed');
          assert.equal(row.problems.length, 0, row.problems.join(';'));
          assert.equal(row.frames, frames.length);
          assert.ok(row.width > 0 && row.height > 0);
          assert.ok(row.efficiency > 0 && row.efficiency <= 1);
          assert.ok(row.waste >= 0);
          if (pot) {
            const pow2 = (n) => (n & (n - 1)) === 0;
            assert.ok(pow2(row.width) && pow2(row.height), `${row.width}x${row.height}`);
          }
          const cell = (p) => 0; // keep placement check via validator above
          void cell;
        });
      }
    }
  }
}

test('atlasSweep returns the 12 config rows for a source', () => {
  const frames = L.atlasFrames(E, A, 'pixels');
  const rows = L.atlasSweep(E, frames, true);
  assert.equal(rows.length, 12);
  assert.ok(rows.every((r) => r.ok));
});

/* ---------------------------- palette audit --------------------------- */

const PAL_AUDIT = L.paletteAudit(E, A.TONES);

test('paletteAudit covers all six built-in palettes', () => {
  assert.equal(PAL_AUDIT.length, 6);
  assert.deepEqual(PAL_AUDIT.map((p) => p.id), E.PALETTES.map((p) => p.id));
});

PAL_AUDIT.forEach((pal) => {
  test(`palette ${pal.id} tone lightness is non-decreasing`, () => {
    assert.ok(pal.monotonic, JSON.stringify(pal.lightness));
    for (let i = 1; i < pal.lightness.length; i += 1) {
      assert.ok(pal.lightness[i] >= pal.lightness[i - 1] - 1e-9);
    }
  });
  test(`palette ${pal.id} contrast range is positive and pairs measured`, () => {
    assert.ok(pal.contrastRange > 0);
    assert.ok(pal.minPairDE >= 0 && pal.minPairDE <= pal.contrastRange);
    assert.ok(pal.minAdjacentDE >= 0 && pal.minAdjacentDE <= pal.contrastRange + 1e-9);
    assert.equal(pal.tones.length, A.TONES);
  });
  test(`palette ${pal.id} strict ordering matches its colour count`, () => {
    if (pal.size >= A.TONES) {
      assert.ok(pal.strict, `${pal.id} should be strict`);
    } else {
      assert.equal(pal.strict, pal.strict && pal.size >= A.TONES);
    }
  });
});

/* ------------------------------ exporters ----------------------------- */

const STATE = { spec: 'ginkgo-leaf', epsIdx: 5, pad: 2, ext: 1, pot: true, src: 'pixels', pal: 'archival' };

test('csvCell guards formula triggers and quotes separators', () => {
  assert.equal(L.csvCell('=cmd'), "'=cmd");
  assert.equal(L.csvCell('+1'), "'+1");
  assert.equal(L.csvCell('-1'), "'-1");
  assert.equal(L.csvCell('@x'), "'@x");
  assert.equal(L.csvCell('\tx'), "'\tx");
  assert.equal(L.csvCell('\ry'), '"\'\ry"');
  assert.equal(L.csvCell(' space'), "' space");
  assert.equal(L.csvCell('safe'), 'safe');
  assert.equal(L.csvCell('a,b'), '"a,b"');
  assert.equal(L.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(L.csvCell('line\nfeed'), '"line\nfeed"');
  assert.equal(L.csvCell(''), '');
  assert.equal(L.csvCell(null), '');
  assert.equal(L.csvCell(42), '42');
  assert.equal(L.csvCell('=a,b'), '"\'=a,b"');
});

test('buildPayload captures state, sweep, atlas and palette sections', () => {
  const p = L.buildPayload(E, A, STATE);
  assert.equal(p.app, 'paperclip-rig');
  assert.equal(p.engine, E.version);
  assert.equal(p.state.specimen, 'ginkgo-leaf');
  assert.equal(p.pareto.points.length, 11);
  assert.equal(p.atlas.rows.length, 12);
  assert.equal(p.palettes.length, 6);
  assert.ok(p.pareto.kneeIndex >= 0 && p.pareto.kneeIndex < 11);
});

test('stampPayload embeds a 64-hex digest that verifies', () => {
  const stamped = L.stampPayload(L.buildPayload(E, A, STATE));
  assert.match(stamped.digest, /^[0-9a-f]{64}$/);
  assert.equal(stamped.payload.integrity.digest, stamped.digest);
  assert.equal(L.verifyPayload(stamped.payload).ok, true);
});

test('stampedBrief caches one payload per state key', () => {
  L.clearBriefCache();
  const a = L.stampedBrief(E, A, STATE);
  const b = L.stampedBrief(E, A, STATE);
  assert.equal(a, b);
  const c = L.stampedBrief(E, A, Object.assign({}, STATE, { epsIdx: 6 }));
  assert.notEqual(a.digest, c.digest);
});

test('all four surfaces stamp the exact same digest', () => {
  const stamped = L.stampPayload(L.buildPayload(E, A, STATE));
  const d = stamped.digest;
  assert.ok(L.briefJson(stamped).includes(d));
  assert.ok(L.briefCsv(stamped).includes('sha256,' + d));
  assert.ok(L.briefMarkdown(stamped).includes('`' + d + '`'));
  assert.equal(stamped.payload.integrity.digest, d);
});

test('briefJson parses back to the stamped payload', () => {
  const stamped = L.stampPayload(L.buildPayload(E, A, STATE));
  const parsed = JSON.parse(L.briefJson(stamped));
  assert.equal(parsed.integrity.digest, stamped.digest);
  assert.equal(parsed.app, 'paperclip-rig');
});

test('briefCsv sections all appear with guarded cells', () => {
  const stamped = L.stampPayload(L.buildPayload(E, A, STATE));
  const csv = L.briefCsv(stamped);
  assert.ok(csv.startsWith('kind,key,value'));
  assert.ok(csv.includes('pareto,epsilon,kept,reduction_pct,drift,bytes_before,bytes_after'));
  assert.ok(csv.includes('atlas,pad,ext,width,height,frames,efficiency,waste_pct,ok'));
  assert.ok(csv.includes('palette,id,tones,monotonic,min_adjacent_dE,min_pair_dE,contrast_range'));
  assert.ok(csv.includes('integrity,sha256,' + stamped.digest));
  assert.ok(csv.split('\n').filter((l) => l.startsWith('pareto,')).length === 12); // header + 11 rows
});

test('briefMarkdown renders all three tables and the digest footer', () => {
  const stamped = L.stampPayload(L.buildPayload(E, A, STATE));
  const md = L.briefMarkdown(stamped);
  assert.ok(md.startsWith('# Paperclip Rig audit brief'));
  assert.ok(md.includes('## Pareto sweep'));
  assert.ok(md.includes('## Atlas sweep'));
  assert.ok(md.includes('## Palette audit'));
  assert.ok(md.includes('(knee)'));
  assert.ok(md.includes('SHA-256 (canonical JSON): `' + stamped.digest + '`'));
});

test('verifyPayload detects the stamped brief and rejects tampering', () => {
  const stamped = L.stampPayload(L.buildPayload(E, A, STATE));
  assert.equal(L.verifyPayload(stamped.payload).ok, true);
  const tampered = L.tamperPayload(stamped.payload);
  assert.equal(L.verifyPayload(tampered).ok, false);
  assert.notEqual(L.digestOf(tampered), stamped.digest);
  assert.equal(L.verifyPayload(null).ok, false);
  assert.equal(L.verifyPayload('string').ok, false);
  assert.equal(L.verifyPayload([1, 2]).ok, false);
});

test('tamperPayload changes exactly one numeric field deterministically', () => {
  const stamped = L.stampPayload(L.buildPayload(E, A, STATE));
  const t1 = L.tamperPayload(stamped.payload);
  const t2 = L.tamperPayload(stamped.payload);
  assert.equal(t1.pareto.points[0].kept, stamped.payload.pareto.points[0].kept + 1);
  assert.equal(L.digestOf(t1), L.digestOf(t2));
  assert.equal(t1.integrity, undefined);
});

/* ------------------------------- codec -------------------------------- */

const FULL_STATE = { spec: 'quill-feather', epsIdx: 9, pad: 4, ext: 2, pot: false, src: 'kit', pal: 'riso' };

test('encodeState then decodeState round-trips a full state', () => {
  const enc = L.encodeState(FULL_STATE);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(enc));
  const dec = L.decodeState(enc, DOMAINS);
  assert.deepEqual(dec, { s: 'quill-feather', e: 9, p: 4, x: 2, t: false, r: 'kit', c: 'riso' });
});

A.VECTORS.forEach((v, i) => {
  test(`codec round-trips specimen ${v.id}`, () => {
    const state = { spec: v.id, epsIdx: i % 11, pad: i % 5, ext: i % 3, pot: i % 2 === 0, src: i % 2 ? 'kit' : 'pixels', pal: E.PALETTES[i % 6].id };
    assert.deepEqual(L.decodeState(L.encodeState(state), DOMAINS),
      { s: v.id, e: i % 11, p: i % 5, x: i % 3, t: i % 2 === 0, r: i % 2 ? 'kit' : 'pixels', c: E.PALETTES[i % 6].id });
  });
});

function decRaw(str) {
  return L.decodeState(L.b64urlEncode(L.utf8Encode(str)), DOMAINS);
}

test('codec rejects non-base64url garbage', () => {
  assert.equal(L.decodeState('!!!', DOMAINS), null);
  assert.equal(L.decodeState('', DOMAINS), null);
  assert.equal(L.decodeState('a+b/c', DOMAINS), null);
  assert.equal(L.decodeState(null, DOMAINS), null);
  assert.equal(L.decodeState(123, DOMAINS), null);
});

test('codec rejects non-object JSON payloads', () => {
  assert.equal(decRaw('"just a string"'), null);
  assert.equal(decRaw('[1,2,3]'), null);
  assert.equal(decRaw('42'), null);
  assert.equal(decRaw('null'), null);
  assert.equal(decRaw('true'), null);
});

test('codec rejects the wrong version and missing fields', () => {
  assert.equal(decRaw('{"v":2,"s":"acorn","e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}'), null);
  assert.equal(decRaw('{"s":"acorn","e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}'), null);
  assert.equal(decRaw('{"v":1,"s":"acorn","e":1,"p":0,"x":0,"t":1,"r":"pixels"}'), null);
  assert.equal(decRaw('{"v":1,"e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}'), null);
});

test('codec rejects prototype pollution keys outright', () => {
  assert.equal(decRaw('{"v":1,"__proto__":{"x":1},"s":"acorn","e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}'), null);
  assert.equal(decRaw('{"v":1,"constructor":{"x":1},"s":"acorn","e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}'), null);
  assert.equal(decRaw('{"v":1,"prototype":{"x":1},"s":"acorn","e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}'), null);
  assert.equal({}.x, undefined);
  assert.equal({}.polluted, undefined);
});

test('codec rejects unknown specimens, palettes and sources', () => {
  assert.equal(decRaw('{"v":1,"s":"not-real","e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}'), null);
  assert.equal(decRaw('{"v":1,"s":"acorn","e":1,"p":0,"x":0,"t":1,"r":"other","c":"dmg"}'), null);
  assert.equal(decRaw('{"v":1,"s":"acorn","e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"nope"}'), null);
  assert.equal(decRaw('{"v":1,"s":"__proto__","e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}'), null);
});

test('codec rejects non-finite or wrong-typed numeric fields', () => {
  assert.equal(decRaw('{"v":1,"s":"acorn","e":"high","p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}'), null);
  assert.equal(decRaw('{"v":1,"s":"acorn","e":1,"p":"two","x":0,"t":1,"r":"pixels","c":"dmg"}'), null);
  assert.equal(decRaw('{"v":1,"s":"acorn","e":1,"p":0,"x":"x","t":1,"r":"pixels","c":"dmg"}'), null);
  assert.equal(decRaw('{"v":1,"s":"acorn","e":1,"p":0,"x":0,"t":2,"r":"pixels","c":"dmg"}'), null);
});

test('codec clamps numeric fields into legal bounds', () => {
  const dec = decRaw('{"v":1,"s":"acorn","e":99,"p":-5,"x":99,"t":1,"r":"pixels","c":"dmg"}');
  assert.deepEqual(dec, { s: 'acorn', e: 10, p: 0, x: 4, t: true, r: 'pixels', c: 'dmg' });
});

test('codec survives hostile fuzz strings without throwing', () => {
  const fuzz = ['{', '}', '{"v":1', '"\\ud800"', ' '.repeat(200), '\u0000\u0000', '{"v":1,"s":"acorn"'.repeat(5)];
  fuzz.forEach((f) => {
    assert.doesNotThrow(() => L.decodeState(L.b64urlEncode(L.utf8Encode(f)), DOMAINS));
    assert.doesNotThrow(() => L.decodeState(f, DOMAINS));
  });
});

/* --------------------------- in-page checks --------------------------- */

test('selfChecks battery reports at least 18 checks and all pass', () => {
  const checks = L.selfChecks(E, A);
  assert.ok(checks.length >= 18, `only ${checks.length} checks`);
  const fails = checks.filter((c) => !c.pass);
  assert.deepEqual(fails.map((c) => c.name + ': ' + c.detail), []);
});

test('selfChecks entries all carry name, pass flag and detail string', () => {
  L.selfChecks(E, A).forEach((c) => {
    assert.equal(typeof c.name, 'string');
    assert.equal(typeof c.pass, 'boolean');
    assert.equal(typeof c.detail, 'string');
  });
});
