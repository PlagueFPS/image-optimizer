# Release the CLI

Merges to `main` run CI and update a draft release PR. They never publish to npm.
Even merging the release PR only commits the new version and changelog. Publication
requires running **Publish CLI** manually with the exact version to publish.
The publish workflow accepts only `main`, checks for pending changesets, and runs
checks, builds, and tests before publication. It tags the exact published commit
and creates a GitHub Release after npm accepts the package.

A release contains all code at that commit, including changes with no changeset.
Changesets describe releases. They do not select which code gets published.

## Prepare the first publication

The initial package version and changelog are `0.1.0`. Do not bump the version just
to publish it for the first time.

1. Create and verify an [npm account](https://www.npmjs.com/signup) and enable 2FA.
   The package name is `@plaguefps/img`, so the account must own the `plaguefps`
   scope or have publish access through an npm organization with that name.
   If that scope is unavailable, change the package name, README commands, and
   tarball filename in `publish.yml` before proceeding.
2. Merge the publication setup into `main`. Use a clean checkout of the exact
   commit to release and install dependencies with `pnpm install --frozen-lockfile`.
3. Run the same verification used in CI:

   ```sh
   vp check
   vp pack
   vp test
   npm pack --dry-run
   ```

   The tests install a packed tarball in a temporary consumer directory and check
   the executable, its version, a real conversion, and the included license.

4. Run `npm login` locally. Complete authentication and 2FA in your own terminal
   or browser. Do not put credentials in the repository or chat.
5. Run `npm pack`. Inspect the printed file list, then publish that tarball:

   ```sh
   npm publish ./plaguefps-img-0.1.0.tgz --access public
   ```

6. Create the corresponding GitHub tag and release from that same commit:

   ```sh
   gh release create v0.1.0 --target "$(git rev-parse HEAD)" --title v0.1.0 --notes-file CHANGELOG.md
   ```

7. In the npm package settings, configure a GitHub Actions trusted publisher:
   - Owner: `PlagueFPS`
   - Repository: `img`
   - Workflow filename: `publish.yml`
   - Environment: leave blank
   - Allow direct publishing with `npm publish`.

   The workflow uses GitHub-hosted runners, Node 24, and OIDC with
   `id-token: write`. It needs npm >=11.5.1. No `NPM_TOKEN` secret is needed.
   See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Record a change

Run `pnpm changeset` in a feature or fix branch. Commit the generated file under
`.changeset/` with the code. Write the summary for someone using the CLI.

Use patch for compatible fixes and minor for new features. Before 1.0, use minor
for breaking changes and include migration instructions. After 1.0, use major for
breaking changes. Documentation and development-only changes need no changeset.

## Publish subsequent versions

1. Let normal PRs accumulate on `main`. **Prepare release** maintains a draft PR
   titled `chore(release): version package` with version and changelog changes.
   Review the proposed version and release notes when ready.
2. Mark that PR ready, verify it, and merge it. Keep auto-merge disabled on release
   PRs. If bot-created PRs do not trigger CI, run **CI** manually on the release
   branch through Actions. GitHub's default token does not trigger new workflows
   for most events it creates.
3. Open **Actions > Publish CLI > Run workflow**. Select `main` and enter the
   exact version in `package.json`, such as `0.1.1`.
4. Confirm the workflow succeeded, the npm version exists, and the GitHub Release
   points to the workflow's commit. Existing global installations update only
   when users explicitly update them.

Do not merge more user-facing changes between the release PR and starting
publication. Pending changesets block publication until a release PR consumes them.
The workflow publishes the commit captured when you start it, even if `main` moves
while checks run.

## GitHub repository settings

Under **Settings > Actions > General**, allow GitHub Actions to create pull
requests. The release PR workflow requests write access to contents and PRs. The
publish workflow alone requests an OIDC token.

Protect `main` by requiring PR reviews and successful CI checks as appropriate for
your repository. Workflow files must be on the default branch for manual runs to
appear in Actions. Do not enable an automatic publish-on-push workflow alongside
this setup.

## Recover from an interrupted release

npm versions cannot be overwritten. If publishing fails before npm accepts the
version, fix the problem and rerun the workflow. If npm accepts it but GitHub
release creation fails, create the GitHub Release manually using the successful
publish run's commit SHA as `--target`. Do not republish the same version or tag a
newer commit. Publish a new patch version to fix code already released.
