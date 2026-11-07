# @plaguefps/img

## 0.3.0

### Minor Changes

- cfec724: Allow `--width`, `--height`, or both with `--sizes` to resize the primary output using the configured fit while generating aspect-preserving variants directly from the original image.

### Patch Changes

- 413eddf: Allow `--move` after the primary output and all eligible variants succeed when an oversized variant is rejected without `--upscale`. Keep the rejected result failed and exit with code 1, while every result reports the moved source and its archive destination.

## 0.2.0

### Minor Changes

- ed3efcb: Add `--move <directory>` to archive original images after all their outputs succeed, preserving filenames and relative paths. Dry runs, skips, and failures leave originals in place, and existing archive files are never overwritten.

## 0.1.0

Initial release of the `img` CLI for image conversion, resizing, directory processing,
and structured reports. Supports dry runs and preserves source images.
