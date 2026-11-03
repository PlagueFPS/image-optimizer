# Preview without writing

Preview destinations before conversion, including recursion and exclusions, without creating output files or directories.

## Sub-features

- `preview-shallow`: one planned result.
- `preview-recursive`: two planned results.
- `preview-exclude`: one planned result after excluding nested.
- `preview-no-writes`: entire scratch inventory unchanged.

## How to get to it (user POV)

Add `--dry-run --json` to `img optimize -s input -o output`.

## Driving it with the subprocess harness

Preconditions: Launch and Doctor succeed; use the pristine fixture tree described in the skill. Select a new evidence directory.

```sh
.agents/skills/verify-image-optimizer/scripts/verify.ts dry-run --evidence "$VERIFY_EVIDENCE/dry-run"
```

- **Drive and observe.** Run `--dry-run --json` first without recursion, then with `--recursive`, then with `--recursive --exclude nested`. Expect 1, 2, 1 results respectively, all planned. After each command, require every destination absent, the output directory absent, and the scratch file inventory identical to its pre-command snapshot.
- **Proof.** Require exit zero from the helper, `result.json` with status passed, recorded argv/stdout/stderr/exit codes, and unchanged input hashes. Inspect copied outputs and metadata where produced. After cleanup, `cleanup.json` must report removed and command/result artifacts must still exist.

## Gotchas

Dry runs do not prove successful decoding or output quality; pair with conversion when relevant. Planning still validates paths and rejects overlaps. This journey observes disk side effects; it does not trace network syscalls.
