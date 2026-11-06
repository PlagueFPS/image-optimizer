# @plaguefps/img

A Node.js CLI (`img`) built on top of [`sharp`](https://github.com/lovell/sharp) for resizing and converting image files or directories to WebP, AVIF, JPEG, PNG, GIF, or TIFF output. Requires Node.js 22.19 or later.

## Features

- **Format conversion**: Convert JPEG, PNG, WebP, AVIF, TIFF, GIF, and SVG inputs. Output encoders and settings are described below.
- **Resizing and cropping**: Resize by width, height, or both using `inside`, `outside`, `cover`, `contain`, or `fill` fit modes, compass or smart (`entropy`, `attention`) crop anchors, background padding, alpha flattening, and opt-in upscaling.
- **Batch directory processing**: Optimize single files or entire directory trees (`--recursive`) while mirroring subdirectory structure, excluding relative path prefixes (`--exclude`), and encoding images concurrently (`--concurrency`).
- **Non-destructive file safety**: Preserves source files unless `--move` is set, skips existing destinations unless `--overwrite` is passed, rejects overlapping trees and output collisions before writing, ignores symlinks, and stages writes atomically.
- **Dry runs and automation**: Preview planned destinations without writing files (`--dry-run`), emit structured per-image JSON reports (`--json`), strip or preserve metadata (`--metadata`), and generate shell completions (`--completions`).

## Install

Install globally to make `img` available anywhere, or run directly without installing via `npx @plaguefps/img`, `pnpm dlx @plaguefps/img`, or `bunx @plaguefps/img`.

### npm

```sh
npm install --global @plaguefps/img
```

### pnpm

```sh
pnpm add --global @plaguefps/img
```

### bun

```sh
bun add --global @plaguefps/img
```

## Usage

Resize and convert a single file:

```sh
img optimize -s ./photo.jpg -o ./optimized --format avif --width 1280
```

Optimize an image at its source dimensions and create additional widths:

```sh
img optimize -s ./input.png -o ./optimized -f webp --sizes 384,868,1200
```

This creates `input.webp`, `input-384.webp`, `input-868.webp`, and `input-1200.webp`. Each variant preserves the source aspect ratio. Widths must be positive integers. Repeated widths produce one variant.

Add `--width`, `--height`, or both to resize the primary output using the configured fit. For example, `--width 600 --sizes 384,868,1200` creates a primary output up to 600 pixels wide and variants at 384, 868, and 1200 pixels. Every variant derives directly from the original image and preserves its aspect ratio, regardless of the primary dimensions or fit. Variants can exceed the primary width. The primary output does not enlarge smaller originals unless `--upscale` is set. Variants wider than the original still require `--upscale`.

Without `--upscale`, a variant width larger than the auto-oriented source width fails without writing that variant. Valid outputs still complete, and the command exits with code 1. Dry runs also check this limit and write nothing.

If the output directory is missing, the CLI asks whether to create it (default: yes). Declining cancels optimization without writing files. It prompts once; missing parents and mirrored subdirectories are created automatically after confirmation. Dry runs and inputs with no matching images do not prompt or create directories.

For unattended commands, pass `--yes` (or `-y`) to create the output directory without prompting, or create it first (for example, `mkdir -p ./optimized`). Prompts go to stderr so `--json` keeps stdout machine-readable. Closed input without an answer cancels the command.

Archive originals after optimization:

```sh
img optimize -s ./assets -o ../optimized --move ../originals --recursive --yes
```

`--output` remains required. `--move` copies the original bytes with their original filenames and extensions, mirrors relative directories, then deletes each source file. With `--sizes`, every output for a source must succeed before its original moves. Dry runs, skipped outputs, and failed outputs leave that source in place. Non-image files, excluded files, and source directories remain in place.

Source, output, and archive trees must not overlap. Archive collisions fail planning before writes, including with `--overwrite`. Archives can be on another filesystem. Copies are staged in the archive directory and published without replacing existing files before the source is removed. Copy failures preserve the source. Relocation failures exit with code 1 and retain completed optimized outputs.

When `--move` is set, JSON results include the planned `archive` path. After a relocation attempt, each output for that source includes a `relocation` object with `destination` and `status` of `moved` or `failed`. Failures also include `error`. Output `status` and size summaries still describe completed optimization writes. A failed relocation can leave both the source and archive if source removal fails.

Crop a directory of images to square thumbnails:

```sh
img optimize -s ./assets -o ../thumbnails --recursive --width 400 --height 400 --fit cover --position attention
```

Preview planned destinations as JSON without writing files:

```sh
img optimize -s ./assets -o ../optimized --recursive --dry-run --json
```

Inspect CLI help and generate shell completions:

```sh
img optimize --help
img --completions bash
```

## Format support

The CLI accepts `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.tif`, `.tiff`, `.gif`, and `.svg` inputs. Extensions are case insensitive, including in directories. SVG input rasterizes before resizing. SVG output and raw pixel output are not supported.

Use canonical output names. Sharp aliases such as `jpg` and `tif` are not CLI format names. Output filenames use the selected format name.

| Output | Settings                                                           | Runtime requirement               |
| ------ | ------------------------------------------------------------------ | --------------------------------- |
| `webp` | Quality, effort, optional lossless                                 | WebP encoder                      |
| `avif` | Quality, effort, optional lossless                                 | HEIF encoder with AV1 compression |
| `jpeg` | Quality                                                            | JPEG encoder                      |
| `png`  | Compression level, always lossless, no palette quantization        | PNG encoder                       |
| `gif`  | Sharp palette defaults, ignores quality and effort                 | GIF encoder                       |
| `tiff` | Quality with JPEG compression by default; `--lossless` selects LZW | TIFF encoder                      |

All listed formats are supported by Sharp's prebuilt binaries. The CLI checks native output capability before planning file work, including dry runs and empty directories.

`--quality` stays between 1 and 100. `--effort` stays between 0 and 6 for WebP and AVIF. Other formats ignore effort. GIF palette quantization cannot promise lossless arbitrary source pixels, so `--lossless` rejects GIF. TIFF's lossless mode ignores quality.

GIF output uses the same independent frame transforms as WebP. GIF palette quantization can change colors.

## Animation

Animated GIF and WebP inputs retain all frames, frame delays, and the loop count when converted to GIF or WebP, including resized outputs and `--sizes` variants. Animation timing is preserved without `--metadata`. Resizing processes each frame independently so neighboring frames cannot blend. Fit, crop position, transparency, flattening, and optional metadata retention apply to each frame.

WebP rejects frame delays outside 11 to 65535 milliseconds, including 10 ms delays that its encoder would change to 100 ms. GIF accepts delays from 10 to 65530 milliseconds in multiples of 10. Other delays are rejected before writes. Loop counts above 65535 are rejected because Sharp cannot encode them.

Animated inputs cannot be converted to AVIF, JPEG, PNG, or TIFF. The CLI reports a failed job and exits with code 1, including for `--dry-run`. Existing output files remain untouched on rejection, even with `--overwrite`. Animated inputs with EXIF orientation other than 1 must have their frame orientation normalized before conversion. Still images retain automatic EXIF rotation.

Multipage documents such as TIFF convert only the first page.

## Options

| Flag              | Default   | Description                                                                                                         |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `--help`, `-h`    | `false`   | View CLI options and descriptions.                                                                                  |
| `--source`, `-s`  | `.`       | Source file or directory, relative to the current working directory.                                                |
| `--output`, `-o`  | Required  | Output directory.                                                                                                   |
| `--move`          | None      | Archive original files in this directory after all outputs succeed, then remove sources. Never overwrites archives. |
| `--format`, `-f`  | `webp`    | Output format: `webp`, `avif`, `jpeg`, `png`, `gif`, or `tiff`.                                                     |
| `--quality`, `-q` | `80`      | WebP, AVIF, JPEG, or TIFF quality (`1` to `100`).                                                                   |
| `--effort`, `-e`  | `4`       | WebP or AVIF encoder effort (`0` to `6`).                                                                           |
| `--compression`   | `9`       | PNG lossless compression level (`0` to `9`).                                                                        |
| `--width`, `-w`   | `0`       | Target width in pixels (`0` leaves width unconstrained).                                                            |
| `--height`        | `0`       | Target height in pixels (`0` leaves height unconstrained).                                                          |
| `--sizes`         | None      | Additional widths from original. Base uses configured dimensions and fit. See above for upscaling.                  |
| `--fit`           | `inside`  | Resize fit mode: `inside`, `contain`, `cover`, `fill`, or `outside`.                                                |
| `--position`      | `centre`  | Crop anchor or padding alignment: compass directions, `entropy`, or `attention`.                                    |
| `--background`    | `#ffffff` | Background color for `contain` padding or `--flatten`.                                                              |
| `--flatten`       | `false`   | Remove alpha transparency using `--background`.                                                                     |
| `--upscale`       | `false`   | Allow enlarging images smaller than the target dimensions.                                                          |
| `--lossless`      | `false`   | Lossless WebP, AVIF, or TIFF. PNG is always lossless. JPEG and GIF reject this flag.                                |
| `--metadata`      | `false`   | Preserve source metadata instead of stripping it.                                                                   |
| `--recursive`     | `false`   | Process subdirectories recursively.                                                                                 |
| `--exclude`       | None      | Exclude a source-relative file or directory prefix (repeatable).                                                    |
| `--concurrency`   | CPU-based | Maximum concurrent file workflows (minimum `1`); default described below.                                           |
| `--overwrite`     | `false`   | Replace existing output files instead of skipping them.                                                             |
| `--dry-run`       | `false`   | Preview planned outputs without encoding source images or writing files.                                            |
| `--summary-json`  | `false`   | Print `{ "results": [...], "summary": {...} }` as JSON. Overrides `--json`.                                         |
| `--yes`, `-y`     | `false`   | Create a missing output directory without prompting.                                                                |
| `--json`          | `false`   | Print per-image results as a JSON array to stdout.                                                                  |

By default, the CLI processes images concurrently using 75% of the available CPU
cores, rounded down to at least one image. Set `--concurrency` to override this
limit. Higher concurrency can increase peak memory use; use a lower value for
large images or limited memory.

## Startup and repeated commands

Help, version, and shell completion commands do not load Sharp or the image-processing code. Image conversion still starts a fresh Node process on each invocation. Process a directory in one command to share initialization across its images.

For repeated invocations, Node's compile cache can reduce JavaScript startup work. It is opt-in because the first invocation can be slower. On a POSIX shell, reuse the same cache directory across commands:

```sh
NODE_COMPILE_CACHE=/tmp/img-code-cache img optimize -s ./assets -o ../optimized --yes
```

This caches compiled JavaScript, not image results. Every image is still processed. Performance depends on Node version and workload; code changes or an empty cache require compilation again.

## Size reports

Human reports show input bytes, output bytes, saved bytes, and percentage reduction for each completed output, followed by a summary. `--json` keeps its top-level array and adds `inputBytes`, `outputBytes`, `savedBytes`, and `reductionPercent` to optimized results. The existing `bytes` field remains an alias for `outputBytes`.

Use `--summary-json` for an object with `results` and `summary`. The summary includes counts for `optimized`, `skipped`, `planned`, and `failed`, plus the same size fields. Only completed writes contribute bytes. Skipped, failed, and dry-run results have no size fields or estimated savings. Empty runs have zero totals.

`savedBytes` is input minus output bytes. Growth produces negative savings and negative percentage reduction. Percentage reduction is `savedBytes / inputBytes * 100`, or zero when input bytes are zero. Summary percentages use byte totals rather than averaging per-output percentages.

With `--sizes`, each completed output counts its source bytes separately. For example, one source with two additional widths counts three copies of its source size when all three outputs complete. These totals compare each output to its source; they do not describe unique source storage or disk space freed. Originals remain in place unless `--move` is set.

## Changelog

See [the changelog](CHANGELOG.md) for changes in each version.
