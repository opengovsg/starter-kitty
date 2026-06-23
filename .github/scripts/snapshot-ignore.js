// Resolves which workspace packages to EXCLUDE from a snapshot release.
//
// Reads the `PACKAGES` env var (the workflow_dispatch input): a comma/space
// separated list of packages to snapshot, matched against each publishable
// package's npm name or its directory name under packages/.
//
// Emits `ignore_args=--ignore <name> ...` (for GITHUB_OUTPUT) listing every
// OTHER publishable package, so `changeset version --snapshot` only versions
// the requested ones. Empty input => no ignores => snapshot all packages.
//
// Note: changesets refuses to ignore a package if a non-ignored package
// depends on it. Keep snapshot scopes self-contained w.r.t. internal deps.

const fs = require('fs')
const path = require('path')

const packagesDir = path.join(__dirname, '..', '..', 'packages')

const selected = (process.env.PACKAGES || '')
  .split(/[\s,]+/)
  .map((s) => s.trim())
  .filter(Boolean)

// No selection: snapshot everything (current default behaviour).
if (selected.length === 0) {
  process.stdout.write('ignore_args=\n')
  process.exit(0)
}

const publishable = fs
  .readdirSync(packagesDir)
  .map((dir) => ({ dir, manifest: path.join(packagesDir, dir, 'package.json') }))
  .filter(({ manifest }) => fs.existsSync(manifest))
  .map(({ dir, manifest }) => ({ dir, ...JSON.parse(fs.readFileSync(manifest, 'utf8')) }))
  .filter((pkg) => pkg.private !== true && pkg.name)

const matches = (pkg, sel) => sel === pkg.name || sel === pkg.dir

const unknown = selected.filter((sel) => !publishable.some((pkg) => matches(pkg, sel)))
if (unknown.length > 0) {
  const names = publishable.map((p) => `${p.name} (${p.dir})`).join(', ')
  console.error(`No publishable package matches: ${unknown.join(', ')}`)
  console.error(`Publishable packages: ${names}`)
  process.exit(1)
}

const ignore = publishable.filter((pkg) => !selected.some((sel) => matches(pkg, sel)))
const ignoreArgs = ignore.map((pkg) => `--ignore ${pkg.name}`).join(' ')

process.stdout.write(`ignore_args=${ignoreArgs}\n`)
