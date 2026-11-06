---
name: verify-image-optimizer
description: Verify Image Optimizer CLI behavior through its built Node executable, including conversion, resizing, directory processing, dry runs, and file safety. Use after CLI changes or when collecting reproducible user-path evidence.
---

# Verify Image Optimizer

Read [the feature index](features/README.md) and select the relevant journeys. This is a short-lived CLI with no server, database, credentials, or ports. Use the built executable, never internal optimizer functions. The harness follows `tests/cli.test.ts`: isolated subprocesses with captured stdout/stderr. It supplies `y` on stdin to confirm missing output directory creation; prompts are captured on stderr. Acceptance, decline, closed input, and prompt-free cases are also covered by the CLI test suite. A terminal interaction is not required for these commands; interactive `--wizard` is outside the seeded map.

## Launch

From the checkout root, with Node >=22.12 and Vite+ (`vp`) on PATH:

```sh
vp install
vp pack
.agents/skills/verify-image-optimizer/scripts/verify.ts doctor
```

Installation runs the repository's Effect tooling patch. It may fetch dependencies; do not use a published package or globally installed executable as a substitute for this checkout. Ready means the doctor exits zero, prints this checkout path, matching package/CLI version and executable hash, successfully reads both image fixtures, and finds optimize help. Each drive starts its own Node processes and fresh temporary input/output tree. Processes exit on completion; cleanup removes only that drive's scratch tree.

## Doctor

```sh
.agents/skills/verify-image-optimizer/scripts/verify.ts doctor
```

This read-only check checks the Node minimum, build freshness against `src/*.ts`, help, version, and Sharp's ability to read the actual fixtures. Run it first if anything looks off. Rebuild after any source or build configuration change; timestamp checks cannot detect every dependency/configuration change. No network calls or image writes are needed by doctor.

## Drive

Choose `conversion`, `resize`, `sizes`, `directories`, `dry-run`, `safety`, or `move` from the map. For example, in a fresh shell/PTY:

```sh
VERIFY_EVIDENCE="$(mktemp -d /tmp/image-optimizer-evidence-XXXXXX)"
.agents/skills/verify-image-optimizer/scripts/verify.ts conversion --evidence "$VERIFY_EVIDENCE/conversion"
test -s "$VERIFY_EVIDENCE/conversion/result.json"
test -s "$VERIFY_EVIDENCE/conversion/commands.json"
cat "$VERIFY_EVIDENCE/conversion/cleanup.json"
```

Use a new child directory for each invocation; existing evidence directories are rejected. Report the printed absolute path. Each feature starts from pristine copies of `tests/fixtures/test.jpg` and `test2.png`, arranged as `input/photo.jpg` and `input/nested/second.png`. CLI invocations run from a disposable working directory and use absolute source/output paths. Parallel drives have separate scratch/evidence directories. Serialize dependency installation and builds within a shared checkout; do not rebuild while another drive is running.

## Evidence

Each evidence directory contains `doctor.json`, `commands.json` (argv, working directory, stdout, stderr, actual exit status), input hashes before/after, final file hashes, decoded metadata, copies under `files/`, `result.json`, and `cleanup.json`. `failure.txt` records an exception; a failed journey may have only partial artifacts. A zero harness exit and `status: passed` are required; missing preconditions fail rather than skip assertions.

Prove the user command and resulting files together: parse reports, fully decode outputs with Sharp, compare dimensions/format/byte counts where relevant, and compare original SHA-256 hashes. Sharp is an observer and fixture decoder here, not a substitute for the CLI action. No mocks or internal setters. Dry-run proof compares the entire scratch file inventory and checks that destinations and output directories do not exist; its name alone is not evidence. This proves filesystem behavior, not a network audit. No remote service is involved in optimize.

One journey proves only its mapped sub-features. Report unrun features explicitly. For flags outside the seed map, extend the map and observations before claiming coverage.

## Cleanup

The helper's Effect scope finalizer removes its uniquely created temporary tree on both success and assertion failures. Completed subprocesses require no teardown; subprocess timeouts kill and reap the process. It never kills by process name. Evidence lives outside scratch and survives cleanup; confirm `cleanup.json` says `removed: true` and the command/result files still exist.

If the harness itself is forcibly terminated, read `scratch.txt` in that run's evidence directory, confirm it is the exact run-owned `/tmp/image-optimizer-verify-*` tree, and remove that tree only. Retain all evidence directories, including failed attempts. Do not remove dependencies, the build, or user files as teardown.

## Helpers

Executable: `scripts/verify.ts`, invoked above from the repository root. `--help` lists the accepted features. It uses the repo's TypeScript, Effect, Node platform, and Sharp dependencies. The executable shebang enables Node's built-in TypeScript stripping (`node --experimental-strip-types`); no additional runner is needed. Node 22 may emit an experimental warning on stderr. Every drive reruns doctor, stores transcripts before asserting outcomes, and cleans its scratch tree. It does not install dependencies or rebuild implicitly.
