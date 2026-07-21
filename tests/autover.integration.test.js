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
        assert.match(result.stderr, /unsafe state/u);
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
