# Performance acceptance

The speed and peak-memory goal fails on this configuration. All 21 workloads completed five alternating fresh-process runs per side, with 210 successful processes, 390 decoded outputs, and zero conversion or verification failures. Output-policy acceptance also fails because Rust retains source ICC profiles while Sharp strips them. Descriptive timings are retained, but this is not an accepted settings-equivalent parity result. Causal attribution remains incomplete.

Measured production source was `00fa00d7d93dba2fb38dbb6d9e60a85cb24d799f`. Benchmark scripts had the changes committed with this report. The raw report records their SHA-256 hashes and the release binary hash. Earlier `initial-comparison`, `fixed-comparison`, `fixed-comparison-v2`, and `fixed-comparison-v3` directories are exploratory and rejected. Only `fixed-comparison-v4` supplies the table.

## Measurements

Each cell gives the median followed by [minimum, maximum]. Latency is milliseconds and RSS is MiB. Bytes are total output bytes per invocation, Rust then Sharp. Process startup and output publication are included. Verification and profiling are excluded.

| Workload | Rust ms | Sharp ms | Rust MiB | Sharp MiB | Output bytes R / S |
|---|---:|---:|---:|---:|---:|
| convert-noise | 1900.4 [1899.9, 1928.1] | 2265.2 [2261.8, 2287.3] | 101.4 [101.0, 101.5] | 143.8 [143.5, 144.3] | 1758542 / 1758542 |
| resize-noise | 161.8 [160.1, 164.3] | 208.5 [205.4, 213.9] | 48.1 [47.9, 48.3] | 83.8 [83.7, 84.0] | 68508 / 70160 |
| preserve-noise | 51.9 [51.1, 52.9] | 84.7 [83.0, 87.1] | 38.7 [38.6, 38.7] | 77.4 [77.1, 77.7] | 24827 / 25122 |
| convert-alpha | 4254.0 [4228.9, 4291.8] | 3918.7 [3892.9, 3991.2] | 159.1 [159.0, 159.2] | 208.3 [207.9, 208.6] | 2286474 / 2286474 |
| resize-alpha | 654.8 [648.8, 659.1] | 1016.4 [1014.3, 1025.1] | 80.1 [80.0, 80.4] | 123.1 [122.5, 123.3] | 95946 / 95946 |
| preserve-alpha | 189.2 [188.7, 192.2] | 174.2 [171.5, 174.4] | 53.0 [52.6, 53.1] | 94.5 [93.9, 95.0] | 338092 / 358811 |
| convert-translucent | 4547.7 [4536.9, 4606.2] | 4479.1 [4469.4, 4504.4] | 368.8 [368.4, 368.9] | 267.9 [267.5, 268.1] | 2153058 / 2153058 |
| resize-translucent | 1038.4 [1030.8, 1048.9] | 1567.7 [1560.7, 1570.8] | 300.8 [300.6, 300.9] | 198.3 [198.1, 198.6] | 95016 / 95016 |
| preserve-translucent | 1901.2 [1895.9, 1907.8] | 2768.9 [2738.0, 2807.3] | 284.6 [284.4, 284.6] | 194.9 [194.5, 195.0] | 34587 / 34604 |
| convert-vector | 4848.0 [4813.9, 4905.0] | 5052.9 [5006.1, 5121.3] | 124.0 [123.8, 124.3] | 162.0 [161.6, 162.2] | 351868 / 351868 |
| resize-vector | 328.2 [326.8, 333.5] | 391.3 [387.2, 396.8] | 46.5 [46.4, 46.6] | 86.6 [86.2, 87.0] | 91842 / 91842 |
| convert-earth | 245.4 [243.1, 246.4] | 319.2 [314.7, 332.3] | 47.1 [47.0, 47.6] | 88.5 [88.2, 88.7] | 152298 / 152298 |
| resize-earth | 94.5 [93.9, 95.3] | 142.2 [140.6, 144.5] | 39.7 [39.4, 39.8] | 83.0 [82.5, 83.3] | 44116 / 44116 |
| preserve-earth | 27.1 [27.0, 27.6] | 65.1 [63.2, 66.2] | 35.3 [35.1, 35.8] | 75.5 [74.9, 75.8] | 20025 / 20025 |
| convert-astronaut | 63.7 [63.2, 64.1] | 111.8 [109.4, 117.5] | 33.2 [33.0, 33.4] | 73.7 [73.6, 73.9] | 33216 / 30046 |
| resize-astronaut | 63.9 [63.7, 65.0] | 112.9 [110.5, 114.0] | 33.0 [32.8, 33.2] | 74.0 [73.4, 74.2] | 33216 / 30046 |
| preserve-astronaut | 69.4 [68.2, 72.0] | 75.3 [73.0, 78.5] | 33.8 [33.7, 33.9] | 73.5 [72.9, 73.9] | 371738 / 381445 |
| srcset-photo | 334.4 [332.9, 338.4] | 411.0 [409.8, 413.3] | 59.0 [58.5, 60.6] | 100.3 [97.6, 100.9] | 190016 / 190016 |
| resize-exif6-photo | 200.6 [199.0, 200.8] | 279.7 [272.7, 281.2] | 49.4 [47.5, 49.9] | 91.0 [88.7, 91.4] | 110862 / 110356 |
| directory-flat | 37728.8 [37552.5, 37795.9] | 15691.2 [15503.0, 15797.2] | 472.5 [467.9, 480.6] | 363.9 [344.5, 364.3] | 6735456 / 6732286 |
| directory-recursive-srcset | 3423.7 [3410.3, 3429.8] | 5094.1 [5080.6, 5153.7] | 386.2 [373.7, 393.2] | 292.7 [276.8, 297.1] | 576072 / 571360 |

A median difference inside overlapping observed ranges is inconclusive. Five runs do not establish population tails. There is no combined average or universal winner.

## Regressions and limiter evidence

| Workload with a regression | Rust latency difference | Rust RSS difference | Evidence and remaining cause |
|---|---:|---:|---|
| convert-alpha | +8.6% | -23.6% | 830 user-CPU samples, 94.7% in system libwebp. Stack includes WebPEncode. Same output bytes. Native WebP encoder is the measured limiter. Why 1.5.0 is slower than bundled 1.6.0 is not isolated. |
| preserve-alpha | +8.6% | -43.9% | Short profile has 37 samples, 62.2% in zlib deflate and 32.4% in libvips, with png_write_row on the stack. Sharp bundles zlib-ng. This locates compression work but does not prove the version causes the gap. |
| convert-translucent | +1.5% | +37.7% | Small observed time gap has disjoint trial ranges. AVIF decoder allocation attribution is unresolved. |
| resize-translucent | -33.8% | +51.7% | 182 user-CPU samples, 47.3% in libaom and 37.9% in libwebp. Source AVIF decode remains expensive despite a small destination. Heap allocation cause is unresolved. |
| preserve-translucent | -31.3% | +46.0% | Same system AOM decoder plus AV1 reencoding. Different libheif and AOM builds remain a confounder. |
| directory-flat | +140.4% | +29.8% | Rust median 37.73 s versus 15.69 s. Every Rust trial records about 20.3 to 21.0 s system CPU. User samples are 67.6% WebP, 16.5% pixman SVG rendering, 10.9% libc, 2.8% AOM. Excess system CPU and retained native memory remain unresolved. |
| directory-recursive-srcset | -32.8% | +31.9% | Faster destination resizing does not remove the directory RSS penalty. Native decode and allocator retention are hypotheses, not proven allocation causes. |

The flat-directory strace records 8,967 futex calls with 63.0 s aggregate thread syscall duration, 6,140 munmap calls, and 3,614 mmap calls. Sharp records 7,389 futex calls with 3.54 s aggregate duration and 151 munmap calls. Aggregate blocked-thread durations overlap and are not process CPU or wall time. The six Rust fsync calls total about 0.2 ms in this traced run, so fsync does not explain the 22 s latency difference. These counters locate synchronization and mapping activity but do not prove the source of the untraced excess system CPU. This remains the highest-priority runtime investigation for the parent.

Profiles were separate fresh-process runs of nine representative workloads per side, followed by separate syscall traces and output verification. Perf 7.0 was downloaded with apt and extracted locally without sudo, along with its runtime dependencies. The host permits user CPU-clock sampling with perf_event_paranoid=2. `perf record -F 199 -e cpu-clock:u --call-graph dwarf,8192` captured user-space stacks. Kernel CPU was not sampled. Native libraries are partly stripped, and Sharp combines native codecs in one shared object. The short PNG profiles have too few samples for precise percentages. There is no heap allocation profile, so AVIF and directory memory causes remain inconclusive.

[Compact perf and strace reports](benchmarks/evidence/profiles/) retain sample counts and loss counts. Full native recordings remain locally in `benchmarks/results/profiles/`. Exact untimed driver text is retained in [profile.py.txt](benchmarks/evidence/profile.py.txt). It uses local extracted perf and strace paths and the accepted v4 report. No profile observation enters the performance table.

## Decoded quality and metadata

All 390 outputs passed complete decode, format, dimensions, content and alpha verification. Nonopaque sources require alpha output, and full-resolution alpha-plane RMSE must be at most 5/255. Similar source candidates are filtered by alpha semantics before RGB thumbnail ranking. Channel counts are not required to match. White-flattened and altered-alpha negative tests pass. Output filenames are still not an acceptance identity contract.

The separate [full-resolution quality check](benchmarks/evidence/quality.json) compares the 39 first-iteration output pairs after orientation, sRGB conversion and white flattening. Maximum Rust-to-Sharp RGB RMSE is 3.594/255. Maximum source-to-output RGB RMSE is 22.127/255 on both sides for noisy lossy fixtures. Maximum alpha RMSE against the resized source is 0.242/255 on both sides. Byte sizes are in the table and raw records. These are content and shortcut checks, not perceptual quality scores or evidence of equal rate-distortion. A byte-size tolerance cannot establish matched encoder effort. The actual native options were audited instead. Exact driver text is in [quality.mjs.txt](benchmarks/evidence/quality.mjs.txt).

**Metadata policy fails.** Seven of those 39 Rust outputs retain source ICC profiles while their Sharp counterparts have no ICC profile. The astronaut convert, resize, preserve, flat-directory and two recursive variants carry the exact 3,144-byte source profile. EXIF6 resize carries the exact 480-byte source profile. Input and output ICC SHA-256 hashes match in [icc.json](benchmarks/evidence/icc.json). Production requests keep=None and profile=None but actual files contradict README's stripping promise. The parent must fix this before a new accepted comparison. No production source was changed by this worker.

## Settings and provenance

Rust uses Ubuntu libvips 8.18.0, libheif 1.21.2, AOM 3.13.1, WebP 1.5.0, libjpeg-turbo 2.1.5, PNG 1.6.57, and zlib 1.3.1. Sharp 0.35.5 on Node 24.15.0 bundles libvips 8.18.7, libheif 1.23.5, AOM 3.15.1, WebP 1.6.0, mozjpeg 0826579, PNG 1.6.58, and zlib-ng 2.3.3. These are different native builds, not an isolated language comparison.

Both sides process one file variant at a time, disable operation caching, request one libvips worker, auto-orient, prevent enlargement, use Lanczos3 and SVG density 72, and request metadata stripping. The output inspection below proves that Rust does not fully implement that request. `UV_THREADPOOL_SIZE`, `VIPS_CONCURRENCY`, `RAYON_NUM_THREADS`, and `OMP_NUM_THREADS` are all 1. This is not CPU pinning or a hard codec thread quota.

WebP is lossy Q80, effort6, alphaQ100 without near-lossless or smart subsampling. JPEG is baseline Q80 with optimized Huffman coding and 4:2:0 chroma. PNG is compression6 with all adaptive filters and no palette. AVIF is AV1 Q80, effort6, 8-bit, lossy, 4:2:0, SSIM. Rust native AUTO selects 4:2:0 at Q80. Before measurement, the Sharp reference changed AVIF 4:4:4 to 4:2:0, changed auto tuning to explicit SSIM, and made JPEG optimized coding explicit. PNG adaptive filtering was already corrected before this worker started.

The audit used the installed Sharp `src/pipeline.cc`, native operation help and headers, [libvips HEIF encoder source](https://raw.githubusercontent.com/libvips/libvips/v8.18.0/libvips/foreign/heifsave.c), [JPEG encoder source](https://raw.githubusercontent.com/libvips/libvips/v8.18.0/libvips/foreign/jpegsave.c), and [libheif AOM defaults](https://raw.githubusercontent.com/strukturag/libheif/v1.21.2/libheif/plugins/encoder_aom.cc). HEIF effort maps to speed=9-effort, and encoder threads are clipped to libvips concurrency. The full audit is in `benchmarks/backend-notes.txt`. Its candidate-v3 label predates the verifier rerun; the completed measurement path is v4. The original assumption that metadata stripping matched is superseded by the file inspection above.

Rust validates input containers, syncs temporary outputs, and publishes atomically without clobbering. Sharp writes directly without fsync. Those production behaviors remain in timing. Sharp no longer performs expectations metadata probes during conversion. The wall clock stops after blocking process completion, before watchdog joining. Timeouts kill the process group and remain explicit invalid observations even if GNU time cannot write its record.

The non-square EXIF6 fixture is a 1600x1000 crop of the pinned Blue Marble image, JPEG Q92 with orientation 6. Fixture generation and hashes are recorded. It is separate from the six-input directories.

## Reproduce

```sh
export LIBRARY_PATH=/tmp/image-vips/usr/lib/x86_64-linux-gnu
export LD_LIBRARY_PATH=/tmp/image-vips/usr/lib/x86_64-linux-gnu
export VIPSHOME=/tmp/image-vips/usr/lib
cargo fmt --check
cargo check
cargo test
cargo clippy --all-targets -- -D warnings
cargo build --release --locked
(cd benchmarks && npm test)
python3 benchmarks/run.py --cpu 1 --runs 5 --results benchmarks/results/fixed-comparison-v4 --backend-notes benchmarks/backend-notes.txt
```

Use a new results directory on a rerun. The final command rebuilds the release binary. All required Rust checks passed and the 16 real-CLI integration tests passed. The harness has 12 passing tests, including flattened-alpha, changed-alpha-plane, and similar-composite directory regressions.

Committed observations are in [the compact raw report](benchmarks/evidence/fixed-comparison-v4.json). The complete local logs, job JSON and outputs remain under `benchmarks/results/fixed-comparison-v4/`. The report retains commands, thread settings, toolchain versions, machine details, fixture hashes, output hashes, per-output bytes, alpha errors, thumbnail errors, and all 210 timing and RSS records.

## Limitations

This WSL2 host exposes 16 CPUs. Recorded one-minute load averages ranged from 0.91 to 1.12. Median process CPU-time divided by wall-time was 0.995, consistent with roughly one busy CPU rather than coordinator saturation. Small jobs have coarse GNU-time CPU counters. The Python coordinator blocks while each conversion runs. CPU affinity, thermal state, clocks, NUMA and competing background services were not isolated. Trials alternate implementations, use fresh processes, and have warm filesystem caches after early runs. No stable-storage throughput or cold-cache claim is made. Peak RSS measures the process with its threads, not total allocation volume. Source geometry and output bytes are small enough that CPU-dominated runs do not imply impossible storage bandwidth. Synthetic inputs, two NASA photos and one EXIF derivative do not cover general photographic quality, ICC/CMYK/HDR, animation or arbitrary AVIF codec configurations.
