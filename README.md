# @mikinho/autover

Copyright (c) 2025-2026 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@mikinho/autover.svg)](https://www.npmjs.com/package/@mikinho/autover)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A strict SemVer build-metadata versioner for Node.js projects. Stamps commits with a deterministic version derived from
the author timestamp and, optionally, the triggering commit's short SHA. By default it amends the commit in place;
projects can instead request a separate, marked version commit. Autover is workspace-aware (Yarn/NPM/PNPM), synchronizes
npm lockfiles, and uses a reentrancy lock to prevent recursive hook loops.

## Features

- **Timestamp Metadata (default):** `X.Y.Z+<minutesSinceJan1UTC>`.
- **Timestamp + SHA Metadata:** `X.Y.Z+<minutesSinceJan1UTC>.<gitsha>` with `--metadata timestamp-sha`; `<gitsha>` is
  always the raw abbreviated SHA, never a tag-relative `git describe` value.
- **Pre-release Mode:** `X.Y.<minutesSinceJan1UTC>-<gitsha>` (`--format pre`) for channels that require a prerelease
  identifier.
- **Workspace-Aware:** Uses declared `workspaces` metadata and versions only packages changed by the triggering commit;
  broad recursive discovery requires explicit `--recursive` opt-in.
- **Lockfile Synchronization:** Updates matching `package-lock.json` or `npm-shrinkwrap.json` version fields without
  dependency resolution.
- **Safe Amend:** Preserves author date, committer date, signature state, commit message, JSON formatting, and file modes.
  Guards against detached HEAD and in-progress merge, rebase, cherry-pick, or revert operations.
- **Optional Version Commit:** `--separate-commit` creates a marked follow-up commit whose version identifies the stable,
  reachable triggering commit.
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

- **Build (default):** `X.Y.Z+<minutesSinceJan1UTC>`
- **Build with SHA:** `X.Y.Z+<minutesSinceJan1UTC>.<gitsha>` (`--metadata timestamp-sha`)
- **Pre-release:** `X.Y.<minutesSinceJan1UTC>-<gitsha>` (`--format pre`)

SHA-bearing build and prerelease formats require `--separate-commit` or `--no-amend`. A SHA cannot be embedded while
amending the same commit because the amend creates a new SHA. Timestamp-only metadata has minute resolution, so multiple
commits with the same author minute intentionally share a version.

## CLI

```text
npx autover [--file PATH | --workspaces [--recursive]]
             [--format build|pre] [--patch N]
             [--metadata timestamp|timestamp-sha]
             [--guard-unchanged] [--no-amend | --separate-commit] [--dry-run]
             [--no-skip-ci]
             [--verbose] [--quiet] [--short]
             [--init] [--install]
```

`--file` and `--workspaces` are mutually exclusive, as are `--no-amend` and `--separate-commit`. `--recursive` requires
`--workspaces`. `--patch` is not supported with `--format pre` and must be a non-negative integer. `--no-skip-ci`
explicitly overrides `skipOnCI` for a guarded CI workflow. Commit-producing modes require an empty index and clean
generated manifests/lockfiles.

## Config

`.autoverrc.json` enables build-metadata mode during dev:

```json
{
    "format": "build",
    "metadata": "timestamp",
    "separateCommit": false,
    "workspaces": true,
    "recursive": false,
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

Configuration is schema-validated and fails closed. Unknown keys, malformed JSON, incorrect value types, and invalid
`format`, `metadata`, or `patch` values exit with code 2.

## CI

CI should use a clean checkout, install the locked dependencies, run the local CLI with `--no-amend --no-skip-ci`, and
create a normal follow-up commit only when generated files changed. Exit code `4` is the documented unchanged result;
other nonzero statuses must fail the job. The included `autover.yml` demonstrates this guarded, label-controlled flow
without force-pushing commits or tags.

## Exit Codes

| Code | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| 0    | Success (files updated or nothing to do without `--guard-unchanged`)      |
| 1    | Fatal error (no git, no repo, amend failed, etc.)                         |
| 2    | Bad arguments (`--format`, `--patch`, unknown flags, conflicting options) |
| 4    | `--guard-unchanged` active and no version changes needed                  |

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

# generate JSDoc documentation locally
npm run docs
npm run docs:open

# clean old docs
npm run docs:clean
```

## Release

Use `make release VERSION=patch|minor|major` to publish a clean SemVer to npm. The release helper sets
`AUTOVER_SKIP=1` around `npm version`, preventing the post-commit hook from adding development metadata to the release
commit. `AUTOVER_SKIP=1` can also suppress autover explicitly for other controlled Git operations.

## License

[MIT](LICENSE)
