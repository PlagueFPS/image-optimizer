# Convert a single image

Convert a file to WebP, AVIF, JPEG, or PNG while retaining the source.

## Sub-features

- `convert-formats`: each output decodes as its selected format at width 32.
- `convert-json`: reports optimized status and the actual encoded byte count.
- `convert-human`: default WebP command prints an optimized line and produces a decodable file.

## How to get to it (user POV)

Run `img optimize -s photo.jpg -o output --format avif --width 32 --json`, or omit format/JSON for defaults.

## Driving it with the subprocess harness

Preconditions: Launch and Doctor succeed; use the pristine fixture tree described in the skill. Select a new evidence directory.

```sh
.agents/skills/verify-image-optimizer/scripts/verify.ts conversion --evidence "$VERIFY_EVIDENCE/conversion"
```

- **Drive and observe.** For each of `webp`, `avif`, `jpeg`, and `png`, the helper runs `node dist/cli.mjs optimize -s INPUT/photo.jpg -o FORMAT --json --format FORMAT --width 32`. It requires one optimized result, the correct byte count, width 32, and a fully decodable image of the selected format. It then runs the same single-file entry without `--json` or format, checking `optimized:` and decoded WebP output.
- **Proof.** Require exit zero from the helper, `result.json` with status passed, recorded argv/stdout/stderr/exit codes, and unchanged input hashes. Inspect copied outputs and metadata where produced. After cleanup, `cleanup.json` must report removed and command/result artifacts must still exist.

## Gotchas

AVIF is reported as `heif` by Sharp. Byte sizes vary with codec versions; never assert an arbitrary compression ratio. A same-extension conversion must use a separate output directory.
