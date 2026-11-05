# Verify expanded formats and SVG input

Build the checkout with `vp pack` and run the skill's doctor first.

Run the real CLI subprocess journeys with:

```sh
vp test tests/cli.test.ts -t 'output roundtrips|SVG file|file output without|TIFF lossless|GIF output preserves|GIF frames|GIF rejects|multipage'
```

These tests invoke `node dist/cli.cjs optimize` in isolated temporary trees. Sharp observes and fully decodes outputs. No optimizer internals or mocks are used.

- `format-roundtrip`: GIF and TIFF outputs resize to width 16 and roundtrip through the CLI to PNG with equal decoded pixels.
- `svg-rasterization`: lowercase and uppercase SVG inputs work as files and recursive directories. Width variants and recursive rasterization have exact dimensions. Dry runs create no directory and original SVG text stays intact.
- `file-output-boundary`: SVG, raw, JP2, HEIF, and JXL output are rejected before writes.
- `format-lossless`: GIF rejects a lossless promise. TIFF LZW preserves decoded source pixels.
- `gif-frames`: two distinct frames preserve their colors, timing, loop count, and resized dimensions. TIFF rejects the same timed source without writing an output image. GIF frames and size variants match independent still transforms pixel by pixel, including 10 ms and 65530 ms delays. Unrepresentable WebP delays reject GIF conversion before writes. Loop count 65536 rejects both GIF and WebP output before writes.

The tests remove their scratch trees after completion. Retain the test runner output as evidence. They do not retain image artifacts. Use the seeded conversion, directory, and safety drives for persistent transcripts and decoded artifacts for existing formats.

Animation support builds on the animation change. Multipage TIFF retains first-page behavior for PNG, TIFF, and GIF.
