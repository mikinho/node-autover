# Contributing

Welcome! We appreciate your help in improving `@mikinho/autover`.

## Development

### Getting Started

```bash
npm install
```

### Development Commands

```bash
# Run the unit test suite (node:test, zero external deps)
npm run test:unit

# Run ESLint + Prettier checks
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format with Prettier
npm run format
```

### Code Style

The project uses ESLint with `eslint-config-prettier` to avoid rule conflicts. A few conventions to follow:

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

To release a new version:

1. Make your code changes in a branch.
2. Open a Pull Request against `main`.
3. Add the **`autover-apply`** label to the Pull Request.
4. Merge the Pull Request.

Upon merge, the GitHub Action will automatically bump the package version, amend the merge commit, and push the result
back to `main`.

> **Note:** Direct commits to `main` will skip the autover pipeline if no PR with the required label is found.

For manual releases, use:

```bash
make release VERSION=patch|minor|major
```

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
