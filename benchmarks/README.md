# Compare the Rust CLI with Sharp

Performance acceptance is pending. This directory supplies a rerunnable measurement tool, not evidence that the production CLI meets its speed or memory goal. `run.py` always labels its verdict inconclusive. A reviewer must confirm settings, inspect failures and variation, and profile the limiter before accepting a comparison.

## Run the comparison

Use Linux, Node.js 22.12 or later, Python 3.10 or later, Cargo, and GNU `/usr/bin/time`.

1. Install the pinned Sharp package and its bundled native dependencies.

   ```sh
   cd benchmarks
   SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci
   ```

2. Generate the fixtures and download the two NASA images.

   ```sh
   npm run fixtures
   npm test
   ```

3. Inspect `uptime` and `nproc`. Stop competing work when possible. Record unavoidable contention in your report.

4. Run the default comparison. The command builds with `cargo build --release --locked` before timing.

   ```sh
   python3 run.py --cpu 1 --runs 5
   ```

5. Read `results/<timestamp>/results.json` and the per-process logs. Exit status 1 means setup, conversion, timeout, or verification failed. Acceptance remains pending even when exit status is 0.

To exercise the reference before the production CLI is available, run:

```sh
python3 run.py --sharp-only --case resize-noise --case srcset-photo
```

To test other CPU budgets, repeat with `--cpu 2` or `--cpu 4`. Run budgets sequentially. `--quality` defaults to 80, and `--effort` defaults to 6. At least five runs per side are mandatory. `--case NAME` is repeatable. An unknown name prints the available cases. `--timeout` defaults to 600 seconds per conversion. A timeout kills the entire process group.

For a separately built release executable, supply its absolute path and provenance:

```sh
python3 run.py --skip-build --binary /absolute/path/to/release/image-optimizer --backend-notes backend-notes.txt
```

Use `--results PATH` for a new results directory. The tool refuses an existing directory. Outputs and raw logs stay there for inspection. Generated fixtures, dependencies, and measurement directories are ignored by Git.

## Adapt the production interface

`adapter.py` owns the Rust argument mapping. Its expected contract is:

```text
image-optimizer INPUT --out-dir DIR [--recursive] [--width WIDTH | --widths 480,960] --format webp|preserve --quality 80 --effort 6 --cpu 1 --json
```

`run.py` checks that the executable advertises `--out-dir` and `--widths`. A missing contract fails before timing. Update that check with the adapter if the contract changes. Never route measurements to a debug executable. A custom binary requires `--skip-build`; the operator must document its release build provenance. The tool cannot infer optimization settings from an executable.

`reference.mjs` owns the reference geometry, encoder settings, file traversal, and sequential scheduling. It reads the same job JSON supplied to the adapter. `verify.mjs` checks every output. Output filenames are not part of verification, so a different Rust srcset naming convention needs no adapter change.

## Measurement reference

Each side runs in a fresh process. The order is Rust, Sharp, Rust, Sharp for each case, with the starting side reversed for the next case. Five repetitions produce five observations per side. Fixture creation, Cargo builds, version probes, and output verification are outside the timed region.

The recorded high-resolution wall time covers process creation, runtime startup, directory traversal, decode, resize, encode, output writes, JSON output, and process exit. The clock stops immediately after the blocking process wait, before watchdog cleanup. Sharp conversion does not call the post-run expectations metadata probe. GNU time also records elapsed time, user CPU time, system CPU time, exit status, and peak resident memory in KiB. GNU time elapsed values have coarse precision, so summaries use the high-resolution wall clock.

GNU time measures the directly executed process, including its threads. Both intended implementations run their work within that process. This is not a sum of simultaneous RSS across subprocesses. If a future backend forks workers, replace RSS collection with cgroup peak memory or another process-tree-aware collector before reporting memory results. The process-group timeout remains effective for subprocesses.

Every record includes the command, job, exit code, load before and after, resource counters, verification details, and paths to retained outputs. Separate files contain stdout, stderr, GNU time output, and job JSON. `results.json` adds:

- Machine information, CPU affinity, core count, memory information, and initial load.
- Git HEAD and dirty status, binary hash, binary version, help text, and Cargo dependency tree.
- Node, Sharp, libvips, and bundled codec versions from `sharp.versions`.
- Hashes of the measurement scripts, lockfile, and all fixture files, including directory copies.
- Fixture generator versions, source URLs, credits, dimensions, byte sizes, and SHA-256 hashes.
- Successful observation counts, medians, minima, and maxima for wall time and RSS. Failed records are excluded from those descriptive summaries and retained as errors.

Rust native backend versions may not appear in `cargo tree`. Supply `--backend-notes FILE` with the actual linked codec versions, release build command, compiler flags, geometry policy, and thread policy. The file contents are embedded in the report. Do not compare an old system libvips version with bundled Sharp as if they were the same backend. Installation and child processes set `SHARP_IGNORE_GLOBAL_LIBVIPS=1`.

## Workload reference

Generated JPEG, transparent PNG, AVIF, and SVG inputs are 3000 by 2000 pixels. The raster generator uses a fixed xorshift32 seed, gradients, noise, and partial transparency. The SVG contains 1,500 translucent circles. These inputs exercise more work than tiny icons.

The downloaded inputs are NASA's 2048-pixel Blue Marble composite and its 512-pixel Eileen Collins astronaut photograph. They retain their original dimensions. `fixtures/manifest.json` records source URLs and credits. NASA's [imagery usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) apply. The astronaut source is distributed by [scikit-image](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut). The photos are downloaded, not committed. Keep a manifest and fixture archive with any published result. Photo downloads are checked against pinned SHA-256 hashes. `fixtures.lock.json` records the initial generated bytes and dimensions. Generated encoder bytes can change across versions and architectures; every run records its actual hashes.

Every input has full-size WebP conversion and a 960-pixel resize case. Raster inputs also have a 480-pixel preserve-format case. The Blue Marble image has a 480, 960, and 1920 srcset case. An additional EXIF6 photo resize uses a 1600 by 1000 crop from Blue Marble, encoded at JPEG quality 92 with orientation 6. It is kept separate from directory fixtures. There are 21 cases in total. The flat directory contains all six original inputs. The recursive directory contains all six in a nested directory and produces two widths per input. Directory inputs have distinct stems to avoid accidental overwrite.

Preserve-format SVG resizing is excluded because Sharp has no SVG output encoder. This omission does not establish production support or justify silently rasterizing a preserve request. AVIF preserve output uses AV1. PNG preserve output is lossless, so its quality flag has no equivalent effect.

## Match options before accepting results

The reference sets the following options explicitly. Compare each with the production backend and document discrepancies. The same numeric quality or effort across codecs does not establish the same visual quality or encoding cost.

- Auto-orient EXIF input, preserve aspect ratio, and prevent enlargement. Resize uses Lanczos3. SVG rasterization uses density 72. Metadata is stripped by Sharp's default output behavior.
- WebP uses lossy quality 80, effort 6, alpha quality 100, and disables near-lossless, lossless, and smart subsampling.
- JPEG uses quality 80, baseline output, optimized Huffman coding, 4:2:0 chroma, and disables mozjpeg. PNG uses compression level 6, no palette, and adaptive filtering. AVIF uses quality 80, effort 6, 4:2:0 chroma, SSIM tuning, 8-bit depth, and lossy encoding.
- `sharp.cache(false)` disables the libvips operation cache. `sharp.concurrency(cpu)` controls libvips workers. Files and widths run sequentially. `UV_THREADPOOL_SIZE`, `VIPS_CONCURRENCY`, `RAYON_NUM_THREADS`, and `OMP_NUM_THREADS` receive the same CPU value. These settings are thread requests, not an OS CPU quota. Check actual native encoder threading and the Rust scheduling policy before accepting a comparison.

The [Sharp output options](https://sharp.pixelplumbing.com/api-output/) and [global properties](https://sharp.pixelplumbing.com/api-utility/) describe these controls. The installed package and lockfile determine actual behavior.

## Verify work and interpret results

Verification counts every file in the output tree, including unexpected files. It checks each image's format and dimensions, then forces a full Sharp raw-pixel decode with warnings treated as failures. Each expected output must match one decoded output. SHA-256 hashes and byte sizes are retained.

A 32 by 32 sRGB thumbnail comparison also checks that output content resembles its source, after orientation and alpha flattening onto white. The closest remaining source with matching geometry and format must have root mean square channel error at most 40 on the 0 to 255 scale. This is a loose smoke check for wrong or blank images, not a visual-quality metric. The selected source and error are recorded. Similar inputs and duplicate images can remain ambiguous. Candidate selection also checks expected alpha semantics and full-resolution alpha-plane error after source orientation and resizing. Nonopaque source pixels require an alpha-bearing output. Alpha RMSE must be at most 5 on the 0 to 255 scale. Opaque sources do not require a particular channel count. Alpha filtering happens before thumbnail ranking so similar white composites cannot consume the wrong source candidate. Regression tests reject flattened outputs and changed alpha planes. Filename mapping, exact pixels, color management, and metadata need separate acceptance tests.

Before publishing a speed or memory claim:

1. Confirm that all expected workloads completed with five successful runs per side. Treat any conversion or decode error as an invalid comparison.
2. Confirm encoder, geometry, thread, and scheduling settings for both sides. Record remaining mismatches next to the result. Do not claim parity from matching flags alone.
3. Run a separate, untimed profile. Use `perf`, `pidstat`, or another profiler to identify the limiter and map it to the backend. Keep that evidence beside the report. CPU times and load averages alone do not identify a hot path.
4. Compare medians and ranges. Treat differences smaller than run-to-run variation as no measurable difference. Use an appropriate statistical test for close results. This tool does not choose a winner or calculate a speedup.
5. Check resource plausibility against available cores, input and output bytes, disk throughput, and the measured CPU times. Check that JSON success messages agree with decoded outputs.

The benchmark measures a local filesystem with warmed OS caches after early trials. It does not flush caches, synchronize writes to stable storage, isolate NUMA, pin CPU affinity, or control clock scaling and thermal state. Node startup is included. Directory throughput depends on scheduling; the sequential reference may differ from a parallel production CLI. Two NASA images and synthetic rasters do not represent every photographic, animated, EXIF, ICC, CMYK, malformed, or adversarial input. Output size is recorded, but perceptual quality and equal rate-distortion are not measured. RSS is not total allocated memory, and the Python coordinator and post-run decoder are outside its measurement.
