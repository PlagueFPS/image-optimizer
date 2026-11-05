# Second WebP performance pass

The user asked to test reduced command initialization, reuse across responsive outputs, workload-specific native threading, and compile caching. All four were tested. The retained production change loads image-processing code only when optimization executes. Help and version are faster. No additional reliable default image-conversion speedup was established.

The paired baseline is commit `3113828`, the first performance pass. The accepted handler split is `f69403c`. Encoding settings, the encoder, optimizer, safety checks and native thread policy remain unchanged. Metadata caching was implemented as an experiment and reverted.

## Final comparison

Every cell is the median and full minimum to maximum range in milliseconds from seven rotated rounds. These are new paired measurements on November 5, 2026. Earlier-session absolute timings should not be substituted for this baseline.

| Workload | Before this pass     | Updated              | cwebp                | ImageMagick          |
| -------- | -------------------- | -------------------- | -------------------- | -------------------- |
| small    | 114.1 [109.2, 116.3] | 112.4 [107.9, 115.5] | 19.3 [19.0, 20.3]    | 22.8 [22.2, 31.8]    |
| photo    | 712.8 [710.9, 718.2] | 717.2 [710.4, 741.0] | 583.7 [572.9, 589.4] | 634.6 [631.3, 646.8] |
| resize   | 209.7 [204.9, 213.8] | 208.0 [204.0, 216.1] | 146.0 [145.4, 153.5] | 321.4 [318.5, 341.9] |
| batch    | 309.5 [306.3, 321.3] | 309.1 [305.1, 319.7] | 184.3 [180.4, 189.1] | 316.3 [306.6, 321.7] |

| Workload    | Before this pass     | Updated              |
| ----------- | -------------------- | -------------------- |
| help        | 83.3 [79.4, 84.2]    | 61.0 [59.1, 64.1]    |
| version     | 81.6 [79.5, 84.1]    | 58.7 [54.6, 62.0]    |
| sizes       | 739.4 [733.6, 753.2] | 732.7 [725.9, 746.2] |
| small-sizes | 119.6 [115.8, 125.5] | 116.7 [113.9, 119.2] |

The image-conversion ranges overlap. Small median differences in those cases are not counted as improvements. Help and version improved by about 27% and 28%. Before and updated image outputs are byte-identical. Raw headline trials are in [webp-round2-runs.csv](webp-round2-runs.csv).

## Candidate decisions

| Candidate                          | Evidence                                                                                                                                                                         | Decision                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Reduced command initialization     | Final help 83.3 ms to 61.0 ms; version 81.6 ms to 58.7 ms. Ordinary image conversion has no reliable gain or penalty.                                                            | Keep the lazy image handler. Preserve the complete existing parser, prompts and completions.         |
| Source reuse                       | Shared Sharp clones, bounded metadata caching, and eligible raw PNG reuse did not reliably reduce elapsed time. Raw JPEG reuse changed resized bytes or lost metadata.           | Keep none of those paths.                                                                            |
| Workload-specific native threading | One, two, four and eight libvips threads were tested on single images, responsive sizes and batches. Apparent two-thread gains overlapped variation; higher counts hurt batches. | Keep one libvips thread per image.                                                                   |
| Compile caching                    | Warm runs helped small images and resized photos. Cold runs could regress; long native encodes saw no reliable benefit.                                                          | Document Node compile caching as opt-in. Do not enable it automatically or add a redundant CLI flag. |

### Initialization controls

A separate production-bundled control suite measured the same simple conversion through bare Sharp, Sharp with minimal Effect execution, Sharp with Node platform services, and the complete previous CLI. Each arm ran five times in rotated order and produced identical image bytes. These controls omit CLI functionality and safety work, so their differences are not a precise phase decomposition or a promised recoverable speedup.

| Control                           | Small PNG median and range, ms |
| --------------------------------- | ------------------------------ |
| Bare Sharp                        | 70.2 [68.0, 73.7]              |
| Sharp plus basic Effect execution | 72.8 [72.0, 77.9]              |
| Sharp plus Node platform services | 84.8 [79.9, 86.5]              |
| Full previous CLI                 | 113.8 [109.4, 115.0]           |

The basic Effect engine was a small part of these controls. The remaining difference includes platform service initialization, command construction and parsing, validation, path checks, atomic writes and reporting. Replacing all of that with a smaller program would change the product or require preserving those features through a new implementation.

The handler split also passed a real CLI test without Sharp installed. Root help, optimize help, version and completions succeed; an optimization attempt still fails usefully without writing images. The moved optimization handler body is unchanged apart from exporting it.

### Source reuse details

File-input Sharp clones were compared with independent pipelines in five alternating pairs for JPEG without metadata, JPEG with metadata, and transparent PNG. Native-pipeline medians were 635.6 vs 635.1 ms, 634.5 vs 638.9 ms, and 20.6 vs 21.3 ms. Every range overlapped. All 120 timed outputs decoded and matched bytes and retained metadata. Construction and writes were timed; imports, shared header inspection and validation were excluded. These are pipeline controls, not complete CLI timings. Separate profiles showed the JavaScript thread mostly idle while native work proceeded.

A bounded, invocation-scoped metadata cache was then implemented in the real CLI. It read headers once per source while retaining per-job animation and enlargement checks. Seven paired rounds measured responsive JPEG medians of 737.7 vs 730.3 ms with ranges 725.0 to 748.8 vs 725.6 to 818.2 ms. Responsive PNG medians were 117.6 vs 117.5 ms with overlapping ranges. All 126 outputs matched. The extra cache and API changes were reverted because the experiment did not establish a reliable gain. One lint check overlapped part of this exploratory run; no speedup is claimed from it.

Raw JPEG decode reuse failed correctness before timing claims. It changed every resized JPEG output, and metadata retention lost EXIF. A narrower RGB/RGBA PNG experiment tested five alternating pairs each, including raw decode and four encodes plus writes. RGBA medians were 21.35 vs 21.76 ms; RGB medians were 20.51 vs 20.90 ms. All 80 timed file and pixel hashes matched, but wall-time ranges overlapped. Aggregate CPU fell in that control without shortening elapsed time. Metadata and orientation probes exposed additional fallback requirements. No raw-reuse production branches were retained.

### Native threading details

The actual preserved CLI was tested with a common preload intercepting only the requested Sharp concurrency. Every arm received the same preload and externally established pool of 12. That changes initialization order compared with the ordinary CLI, so absolute times from this sweep are not mixed into the headline comparison. Five rounds rotated one, two, four and eight threads across five workloads.

All 100 trials and 620 outputs passed and matched hashes. Single-photo medians were 735.8, 725.1, 760.7 and 737.4 ms. Batch medians were 309.2, 311.9, 340.9 and 334.4 ms. Small two-thread apparent gains did not clear variation. Separate process observations showed one hot native thread and CPU/wall around 1.03 for the full photo regardless of the setting. Sharp concurrency controls libvips pixel processing; this setter does not expose cwebp's codec threading switch. Higher settings also increased memory in a diagnostic observation.

### Compile cache details

These are complete CLI operations with unchanged output, five rotated rounds per cache state. Cold trials used fresh directories. Warm trials primed each case outside the headline timing and then started a fresh Node process for every recorded sample. Only JavaScript compilation was cached. Images were still read, encoded, written, decoded and hashed on every run.

| Case   | Disabled median and range, ms | Cold cache           | Warm cache           |
| ------ | ----------------------------- | -------------------- | -------------------- |
| help   | 58.9 [57.1, 61.4]             | 59.9 [58.6, 66.5]    | 53.3 [47.9, 58.3]    |
| small  | 115.9 [108.9, 119.2]          | 118.9 [116.6, 123.9] | 103.1 [100.1, 112.6] |
| photo  | 727.0 [719.6, 737.8]          | 727.6 [716.6, 756.7] | 720.0 [703.4, 739.5] |
| resize | 207.9 [206.7, 209.2]          | 210.6 [209.3, 214.2] | 195.3 [194.3, 199.6] |
| sizes  | 734.3 [724.4, 770.7]          | 734.8 [729.7, 746.3] | 723.5 [715.5, 739.1] |

Warm caching reduced the small-image median by about 11% and the resized-photo median by about 6% in this experiment. Cold loads were not reliably faster and could add work. The README shows `NODE_COMPILE_CACHE` for repeat users. Runtime support already exists in Node, so adding a second application flag or persistent image cache was unnecessary.

## Measurement and checklist

- The final standard and extra suites contain 168 trials and 868 fully decoded outputs, with zero failed or skipped image jobs. Information-only commands must produce nonempty output. Before and updated CLI hashes match across every image case and repeat.
- The reusable [benchmark driver](../../tools/bench/README.md) now prepares its own corpus, validates outputs, rotates variants, and emits complete JSON plus summaries. The driver used for this report was Python with Node-based validation. It has since been ported to TypeScript and Effect; [the driver comparison](benchmark-driver.md) records the migration results. The original reusable driver replaced temporary scripts that had disappeared after a reboot.
- Timing includes process launch, decoding, transforms, encoding, writes and exit. Native batch process dispatch is timed too. Build, source preparation, fresh output-directory creation and post-run validation are excluded. Profilers and memory probes are separate from headline runs.
- The corpus is unchanged in content from the first pass. It has the two committed source image families, plus 12 photo crops and 12 brightness variants. Standard cases are the transparent 567×324 PNG, 3872×2592 photo, photo resized to width 1280, and the 24-image batch capped at width 1280. Responsive cases add three widths to the original output.
- All tools use lossy WebP quality 80 and effort or method 4 with lossless alpha. cwebp and ImageMagick use their previously selected parallel process counts of 12 and 16 for batches, respectively. Single-image native codec threading is enabled. ImageMagick uses one OpenMP thread per process. ImageMagick's single-process mogrify mode is not measured here.
- Ubuntu 26.04 under virtualization, 16 visible logical CPUs, Intel i5-12600K and about 15.5 GiB RAM. Node 26.13.0, Sharp 0.35.5, libvips 8.18.7, bundled libwebp 1.6.0. cwebp 1.5.0 and ImageMagick 7.1.2-18 use system libwebp 1.5.0. Native versions differ. `/tmp` is tmpfs, and filesystem caches are warm. Headline Node compile caching is disabled. Pre-final load averages were 0.18, 0.25 and 0.25 on 16 CPUs.
- CPU and profile evidence identifies startup or native processing as the relevant limiting phase. No exact native codec inner loop or absolute performance lower bound is claimed. All CPU/wall ratios remain below the 16 visible CPUs. Compressed input rates are modest for tmpfs; there is no physical disk throughput claim.
- Existing safety checks and atomic writes remain enabled. The final source passes `vp check`, all 129 tests, and eight verification journeys. Node 26 covers conversion, resize, sizes, directories, dry-run and safety. Minimum-supported Node 22.12 covers conversion and safety. The tests also cover packed-package execution and startup failures.
- A read-only review found a benchmark-only PNG height assumption. The driver now reads actual source dimensions before timing. A one-run native PNG responsive smoke test decoded all four outputs with expected dimensions and alpha; it is a correctness check, not a performance claim. The standard native cases used the same dimensions before and after this fix.
- Raw JPEG mismatch arms and an initially invalid oriented-PNG probe were rejected or corrected before timing claims. Completed diagnostic records remain retained. Rejected changes are not folded into headline speedups.

## Remaining room

These four candidates did not uncover another simple default image-conversion win. The retained improvement is informational-command latency, and warm compile caching remains useful for repeat invocations. The measured gap between bare Sharp and the complete CLI shows additional overhead, but some belongs to useful safety and command features. It is not all removable JavaScript cost.

Further work would require a deliberately lighter command frontend, changes to native codec integration, or a persistent process that amortizes startup. Those are larger changes or different usage models. Animated resizing and other formats remain unmeasured performance opportunities. No rewrite to another language is justified by this evidence alone.

## Evidence

Full raw trials, rejected patches, source-reuse identity records, process profiles, cache samples, verification transcripts and the append-only decision log are retained at `/home/angel/.t3/artifacts/image-optimizer-round2`. Committed raw headline trials are beside this report. The benchmark tool is committed and rerunnable with its documented JSON configuration. Native binaries still need to be installed or supplied by explicit paths.
