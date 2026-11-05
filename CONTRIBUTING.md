# Contribute to img

The CLI uses Effect for command parsing and application logic and Sharp for image
processing. See [the README](README.md) for consumer-facing behavior and
[the release guide](RELEASING.md) for changesets and publication procedures.

## Verify a change

Install dependencies with `pnpm install --frozen-lockfile`. Run `vp check` for
formatting, linting, and type checking. For changes to application behavior, build
with `vp pack` and run `vp test`.

## Concurrency implementation

The default file concurrency is `max(1, floor(availableParallelism() * 0.75))`, using Node's available CPU estimate.
The CLI sets Sharp's libvips concurrency to one thread per image. `--concurrency` overrides the file workflow limit.
Actual simultaneous encodes also depend on libuv's thread pool. Before loading Sharp, the CLI defaults `UV_THREADPOOL_SIZE` to the file concurrency capped at 16.
An existing `UV_THREADPOOL_SIZE` value is preserved. `--concurrency` changes the file workflow limit without changing the native worker pool.
If Node preloads initialize libuv early, set `UV_THREADPOOL_SIZE` before launching the CLI.
Some codecs use additional threads independently of the libvips setting.

Scaling by 75% is a heuristic, not a measured optimum or a CPU reservation.
Higher concurrency can increase peak memory use; lower `--concurrency` for large images or limited memory.

## Multipage input detection

Page count alone does not identify an animation. Multipage documents such as TIFF
use first-page conversion; animated GIF and WebP inputs preserve their frames.

## Project background

I wanted a reliable, consistent, and fast image optimization CLI that my agents and I could use from any project without having to write a custom
script for each project or one-off optimizations. I also wanted an agent-friendly CLI that would be easy to use, have well documented help text, have structured outputs for agents to read, not crash the whole process if one image failed, support dry runs, support the most command image formats, and be able to process entire directories/subdirectories built-in without the agent needing to write a custom python/shell script to do so.
