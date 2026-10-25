# Paperclip Vector & Sprite Rig

Paperclip Rig is an open source browser workbench for vector outlines, indexed pixel sprites, and packed texture atlases. It runs from static files with zero runtime dependencies and no build step.

Live workbench: https://aariv.me/paperclip-rig/

## Honest disclosure first

Hack Club Paperclip rewards hand-drawn art created by a human artist. The sample assets in this repository (`assets/svg/` and `assets/png/`) were authored in code with an AI-assisted workflow as deterministic fixtures for the three editors, not drawn by hand. Because of that, this repository is an open source vector and sprite rigging tool and is not a Hack Club Paperclip art entry. Full details are in [NOTES.md](NOTES.md).

## Three benches on one drafting table

1. **Vector bench (`#vector`)**: Drag cubic Bezier anchors and control handles (`Smooth`, `Mirrored`, or `Free`), adjust the Ramer-Douglas-Peucker simplification tolerance (`0.05` to `6.00` units) and coordinate decimal precision (`0` to `4` places), inspect the normal curvature comb and Hausdorff style trace drift, and copy or download the simplified SVG.
2. **Pixel bench (`#pixel`)**: Paint `16x16` and `32x32` multi-frame sprites using a five-tone indexed model. Switching palettes (`Archival ink`, `Botanical plate`, `Risograph trio`, `Game Boy DMG`, `Pico-8`, `Blueprint`) ranks target colours by OKLab perceptual lightness (`L`) so the darkest tone always maps to the darkest colour. Includes Bresenham line drawing, 4-connected flood fill, onion skinning, variable frame rate preview, and dependency-free PNG and SVG sprite sheet export.
3. **Atlas press (`#atlas`)**: Pack all sprite frames or a seeded UI kit into power-of-two or custom sheets using the MaxRects Best Short Side Fit heuristic with configurable padding and edge pixel extrusion. Validates every placement for bounds and overlaps, and exports descriptors in TexturePacker JSON (Hash or Array), Phaser 3 multiatlas JSON, Godot region JSON, or CSS sprite rules alongside a packed PNG sheet.

## Eighteen sample assets

Ten layered SVG vector specimens and eight indexed pixel sprites live in [assets/data.js](assets/data.js) and are exported to static files by [scripts/export-assets.js](scripts/export-assets.js):

- **Vectors (`assets/svg/*.svg`)**: `ginkgo-leaf`, `acorn`, `paperclip`, `toadstool`, `skeleton-key`, `compass-rose`, `lantern`, `scallop-shell`, `potion-flask`, `quill-feather`.
- **Pixels (`assets/png/*.png` and `assets/svg/*-sheet.svg`)**: `traveler-walk` (4 frames, 16x16), `slime-bounce` (2 frames, 16x16), `heart-container`, `door-key`, `potion-bottle`, `treasure-chest`, `toadstool-pixel`, `windswept-sapling` (4 frames, 32x32).

## Repository layout

- [index.html](index.html): Single-page workbench markup with keyboard and pointer accessibility.
- [tokens.css](tokens.css) and [styles.css](styles.css): Archival drafting-table styling using custom properties and self-hosted Fraunces, Hanken Grotesk, and JetBrains Mono fonts (`fonts/`).
- [engine.js](engine.js): Pure, deterministic UMD engine (De Casteljau cubic Bezier evaluation and splitting, exact derivative root bounding boxes, iterative Ramer-Douglas-Peucker open and closed simplification, Catmull-Rom smooth spline fitting, MaxRects BSSF bin packing, Bresenham lines, 4-connected flood fill, OKLab and CIE Lab colour distance and lightness ranking, and stored-block PNG encoding with CRC32 and Adler32).
- [assets/data.js](assets/data.js): Code-authored definitions for the 18 sample assets.
- [assets/app.js](assets/app.js): Browser and testable DOM controller wiring the three benches and specimen shelf.
- [tests/engine.test.js](tests/engine.test.js) and [tests/dom-smoke.test.js](tests/dom-smoke.test.js): Node test suite (`node:test`) covering engine maths, PNG encoding, asset generation, and DOM controller interactions.

## Run and test locally

Requires Node 20 or newer. No packages need to be installed.

```bash
npm test
npm run assets
npm run serve
```

Then open `http://localhost:8765` in a browser.

## License

MIT. See [LICENSE](LICENSE). Fonts in `fonts/` are licensed under the SIL Open Font License (`fonts/OFL.txt`).
