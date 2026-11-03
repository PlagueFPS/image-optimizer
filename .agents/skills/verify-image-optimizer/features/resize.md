# Resize and fit images

Choose bounds and fitting behavior, with enlargement enabled only when requested.

## Sub-features

- `resize-fits`: inside, outside, cover, contain, fill dimensions.
- `resize-upscale`: no enlargement by default; explicit enlargement with --upscale.

## How to get to it (user POV)

Run `image-optimizer optimize -s second.png -o output --width 20 --height 20 --fit cover`.

## Driving it with the subprocess harness

Preconditions: Launch and Doctor succeed; use the pristine fixture tree described in the skill. Select a new evidence directory.

```sh
.agents/skills/verify-image-optimizer/scripts/verify.ts resize --evidence "$VERIFY_EVIDENCE/resize"
```

- **Drive and observe.** For each fit, run the nested PNG as a single-file source with `--width 20 --height 20 --fit FIT --json`. Inside must be width 20 with shorter height; outside must be height 20 with wider width; cover/contain/fill must be 20×20. Run again with `--width 1000` both without and with `--upscale`: decoded widths must be 567 and 1000 respectively.
- **Proof.** Require exit zero from the helper, `result.json` with status passed, recorded argv/stdout/stderr/exit codes, and unchanged input hashes. Inspect copied outputs and metadata where produced. After cleanup, `cleanup.json` must report removed and command/result artifacts must still exist.

## Gotchas

The committed PNG is wider than tall and 567 pixels wide. A changed fixture can invalidate these preconditions and must be reported. `-h` is help; height uses `--height`. This journey proves dimensions, not crop-position pixels or padding color.
