# Protect files and report failures

Skip existing outputs unless overwrite is requested, reject unsafe destinations, and report individual encoding failures without losing valid results.

## Sub-features

- `safety-overwrite`: skip retains bytes; explicit overwrite changes width and bytes.
- `safety-originals`: same-file overwrite and overlapping trees rejected.
- `safety-planning`: invalid quality and colliding stems fail before writing.
- `safety-partial`: corrupt image fails while valid image finishes.

## How to get to it (user POV)

Run `image-optimizer optimize -s photo.jpg -o output --overwrite --width 32 --json`; errors use the same optimize entry point and exit 1.

## Driving it with the subprocess harness

Preconditions: Launch and Doctor succeed; use the pristine fixture tree described in the skill. Select a new evidence directory.

```sh
.agents/skills/verify-image-optimizer/scripts/verify.ts safety --evidence "$VERIFY_EVIDENCE/safety"
```

- **Drive and observe.** Encode width 16; rerun at 32 without overwrite and require skipped status and unchanged hash; rerun with `--overwrite` and require optimized status, changed hash and decoded width 32. Request an output inside the input directory, then same-file PNG overwrite: require exit 1 and preserved originals. Request `--quality 101`: require exit 1 with no output. Seed same.jpg and same.png and convert their directory: require exit 1 with no output directory. Finally seed valid.jpg plus corrupt broken.png and run optimize: require exit 1, one optimized and one failed JSON result, a decodable valid.webp and no broken.webp.
- **Proof.** Require exit zero from the helper, `result.json` with status passed, recorded argv/stdout/stderr/exit codes, and unchanged input hashes. Inspect copied outputs and metadata where produced. After cleanup, `cleanup.json` must report removed and command/result artifacts must still exist.

## Gotchas

Use second.png with PNG output in its own directory for the original-protection check: photo.jpg converted to photo.jpeg is a different filename and is allowed. Planning/validation failures can occur before a JSON report exists; inspect stderr and exit code. Partial batches still emit a JSON array on stdout and exit 1. Preserve failure evidence instead of treating valid output as overall success.
