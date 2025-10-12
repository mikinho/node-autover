# autover

Copyright (c) 2025 Michael Welter <me@mikinho.com>

Autover: strict SemVer versioner (build metadata by default) for Node projects.

## Quick start

```bash
# add to your project
npm install --save-dev autover

# install default .autoverrc.json
npx autover --init

# install hooks
npx autover --install

# preview one-liner
npx autover --no-amend --dry-run --short

# typical dev flow: just commit; post-commit hook runs autover
git commit -sm "change";  # hook amends with version if needed
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
    "workspaces": false,
    "guardUnchanged": true,
    "skipOnCI": true,
    "short": true,
    "rootAlso": true,
    "lockPath": ".git/autover.lock",
    "patch": null
}
```

## Release

Use `make release VERSION=patch|minor|major` to publish a clean semver to npm.
