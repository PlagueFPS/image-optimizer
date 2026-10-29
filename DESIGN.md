# Why the CLI uses libvips

The goal is daily image conversion with speed and peak RSS at least as good as Sharp. Sharp already uses libvips. Decoder shrink-on-load and demand-driven image evaluation give this implementation the same underlying tools without copying a full raster across the Rust boundary. Independent measurements still have to establish parity.

The original implementation decoded with the Rust image crate, copied into RGB or RGBA, encoded through webpx, and parallelized files through Rayon. That makes memory proportional to the full decoded images and the number of concurrent files. It also discarded errors inside the parallel loop. Replacing that path is smaller than extending it to support all required formats and memory controls.

## Ownership follows the data

`Args` parses external CLI values. `Request` validates combinations and constructs a list of `Transform` variants. `Transform::Original` and `Transform::Fit` carry geometry. `Encoding` selects WebP or source-format preservation.

`plan` discovers supported files, resolves destination identity, and creates `PlannedOutput` records. A plan contains either ready jobs or explicit errors. It is fully built before native processing starts. All producer names are checked together, so one output cannot silently replace another source or output.

`backend` owns `VipsApp`, file descriptors, lazy images, and publication. Its image handles stay local to one call and drop before the application. A header read checks dimensions, page count, loader identity, and orientation. The thumbnail operation reopens the descriptor path to use decoder-specific shrink-on-load. Encoders consume the lazy image directly. No Rust pixel buffer is involved.

The executable converts jobs serially and returns a versioned report. Errors carry source and optional destination paths. A failed job changes the final exit status but does not suppress independent work.

## Alternatives and decisions

A single native image pipeline per source could feed several variant branches, but those branches would need retained handles, careful evaluation order, and potentially large shared decoded regions. One thumbnail operation per variant keeps lifetime and memory behavior clear, at the cost of repeated decode work for srcsets.

A worker pool could improve throughput across small files, but would weaken predictable memory behavior. One active variant with explicit libvips concurrency is the initial design. The independent benchmark can identify whether more concurrency earns its memory cost.

Passing filenames directly to general libvips loaders permits bracket option parsing. Passing `/proc/self/fd/N` avoids filename injection, keeps the source inode open through evaluation. It trades portability for a small Linux implementation. Output savers also receive descriptor paths. User paths never become libvips option strings.

SVG viewport rewriting is a separate vector feature with different semantics from raster encoding. This version reports SVG preserve as unsupported. Static self-contained SVG rasterization is validated explicitly. External resources and CSS are excluded rather than relying on ambient renderer access policy.

## Throughput checkpoint

The first working slice converted a real 3872 by 2592 JPEG into 480 by 321 and 960 by 643 WebP files, using the agreed CLI and report fields. The test suite subsequently verified JPEG, PNG, AVIF, and SVG conversion, preserve-mode raster formats, alpha, orientation, planner behavior, and failure exits.

The local system lacked libvips and passwordless sudo. Extracted Ubuntu packages enabled the spike. AVIF initially failed because relocated libvips modules were not discovered. Setting VIPSHOME to the extracted library prefix enabled HEIF loading and the real AVIF tests passed. These setup details are in README.md.

Remaining constraints are native packaging, Linux descriptor paths, intentionally restricted SVG support, soft resource controls, serial repeated srcset decode, and unmeasured Sharp parity. No full-raster Rust fallback was added.

## API evidence

The implementation was checked against [libvips Rust binding 2.3.0](https://docs.rs/libvips/2.3.0/libvips/) and its downloaded source, particularly `VipsApp`, `VipsImage`, `ThumbnailOptions`, and typed saver options. The binding links directly to native libraries without a pkg-config build script.

[The libvips thumbnail guide](https://www.libvips.org/API/current/using-vipsthumbnail.html) documents decoder shrink-on-load and sRGB conversion before metadata stripping. [libvips 8.18 initialization source](https://github.com/libvips/libvips/blob/v8.18.0/libvips/iofuncs/init.c) establishes the VIPSHOME relocation behavior used in the local setup.
