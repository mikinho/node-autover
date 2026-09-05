import assert from "node:assert/strict";
import test from "node:test";

import { verifyChangelog, verifyReleaseIdentity } from "../scripts/verify-release.mjs";

const manifest = {
    name: "@mikinho/autover",
    version: "3.2.0",
    publishConfig: { access: "public" },
};

test("release identity accepts an aligned clean SemVer", () => {
    assert.doesNotThrow(() => verifyReleaseIdentity(manifest, "v3.2.0"));
    assert.doesNotThrow(() => verifyChangelog("#### [v3.2.0]\n", "v3.2.0"));
});

test("release identity rejects build metadata and mismatched artifacts", () => {
    assert.throws(
        () => verifyReleaseIdentity({ ...manifest, version: "3.2.0+build" }, "v3.2.0"),
        /clean X\.Y\.Z SemVer/u,
    );
    assert.throws(() => verifyReleaseIdentity(manifest, "v3.2.1"), /does not match/u);
    assert.throws(() => verifyChangelog("#### [v3.1.1]\n", "v3.2.0"), /does not match/u);
});

test("release identity rejects the wrong package or access level", () => {
    assert.throws(
        () => verifyReleaseIdentity({ ...manifest, name: "autover" }, "v3.2.0"),
        /name must be @mikinho\/autover/u,
    );
    assert.throws(
        () =>
            verifyReleaseIdentity(
                { ...manifest, publishConfig: { access: "restricted" } },
                "v3.2.0",
            ),
        /publishConfig\.access must be public/u,
    );
});
