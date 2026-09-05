import assert from "node:assert/strict";
import test from "node:test";

import { validatePackedFiles } from "../scripts/check-package.mjs";

const validFiles = [
    { path: "CHANGELOG.md", mode: 0o644 },
    { path: "LICENSE", mode: 0o644 },
    { path: "README.md", mode: 0o644 },
    { path: "bin/autover.js", mode: 0o755 },
    { path: "package.json", mode: 0o644 },
];

test("package validation accepts the exact public artifact", () => {
    assert.doesNotThrow(() => validatePackedFiles(validFiles));
});

test("package validation rejects missing and extra files", () => {
    assert.throws(() => validatePackedFiles(validFiles.slice(1)), /missing: CHANGELOG\.md/u);
    assert.throws(
        () => validatePackedFiles([...validFiles, { path: "tests/fixture.js", mode: 0o644 }]),
        /extra: tests\/fixture\.js/u,
    );
});

test("package validation requires an executable CLI", () => {
    assert.throws(
        () =>
            validatePackedFiles(
                validFiles.map((file) =>
                    file.path === "bin/autover.js" ? { ...file, mode: 0o644 } : file,
                ),
            ),
        /must be executable/u,
    );
});
