# PaperclipRig Upgrade Record

## Audit and benchmark lab (current change)

- Added `rig-lab.js`, a dependency-free UMD module: pure-JS SHA-256 (FIPS 180-4, verified against Node `crypto` at every length 0-160 plus the KATs), cycle-safe and depth-bounded canonical JSON with prototype-pollution guards, the 11-step RDP Pareto sweep over all ten specimens, the 12-configuration atlas sweep on real sprite frames and the seeded UI kit, the six-palette OKLab audit, digest-stamped JSON/CSV/Markdown proof exports sharing one cached digest, the fail-closed `#prlab=` codec, and a 26-check self-test battery.
- Added the `#lab` section: an interactive Pareto frontier chart, an atlas efficiency chart, a palette comparator matrix that applies to the pixel bench, a proof brief with verify and one-unit tamper demo, and the in-page check runner.
- Added `assets/lab-app.js` and lab styling with `minmax(0, 1fr)` grids and `min-width: 0` children so 390px has zero horizontal overflow.
- Added `scripts/audit-headless.mjs`, a zero-dependency headless Chromium audit over raw CDP.

## Verification (current change)

- `npm test`: 531 tests, all passing, 0 skipped.
- Honesty harness (`hark_honesty_and_defect_harness.py --audit .`): 0 violations across 17 files.
- Em/en dash scan over every tracked file: 0 matches.
- Real headless Chromium CDP audit: 64/64 checks passed at 1440x900 and 390x844 plus a deep-link boot. 0 console errors, 0 page exceptions, 0 external requests, 0 horizontal overflow at both sizes; real pointer clicks on the Pareto markers, atlas bars, palette rows, verify, tamper and self-test controls; `Page.reload` restores `#prlab=` state.

## Completed changes (earlier round)

- Completed the interrupted scope wording while preserving the explicit distinction between code-authored sample fixtures and human-drawn contest art.
- Verified the existing vector, pixel, palette, PNG and atlas engines and mounted controls. No new algorithm is claimed for this repair.
- Added complete working-tree content checks and included their file type in the full suite.
- Corrected the unrelated font-license file to match the three fonts actually bundled.
- Closed-contour RDP simplification no longer collapses filled shapes to two-point zero-area paths: a collapsed half now keeps its worst vertex, so shipped spot and hub layers survive slider-legal tolerances.
- `optimizeContour` rejects negative or NaN epsilon instead of looping until the heap dies.
- `parseSvgPath` throws on a number following `Z` instead of looping forever.
- `bresenhamLine` rejects non-integer endpoints instead of walking forever.
- `drawDisc` clamps its scan box to the grid, so a huge radius can no longer hang the process.
- `floodFillGrid` uses a flat typed-array queue, filling a 2000x2000 grid instead of exhausting the heap.
- `encodePngRgba` rejects zero or negative dimensions instead of emitting a spec-invalid PNG.
- SVG and CSS exporters escape names, descriptions, URLs and class prefixes instead of interpolating raw strings.
- The descriptor download button now refuses to save an empty descriptor when atlas packing fails.
- Removed dead hero styles and the smooth-scroll rule, and the content scanner now also catches numeric character-reference dashes.
- Corrected the NOTES.md cross-reference so it matches what the docs actually record.

## Verification

Run the full suite with `npm test` (200 tests passing after the earlier round; the suite now stands at 531, all passing).

<!-- verification -->

The checked-in content scanner is proven with constructed probes. It scans all working-tree text, including its own tests, for prohibited punctuation, names, private fields and temporary output. Forbidden probes are assembled from character codes.

The changes are local and uncommitted. Implementation verification does not replace the pending independent code review.
