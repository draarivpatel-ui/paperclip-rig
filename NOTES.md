# Notes and Honesty Disclosure

## What this repository is

`paperclip-rig` (`Paperclip Vector & Sprite Rig`) is an open source browser workbench for editing cubic Bezier paths, simplifying contours with Ramer-Douglas-Peucker, painting multi-frame indexed pixel sprites with OKLab lightness-ranked palette swapping, and packing frames into texture atlases with the MaxRects Best Short Side Fit heuristic.

Live page: https://aariv.me/paperclip-rig/

## Hack Club Paperclip disclosure

Hack Club Paperclip prizes are for human-drawn art. Everything in this repository, including [engine.js](engine.js), [assets/app.js](assets/app.js), [assets/data.js](assets/data.js), and the eighteen sample SVG and PNG assets in `assets/`, was generated in code with an AI-assisted workflow.

Because of that:

- The eighteen sample assets are deterministic code fixtures and starting points for the workbench editors, not hand-drawn artwork.
- This repository is an open source rigging and packing workbench, not a Hack Club Paperclip art submission, and should never be submitted as hand-drawn art.
- If a human artist draws their own vectors or pixel sprites, they can use the algorithms and exporters here to simplify paths, test palettes, and pack sprite sheets.

## What was verified

- `npm test` (`node --test "tests/*.test.js"`) runs 185 tests across [tests/engine.test.js](tests/engine.test.js) and [tests/dom-smoke.test.js](tests/dom-smoke.test.js), verifying De Casteljau cubic evaluation and subdivision, exact derivative-root bounding boxes, open and closed Ramer-Douglas-Peucker simplification, smooth cubic refitting, curvature comb normals, MaxRects Best Short Side Fit bin packing and overlap validation, TexturePacker/Phaser/Godot/CSS descriptor output, Bresenham lines, 4-connected flood fill, OKLab and CIE Lab colour conversions, lightness-ordered palette remapping, stored-block PNG encoding (checked by inflating with `node:zlib` and verifying CRC32 and Adler32 checksums), static asset equivalence against `scripts/export-assets.js`, and full controller interactions across all three benches.
- `hark_honesty_and_defect_harness.py --audit` reports `0` violations across the repository.
- `hark_honesty_and_defect_harness.py --planted-defects ... --count 25` catches `25/25` planted mutations (`0` escaped).

## What was not verified

- The TexturePacker JSON, Phaser 3 multiatlas JSON, and Godot region list descriptors follow the documented schemas and are verified by unit tests, but they were not loaded into a live Phaser 3 or Godot project in this build.
- The stored-block PNG encoder writes valid uncompressed DEFLATE blocks (`BTYPE=00`) so that output is deterministic and dependency-free in the browser; files are larger than compressed PNGs.
- Accessibility attributes (`aria-label`, `aria-pressed`, `role="status"`, keyboard arrow nudging on both the SVG vector plate and the pixel canvas) are tested in the DOM smoke suite, but have not been tested with a live human screen-reader session.

## Verification commands

```bash
node --test "tests/*.test.js"
python3 "../../hark_honesty_and_defect_harness.py" --audit .
python3 "../../hark_honesty_and_defect_harness.py" --planted-defects . --count 25
```
