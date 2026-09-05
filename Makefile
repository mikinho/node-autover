# Repository helpers. Release targets create a local signed commit and tag;
# publishing happens only after the reviewed tag is pushed.
.POSIX:
SHELL = /bin/sh

.PHONY: check clean docs lint release release-major release-minor release-patch test

docs:
	npm run docs

clean:
	npm run docs:clean

release:
	@echo "Choose release-patch, release-minor, or release-major." >&2
	@exit 2

release-patch: check
	npm run release:patch

release-minor: check
	npm run release:minor

release-major: check
	npm run release:major

check:
	@command -v npm >/dev/null 2>&1 || { echo "npm not found"; exit 1; }
	@if [ ! -f package.json ]; then echo "package.json missing"; exit 1; fi

test:
	npm test

lint:
	npm run lint
