# Preserve animation

Animated GIF and WebP inputs produce animated WebP or GIF outputs. Unsupported animation conversions fail before writing.

## Drive through the built CLI

After Launch and Doctor, run the CLI integration journeys below. Each test creates isolated inputs and invokes `node dist/cli.mjs optimize` in subprocesses.

```sh
vp test tests/cli.test.ts -t 'animation|animated|multipage'
```

The journeys generate a two-frame GIF with solid red and blue frames, delays of 120 and 340 milliseconds, and loop count 3. They check source bytes after conversion, decode both output frames, and check page count, timing, and dimensions. The default conversion, explicit width and height, and `--sizes 20,40` must all preserve animation. Short-frame regressions compare every decoded pixel with solid red and blue expectations for width-only, height-only, fill, and `--sizes` resizing. Transparent animated WebP tests compare each frame against an independently converted still image across all five fit modes, with and without flattening, while retaining EXIF and ICC metadata. Supported dry runs must create no destination directory.

GIF and WebP fixtures with delays `[10,20]` must fail when converted to WebP before creating destinations, including dry runs and size variants. Existing destination bytes must survive `--overwrite`. WebP delays are 11 to 65535 milliseconds. GIF delays are 10 to 65530 milliseconds in steps of 10.

Conversions to AVIF, JPEG, PNG, TIFF, JP2, HEIF, and JXL must exit 1 with an animation or unavailable-encoder error for normal runs, dry runs, and size variants. Rejection must create no destination directory. With `--overwrite`, preexisting destination bytes must remain unchanged.

Animated WebP inputs must retain their frame count and timing. Inputs with EXIF orientation 3 or 6 must fail in normal and dry runs without creating output. A two-page TIFF must still convert its first page to PNG without becoming an animation.

## Limits

Animation detection requires multiple pages and timing metadata. Animated inputs with EXIF orientation other than 1 require frame orientation normalization before conversion. The CLI does not provide frame-by-frame orientation transforms.

The test runner removes scratch files after the run. Retain its output as assertion evidence. Use the seeded `resize`, `sizes`, `dry-run`, and `safety` drives for persistent command transcripts and file hashes on the unchanged still-image paths.
