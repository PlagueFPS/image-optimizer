# Move originals

Run the built CLI journey after Launch and Doctor from [the verification skill](../SKILL.md).

```sh
.agents/skills/verify-image-optimizer/scripts/verify.ts move --evidence /tmp/img-move-evidence
```

Use a fresh evidence path. The journey previews recursive relocation with `--sizes 4,8` and concurrency 12, then runs the same command without `--dry-run`. It compares archive SHA-256 hashes with original hashes, checks that source files disappear, and fully decodes all six optimized outputs. Dry runs must preserve originals and create neither destination directory.

`commands.json` records the actual commands, reports, and exit statuses. `inputs-before.json`, `inputs-after.json`, `files.json`, and copied files retain the byte evidence. `cleanup.json` must report successful scratch removal.

The journey also copies the 567px PNG fixture and runs `--sizes 32,1000 --move`. It requires exit 1, two fully decoded eligible outputs, and one rejected oversized variant without a file. Every JSON result, including the failed variant, must report `relocation.status: "moved"` and the archive destination. The source must disappear and the archived bytes must match its original hash.

The CLI integration suite in `tests/cli.test.ts` also checks skip and partial failure preservation, collisions including dangling symlinks, path overlap, mirrored symlinks, injected copy failure, and cross-filesystem relocation when `/dev/shm` is available on another device. This journey does not prove those additional cases.
