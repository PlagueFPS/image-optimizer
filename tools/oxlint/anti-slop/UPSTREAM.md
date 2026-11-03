# Anti-slop provenance

- Source repository: https://github.com/PlagueFPS/skills
- Source commit: `bf82a1feecedc3b5e8bbfb7446f304080e2fd26f`
- Source directory: `install-anti-slop/assets/anti-slop/`
- Installed directory: `tools/oxlint/anti-slop/`
- Generic entry point: `tools/oxlint/anti-slop/index.ts`
- Effect entry point: `tools/oxlint/anti-slop/effect/index.ts`
- Intentional deviations: none in copied assets; this provenance file was added locally.

The source assets were clean at the recorded revision and copied with the skill's
`scripts/install.mjs`. The nested `vendor/eslint-stylistic/LICENSE` and
`vendor/eslint-stylistic/UPSTREAM.md` are preserved.

The Effect service import rule covers relative project imports; package-alias
imports are a current enforcement limitation.
