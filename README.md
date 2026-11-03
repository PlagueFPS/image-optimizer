# Image optimizer

An Effect-native Node CLI for resizing and converting image files or directories to WebP, AVIF, JPEG, or PNG.
Requires Node.js 22.12 or later. Source files are preserved.

## Run

After this package is published, use any of these package runners.

```sh
npx @plaguefps/image-optimizer optimize -s ./assets -o ../optimized
pnpm dlx @plaguefps/image-optimizer optimize -s ./assets -o ../optimized
bunx @plaguefps/image-optimizer optimize -s ./assets -o ../optimized
```

The executable uses Node through its shebang, including when installed with Bun.
`pnx` can also run the package if you have configured that alias or runner.
The package has not been published by this change.

Resize and convert a single file.

```sh
image-optimizer optimize -s ./photo.jpg -o ./optimized --format avif --width 1280
```

Crop a directory of images to square thumbnails.

```sh
image-optimizer optimize -s ./assets -o ../thumbnails --recursive --width 400 --height 400 --fit cover --position attention
```

Preview destinations without creating directories or encoding images.

```sh
npx @plaguefps/image-optimizer optimize -s ./assets -o ../optimized --recursive --dry-run --json
```

Inspect all flags and generate shell completions.

```sh
image-optimizer optimize --help
image-optimizer --completions bash
```

## Options

`optimize` accepts these options. Use `--dry-run` to preview destinations without writing files.

| Flag              | Default   | Behavior                                                                            |
| ----------------- | --------- | ----------------------------------------------------------------------------------- |
| `--source`, `-s`  | `.`       | Source file or directory, relative to the current working directory.                |
| `--output`, `-o`  | Required  | Output directory. Directory inputs require a separate tree.                         |
| `--format`, `-f`  | `webp`    | `webp`, `avif`, `jpeg`, or `png`.                                                   |
| `--quality`, `-q` | `80`      | WebP/AVIF/JPEG quality, 1 to 100. PNG is always lossless.                           |
| `--effort`, `-e`  | `4`       | WebP or AVIF effort, 0 to 6.                                                        |
| `--compression`   | `9`       | PNG compression level, 0 to 9.                                                      |
| `--width`, `-w`   | `0`       | Target width. Zero leaves width unconstrained.                                      |
| `--height`        | `0`       | Target height. Zero leaves height unconstrained.                                    |
| `--fit`           | `inside`  | Sharp resize mode. Also accepts `contain`, `cover`, `fill`, and `outside`.          |
| `--position`      | `centre`  | Crop anchor or contain alignment. Compass directions, `entropy`, or `attention`.    |
| `--background`    | `#ffffff` | Background color for contain or flatten.                                            |
| `--flatten`       | `false`   | Remove alpha using the background color.                                            |
| `--upscale`       | `false`   | Allow enlargement during resizing.                                                  |
| `--lossless`      | `false`   | Lossless WebP or AVIF encoding. JPEG rejects this flag. PNG is always lossless.     |
| `--metadata`      | `false`   | Preserve metadata instead of stripping it.                                          |
| `--recursive`     | `false`   | Opt into processing subdirectories.                                                 |
| `--exclude`       | None      | Exclude a source-relative file or directory prefix. Repeatable. Use `/` separators. |
| `--concurrency`   | `4`       | Maximum concurrent images, 1 to 64.                                                 |
| `--overwrite`     | `false`   | Replace existing destinations. Otherwise skip them.                                 |
| `--dry-run`       | `false`   | Preview destinations without encoding or writing.                                   |
| `--json`          | `false`   | Print a JSON array of per-image results to stdout.                                  |

Use `--height` to set height. `-h` and `--help` display help. Subdirectories are skipped unless `--recursive` is supplied.

Input extensions are JPG, JPEG, PNG, WebP, AVIF, TIFF, TIF, and GIF.
Animated inputs produce a single still frame. Relative directory structure is preserved.
Multiple inputs mapping to one destination fail before any files are written.
Collision checks are case insensitive for portability.
Symlinks within directories are skipped. Explicit symlink sources are rejected.
Directory input and output trees cannot overlap, including through existing symlinks.
A single-file input can write into its own directory when conversion changes its filename.
An output that would replace the original is rejected, even with `--overwrite`.
Output files are staged beside their destinations and published only after encoding completes.
A failed file does not prevent other images from finishing.
Exit status is `0` for success, skipped files, empty directories, help, and version.
Exit status is `1` for argument errors, invalid settings, planning errors, or any failed image.
With `--json`, completed batches emit one JSON array on stdout, including partial failures.
Each result includes `source`, `output`, and `status`. Status is `planned`, `optimized`, `skipped`, or `failed`.
Optimized results include encoded `bytes`. Failed results include an `error` message.
Validation and planning failures emit diagnostics on stderr before a report can be produced.
Empty source directories emit `[]` in JSON mode.

## Resize behavior

`inside` preserves aspect ratio within the requested bounds. `outside` preserves aspect ratio and covers both bounds without cropping.
`cover` crops to the requested rectangle. `contain` pads to that rectangle using `--background`.
`fill` stretches to the rectangle and can distort the image. Supply both dimensions for a fixed rectangle.
`--position` chooses the crop anchor or padding alignment. `entropy` and `attention` select a region automatically for cover crops.
Enlargement is disabled by default. Small sources can produce smaller results than the requested rectangle unless `--upscale` is enabled.

PNG uses full-color lossless compression and ignores quality and effort.
WebP and AVIF accept quality, effort, and lossless settings. JPEG accepts quality and rejects lossless mode.
Metadata is stripped by default. `--metadata` preserves it. Images are automatically rotated using orientation metadata.

## Install before publication

Build and install the local package globally to make the executable available from any directory.

```sh
npm install
npm install --global .
image-optimizer --help
```

Alternatively, run `npm pack` and install the generated `.tgz` with npm. A registry release is still required for the package-name runner commands above.

## Develop

This is one Vite+ package. Effect owns CLI parsing, schema validation, filesystem access,
concurrency, and NodeRuntime execution. Sharp is wrapped at the encoding boundary.

```sh
vp install
npm run check
npm run build
npm test
npm pack
```

Tests run the built CLI and install its tarball into an isolated consumer directory.
The test command builds the executable before running assertions.
`pnpm run check` runs `vp check` to check formatting, lint, and type-check the project.
The postinstall hook patches the installed tools with Effect support so `vp lint` and `vp check` can use the Effect rules.
The recommended, effect-native, and style presets are enabled with warnings treated as failures.
Node builtin imports are permitted only in the subprocess integration tests.
Effect's unstable CLI and platform APIs are explicitly allowed in the language-service configuration.

The module responsibilities are `cli.ts` for commands, `options.ts` for validated policy,
`optimizer.ts` for filesystem planning and publication, and `encoder.ts` for Sharp adaptation.
Migration choices and verification expectations are recorded in `docs/decisions.tsv`.
