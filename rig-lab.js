/*
 * Paperclip Rig audit and benchmark lab: deterministic helpers.
 *
 * One UMD file with no dependencies of its own. In the browser it loads as a
 * plain <script> (global PaperclipLab) after engine.js; under Node it is a
 * CommonJS module. Every helper is pure and deterministic, so the page, the
 * exported proof brief and the Node test suite agree byte for byte.
 *
 * Three groups of helpers live here:
 *   1. Proof plumbing: UTF-8 and base64url codecs, a pure JS SHA-256
 *      (FIPS 180-4), and a canonical JSON serialiser (sorted keys,
 *      cycle-safe, depth-bounded) used to stamp the audit brief with one
 *      digest on every surface.
 *   2. Lab computations that drive the real engine: a Ramer-Douglas-Peucker
 *      Pareto sweep over the vector specimens, a MaxRects packing sweep over
 *      the sprite frames and a seeded UI kit, and an OKLab palette audit.
 *   3. Exporters (JSON, spreadsheet-safe CSV, Markdown), the fail-closed
 *      #prlab= state codec, and the in-page self-test battery.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PaperclipLab = factory();
  }
}(this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var hasOwn = Object.prototype.hasOwnProperty;

  /* ------------------------------------------------------------------ */
  /* UTF-8 and base64url                                                 */
  /* ------------------------------------------------------------------ */

  function utf8Encode(str) {
    var out = [];
    for (var i = 0; i < str.length; i += 1) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var lo = str.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          var cp = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i += 1;
        } else {
          out.push(0xef, 0xbf, 0xbd);
        }
      } else {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      }
    }
    return Uint8Array.from(out);
  }

  function utf8Decode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 1) {
      var b = bytes[i];
      if (b < 0x80) {
        out += String.fromCharCode(b);
      } else if (b >= 0xc0 && b < 0xe0 && i + 1 < bytes.length) {
        out += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63));
        i += 1;
      } else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) {
        out += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63));
        i += 2;
      } else if (b >= 0xf0 && i + 3 < bytes.length) {
        var cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
        i += 3;
      } else {
        out += '�';
      }
    }
    return out;
  }

  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64_RE = /^[A-Za-z0-9_-]+$/;

  function b64urlEncode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += B64_CHARS.charAt(b0 >> 2);
      out += B64_CHARS.charAt(((b0 & 3) << 4) | (b1 >> 4));
      if (i + 1 < bytes.length) { out += B64_CHARS.charAt(((b1 & 15) << 2) | (b2 >> 6)); }
      if (i + 2 < bytes.length) { out += B64_CHARS.charAt(b2 & 63); }
    }
    return out;
  }

  function b64urlDecode(str) {
    if (typeof str !== 'string' || str.length === 0 || str.length > 8192) { return null; }
    if (!B64_RE.test(str) || str.length % 4 === 1) { return null; }
    var lookup = {};
    for (var i = 0; i < 64; i += 1) { lookup[B64_CHARS.charAt(i)] = i; }
    var out = [];
    var acc = 0;
    var bits = 0;
    for (var j = 0; j < str.length; j += 1) {
      acc = (acc << 6) | lookup[str.charAt(j)];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >> bits) & 255);
      }
    }
    return Uint8Array.from(out);
  }

  /* ------------------------------------------------------------------ */
  /* SHA-256 (FIPS 180-4) in pure JS                                     */
  /* ------------------------------------------------------------------ */

  var K256 = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  /**
   * SHA-256 over a string (UTF-8) or a byte array, returning lowercase hex.
   * Implemented straight from FIPS 180-4; matches Node crypto on every input.
   */
  function sha256Hex(input) {
    var bytes = typeof input === 'string' ? utf8Encode(input) : input;
    var len = bytes.length;
    var total = (len + 8 + 64) & ~63;
    var msg = new Uint8Array(total);
    msg.set(bytes);
    msg[len] = 0x80;
    var bitLen = len * 8;
    var hi = Math.floor(bitLen / 0x100000000);
    var lo = bitLen >>> 0;
    msg[total - 8] = (hi >>> 24) & 255;
    msg[total - 7] = (hi >>> 16) & 255;
    msg[total - 6] = (hi >>> 8) & 255;
    msg[total - 5] = hi & 255;
    msg[total - 4] = (lo >>> 24) & 255;
    msg[total - 3] = (lo >>> 16) & 255;
    msg[total - 2] = (lo >>> 8) & 255;
    msg[total - 1] = lo & 255;

    var H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    var w = new Int32Array(64);
    var a, b, c, d, e, f, g, h, i;
    for (var off = 0; off < total; off += 64) {
      for (i = 0; i < 16; i += 1) {
        w[i] = (msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) |
          (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3];
      }
      for (i = 16; i < 64; i += 1) {
        var w15 = w[i - 15];
        var w2 = w[i - 2];
        var s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
        var s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      a = H[0]; b = H[1]; c = H[2]; d = H[3];
      e = H[4]; f = H[5]; g = H[6]; h = H[7];
      for (i = 0; i < 64; i += 1) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0;
      H[1] = (H[1] + b) | 0;
      H[2] = (H[2] + c) | 0;
      H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0;
      H[5] = (H[5] + f) | 0;
      H[6] = (H[6] + g) | 0;
      H[7] = (H[7] + h) | 0;
    }
    var out = '';
    for (i = 0; i < 8; i += 1) {
      var hex = (H[i] >>> 0).toString(16);
      out += '00000000'.slice(hex.length) + hex;
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Canonical JSON                                                      */
  /* ------------------------------------------------------------------ */

  var MAX_DEPTH = 64;

  /**
   * Canonical serialiser for digesting: object keys sorted, arrays in order,
   * cycles and over-depth nesting replaced with stable markers, functions and
   * undefined dropped, non-finite numbers normalised to null. Every value is
   * reached through own-enumerable properties only, so a __proto__ key in the
   * data is encoded as plain data and cannot leak onto Object.prototype.
   */
  function canonicalize(value) {
    var seen = [];

    function enc(v, depth) {
      if (v === null) { return 'null'; }
      var t = typeof v;
      if (t === 'number') { return isFinite(v) ? JSON.stringify(v) : 'null'; }
      if (t === 'boolean') { return v ? 'true' : 'false'; }
      if (t === 'string') { return JSON.stringify(v); }
      if (t === 'bigint') { return JSON.stringify(v.toString()); }
      if (t === 'undefined' || t === 'function' || t === 'symbol') { return undefined; }
      if (depth >= MAX_DEPTH) { return '"<depth>"'; }
      if (seen.indexOf(v) >= 0) { return '"<cycle>"'; }
      seen.push(v);
      var out;
      if (Array.isArray(v)) {
        var parts = [];
        for (var i = 0; i < v.length; i += 1) {
          var s = enc(v[i], depth + 1);
          parts.push(s === undefined ? 'null' : s);
        }
        out = '[' + parts.join(',') + ']';
      } else if (ArrayBuffer.isView(v)) {
        var parts2 = [];
        for (var j = 0; j < v.length; j += 1) {
          var s2 = enc(v[j], depth + 1);
          parts2.push(s2 === undefined ? 'null' : s2);
        }
        out = '[' + parts2.join(',') + ']';
      } else {
        var keys = Object.keys(v).sort();
        var kvs = [];
        for (var k = 0; k < keys.length; k += 1) {
          var key = keys[k];
          var sv = enc(v[key], depth + 1);
          if (sv !== undefined) { kvs.push(JSON.stringify(key) + ':' + sv); }
        }
        out = '{' + kvs.join(',') + '}';
      }
      seen.pop();
      return out;
    }

    var result = enc(value, 0);
    return result === undefined ? 'null' : result;
  }

  /** SHA-256 hex of the canonical form of any JSON-safe value. */
  function digestOf(value) {
    return sha256Hex(canonicalize(value));
  }

  /* ------------------------------------------------------------------ */
  /* Pareto sweep: RDP tolerance vs measured drift                       */
  /* ------------------------------------------------------------------ */

  function logSpacedEpsilons(lo, hi, n) {
    if (!(lo > 0) || !(hi > 0) || !isFinite(lo) || !isFinite(hi) || hi < lo) {
      throw new RangeError('logSpacedEpsilons needs finite positive bounds with hi >= lo');
    }
    if (!Number.isInteger(n) || n < 1) { throw new RangeError('logSpacedEpsilons needs a positive integer count'); }
    if (n === 1) { return [lo]; }
    var out = [];
    for (var i = 0; i < n; i += 1) {
      out.push(lo * Math.pow(hi / lo, i / (n - 1)));
    }
    return out;
  }

  /** The standard sweep: 11 log-spaced tolerances from 0.05 to 6.00. */
  var EPSILONS = logSpacedEpsilons(0.05, 6, 11);

  /** Flatten one vector layer into the dense trace the editor optimises. */
  function specimenTrace(E, layer) {
    var parsed = E.pathDataToNodes(layer.d);
    return { points: E.flattenNodes(parsed.nodes, parsed.closed, 48), closed: parsed.closed };
  }

  /** First layer that is not a shadow, matching the bench default. */
  function primaryLayer(asset) {
    for (var i = 0; i < asset.layers.length; i += 1) {
      if (asset.layers[i].role !== 'shadow') { return asset.layers[i]; }
    }
    return asset.layers[0];
  }

  /**
   * Run the real optimiseContour at every tolerance. Each point reports the
   * kept anchor count, the point reduction fraction and the measured
   * Hausdorff style drift between the dense trace and the refitted cubics.
   */
  function paretoSweep(E, trace, closed, epsilons) {
    var eps = epsilons || EPSILONS;
    return eps.map(function (epsilon, i) {
      var r = E.optimizeContour(trace, {
        closed: closed, epsilon: epsilon, precision: 2, cornerAngle: 75
      });
      return {
        index: i,
        epsilon: epsilon,
        tracePoints: trace.length,
        kept: r.nodeCountAfter,
        reduction: trace.length === 0 ? 0 : 1 - r.nodeCountAfter / trace.length,
        drift: r.deviation,
        bytesBefore: r.bytesBefore,
        bytesAfter: r.bytesAfter
      };
    });
  }

  /**
   * The Pareto knee: the sweep point farthest from the chord joining the two
   * ends, measured in normalised (drift, reduction) space. It is the best
   * trade-off between points removed and trace drift introduced.
   */
  function paretoKneeIndex(points) {
    if (points.length < 3) { return Math.max(0, points.length - 1); }
    var maxDrift = 0;
    points.forEach(function (p) { maxDrift = Math.max(maxDrift, p.drift); });
    var span = maxDrift > 0 ? maxDrift : 1;
    var a = points[0];
    var b = points[points.length - 1];
    var dx = b.drift / span - a.drift / span;
    var dy = b.reduction - a.reduction;
    var len = Math.hypot(dx, dy);
    if (len < 1e-12) { return 0; }
    var best = 0;
    var bestD = -1;
    for (var i = 0; i < points.length; i += 1) {
      var px = points[i].drift / span - a.drift / span;
      var py = points[i].reduction - a.reduction;
      var d = Math.abs(dx * py - dy * px) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* Atlas packing sweep                                                 */
  /* ------------------------------------------------------------------ */

  var PAD_VALUES = [0, 1, 2, 4];
  var EXTRUDE_VALUES = [0, 1, 2];

  /** The 12 padding/extrusion configurations shown in the sweep chart. */
  function atlasConfigList() {
    var out = [];
    PAD_VALUES.forEach(function (p) {
      EXTRUDE_VALUES.forEach(function (x) {
        out.push({ pad: p, ext: x });
      });
    });
    return out;
  }

  /** Frame lists for the two sweep sources: real sprite frames or the seeded kit. */
  function atlasFrames(E, A, source) {
    if (source === 'kit') { return E.generateSampleFrames(32, 7, 8, 48); }
    return A.pixelAtlasFrames();
  }

  /** Pack one configuration and verify it with the engine's own validator. */
  function packRow(E, frames, pad, ext, pot) {
    var atlas = E.packSpriteAtlasMaxRects(frames, {
      padding: pad, extrude: ext, maxSize: 1024, powerOfTwo: pot, sort: 'maxside'
    });
    var check = atlas.ok ? E.validateAtlas(atlas) : { ok: false, problems: ['did not fit'] };
    return {
      pad: pad,
      ext: ext,
      pot: pot,
      ok: atlas.ok && check.ok,
      packed: atlas.ok,
      width: atlas.width,
      height: atlas.height,
      frames: atlas.placements.length,
      total: frames.length,
      frameArea: atlas.frameArea,
      efficiency: atlas.ok ? atlas.efficiency : 0,
      waste: atlas.ok ? atlas.width * atlas.height - atlas.frameArea : 0,
      wastePct: atlas.ok ? 1 - atlas.efficiency : 1,
      problems: check.problems
    };
  }

  /** All 12 padding/extrusion rows for one frame source at one POT mode. */
  function atlasSweep(E, frames, pot) {
    return atlasConfigList().map(function (c) {
      return packRow(E, frames, c.pad, c.ext, pot);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Palette audit                                                       */
  /* ------------------------------------------------------------------ */

  function labDist(p, q) {
    var a = p.L - q.L;
    var b = p.a - q.a;
    var c = p.b - q.b;
    return Math.sqrt(a * a + b * b + c * c);
  }

  /**
   * For every built-in palette: the tone colours the pixel bench would use,
   * their OKLab lightness order, whether that order is strictly increasing,
   * the smallest adjacent deltaE, the smallest deltaE over all tone pairs,
   * and the darkest-to-lightest contrast span.
   */
  function paletteAudit(E, toneCount) {
    return E.PALETTES.map(function (pal) {
      var tones = E.toneColors(toneCount, pal.colors);
      var labs = tones.map(function (hex) { return E.rgbToOklab(E.hexToRgb(hex)); });
      var lightness = labs.map(function (l) { return l.L; });
      var monotonic = true;
      var strict = true;
      var minAdj = Infinity;
      for (var i = 1; i < labs.length; i += 1) {
        if (!(lightness[i] >= lightness[i - 1])) { monotonic = false; }
        if (!(lightness[i] > lightness[i - 1])) { strict = false; }
        var d = labDist(labs[i - 1], labs[i]);
        if (d < minAdj) { minAdj = d; }
      }
      var minPair = Infinity;
      var maxPair = 0;
      for (var a = 0; a < labs.length; a += 1) {
        for (var b2 = a + 1; b2 < labs.length; b2 += 1) {
          var dd = labDist(labs[a], labs[b2]);
          if (dd < minPair) { minPair = dd; }
          if (dd > maxPair) { maxPair = dd; }
        }
      }
      return {
        id: pal.id,
        name: pal.name,
        size: pal.colors.length,
        tones: tones,
        lightness: lightness,
        monotonic: monotonic,
        strict: strict,
        minAdjacentDE: labs.length > 1 ? minAdj : 0,
        minPairDE: labs.length > 1 ? minPair : 0,
        contrastRange: maxPair
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Proof brief: one stamped payload, four surfaces                     */
  /* ------------------------------------------------------------------ */

  function r2(v) { return Math.round(v * 100) / 100; }
  function r4(v) { return Math.round(v * 10000) / 10000; }
  function r6(v) { return Math.round(v * 1000000) / 1000000; }

  /**
   * The full lab computation for one UI state: specimen sweep, atlas rows
   * and the palette audit, all through the real engine and real fixtures.
   */
  function computeLab(E, A, state) {
    var asset = A.getAsset(state.spec);
    var layer = primaryLayer(asset);
    var tr = specimenTrace(E, layer);
    var sweep = paretoSweep(E, tr.points, tr.closed);
    var frames = atlasFrames(E, A, state.src);
    return {
      asset: asset,
      layer: layer,
      trace: tr,
      sweep: sweep,
      knee: paretoKneeIndex(sweep),
      frames: frames,
      atlas: atlasSweep(E, frames, state.pot),
      palettes: paletteAudit(E, A.TONES)
    };
  }

  /** The canonical audit payload for one lab state, without the digest stamp. */
  function buildPayload(E, A, state, computed) {
    var c = computed || computeLab(E, A, state);
    return {
      app: 'paperclip-rig',
      kind: 'rig-lab-proof-brief',
      engine: E.version,
      lab: VERSION,
      state: {
        specimen: state.spec,
        epsilonIndex: state.epsIdx,
        epsilon: r4(EPSILONS[state.epsIdx]),
        padding: state.pad,
        extrude: state.ext,
        powerOfTwo: state.pot === true,
        frameSource: state.src,
        palette: state.pal
      },
      pareto: {
        specimen: c.asset.id,
        name: c.asset.name,
        layer: c.layer.id,
        closed: c.trace.closed,
        tracePoints: c.trace.points.length,
        kneeIndex: c.knee,
        points: c.sweep.map(function (p) {
          return {
            epsilon: r6(p.epsilon),
            kept: p.kept,
            reductionPct: r2(p.reduction * 100),
            drift: r4(p.drift),
            bytesBefore: p.bytesBefore,
            bytesAfter: p.bytesAfter
          };
        })
      },
      atlas: {
        source: state.src,
        frameCount: c.frames.length,
        powerOfTwo: state.pot === true,
        rows: c.atlas.map(function (row) {
          return {
            pad: row.pad, ext: row.ext, width: row.width, height: row.height,
            frames: row.frames, ok: row.ok, efficiency: r4(row.efficiency),
            wastePct: r2(row.wastePct * 100), problems: row.problems.length
          };
        })
      },
      palettes: c.palettes.map(function (p) {
        return {
          id: p.id, name: p.name, tones: p.tones, size: p.size,
          monotonic: p.monotonic, strict: p.strict,
          minAdjacentDE: r4(p.minAdjacentDE), minPairDE: r4(p.minPairDE),
          contrastRange: r4(p.contrastRange)
        };
      })
    };
  }

  /**
   * Attach the integrity block: one SHA-256 digest of the canonical payload.
   * The payload carries no clock or randomness, so every surface derived
   * from this stamped object shows the same digest for the same state.
   */
  function stampPayload(core) {
    var digest = digestOf(core);
    var payload = Object.assign({}, core, {
      integrity: {
        algorithm: 'sha256-fips180-4',
        canonical: 'json-sorted-keys-utf8',
        digest: digest
      }
    });
    return { core: core, payload: payload, digest: digest };
  }

  var briefCache = {};
  var BRIEF_CACHE_MAX = 16;

  /** Stamped brief cached per state key so the badge and every export match. */
  function stampedBrief(E, A, state, computed) {
    var key = canonicalize(state);
    if (hasOwn.call(briefCache, key)) { return briefCache[key]; }
    var stamped = stampPayload(buildPayload(E, A, state, computed));
    var keys = Object.keys(briefCache);
    if (keys.length >= BRIEF_CACHE_MAX) { delete briefCache[keys[0]]; }
    briefCache[key] = stamped;
    return stamped;
  }

  function clearBriefCache() {
    briefCache = {};
  }

  /** Recompute the digest of a payload minus its integrity block. */
  function verifyPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, reason: 'not a brief object', expected: null, actual: null };
    }
    var stamped = payload.integrity;
    var expected = stamped && typeof stamped.digest === 'string' ? stamped.digest : null;
    var core = {};
    Object.keys(payload).forEach(function (k) {
      if (k !== 'integrity') { core[k] = payload[k]; }
    });
    var actual = digestOf(core);
    return { ok: expected !== null && expected === actual, expected: expected, actual: actual };
  }

  /** A deterministic one-field tamper used by the demo button. */
  function tamperPayload(payload) {
    var copy = JSON.parse(JSON.stringify(payload));
    if (copy.pareto && copy.pareto.points && copy.pareto.points.length > 0) {
      copy.pareto.points[0].kept += 1;
    } else {
      copy.tampered = true;
    }
    delete copy.integrity;
    return copy;
  }

  /* ------------------------------------------------------------------ */
  /* Exporters                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Spreadsheet-safe CSV cell: leading formula characters and control
   * whitespace get a single-quote prefix, then quoting handles commas,
   * quotes and newlines.
   */
  function csvCell(v) {
    var numeric = typeof v === 'number' && isFinite(v);
    var s = v === null || v === undefined ? '' : String(v);
    if (!numeric && /^[\s\p{Cf}\p{Cc}]*[=+\-@\t\r\n ]/u.test(s)) { s = "'" + s; }
    if (/[",\n\r]/.test(s)) { s = '"' + s.replace(/"/g, '""') + '"'; }
    return s;
  }

  function csvLine(cells) {
    return cells.map(csvCell).join(',');
  }

  function briefJson(stamped) {
    return JSON.stringify(stamped.payload, null, 2) + '\n';
  }

  function briefCsv(stamped) {
    var p = stamped.payload;
    var lines = [];
    lines.push(csvLine(['kind', 'key', 'value']));
    [
      ['meta', 'app', p.app],
      ['meta', 'engine', p.engine],
      ['meta', 'specimen', p.state.specimen],
      ['meta', 'epsilon', p.state.epsilon],
      ['meta', 'padding', p.state.padding],
      ['meta', 'extrude', p.state.extrude],
      ['meta', 'powerOfTwo', p.state.powerOfTwo],
      ['meta', 'frameSource', p.state.frameSource],
      ['meta', 'palette', p.state.palette]
    ].forEach(function (row) { lines.push(csvLine(row)); });
    lines.push(csvLine(['pareto', 'epsilon', 'kept', 'reduction_pct', 'drift', 'bytes_before', 'bytes_after']));
    p.pareto.points.forEach(function (pt) {
      lines.push(csvLine(['pareto', pt.epsilon, pt.kept, pt.reductionPct, pt.drift, pt.bytesBefore, pt.bytesAfter]));
    });
    lines.push(csvLine(['atlas', 'pad', 'ext', 'width', 'height', 'frames', 'efficiency', 'waste_pct', 'ok']));
    p.atlas.rows.forEach(function (row) {
      lines.push(csvLine(['atlas', row.pad, row.ext, row.width, row.height, row.frames, row.efficiency, row.wastePct, row.ok]));
    });
    lines.push(csvLine(['palette', 'id', 'tones', 'monotonic', 'min_adjacent_dE', 'min_pair_dE', 'contrast_range']));
    p.palettes.forEach(function (pal) {
      lines.push(csvLine(['palette', pal.id, pal.tones.length, pal.monotonic, pal.minAdjacentDE, pal.minPairDE, pal.contrastRange]));
    });
    lines.push(csvLine(['integrity', 'sha256', stamped.digest]));
    return lines.join('\r\n') + '\r\n';
  }

  function briefMarkdown(stamped) {
    var p = stamped.payload;
    var lines = [];
    lines.push('# Paperclip Rig audit brief');
    lines.push('');
    lines.push('- Engine ' + p.engine + ', lab ' + p.lab + ', specimen `' + p.pareto.specimen + '` (' + p.pareto.layer + ' layer, ' + p.pareto.tracePoints + ' trace points).');
    lines.push('- State: epsilon index ' + p.state.epsilonIndex + ', padding ' + p.state.padding +
      ', extrude ' + p.state.extrude + ', power of two ' + p.state.powerOfTwo +
      ', source ' + p.state.frameSource + ', palette ' + p.state.palette + '.');
    lines.push('');
    lines.push('## Pareto sweep');
    lines.push('');
    lines.push('| epsilon | kept | reduction % | drift |');
    lines.push('| --- | --- | --- | --- |');
    p.pareto.points.forEach(function (pt, i) {
      lines.push('| ' + pt.epsilon + ' | ' + pt.kept + ' | ' + pt.reductionPct + ' | ' + pt.drift +
        (i === p.pareto.kneeIndex ? ' (knee)' : '') + ' |');
    });
    lines.push('');
    lines.push('## Atlas sweep (' + p.atlas.source + ', ' + p.atlas.frameCount + ' frames)');
    lines.push('');
    lines.push('| pad | ext | sheet | frames | efficiency | waste % | ok |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    p.atlas.rows.forEach(function (row) {
      lines.push('| ' + row.pad + ' | ' + row.ext + ' | ' + row.width + 'x' + row.height +
        ' | ' + row.frames + ' | ' + row.efficiency + ' | ' + row.wastePct + ' | ' + row.ok + ' |');
    });
    lines.push('');
    lines.push('## Palette audit');
    lines.push('');
    lines.push('| palette | tones | monotonic | min adjacent dE | min pair dE | contrast |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    p.palettes.forEach(function (pal) {
      lines.push('| ' + pal.name + ' | ' + pal.tones.length + ' | ' + pal.monotonic +
        ' | ' + pal.minAdjacentDE + ' | ' + pal.minPairDE + ' | ' + pal.contrastRange + ' |');
    });
    lines.push('');
    lines.push('SHA-256 (canonical JSON): `' + stamped.digest + '`');
    lines.push('');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Fail-closed #prlab= state codec                                     */
  /* ------------------------------------------------------------------ */

  var CODEC_VERSION = 1;

  function bannedKey(k) {
    return k === '__proto__' || k === 'constructor' || k === 'prototype';
  }

  /** Pack lab state into the base64url payload that follows '#prlab='. */
  function encodeState(state) {
    var payload = {
      v: CODEC_VERSION,
      s: state.spec,
      e: state.epsIdx,
      p: state.pad,
      x: state.ext,
      t: state.pot ? 1 : 0,
      r: state.src,
      c: state.pal
    };
    return b64urlEncode(utf8Encode(JSON.stringify(payload)));
  }

  function numField(v, lo, hi) {
    if (typeof v !== 'number' || !isFinite(v)) { return null; }
    var n = Math.round(v);
    if (n < lo) { return lo; }
    if (n > hi) { return hi; }
    return n;
  }

  /**
   * Strict decode of a '#prlab=' payload. Anything malformed, hostile or
   * unsupported returns null so callers fall back to defaults. Keys named
   * __proto__, constructor or prototype are rejected outright; numeric
   * fields must be finite and are clamped to their legal ranges; enum
   * fields must match the live asset and palette lists.
   */
  function decodeState(text, domains) {
    if (typeof text !== 'string') { return null; }
    var bytes = b64urlDecode(text);
    if (!bytes) { return null; }
    var parsed;
    try {
      parsed = JSON.parse(utf8Decode(bytes));
    } catch (e) {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
    var keys = Object.keys(parsed);
    for (var i = 0; i < keys.length; i += 1) {
      if (bannedKey(keys[i])) { return null; }
    }
    if (parsed.v !== CODEC_VERSION) { return null; }
    var vectors = domains && domains.vectors ? domains.vectors : [];
    var palettes = domains && domains.palettes ? domains.palettes : [];
    var out = {};
    if (typeof parsed.s !== 'string' || vectors.indexOf(parsed.s) < 0) { return null; }
    out.s = parsed.s;
    out.e = numField(parsed.e, 0, EPSILONS.length - 1);
    out.p = numField(parsed.p, 0, 8);
    out.x = numField(parsed.x, 0, 4);
    if (out.e === null || out.p === null || out.x === null) { return null; }
    if (parsed.t === 1 || parsed.t === true) {
      out.t = true;
    } else if (parsed.t === 0 || parsed.t === false) {
      out.t = false;
    } else {
      return null;
    }
    if (parsed.r !== 'pixels' && parsed.r !== 'kit') { return null; }
    out.r = parsed.r;
    if (typeof parsed.c !== 'string' || palettes.indexOf(parsed.c) < 0) { return null; }
    out.c = parsed.c;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* In-page self-test battery                                           */
  /* ------------------------------------------------------------------ */

  function selfChecks(E, A) {
    var checks = [];

    function rec(name, fn) {
      try {
        var r = fn();
        checks.push({ name: name, pass: r.pass !== false, detail: r.detail || '' });
      } catch (err) {
        checks.push({ name: name, pass: false, detail: String(err && err.message ? err.message : err).slice(0, 140) });
      }
    }

    function expect(cond, detail) {
      return { pass: cond === true, detail: detail };
    }

    rec('SHA-256 of the empty string matches the FIPS known-answer test', function () {
      return expect(sha256Hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', sha256Hex(''));
    });
    rec('SHA-256 of "abc" matches the FIPS known-answer test', function () {
      return expect(sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', sha256Hex('abc'));
    });
    rec('SHA-256 of the 448-bit test message matches the FIPS vector', function () {
      var msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
      return expect(sha256Hex(msg) === '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', sha256Hex(msg));
    });
    rec('SHA-256 of bytes 0..255 matches a stored digest', function () {
      var bytes = new Uint8Array(256);
      for (var i = 0; i < 256; i += 1) { bytes[i] = i; }
      var want = '40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880';
      return expect(sha256Hex(bytes) === want, sha256Hex(bytes));
    });
    rec('Canonical JSON sorts object keys recursively', function () {
      var out = canonicalize({ b: 1, a: { d: 2, c: 3 } });
      return expect(out === '{"a":{"c":3,"d":2},"b":1}', out);
    });
    rec('Canonical JSON survives a cyclic reference', function () {
      var obj = { a: 1 };
      obj.self = obj;
      var out = canonicalize(obj);
      return expect(out === '{"a":1,"self":"<cycle>"}', out);
    });
    rec('Canonical JSON bounds deep nesting instead of recursing forever', function () {
      var deep = {};
      var cur = deep;
      for (var i = 0; i < 200; i += 1) { cur.n = {}; cur = cur.n; }
      var out = canonicalize(deep);
      return expect(out.indexOf('<depth>') >= 0 && out.length < 10000, out.length + ' chars');
    });
    rec('Canonical JSON encodes a __proto__ key as data, not pollution', function () {
      var before = {}.polluted;
      var obj = JSON.parse('{"__proto__":{"polluted":1},"safe":2}');
      var out = canonicalize(obj);
      return expect({}.polluted === undefined && before === undefined && out.indexOf('polluted') >= 0, out);
    });
    rec('Canonical JSON drops functions and undefined, keeps null', function () {
      var out = canonicalize({ f: function () { return 1; }, u: undefined, n: null });
      return expect(out === '{"n":null}', out);
    });
    rec('RDP kept count is non-increasing as tolerance grows', function () {
      var asset = A.getAsset('ginkgo-leaf');
      var tr = specimenTrace(E, primaryLayer(asset));
      var prev = Infinity;
      var worst = '';
      var okAll = true;
      EPSILONS.forEach(function (eps) {
        var kept = E.simplifyClosedPolylineRdp(tr.points, eps).length;
        if (kept > prev) { okAll = false; worst = 'eps ' + eps + ' rose to ' + kept; }
        prev = kept;
      });
      return expect(okAll && prev >= 3, worst || 'monotone down to ' + prev);
    });
    rec('RDP keeps both endpoints of an open trace', function () {
      var line = [{ x: 0, y: 0 }, { x: 4, y: 1 }, { x: 8, y: 0 }, { x: 12, y: 1 }, { x: 16, y: 0 }];
      var out = E.simplifyPolylineRdp(line, 4);
      var first = out[0];
      var last = out[out.length - 1];
      return expect(first.x === 0 && first.y === 0 && last.x === 16 && last.y === 0, out.length + ' kept');
    });
    rec('Pareto sweep drift stays finite and non-negative at all 11 tolerances', function () {
      var asset = A.getAsset('paperclip');
      var tr = specimenTrace(E, primaryLayer(asset));
      var sweep = paretoSweep(E, tr.points, tr.closed);
      var okAll = sweep.every(function (p) { return isFinite(p.drift) && p.drift >= 0 && p.kept >= 2; });
      return expect(okAll, sweep.map(function (p) { return p.kept; }).join(','));
    });
    rec('Pareto knee index lands inside the sweep', function () {
      var asset = A.getAsset('ginkgo-leaf');
      var tr = specimenTrace(E, primaryLayer(asset));
      var sweep = paretoSweep(E, tr.points, tr.closed);
      var knee = paretoKneeIndex(sweep);
      return expect(knee >= 0 && knee < sweep.length, 'knee at ' + knee);
    });
    rec('Every palette gives non-decreasing tone lightness', function () {
      var rows = paletteAudit(E, A.TONES);
      var bad = rows.filter(function (p) { return !p.monotonic; }).map(function (p) { return p.id; });
      return expect(bad.length === 0, bad.join(',') || 'all 6 monotonic');
    });
    rec('Palettes with enough colours give strictly increasing lightness', function () {
      var rows = paletteAudit(E, A.TONES);
      var bad = rows.filter(function (p) { return p.size >= A.TONES && !p.strict; }).map(function (p) { return p.id; });
      return expect(bad.length === 0, bad.join(',') || 'strict where size >= tones');
    });
    rec('Atlas sweep packs every config with zero overlaps on real sprites', function () {
      var frames = atlasFrames(E, A, 'pixels');
      var rows = atlasSweep(E, frames, true);
      var bad = rows.filter(function (r) { return !r.ok || r.problems.length > 0; });
      return expect(bad.length === 0, bad.length + ' bad of ' + rows.length);
    });
    rec('Atlas placements stay inside the sheet bounds', function () {
      var frames = atlasFrames(E, A, 'pixels');
      var row = packRow(E, frames, 2, 1, true);
      return expect(row.ok && row.problems.length === 0 && row.width > 0, row.width + 'x' + row.height);
    });
    rec('PNG signature, IHDR CRC, zlib header and Adler tail check out', function () {
      var png = E.encodePngRgba(2, 2, Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]));
      var sigOk = [137, 80, 78, 71, 13, 10, 26, 10].every(function (b, i) { return png[i] === b; });
      var ihdrCrc = (png[29] << 24 | png[30] << 16 | png[31] << 8 | png[32]) >>> 0;
      var crcOk = ihdrCrc === E.crc32(png.subarray(12, 29));
      var idatLen = (png[33] << 24 | png[34] << 16 | png[35] << 8 | png[36]) >>> 0;
      var zOk = png[41] === 0x78 && png[42] === 0x01;
      var tail = 41 + idatLen - 4;
      var adlerRead = (png[tail] << 24 | png[tail + 1] << 16 | png[tail + 2] << 8 | png[tail + 3]) >>> 0;
      var raw = Uint8Array.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 255]);
      var adlerOk = adlerRead === E.adler32(raw);
      var lenOk = idatLen === 2 + 5 + raw.length + 4;
      return expect(sigOk && crcOk && zOk && adlerOk && lenOk,
        'sig ' + sigOk + ' crc ' + crcOk + ' z ' + zOk + ' adler ' + adlerOk + ' len ' + lenOk);
    });
    rec('CRC32 and Adler32 match their published check values', function () {
      var bytes = utf8Encode('123456789');
      var c = E.crc32(bytes) === 0xcbf43926;
      var a = E.adler32(bytes) === 0x091e01de;
      return expect(c && a, 'crc ' + E.crc32(bytes).toString(16) + ' adler ' + E.adler32(bytes).toString(16));
    });
    rec('Badge, JSON, CSV and Markdown surfaces share one digest', function () {
      var state = { spec: 'acorn', epsIdx: 5, pad: 2, ext: 1, pot: true, src: 'pixels', pal: 'archival' };
      var stamped = stampedBrief(E, A, state);
      var d = stamped.digest;
      var jOk = briefJson(stamped).indexOf(d) >= 0;
      var cOk = briefCsv(stamped).indexOf(d) >= 0;
      var mOk = briefMarkdown(stamped).indexOf(d) >= 0;
      return expect(jOk && cOk && mOk && /^[0-9a-f]{64}$/.test(d), d.slice(0, 16));
    });
    rec('Verify Digest confirms the stamped payload', function () {
      var state = { spec: 'toadstool', epsIdx: 3, pad: 1, ext: 2, pot: false, src: 'kit', pal: 'dmg' };
      var stamped = stampedBrief(E, A, state);
      var res = verifyPayload(stamped.payload);
      return expect(res.ok === true, String(res.expected).slice(0, 16));
    });
    rec('A one-field tamper changes the digest and is detected', function () {
      var state = { spec: 'acorn', epsIdx: 2, pad: 0, ext: 0, pot: true, src: 'pixels', pal: 'pico8' };
      var stamped = stampedBrief(E, A, state);
      var tampered = tamperPayload(stamped.payload);
      var res = verifyPayload(tampered);
      var newDigest = digestOf(tampered);
      return expect(res.ok === false && newDigest !== stamped.digest, newDigest.slice(0, 12));
    });
    rec('prlab codec round-trips a full lab state', function () {
      var domains = {
        vectors: A.VECTORS.map(function (v) { return v.id; }),
        palettes: E.PALETTES.map(function (p) { return p.id; })
      };
      var state = { spec: 'lantern', epsIdx: 7, pad: 4, ext: 2, pot: false, src: 'kit', pal: 'blueprint' };
      var enc = encodeState(state);
      var dec = decodeState(enc, domains);
      var ok = dec && dec.s === 'lantern' && dec.e === 7 && dec.p === 4 && dec.x === 2 &&
        dec.t === false && dec.r === 'kit' && dec.c === 'blueprint';
      return expect(ok === true, enc.slice(0, 20));
    });
    rec('prlab codec rejects pollution keys, NaN and out-of-range noise', function () {
      var domains = {
        vectors: A.VECTORS.map(function (v) { return v.id; }),
        palettes: E.PALETTES.map(function (p) { return p.id; })
      };
      var proto = decodeState(b64urlEncode(utf8Encode('{"v":1,"__proto__":{"x":1},"s":"acorn","e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}')), domains);
      var ver = decodeState(b64urlEncode(utf8Encode('{"v":9,"s":"acorn","e":1,"p":0,"x":0,"t":1,"r":"pixels","c":"dmg"}')), domains);
      var junk = decodeState('!!!not-base64!!!', domains);
      return expect(proto === null && ver === null && junk === null && {}.x === undefined,
        'proto ' + proto + ' ver ' + ver + ' junk ' + junk);
    });
    rec('CSV cells escape spreadsheet formula triggers', function () {
      var out = [csvCell('=1+1'), csvCell('+x'), csvCell('-2'), csvCell('@y'), csvCell('\tz')];
      var ok = out.every(function (s) { return s.charAt(0) === "'" || s.indexOf('"\'') === 0; });
      return expect(out[0].indexOf("'=") === 0 && ok, out.join(' | '));
    });
    rec('Atlas kit source still packs and validates with zero overlaps', function () {
      var frames = atlasFrames(E, A, 'kit');
      var rows = atlasSweep(E, frames, false);
      var bad = rows.filter(function (r) { return !r.ok || r.problems.length > 0; });
      return expect(bad.length === 0, bad.length + ' bad of ' + rows.length);
    });

    return checks;
  }

  return {
    version: VERSION,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    b64urlEncode: b64urlEncode,
    b64urlDecode: b64urlDecode,
    sha256Hex: sha256Hex,
    canonicalize: canonicalize,
    digestOf: digestOf,
    logSpacedEpsilons: logSpacedEpsilons,
    EPSILONS: EPSILONS,
    PAD_VALUES: PAD_VALUES,
    EXTRUDE_VALUES: EXTRUDE_VALUES,
    specimenTrace: specimenTrace,
    primaryLayer: primaryLayer,
    paretoSweep: paretoSweep,
    paretoKneeIndex: paretoKneeIndex,
    atlasConfigList: atlasConfigList,
    atlasFrames: atlasFrames,
    packRow: packRow,
    atlasSweep: atlasSweep,
    paletteAudit: paletteAudit,
    computeLab: computeLab,
    buildPayload: buildPayload,
    stampPayload: stampPayload,
    stampedBrief: stampedBrief,
    clearBriefCache: clearBriefCache,
    verifyPayload: verifyPayload,
    tamperPayload: tamperPayload,
    csvCell: csvCell,
    briefJson: briefJson,
    briefCsv: briefCsv,
    briefMarkdown: briefMarkdown,
    encodeState: encodeState,
    decodeState: decodeState,
    selfChecks: selfChecks
  };
}));
