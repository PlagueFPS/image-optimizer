# TypeScript benchmark driver comparison

The user asked to replace the Python benchmark with TypeScript and Effect, then check whether its results change. The new driver preserves every compared image output. No measurable `img` performance change was established. Native batch times depend on the driver, with a clear increase for cwebp under Effect dispatch.

This is a benchmark migration, not an application optimization. No application source changed, and the four built CLI files retained their SHA-256 hashes throughout the comparison.

## Paired measurements

Measurements ran on November 5, 2026. Each cell reports the median and full minimum to maximum range of five trials in milliseconds. Five blocks alternated Python-first and TypeScript-first order. Each block used a fresh driver process and output root. Both drivers launched the same built CLI and native binaries with the same configurations. All `img` timing ranges overlap.

| Workload | Tool or cache state | Python, ms           | TypeScript/Effect, ms |
| -------- | ------------------- | -------------------- | --------------------- |
| small    | img                 | 117.8 [113.5, 120.2] | 119.5 [114.5, 128.1]  |
| small    | cwebp               | 20.6 [20.3, 21.7]    | 22.8 [21.6, 23.2]     |
| small    | imagemagick         | 23.0 [22.3, 23.9]    | 25.3 [24.8, 25.5]     |
| photo    | img                 | 739.1 [732.6, 776.7] | 748.2 [740.0, 757.6]  |
| photo    | cwebp               | 599.9 [598.1, 609.9] | 601.6 [591.0, 607.0]  |
| photo    | imagemagick         | 650.1 [639.4, 663.1] | 650.3 [646.0, 659.5]  |
| resize   | img                 | 214.6 [207.9, 222.6] | 215.6 [211.1, 227.3]  |
| resize   | cwebp               | 148.3 [147.2, 149.9] | 149.5 [146.6, 152.6]  |
| resize   | imagemagick         | 330.4 [328.3, 336.7] | 332.3 [326.7, 333.1]  |
| batch    | img                 | 316.7 [313.1, 320.6] | 315.5 [309.9, 328.2]  |
| batch    | cwebp               | 186.1 [181.2, 188.6] | 209.3 [203.0, 212.2]  |
| batch    | imagemagick         | 319.4 [314.8, 326.5] | 327.4 [325.7, 332.0]  |

The cwebp batch median increased by 12.5%, with nonoverlapping ranges. Small native invocations also added about 2 ms. These are measured differences in complete subprocess workflows. The native binaries and output bytes did not change. Different dispatch mechanisms are inside the timer, so this comparison cannot attribute the gaps to encoder performance or isolate their precise syscall cost. Keep the driver fixed when measuring future CLI changes.

| Workload    | Tool or cache state | Python, ms           | TypeScript/Effect, ms |
| ----------- | ------------------- | -------------------- | --------------------- |
| help        | img                 | 62.5 [59.1, 66.8]    | 62.4 [58.4, 64.7]     |
| version     | img                 | 60.5 [59.6, 65.5]    | 64.6 [57.9, 67.0]     |
| sizes       | img                 | 754.4 [739.2, 758.0] | 754.1 [746.6, 780.2]  |
| small-sizes | img                 | 122.9 [115.1, 125.8] | 121.0 [116.4, 129.1]  |

Compile-cache states also preserved outputs. Cold trials used a new directory per trial. Warm cases received an untimed prime before their recorded run.

| Workload | Tool or cache state | Python, ms           | TypeScript/Effect, ms |
| -------- | ------------------- | -------------------- | --------------------- |
| small    | disabled            | 116.8 [116.2, 128.9] | 117.1 [114.6, 126.0]  |
| small    | cold                | 124.1 [119.7, 128.5] | 122.6 [119.2, 130.3]  |
| small    | warm                | 106.2 [103.9, 110.9] | 105.1 [101.6, 110.4]  |

## Work and output equivalence

The final comparison contains 190 recorded trials, 95 per driver, and 920 reported image outputs, 460 per driver. Ten additional warm-cache priming outputs are excluded from these totals. Every recorded trial completed with zero failed or skipped jobs.

The comparison checked parsed case, variant, round, prime status, optimized count, failure count, total bytes and each output's byte count, dimensions, RGB PSNR, alpha error and SHA-256. All fields matched exactly between drivers for the same tool and workload. This does not mean every tool matches another tool after resizing. Resampling differences remain as documented in the [previous report](webp-round2.md).

[Raw trials](benchmark-driver-runs.csv) preserve elapsed time, output counts, bytes and hashes. JSON formatting and paths are not required to match. One intentional metric difference remains. The TypeScript driver writes `cpu_seconds: null` because Node and Effect do not expose Python's aggregate child CPU time. Parent CPU usage would measure different work and is not a substitute.

## Timing and isolation

The driver uses Effect CLI arguments, boundary schemas, filesystem services, a monotonic clock, scoped subprocesses and concurrent stream draining. The timer starts before invoking each command and stops after exit, stream collection, report parsing and count checks. Native batches include concurrent process dispatch. Builds, corpus preparation, output-directory creation, decoded validation and hashing remain outside the timer.

An initial direct port imported Sharp into the measuring parent for preparation and validation. It preserved outputs but inflated native batch times. Diagnostic process sampling found about 264 MiB of retained parent RSS, compared with about 19 MiB for Python. That version was rejected. Preparation and validation now run in a dedicated TypeScript/Effect worker, matching the old driver's process isolation. The actual preparation command also exercises child dispatch before timed work begins. There is no synthetic warmup or time subtraction.

Separate diagnostic sampling of the final isolated parent observed about 155 to 163 MiB RSS and about 0.10 parent CPU seconds during a roughly 0.21-second cwebp batch. It reached the configured 12 concurrent children. Effect dispatch therefore performs material parent work in this short workflow. This is diagnostic evidence, not a repeated memory benchmark or an exact decomposition of the time gap. The profiled runs are excluded from the timing tables.

A review also identified that Effect's general timestamp clock could reanchor to wall time. Both timer reads now use `Clock.monotonicTimeNanos`. Only measurements after that correction appear in the tables and raw CSV.

## Controls and limits

The host is Ubuntu 26.04 under virtualization with 16 visible logical CPUs, an Intel i5-12600K and about 15.5 GiB RAM. The comparison uses Node 26.13.0, Sharp 0.35.5, libvips 8.18.7 and bundled libwebp 1.6.0. Native binaries are cwebp 1.5.0 and ImageMagick 7.1.2-18 with system libwebp 1.5.0. The fixtures are two committed image families. `/tmp` is tmpfs and filesystem caches are warm.

All tools use WebP quality 80, effort or method 4 and lossless alpha. cwebp batches use 12 processes and ImageMagick batches use 16. ImageMagick uses one OpenMP thread per process. These are the previously selected configurations, not a new native-tool tuning sweep. ImageMagick's single-process mogrify mode is not measured. The benchmark clears inherited thread-pool and compile-cache variables before applying variant overrides.

Fresh outputs, report counts and decoded validation rule out skipped conversions as a speedup. Every image must decode with expected format and dimensions, exact alpha and RGB PSNR of at least 20 dB against the Sharp transform. This detects gross errors rather than proving equal perceptual quality. Timing includes all application startup and native work, with no removed phase from which an impossible speedup could be claimed. The separate process observations show parent dispatch work for the shortest native workflows. No encoder inner-loop profile or physical disk bandwidth claim is made.

The benchmark comparison uses alternating drivers to reduce drift. It does not establish equivalence beyond these fixtures, configurations and observed ranges. Future measurements should use this driver on both sides, rather than comparing a new Effect-dispatched result directly with an old Python-dispatched result.

## Verification and replay

`vp check` passes. All 135 tests pass, including six benchmark contract tests through the real executable. Those tests cover cache priming, environment overrides and removal, decoded outputs, identical-hash enforcement, output-directory safety, nested parent creation, nonzero exits, incorrect counts and partial evidence preservation. A Node 22.12 smoke run passed help, single-image and 24-image batch cases. `vp run bench` also completed a single-image smoke run.

The [benchmark instructions](../../tools/bench/README.md) describe configuration and execution. The former Python driver is preserved in git at `4304301:tools/bench/webp.py`. Both drivers accept the same JSON configuration. The final comparison used separate standard, informational/responsive and compile-cache configurations, each with `rounds: 1`, repeated in five alternating blocks.

Full local evidence is retained at `/home/angel/.t3/artifacts/image-optimizer-ts-bench/`. `final-comparison.json`, `final-summary.json` and `final-compare.log` contain the final results. `standard-config.json`, `extra-config.json`, `cache-config.json` and `compare.py` describe their execution. `decision.tsv` records the initial isolation mistake and subsequent clock correction. These local artifact paths are evidence from this machine, not portable dependencies of the shipped benchmark.
