import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const cli = path.resolve("bin/autover.js");
const packageVersion = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")).version;

function fixture(t, { workspaces = false } = {}) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "autover-integration-"));
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

    const rootPackage = {
        name: "fixture",
        version: "1.0.0",
        ...(workspaces ? { private: true, workspaces: ["packages/*"] } : {}),
    };
    const rootLock = {
        name: "fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: "fixture", version: "1.0.0" } },
    };
    if (workspaces) {
        for (const name of ["a", "b"]) {
            const dir = path.join(repo, "packages", name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, "package.json"),
                `${JSON.stringify({ name, version: "1.0.0" }, null, 4)}\n`,
            );
            fs.writeFileSync(path.join(dir, "source.js"), `export const name = "${name}";\n`);
            rootLock.packages[`packages/${name}`] = { name, version: "1.0.0" };
        }
    }
    fs.writeFileSync(path.join(repo, "package.json"), `${JSON.stringify(rootPackage, null, 4)}\n`);
    fs.writeFileSync(
        path.join(repo, "package-lock.json"),
        `${JSON.stringify(rootLock, null, 4)}\n`,
    );
    git("add", ".");
    git("commit", "--quiet", "-m", "initial");

    const run = (...args) =>
        spawnSync(process.execPath, [cli, ...args], {
            cwd: repo,
            encoding: "utf8",
            env: { ...process.env, AUTOVER_SKIP: "", CI: "" },
        });
    const json = (name) => JSON.parse(fs.readFileSync(path.join(repo, name), "utf8"));
    return { repo, git, run, json };
}

describe("autover Git integration", () => {
    it("runs directly through an installed path containing spaces", (t) => {
        const { repo } = fixture(t);
        const spacedDir = path.join(repo, "path with spaces");
        fs.mkdirSync(spacedDir);
        const linkedCli = path.join(spacedDir, "autover.js");
        fs.symlinkSync(cli, linkedCli);
        const result = spawnSync(process.execPath, [linkedCli, "--version"], {
            cwd: repo,
            encoding: "utf8",
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), `autover ${packageVersion}`);
    });

    it("supports explicit suppression for clean release commits", (t) => {
        const { repo } = fixture(t);
        const packagePath = path.join(repo, "package.json");
        const before = fs.readFileSync(packagePath, "utf8");
        const result = spawnSync(process.execPath, [cli], {
            cwd: repo,
            encoding: "utf8",
            env: { ...process.env, AUTOVER_SKIP: "1", CI: "" },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.readFileSync(packagePath, "utf8"), before);
    });

    it("uses convergent timestamp metadata by default", (t) => {
        const { git, run, json } = fixture(t);
        const first = run("--short");
        assert.equal(first.status, 0, first.stderr);
        assert.match(json("package.json").version, /^1\.0\.0\+\d+$/u);
        const head = git("rev-parse", "HEAD");

        const second = run("--short");
        assert.equal(second.status, 0, second.stderr);
        assert.equal(git("rev-parse", "HEAD"), head);
    });

    it("rejects SHA-bearing metadata in amend mode", (t) => {
        const { repo, run } = fixture(t);
        const before = fs.readFileSync(path.join(repo, "package.json"), "utf8");
        const result = run("--metadata", "timestamp-sha");
        assert.equal(result.status, 2);
        assert.match(result.stderr, /require --separate-commit or --no-amend/u);
        assert.equal(fs.readFileSync(path.join(repo, "package.json"), "utf8"), before);
    });

    it("allows dry-run previews of SHA-bearing metadata", (t) => {
        const { repo, run } = fixture(t);
        const before = fs.readFileSync(path.join(repo, "package.json"), "utf8");
        const result = run("--metadata", "timestamp-sha", "--dry-run", "--short");
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /1\.0\.0\+\d+\.[0-9a-f]+/u);
        assert.equal(fs.readFileSync(path.join(repo, "package.json"), "utf8"), before);
    });

    it("creates a non-recursive separate commit and synchronizes the npm lockfile", (t) => {
        const { git, run, json } = fixture(t);
        const triggeringSha = git("rev-parse", "--short=7", "HEAD");
        const result = run("--separate-commit", "--metadata", "timestamp-sha", "--short");

        assert.equal(result.status, 0, result.stderr);
        const version = json("package.json").version;
        assert.match(version, new RegExp(`^1\\.0\\.0\\+\\d+\\.${triggeringSha}$`, "u"));
        assert.equal(json("package-lock.json").version, version);
        assert.equal(json("package-lock.json").packages[""].version, version);
        assert.match(git("show", "-s", "--format=%B", "HEAD"), /^Autover-Version: true$/mu);
        assert.equal(git("rev-list", "--count", "HEAD"), "2");

        const recursive = run("--separate-commit", "--short");
        assert.equal(recursive.status, 0, recursive.stderr);
        assert.equal(git("rev-list", "--count", "HEAD"), "2");
    });

    it("supports timestamp-only metadata", (t) => {
        const { run, json } = fixture(t);
        const result = run("--no-amend", "--metadata", "timestamp");
        assert.equal(result.status, 0, result.stderr);
        assert.match(json("package.json").version, /^1\.0\.0\+\d+$/u);
    });

    it("uses triggering-commit paths for workspace selection", (t) => {
        const { repo, git, run, json } = fixture(t, { workspaces: true });
        fs.appendFileSync(
            path.join(repo, "packages", "a", "source.js"),
            "export const changed = true;\n",
        );
        git("add", "packages/a/source.js");
        git("commit", "--quiet", "-m", "change workspace a");

        const result = run("--workspaces", "--no-amend", "--metadata", "timestamp");
        assert.equal(result.status, 0, result.stderr);
        assert.match(json("packages/a/package.json").version, /^1\.0\.0\+\d+$/u);
        assert.equal(json("packages/b/package.json").version, "1.0.0");
        assert.equal(
            json("package-lock.json").packages["packages/a"].version,
            json("packages/a/package.json").version,
        );
    });

    it("updates multiple workspaces and their shared lockfile in one version commit", (t) => {
        const { repo, git, run, json } = fixture(t, { workspaces: true });
        for (const name of ["a", "b"]) {
            fs.appendFileSync(
                path.join(repo, "packages", name, "source.js"),
                `export const changed${name.toUpperCase()} = true;\n`,
            );
        }
        git("add", "packages/a/source.js", "packages/b/source.js");
        git("commit", "--quiet", "-m", "change both workspaces");
        const triggeringSha = git("rev-parse", "--short=7", "HEAD");

        const result = run(
            "--workspaces",
            "--separate-commit",
            "--metadata",
            "timestamp-sha",
            "--short",
        );

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /3 files updated/u);
        const lock = json("package-lock.json");
        for (const name of ["a", "b"]) {
            const version = json(`packages/${name}/package.json`).version;
            assert.match(version, new RegExp(`^1\\.0\\.0\\+\\d+\\.${triggeringSha}$`, "u"));
            assert.equal(lock.packages[`packages/${name}`].version, version);
        }
        assert.equal(git("rev-list", "--count", "HEAD"), "3");
    });

    it("does not recursively discover undeclared packages without opt-in", (t) => {
        const { repo, git, run, json } = fixture(t);
        const nested = path.join(repo, "fixtures", "nested");
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(
            path.join(nested, "package.json"),
            `${JSON.stringify({ name: "nested", version: "1.0.0" }, null, 4)}\n`,
        );
        fs.writeFileSync(path.join(nested, "source.js"), "export const changed = true;\n");
        git("add", "fixtures");
        git("commit", "--quiet", "-m", "add nested fixture");

        const result = run("--workspaces", "--no-amend");
        assert.equal(result.status, 0, result.stderr);
        assert.match(json("package.json").version, /^1\.0\.0\+\d+$/u);
        assert.equal(json("fixtures/nested/package.json").version, "1.0.0");
    });

    it("errors for a missing explicit manifest", (t) => {
        const { run } = fixture(t);
        const result = run("--file", "missing-package.json", "--no-amend");
        assert.equal(result.status, 2);
        assert.match(result.stderr, /package manifest not found/u);
    });

    it("does not write files or tags during dry-run", (t) => {
        const { repo, git, run } = fixture(t);
        const before = fs.readFileSync(path.join(repo, "package.json"), "utf8");
        const result = run("--dry-run", "--no-amend", "--short");
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /files would update/u);
        assert.doesNotMatch(result.stdout, /files updated/u);
        assert.equal(fs.readFileSync(path.join(repo, "package.json"), "utf8"), before);
        assert.equal(git("tag", "--list"), "");
        assert.equal(fs.existsSync(path.join(repo, ".git", "autover.lock")), false);
    });

    it("rejects the removed tagOnChange configuration key", (t) => {
        const { repo, run } = fixture(t);
        fs.writeFileSync(
            path.join(repo, ".autoverrc.json"),
            `${JSON.stringify({ tagOnChange: false }, null, 4)}\n`,
        );
        const result = run("--dry-run", "--no-amend");
        assert.equal(result.status, 2);
        assert.match(result.stderr, /unknown configuration key "tagOnChange"/u);
    });

    it("reports version drift as schema-versioned JSON without writing", (t) => {
        const { repo, run, json } = fixture(t);
        const packagePath = path.join(repo, "package.json");
        const before = fs.readFileSync(packagePath, "utf8");

        const drift = run("--check", "--json");
        assert.equal(drift.status, 3, drift.stderr);
        assert.equal(fs.readFileSync(packagePath, "utf8"), before);
        const result = JSON.parse(drift.stdout);
        assert.equal(result.schemaVersion, 1);
        assert.equal(result.mode, "check");
        assert.equal(result.outcome, "drift");
        assert.equal(result.applied, false);
        assert.deepEqual(result.files, ["package-lock.json", "package.json"]);
        assert.deepEqual(result.packages[0], {
            path: "package.json",
            from: "1.0.0",
            to: result.packages[0].to,
        });

        const apply = run("--no-amend", "--json");
        assert.equal(apply.status, 0, apply.stderr);
        const applied = JSON.parse(apply.stdout);
        assert.equal(applied.outcome, "updated");
        assert.equal(applied.applied, true);
        assert.match(json("package.json").version, /^1\.0\.0\+\d+$/u);
        const current = run("--check", "--json");
        assert.equal(current.status, 0, current.stderr);
        assert.equal(JSON.parse(current.stdout).outcome, "current");

        const lockPath = path.join(repo, "package-lock.json");
        const staleLock = json("package-lock.json");
        staleLock.packages[""].version = "0.0.0";
        fs.writeFileSync(lockPath, `${JSON.stringify(staleLock, null, 4)}\n`);
        const lockDrift = run("--check", "--json");
        assert.equal(lockDrift.status, 3, lockDrift.stderr);
        const lockResult = JSON.parse(lockDrift.stdout);
        assert.deepEqual(lockResult.files, ["package-lock.json"]);
        assert.deepEqual(lockResult.lockfiles, [
            {
                path: "package-lock.json",
                packages: [{ path: "package.json", version: applied.packages[0].to }],
            },
        ]);
    });

    it("rejects removed output booleans and invalid output modes", (t) => {
        const { repo, run } = fixture(t);
        fs.writeFileSync(
            path.join(repo, ".autoverrc.json"),
            `${JSON.stringify({ short: true }, null, 4)}\n`,
        );
        const removed = run("--dry-run", "--no-amend");
        assert.equal(removed.status, 2);
        assert.match(removed.stderr, /unknown configuration key "short"/u);

        fs.writeFileSync(
            path.join(repo, ".autoverrc.json"),
            `${JSON.stringify({ output: "loud" }, null, 4)}\n`,
        );
        const invalid = run("--dry-run", "--no-amend");
        assert.equal(invalid.status, 2);
        assert.match(invalid.stderr, /configuration key "output" must be one of/u);
    });

    it("lets a CLI output alias override the configured mode", (t) => {
        const { repo, run } = fixture(t);
        fs.writeFileSync(
            path.join(repo, ".autoverrc.json"),
            `${JSON.stringify({ output: "short" }, null, 4)}\n`,
        );
        const result = run("--dry-run", "--no-amend", "--json");
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).schemaVersion, 1);
    });

    it("rejects detached HEAD before writing", (t) => {
        const { repo, git, run } = fixture(t);
        git("checkout", "--quiet", "--detach");
        const before = fs.readFileSync(path.join(repo, "package.json"), "utf8");
        const result = run();
        assert.equal(result.status, 1);
        assert.match(result.stderr, /unsafe Git state/u);
        assert.equal(fs.readFileSync(path.join(repo, "package.json"), "utf8"), before);
    });

    it("rejects an in-progress Git operation before writing", (t) => {
        const { repo, git, run } = fixture(t);
        fs.writeFileSync(
            path.join(repo, ".git", "CHERRY_PICK_HEAD"),
            `${git("rev-parse", "HEAD")}\n`,
        );
        const before = fs.readFileSync(path.join(repo, "package.json"), "utf8");
        const result = run();
        assert.equal(result.status, 1);
        assert.match(result.stderr, /unsafe Git state/u);
        assert.equal(fs.readFileSync(path.join(repo, "package.json"), "utf8"), before);
    });

    it("rejects an occupied index without absorbing staged work", (t) => {
        const { repo, git, run } = fixture(t);
        fs.writeFileSync(path.join(repo, "unrelated.txt"), "unrelated\n", "utf8");
        git("add", "unrelated.txt");
        const before = fs.readFileSync(path.join(repo, "package.json"), "utf8");

        const result = run("--separate-commit");
        assert.equal(result.status, 1);
        assert.match(result.stderr, /index contains staged changes/u);
        assert.equal(fs.readFileSync(path.join(repo, "package.json"), "utf8"), before);
        assert.equal(git("diff", "--cached", "--name-only"), "unrelated.txt");
        assert.equal(git("rev-list", "--count", "HEAD"), "1");
    });

    it("rejects dirty generated targets", (t) => {
        const { repo, run } = fixture(t);
        const packagePath = path.join(repo, "package.json");
        fs.appendFileSync(packagePath, " \n", "utf8");
        const before = fs.readFileSync(packagePath, "utf8");
        const result = run();
        assert.equal(result.status, 1);
        assert.match(result.stderr, /generated target has uncommitted changes/u);
        assert.equal(fs.readFileSync(packagePath, "utf8"), before);
    });

    it("works from a linked Git worktree", (t) => {
        const { repo, git } = fixture(t);
        const linked = `${repo}-linked`;
        t.after(() => {
            spawnSync("git", ["worktree", "remove", "--force", linked], { cwd: repo });
            fs.rmSync(linked, { recursive: true, force: true });
        });
        git("worktree", "add", "--quiet", "-b", "linked-review", linked);
        const result = spawnSync(process.execPath, [cli, "--short"], {
            cwd: linked,
            encoding: "utf8",
            env: { ...process.env, AUTOVER_SKIP: "", CI: "" },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(
            JSON.parse(fs.readFileSync(path.join(linked, "package.json"), "utf8")).version,
            /^1\.0\.0\+\d+$/u,
        );
    });

    it("fails closed on malformed or mistyped configuration", (t) => {
        const { repo, run } = fixture(t);
        const packagePath = path.join(repo, "package.json");
        const before = fs.readFileSync(packagePath, "utf8");
        fs.writeFileSync(path.join(repo, ".autoverrc.json"), "{ invalid\n", "utf8");
        const malformed = run();
        assert.equal(malformed.status, 2);
        assert.equal(fs.readFileSync(packagePath, "utf8"), before);

        fs.writeFileSync(
            path.join(repo, ".autoverrc.json"),
            `${JSON.stringify({ skipOnCI: "false" }, null, 4)}\n`,
        );
        const mistyped = run();
        assert.equal(mistyped.status, 2);
        assert.match(mistyped.stderr, /skipOnCI.*boolean/u);
        assert.equal(fs.readFileSync(packagePath, "utf8"), before);
    });

    it("preserves manifest and lockfile modes", (t) => {
        const { repo, run } = fixture(t);
        const packagePath = path.join(repo, "package.json");
        const lockPath = path.join(repo, "package-lock.json");
        fs.chmodSync(packagePath, 0o640);
        fs.chmodSync(lockPath, 0o640);
        const result = run("--no-amend");
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.statSync(packagePath).mode & 0o777, 0o640);
        assert.equal(fs.statSync(lockPath).mode & 0o777, 0o640);
    });

    it("preserves JSON indentation and newline style", (t) => {
        const { repo, git, run } = fixture(t);
        const packagePath = path.join(repo, "package.json");
        const lockPath = path.join(repo, "package-lock.json");
        const packageData = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        const lockData = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        fs.writeFileSync(
            packagePath,
            `${JSON.stringify(packageData, null, 2).replace(/\n/gu, "\r\n")}\r\n`,
        );
        fs.writeFileSync(
            lockPath,
            `${JSON.stringify(lockData, null, 2).replace(/\n/gu, "\r\n")}\r\n`,
        );
        git("add", "package.json", "package-lock.json");
        git("commit", "--quiet", "-m", "use CRLF JSON");

        const result = run("--no-amend");
        assert.equal(result.status, 0, result.stderr);
        for (const target of [packagePath, lockPath]) {
            const content = fs.readFileSync(target, "utf8");
            assert.match(content, /\r\n {2}"/u);
            assert.doesNotMatch(content, /(^|[^\r])\n/u);
            assert.ok(content.endsWith("\r\n"));
        }
    });

    it("preserves existing hooks across managed install and uninstall", (t) => {
        const { repo, run } = fixture(t);
        const hooksDir = path.join(repo, ".custom-hooks");
        fs.mkdirSync(hooksDir);
        fs.writeFileSync(path.join(hooksDir, "post-commit"), "#!/bin/sh\necho existing\n", "utf8");
        spawnSync("git", ["config", "core.hooksPath", hooksDir], { cwd: repo });

        assert.equal(run("--install").status, 0);
        assert.equal(run("--install").status, 0);
        const hook = fs.readFileSync(path.join(hooksDir, "post-commit"), "utf8");
        assert.match(hook, /echo existing/u);
        assert.match(hook, /npx --no-install autover/u);
        assert.equal((hook.match(/>>> autover managed block >>>/gu) || []).length, 1);

        assert.equal(run("--uninstall").status, 0);
        const uninstalled = fs.readFileSync(path.join(hooksDir, "post-commit"), "utf8");
        assert.match(uninstalled, /echo existing/u);
        assert.doesNotMatch(uninstalled, /autover managed block/u);
        assert.equal(fs.existsSync(path.join(hooksDir, "post-commit.cmd")), false);
    });

    it("deletes hook files that autover can prove it created", (t) => {
        const { repo, git, run } = fixture(t);
        const hooksDir = path.join(repo, ".owned-hooks");
        git("config", "core.hooksPath", hooksDir);

        assert.equal(run("--install").status, 0);
        assert.equal(fs.existsSync(path.join(hooksDir, "post-commit")), true);
        assert.equal(fs.existsSync(path.join(hooksDir, "post-commit.cmd")), true);
        assert.equal(run("--uninstall").status, 0);
        assert.equal(fs.existsSync(path.join(hooksDir, "post-commit")), false);
        assert.equal(fs.existsSync(path.join(hooksDir, "post-commit.cmd")), false);
    });

    it("diagnoses active locks and refuses to remove them", (t) => {
        const { repo, git, run } = fixture(t);
        const lockFile = path.join(repo, ".git", "autover.lock");
        const canonicalRepo = git("rev-parse", "--show-toplevel");
        fs.writeFileSync(
            lockFile,
            `${JSON.stringify({
                schemaVersion: 1,
                ownerId: "active-test-owner",
                pid: process.pid,
                hostname: os.hostname(),
                createdAt: new Date().toISOString(),
                repoRoot: canonicalRepo,
            })}\n`,
            { mode: 0o600 },
        );

        const doctor = run("--doctor", "--json");
        assert.equal(doctor.status, 0, doctor.stderr);
        assert.equal(JSON.parse(doctor.stdout).lock.status, "active");
        const nested = run("--short");
        assert.equal(nested.status, 0, nested.stderr);
        assert.match(nested.stdout, /active lock present/u);
        const unlock = run("--unlock");
        assert.equal(unlock.status, 1);
        assert.match(unlock.stderr, /refusing to remove active lock/u);
        assert.equal(fs.existsSync(lockFile), true);
    });

    it("removes stale locks only after validating owner metadata", (t) => {
        const { repo, git, run } = fixture(t);
        const lockFile = path.join(repo, ".git", "autover.lock");
        const canonicalRepo = git("rev-parse", "--show-toplevel");
        fs.writeFileSync(
            lockFile,
            `${JSON.stringify({
                schemaVersion: 1,
                ownerId: "stale-test-owner",
                pid: 2_147_483_647,
                hostname: os.hostname(),
                createdAt: "2026-01-01T00:00:00.000Z",
                repoRoot: canonicalRepo,
            })}\n`,
            { mode: 0o600 },
        );

        const doctor = run("--doctor", "--json");
        assert.equal(doctor.status, 1);
        assert.equal(JSON.parse(doctor.stdout).lock.status, "stale");
        const unlock = run("--unlock", "--json");
        assert.equal(unlock.status, 0, unlock.stderr);
        assert.equal(JSON.parse(unlock.stdout).outcome, "removed");
        assert.equal(fs.existsSync(lockFile), false);
    });

    it("refuses to remove legacy locks without verifiable ownership", (t) => {
        const { repo, run } = fixture(t);
        const lockFile = path.join(repo, ".git", "autover.lock");
        fs.writeFileSync(lockFile, "2026-01-01T00:00:00.000Z\n", { mode: 0o600 });

        const doctor = run("--doctor", "--json");
        assert.equal(doctor.status, 1);
        assert.equal(JSON.parse(doctor.stdout).lock.status, "unknown");
        const unlock = run("--unlock");
        assert.equal(unlock.status, 1);
        assert.match(unlock.stderr, /refusing to remove unknown lock/u);
        assert.equal(fs.existsSync(lockFile), true);
    });

    it("restores files and index when a generated commit fails", (t) => {
        const { repo, git } = fixture(t);
        const packagePath = path.join(repo, "package.json");
        const lockPath = path.join(repo, "package-lock.json");
        const beforePackage = fs.readFileSync(packagePath);
        const beforeLock = fs.readFileSync(lockPath);
        const result = spawnSync(process.execPath, [cli, "--separate-commit"], {
            cwd: repo,
            encoding: "utf8",
            env: {
                ...process.env,
                AUTOVER_SKIP: "",
                CI: "",
                GIT_AUTHOR_NAME: "",
                GIT_AUTHOR_EMAIL: "",
                GIT_COMMITTER_NAME: "",
                GIT_COMMITTER_EMAIL: "",
            },
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /generated files restored/u);
        assert.deepEqual(fs.readFileSync(packagePath), beforePackage);
        assert.deepEqual(fs.readFileSync(lockPath), beforeLock);
        assert.equal(git("diff", "--cached", "--name-only"), "");
        assert.equal(git("rev-list", "--count", "HEAD"), "1");
    });

    it("preserves signed commits when amending", (t) => {
        const { repo, git, run } = fixture(t);
        const keyPath = path.join(repo, "signing-key");
        const keygen = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath], {
            encoding: "utf8",
        });
        assert.equal(keygen.status, 0, keygen.stderr);
        git("config", "gpg.format", "ssh");
        git("config", "user.signingkey", keyPath);
        git("config", "commit.gpgsign", "true");
        fs.writeFileSync(path.join(repo, "source.js"), "export const signed = true;\n", "utf8");
        git("add", "source.js");
        git("commit", "--quiet", "-S", "-m", "signed change");
        assert.match(git("cat-file", "-p", "HEAD"), /^gpgsig /mu);

        const result = run();
        assert.equal(result.status, 0, result.stderr);
        assert.match(git("cat-file", "-p", "HEAD"), /^gpgsig /mu);
    });

    it("signs separate version commits when the triggering commit is signed", (t) => {
        const { repo, git, run } = fixture(t);
        const keyPath = path.join(repo, "signing-key");
        const keygen = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath], {
            encoding: "utf8",
        });
        assert.equal(keygen.status, 0, keygen.stderr);
        git("config", "gpg.format", "ssh");
        git("config", "user.signingkey", keyPath);
        git("config", "commit.gpgsign", "true");
        fs.writeFileSync(path.join(repo, "source.js"), "export const signed = true;\n", "utf8");
        git("add", "source.js");
        git("commit", "--quiet", "-S", "-m", "signed change");
        assert.match(git("cat-file", "-p", "HEAD"), /^gpgsig /mu);

        git("config", "commit.gpgsign", "false");
        const result = run("--separate-commit", "--metadata", "timestamp-sha");

        assert.equal(result.status, 0, result.stderr);
        assert.match(git("show", "-s", "--format=%B", "HEAD"), /^Autover-Version: true$/mu);
        assert.match(git("cat-file", "-p", "HEAD"), /^gpgsig /mu);
    });

    it("validates lockfiles before writing package manifests", (t) => {
        const { repo, run } = fixture(t);
        const packagePath = path.join(repo, "package.json");
        const before = fs.readFileSync(packagePath, "utf8");
        fs.writeFileSync(path.join(repo, "package-lock.json"), "{ invalid json\n", "utf8");

        const result = run("--no-amend");
        assert.notEqual(result.status, 0);
        assert.equal(fs.readFileSync(packagePath, "utf8"), before);
    });
});
