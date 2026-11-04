# @plaguefps/img

An Effect-native Node.js CLI (`img`) built on top of [`sharp`](https://github.com/lovell/sharp) for resizing and converting image files or directories to WebP, AVIF, JPEG, PNG, GIF, or TIFF output. Requires Node.js 22.12 or later.

## Features

- **Format conversion**: Convert JPEG, PNG, WebP, AVIF, TIFF, GIF, and SVG inputs. Output encoders and settings are described below.
- **Resizing and cropping**: Resize by width, height, or both using `inside`, `outside`, `cover`, `contain`, or `fill` fit modes, compass or smart (`entropy`, `attention`) crop anchors, background padding, alpha flattening, and opt-in upscaling.
- **Batch directory processing**: Optimize single files or entire directory trees (`--recursive`) while mirroring subdirectory structure, excluding relative path prefixes (`--exclude`), and encoding images concurrently (`--concurrency`).
- **Non-destructive file safety**: Preserves source files, skips existing destinations unless `--overwrite` is passed, rejects overlapping trees and output collisions before writing, ignores symlinks, and stages writes atomically.
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

This creates `input.webp`, `input-384.webp`, `input-868.webp`, and `input-1200.webp`. Each variant preserves the source aspect ratio. Widths must be positive integers. Repeated widths produce one variant. `--sizes` cannot be combined with `--width` or `--height`.

Without `--upscale`, a width larger than the auto-oriented source width fails without writing that variant. Valid outputs still complete, and the command exits with code 1. Dry runs also check this limit and write nothing.

If the output directory is missing, the CLI asks whether to create it (default: yes). Declining cancels optimization without writing files. It prompts once; missing parents and mirrored subdirectories are created automatically after confirmation. Dry runs and inputs with no matching images do not prompt or create directories.

For unattended commands, pass `--yes` (or `-y`) to create the output directory without prompting, or create it first (for example, `mkdir -p ./optimized`). Prompts go to stderr so `--json` keeps stdout machine-readable. Closed input without an answer cancels the command.

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

Multipage documents such as TIFF retain the existing first-page conversion behavior. Page count alone does not identify an animation.

## Options

| Flag              | Default   | Description                                                                                                                   |
| ----------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `--help`, `-h`    | `false`   | View CLI options and descriptions.                                                                                            |
| `--source`, `-s`  | `.`       | Source file or directory, relative to the current working directory.                                                          |
| `--output`, `-o`  | Required  | Output directory.                                                                                                             |
| `--format`, `-f`  | `webp`    | Output format: `webp`, `avif`, `jpeg`, `png`, `gif`, or `tiff`.                                                               |
| `--quality`, `-q` | `80`      | WebP, AVIF, JPEG, or TIFF quality (`1` to `100`).                                                                             |
| `--effort`, `-e`  | `4`       | WebP or AVIF encoder effort (`0` to `6`).                                                                                     |
| `--compression`   | `9`       | PNG lossless compression level (`0` to `9`).                                                                                  |
| `--width`, `-w`   | `0`       | Target width in pixels (`0` leaves width unconstrained).                                                                      |
| `--height`        | `0`       | Target height in pixels (`0` leaves height unconstrained).                                                                    |
| `--sizes`         | None      | Comma-separated additional widths. Creates source-sized output plus `name-WIDTH` variants. Larger widths require `--upscale`. |
| `--fit`           | `inside`  | Resize fit mode: `inside`, `contain`, `cover`, `fill`, or `outside`.                                                          |
| `--position`      | `centre`  | Crop anchor or padding alignment: compass directions, `entropy`, or `attention`.                                              |
| `--background`    | `#ffffff` | Background color for `contain` padding or `--flatten`.                                                                        |
| `--flatten`       | `false`   | Remove alpha transparency using `--background`.                                                                               |
| `--upscale`       | `false`   | Allow enlarging images smaller than the target dimensions.                                                                    |
| `--lossless`      | `false`   | Lossless WebP, AVIF, or TIFF. PNG is always lossless. JPEG and GIF reject this flag.                                          |
| `--metadata`      | `false`   | Preserve source metadata instead of stripping it.                                                                             |
| `--recursive`     | `false`   | Process subdirectories recursively.                                                                                           |
| `--exclude`       | None      | Exclude a source-relative file or directory prefix (repeatable).                                                              |
| `--concurrency`   | CPU-based | Maximum concurrent file workflows (minimum `1`); default described below.                                                     |
| `--overwrite`     | `false`   | Replace existing output files instead of skipping them.                                                                       |
| `--dry-run`       | `false`   | Preview planned outputs without encoding source images or writing files.                                                      |
| `--yes`, `-y`     | `false`   | Create a missing output directory without prompting.                                                                          |
| `--json`          | `false`   | Print per-image results as a JSON array to stdout.                                                                            |

The default file concurrency is `max(1, floor(availableParallelism() * 0.75))`, using Node's available CPU estimate.
The CLI sets Sharp's libvips concurrency to one thread per image. `--concurrency` overrides the file workflow limit.
Actual simultaneous encodes also depend on libuv's thread pool; the CLI leaves `UV_THREADPOOL_SIZE` unchanged.
Some codecs use additional threads independently of the libvips setting.

Scaling by 75% is a heuristic, not a measured optimum or a CPU reservation.
Higher concurrency can increase peak memory use; lower `--concurrency` for large images or limited memory.

## Why

I wanted a reliable, consistent, and fast image optimization CLI that my agents and I could use from any project without having to write a custom
script for each project or one-off optimizations. I also wanted an agent-friendly CLI that would be easy to use, have well documented help text, have structured outputs for agents to read, not crash the whole process if one image failed, support dry runs, support the most command image formats, and be able to process entire directories/subdirectories built-in without the agent needing to write a custom python/shell script to do so.
