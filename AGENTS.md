# Image optimizer

Production Rust CLI using in-process libvips. Code changes are permitted.

Keep image handles on the main thread and the VipsApp alive until every handle is dropped. Process one source variant at a time. Use libvips thumbnail operations for shrink-on-load. Do not add a Rust raster copy between decode and encode.

`request` validates CLI options, `plan` owns discovery and destination identity, and `backend` owns native handles and encoding. Preserve the JSON schema or increment its version. Validate behavior through the real CLI and decode outputs.

Run cargo fmt, cargo check, cargo test, and cargo clippy --all-targets -- -D warnings with native libvips available. Read README.md for linking and codec dependencies. Do not claim Sharp performance parity without the independent benchmark results.
