import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cli = path.resolve("bin/autover.js");

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
            env: { ...process.env, CI: "" },
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
        assert.match(result.stdout, /^autover \d+\.\d+\.\d+/u);
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
        fs.writeFileSync(
            path.join(repo, ".autoverrc.json"),
            `${JSON.stringify({ tagOnChange: true }, null, 4)}\n`,
        );
        const before = fs.readFileSync(path.join(repo, "package.json"), "utf8");
        const result = run("--dry-run", "--no-amend", "--short");
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.readFileSync(path.join(repo, "package.json"), "utf8"), before);
        assert.equal(git("tag", "--list"), "");
        assert.equal(fs.existsSync(path.join(repo, ".git", "autover.lock")), false);
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
            env: { ...process.env, CI: "" },
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

    it("preserves existing hooks and installs one idempotent managed block", (t) => {
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

    it("rejects an existing release tag before writing", (t) => {
        const { repo, git, run } = fixture(t);
        git("tag", "v1.0.0");
        fs.writeFileSync(
            path.join(repo, ".autoverrc.json"),
            `${JSON.stringify({ tagOnChange: true }, null, 4)}\n`,
        );
        const before = fs.readFileSync(path.join(repo, "package.json"), "utf8");
        const result = run();
        assert.equal(result.status, 1);
        assert.match(result.stderr, /tag v1\.0\.0 already exists/u);
        assert.equal(fs.readFileSync(path.join(repo, "package.json"), "utf8"), before);
    });

    it("rejects tag creation with no-amend mode", (t) => {
        const { repo, run } = fixture(t);
        fs.writeFileSync(
            path.join(repo, ".autoverrc.json"),
            `${JSON.stringify({ tagOnChange: true }, null, 4)}\n`,
        );
        const before = fs.readFileSync(path.join(repo, "package.json"), "utf8");
        const result = run("--no-amend");
        assert.equal(result.status, 2);
        assert.match(result.stderr, /tagOnChange cannot be used with --no-amend/u);
        assert.equal(fs.readFileSync(path.join(repo, "package.json"), "utf8"), before);
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
