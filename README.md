# Starter Kitty

Starter Kitty is a collection of common utilities and packages for JavaScript projects. It is designed to provide sensible defaults for common tasks, such as file system operations and input validation.

## Why `starter-kitty`?

Application security is hard. There are often many ways to get it wrong, and it's easy to make mistakes when you're trying to ship features quickly. This package provides a set of components that are safe-by-default, so you can focus on building your app without worrying about common security footguns.

## Documentation

Please refer to the [documentation website](https://kit.open.gov.sg/) for detailed API documentation and usage examples.

## Packages

- [`@opengovsg/validators`](./packages/validators/): Common input validators.

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

Changesets supports a [**pre mode**](https://github.com/changesets/changesets/blob/main/docs/prereleases.md) for cutting prerelease versions (e.g. `1.4.0-beta.0`) instead of stable ones. Pre mode is toggled by the presence of a committed `.changeset/pre.json` file — it is a shared, repo-wide switch, not a per-developer setting. To check the current state, look for `.changeset/pre.json`: if it exists with `"mode": "pre"`, the repo is in prerelease mode.

To **enter** prerelease mode (subsequent releases become `…-beta.N`):

```bash
pnpm changeset pre enter beta
git add .changeset/pre.json
git commit -m "chore: enter changesets pre mode"
```

To **exit** prerelease mode and return to stable releases:

```bash
pnpm changeset pre exit   # flips .changeset/pre.json to "exit" mode only
git add .changeset/pre.json
git commit -m "chore: exit changesets pre mode"
```

Once the change lands on `develop`, the next "Version Packages" PR resolves versions accordingly — prerelease versions (`…-beta.N`, published under the `beta` dist-tag) while in pre mode, or stable versions (e.g. `1.3.0-beta.3` → `1.4.0`, published under `latest`) once exited.

> [!NOTE]
> Always use the `pnpm changeset pre enter`/`exit` commands rather than hand-editing `pre.json`. Treat entering and exiting pre mode as deliberate, coordinated release decisions, since the switch affects the whole repo.

### Snapshot releases

To publish a throwaway version for testing (tagged `snapshot` on npm, never `latest`), run the **Release** workflow manually from the Actions tab with the **Create snapshot release** input enabled.
