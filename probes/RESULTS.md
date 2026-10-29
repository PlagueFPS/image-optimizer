# Focused results

The pinned native runtime beats the Sharp reference on latency and peak process RSS in all seven focused workloads. This is a focused result, not full-matrix acceptance. Distribution codecs still fail specific gates. All 145 processes succeeded and all 490 outputs passed the independent complete-decode, geometry, content and alpha verifier. Each configuration has five fresh-process repetitions with reversed order between iterations. The table gives median [minimum, maximum].

| Workload | Tuned ms | Sharp ms | Tuned MiB | Sharp MiB |
|---|---:|---:|---:|---:|
| directory-flat | 14546.9 [14422.9, 14756.3] | 16483.2 [16390.6, 16701.4] | 207.6 [206.0, 213.2] | 345.0 [344.8, 349.9] |
| resize-translucent | 927.3 [911.4, 929.9] | 1623.8 [1617.1, 1656.9] | 128.7 [128.5, 128.9] | 198.4 [198.0, 198.6] |
| preserve-translucent | 1805.9 [1800.2, 1844.6] | 2889.7 [2873.6, 2896.1] | 124.9 [124.8, 125.4] | 195.0 [194.5, 195.1] |
| convert-translucent | 3694.9 [3672.2, 3743.1] | 4705.8 [4673.5, 4749.7] | 193.4 [192.8, 193.6] | 267.5 [267.1, 268.0] |
| convert-alpha | 3575.4 [3531.0, 3591.2] | 4113.0 [4109.4, 4132.1] | 157.4 [157.2, 157.7] | 208.2 [207.7, 208.5] |
| preserve-alpha | 157.7 [156.1, 161.5] | 185.9 [182.1, 191.8] | 50.7 [50.3, 51.0] | 94.1 [93.8, 94.9] |
| directory-recursive-srcset | 3506.8 [3457.0, 3556.9] | 5408.9 [5388.3, 5430.1] | 146.3 [145.7, 149.8] | 291.6 [236.9, 292.5] |

Raw records, output hashes, native library hashes, fixture manifest, binary hashes, toolchain and observed loads are in [focused.json](evidence/focused.json). Commands and setup are in [README.md](README.md). The timed release binary SHA-256 is `ab56ce9ad92407951bc9a24398472b0b0691af35c0c3822dd6254e30b2b47bf6`. The recovered release binary SHA-256 is `8c7bc4f282d25dcb69c5cc9e9f84971f6f8e68ed3076f95fca7f4a85e9d7f591`.

## Source change and allocator interaction

| Directory configuration | ms | MiB | System CPU seconds |
|---|---:|---:|---:|
| before | 19533.1 [19423.8, 19588.1] | 393.8 [387.3, 394.1] | 0.3 [0.2, 0.3] |
| arena128 | 40243.6 [39738.5, 40490.3] | 478.9 [418.7, 496.3] | 22.2 [21.6, 22.3] |
| default | 16167.0 [16109.4, 16243.1] | 387.1 [386.9, 387.2] | 0.2 [0.2, 0.3] |
| tuned | 14546.9 [14422.9, 14756.3] | 207.6 [206.0, 213.2] | 0.2 [0.2, 0.2] |
| sharp | 16483.2 [16390.6, 16701.4] | 345.0 [344.8, 349.9] | 0.2 [0.2, 0.3] |

The `before` binary applies an explicit sRGB output profile to every source and already limits arenas to one. The final binary requests that profile only for ICC-tagged input. Libvips otherwise sends untagged images through an unnecessary XYZ/ICC export. The tagged Display P3 regression passes and untagged PNG preserve retains exact samples. The old implementation also retains those samples on the test grid; this is a performance change, not evidence of old pixel corruption.

Under the final conditional-profile pipeline, increasing arenas to 128 consistently reproduces about 22 seconds of system CPU and a large latency penalty. The single-arena default avoids that controlled symptom. The abandoned early replacement runs used a different pipeline and overlapped another worker; they do not disprove this result. Exact attribution of the historical run remains an inference because its allocator state was not recorded.

## Remaining gates

The distribution runtime still loses WebP alpha conversion and PNG preserve latency, all three AVIF memory comparisons, and both directory memory comparisons. Its full-size AVIF conversion latency comparison is inconclusive because observed ranges overlap. Deploying only the Rust source change does not meet the goal.

The parent must run the unchanged full 21-workload independent matrix against the selected native runtime. Other fixtures, CPU settings, high-bit-depth sources, cold caches and perceptual rate-distortion remain outside these focused results. No universal parity claim is made.

## Measurement limits

These are end-to-end process measurements, including CLI startup, source validation and atomic publication. Output verification and separate tracing/profiling are excluded. The Python coordinator waits during conversion. All source outputs are actually decoded after timing, so neither cached no-ops nor errors explain the result. Filesystem caches are warm; CPU affinity, clocks and unrelated low-load services are uncontrolled. The large directory arena effect exceeds the observed variation and is dominated by measured system CPU. The remaining codec effects are CPU-bound native work; separate profiles locate their hot paths. Different native builds remain a confounder for attributing a gain to an individual version.

Explain the Number kept allocator comparisons separate from codec comparisons and excluded the overlapping early runs. Fix Root Causes kept the AVIF header validation after the public-ABI trace disproved duplicate pixel decode. Prove It Works required real CLI runs, complete output decoding and tagged-color tests before reporting a gate.

## Older decoder plugin isolation

Five additional alternating repetitions per side test distribution libheif 1.21.2 with dav1d 1.5.3 and the older worker's independently built WebP 1.6.0/zlib-ng 2.3.3. This is a separate suite with 30 successful processes and 30 verified outputs. It keeps the final Rust source and single-arena policy. The selected decoder runtime changes; individual native compiler builds remain a confounder. Raw records are in [decoder-isolation.json](evidence/decoder-isolation.json).

| Workload | Old libheif + dav1d ms | Sharp ms | Old libheif + dav1d MiB | Sharp MiB |
|---|---:|---:|---:|---:|
| resize-translucent | 946.0 [937.3, 973.0] | 1635.8 [1630.4, 1658.2] | 206.3 [206.2, 206.4] | 198.0 [197.8, 198.4] |
| preserve-translucent | 1712.6 [1707.5, 1725.7] | 2910.0 [2876.8, 2924.6] | 202.5 [202.2, 202.7] | 194.9 [194.5, 195.3] |

Installing the older dav1d plugin alone still fails both RSS gates. The newer libheif/dav1d runtime passes them in the main suite. This supports deploying the tested native profile, but does not isolate a particular libheif allocation change or establish that every libheif build behaves identically.

## Separate diagnostic evidence

The final conditional-profile pipeline records 6,140 `munmap` and 3,614 `mmap` calls with 128 arenas, versus 74 and 580 with one arena. The recovered unconditional-profile binary with 128 arenas records 120 and 620. These counters independently reproduce the pipeline/allocator interaction. Aggregate futex duration is overlapping thread time, not wall time or process system CPU. Only the untraced repetitions supply timing claims. The exact historical mapping source remains inferred; this run did not capture allocation stacks or kernel CPU samples.

The diagnostic command is below, repeated for `MALLOC_ARENA_MAX=1` and for the recovered binary with 128 arenas. The corresponding compact reports are `evidence/arena128-strace.txt`, `evidence/arena1-strace.txt`, and `evidence/before128-strace.txt`.

```sh
MALLOC_ARENA_MAX=128 strace -f -c -e mmap,munmap,madvise,futex \
  -o arena128-strace.txt target/release/image-optimizer \
  /home/angel/.t3/worktrees/image-optimizer/t3-6f04373b/benchmarks/fixtures/flat \
  --out-dir /tmp/optimizer-native-133f/arena128-strace-output --json
```

The stock-runtime decoder trace calls `heif_decode_image` once and initializes two AOM contexts. The tuned-runtime trace calls `heif_decode_image` once and initializes two dav1d contexts. These correspond to the alpha AVIF's color and alpha. Both retain default decoder thread selection. The preliminary header probe does not duplicate raster decode on this fixture. The first added AOM interposer failed because `RTLD_NEXT` could not resolve a symbol from a locally loaded plugin. Its failed diagnostic is excluded. The corrected probe obtains the already loaded public `libaom.so.3` handle and succeeds. Both corrected trace outputs decode successfully. See [decoder-stock.txt](evidence/decoder-stock.txt), [decoder-tuned.txt](evidence/decoder-tuned.txt), and [diagnostic-verification.json](evidence/diagnostic-verification.json).

Sharp reports AOM 3.15.1, its bundle contains the AOM decoder identity, and its [published build recipe](https://github.com/lovell/sharp-libvips/blob/v1.3.4/build/posix.sh) builds AOM for libheif without building dav1d. This supports AOM as the bundled reference decoder. The CLI's runtime selection above is directly intercepted; Sharp's internal hidden symbols were not intercepted. No assumption that Sharp uses dav1d enters the measurements.

Separate user CPU profiles use `perf record -F 199 -e cpu-clock:u --call-graph dwarf,8192` for tuned WebP alpha conversion and AVIF resize, and frequency 999 for the short PNG preserve operation. Commands use the same source, width, format and default encoder settings as their timed cases. Compact DSO reports use `perf report --stdio --no-children --call-graph none --sort dso -n`. No samples were lost.

- WebP conversion has 694 samples, with 95.1% self samples in WebP encoding.
- PNG preserve has 146 samples, with 49.3% in zlib-ng and 37.7% in libvips. This short profile identifies work, not a precise population percentage.
- AVIF resize has 172 samples, with 50.0% in WebP, 22.7% in dav1d and 8.1% in libvips.

These locate native CPU work rather than Rust pixel copies or coordinator saturation. Codec version, decoder choice, and compiler settings change together in the main native profile. The older-plugin isolation narrows the AVIF memory issue but is not a heap-allocation profile. Raw perf recordings remain under `/tmp/optimizer-native-133f`; compact reports and diagnostic output verification are committed.

## Correctness and checks

All 490 main-suite outputs have no retained ICC, EXIF, XMP or IPTC blocks in the separate [metadata audit](evidence/metadata.json). Both the distribution and tuned runtimes pass all 18 real-CLI integration tests, including the tagged P3 source-color regression. The source and expected-color fixture hashes remain in git from the recovered parent commit.

`cargo fmt`, `cargo fmt --check`, `cargo check`, `cargo test`, `cargo clippy --all-targets -- -D warnings` and `cargo build --release --locked` passed. The tuned runtime separately passed `cargo test`. Python probes compile, the setup shell passes `sh -n`, and the public-ABI C interposer builds with `-Wall -Wextra -Werror`. All eight diagnostic conversions pass the independent decoder/verifier. No subagents or independent code reviewers were used. Manual review removed the unsupported allocator-cause comment and checked the final diff.
