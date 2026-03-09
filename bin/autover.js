#!/usr/bin/env node

/*
The MIT License (MIT)

Copyright (c) 2025-2026 Michael Welter <me@mikinho.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/**
 * Autover: strict SemVer versioner (build metadata by default) for Node projects.
 *
 * - Default: `X.Y.Z+<minutesSinceJan1UTC>.<gitsha>`
 * - Pre-release: `X.Y.<minutesSinceJan1UTC>-<gitsha>` (`--format pre`)
 * - Workspaces-aware (Yarn/NPM/PNPM), gated by staged changes when `--workspaces` is used.
 * - Safe amend (preserves author/message/dates) and reentrancy lock.
 *
 * @module autover
 * @main autover
 * @version 2.0.1
 * @since 2.0.0
 */

/**
 * autover: npx CLI — strict SemVer build-metadata versioner for Node projects.
 * Default: X.Y.Z+<minutesSinceJan1UTC>.<gitsha>
 * Pre:     X.Y.<minutesSinceJan1UTC>-<gitsha>  (--format pre)
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fg from "fast-glob";

const _require = createRequire(import.meta.url);
/** @const {string} SCRIPT_VERSION */
const SCRIPT_VERSION = _require("../package.json").version.split("+")[0];

/** @const {string} LOCKFILE_DEFAULT */
const LOCKFILE_DEFAULT = ".git/autover.lock";

/** @const {Object} defaultOptions */
const defaultOptions = {
    file: null,
    workspaces: false,
    noAmend: false,
    dryRun: false,
    verbose: false,
    quiet: false,
    short: false,
    format: "build",
    guardUnchanged: false,
    patch: null,
    init: false,
    install: false,
    version: false,
    help: false,
    lockPath: null,
};

/**
 * Run a Git command and return its trimmed stdout.
 *
 * @method runGit
 * @param {Array<String>} args Git CLI arguments.
 * @param {Object} [opts] Optional spawn options (cwd/env/etc).
 * @return {String|null} Output string or `null` on failure.
 */
function runGit(args, opts = {}) {
    const res = spawnSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        ...opts,
    });
    if (res.status !== 0) {
        return null;
    }
    return (res.stdout || "").trim();
}

/**
 * Get the installed Git version string.
 *
 * @method gitVersion
 * @return {String} Semantic version (e.g., "2.46.0") or "0.0.0" if unknown.
 */
function gitVersion() {
    const out = runGit(["--version"]);
    if (!out) {
        return "0.0.0";
    }
    const parts = out.split(/\s+/);
    return parts[2] || "0.0.0";
}

/**
 * Convert a "x.y.z" version into a numeric tuple.
 *
 * @method versionTuple
 * @param {String} v Version string.
 * @return {Array<Number>} Tuple of [major, minor, patch].
 */
function versionTuple(v) {
    return v.split(".").map((n) => parseInt(n, 10));
}

/**
 * Determine whether the current working directory is inside a Git repo.
 *
 * @method isGitRepo
 * @return {Boolean}
 */
function isGitRepo() {
    return runGit(["rev-parse", "--is-inside-work-tree"]) === "true";
}

/**
 * Return the absolute path to the repository top-level directory.
 *
 * @method gitTopDir
 * @return {String|null}
 */
function gitTopDir() {
    return runGit(["rev-parse", "--show-toplevel"]);
}

/**
 * Return the path to `.git` directory for the current repo.
 *
 * @method gitDir
 * @return {String|null}
 */
function gitDir() {
    return runGit(["rev-parse", "--git-dir"]);
}

/**
 * Describe the current commit (prefer tag+abbrev or short SHA).
 *
 * @method describeShort
 * @return {String|null}
 */
function describeShort() {
    return (
        runGit(["describe", "--always", "--dirty", "--abbrev=7"]) ||
        runGit(["rev-parse", "--short", "HEAD"])
    );
}

/**
 * Get the author date (ISO-8601) of HEAD.
 *
 * @method authorISO
 * @return {String} ISO 8601 timestamp (or empty string).
 */
function authorISO() {
    return runGit(["show", "-s", "--format=%aI"]) || "";
}

/**
 * Get the committer date (ISO-8601) of HEAD.
 *
 * @method committerISO
 * @return {String} ISO 8601 timestamp (or empty string).
 */
function committerISO() {
    return runGit(["show", "-s", "--format=%cI"]) || "";
}

/**
 * Get the author timestamp (epoch seconds) of HEAD.
 *
 * @method authorTS
 * @return {String|null} Seconds since epoch (string) or null.
 */
function authorTS() {
    return runGit(["show", "-s", "--format=%at"]);
} // seconds since epoch

/**
 * Return a list of staged file paths (relative to repo).
 *
 * @method stagedRelPaths
 * @param {String} repoRoot Absolute path to repo root.
 * @return {Array<String>}
 */
function stagedRelPaths(repoRoot) {
    const res = spawnSync("git", ["diff", "--name-only", "--cached"], {
        cwd: repoRoot,
        encoding: "utf8",
    });
    if (res.status !== 0) {
        return [];
    }
    return (res.stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Convert a Date to ISO-8601 string with Z suffix (no milliseconds).
 *
 * @method isoZ
 * @param {Date} date Date object.
 * @return {String} ISO string (e.g., "2025-01-02T03:04:05Z").
 */
function isoZ(date) {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Compute minutes since Jan 1 (UTC) for a given Date.
 *
 * @method minutesSinceYearStart
 * @param {Date} date Date in UTC context.
 * @return {Number} Whole minutes since Jan 1 UTC.
 */
function minutesSinceYearStart(date) {
    const y = date.getUTCFullYear();
    const jan1 = Date.UTC(y, 0, 1, 0, 0, 0);
    return Math.floor((date.getTime() - jan1) / 60000);
}

/**
 * Convert Git epoch-seconds string to Date (UTC).
 *
 * @method fromGitEpoch
 * @param {String|null} ts Seconds since epoch (string) or null.
 * @return {Date}
 */
function fromGitEpoch(ts) {
    if (!ts) {
        return new Date();
    }
    const ms = Number(ts) * 1000;
    return new Date(ms);
}

/**
 * Read and parse JSON from a file.
 *
 * @method readJSON
 * @async
 * @param {String} p Absolute path to JSON file.
 * @return {Object} Parsed JSON object.
 */
async function readJSON(p) {
    const raw = await fsp.readFile(p, "utf8");
    return JSON.parse(raw);
}

/**
 * Atomically write JSON to a file (preserves newline at EOF).
 *
 * @method atomicWriteJSON
 * @async
 * @param {String} p Absolute path to JSON file.
 * @param {Object} data JSON-serializable object.
 * @return {void}
 */
async function atomicWriteJSON(p, data) {
    const dir = path.dirname(p);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.autover.tmp.${process.pid}.${Date.now()}`);
    try {
        await fsp.writeFile(tmp, JSON.stringify(data, null, 4) + "\n", "utf8");
        await fsp.rename(tmp, p);
    } catch (e) {
        await fsp.unlink(tmp).catch(() => {});
        throw e;
    }
}

/**
 * Parse and normalize "X.Y.Z" from a version string.
 *
 * @method parseMMP
 * @param {String} v Version string (may include build/prerelease).
 * @param {String} [fallback="1.0.0"] Fallback version when parsing fails.
 * @return {Array<Number>} [major, minor, patch]
 */
function parseMMP(v, fallback = "1.0.0") {
    try {
        const core = v.split("+", 1)[0].split("-", 1)[0];
        const parts = core
            .split(".")
            .slice(0, 3)
            .map((x) => parseInt(x, 10));
        while (parts.length < 3) {
            parts.push(0);
        }
        return parts;
    } catch {
        return fallback.split(".").map((x) => parseInt(x, 10));
    }
}

/**
 * Build strict SemVer + build metadata version string.
 *
 * @method makeVersionBuild
 * @param {Object} pkg Parsed package.json object (expects `version`).
 * @param {String} commitid Short commit id (e.g., "abc1234").
 * @param {String|null} gitTs Author time (epoch seconds) or null.
 * @param {Number|null} patchOverride Optional patch override (forces Z).
 * @return {Array} [version:String, date:Date]
 */
function makeVersionBuild(pkg, commitid, gitTs, patchOverride) {
    const d = fromGitEpoch(gitTs);
    let [x, y, z] = parseMMP(String(pkg.version ?? "1.0.0"));
    if (Number.isInteger(patchOverride)) {
        z = patchOverride;
    }
    const stamp = minutesSinceYearStart(d);
    const ver = `${x}.${y}.${z}+${stamp}.${commitid}`;
    return [ver, d];
}

/**
 * Build prerelease-style version string.
 *
 * @method makeVersionPre
 * @param {Object} pkg Parsed package.json object (expects `version`).
 * @param {String} commitid Short commit id (e.g., "abc1234").
 * @param {String|null} gitTs Author time (epoch seconds) or null.
 * @return {Array} [version:String, date:Date]
 */
function makeVersionPre(pkg, commitid, gitTs) {
    const d = fromGitEpoch(gitTs);
    const [x, y] = parseMMP(String(pkg.version ?? "1.0.0"));
    const stamp = minutesSinceYearStart(d);
    const ver = `${x}.${y}.${stamp}-${commitid}`;
    return [ver, d];
}

/**
 * Determine if it's safe to amend the last commit.
 * Guards against detached HEAD and merge/rebase in progress.
 *
 * @method safeToAmend
 * @param {String} repoRoot Repo root directory.
 * @return {Boolean}
 */
function safeToAmend(repoRoot) {
    const branch = runGit(["symbolic-ref", "-q", "--short", "HEAD"]);
    if (!branch) {
        return false;
    }
    const gdir = gitDir() || path.join(repoRoot, ".git");
    if (fs.existsSync(path.join(gdir, "MERGE_HEAD"))) {
        return false;
    }
    if (
        fs.existsSync(path.join(gdir, "rebase-merge")) ||
        fs.existsSync(path.join(gdir, "rebase-apply"))
    ) {
        return false;
    }
    return true;
}

/**
 * Resolve effective lock file path.
 *
 * @method lockPath
 * @param {String|null} custom Custom lock path or null.
 * @return {String}
 */
function lockPath(custom) {
    return custom || LOCKFILE_DEFAULT;
}

/**
 * Atomically create a reentrancy lock file.
 * Returns true if the lock was acquired, false if it already existed.
 *
 * @method acquireLock
 * @param {String} p Path to lock file.
 * @return {Boolean}
 */
function acquireLock(p) {
    try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, new Date().toISOString(), { flag: "wx" });
        return true;
    } catch (e) {
        if (e.code === "EEXIST") {
            return false;
        }
        throw e;
    }
}

/**
 * Remove the reentrancy lock (ignore errors).
 *
 * @method removeLock
 * @async
 * @param {String} p Path to lock file.
 * @return {void}
 */
async function removeLock(p) {
    try {
        await fsp.unlink(p);
    } catch {
        // do nothing
    }
}

/**
 * Return whether a file is already staged (to avoid clobbering).
 *
 * @method isStagedFile
 * @param {String} repoRoot Repo root.
 * @param {String} absPath Absolute file path.
 * @return {Boolean}
 */
function isStagedFile(repoRoot, absPath) {
    const rel = path.relative(repoRoot, absPath).replace(/\\/g, "/");
    const res = spawnSync("git", ["diff", "--name-only", "--cached", "--", rel], {
        cwd: repoRoot,
        encoding: "utf8",
    });
    if (res.status !== 0) {
        return false;
    }
    const out = (res.stdout || "").split(/\r?\n/).filter(Boolean);
    return out.includes(rel);
}

/**
 * Detect workspace package.json files from root `package.json` workspaces definition.
 *
 * @method detectWorkspaceFiles
 * @async
 * @param {String} repoRoot Repo root.
 * @return {Set<String>|null} Set of absolute package.json paths, empty Set, or null if not defined.
 */
async function detectWorkspaceFiles(repoRoot) {
    const rootPkg = path.join(repoRoot, "package.json");
    if (!fs.existsSync(rootPkg)) {
        return null;
    }
    let data;
    try {
        data = JSON.parse(await fsp.readFile(rootPkg, "utf8"));
    } catch (e) {
        console.warn(`autover: Failed to parse ${rootPkg}: ${e.message}`);
        return null;
    }
    const ws = data.workspaces;
    if (!ws) {
        return null;
    }
    let patterns = [];
    if (Array.isArray(ws)) {
        patterns = ws;
    } else if (ws && Array.isArray(ws.packages)) {
        patterns = ws.packages;
    }
    if (!patterns.length) {
        return new Set();
    }
    const matches = await fg(
        patterns.map((p) => (p.endsWith("package.json") ? p : path.posix.join(p, "package.json"))),
        { cwd: repoRoot, dot: false, onlyFiles: true },
    );
    const abs = matches.map((m) => path.resolve(repoRoot, m));
    return new Set(abs);
}

/**
 * Recursively find `package.json` files (excluding `.git`/`node_modules`).
 *
 * @method recursivePackageJsons
 * @param {String} repoRoot Repo root.
 * @return {Generator<String>} Yields absolute package.json paths.
 */
function* recursivePackageJsons(repoRoot) {
    const skip = new Set(["node_modules", ".git"]);
    const stack = [repoRoot];
    while (stack.length) {
        const dir = stack.pop();
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        let hasPJ = false;
        for (const e of entries) {
            if (e.isFile() && e.name === "package.json") {
                yield path.join(dir, "package.json");
                hasPJ = true;
            }
        }
        // Stop recursing once a package.json is found — each package
        // owns its own subtree (nested node_modules, fixtures, etc.).
        if (hasPJ) {
            continue;
        }
        for (const e of entries) {
            if (!e.isDirectory()) {
                continue;
            }
            if (skip.has(e.name)) {
                continue;
            }
            stack.push(path.join(dir, e.name));
        }
    }
}

/**
 * Check if any staged file resides under the workspace directory of a given package.json.
 *
 * @method subtreeHasStaged
 * @param {String} packageJsonPath Absolute path to a `package.json`.
 * @param {Array<String>} stagedAbs Absolute staged file paths.
 * @return {Boolean}
 */
function subtreeHasStaged(packageJsonPath, stagedAbs) {
    const workspaceDir = path.dirname(packageJsonPath);
    for (const f of stagedAbs) {
        try {
            const rel = path.relative(workspaceDir, f);
            if (!rel.startsWith("..")) {
                return true;
            }
        } catch {
            continue;
        }
    }
    return false;
}

/**
 * Load `.autoverrc.json` if present.
 *
 * @method loadConfig
 * @async
 * @param {String} repoRoot Repo root.
 * @return {Object} Parsed config or empty object.
 */
async function loadConfig(repoRoot) {
    const p = path.join(repoRoot, ".autoverrc.json");
    if (!fs.existsSync(p)) {
        return {};
    }
    try {
        return JSON.parse(await fsp.readFile(p, "utf8"));
    } catch (e) {
        console.warn(`autover: .autoverrc.json unreadable: ${e}`);
        return {};
    }
}

/**
 * Initialize a default `.autoverrc.json` if none exists.
 *
 * @method doInit
 * @async
 * @param {String} repoRoot Repo root.
 * @return {void}
 */
async function doInit(repoRoot) {
    const p = path.join(repoRoot, ".autoverrc.json");
    if (fs.existsSync(p)) {
        console.log("autover: .autoverrc.json already exists (skipped).");
        return;
    }
    const body = {
        format: "build",
        workspaces: true,
        guardUnchanged: true,
        skipOnCI: true,
        short: true,
        quiet: false,
        rootAlso: true,
        tagOnChange: false,
        lockPath: ".git/autover.lock",
        patch: null,
        verbose: false,
    };
    await fsp.writeFile(p, JSON.stringify(body, null, 4) + "\n", "utf8");
    console.log("autover: wrote .autoverrc.json");
}

/**
 * Install POSIX and Windows post-commit hooks that invoke `npx autover`.
 *
 * @method doInstall
 * @async
 * @param {String} repoRoot Repo root.
 * @return {void}
 */
async function doInstall(repoRoot) {
    const customHooksPath = runGit(["config", "--get", "core.hooksPath"]);
    const gdir = gitDir() || path.join(repoRoot, ".git");
    const hooksDir = customHooksPath
        ? path.resolve(repoRoot, customHooksPath)
        : path.join(gdir, "hooks");
    await fsp.mkdir(hooksDir, { recursive: true });
    const posixHookPath = path.join(hooksDir, "post-commit");
    const windowsHookPath = path.join(hooksDir, "post-commit.cmd");
    const posixHook = `#!/usr/bin/env bash
# post-commit: run autover across workspaces with guard and concise output
if command -v npx >/dev/null 2>&1; then
    npx autover
else
    echo "⚠️ npx not found. Install Node.js/npm to use autover."
fi
`;
    const windowsHook = `@echo off
REM post-commit: run autover across workspaces with guard and concise output
where npx >nul 2>nul
IF ERRORLEVEL 1 (
    echo npx not found. Install Node.js/npm to use autover.
    EXIT /B 0
)
npx autover
`;
    for (const hp of [posixHookPath, windowsHookPath]) {
        if (fs.existsSync(hp)) {
            console.warn(`autover: overwriting existing hook: ${hp}`);
        }
    }
    await fsp.writeFile(posixHookPath, posixHook, "utf8");
    await fsp.chmod(posixHookPath, 0o755);
    await fsp.writeFile(windowsHookPath, windowsHook, "utf8");
    console.log(`autover: installed hooks:\n  ${posixHookPath}\n  ${windowsHookPath}`);
    console.log("autover: hooks run bare `npx autover`; use .autoverrc.json for custom settings.");
}

/**
 * Stage files and amend the most recent commit (preserving author/message/dates).
 * Uses a lock file to avoid recursive hook loops.
 *
 * @method stageAndAmend
 * @async
 * @param {Array<String>} filesToAdd Absolute file paths to stage.
 * @param {Object} opts Options.
 * @param {Boolean} opts.verbose Verbose logging.
 * @return {void}
 */
async function stageAndAmend(filesToAdd, { verbose }) {
    if (!filesToAdd.length) {
        if (verbose) {
            console.log("autover: nothing to amend (no version changes).");
        }
        return;
    }
    for (const f of filesToAdd) {
        const res = spawnSync("git", ["add", "--", f], { encoding: "utf8" });
        if (res.status !== 0) {
            console.error(`autover: git add failed for ${f}`);
            process.exit(1);
        }
    }
    const env = { ...process.env };
    const aISO = authorISO();
    const cISO = committerISO();
    if (cISO) {
        env.GIT_COMMITTER_DATE = cISO;
    }
    const args = ["commit", "--amend", "--no-edit", "--no-verify"];
    if (aISO) {
        args.push(`--date=${aISO}`);
    }
    const res = spawnSync("git", args, { encoding: "utf8", env });
    if (res.status !== 0) {
        console.error("autover: git commit --amend failed.");
        process.exit(1);
    }
}

/**
 * Optionally create/update a lightweight tag like `vX.Y.Z` when changes occur.
 *
 * @method maybeTag
 * @param {Boolean} tagOnChange Whether to tag.
 * @param {String} version Version string (build or pre-release).
 * @param {Boolean} changed True if files changed.
 * @param {Boolean} verbose Verbose logging.
 * @return {void}
 */
function maybeTag(tagOnChange, version, changed, verbose) {
    if (!tagOnChange || !changed) {
        return;
    }
    const core = version.split("+", 1)[0].split("-", 1)[0];
    const tag = `v${core}`;
    const res = spawnSync("git", ["tag", "-f", tag], { encoding: "utf8" });
    if (res.status === 0 && verbose) {
        console.log(`autover: tagged ${tag}`);
    }
}

/**
 * Parse CLI arguments into a normalized options object.
 *
 * @method parseArgs
 * @param {Array<String>} argv Raw CLI args (excluding node and script path).
 * @return {Object} Options object with flags and values.
 */
function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === "-h" || a === "--help") {
            out.help = true;
        } else if (a === "-V" || a === "--version") {
            out.version = true;
        } else if (a === "--init") {
            out.init = true;
        } else if (a === "--install") {
            out.install = true;
        } else if ((a === "-f" || a === "--file") && i + 1 < argv.length) {
            out.file = argv[++i];
        } else if (a === "--workspaces") {
            out.workspaces = true;
        } else if (a === "--no-amend") {
            out.noAmend = true;
        } else if (a === "--dry-run") {
            out.dryRun = true;
        } else if (a === "-v" || a === "--verbose") {
            out.verbose = true;
        } else if (a === "-q" || a === "--quiet") {
            out.quiet = true;
        } else if (a === "--short") {
            out.short = true;
        } else if (a === "--format" && i + 1 < argv.length) {
            const fmt = argv[++i].toLowerCase();
            if (fmt !== "build" && fmt !== "pre") {
                console.error(`--format must be "build" or "pre", got "${fmt}"`);
                process.exit(2);
            }
            out.format = fmt;
        } else if (a === "--guard-unchanged") {
            out.guardUnchanged = true;
        } else if (a === "--patch" && i + 1 < argv.length) {
            const n = Number(argv[++i]);
            if (!Number.isInteger(n)) {
                console.error("--patch requires an integer");
                process.exit(2);
            }
            out.patch = n;
        } else {
            console.error(`Unknown arg: ${a}`);
            process.exit(2);
        }
    }
    return out;
}

/**
 * Print short CLI help to stdout.
 *
 * @method printHelp
 * @return {void}
 */
function printHelp() {
    console.log(
        [
            "autover: strict SemVer versioner (npx).",
            "",
            "Usage:",
            "  npx autover [--file PATH | --workspaces]",
            "               [--format build|pre] [--patch N]",
            "               [--guard-unchanged] [--no-amend] [--dry-run]",
            "               [--verbose] [--quiet] [--short] [--init] [--install]",
            "",
            "Examples:",
            "  npx autover",
            "  npx autover --install",
        ].join("\n"),
    );
}

/* ------------------------------------------------------------------------ */
/* Entry Point                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Program entry point (IIFE). Orchestrates config, targets, versioning, and amend.
 *
 * @method main
 * @private
 */
export {
    parseMMP,
    makeVersionBuild,
    makeVersionPre,
    minutesSinceYearStart,
    parseArgs,
    versionTuple,
    isoZ,
    fromGitEpoch,
};

let _isDirectRun = false;
try {
    _isDirectRun =
        process.argv[1] &&
        fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);
} catch {
    // Not run directly (e.g., node -e, piped stdin, missing path).
}

if (_isDirectRun)
(async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }
    if (args.version) {
        console.log(`autover ${SCRIPT_VERSION}`);
        return;
    }

    const gv = gitVersion();
    const [g1, g2, g3] = versionTuple(gv);
    const ok = g1 > 1 || (g1 === 1 && (g2 > 8 || (g2 === 8 && g3 >= 2))); // >= 1.8.2
    if (!ok) {
        console.error("1.8.2 or newer is required");
        process.exit(1);
    }
    if (!isGitRepo()) {
        console.error("Not inside a git repository.");
        process.exit(1);
    }

    const repoRoot = gitTopDir();
    if (!repoRoot) {
        console.error("Unable to resolve repository root.");
        process.exit(1);
    }

    if (args.init) {
        await doInit(repoRoot);
        return;
    }
    if (args.install) {
        await doInstall(repoRoot);
        return;
    }

    // Command Line Arguments > Config File Arguments > Default Option
    const configOptions = await loadConfig(repoRoot);

    const knownConfigKeys = new Set([
        ...Object.keys(defaultOptions),
        "rootAlso",
        "skipOnCI",
        "tagOnChange",
    ]);
    for (const key of Object.keys(configOptions)) {
        if (!knownConfigKeys.has(key)) {
            console.warn(`autover: unknown config key "${key}" in .autoverrc.json`);
        }
    }

    const cfg = { ...defaultOptions, ...configOptions, ...args };

    // Global reentrancy guard (atomic: O_CREAT|O_EXCL)
    const lk = lockPath(cfg.lockPath);
    if (!acquireLock(lk)) {
        if (!cfg.quiet && (cfg.short || cfg.verbose)) {
            console.log("autover: lock present; exiting.");
        }
        return;
    }
    try {
        // cfg already has CLI > config > defaults via spread order above;
        // normalize the values we need going forward.
        cfg.format = String(cfg.format).toLowerCase();
        cfg.workspaces = Boolean(cfg.workspaces);
        cfg.guardUnchanged = Boolean(cfg.guardUnchanged);
        cfg.quiet = Boolean(cfg.quiet);

        const rootAlso = Boolean(cfg.rootAlso);
        const skipOnCI = Boolean(cfg.skipOnCI);
        const tagOnChange = Boolean(cfg.tagOnChange);

        if (cfg.patch != null && !Number.isInteger(cfg.patch)) {
            const n = Number(cfg.patch);
            cfg.patch = Number.isNaN(n) ? null : n;
        }
        if (skipOnCI && process.env.CI) {
            if (!cfg.quiet && (cfg.verbose || cfg.short)) {
                console.log("autover: CI detected and skipOnCI=true; exiting.");
            }
            return;
        }

        // targets
        let targets = [];
        if (cfg.workspaces) {
            const ws = await detectWorkspaceFiles(repoRoot);
            if (ws === null) {
                targets = Array.from(recursivePackageJsons(repoRoot));
            } else {
                targets = Array.from(ws);
                if (rootAlso || targets.length === 0) {
                    const rootPkg = path.join(repoRoot, "package.json");
                    if (fs.existsSync(rootPkg)) {
                        targets.push(rootPkg);
                    }
                }
            }
        } else {
            targets = [cfg.file ? path.resolve(cfg.file) : path.join(repoRoot, "package.json")];
        }
        targets = Array.from(new Set(targets.filter((p) => fs.existsSync(p))));

        // staged gating for workspaces
        let stagedAbs = [];
        if (cfg.workspaces) {
            const rels = stagedRelPaths(repoRoot);
            stagedAbs = rels.map((r) => path.resolve(repoRoot, r));
            targets = targets.filter((pj) => subtreeHasStaged(pj, stagedAbs));
        }

        if (cfg.format === "pre" && cfg.patch != null) {
            console.error("autover: --patch is not supported with --format pre");
            process.exit(2);
        }

        const commitid = describeShort() || "unknown";
        const gitTs = authorTS();

        const changedFiles = [];
        let lastDate = null;
        let firstChangedVersion = null;

        for (const pj of targets) {
            let pkg;
            try {
                pkg = await readJSON(pj);
            } catch (e) {
                if (cfg.verbose) {
                    console.error(`autover: skip unreadable ${pj}: ${e}`);
                }
                continue;
            }

            const [newVer, dt] =
                cfg.format === "pre"
                    ? makeVersionPre(pkg, commitid, gitTs)
                    : makeVersionBuild(pkg, commitid, gitTs, cfg.patch);

            lastDate = dt;
            const oldVer = String(pkg.version ?? "");

            if (cfg.verbose) {
                const rel = path.relative(repoRoot, pj).replace(/\\/g, "/");
                console.log(`[${rel}] ${oldVer} -> ${newVer}`);
            }

            if (oldVer === newVer) {
                continue;
            }
            if (isStagedFile(repoRoot, pj)) {
                if (cfg.verbose) {
                    console.log(`autover: ${pj} already staged; skipping write.`);
                }
                continue;
            }

            if (cfg.dryRun) {
                changedFiles.push(pj);
                if (!firstChangedVersion) {
                    firstChangedVersion = newVer;
                }
            } else {
                pkg.version = newVer;
                await atomicWriteJSON(pj, pkg);
                changedFiles.push(pj);
                if (!firstChangedVersion) {
                    firstChangedVersion = newVer;
                }
            }
        }

        if (cfg.guardUnchanged && changedFiles.length === 0) {
            if (!cfg.quiet) {
                const ts = isoZ(lastDate || new Date());
                if (cfg.short) {
                    console.log(`autover: 0 files updated | unchanged | ${ts}`);
                } else if (cfg.verbose) {
                    console.log(
                        "autover: guard active and no version changes; exiting without amend.",
                    );
                }
            }
            process.exitCode = 4;
            return;
        }

        if (!cfg.noAmend && !cfg.dryRun) {
            if (safeToAmend(repoRoot)) {
                await stageAndAmend(changedFiles, { verbose: cfg.verbose });
            } else if (cfg.verbose) {
                console.log(
                    "autover: unsafe state (detached HEAD / merge / rebase); skipping amend.",
                );
            }
        } else if (cfg.verbose) {
            console.log("autover: --no-amend or --dry-run; skipping amend.");
        }

        if (firstChangedVersion) {
            maybeTag(tagOnChange, firstChangedVersion, changedFiles.length > 0, cfg.verbose);
        }

        if (!cfg.quiet && cfg.short) {
            const ts = isoZ(lastDate || new Date());
            const v = firstChangedVersion || "unchanged";
            console.log(`autover: ${changedFiles.length} files updated | ${v} | ${ts}`);
            return;
        }

        if (!cfg.quiet && cfg.verbose) {
            const when = isoZ(lastDate || new Date());
            console.log(`${"git commit".padEnd(13)} = ${describeShort()}`);
            console.log(`${"author ts".padEnd(13)} = ${gitTs || "n/a"}`);
            console.log(`${"datetime".padEnd(13)} = ${when}`);
            console.log(`${"changed".padEnd(13)} = ${changedFiles.length} file(s)`);
        }
    } finally {
        await removeLock(lk);
    }
})();
