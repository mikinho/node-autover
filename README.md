# @mikinho/autover

Copyright (c) 2025-2026 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@mikinho/autover.svg)](https://www.npmjs.com/package/@mikinho/autover)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A strict SemVer build-metadata versioner for Node.js projects. Stamps every commit with a deterministic version derived
from the author timestamp and short SHA, then amends the commit in place. Workspaces-aware (Yarn/NPM/PNPM) with staged-
change gating and a reentrancy lock to prevent recursive hook loops.

## Features

- **Build Metadata (default):** `X.Y.Z+<minutesSinceJan1UTC>.<gitsha>` — fully SemVer-compliant, sorts by commit time.
- **Pre-release Mode:** `X.Y.<minutesSinceJan1UTC>-<gitsha>` (`--format pre`) for channels that require a prerelease
  identifier.
- **Workspace-Aware:** Discovers packages via `workspaces` in `package.json` or recursive `package.json` scan; only
  versions packages with staged changes.
- **Safe Amend:** Preserves author date, committer date, and commit message. Guards against detached HEAD, in-progress
  merges, and rebases.
- **Reentrancy Lock:** Atomic `O_EXCL` lock file prevents recursive post-commit hook loops.
- **CI-Friendly:** `skipOnCI` silently exits when `CI=true`; `--guard-unchanged` returns exit code 4 for no-op runs.

## Quick Start

```bash
# add to your project
npm install --save-dev @mikinho/autover

# install default .autoverrc.json
npx autover --init

# install hooks (respects core.hooksPath)
npx autover --install

# preview one-liner
npx autover --no-amend --dry-run --short

# typical dev flow: just commit; post-commit hook runs autover
git commit -sm "change";  # hook amends with version if needed
```

## Version Formats

- **Build (default):** `X.Y.Z+<minutesSinceJan1UTC>.<gitsha>`
- **Pre-release:** `X.Y.<minutesSinceJan1UTC>-<gitsha>` (`--format pre`)

## CLI

```text
npx autover [--file PATH | --workspaces]
             [--format build|pre] [--patch N]
             [--guard-unchanged] [--no-amend] [--dry-run]
             [--verbose] [--quiet] [--short]
             [--init] [--install]
```

`--file` and `--workspaces` are mutually exclusive. `--patch` is not supported with `--format pre`. `--patch` must be a
non-negative integer.

## Config

`.autoverrc.json` enables build-metadata mode during dev:

```json
{
    "format": "build",
    "workspaces": true,
    "guardUnchanged": true,
    "skipOnCI": true,
    "short": true,
    "quiet": false,
    "rootAlso": true,
    "tagOnChange": false,
    "lockPath": ".git/autover.lock",
    "patch": null,
    "verbose": false
}
```

Unknown keys in `.autoverrc.json` produce a warning at runtime. Config values are validated the same way CLI arguments
are — invalid `format` or `patch` values will error with exit code 2.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0    | Success (files updated or nothing to do without `--guard-unchanged`) |
| 1    | Fatal error (no git, no repo, amend failed, etc.) |
| 2    | Bad arguments (`--format`, `--patch`, unknown flags, conflicting options) |
| 4    | `--guard-unchanged` active and no version changes needed |

## Troubleshooting

If autover silently does nothing on every commit, a stale lock file is the most likely cause. This can happen if a
previous run was interrupted before cleanup. Delete the lock file to recover:

```bash
rm .git/autover.lock
```

Or the path configured via `lockPath` in `.autoverrc.json`.

## Development

```bash
# install dependencies
npm install

# run unit tests (node:test, zero external deps)
npm run test:unit

# lint
npm run lint

# generate YUIDoc docs locally
npm run docs
npm run docs:open

# clean old docs
npm run docs:clean
```

## Release

Use `make release VERSION=patch|minor|major` to publish a clean semver to npm.

## License

[MIT](LICENSE)
