# Generate width variants

The `sizes` journey drives `img optimize -s second.png -o output --sizes 32,64,32 --json` through the built executable.

```sh
.agents/skills/verify-image-optimizer/scripts/verify.ts sizes --evidence "$VERIFY_EVIDENCE/sizes"
```

The journey checks that the base keeps its dimensions and that two distinct variants have the requested widths and preserve aspect ratio. It fully decodes each output, rejects a 1000-pixel variant without `--upscale`, and verifies that opt-in enlargement produces that width. With `--width 32 --sizes 64,128`, the primary shrinks to 32 pixels while variants remain wider than the primary. With `--width 1000`, the primary keeps the smaller original width by default and enlarges only with `--upscale`. Every output preserves the original aspect ratio. The journey also rejects `--height` combined with `--width` and `--sizes` before creating the output directory. Dry runs with `--width` and `--sizes` must list all valid outputs, reject an oversized variant, and leave the scratch inventory unchanged. Original hashes must match after every command.

Require `result.json` to report `passed` and `cleanup.json` to report `removed: true`. The evidence includes command transcripts, copied output images, and decoded metadata.

This journey uses the committed 567-pixel-wide PNG. It does not cover orientation, malformed input, collisions, or overwrite behavior. The CLI test suite covers those cases.
