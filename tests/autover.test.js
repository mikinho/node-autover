import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    parseMMP,
    makeVersionBuild,
    makeVersionPre,
    minutesSinceYearStart,
    parseArgs,
    versionTuple,
    isoZ,
    fromGitEpoch,
} from "../bin/autover.js";

/* ------------------------------------------------------------------ */
/* parseMMP                                                            */
/* ------------------------------------------------------------------ */

describe("parseMMP", () => {
    it("parses a simple X.Y.Z version", () => {
        assert.deepEqual(parseMMP("1.2.3"), [1, 2, 3]);
    });

    it("strips build metadata after +", () => {
        assert.deepEqual(parseMMP("2.0.1+410414.abc1234"), [2, 0, 1]);
    });

    it("strips prerelease after -", () => {
        assert.deepEqual(parseMMP("3.1.0-beta.1"), [3, 1, 0]);
    });

    it("strips both prerelease and build metadata", () => {
        assert.deepEqual(parseMMP("1.0.0-rc.1+build"), [1, 0, 0]);
    });

    it("pads missing components with 0", () => {
        assert.deepEqual(parseMMP("5"), [5, 0, 0]);
        assert.deepEqual(parseMMP("5.1"), [5, 1, 0]);
    });

    it("returns NaN for leading non-numeric input (parseInt behavior)", () => {
        const [x, y, z] = parseMMP("not-a-version");
        assert.ok(Number.isNaN(x));
        assert.equal(y, 0);
        assert.equal(z, 0);
    });

    it("handles autover pre-release format", () => {
        assert.deepEqual(parseMMP("1.2.123456-abc1234"), [1, 2, 123456]);
    });
});

/* ------------------------------------------------------------------ */
/* versionTuple                                                        */
/* ------------------------------------------------------------------ */

describe("versionTuple", () => {
    it("splits dotted version into numbers", () => {
        assert.deepEqual(versionTuple("2.46.0"), [2, 46, 0]);
    });

    it("handles single-digit version", () => {
        assert.deepEqual(versionTuple("1.0.0"), [1, 0, 0]);
    });
});

/* ------------------------------------------------------------------ */
/* minutesSinceYearStart                                               */
/* ------------------------------------------------------------------ */

describe("minutesSinceYearStart", () => {
    it("returns 0 at midnight Jan 1 UTC", () => {
        const jan1 = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
        assert.equal(minutesSinceYearStart(jan1), 0);
    });

    it("returns 60 at 1:00 AM Jan 1 UTC", () => {
        const d = new Date(Date.UTC(2025, 0, 1, 1, 0, 0));
        assert.equal(minutesSinceYearStart(d), 60);
    });

    it("returns correct value for Feb 1 midnight UTC", () => {
        const d = new Date(Date.UTC(2025, 1, 1, 0, 0, 0));
        assert.equal(minutesSinceYearStart(d), 31 * 24 * 60);
    });

    it("floors partial minutes", () => {
        const d = new Date(Date.UTC(2025, 0, 1, 0, 1, 30));
        assert.equal(minutesSinceYearStart(d), 1);
    });
});

/* ------------------------------------------------------------------ */
/* isoZ                                                                */
/* ------------------------------------------------------------------ */

describe("isoZ", () => {
    it("formats date as ISO without milliseconds", () => {
        const d = new Date("2025-06-15T12:30:45.123Z");
        assert.equal(isoZ(d), "2025-06-15T12:30:45Z");
    });

    it("preserves Z suffix", () => {
        const result = isoZ(new Date("2025-01-01T00:00:00Z"));
        assert.ok(result.endsWith("Z"));
    });
});

/* ------------------------------------------------------------------ */
/* fromGitEpoch                                                        */
/* ------------------------------------------------------------------ */

describe("fromGitEpoch", () => {
    it("converts epoch seconds string to Date", () => {
        const d = fromGitEpoch("1700000000");
        assert.equal(d.getTime(), 1700000000000);
    });

    it("returns current-ish Date for null input", () => {
        const before = Date.now();
        const d = fromGitEpoch(null);
        const after = Date.now();
        assert.ok(d.getTime() >= before && d.getTime() <= after);
    });
});

/* ------------------------------------------------------------------ */
/* makeVersionBuild                                                    */
/* ------------------------------------------------------------------ */

describe("makeVersionBuild", () => {
    it("generates X.Y.Z+stamp.commitid format", () => {
        const pkg = { version: "1.2.3" };
        const [ver] = makeVersionBuild(pkg, "abc1234", "1735689600", null);
        assert.match(ver, /^1\.2\.3\+\d+\.abc1234$/);
    });

    it("applies patch override", () => {
        const pkg = { version: "1.2.3" };
        const [ver] = makeVersionBuild(pkg, "abc1234", "1735689600", 99);
        assert.match(ver, /^1\.2\.99\+\d+\.abc1234$/);
    });

    it("preserves major.minor from existing version", () => {
        const pkg = { version: "5.3.0" };
        const [ver] = makeVersionBuild(pkg, "def5678", "1735689600", null);
        assert.ok(ver.startsWith("5.3.0+"));
    });

    it("falls back to 1.0.0 when version is missing", () => {
        const pkg = {};
        const [ver] = makeVersionBuild(pkg, "aaa1111", "1735689600", null);
        assert.ok(ver.startsWith("1.0.0+"));
    });

    it("returns a Date as second element", () => {
        const pkg = { version: "1.0.0" };
        const [, dt] = makeVersionBuild(pkg, "abc1234", "1735689600", null);
        assert.ok(dt instanceof Date);
        assert.equal(dt.getTime(), 1735689600000);
    });
});

/* ------------------------------------------------------------------ */
/* makeVersionPre                                                      */
/* ------------------------------------------------------------------ */

describe("makeVersionPre", () => {
    it("generates X.Y.stamp-commitid format", () => {
        const pkg = { version: "2.1.0" };
        const [ver] = makeVersionPre(pkg, "abc1234", "1735689600");
        assert.match(ver, /^2\.1\.\d+-abc1234$/);
    });

    it("drops patch from original version", () => {
        const pkg = { version: "3.5.99" };
        const [ver] = makeVersionPre(pkg, "xyz9999", "1735689600");
        assert.ok(ver.startsWith("3.5."));
        assert.ok(!ver.startsWith("3.5.99"));
    });

    it("falls back to 1.0 when version is missing", () => {
        const pkg = {};
        const [ver] = makeVersionPre(pkg, "aaa1111", "1735689600");
        assert.ok(ver.startsWith("1.0."));
    });
});

/* ------------------------------------------------------------------ */
/* parseArgs                                                           */
/* ------------------------------------------------------------------ */

describe("parseArgs", () => {
    it("returns empty object for no args", () => {
        assert.deepEqual(parseArgs([]), {});
    });

    it("parses --help / -h", () => {
        assert.equal(parseArgs(["--help"]).help, true);
        assert.equal(parseArgs(["-h"]).help, true);
    });

    it("parses --version / -V", () => {
        assert.equal(parseArgs(["--version"]).version, true);
        assert.equal(parseArgs(["-V"]).version, true);
    });

    it("parses --init and --install", () => {
        assert.equal(parseArgs(["--init"]).init, true);
        assert.equal(parseArgs(["--install"]).install, true);
    });

    it("parses --file / -f with value", () => {
        assert.equal(parseArgs(["--file", "pkg.json"]).file, "pkg.json");
        assert.equal(parseArgs(["-f", "other.json"]).file, "other.json");
    });

    it("parses boolean flags", () => {
        assert.equal(parseArgs(["--workspaces"]).workspaces, true);
        assert.equal(parseArgs(["--no-amend"]).noAmend, true);
        assert.equal(parseArgs(["--dry-run"]).dryRun, true);
        assert.equal(parseArgs(["--verbose"]).verbose, true);
        assert.equal(parseArgs(["-v"]).verbose, true);
        assert.equal(parseArgs(["--quiet"]).quiet, true);
        assert.equal(parseArgs(["-q"]).quiet, true);
        assert.equal(parseArgs(["--short"]).short, true);
        assert.equal(parseArgs(["--guard-unchanged"]).guardUnchanged, true);
    });

    it("parses --format with value", () => {
        assert.equal(parseArgs(["--format", "pre"]).format, "pre");
        assert.equal(parseArgs(["--format", "BUILD"]).format, "build");
    });

    it("parses --patch with integer", () => {
        assert.equal(parseArgs(["--patch", "5"]).patch, 5);
    });

    it("handles multiple flags together", () => {
        const out = parseArgs(["--workspaces", "--dry-run", "--short", "--format", "pre"]);
        assert.equal(out.workspaces, true);
        assert.equal(out.dryRun, true);
        assert.equal(out.short, true);
        assert.equal(out.format, "pre");
    });

    it("exits on unknown arg", () => {
        const original = process.exit;
        let exitCode = null;
        process.exit = (code) => {
            exitCode = code;
            throw new Error("exit");
        };
        try {
            assert.throws(() => parseArgs(["--bogus"]), /exit/);
            assert.equal(exitCode, 2);
        } finally {
            process.exit = original;
        }
    });

    it("exits on non-numeric --patch", () => {
        const original = process.exit;
        let exitCode = null;
        process.exit = (code) => {
            exitCode = code;
            throw new Error("exit");
        };
        try {
            assert.throws(() => parseArgs(["--patch", "abc"]), /exit/);
            assert.equal(exitCode, 2);
        } finally {
            process.exit = original;
        }
    });

    it("exits on invalid --format", () => {
        const original = process.exit;
        let exitCode = null;
        process.exit = (code) => {
            exitCode = code;
            throw new Error("exit");
        };
        try {
            assert.throws(() => parseArgs(["--format", "foo"]), /exit/);
            assert.equal(exitCode, 2);
        } finally {
            process.exit = original;
        }
    });

    it("exits on negative --patch", () => {
        const original = process.exit;
        let exitCode = null;
        process.exit = (code) => {
            exitCode = code;
            throw new Error("exit");
        };
        try {
            assert.throws(() => parseArgs(["--patch", "-1"]), /exit/);
            assert.equal(exitCode, 2);
        } finally {
            process.exit = original;
        }
    });

    it("exits on float --patch", () => {
        const original = process.exit;
        let exitCode = null;
        process.exit = (code) => {
            exitCode = code;
            throw new Error("exit");
        };
        try {
            assert.throws(() => parseArgs(["--patch", "1.5"]), /exit/);
            assert.equal(exitCode, 2);
        } finally {
            process.exit = original;
        }
    });
});
