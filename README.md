# Image optimizer

Convert individual images or directory trees to WebP, generate srcset variants, or resize while retaining a raster format. Uses in-process libvips with shrink-on-load. Defaults are quality 80, effort 6, and one libvips worker thread.

## Build on Linux

Requires Rust with edition 2024 support, a C linker, and libvips 8.15 or newer with JPEG, PNG, WebP, librsvg, and HEIF/AV1 support. Tested with Rust 1.96 and Ubuntu 26.04 libvips 8.18.0. Linux with mounted `/proc` is required. The CLI uses descriptor paths to keep filenames containing brackets out of libvips's filename option parser.

On Ubuntu 26.04:

```sh
sudo apt-get update
sudo apt-get install build-essential pkg-config libvips-dev libvips-tools libheif-plugin-aomdec libheif-plugin-aomenc
cargo build --release
cargo install --path . --locked
cargo test
cargo clippy --all-targets -- -D warnings
```

The Rust binding links dynamically to `vips`, `glib-2.0`, and `gobject-2.0`. Deployment needs matching shared libraries and the libvips HEIF module, plus its AV1 codec plugins. Copying only the binary is insufficient. Use distribution packages in the deployment image, or bundle those libraries and modules with their licenses and configure the dynamic loader. Codec availability depends on how libvips was built. A missing codec is an error for that input, not a silent skip.

For this development machine, sudo requires interactive authentication. Packages were downloaded with `apt-get download` and extracted with `dpkg-deb -x` under `/tmp/image-vips`. Use the following environment for builds, tests, and the independent benchmark on this machine:

```sh
export LIBRARY_PATH=/tmp/image-vips/usr/lib/x86_64-linux-gnu
export LD_LIBRARY_PATH=/tmp/image-vips/usr/lib/x86_64-linux-gnu
export VIPSHOME=/tmp/image-vips/usr/lib
```

This temporary package extraction is not part of the repository or a deployment strategy. `VIPSHOME` points libvips to the extracted module directory. Three unused modules with unavailable dependencies, Poppler, OpenSlide, and ImageMagick, were moved to `/tmp/image-vips/disabled-modules`. The system's libheif AV1 plugins are available. The ordinary package installation above needs none of these environment overrides.

## Convert images

```sh
image-optimizer photo.jpg --out-dir optimized
image-optimizer assets --out-dir optimized --recursive --cpu 2 --json
image-optimizer photo.jpg --out-dir optimized --widths 480,960,1440
image-optimizer photo.png --out-dir resized --width 800 --height 600 --format preserve
image-optimizer photo.jpg -o result.webp --width 960 --quality 80 --effort 6
image-optimizer assets --out-dir optimized --recursive --dry-run --json
```

`-o` requires one file and one variant. `--format` selects the encoder, even when the exact output filename has a different extension. `--out-dir` and `-o` are mutually exclusive. Directory traversal is shallow unless `--recursive` is set. Supported input extensions are `.jpg`, `.jpeg`, `.png`, `.avif`, and `.svg`, case-insensitively. File contents must match the extension. Other extensions in directories are ignored. An explicit unsupported file is an error.

Output names keep the full source filename, such as `photo.jpg.webp`, `photo.png.webp`, and `photo.jpg.480w.webp`. Relative directories are retained. Width and height together add both bounds to the name, such as `photo.jpg.800w.600h.webp`.

Width and height define a bounding box with preserved aspect ratio and no crop. A single bound constrains only that axis. Small images retain their original size unless `--upscale` is set. Srcset consumers must use the actual `width` in the report, rather than assuming the requested width was reached. Bounds are integers from 1 to 32768. At most 32 unique widths are allowed.

`--format preserve` reencodes JPEG, PNG, or AVIF in that format. Resizing requires reencoding and is not byte-lossless. PNG uses lossless compression without palette reduction, but orientation, color conversion, and 8-bit output can still change pixel values. SVG preserve is explicitly unsupported. Use WebP to rasterize supported SVGs.

## Output and failure contract

All destination paths are planned before the first write. Existing outputs fail unless `--overwrite` is set. Input/output identity, including existing hard-link aliases, duplicate producers, and symlink paths are rejected. Symlinks found during directory discovery are ignored. A nested destination tree is excluded from discovery. An output directory equal to the source directory is rejected.

Encoders write a destination-local temporary file. Completed output is synced and published atomically with no-clobber semantics, or by atomic replacement under `--overwrite`. Failed encodes remove the temporary file. Publication is atomic per variant, not across the entire invocation. The containing directory is not fsynced, so this is not a power-loss durability guarantee. Do not concurrently rename parent directories or replace source files during a run. Path checks are not a sandbox against an attacker mutating the filesystem.

Independent input and encode failures do not stop the remaining jobs. Any failure produces exit status 1. Invalid command-line syntax produces Clap's error text and exit status 2. An empty input directory succeeds with an empty report. Output files already completed remain available after a later failure.

`--json` writes one JSON object to stdout. Diagnostics from native libraries may appear on stderr. Schema version 1 has these fields:

```json
{
  "schema_version": 1,
  "dry_run": false,
  "outputs": [{
    "input": "/absolute/photo.jpg",
    "output": "/absolute/optimized/photo.jpg.480w.webp",
    "format": "webp",
    "width": 480,
    "height": 320,
    "bytes": 12345,
    "requested_width": 480
  }],
  "errors": [{
    "input": "/absolute/broken.png",
    "output": "/absolute/optimized/broken.png.webp",
    "error": "decode failed"
  }]
}
```

Paths are absolute and must be UTF-8. Non-UTF-8 discovered names produce explicit errors with lossy diagnostic paths. Formats are `webp`, `jpeg`, `png`, or `avif`. Successful jobs appear in `outputs`, failed jobs in `errors`. Global errors have a null output path. `requested_width` is null for original-size or height-only transforms. In dry runs `bytes` is null, headers and geometry are inspected, and no directories or files are created. A dry run does not force complete pixel decode and cannot certify an image is uncorrupted. Invalid CLI syntax does not produce a JSON report.

## Image and resource policy

EXIF orientation is applied before geometry. Images are converted to sRGB through libvips thumbnail color management, using embedded ICC profiles when present and libvips defaults otherwise. EXIF, XMP, IPTC, ICC, and other metadata are stripped from outputs. No linear-light resize is requested, to retain decoder shrink-on-load. Output is intended for web use, with 8-bit encoder defaults. HDR and wide-gamut preservation are not supported.

PNG, WebP, and AVIF retain alpha. WebP alpha quality remains 100. Lossy encoding may change RGB values, including invisible RGB beneath transparent pixels. JPEG inputs do not carry alpha.

Multipage images, detected animation, APNG animation-control chunks, and AVIF sequence brands are rejected. SVG support is restricted to static, self-contained documents up to 4 MiB. Scripts, animation elements, embedded images, stylesheets, inline CSS, event handlers, document types, base URLs, and external references are rejected. Internal fragment references and presentation attributes are allowed. This deliberately excludes some otherwise valid SVG files. It is not a general SVG sanitization service or an untrusted-image sandbox.

There is one active source variant at a time. Libvips operation caching is disabled. `--cpu` sets libvips concurrency, not process affinity or a hard thread limit for every codec. `--effort` accepts 0 to 6 for WebP and AVIF, and maps directly to PNG compression. JPEG always enables optimized Huffman coding and does not use effort. `--quality` applies to lossy WebP, JPEG, and AVIF. PNG ignores quality. Codec effort scales are not comparable.

`--max-pixels` defaults to 100000000 and rejects both source and estimated output pixel counts before pixel evaluation. It is not a hard memory limit. Decoder headers, native codec buffers, image entropy, and the size of the directory plan still affect RSS. Use OS process limits or a container for hard resource isolation. AVIF codec memory use depends on the installed libheif and AV1 implementation.

## Verify changes

```sh
cargo fmt --check
cargo check
cargo test
cargo clippy --all-targets -- -D warnings
cargo build --release
```

Integration tests launch the actual CLI and decode generated outputs. They cover geometry, srcset names, alpha, orientation, JPEG/PNG/AVIF preserve mode, SVG rasterization and restrictions, nested output exclusion, corruption, overwrite behavior, symlinks, input identity, and argument validation. AVIF fixtures are generated through the installed native codec during tests, so missing AV1 support fails the tests.

Speed and peak RSS parity with Sharp remain unproven until the independent benchmark worker runs the shared harness. This implementation makes no parity claim.
