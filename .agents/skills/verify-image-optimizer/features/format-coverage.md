# Verify expanded formats and SVG input

Build the checkout with `vp pack` and run the skill's doctor first.

Run the real CLI subprocess journeys with:

```sh
vp test tests/cli.test.ts -t 'output follows real encoder|SVG file|file output without|TIFF lossless|GIF output preserves'
```

These tests invoke `node dist/cli.mjs optimize` in isolated temporary trees. Sharp observes and fully decodes outputs. No optimizer internals or mocks are used.

- `format-runtime`: GIF, TIFF, JP2, HEIF, and JXL attempt a real runtime encode. Available outputs resize to width 16 and roundtrip through the CLI to PNG with equal decoded pixels.
- `format-unavailable`: unavailable encoders exit 1, create no destination directory even for dry runs, and preserve existing destination bytes with `--overwrite`.
- `svg-rasterization`: lowercase and uppercase SVG inputs work as files and recursive directories. Width variants and recursive rasterization have exact dimensions. Dry runs create no directory and original SVG text stays intact.
- `file-output-boundary`: SVG and raw output are rejected before writes.
- `format-lossless`: GIF rejects a lossless promise. TIFF LZW preserves decoded source pixels.
- `gif-frames`: two distinct frames preserve their colors, timing, loop count, and resized dimensions. TIFF rejects the same multi-page source without writing an output image.

The tests remove their scratch trees after completion. Retain the test runner output as evidence. They do not retain image artifacts. Use the seeded conversion, directory, and safety drives for persistent transcripts and decoded artifacts for existing formats.

Conditional encoders are tested as available or unavailable according to the installed native runtime. A passing unavailable branch does not prove encoding on a custom libvips build. Existing output animation policy belongs to the separate animation change.
