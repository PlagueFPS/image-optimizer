# Focused performance probes

These probes belong to the replacement worker in `t3-133f7740`, starting from `8b1d6c9`. They leave the independent benchmark programs and historical reports unchanged. They test the recovered implementation, conditional ICC conversion, allocator policy, and an independently deployable native runtime. They do not establish universal Sharp parity.

## Build the native runtime

On Ubuntu 26.04, install build dependencies alongside the libvips packages in the main README.

```sh
sudo apt-get install build-essential cmake pkg-config libdav1d-dev libaom-dev libyuv-dev libwebm-dev
sh probes/build-codecs.sh "$HOME/.local/image-optimizer-codecs"
```

The script downloads and verifies pinned upstream WebP 1.6.0, zlib-ng 2.3.3 and libheif 1.23.5 archives. It builds release shared libraries, enables zlib ABI compatibility, and compiles dav1d decoding and AOM encoding into libheif. Dav1d and AOM themselves come from independently installed distribution packages. It requires dav1d >=1.5.3 and AOM >=3.13.1. No Sharp library or npm package participates in production conversion.

Run the CLI with the private loader prefix. Keep this environment local to the CLI process. Deploy the resulting libraries, their distribution dependencies and their licenses together. Do not replace system libraries globally.

```sh
LD_LIBRARY_PATH="$HOME/.local/image-optimizer-codecs/lib" image-optimizer photo.avif --out-dir optimized
```

The native profile tested here uses distribution libvips 8.18.0, libpng 1.6.57, AOM 3.13.1 and dav1d 1.5.3, plus the pinned sources above. It still differs from Sharp's complete native build. `native_versions.py` records loaded library versions and hashes.

## Reproduce the replacement worker setup

The base libvips environment remains the one documented in the main README. Sudo-free codec development packages were extracted under `/tmp/optimizer-probes/runtime`. They include `libdav1d-dev` and `libdav1d7` 1.5.3-1, `libaom-dev` and `libaom3` 3.13.1-2ubuntu0.1, `libyuv-dev` and `libyuv0` 0.0.1922.20260106-1, and `libwebm-dev` and `libwebm1` 1.0.0.32-1. CMake 4.2.3 and its runtime dependencies were also extracted there. The replacement worker downloaded the missing YUV and WebM packages and built a fresh private codec prefix with this command.

```sh
export PATH=/tmp/optimizer-probes/runtime/usr/bin:$PATH
export LD_LIBRARY_PATH=/tmp/optimizer-probes/runtime/usr/lib/x86_64-linux-gnu:/tmp/image-vips/usr/lib/x86_64-linux-gnu
export LIBRARY_PATH=/tmp/optimizer-probes/runtime/usr/lib/x86_64-linux-gnu
export PKG_CONFIG_SYSROOT_DIR=/tmp/optimizer-probes/runtime
export PKG_CONFIG_PATH=/tmp/optimizer-probes/runtime/usr/lib/x86_64-linux-gnu/pkgconfig
export CMAKE_PREFIX_PATH=/tmp/optimizer-probes/runtime/usr
sh probes/build-codecs.sh /tmp/optimizer-native-133f/codecs
```

For the real CLI under the rebuilt runtime, use this environment.

```sh
export LIBRARY_PATH=/tmp/image-vips/usr/lib/x86_64-linux-gnu
export LD_LIBRARY_PATH=/tmp/optimizer-native-133f/codecs/lib:/tmp/optimizer-probes/runtime/usr/lib/x86_64-linux-gnu:/tmp/image-vips/usr/lib/x86_64-linux-gnu
export VIPSHOME=/tmp/image-vips/usr/lib
export LIBHEIF_PLUGIN_PATH=/tmp/optimizer-native-133f/codecs/lib/libheif
unset MALLOC_ARENA_MAX
cargo test
```

The libheif plugin directory is empty because the selected codecs are built in. Setting it explicitly prevents accidental use of the host's older plugins. Libvips still loads its distribution HEIF module through `VIPSHOME`.

## Repeat the focused comparisons

`focused.py` uses the unchanged reference and full-output verifier from the independent benchmark checkout. Every timed process must succeed, then every output must pass decode, geometry, content and alpha checks. Verification runs outside timing. GNU time measures process RSS and user/system CPU; Python measures end-to-end elapsed time. Each side runs in a fresh process. Order reverses between iterations. Keep the benchmark machine free of other builds and measurements.

`before` is a release binary from recovered HEAD `8b1d6c9`, saved before edits. `arena128` and `default` both use the final source and distribution codecs, with 128 and one glibc arenas respectively. `tuned` uses the final source with the private native runtime. `sharp` uses the independent reference. CPU is 1, quality is 80, effort is 6, and alpha and publication behavior are unchanged.

```sh
export LIBRARY_PATH=/tmp/image-vips/usr/lib/x86_64-linux-gnu
export LD_LIBRARY_PATH=/tmp/image-vips/usr/lib/x86_64-linux-gnu
export VIPSHOME=/tmp/image-vips/usr/lib
python3 probes/focused.py \
  --benchmarks /home/angel/.t3/worktrees/image-optimizer/t3-6f04373b/benchmarks \
  --binary target/release/image-optimizer \
  --before-binary /tmp/optimizer-unconditional-133f \
  --results /tmp/optimizer-focused-final-133f \
  --optimized-prefix /tmp/optimizer-native-133f/codecs \
  --plugin-prefix /tmp/optimizer-probes/runtime \
  --heif-prefix /tmp/optimizer-native-133f/codecs \
  --case directory-flat --case resize-translucent --case preserve-translucent \
  --case convert-translucent --case convert-alpha --case preserve-alpha \
  --case directory-recursive-srcset
```

Use a new results directory for each run. Build release first. `--before-binary` is optional. With a normally installed native runtime, use its install prefix for `--optimized-prefix` and `--heif-prefix` and `/` for `--plugin-prefix`.

## Separate decoder trace

The public-ABI interposer counts complete HEIF decode requests and prints dav1d settings. Compile against installed libheif, dav1d and AOM headers. Add `-I` for a private include directory when needed. Do not report traced timing.

```sh
cc -shared -fPIC probes/decode-trace.c -ldl -o /tmp/decode-trace.so
LD_PRELOAD=/tmp/decode-trace.so image-optimizer input.avif --out-dir trace-output --width 960 --json
```

The replacement worker's trace contains one HEIF decode call and two dav1d opens for the alpha AVIF. Both use automatic thread selection. The preliminary libvips header read does not duplicate raster decode on this fixture. It remains necessary for pre-evaluation source validation. The newer libheif thread-setting fix does not explain a gain when `num_codec_threads` remains zero.

## Evidence attribution

`/tmp/optimizer-focused-133f` and `/tmp/optimizer-focused-clean-133f` were abandoned after discovering the original worker was active again. The first overlapped an original-worker benchmark; the second overlapped its libheif compilation. Neither is acceptance evidence. Original `/tmp/optimizer-probes` results are exploratory artifacts from that worker, not measurements produced here. The final isolated suite starts after cancellation and after verifying those benchmark/build descendants were gone. Build logs and traces for this worker live under `/tmp/optimizer-native-133f`.

The final conditional-profile pipeline reproduces the high-system-CPU symptom with 128 arenas, while one arena avoids it. Separate syscall counts show that the recovered unconditional-profile pipeline avoids most mappings even with 128 arenas. The interaction depends on pipeline shape. Exact attribution of the historical run remains inferred because its allocator state was not recorded. See [RESULTS.md](RESULTS.md) for the accepted repetitions, diagnostic counters and remaining gates.
