# Notes and Scope

## What this repository is

`paperclip-rig` (`Paperclip Vector & Sprite Rig`) is an open source browser workbench for editing cubic Bezier paths, simplifying contours with Ramer-Douglas-Peucker, painting multi-frame indexed pixel sprites with OKLab lightness-ranked palette swapping, and packing frames into texture atlases with the MaxRects Best Short Side Fit heuristic.

Live page: https://aariv.me/paperclip-rig/

## Hack Club Paperclip disclosure

Hack Club Paperclip prizes are for human-drawn art. Everything in this repository, including [engine.js](engine.js), [assets/app.js](assets/app.js), [assets/data.js](assets/data.js), and the eighteen sample SVG and PNG assets in `assets/`, was authored in code as deterministic fixtures.

Because of that:

- The eighteen sample assets are deterministic code fixtures and starting points for the workbench editors, not hand-drawn artwork.
- This repository is an open source rigging and packing workbench, not a Hack Club Paperclip art submission, and should never be submitted as hand-drawn art.
- If a human artist draws their own vectors or pixel sprites, they can use the algorithms and exporters here to simplify paths, test palettes, and pack sprite sheets.

## Current verification

Run `npm test`. The full suite includes engine, mounted controller and self-scanning content tests. DEVPOST_UPGRADE.md records the verified suite result at the time of each change.

Coverage includes cubic evaluation, derivative-root bounds, open and closed contour simplification, smooth refitting, atlas packing and overlap checks, descriptor output, raster drawing, palette math, stored-block PNG encoding and static asset equivalence. The existing three benches remain the implementation; no new algorithm is claimed for this repair.

## What was not verified

- The TexturePacker JSON, Phaser 3 multiatlas JSON, and Godot region list descriptors follow the documented schemas and are verified by unit tests, but they were not loaded into a live Phaser 3 or Godot project in this build.
- The stored-block PNG encoder writes valid uncompressed DEFLATE blocks (`BTYPE=00`) so that output is deterministic and dependency-free in the browser; files are larger than compressed PNGs.
- Accessibility attributes (`aria-label`, `aria-pressed`, `role="status"`, keyboard arrow nudging on both the SVG vector plate and the pixel canvas) are tested in the DOM smoke suite, but have not been tested with a live human screen-reader session.

## Verification command

```bash
npm test
```
