# Process image directories

Optimize a directory, opting into nested files and excluding unwanted prefixes while preserving relative paths.

## Sub-features

- `directory-shallow`: default processes the root file only.
- `directory-recursive`: nested output is mirrored with concurrency 2.
- `directory-exclude`: nested prefix excluded.
- `directory-symlink`: linked image skipped.

## How to get to it (user POV)

Run `image-optimizer optimize -s input -o output --recursive --exclude nested --json`.

## Driving it with the subprocess harness

Preconditions: Launch and Doctor succeed; use the pristine fixture tree described in the skill. Select a new evidence directory.

```sh
.agents/skills/verify-image-optimizer/scripts/verify.ts directories --evidence "$VERIFY_EVIDENCE/directories"
```

- **Drive and observe.** The helper seeds two files and adds `input/linked.jpg` pointing to `photo.jpg`. Run the directory without recursion at width 16: exactly one result and no nested output. Run with `--recursive --width 16 --concurrency 2`: exactly two optimized results, root and nested WebP decode at width 16. Run with `--recursive --exclude nested`: exactly one result, no nested directory. No command may produce linked.webp.
- **Proof.** Require exit zero from the helper, `result.json` with status passed, recorded argv/stdout/stderr/exit codes, and unchanged input hashes. Inspect copied outputs and metadata where produced. After cleanup, `cleanup.json` must report removed and command/result artifacts must still exist.

## Gotchas

Symlink creation requires OS support; failure is an unmet precondition, not permission to drop that assertion. Use separate source/output trees. Exclusions are source-relative prefixes using `/` separators.
