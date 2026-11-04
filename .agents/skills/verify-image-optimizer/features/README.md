# Image Optimizer verification map

This is the maintained source for user-path verification. Run Launch and Doctor in [the skill](../SKILL.md) first. All journeys require the local built CLI, Node >=22.12, installed Sharp, and the two committed image fixtures. No credentials or persistent data are needed.

Run the executable helper from the checkout root with a fresh absolute evidence directory. Every journey seeds its own input tree, checks original hashes, and cleans scratch state. Do not share output trees or overwrite old evidence. Command transcripts, actual files, decoder observations, and cleanup results remain at the requested evidence path. Treat a failed precondition as failure and record the reason under that feature's Gotchas; do not weaken the journey.

- [Animation](animation.md): timed frames, resizing, unsupported conversions, orientation rejection, and multipage documents.
- [Conversion](conversion.md): four output formats, single-file inputs, JSON and human reports.
- [Resize](resize.md): all five fits, default enlargement prevention and explicit upscaling.
- [Sizes](sizes.md): original dimensions, width variants, duplicate widths, upscaling, and dry runs.
- [Directories](directories.md): shallow and recursive processing, exclusions, symlink skipping, mirrored destinations.
- [Dry run](dry-run.md): shallow, recursive, and excluded previews with no filesystem writes.
- [Safety and errors](safety.md): skip/overwrite, protected originals, overlap, invalid settings, collisions, partial failures.

For each result, report the feature ID, command entry point, evidence path, outcome, and limitations. A successful alternative entry point does not prove an unrun path. The seed map does not yet cover interactive wizard/completion generation, package installation by consumers, every codec option, crop-position pixel selection, metadata, or transparency. Existing `tests/cli.test.ts` has additional assertions; extend this map when those user paths need live proof.
