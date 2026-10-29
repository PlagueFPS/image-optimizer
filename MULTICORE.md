# Multicore scaling

The current one-variant-at-a-time pipeline does not scale materially on this corpus. Both implementations remain near one busy CPU core even with 16 requested libvips workers. Two workers provide small improvements in some cases. Higher settings generally increase peak RSS, and can make short PNG and JPEG jobs slower. Keep the default of one worker for these workflows. Bounded file-level parallelism would be a separate implementation and benchmark; it was not tested here.

## Method

Seven workloads × five worker settings × two tools × five runs produced 350 successful processes and 1,250 fully decoded and verified outputs. CPU settings are1,2,4,8,16. Actual execution order is1,16,2,8,4 to avoid a strictly increasing worker-count trend. The tools alternate within each case. Image files and widths remain serial on both sides. Quality80, effort6, pinned native runtime and release binary are unchanged from the accepted configuration.

The host exposes16 logical CPUs under WSL2 on an i5-12600K. The process and each visible ancestor cgroup have unlimited cpu.max and zero throttling periods. Busy cores are process user plus system CPU seconds divided by elapsed seconds, not a count of live threads. GNU-time CPU counters are coarse for short jobs. Affinity, clocks and background host services were not controlled. Filesystem caches are warm. Native libraries differ between the tools.

## One versus sixteen workers

Values are medians. Time is seconds and peak RSS is MiB. Ranges for every intermediate worker setting are in the raw report.

| Workload | CLI time 1 → 16 | Sharp time 1 → 16 | CLI RSS 1 → 16 | Sharp RSS 1 → 16 |
|---|---:|---:|---:|---:|
| PNG → WebP, full size | 3.463 → 3.400 | 3.989 → 3.922 | 156.3 → 185.7 | 208.5 → 242.5 |
| Mixed directory → WebP | 13.871 → 13.828 | 15.706 → 15.743 | 206.0 → 235.5 | 345.1 → 456.4 |
| Recursive directory srcsets | 3.388 → 3.386 | 5.147 → 5.192 | 144.8 → 174.9 | 263.6 → 428.6 |
| PNG resize, preserve format | 0.153 → 0.172 | 0.177 → 0.198 | 49.9 → 76.8 | 94.4 → 126.9 |
| JPEG resize → WebP | 0.167 → 0.175 | 0.216 → 0.215 | 44.5 → 72.6 | 83.4 → 100.2 |
| AVIF resize → WebP | 0.909 → 0.921 | 1.607 → 1.616 | 127.3 → 157.1 | 198.2 → 289.1 |
| JPEG srcset, three widths | 0.329 → 0.330 | 0.428 → 0.427 | 44.2 → 61.7 | 100.4 → 127.2 |

## Output size

Output SHA256 hashes are stable across all five repeats and all worker counts within each tool. Changing --cpu does not change encoded bytes in this matrix. Five workloads have equal total bytes between tools; two differ as shown. These totals include all variants in a workload. Smaller files do not alone prove equal visual quality, and decoder/resampler differences remain possible. Every output passes independent format, geometry, content and alpha checks.

| Workload | CLI bytes | Sharp bytes | CLI difference |
|---|---:|---:|---:|
| PNG → WebP, full size | 2,286,474 | 2,286,474 | +0.00% |
| Mixed directory → WebP | 6,732,286 | 6,732,286 | +0.00% |
| Recursive directory srcsets | 569,732 | 571,360 | -0.28% |
| PNG resize, preserve format | 358,811 | 358,811 | +0.00% |
| JPEG resize → WebP | 68,508 | 70,160 | -2.35% |
| AVIF resize → WebP | 95,016 | 95,016 | +0.00% |
| JPEG srcset, three widths | 190,016 | 190,016 | +0.00% |

## Why more workers do not help here

Separate untimed 16-worker profiles locate the dominant work. CLI PNG-to-WebP has671 CPU samples,95.38% in libwebp. PNG preserve-resize has144 samples,65.97% in zlib-ng and20.14% in libvips. AVIF resize has170 samples,52.94% in libwebp and21.76% in dav1d. Sharp profiles place98.57%,69.70% and96.59% respectively inside its combined native libvips bundle. Its PNG profile also spends21.82% in Node startup work. These are short user-space profiles, not kernel or heap allocation traces. No samples were lost. All six profiled outputs passed verification.

The [libvips8.18.0 WebP saver](https://raw.githubusercontent.com/libvips/libvips/v8.18.0/libvips/foreign/webpsave.c) initializes WebPConfig and calls WebPEncode without setting thread_level. [WebP1.6.0 configuration](https://raw.githubusercontent.com/webmproject/libwebp/v1.6.0/src/enc/config_enc.c) defaults thread_level to0. Increasing libvips worker count therefore does not enable WebP encoder threading in this path. Files and srcset variants also remain serial. The profiles and measured CPU usage support native encoding and compression as the bottlenecks on these inputs. They do not establish that every large resize or other encoder would scale the same way.

## Provenance and reproduction

The timed executable hash is ab56ce9ad92407951bc9a24398472b0b0691af35c0c3822dd6254e30b2b47bf6. Measured conversion, verifier, adapter, fixture generator, lockfile and executable hashes match across every batch. The strict initial summary check failed because summary and batch-control Python scripts were added after the first baseline. Those files are not imported by the measured processes. The final validator explicitly checks the six measured scripts and fixture manifest, preserving those checks rather than accepting arbitrary hash differences.

Set the pinned runtime environment from probes/README.md. Then run the following commands. The runner preserves and renames interrupted directories, skips completed batches, and runs only one batch at a time.

```sh
python3 benchmarks/scaling-batches.py
python3 probes/scaling-filesizes.py
python3 probes/report-scaling.py
```

[Raw observations and all ranges](benchmarks/evidence/multicore-scaling.json) · [Per-output sizes and hash stability](benchmarks/evidence/multicore-filesizes.json) · [Untimed profile reports](benchmarks/evidence/scaling-profiles/) · [Interactive charts](benchmarks/evidence/multicore-scaling.html). Full output files and logs remain under benchmarks/results/scaling-cpu*.

Explain the Number required actual CPU-use counters, high-worker profiles, quota checks and repeated trials before interpreting worker counts. Prove It Works required complete output decoding and hashes before reporting size stability. No production code changed and no new delegates were used.

[Visible cgroup quota diagnostic](benchmarks/evidence/scaling-host.json) records the process hierarchy after timing. Every visible cpu.max is unlimited and no throttling periods are recorded.
