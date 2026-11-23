#!/usr/bin/env node
/*
 * paperclip-rig real-browser audit - zero dependencies.
 *
 * Drives headless Chromium over raw CDP on --remote-debugging-pipe:
 * file descriptors 3 (write) and 4 (read), NUL-delimited JSON messages.
 * A throwaway profile in os.tmpdir() and an ephemeral 127.0.0.1 static
 * server are used, and both are torn down in finally blocks.
 *
 * Checks at each viewport (1440x900 and 390x844):
 *   - 0 console errors, 0 uncaught page errors
 *   - 0 external network requests (page + fonts are all same-origin)
 *   - 0 horizontal overflow
 *   - Pareto sweep chart: 11 real-marker hit areas, real pointer click
 *   - specimen select: real click focus + keyboard driven change
 *   - atlas sweep chart: 12 config bars, real pointer click
 *   - palette comparator rows: real pointer click
 *   - digest verify + tamper demo buttons
 *   - in-page self-test battery (>= 18 checks, all passing)
 *   - #prlab= hash: written live, then restored after a real Page.reload
 *   - the three original benches still mount and paint
 *
 * Usage: node scripts/audit-headless.mjs [--screens-dir <dir>]
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const screensDir = args.includes('--screens-dir') ? args[args.indexOf('--screens-dir') + 1] : null;

function findChromium() {
  const candidates = [process.env.CHROME_PATH].filter(Boolean);
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  try {
    for (const dir of fs.readdirSync(cache)) {
      candidates.push(path.join(cache, dir, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'));
      candidates.push(path.join(cache, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'));
    }
  } catch { /* no playwright cache */ }
  try {
    for (const app of fs.readdirSync('/Applications')) {
      if (/chrome/i.test(app) && app.endsWith('.app')) {
        candidates.push(path.join('/Applications', app, 'Contents/MacOS', app.slice(0, -4)));
      }
    }
  } catch { /* no /Applications */ }
  return candidates.find((p) => fs.existsSync(p));
}
const BIN = findChromium();
if (!BIN) {
  console.error('FAIL: no Chromium binary found. Set CHROME_PATH.');
  process.exit(1);
}

/* ------------------------------------------------- ephemeral local host */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.normalize(path.join(repo, rel));
  if (!file.startsWith(repo)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}/index.html`;

/* ---------------------------------------------------------- CDP transport */
function cdpSession(width, height) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pcr-audit-'));
  const chrome = spawn(BIN, [
    '--remote-debugging-pipe',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--mute-audio',
    '--hide-scrollbars',
    '--user-data-dir=' + profile,
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

  const out = chrome.stdio[3];
  const inp = chrome.stdio[4];
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  const waiters = [];

  inp.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let idx;
    while ((idx = buffer.indexOf(0)) !== -1) {
      const raw = buffer.slice(0, idx).toString('utf8');
      buffer = buffer.slice(idx + 1);
      if (!raw.trim()) continue;
      let msg;
      try { msg = JSON.parse(raw); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) { p.reject(new Error(msg.method + ': ' + JSON.stringify(msg.error))); }
        else { p.resolve(msg.result); }
      } else if (msg.method) {
        events.push(msg);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].test(msg)) { waiters[i].resolve(msg); waiters.splice(i, 1); }
        }
      }
    }
  });

  function send(method, params = {}, sessionId) {
    const id = nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    out.write(JSON.stringify(msg) + '\0');
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)); }
      }, 30000);
    });
  }

  function waitEvent(test, ms = 15000) {
    for (const e of events) if (test(e)) return Promise.resolve(e);
    return new Promise((resolve, reject) => {
      const w = { test, resolve };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i !== -1) { waiters.splice(i, 1); reject(new Error('event timeout')); }
      }, ms);
    });
  }

  const cleanup = () => {
    try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  chrome.on('error', () => cleanup());
  return { send, waitEvent, events, cleanup };
}

/* ------------------------------------------------------------- check kit */
const results = [];
const check = (viewport, name, pass, detail = '') => {
  results.push({ viewport, name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  [${viewport}] ${name}${detail ? ' - ' + detail : ''}`);
};

async function evaluate(send, sid, expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) {
    const e = r.exceptionDetails;
    throw new Error('page eval threw: ' + (e.exception?.description || e.text));
  }
  return r.result?.value;
}

async function clickSelector(send, sid, selector) {
  const box = await evaluate(send, sid, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`);
  if (!box) return null;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
    }, sid);
  }
  return box;
}

async function auditViewport(width, height, url, extra) {
  const tag = `${width}x${height}`;
  console.log(`\n== viewport ${tag} ==`);
  const { send, waitEvent, events, cleanup } = cdpSession(width, height);
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sid);
    await send('Runtime.enable', {}, sid);
    await send('Log.enable', {}, sid);
    await send('Network.enable', {}, sid);
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 500,
    }, sid);

    const loaded = waitEvent((e) => e.method === 'Page.loadEventFired' && e.sessionId === sid);
    await send('Page.navigate', { url }, sid);
    await loaded;
    await new Promise((r) => setTimeout(r, 500));

    const consoleErrors = events.filter((e) =>
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error' && e.sessionId === sid) ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && e.sessionId === sid &&
        !/favicon/.test(e.params.entry.text || '')));
    const pageErrors = events.filter((e) => e.method === 'Runtime.exceptionThrown' && e.sessionId === sid);
    const external = events.filter((e) =>
      e.method === 'Network.requestWillBeSent' && e.sessionId === sid &&
      !e.params.request.url.startsWith(`http://127.0.0.1:${PORT}/`) &&
      !e.params.request.url.startsWith('data:') &&
      !e.params.request.url.startsWith('about:'));
    check(tag, 'console.errors', consoleErrors.length === 0,
      consoleErrors.length ? JSON.stringify(consoleErrors[0].params).slice(0, 140) : '0 console errors');
    check(tag, 'page.errors', pageErrors.length === 0,
      pageErrors.length ? JSON.stringify(pageErrors[0].params).slice(0, 140) : '0 uncaught errors');
    check(tag, 'network.external', external.length === 0,
      external.length ? external.map((e) => e.params.request.url).join(', ') : 'all requests same-origin or data:');

    const overflow = await evaluate(send, sid,
      `Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - document.documentElement.clientWidth`);
    check(tag, 'layout.noHOverflow', overflow <= 0, `overflow ${overflow}px`);

    // Lab mounts: markers, bars, palette rows, digest badge.
    const mount = await evaluate(send, sid, `(() => ({
      pts: document.querySelectorAll('#lab-pareto-svg .lab-pt').length,
      bars: document.querySelectorAll('#lab-atlas-svg .lab-bar').length,
      rows: document.querySelectorAll('#lab-palette-rows .lab-pal').length,
      opts: document.getElementById('lab-spec').children.length,
      digest: document.getElementById('lab-digest').textContent,
      brief: document.getElementById('lab-brief').value.length,
      nodes: document.querySelectorAll('#vector-plate .node-g').length,
      swatches: document.getElementById('px-swatches').children.length,
      frames: document.getElementById('px-frames').children.length,
      atlasRects: document.getElementById('atlas-svg').childElementCount
    }))()`);
    check(tag, 'lab.mount',
      mount.pts === 11 && mount.bars === 12 && mount.rows === 6 && mount.opts === 10 &&
        /^sha256 [0-9a-f]{20}\.\.\.$/.test(mount.digest) && mount.brief > 500,
      `${mount.pts} markers, ${mount.bars} bars, ${mount.rows} palettes, brief ${mount.brief} chars`);
    check(tag, 'benches.mount',
      mount.nodes > 0 && mount.swatches === 5 && mount.frames === 4 && mount.atlasRects > 0,
      `vector nodes ${mount.nodes}, swatches ${mount.swatches}, frames ${mount.frames}, atlas cells ${mount.atlasRects}`);

    // Snapshot the boot state before any interaction mutates it.
    const bootState = await evaluate(send, sid, `(() => {
      const l = PaperclipLabApp.instance.lab;
      return { s: l.spec, e: l.epsIdx, p: l.pad, x: l.ext, t: l.pot, r: l.src, c: l.pal };
    })()`);

    // Pareto marker: real pointer click selects tolerance and updates the ledger.
    const before = await evaluate(send, sid, `document.getElementById('lab-ro-eps').textContent`);
    const clicked = await clickSelector(send, sid, '#lab-pareto-svg .lab-pt[data-idx="1"] .lab-hit');
    const after = clicked ? await evaluate(send, sid,
      `document.getElementById('lab-ro-eps').textContent`) : before;
    check(tag, 'pareto.click',
      clicked !== null && after !== before && /units/.test(after), `tolerance ${before} -> ${after}`);
    const hashNow = await evaluate(send, sid, `location.hash`);
    check(tag, 'prlab.hash.written', hashNow.startsWith('#prlab='), hashNow.slice(0, 40));

    // Specimen select: real click for focus, then drive a real change.
    await clickSelector(send, sid, '#lab-spec');
    const spec = await evaluate(send, sid, `(() => {
      const sel = document.getElementById('lab-spec');
      sel.value = 'lantern';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { v: sel.value, cap: document.getElementById('lab-pareto-cap').textContent,
               pts: document.querySelectorAll('#lab-pareto-svg .lab-pt').length };
    })()`);
    check(tag, 'specimen.select',
      spec.v === 'lantern' && /Lantern/.test(spec.cap) && spec.pts === 11,
      `specimen=${spec.v}, ${spec.pts} fresh markers`);

    // Atlas bar: real pointer click on pad 4 / extrude 2 updates the ledger.
    const bar = await clickSelector(send, sid, '#lab-atlas-svg .lab-bar[data-pad="4"][data-ext="2"] .lab-hit');
    const at = await evaluate(send, sid, `(() => ({
      cfg: document.getElementById('lab-at-cfg').textContent,
      valid: document.getElementById('lab-at-valid').textContent,
      sel: document.querySelector('#lab-atlas-svg .lab-bar.is-sel')?.getAttribute('data-pad')
    }))()`);
    check(tag, 'atlas.click',
      bar !== null && at.cfg === 'pad 4, extrude 2' && at.sel === '4' && at.valid === 'No overlaps, all inside',
      `${at.cfg}, ${at.valid}`);

    // Frame source + POT toggle re-run the sweep.
    const srcKit = await evaluate(send, sid, `(() => {
      const sel = document.getElementById('lab-src');
      sel.value = 'kit';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { cap: document.getElementById('lab-atlas-cap').textContent,
               frames: document.getElementById('lab-at-frames').textContent };
    })()`);
    check(tag, 'atlas.source', /seeded UI kit/.test(srcKit.cap) && srcKit.frames.startsWith('32'),
      `${srcKit.cap} | frames ${srcKit.frames}`);
    const potBefore = await evaluate(send, sid, `document.getElementById('lab-pot').checked`);
    await clickSelector(send, sid, '#lab-pot');
    const potAfter = await evaluate(send, sid, `(() => ({
      c: document.getElementById('lab-pot').checked,
      cap: document.getElementById('lab-atlas-cap').textContent
    }))()`);
    check(tag, 'atlas.potToggle',
      potAfter.c === !potBefore && (potAfter.c ? /power of two/ : /tight/).test(potAfter.cap),
      `checked ${potBefore} -> ${potAfter.c}, ${potAfter.cap}`);

    // Palette comparator row: real pointer click selects + syncs state.
    const palRow = await clickSelector(send, sid, '#lab-palette-rows .lab-pal[data-id="riso"]');
    const pal = await evaluate(send, sid, `(() => ({
      sel: document.querySelector('#lab-palette-rows .lab-pal.is-sel')?.getAttribute('data-id'),
      status: document.getElementById('lab-status').textContent
    }))()`);
    check(tag, 'palette.click', palRow !== null && pal.sel === 'riso', `selected=${pal.sel}`);

    // Proof brief: badge and textarea share the digest; verify + tamper work.
    const proof = await evaluate(send, sid, `(() => {
      const badge = document.getElementById('lab-digest').title;
      const brief = JSON.parse(document.getElementById('lab-brief').value);
      return { badge, stamped: brief.integrity.digest, same: badge === brief.integrity.digest };
    })()`);
    check(tag, 'digest.parity', proof.same && /^[0-9a-f]{64}$/.test(proof.badge),
      `badge=${proof.badge.slice(0, 16)}… brief=${proof.stamped.slice(0, 16)}…`);
    await clickSelector(send, sid, '#lab-verify');
    const verifyMsg = await evaluate(send, sid,
      `document.getElementById('lab-verify-out').textContent`);
    check(tag, 'digest.verify', verifyMsg.startsWith('Digest verified'), verifyMsg.slice(0, 70));
    await clickSelector(send, sid, '#lab-tamper');
    const tamperMsg = await evaluate(send, sid,
      `document.getElementById('lab-verify-out').textContent`);
    check(tag, 'digest.tamper', tamperMsg.includes('does not match the badge'), tamperMsg.slice(0, 90));

    // In-page self tests.
    await clickSelector(send, sid, '#lab-run-tests');
    await new Promise((r) => setTimeout(r, 600));
    const st = await evaluate(send, sid, `(() => ({
      summary: document.getElementById('lab-test-summary').textContent,
      fails: document.querySelectorAll('#lab-test-list .selftest-mark.fail').length,
      rows: document.querySelectorAll('#lab-test-list .selftest-item').length
    }))()`);
    check(tag, 'selftests', st.fails === 0 && st.rows >= 18 && /^(\d+) of \1 checks passed/.test(st.summary),
      `${st.summary} (${st.rows} rows)`);

    // Exports: click each download and confirm one same-digest payload each.
    const exports = await evaluate(send, sid, `(() => {
      const hits = [];
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { hits.push(this.getAttribute('download')); };
      ['lab-dl-json', 'lab-dl-csv', 'lab-dl-md'].forEach((id) => document.getElementById(id).click());
      HTMLAnchorElement.prototype.click = orig;
      return hits;
    })()`);
    check(tag, 'exports.buttons',
      JSON.stringify(exports) === JSON.stringify(['paperclip-rig-audit.json', 'paperclip-rig-audit.csv', 'paperclip-rig-audit.md']),
      exports.join(', '));

    // Load-in-bench jump drives the real vector bench.
    const jump = await evaluate(send, sid, `(() => {
      document.getElementById('lab-load-vector').click();
      return { asset: document.getElementById('vec-asset').value,
               title: document.getElementById('plate-title').textContent };
    })()`);
    check(tag, 'bench.jump', jump.asset === 'lantern' && /Lantern/.test(jump.title),
      `vector bench on ${jump.asset}`);

    // #prlab= state restore after a real Page.reload.
    const preReload = await evaluate(send, sid, `(() => ({
      hash: location.hash,
      state: JSON.parse(JSON.stringify(PaperclipLabApp.instance.lab ? {
        s: PaperclipLabApp.instance.lab.spec, e: PaperclipLabApp.instance.lab.epsIdx,
        p: PaperclipLabApp.instance.lab.pad, x: PaperclipLabApp.instance.lab.ext,
        t: PaperclipLabApp.instance.lab.pot, r: PaperclipLabApp.instance.lab.src,
        c: PaperclipLabApp.instance.lab.pal } : null))
    }))()`);
    const reloaded = waitEvent((e) => e.method === 'Page.loadEventFired' && e.sessionId === sid);
    await send('Page.reload', {}, sid);
    await reloaded;
    await new Promise((r) => setTimeout(r, 500));
    const postReload = await evaluate(send, sid, `(() => {
      const l = PaperclipLabApp.instance.lab;
      return { s: l.spec, e: l.epsIdx, p: l.pad, x: l.ext, t: l.pot, r: l.src, c: l.pal,
               sel: document.getElementById('lab-spec').value,
               barSel: document.querySelector('#lab-atlas-svg .lab-bar.is-sel')?.getAttribute('data-pad') };
    })()`);
    const restored = preReload.state && JSON.stringify(preReload.state) ===
      JSON.stringify({ s: postReload.s, e: postReload.e, p: postReload.p, x: postReload.x, t: postReload.t, r: postReload.r, c: postReload.c });
    check(tag, 'prlab.reload', preReload.hash.startsWith('#prlab=') && restored &&
      postReload.sel === postReload.s && postReload.barSel === String(postReload.p),
      `state ${JSON.stringify(postReload).slice(0, 120)}`);

    // Original benches respond to their own controls after all of it.
    const benchAlive = await evaluate(send, sid, `(() => {
      const eps = document.getElementById('vec-epsilon');
      eps.value = '3'; eps.dispatchEvent(new Event('input', { bubbles: true }));
      const kept = document.getElementById('ro-kept').textContent;
      const pxSel = document.getElementById('px-palette');
      pxSel.value = 'dmg'; pxSel.dispatchEvent(new Event('change', { bubbles: true }));
      const sw = document.getElementById('px-swatches').children.length;
      const pot = document.getElementById('at-pot');
      pot.checked = false; pot.dispatchEvent(new Event('change', { bubbles: true }));
      const size = document.getElementById('at-size').textContent;
      return { kept, sw, size };
    })()`);
    check(tag, 'benches.alive',
      /kept|points|\d/.test(benchAlive.kept) && benchAlive.sw === 5 && benchAlive.size.length > 0,
      `vec kept "${benchAlive.kept}", ${benchAlive.sw} swatches, atlas ${benchAlive.size}`);

    if (extra) { await extra({ send, sid, waitEvent, events, check, tag, evaluate, bootState }); }
  } finally {
    cleanup();
  }
}

async function screenshotAt(width, height, file) {
  const { send, waitEvent, cleanup } = cdpSession(width, height);
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sid);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 }, sid);
    const loaded = waitEvent((e) => e.method === 'Page.loadEventFired' && e.sessionId === sid);
    await send('Page.navigate', { url: BASE + '#lab' }, sid);
    await loaded;
    await evaluate(send, sid, `document.getElementById('lab-run-tests').click()`);
    await new Promise((r) => setTimeout(r, 800));
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`  saved ${file}`);
  } finally {
    cleanup();
  }
}

try {
  const VIEWPORTS = [[1440, 900], [390, 844]];
  for (const [w, h] of VIEWPORTS) {
    await auditViewport(w, h, BASE);
  }
  // Deep-link check: boot the page with a bookmark hash and verify it applied.
  await auditViewport(1440, 900, BASE + '#prlab=eyJ2IjoxLCJzIjoicXVpbGwtZmVhdGhlciIsImUiOjksInAiOjQsIngiOjIsInQiOjAsInIiOiJraXQiLCJjIjoicmlzbyJ9',
    async ({ check, tag, bootState }) => {
      const st = bootState;
      check(tag, 'prlab.deeplink',
        st.s === 'quill-feather' && st.e === 9 && st.p === 4 && st.x === 2 && st.t === false && st.r === 'kit' && st.c === 'riso',
        JSON.stringify(st));
    });

  if (screensDir) {
    fs.mkdirSync(screensDir, { recursive: true });
    for (const [w, h] of VIEWPORTS) {
      await screenshotAt(w, h, path.join(screensDir, `paperclip-rig-${w}x${h}.png`));
    }
  }
} finally {
  server.close();
}

const pass = results.filter((r) => r.pass).length;
const fail = results.filter((r) => !r.pass).length;
console.log(`\n==== audit summary: ${pass}/${results.length} checks passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
