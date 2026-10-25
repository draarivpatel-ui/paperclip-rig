#!/usr/bin/env node
/*
 * Writes the 18 sample assets to disk:
 *   assets/svg/<id>.svg       ten layered vector assets
 *   assets/png/<id>.png       eight pixel sprite sheets at native size, archival palette
 *   assets/svg/<id>-sheet.svg the same sprite sheets as crisp SVG rects
 * Run with: node scripts/export-assets.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine.js');
const A = require('../assets/data.js');

function buildFiles() {
  const files = new Map();
  const palette = E.getPalette('archival').colors;
  const colors = E.toneColors(A.TONES, palette);
  A.VECTORS.forEach((asset) => {
    files.set(path.join('assets', 'svg', asset.id + '.svg'), A.vectorAssetToSvg(asset));
  });
  A.PIXELS.forEach((asset) => {
    const sheet = E.buildSpriteSheetGrid(asset.frames, Math.min(asset.frames.length, 4));
    files.set(path.join('assets', 'png', asset.id + '.png'), Buffer.from(E.gridToPng(sheet, colors, 1)));
    files.set(
      path.join('assets', 'svg', asset.id + '-sheet.svg'),
      E.exportSpriteSheetSvg(asset.frames, colors, { scale: 8, columns: Math.min(asset.frames.length, 4) }) + '\n'
    );
  });
  return files;
}

function main() {
  const root = path.join(__dirname, '..');
  const files = buildFiles();
  files.forEach((content, rel) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  });
  console.log('wrote ' + files.size + ' files');
}

if (require.main === module) {
  main();
}

module.exports = { buildFiles };
