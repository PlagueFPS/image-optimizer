# Changesets

For a user-visible change, run `pnpm changeset` and commit the generated Markdown
file with your PR. Describe the behavior users will see.

Use patch for compatible fixes and minor for new features. While the package is
below 1.0, use minor for breaking CLI changes and describe migration steps in the
changeset. After 1.0, use major for breaking changes.

Documentation and development-only changes do not need a changeset.

The release PR collects pending changes and updates the version and changelog.
Merging it does not publish. See [the release guide](../RELEASING.md).
