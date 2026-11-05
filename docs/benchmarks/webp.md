# WebP CLI performance

Measured on November 4, 2026, America/New_York. The baseline is commit `5057aec`. The updated executable is from `847b5ee`.

The goal was to reduce complete CLI latency while keeping TypeScript and preserving output and file safety. The updated CLI is faster on all four tested workloads. All baseline and updated outputs are byte-identical.

## Results

Each cell contains the median and minimum to maximum elapsed time in milliseconds from five runs. The baseline was rerun alongside the updated executable and native tools, rather than compared with an earlier session.

| Workload                                 | Previous img            | Updated img          | cwebp                | ImageMagick          |
| ---------------------------------------- | ----------------------- | -------------------- | -------------------- | -------------------- |
| 567×324 transparent PNG                  | 430.7 [419.6, 439.2]    | 118.1 [115.3, 123.2] | 20.2 [19.8, 22.8]    | 23.9 [23.5, 32.6]    |
| 3872×2592 JPEG                           | 1056.5 [1047.5, 1058.6] | 740.3 [738.3, 742.9] | 602.1 [599.0, 604.6] | 657.4 [647.3, 664.8] |
| JPEG resized to 1280×857                 | 530.6 [524.2, 538.5]    | 211.1 [207.0, 215.3] | 149.2 [147.7, 149.8] | 332.0 [330.0, 340.5] |
| 24-image directory, width capped at 1280 | 806.5 [801.6, 818.3]    | 312.3 [307.2, 315.3] | 188.3 [182.1, 193.3] | 328.7 [320.8, 392.4] |

Raw trial data is in [webp-runs.csv](webp-runs.csv). The previous and updated CLI use their shipped defaults, with `UV_THREADPOOL_SIZE` unset. Native tools use the batch settings selected by the earlier pilot. These are configuration comparisons, not a claim of universal implementation superiority.

## Changes

- Bundle Effect and Node platform JavaScript so each process loads fewer dependency files. Sharp stays external so its native package resolution still works.
- Minify the bundle. The initial bundled executable shrank from 1,085,749 to 285,593 bytes. A separate 15-pair small-file experiment measured medians of 126.3 and 124.0 ms. This is a small benefit compared with bundling.
- Initialize the libuv pool before loading Sharp. Its automatic size follows the existing 75%-CPU file-concurrency policy, capped at 16. Explicit environment values remain untouched. `--concurrency` continues to set file workflows separately.
- Emit a synchronous CommonJS launcher. An ESM bootstrap worked on Node 26 but was too late on Node 22.12, where module loading had already initialized the pool. The application source remains TypeScript. The package bin and all local callers use `dist/cli.cjs`.
- Catch startup import failures explicitly, preserving exit code 1 even with permissive Node rejection settings.

The optimizer, encoder settings, planning checks, atomic output publication, animation handling, and reporting implementation are unchanged. `src/command.ts` is byte-identical to the baseline `src/cli.ts`.

## Workloads and tuning

- Corpus preparation and validation happen outside the timed interval. Each run gets a fresh empty output directory. Timing includes process launch, decode, transforms, encoding, writes and process exit. Native batches include Python thread-pool dispatch. No fsync durability claim is made.
- All tools encode lossy WebP at quality 80 and method or effort 4, with lossless alpha and stripped metadata. cwebp and ImageMagick enable codec threading for single images. ImageMagick uses one OpenMP thread per process.
- The batch contains 12 cropped 1920×1280 JPEG derivatives of the committed photo and 12 brightness variants of the committed transparent PNG. Total input size is 13,147,568 bytes. cwebp uses 12 parallel processes. ImageMagick uses 16. Native batch codec threading is off. img defaults to 12 file workflows on this machine, previously limited by four libuv workers and now configured with 12.
- Cases use the same two fixture families as the original investigation. This is a limited corpus. AVIF, lossless PNG, JPEG optimization, animations, responsive sizes, and larger diverse directories have no performance claim here.
- cwebp gets explicit target dimensions to avoid its different default rounding. Resized images still use different resamplers. Unresized outputs are byte-identical across all tools. Updated and previous img outputs are byte-identical for every workload.
- Mean RGB PSNR against the Sharp-resized reference is 37.73 dB for resized img, 37.10 dB for cwebp, and 37.74 dB for ImageMagick. That reference favors the Sharp resize pipeline and is not an equal perceptual quality comparison. Batch output sizes are 1,623,456 bytes for img, 1,518,986 for cwebp, and 1,622,806 for ImageMagick.

## Environment

Ubuntu 26.04 under virtualization, Intel Core i5-12600K with 16 visible logical CPUs and about 15.5 GiB RAM. Node 26.13.0, Sharp 0.35.5, libvips 8.18.7, bundled libwebp 1.6.0, cwebp 1.5.0, ImageMagick 7.1.2-18 Q16 using system libwebp 1.5.0. `/tmp` is tmpfs. Every sample starts a fresh process with warm filesystem caches and no enabled Node compile cache. Pre-benchmark load averages were 0.76, 0.63 and 0.46, with no competing CPU-heavy task in the process listing.

## Benchmark checklist

1. The limiter was measured separately. Startup CPU profiles previously showed module compilation and resolution. A post-change five-run help control fell from median 398.3 ms to 86.5 ms. The baseline small-image profile sampled 87.4 ms in module compilation and 35.3 ms in CommonJS wrapping, while the updated profile sampled 15.3 ms in wrapping and no substantial ESM compilation entry. Single-photo CPU/wall ratios remain about one core, consistent with native image computation. Batch child CPU/wall increased from 2.50 to 7.21. Startup and worker capacity explain the improvements. Native codec inner loops were not symbol-profiled.
2. Builds are production artifacts with explicit equivalent encoding settings. Native batch settings were tuned in a pilot. The CLI default comparison is deliberate. Codec versions and resize algorithms differ, so matched-quality tool adoption rankings remain inconclusive.
3. All CPU/wall ratios are below 16 visible CPUs. The fastest native batch handles about 70 MB/s of compressed input on tmpfs. This makes no disk bandwidth claim. The time removed from small jobs is consistent with measured startup cost; native encoding still takes time.
4. All 80 final trials passed. All 540 outputs fully decoded with expected dimensions and format, exact alpha preservation, and RGB PSNR at least 20 dB. img JSON reports confirmed every expected job optimized with no failed or skipped jobs. Earlier rejected experiments and the reproduced startup regression are excluded from headline timings.
5. Five rounds rotate the four configurations. Tables report median and full range. Hashes are stable across repetitions. The large baseline-to-updated gaps exceed the observed ranges. Close secondary results are not used to claim a universal winner.
6. These are complete CLI commands. Startup controls and CPU profiles are separate diagnostics, not headline timings. Directory processing measures a realistic batch path, subject to the narrow corpus.
7. Subprocesses are awaited until exit. Fresh destinations prevent skips. Every timed result is decoded and hashed after the timed region. Image work and writes must finish before exit. Profilers and validation do not run inside reported timing intervals.

## Verification and tradeoffs

`vp check` passed without warnings. `vp test` passed all 128 tests, including packed-package execution and two reproduced startup-error cases. The repository verification driver passed conversion, resize, sizes, directories, dry-run and safety journeys on Node 26.13.0. Conversion and safety also passed on the minimum supported Node 22.12.0. Native worker observations on both runtimes confirmed the automatic pool and the explicit two-worker override.

A separate single batch memory observation on Node 26 peaked at 249,276 KiB before and 283,556 KiB after. This is about 243 and 277 MiB and is not a repeated memory benchmark. More native workers can increase peak memory. Users can lower file concurrency or explicitly set the pool. Preloads can still initialize libuv before the launcher; an environment value set before launching Node remains authoritative.

Automatic Node compile caching was rejected. A separate experiment measured median 124.2 ms disabled, 131.3 ms on a cold cache and 113.9 ms warm. The warm benefit did not justify a new default cold penalty and cache writes. Users can opt in through Node environment settings.

A final five-round worker sweep compared workflow/pool pairs of 12/12, 12/16 and 16/16. Medians were 323.9, 327.9 and 308.8 ms, but their ranges overlapped substantially. That experiment did not justify replacing the existing file-concurrency policy with a higher default.

The remaining gaps include Node and Sharp initialization, Effect command setup, safety work, native pipeline differences and codec versions. No exact remaining cost or lower bound is claimed. Removing the command framework or keeping a persistent worker would change the maintenance or execution model and was not included.

## Local evidence and replay

The preserved executable, complete output hashes, original scripts, profiles, memory observations, verification transcripts and append-only decision log are retained at `/home/angel/.t3/artifacts/image-optimizer-speedup`. This is local evidence, not a portable benchmark package. The measurement scripts use `/tmp/img-speedup` and `/tmp/img-benchmark` assets prepared during this session.

From this checkout, with those retained assets available, rerun the exact comparison with:

```sh
vp run build
python3 /tmp/img-speedup/run.py final
```

The reproduction command overwrites the local final timing JSON but uses fresh output trees. Building a portable multi-format benchmark tool is outside this change.
