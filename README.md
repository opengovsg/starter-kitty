# Starter Kitty

Starter Kitty is a collection of common utilities and packages for JavaScript projects. It is designed to provide sensible defaults for common tasks, such as file system operations and input validation.

## Why `starter-kitty`?

Application security is hard. There are often many ways to get it wrong, and it's easy to make mistakes when you're trying to ship features quickly. This package provides a set of components that are safe-by-default, so you can focus on building your app without worrying about common security footguns.

## Documentation

Please refer to the [documentation website](https://kit.open.gov.sg/) for detailed API documentation and usage examples.

## Packages

- [`@opengovsg/starter-kitty-validators`](./packages/validators/): Common input validators.

## Releasing

Releases are managed with [Changesets](https://github.com/changesets/changesets). Only public packages are published; private workspace packages (e.g. the shared config packages) are skipped automatically.

### Day-to-day flow

1. In any PR that changes a publishable package, add a changeset describing the change:

   ```bash
   pnpm changeset
   ```

   Pick the affected package and bump type (patch / minor / major), then commit the generated `.changeset/*.md` file along with your code.

2. When the PR merges into `develop`, the **Release** workflow opens (or updates) a **"Version Packages"** PR that applies the pending changesets — bumping versions and updating `CHANGELOG.md`.

3. Merging the "Version Packages" PR publishes the new versions to npm. Publishing uses npm [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored in the repo.

### Prerelease (beta) mode

The repo is currently in Changesets **pre mode** (tag `beta`), so released versions are cut as `…-beta.N`. The pre-mode state is the committed `.changeset/pre.json` file — it is a shared, repo-wide switch, not a per-developer setting.

To cut a **stable** release, exit pre mode and commit the change:

```bash
pnpm changeset pre exit   # flips .changeset/pre.json to "exit" mode only
git add .changeset/pre.json
git commit -m "chore: exit changesets pre mode"
```

Once that lands on `develop`, the next "Version Packages" PR resolves to stable versions (e.g. `1.3.0-beta.3` → `1.4.0`) published under the `latest` dist-tag. To start a new prerelease cycle later, run `pnpm changeset pre enter beta` and commit.

> [!NOTE]
> Always use the `pnpm changeset pre enter`/`exit` commands rather than hand-editing `pre.json`. Treat entering and exiting pre mode as deliberate, coordinated release decisions, since the switch affects the whole repo.

### Snapshot releases

To publish a throwaway version for testing (tagged `snapshot` on npm, never `latest`), run the **Release** workflow manually from the Actions tab with the **Create snapshot release** input enabled.
