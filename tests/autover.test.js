import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
    parseMMP,
    makeVersionBuild,
    makeVersionPre,
    minutesSinceYearStart,
    parseArgs,
    versionTuple,
    isoZ,
    fromGitEpoch,
    shortCommitId,
    expandWorkspaceGlobs,
} from "../bin/autover.js";

/* ------------------------------------------------------------------ */
/* shortCommitId                                                       */
/* ------------------------------------------------------------------ */

describe("shortCommitId", () => {
    it("returns the raw SHA when a tagged ancestor and dirty files exist", (t) => {
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), "autover-sha-"));
        t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

        const git = (...args) => {
            const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
            assert.equal(result.status, 0, result.stderr);
            return result.stdout.trim();
        };

        git("init", "--quiet");
        git("config", "user.name", "Autover Test");
        git("config", "user.email", "autover@example.test");
        git("config", "commit.gpgsign", "false");
        git("config", "tag.gpgsign", "false");
        git("config", "core.hooksPath", path.join(repo, ".no-hooks"));

        const fixture = path.join(repo, "fixture.txt");
        fs.writeFileSync(fixture, "tagged\n", "utf8");
        git("add", "fixture.txt");
        git("commit", "--quiet", "-m", "tagged base");
        git("tag", "-a", "v1.5.1", "-m", "v1.5.1");

        fs.appendFileSync(fixture, "committed\n", "utf8");
        git("add", "fixture.txt");
        git("commit", "--quiet", "-m", "later commit");
        fs.appendFileSync(fixture, "dirty\n", "utf8");

        const described = git("describe", "--always", "--dirty", "--abbrev=7");
        const expected = git("rev-parse", "--short=7", "HEAD");
        const actual = shortCommitId(repo);

        assert.match(described, /^v1\.5\.1-1-g[0-9a-f]+-dirty$/u);
        assert.equal(actual, expected);
        assert.match(actual, /^[0-9a-f]{7,}$/u);
        assert.doesNotMatch(actual, /^v1\.5\.1-/u);
    });
});

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

    it("rejects invalid semantic versions", () => {
        assert.throws(() => parseMMP("not-a-version"), /invalid semantic version/u);
        assert.throws(() => parseMMP("01.2.3"), /invalid semantic version/u);
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
    it("generates timestamp-only build metadata by default", () => {
        const pkg = { version: "1.2.3" };
        const [ver] = makeVersionBuild(pkg, "abc1234", "1735689600", null);
        assert.match(ver, /^1\.2\.3\+\d+$/u);
    });

    it("can omit the commit id from build metadata", () => {
        const pkg = { version: "1.2.3" };
        const [ver] = makeVersionBuild(pkg, "abc1234", "1735689600", null, "timestamp");
        assert.match(ver, /^1\.2\.3\+\d+$/u);
        assert.doesNotMatch(ver, /abc1234/u);
    });

    it("applies patch override", () => {
        const pkg = { version: "1.2.3" };
        const [ver] = makeVersionBuild(pkg, "abc1234", "1735689600", 99, "timestamp-sha");
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
        assert.equal(parseArgs(["--recursive"]).recursive, true);
        assert.equal(parseArgs(["--no-amend"]).noAmend, true);
        assert.equal(parseArgs(["--separate-commit"]).separateCommit, true);
        assert.equal(parseArgs(["--no-skip-ci"]).skipOnCI, false);
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

    it("parses --metadata with value", () => {
        assert.equal(parseArgs(["--metadata", "timestamp"]).metadata, "timestamp");
        assert.equal(parseArgs(["--metadata", "TIMESTAMP-SHA"]).metadata, "timestamp-sha");
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

    it("rejects missing option values without consuming another flag", () => {
        const original = process.exit;
        let exitCode = null;
        process.exit = (code) => {
            exitCode = code;
            throw new Error("exit");
        };
        try {
            assert.throws(() => parseArgs(["--file", "--dry-run"]), /exit/u);
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

    it("exits on invalid --metadata", () => {
        const original = process.exit;
        let exitCode = null;
        process.exit = (code) => {
            exitCode = code;
            throw new Error("exit");
        };
        try {
            assert.throws(() => parseArgs(["--metadata", "sha"]), /exit/u);
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

/* ------------------------------------------------------------------ */
/* expandWorkspaceGlobs                                                */
/* ------------------------------------------------------------------ */

describe("expandWorkspaceGlobs", () => {
    const makeTree = (t, files) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "autover-glob-"));
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        for (const rel of files) {
            const abs = path.join(root, ...rel.split("/"));
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, "{}\n", "utf8");
        }
        return root;
    };

    const rel = (root, matches) => matches.map((m) => path.relative(root, m).replace(/\\/gu, "/"));

    it("expands * against direct children only", (t) => {
        const root = makeTree(t, [
            "packages/a/package.json",
            "packages/b/package.json",
            "packages/b/nested/package.json",
            "other/c/package.json",
        ]);
        const out = expandWorkspaceGlobs(["packages/*/package.json"], root);
        assert.deepEqual(rel(root, out), ["packages/a/package.json", "packages/b/package.json"]);
    });

    it("matches literal paths without wildcards", (t) => {
        const root = makeTree(t, ["apps/web/package.json"]);
        const out = expandWorkspaceGlobs(["apps/web/package.json"], root);
        assert.deepEqual(rel(root, out), ["apps/web/package.json"]);
    });

    it("returns an empty array when nothing matches", (t) => {
        const root = makeTree(t, ["packages/a/package.json"]);
        assert.deepEqual(expandWorkspaceGlobs(["missing/*/package.json"], root), []);
    });

    it("expands ** across zero or more directories", (t) => {
        const root = makeTree(t, [
            "package.json",
            "packages/a/package.json",
            "packages/deep/nested/b/package.json",
        ]);
        const out = expandWorkspaceGlobs(["**/package.json"], root);
        assert.deepEqual(rel(root, out), [
            "package.json",
            "packages/a/package.json",
            "packages/deep/nested/b/package.json",
        ]);
    });

    it("never descends into node_modules or .git via **", (t) => {
        const root = makeTree(t, [
            "packages/a/package.json",
            "packages/a/node_modules/dep/package.json",
            "node_modules/x/package.json",
        ]);
        fs.mkdirSync(path.join(root, ".git", "hooks"), { recursive: true });
        fs.writeFileSync(path.join(root, ".git", "hooks", "package.json"), "{}\n", "utf8");
        const out = expandWorkspaceGlobs(["**/package.json"], root);
        assert.deepEqual(rel(root, out), ["packages/a/package.json"]);
    });

    it("does not match dot-directories with wildcards", (t) => {
        const root = makeTree(t, [".hidden/package.json", "visible/package.json"]);
        const out = expandWorkspaceGlobs(["*/package.json"], root);
        assert.deepEqual(rel(root, out), ["visible/package.json"]);
    });

    it("matches dot-directories when named literally", (t) => {
        const root = makeTree(t, [".tools/package.json"]);
        const out = expandWorkspaceGlobs([".tools/package.json"], root);
        assert.deepEqual(rel(root, out), [".tools/package.json"]);
    });

    it("supports ? for exactly one character", (t) => {
        const root = makeTree(t, ["pkg1/package.json", "pkg22/package.json"]);
        const out = expandWorkspaceGlobs(["pkg?/package.json"], root);
        assert.deepEqual(rel(root, out), ["pkg1/package.json"]);
    });

    it("excludes matches via leading-! negation", (t) => {
        const root = makeTree(t, [
            "packages/a/package.json",
            "packages/b/package.json",
            "packages/legacy/package.json",
        ]);
        const out = expandWorkspaceGlobs(
            ["packages/*/package.json", "!packages/legacy/package.json"],
            root,
        );
        assert.deepEqual(rel(root, out), ["packages/a/package.json", "packages/b/package.json"]);
    });

    it("treats regex metacharacters in names literally", (t) => {
        const root = makeTree(t, ["pkg.one/package.json", "pkgXone/package.json"]);
        const out = expandWorkspaceGlobs(["pkg.one/package.json"], root);
        assert.deepEqual(rel(root, out), ["pkg.one/package.json"]);
    });

    it("normalizes ./ prefixes and deduplicates overlapping patterns", (t) => {
        const root = makeTree(t, ["packages/a/package.json"]);
        const out = expandWorkspaceGlobs(
            ["./packages/a/package.json", "packages/*/package.json"],
            root,
        );
        assert.deepEqual(rel(root, out), ["packages/a/package.json"]);
    });

    it("only matches regular files", (t) => {
        const root = makeTree(t, ["packages/a/package.json"]);
        fs.mkdirSync(path.join(root, "packages", "b", "package.json"), { recursive: true });
        const out = expandWorkspaceGlobs(["packages/*/package.json"], root);
        assert.deepEqual(rel(root, out), ["packages/a/package.json"]);
    });

    it("rejects unsupported glob syntax", () => {
        for (const pattern of [
            "packages/{a,b}/package.json",
            "packages/[ab]/package.json",
            "packages/+(a|b)/package.json",
            "packages\\a/package.json",
        ]) {
            assert.throws(() => expandWorkspaceGlobs([pattern], os.tmpdir()), {
                name: "TypeError",
                message: /unsupported workspace pattern/u,
            });
        }
    });

    it("rejects patterns that escape the repository root", () => {
        assert.throws(
            () => expandWorkspaceGlobs(["../outside/package.json"], os.tmpdir()),
            /must not escape/u,
        );
    });

    it("rejects absolute, empty, and non-string patterns", () => {
        assert.throws(() => expandWorkspaceGlobs(["/abs/package.json"], os.tmpdir()), /relative/u);
        assert.throws(() => expandWorkspaceGlobs(["."], os.tmpdir()), /empty workspace pattern/u);
        assert.throws(() => expandWorkspaceGlobs([42], os.tmpdir()), /must be a string/u);
    });

    it("returns sorted results regardless of pattern order", (t) => {
        const root = makeTree(t, ["b/package.json", "a/package.json", "c/package.json"]);
        const out = expandWorkspaceGlobs(
            ["c/package.json", "a/package.json", "b/package.json"],
            root,
        );
        assert.deepEqual(rel(root, out), ["a/package.json", "b/package.json", "c/package.json"]);
    });
});
