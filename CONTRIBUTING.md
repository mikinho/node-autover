# Contributing

Welcome! We appreciate your help in improving `@mikinho/autover`.

## Development

### Getting Started

```bash
npm ci
```

### Development Commands

```bash
# Run the unit test suite (node:test, zero external deps)
npm run test:unit

# Run ESLint + Prettier checks
npm run lint
npm run format:check

# Check the maintained JavaScript/JSDoc surface
npm run typecheck

# Pack, install, and exercise the public CLI offline
npm run test:package

# Auto-fix lint issues
npm run lint:fix

# Format with Prettier
npm run format
```

### Code Style

The project uses ESLint with `eslint-config-prettier` to avoid rule conflicts and a JSDoc-aware TypeScript check for the maintained JavaScript surface. A few conventions to follow:

- Prefer `++x` over `x++` (preincrement).
- Use early exits and `continue` to reduce nesting.
- Never use `else`/`else if` after a control flow interrupt (`return`, `break`, `continue`).
- All `console.error` and `console.warn` messages use the `autover:` prefix with lowercase text.
- Inside the reentrancy lock's `try`/`finally` block, use `process.exitCode = N; return;` instead of `process.exit(N)`
  so the `finally` block always cleans up the lock file.

### Testing

Tests live in `tests/` and use the built-in `node:test` runner with `node:assert/strict` — no test framework
dependencies. The main CLI guards execution behind `_isDirectRun` and exports pure functions so they can be imported
directly in tests.

### Adding Exportable Functions

To make a new function testable:

1. Write the function in `bin/autover.js`.
2. Add it to the `export { ... }` block above the `_isDirectRun` guard.
3. Import it in `tests/autover.test.js` and add test cases.

## Release Process

This package uses [`@mikinho/autover`](https://github.com/mikinho/node-autover) for automated versioning (yes, it
versions itself).

The `autover-apply` label controls development build metadata on `main`; it does not publish a release. After a labeled pull request is merged, the workflow produces a narrowly scoped follow-up commit containing only the generated package version, lockfile version, and changelog.

To prepare a public release, start from a clean `main` synchronized with its upstream and run exactly one of:

```bash
make release-patch
make release-minor
make release-major
```

The release helper:

1. Replaces development metadata with the selected clean SemVer.
2. Regenerates `CHANGELOG.md`.
3. Runs the full publication gate and packed-consumer check.
4. Creates a signed, signed-off release commit and signed annotated tag.
5. Stops without pushing or publishing.

Review the local commit and tag, then push both together:

```bash
git push --follow-tags
```

The tag-only release workflow verifies the signed tag, checks that it belongs to `main`, tests and packs the exact artifact, and publishes that same tarball through npm trusted publishing with provenance. The npm trusted publisher must be restricted to this repository and `.github/workflows/release.yml`.

Development metadata remains opt-in:

1. Make your code changes in a branch.
2. Open a Pull Request against `main`.
3. Add the **`autover-apply`** label to the Pull Request.
4. Merge the Pull Request.

Direct commits to `main` skip development versioning when no associated pull request has the required label.

## Security

Report suspected vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not a public issue.

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
