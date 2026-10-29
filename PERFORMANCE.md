# Performance acceptance

The pinned native runtime passes the tested speed and peak-memory gate. All 21 workloads have five successful fresh-process runs per side. Every Rust median is below its Sharp median for latency and peak RSS. All 210 processes succeeded and all 390 outputs passed full decode, geometry, content, and alpha checks. The separate metadata audit found no ICC, EXIF, XMP, or IPTC blocks.

This is acceptance for Linux WSL2 with CPU1, quality80, effort6 and the native profile below. It is not a universal claim about all images, platforms, CPU settings, or distribution codecs.

## Results

Values are median [minimum, maximum]. Time is milliseconds. Peak process RSS is MiB.

| Workload | CLI ms | Sharp ms | CLI MiB | Sharp MiB |
|---|---:|---:|---:|---:|
| convert-noise | 2050.1 [2036.9, 2126.5] | 2403.3 [2395.9, 2520.3] | 98.9 [98.4, 99.0] | 143.9 [143.5, 144.2] |
| resize-noise | 167.6 [167.2, 168.3] | 223.3 [216.7, 228.8] | 45.5 [45.4, 45.8] | 83.5 [83.4, 83.9] |
| preserve-noise | 54.8 [54.3, 54.9] | 89.3 [86.9, 90.1] | 36.2 [36.0, 36.4] | 77.2 [76.8, 77.3] |
| convert-alpha | 3563.7 [3552.0, 3608.9] | 4121.3 [4102.4, 4201.6] | 157.4 [157.1, 157.6] | 208.3 [207.9, 208.6] |
| resize-alpha | 758.9 [753.2, 772.0] | 1067.7 [1061.4, 1077.5] | 73.0 [72.8, 73.2] | 122.8 [122.5, 123.3] |
| preserve-alpha | 158.4 [157.1, 161.2] | 181.9 [180.4, 198.4] | 50.6 [50.3, 50.8] | 94.3 [93.9, 94.4] |
| convert-translucent | 3680.5 [3676.3, 3687.2] | 4703.0 [4660.7, 4748.3] | 193.1 [193.1, 193.2] | 267.5 [267.2, 268.0] |
| resize-translucent | 916.6 [914.1, 951.9] | 1628.1 [1615.8, 1701.9] | 128.5 [128.2, 128.8] | 198.4 [197.9, 198.6] |
| preserve-translucent | 1819.0 [1790.9, 1883.1] | 2959.8 [2944.7, 3012.0] | 125.1 [125.1, 125.3] | 194.7 [194.5, 195.2] |
| convert-vector | 5130.4 [5006.3, 5389.8] | 5368.1 [5224.6, 6113.7] | 120.0 [119.6, 120.1] | 162.1 [161.8, 162.5] |
| resize-vector | 348.3 [346.7, 351.9] | 414.2 [409.9, 422.1] | 42.5 [41.9, 42.7] | 86.7 [86.5, 87.0] |
| convert-earth | 247.3 [244.2, 249.0] | 335.6 [333.0, 339.8] | 44.5 [44.3, 44.6] | 88.3 [88.1, 88.6] |
| resize-earth | 94.1 [93.6, 97.0] | 146.4 [142.2, 148.2] | 37.0 [36.7, 37.4] | 83.3 [82.8, 83.3] |
| preserve-earth | 29.4 [28.6, 30.8] | 68.5 [66.6, 70.5] | 32.4 [32.1, 32.7] | 74.9 [74.7, 75.8] |
| convert-astronaut | 68.4 [67.6, 69.4] | 115.7 [114.1, 122.3] | 30.8 [30.6, 31.0] | 73.5 [73.5, 74.0] |
| resize-astronaut | 68.2 [67.4, 68.9] | 117.8 [113.6, 120.8] | 30.8 [30.5, 30.9] | 73.8 [73.5, 74.3] |
| preserve-astronaut | 40.3 [38.7, 40.7] | 81.3 [77.1, 82.6] | 31.5 [30.8, 31.8] | 73.2 [72.4, 73.6] |
| srcset-photo | 336.1 [332.5, 337.1] | 436.2 [430.2, 439.0] | 45.3 [45.2, 45.8] | 98.0 [97.8, 101.8] |
| resize-exif6-photo | 211.9 [210.3, 219.8] | 293.1 [288.8, 294.5] | 44.2 [43.6, 44.3] | 90.8 [90.6, 91.6] |
| directory-flat | 14655.3 [14534.1, 15783.6] | 16536.6 [16528.4, 17605.2] | 209.2 [206.1, 213.3] | 357.0 [348.8, 365.5] |
| directory-recursive-srcset | 3616.7 [3547.7, 3960.6] | 5430.1 [5358.3, 5621.8] | 145.5 [144.0, 146.5] | 245.5 [230.2, 265.0] |

## Runtime and cause

The CLI uses distribution libvips8.18.0 with independently built WebP1.6.0, zlib-ng2.3.3, libheif1.23.5, distribution dav1d1.5.3 decoding and AOM3.13.1 encoding. Sharp0.35.5 uses its bundled native runtime. Production conversion has no Node or Sharp dependency. The exact pinned build, checksums, licenses and loader setup are in [probes/README.md](probes/README.md). Distribution-only codecs still miss some gates and are not covered by this passing verdict.

The implementation avoids unnecessary ICC export on untagged sources, strips profiles after tagged conversion, and limits glibc arenas unless the operator supplies MALLOC_ARENA_MAX. Controlled arena and pipeline comparisons reproduce mapping churn. Native profiles locate WebP encoding, zlib compression, dav1d decoding and SVG rendering as CPU work. No Rust raster copy or subprocess image worker is used. [Focused profiles, allocator trials and limits](probes/RESULTS.md) retain the measurements. Exact attribution of the historical allocator state remains inferred.

## Reproduce and provenance

Run the unchanged harness with the native environment in probes/README.md. Use fresh result directories. The final source is commit1e65ae0 and the release executable SHA256 is ab56ce9ad92407951bc9a24398472b0b0691af35c0c3822dd6254e30b2b47bf6.

The first full command was terminated with signal15 after eight complete workloads. Its incomplete AVIF-preserve group was discarded. The remaining single-file cases and directories ran in two smaller invocations. All three reports have identical executable, script and fixture hashes. The group-selection script rejects duplicate complete groups, build mismatches, failed processes and missing decodes.

```sh
python3 benchmarks/summarize.py benchmarks/results/full-pinned-final/results.json benchmarks/results/full-pinned-batch2/results.json benchmarks/results/full-pinned-directories/results.json --output benchmarks/evidence/final-acceptance.json
node probes/audit-metadata.mjs benchmarks benchmarks/evidence/final-acceptance.json
```

[Combined raw records](benchmarks/evidence/final-acceptance.json) contain commands, settings, ranges, CPU counters, source and output hashes, versions, and verification data. [Metadata audit](benchmarks/evidence/final-metadata.json) covers all390 outputs. Full outputs and logs remain under the ignored benchmarks/results directories. The earlier failed configuration and investigation remain in [PERFORMANCE-INITIAL.md](PERFORMANCE-INITIAL.md).

## Limits and review

Trials alternate implementations and include runtime startup, validation, encoding and publication. Filesystem caches are warm. Affinity, clock scaling, thermal state and unrelated host services were not controlled. Peak RSS measures a process with its threads. Five trials describe observed variation, not population tail latency. Native dependency builds differ, so this does not isolate a Rust-versus-Node language effect. Quality checks detect shortcuts but are not a perceptual rate-distortion study. General HDR, CMYK, arbitrary SVG, animation and high-bit-depth fidelity are not established.

Both tools use matched encoder options and sequential scheduling. Twenty latency comparisons have nonoverlapping observed ranges. Full-size SVG conversion has overlapping ranges, so it shows no clear speed difference despite a lower CLI median. Every RSS comparison has nonoverlapping ranges. There is no aggregate score. The source and harness previously received independent review. The final source fixes and full pinned rerun were reviewed by the coordinating agent only, as requested without new delegates.

Repository checks passed with the pinned runtime. All18 CLI tests passed. Formatting, cargo check and strict Clippy passed. The harness verifier has12 tests.
