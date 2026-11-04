# Preserve animation

Animated GIF and WebP inputs produce animated WebP outputs. Unsupported animation conversions fail before writing.

## Drive through the built CLI

After Launch and Doctor, run the CLI integration journeys below. Each test creates isolated inputs and invokes `node dist/cli.mjs optimize` in subprocesses.

```sh
vp test tests/cli.test.ts -t 'animation|animated|multipage'
```

The journeys generate a two-frame GIF with solid red and blue frames, delays of 120 and 340 milliseconds, and loop count 3. They check source bytes after conversion, decode both output frames, and check page count, timing, and dimensions. The default conversion, explicit width and height, and `--sizes 20,40` must all preserve animation. Supported dry runs must create no destination directory.

Conversions to AVIF, JPEG, and PNG must exit 1 with an animation error for normal runs, dry runs, and size variants. Rejection must create no destination directory. With `--overwrite`, preexisting destination bytes must remain unchanged.

Animated WebP inputs must retain their frame count and timing. Inputs with EXIF orientation 3 or 6 must fail in normal and dry runs without creating output. A two-page TIFF must still convert its first page to PNG without becoming an animation.

## Limits

Animation detection requires multiple pages and timing metadata. Animated inputs with EXIF orientation other than 1 require frame orientation normalization before conversion. The CLI does not add output formats or provide frame-by-frame orientation transforms.

The test runner removes scratch files after the run. Retain its output as assertion evidence. Use the seeded `resize`, `sizes`, `dry-run`, and `safety` drives for persistent command transcripts and file hashes on the unchanged still-image paths.
