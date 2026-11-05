# Image CLI benchmark

Run from the repository root with Python 3, Node, installed dependencies and a built CLI. The driver uses Python's `resource` module, so it requires Linux or macOS. Native tools are optional.

Preserve a build before making a change. Keep its native dependencies resolvable.

```sh
vp run build
mkdir /tmp/img-before
cp dist/*.cjs /tmp/img-before/
ln -s "$PWD/node_modules" /tmp/img-before/node_modules
```

Create a JSON configuration, then build the candidate. Relative executable paths resolve from the repository root.

```json
{
  "cases": ["small", "photo", "resize", "batch", "sizes", "small-sizes", "help", "version"],
  "rounds": 5,
  "variants": [
    { "name": "before", "command": ["node", "/tmp/img-before/cli.cjs"] },
    { "name": "after" }
  ]
}
```

```sh
vp run build
python3 tools/bench/webp.py /tmp/benchmark-config.json --output /tmp/benchmark-results
```

The output directory must be new. Evidence is retained there. The driver prepares 12 photo crops and 12 transparent PNG variants from the committed fixtures. This is two source image families, not a diverse corpus.

`small`, `photo` and `resize` each produce one output. `batch` produces 24 outputs, capped at width 1280. `sizes` produces the full-size JPEG and widths 384, 868 and 1200. `small-sizes` produces the full-size PNG and widths 128, 256 and 384.

Timing includes subprocess startup, CLI execution, encoding, writes and exit. Native batches include Python process dispatch. Build, corpus preparation, output-directory creation and decoded-output validation are outside timing. Outputs are fresh, so skipped destinations cannot produce a fast sample. Each report must have the expected optimized count and zero failures or skips.

After timing, every output must fully decode with expected format, dimensions, exact alpha and RGB PSNR of at least 20 dB against the Sharp reference transform. That threshold detects gross errors; it does not establish equal perceptual quality. All `img` variants must produce identical output hashes for the same case. Native tools can use different resamplers and are not required to match hashes. The reference transform favors Sharp for resized quality measurements.

The driver rotates variants each round. `summary.json` reports median and full range. `runs.json` retains byte counts, hashes, PSNR, child CPU time and completed output counts. `runs.jsonl` preserves completed samples if a later run fails. Failures abort the comparison and write `failure.txt`; they do not contribute a timing result.

Compile caching defaults to disabled. Set a variant's `cache` to `cold` for a fresh cache directory every trial or `warm` for a persistent cache. Warm variants prime each case outside reported timings. Priming samples remain in `runs.jsonl` with `prime: true` and are excluded from the summary. Source images are still decoded and encoded on every warm run.

A variant can set or remove environment values with `env`, and append CLI arguments with `flags`. A JSON `null` removes an environment value. For native comparisons use `kind: "cwebp"` or `kind: "magick"`, an explicit `command`, and a `workers` count. Use native variants only with image cases. Native tools run at quality 80 and effort 4; ImageMagick's OpenMP limit should be set explicitly through `env`. Tune each side before drawing tool-selection conclusions.

The benchmark does not measure physical disk throughput, installation, peak memory, animations, metadata preservation or failure-path performance. Use the CLI verification skill and regression suite for behavior outside these workloads.
