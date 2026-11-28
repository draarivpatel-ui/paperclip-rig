# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/paperclip-rig/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static Paperclip Rig browser workbench, including the vector bench, pixel bench, atlas press, audit and benchmark lab, share-link codec, proof brief exports and the sample asset pipeline.

In scope:

- A cross-site scripting or HTML injection path through vector specimen data, sprite or frame names, atlas descriptors, share links or report output.
- A share-link decoder flaw that bypasses validation, restores attacker-controlled state outside documented bounds or executes code.
- An export escaping flaw that makes generated SVG, PNG, JSON, CSV, CSS or Markdown output execute a formula or script when opened.
- A digest or verification bypass in the proof brief that lets tampered output pass as genuine.
- A malformed asset or oversized input that bypasses documented validation and corrupts the session.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- The documented approximation limits of simplification, packing and palette mapping algorithms, unless a report shows a specific validation or output integrity failure.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
