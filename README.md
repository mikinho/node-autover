# autover

Copyright (c) 2025-2026 Michael Welter <me@mikinho.com>

Autover: strict SemVer versioner (build metadata by default) for Node projects.

## Quick start

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

## Version formats

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

## Install/Usage

```bash
# Install dependencies
npm install

# Generate docs locally
npm run docs
npm run docs:open

# Clean old docs
npm run docs:clean

# Run unit tests
npm run test:unit

# Publish automatically on version bump
npm version patch
# (postversion runs docs + commit + push)

# Or use Makefile helpers
make docs
make release VERSION=1.1.0
```

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

Unknown keys in `.autoverrc.json` produce a warning at runtime.

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | Success (files updated or nothing to do without `--guard-unchanged`) |
| 1    | Fatal error (no git, no repo, amend failed, etc.) |
| 2    | Bad CLI arguments (`--format`, `--patch`, unknown flags) |
| 4    | `--guard-unchanged` active and no version changes needed |

## Release

Use `make release VERSION=patch|minor|major` to publish a clean semver to npm.
