# @mikinho/autover

Copyright (c) 2025-2026 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@mikinho/autover.svg)](https://www.npmjs.com/package/@mikinho/autover)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A strict SemVer build-metadata versioner for Node.js projects. Stamps commits with a deterministic version derived from
the author timestamp and, optionally, the triggering commit's short SHA. By default it amends the commit in place;
projects can instead request a separate, marked version commit. Autover is workspace-aware (Yarn/NPM/PNPM), synchronizes
npm lockfiles, and uses a reentrancy lock to prevent recursive hook loops. Because it runs as a post-commit hook with
write access to your history, autover ships with zero runtime dependencies: one file, built entirely on Node.js builtins.

## Supported Environments

- Node.js 22.13.0 or newer. The exact minimum and Node.js 24 are exercised in CI.
- Git 1.8.2 or newer for repository operations.
- Linux and Windows are exercised in CI, including installation of the packed command at the exact Node.js minimum. Maintainer validation also covers macOS.
- npm supplies the installed `autover` launcher and is required for hook installation through `npx --no-install`.

The package is ESM and exposes a command, not a supported JavaScript import entry point.

## Features

- **Timestamp Metadata (default):** `X.Y.Z+<minutesSinceJan1UTC>`.
- **Timestamp + SHA Metadata:** `X.Y.Z+<minutesSinceJan1UTC>.<gitsha>` with `--metadata timestamp-sha`; `<gitsha>` is
  always the raw abbreviated SHA, never a tag-relative `git describe` value.
- **Pre-release Mode:** `X.Y.<minutesSinceJan1UTC>-<gitsha>` (`--format pre`) for channels that require a prerelease
  identifier.
- **Workspace-Aware:** Uses declared `workspaces` metadata and versions only packages changed by the triggering commit;
  broad recursive discovery requires explicit `--recursive` opt-in. Workspace globs support literal paths, `*`, `?`,
  `**`, and leading-`!` negation; unsupported glob syntax exits with code 2 rather than guessing.
- **Lockfile Synchronization:** Updates matching `package-lock.json` or `npm-shrinkwrap.json` version fields without
  dependency resolution.
- **Safe Amend:** Preserves author date, committer date, signature state, commit message, JSON formatting, and file modes.
  Guards against detached HEAD and in-progress merge, rebase, cherry-pick, or revert operations.
- **Optional Version Commit:** `--separate-commit` creates a marked follow-up commit whose version identifies the stable,
  reachable triggering commit.
- **Reentrancy Lock:** Atomic `O_EXCL` lock file prevents recursive post-commit hook loops.
- **CI-Friendly:** `skipOnCI` silently exits when `CI=true`; `--guard-unchanged` returns exit code 4 for no-op runs.
- **Zero Dependencies:** A single-file CLI built entirely on Node.js builtins — nothing in the supply chain of a tool
  that rewrites your commits.

## Quick Start

```bash
# add to your project
npm install --save-dev @mikinho/autover

# install default .autoverrc.json
npx autover --init

# install hooks (respects core.hooksPath)
npx autover --install

# remove only autover-managed hook blocks
npx autover --uninstall

# inspect runtime, hooks, and lock ownership
npx autover --doctor

# preview one-liner
npx autover --no-amend --dry-run --short

# fail without writing when generated versions have drifted
npx autover --check --json

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
             [--guard-unchanged] [--no-amend | --separate-commit] [--dry-run | --check]
             [--no-skip-ci]
             [--verbose | --quiet | --short | --json]
             [--init | --install | --uninstall | --doctor | --unlock]
```

`--file` and `--workspaces` are mutually exclusive, as are `--no-amend` and `--separate-commit`. `--recursive` requires
`--workspaces`. `--patch` is not supported with `--format pre` and must be a non-negative integer. `--no-skip-ci`
explicitly overrides `skipOnCI` for a guarded CI workflow. Commit-producing modes require an empty index and clean
generated manifests/lockfiles. `--check` never writes, ignores `skipOnCI`, and exits `3` when updates are required.
`--verbose`, `--quiet`, `--short`, and `--json` are mutually exclusive; an explicitly supplied CLI output mode replaces
the configured mode. `--init`, `--install`, `--uninstall`, `--doctor`, and `--unlock` are mutually exclusive. Dry-run
summaries say files "would update" and never claim a write.

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
    "json": false,
    "rootAlso": true,
    "lockPath": ".git/autover.lock",
    "patch": null,
    "verbose": false
}
```

Configuration is schema-validated and fails closed. Unknown keys, malformed JSON, incorrect value types, and invalid
`format`, `metadata`, or `patch` values exit with code 2.

## Migration to v4

`tagOnChange` has been removed. Generated build versions no longer create lightweight `vX.Y.Z` tags because build
metadata is stripped from those tag names and subsequent commits collide with the first tag. Remove the key from
`.autoverrc.json`; create release tags through the documented signed release process instead.

Node.js 20 support has been removed. Upgrade consumers to Node.js 22.13.0 or newer before installing v4.

### Machine-readable output

`--json` emits exactly one compact JSON document on stdout for a successfully planned, applied, skipped, diagnostic, or
unlock invocation.
Schema version `1` contains `mode`, `outcome`, `applied`, normalized repository-relative `files`, and package `from`/`to`
versions. Its `lockfiles` entries identify the package versions synchronized into each lockfile. Planned results also
identify the triggering commit. Consumers should reject unknown schema versions, require documented fields, and
tolerate additive fields. Usage and operational errors remain diagnostics on stderr with a nonzero exit status and do
not promise a JSON document.

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
| 3    | `--check` found generated manifests or lockfiles that need updates        |
| 4    | `--guard-unchanged` active and no version changes needed                  |

## Troubleshooting

Autover lock files record a schema version, unique owner, process ID, hostname, creation time, and repository identity.
An active same-host or foreign-host lock remains a successful reentrancy skip. A stale, malformed, or unsafe lock fails
with an actionable diagnostic instead of silently disabling versioning.

Inspect the effective runtime, hook path, and lock owner first:

```bash
npx autover --doctor
```

When the recorded owner is on this host and its process has ended, remove it safely:

```bash
npx autover --unlock
```

`--unlock` refuses active, foreign-host, malformed legacy, mismatched-repository, symlink, and non-file locks. Manual
recovery of one of those cases requires independently verifying the owner and the path configured by `lockPath`.

## Development

```bash
# install dev dependencies (autover itself has none)
npm ci

# run unit tests (node:test, zero external deps)
npm run test:unit

# lint
npm run lint

# JSDoc-aware implementation type check
npm run typecheck

# validate the exact packed files and installed CLI
npm run test:package

# generate JSDoc documentation locally
npm run docs
npm run docs:open

# clean old docs
npm run docs:clean
```

## Release

From a clean, synchronized `main`, use `make release-patch`, `make release-minor`, or `make release-major`. The helper runs the publication gates and creates a signed, signed-off release commit plus a matching signed annotated tag; it does not push or publish. Review the result, then run `git push --follow-tags`.

The tag-only release workflow verifies the tag and its `main` ancestry, tests and packs the exact artifact, then publishes that same tarball through npm trusted publishing with provenance. `AUTOVER_SKIP=1` suppresses development metadata during the controlled release commit and can also be used for other deliberate Git operations.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Do not disclose an unpatched vulnerability in a public issue.

## License

[MIT](LICENSE)
