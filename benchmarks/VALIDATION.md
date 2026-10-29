# Harness validation record

Production performance acceptance is pending. The assigned worktree has the earlier CLI interface, and no release executable was available for the expected contract. No Rust latency, memory, backend parity, or speedup claim follows from these checks.

On 2026-10-29, the reference ran with Node.js v24.15.0 and pinned Sharp 0.35.5. Sharp reported bundled libvips 8.18.7, libwebp 1.6.0, libheif 1.23.5, AOM 3.15.1, librsvg 2.63.2, and libpng 1.6.58. The complete backend map is included in the raw reports.

`npm test` passed nine checks covering srcset decode, missing output, wrong format, truncation, recursive preserve output, blank content, extra output, enlargement, and EXIF orientation. Python compilation, Node syntax checks, CLI help, and rejection of fewer than five repetitions also passed. `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci` succeeded, and `npm audit` found no reported vulnerabilities in the pinned dependency tree.

The full reference validation invoked every workload five times. Reinstalling dependencies during that run caused two `convert-vector` invocations to fail with `ERR_MODULE_NOT_FOUND`. Those failures remain in `validation/full-reference.json`. The affected case was rerun separately in `validation/svg-rerun.json`. A smaller run exercised the revised blocking-wait timer and AVIF preservation in `validation/timer-reference.json`.

These were functional checks of conversion, collection, and verification. The initial full run used the earlier timeout-polling wall timer. Some reference checks overlapped, and dependencies changed while that run was active. Its timings are unsuitable for choosing a backend. The current runner uses a blocking process wait and a separate watchdog to avoid polling delay. No profiler evidence was collected, and no comparative performance verdict is accepted.

The JSON files retain original run commands, hashes, observations, failures, versions, and absolute paths. Large encoded outputs and process logs remain in the ignored `results/` directory of the assigned worktree. These local artifact paths are not portable. Rerun the commands in `README.md` to regenerate artifacts in another checkout.

Reproduce the functional checks from `benchmarks/`:

```sh
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci
npm run fixtures
npm test
python3 -m py_compile run.py adapter.py
python3 run.py --sharp-only --results results/reference-validation
```

After integrating the production CLI, run the default two-sided command from the README and record its native backend versions and option matching. Keep the new measurement separate from these reference-only validation records.
