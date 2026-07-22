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
 * - Default: `X.Y.Z+<minutesSinceJan1UTC>`
 * - Pre-release: `X.Y.<minutesSinceJan1UTC>-<gitsha>` (`--format pre`)
 * - Workspaces-aware (Yarn/NPM/PNPM), gated by triggering-commit changes.
 * - Safe amend (preserves author/message/dates) and reentrancy lock.
 *
 * @module autover
 * @main autover
 * @since 2.0.0
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const _require = createRequire(import.meta.url);
/** @const {string} SCRIPT_VERSION */
const SCRIPT_VERSION = _require("../package.json").version.split("+")[0];
const jsonFormatting = new WeakMap();

/** @const {string} LOCKFILE_DEFAULT */
const LOCKFILE_DEFAULT = ".git/autover.lock";

/** @const {Set<String>} SKIP_DIRS Directories never traversed during package discovery. */
const SKIP_DIRS = new Set(["node_modules", ".git"]);

/** @const {Object} defaultOptions */
const defaultOptions = {
    file: null,
    workspaces: false,
    recursive: false,
    noAmend: false,
    dryRun: false,
    verbose: false,
    quiet: false,
    short: false,
    format: "build",
    metadata: "timestamp",
    separateCommit: false,
    guardUnchanged: false,
    patch: null,
    init: false,
    install: false,
    version: false,
    help: false,
    lockPath: null,
    rootAlso: false,
    skipOnCI: false,
    tagOnChange: false,
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
 * Return the triggering commit's abbreviated object ID.
 *
 * @method shortCommitId
 * @param {String} [cwd] Optional repository working directory.
 * @return {String|null}
 */
function shortCommitId(cwd) {
    return runGit(["rev-parse", "--short=7", "HEAD"], cwd ? { cwd } : {});
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
}

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
 * Return paths changed by the triggering commit, including an initial commit.
 *
 * @method committedRelPaths
 * @param {String} repoRoot Absolute path to repo root.
 * @return {Array<String>}
 */
function committedRelPaths(repoRoot) {
    const res = spawnSync(
        "git",
        [
            "diff-tree",
            "--root",
            "--first-parent",
            "--no-commit-id",
            "--name-only",
            "-r",
            "-z",
            "HEAD",
        ],
        { cwd: repoRoot, encoding: "utf8" },
    );
    if (res.status !== 0) {
        return [];
    }
    return (res.stdout || "").split("\0").filter(Boolean);
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
    const data = JSON.parse(raw);
    const indentMatch = raw.match(/\r?\n([ \t]+)"/u);
    jsonFormatting.set(data, {
        indent: indentMatch ? indentMatch[1] : 0,
        newline: raw.includes("\r\n") ? "\r\n" : "\n",
        finalNewline: /\r?\n$/u.test(raw),
    });
    return data;
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
    const originalStat = await fsp.stat(p);
    const formatting = jsonFormatting.get(data) || {
        indent: "    ",
        newline: "\n",
        finalNewline: true,
    };
    let serialized = JSON.stringify(data, null, formatting.indent);
    if (formatting.newline === "\r\n") {
        serialized = serialized.replace(/\n/gu, "\r\n");
    }
    if (formatting.finalNewline) {
        serialized += formatting.newline;
    }
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.autover.tmp.${process.pid}.${Date.now()}`);
    try {
        await fsp.writeFile(tmp, serialized, {
            encoding: "utf8",
            mode: originalStat.mode,
        });
        await fsp.chmod(tmp, originalStat.mode);
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
 * @return {Array<Number>} [major, minor, patch]
 */
function parseMMP(v) {
    const core = v.split("+", 1)[0].split("-", 1)[0];
    if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,2}$/u.test(core)) {
        throw new TypeError(`invalid semantic version "${v}"`);
    }
    const parts = core
        .split(".")
        .slice(0, 3)
        .map((x) => parseInt(x, 10));
    while (parts.length < 3) {
        parts.push(0);
    }
    return parts;
}

/**
 * Build strict SemVer + build metadata version string.
 *
 * @method makeVersionBuild
 * @param {Object} pkg Parsed package.json object (expects `version`).
 * @param {String} commitid Short commit id (e.g., "abc1234").
 * @param {String|null} gitTs Author time (epoch seconds) or null.
 * @param {Number|null} patchOverride Optional patch override (forces Z).
 * @param {String} metadata Build metadata mode (`timestamp` or `timestamp-sha`).
 * @return {Array} [version:String, date:Date]
 */
function makeVersionBuild(pkg, commitid, gitTs, patchOverride, metadata = "timestamp") {
    const d = fromGitEpoch(gitTs);
    let [x, y, z] = parseMMP(String(pkg.version ?? "1.0.0"));
    if (Number.isInteger(patchOverride)) {
        z = patchOverride;
    }
    const stamp = minutesSinceYearStart(d);
    const suffix = metadata === "timestamp" ? `${stamp}` : `${stamp}.${commitid}`;
    const ver = `${x}.${y}.${z}+${suffix}`;
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
    const branch = runGit(["symbolic-ref", "-q", "--short", "HEAD"], { cwd: repoRoot });
    if (!branch) {
        return false;
    }
    const rawGitDir = runGit(["rev-parse", "--git-dir"], { cwd: repoRoot });
    const gdir = rawGitDir ? path.resolve(repoRoot, rawGitDir) : path.join(repoRoot, ".git");
    if (fs.existsSync(path.join(gdir, "MERGE_HEAD"))) {
        return false;
    }
    if (
        fs.existsSync(path.join(gdir, "CHERRY_PICK_HEAD")) ||
        fs.existsSync(path.join(gdir, "REVERT_HEAD")) ||
        fs.existsSync(path.join(gdir, "sequencer"))
    ) {
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
 * Return true when HEAD is an autover-generated commit.
 *
 * @method isAutoverCommit
 * @return {Boolean}
 */
function isAutoverCommit() {
    const body = runGit(["show", "-s", "--format=%B", "HEAD"]);
    return Boolean(body && /^Autover-Version: true$/mu.test(body));
}

/**
 * Resolve effective lock file path.
 *
 * @method lockPath
 * @param {String|null} custom Custom lock path or null.
 * @return {String}
 */
function lockPath(custom, repoRoot) {
    if (!custom || custom === LOCKFILE_DEFAULT) {
        const gitPath = runGit(["rev-parse", "--git-path", "autover.lock"], { cwd: repoRoot });
        if (!gitPath) {
            throw new Error("unable to resolve Git lock path");
        }
        return path.resolve(repoRoot, gitPath);
    }
    return path.resolve(repoRoot, custom);
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

/** Return true when the index contains any staged path. */
function indexIsDirty(repoRoot) {
    return stagedRelPaths(repoRoot).length > 0;
}

/** Return true when a generated target has staged, unstaged, or untracked changes. */
function pathIsDirty(repoRoot, target) {
    const rel = path.relative(repoRoot, target);
    const result = spawnSync("git", ["status", "--porcelain=v1", "--", rel], {
        cwd: repoRoot,
        encoding: "utf8",
    });
    return result.status !== 0 || Boolean((result.stdout || "").trim());
}

/** Return true when HEAD carries a valid or partially trusted Git signature. */
function headIsSigned(repoRoot) {
    const status = runGit(["show", "-s", "--format=%G?", "HEAD"], { cwd: repoRoot });
    return Boolean(status && status !== "N");
}

/**
 * Build a Set of absolute paths changed by the triggering commit.
 *
 * @method committedAbsSet
 * @param {String} repoRoot Repo root.
 * @return {Set<String>}
 */
function committedAbsSet(repoRoot) {
    return new Set(committedRelPaths(repoRoot).map((r) => path.resolve(repoRoot, r)));
}

/**
 * Check whether a workspace pattern uses glob syntax the expander does not support.
 * Braces, character classes, extglobs, and backslash escapes are rejected loudly
 * instead of silently diverging from npm's matching.
 *
 * @method usesUnsupportedGlobSyntax
 * @param {String} pattern Workspace glob pattern (leading `!` removed).
 * @return {Boolean}
 */
function usesUnsupportedGlobSyntax(pattern) {
    return /[{}[\]\\]|[@+!?*]\(/u.test(pattern);
}

/**
 * Convert one glob segment (no `/`) into an anchored RegExp.
 * `*` matches any run of characters and `?` matches exactly one;
 * every other character is literal.
 *
 * @method globSegmentToRegExp
 * @param {String} segment Pattern segment.
 * @return {RegExp}
 */
function globSegmentToRegExp(segment) {
    const escaped = segment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`^${escaped.replace(/\\\*/gu, ".*").replace(/\\\?/gu, ".")}$`, "u");
}

/**
 * List directory entries, or an empty array when the path is missing,
 * unreadable, or not a directory.
 *
 * @method readDirEntries
 * @param {String} dir Directory path.
 * @return {Array<fs.Dirent>}
 */
function readDirEntries(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

/**
 * Split a workspace glob pattern into normalized path segments.
 *
 * @method parseGlobPattern
 * @param {String} pattern Workspace glob pattern (leading `!` removed).
 * @return {Array<String>} Non-empty pattern segments.
 */
function parseGlobPattern(pattern) {
    if (typeof pattern !== "string") {
        throw new TypeError(`workspace pattern must be a string, got ${typeof pattern}`);
    }
    if (usesUnsupportedGlobSyntax(pattern)) {
        throw new TypeError(
            `unsupported workspace pattern "${pattern}" (braces, character classes, extglobs, and escapes are not supported)`,
        );
    }
    if (pattern.startsWith("/")) {
        throw new TypeError(`workspace pattern "${pattern}" must be relative`);
    }
    const segments = pattern.split("/").filter((s) => s !== "" && s !== ".");
    if (!segments.length) {
        throw new TypeError(`empty workspace pattern "${pattern}"`);
    }
    if (segments.includes("..")) {
        throw new TypeError(`workspace pattern "${pattern}" must not escape the repository root`);
    }
    // `**/**` is equivalent to `**`; collapsing avoids redundant walks.
    return segments.filter((s, i) => s !== "**" || segments[i - 1] !== "**");
}

/**
 * Expand pattern segments from a directory, yielding candidate paths.
 * Wildcard segments never match dot-entries unless the segment itself starts
 * with a literal dot; `**` matches zero or more directories and never descends
 * into `node_modules`, `.git`, dot-directories, or symlinked directories.
 *
 * @method expandGlobSegments
 * @param {String} dir Directory resolved so far.
 * @param {Array<String>} segments Pattern segments.
 * @param {Number} index Current segment index.
 * @return {Generator<String>} Yields candidate paths (existence is not checked).
 */
function* expandGlobSegments(dir, segments, index) {
    if (index === segments.length) {
        yield dir;
        return;
    }
    const segment = segments[index];
    if (segment === "**") {
        yield* expandGlobSegments(dir, segments, index + 1);
        for (const entry of readDirEntries(dir)) {
            if (!entry.isDirectory()) {
                continue;
            }
            if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) {
                continue;
            }
            yield* expandGlobSegments(path.join(dir, entry.name), segments, index);
        }
        return;
    }
    if (!/[*?]/u.test(segment)) {
        yield* expandGlobSegments(path.join(dir, segment), segments, index + 1);
        return;
    }
    const matcher = globSegmentToRegExp(segment);
    for (const entry of readDirEntries(dir)) {
        if (entry.name.startsWith(".") && !segment.startsWith(".")) {
            continue;
        }
        if (!matcher.test(entry.name)) {
            continue;
        }
        yield* expandGlobSegments(path.join(dir, entry.name), segments, index + 1);
    }
}

/**
 * Return true when a path exists and is a regular file (symlinks followed).
 *
 * @method isExistingFile
 * @param {String} p Path to check.
 * @return {Boolean}
 */
function isExistingFile(p) {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

/**
 * Expand parsed pattern segment lists and collect matching files.
 *
 * @method collectGlobMatches
 * @param {Array<Array<String>>} segmentLists Parsed pattern segment lists.
 * @param {String} cwd Absolute base directory.
 * @return {Set<String>} Absolute paths of existing files.
 */
function collectGlobMatches(segmentLists, cwd) {
    const found = new Set();
    for (const segments of segmentLists) {
        for (const candidate of expandGlobSegments(cwd, segments, 0)) {
            if (found.has(candidate)) {
                continue;
            }
            if (!isExistingFile(candidate)) {
                continue;
            }
            found.add(candidate);
        }
    }
    return found;
}

/**
 * Expand npm workspace glob patterns into existing files below a base directory.
 * Supports the syntax npm workspaces use in practice: literal segments, `*`, `?`,
 * `**`, and leading-`!` negation. Unsupported syntax throws a TypeError rather
 * than silently diverging from npm. Results are absolute, deduplicated, and
 * sorted for deterministic output.
 *
 * @method expandWorkspaceGlobs
 * @param {Array<String>} patterns Workspace glob patterns (POSIX separators).
 * @param {String} cwd Absolute base directory.
 * @return {Array<String>} Sorted absolute paths of matching files.
 */
function expandWorkspaceGlobs(patterns, cwd) {
    const positive = [];
    const negative = [];
    for (const raw of patterns) {
        if (typeof raw === "string" && raw.startsWith("!")) {
            negative.push(parseGlobPattern(raw.slice(1)));
            continue;
        }
        positive.push(parseGlobPattern(raw));
    }
    const matched = collectGlobMatches(positive, cwd);
    for (const excluded of collectGlobMatches(negative, cwd)) {
        matched.delete(excluded);
    }
    return Array.from(matched).sort();
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
        console.warn(`autover: failed to parse ${rootPkg}: ${e.message}`);
        return null;
    }
    const ws = data.workspaces;
    if (!ws) {
        return null;
    }
    let patterns = [];
    if (Array.isArray(ws)) {
        patterns = ws;
    } else if (Array.isArray(ws.packages)) {
        patterns = ws.packages;
    }
    if (!patterns.length) {
        return new Set();
    }
    const manifests = patterns.map((p) =>
        typeof p !== "string" || p.endsWith("package.json")
            ? p
            : path.posix.join(p, "package.json"),
    );
    return new Set(expandWorkspaceGlobs(manifests, repoRoot));
}

/**
 * Recursively find `package.json` files (excluding `.git`/`node_modules`).
 *
 * @method recursivePackageJsons
 * @param {String} repoRoot Repo root.
 * @return {Generator<String>} Yields absolute package.json paths.
 */
function* recursivePackageJsons(repoRoot) {
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
        // Stop recursing once a *child* package.json is found — each
        // package owns its own subtree (nested node_modules, fixtures,
        // etc.).  The repo root is always explored so that workspace
        // directories are discovered even when a root package.json exists.
        if (hasPJ && dir !== repoRoot) {
            continue;
        }
        for (const e of entries) {
            if (!e.isDirectory()) {
                continue;
            }
            if (SKIP_DIRS.has(e.name)) {
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
    const parsed = JSON.parse(await fsp.readFile(p, "utf8"));
    validateConfig(parsed);
    return parsed;
}

/**
 * Validate the complete configuration schema.
 *
 * @method validateConfig
 * @param {Object} config Parsed configuration.
 * @return {void}
 */
function validateConfig(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new TypeError("configuration must be a JSON object");
    }
    const types = {
        file: ["string", "null"],
        workspaces: ["boolean"],
        recursive: ["boolean"],
        noAmend: ["boolean"],
        separateCommit: ["boolean"],
        dryRun: ["boolean"],
        verbose: ["boolean"],
        quiet: ["boolean"],
        short: ["boolean"],
        format: ["string"],
        metadata: ["string"],
        guardUnchanged: ["boolean"],
        patch: ["number", "null"],
        lockPath: ["string", "null"],
        rootAlso: ["boolean"],
        skipOnCI: ["boolean"],
        tagOnChange: ["boolean"],
    };
    for (const [key, value] of Object.entries(config)) {
        if (!(key in types)) {
            throw new TypeError(`unknown configuration key "${key}"`);
        }
        const actual = value === null ? "null" : typeof value;
        if (!types[key].includes(actual)) {
            throw new TypeError(`configuration key "${key}" must be ${types[key].join(" or ")}`);
        }
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
        metadata: "timestamp",
        separateCommit: false,
        workspaces: true,
        recursive: false,
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
 * Install managed POSIX and Windows post-commit hook blocks.
 *
 * @method doInstall
 * @async
 * @param {String} repoRoot Repo root.
 * @return {void}
 */
async function doInstall(repoRoot) {
    const customHooksPath = runGit(["config", "--get", "core.hooksPath"]);
    const gitHooksPath = runGit(["rev-parse", "--git-path", "hooks"], { cwd: repoRoot });
    const hooksDir = customHooksPath
        ? path.resolve(repoRoot, customHooksPath)
        : path.resolve(repoRoot, gitHooksPath || path.join(".git", "hooks"));
    await fsp.mkdir(hooksDir, { recursive: true });
    const posixHookPath = path.join(hooksDir, "post-commit");
    const windowsHookPath = path.join(hooksDir, "post-commit.cmd");
    const posixBlock = `# >>> autover managed block >>>
if command -v npx >/dev/null 2>&1; then
    npx --no-install autover
else
    echo "⚠️ npx not found. Install Node.js/npm to use autover."
fi
# <<< autover managed block <<<`;
    const windowsBlock = `REM >>> autover managed block >>>
where npx >nul 2>nul
IF ERRORLEVEL 1 (
    echo npx not found. Install Node.js/npm to use autover.
    EXIT /B 0
)
npx --no-install autover
REM <<< autover managed block <<<`;
    const updateHook = async (hookPath, header, block, start, end) => {
        const existing = fs.existsSync(hookPath) ? await fsp.readFile(hookPath, "utf8") : header;
        const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, "u");
        const next = pattern.test(existing)
            ? existing.replace(pattern, block)
            : `${existing.trimEnd()}\n\n${block}\n`;
        await fsp.writeFile(hookPath, next, "utf8");
    };
    await updateHook(
        posixHookPath,
        "#!/usr/bin/env bash\n",
        posixBlock,
        "# >>> autover managed block >>>",
        "# <<< autover managed block <<<",
    );
    await fsp.chmod(posixHookPath, 0o755);
    await updateHook(
        windowsHookPath,
        "@echo off\r\n",
        windowsBlock,
        "REM >>> autover managed block >>>",
        "REM <<< autover managed block <<<",
    );
    console.log(`autover: installed hooks:\n  ${posixHookPath}\n  ${windowsHookPath}`);
    console.log(
        "autover: hooks use the locally installed package; use .autoverrc.json for settings.",
    );
}

/**
 * Stage files and amend the most recent commit (preserving author/message/dates).
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
            throw new Error(`git add failed for ${f}`);
        }
    }
    const env = { ...process.env };
    const aISO = authorISO();
    const cISO = committerISO();
    if (cISO) {
        env.GIT_COMMITTER_DATE = cISO;
    }
    const args = ["commit", "--amend", "--no-edit", "--no-verify"];
    const repoRoot = gitTopDir();
    if (repoRoot && headIsSigned(repoRoot)) {
        args.push("-S");
    }
    if (aISO) {
        args.push(`--date=${aISO}`);
    }
    const res = spawnSync("git", args, { encoding: "utf8", env });
    if (res.status !== 0) {
        throw new Error("git commit --amend failed");
    }
}

/**
 * Stage generated files and create a dedicated version commit.
 *
 * @method stageAndCommit
 * @param {Array<String>} filesToAdd Absolute file paths to stage.
 * @param {Object} opts Options.
 * @param {Boolean} opts.verbose Verbose logging.
 * @return {void}
 */
async function stageAndCommit(filesToAdd, { verbose }) {
    if (!filesToAdd.length) {
        return;
    }
    for (const f of filesToAdd) {
        const res = spawnSync("git", ["add", "--", f], { encoding: "utf8" });
        if (res.status !== 0) {
            throw new Error(`git add failed for ${f}`);
        }
    }
    const res = spawnSync(
        "git",
        [
            "commit",
            "--no-verify",
            "-m",
            "chore(version): update generated versions",
            "-m",
            "Autover-Version: true",
        ],
        { encoding: "utf8" },
    );
    if (res.status !== 0) {
        throw new Error("version commit failed");
    } else if (verbose) {
        console.log("autover: created a separate version commit.");
    }
}

/**
 * Synchronize an npm lockfile entry with a package version.
 *
 * @method syncLockfileVersion
 * @async
 * @param {String} repoRoot Repository root.
 * @param {String} packageJsonPath Package manifest path.
 * @param {String} version Generated version.
 * @param {Boolean} dryRun Whether writes are disabled.
 * @return {String|null} Changed lockfile path, or null.
 */
async function syncLockfileVersion(repoRoot, packageJsonPath, version, dryRun) {
    const packageDir = path.dirname(packageJsonPath);
    let current = packageDir;
    let lockfilePath = null;
    while (current === repoRoot || current.startsWith(`${repoRoot}${path.sep}`)) {
        for (const name of ["package-lock.json", "npm-shrinkwrap.json"]) {
            const candidate = path.join(current, name);
            if (fs.existsSync(candidate)) {
                lockfilePath = candidate;
                break;
            }
        }
        if (lockfilePath || current === repoRoot) {
            break;
        }
        current = path.dirname(current);
    }
    if (!lockfilePath) {
        return null;
    }

    const lock = await readJSON(lockfilePath);
    let changed = false;
    const lockRoot = path.dirname(lockfilePath);
    const rel = path.relative(lockRoot, packageDir).replace(/\\/gu, "/");
    const packageKey = rel === "" ? "" : rel;
    if (packageKey === "" && lock.version !== version) {
        lock.version = version;
        changed = true;
    }
    if (lock.packages && lock.packages[packageKey]?.version !== version) {
        if (lock.packages[packageKey]) {
            lock.packages[packageKey].version = version;
            changed = true;
        }
    }
    if (!changed) {
        return null;
    }
    if (!dryRun) {
        await atomicWriteJSON(lockfilePath, lock);
    }
    return lockfilePath;
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
function assertTagAvailable(version) {
    const core = version.split("+", 1)[0].split("-", 1)[0];
    const tag = `v${core}`;
    const existing = runGit(["rev-parse", "-q", "--verify", `refs/tags/${tag}^{}`]);
    if (existing) {
        throw new Error(`tag ${tag} already exists`);
    }
    return true;
}

function maybeTag(tagOnChange, version, changed, verbose) {
    if (!tagOnChange || !changed) {
        return;
    }
    assertTagAvailable(version);
    const core = version.split("+", 1)[0].split("-", 1)[0];
    const tag = `v${core}`;
    const res = spawnSync("git", ["tag", tag], { encoding: "utf8" });
    if (res.status !== 0) {
        throw new Error(`failed to create tag ${tag}`);
    }
    if (verbose) {
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
        const takeValue = () => {
            const value = argv[i + 1];
            if (value == null || value.startsWith("-")) {
                console.error(`autover: ${a} requires a value`);
                process.exit(2);
            }
            i += 1;
            return value;
        };
        if (a === "-h" || a === "--help") {
            out.help = true;
        } else if (a === "-V" || a === "--version") {
            out.version = true;
        } else if (a === "--init") {
            out.init = true;
        } else if (a === "--install") {
            out.install = true;
        } else if (a === "-f" || a === "--file") {
            out.file = takeValue();
        } else if (a === "--workspaces") {
            out.workspaces = true;
        } else if (a === "--recursive") {
            out.recursive = true;
        } else if (a === "--no-amend") {
            out.noAmend = true;
        } else if (a === "--separate-commit") {
            out.separateCommit = true;
        } else if (a === "--dry-run") {
            out.dryRun = true;
        } else if (a === "--no-skip-ci") {
            out.skipOnCI = false;
        } else if (a === "-v" || a === "--verbose") {
            out.verbose = true;
        } else if (a === "-q" || a === "--quiet") {
            out.quiet = true;
        } else if (a === "--short") {
            out.short = true;
        } else if (a === "--format") {
            const fmt = takeValue().toLowerCase();
            if (fmt !== "build" && fmt !== "pre") {
                console.error(`autover: --format must be "build" or "pre", got "${fmt}"`);
                process.exit(2);
            }
            out.format = fmt;
        } else if (a === "--metadata") {
            const metadata = takeValue().toLowerCase();
            if (metadata !== "timestamp" && metadata !== "timestamp-sha") {
                console.error(
                    `autover: --metadata must be "timestamp" or "timestamp-sha", got "${metadata}"`,
                );
                process.exit(2);
            }
            out.metadata = metadata;
        } else if (a === "--guard-unchanged") {
            out.guardUnchanged = true;
        } else if (a === "--patch") {
            const n = Number(takeValue());
            if (!Number.isInteger(n) || n < 0) {
                console.error("autover: --patch requires a non-negative integer");
                process.exit(2);
            }
            out.patch = n;
        } else {
            console.error(`autover: unknown arg: ${a}`);
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
            "  npx autover [--file PATH | --workspaces [--recursive]]",
            "               [--format build|pre] [--patch N]",
            "               [--metadata timestamp|timestamp-sha]",
            "               [--guard-unchanged] [--no-amend | --separate-commit] [--dry-run]",
            "               [--no-skip-ci] [--verbose] [--quiet] [--short] [--init] [--install]",
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

export {
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
};

let _isDirectRun = false;
try {
    _isDirectRun =
        process.argv[1] &&
        fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch {
    // Not run directly (e.g., node -e, piped stdin, missing path).
}

/**
 * Program entry point. Orchestrates config, targets, versioning, and amend.
 *
 * @method main
 * @async
 * @private
 * @return {void}
 */
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }
    if (args.version) {
        console.log(`autover ${SCRIPT_VERSION}`);
        return;
    }
    if (/^(1|true)$/iu.test(process.env.AUTOVER_SKIP || "")) {
        return;
    }

    const gv = gitVersion();
    const [g1, g2, g3] = versionTuple(gv);
    const ok = g1 > 1 || (g1 === 1 && (g2 > 8 || (g2 === 8 && g3 >= 2))); // >= 1.8.2
    if (!ok) {
        console.error("autover: git 1.8.2 or newer is required");
        process.exit(1);
    }
    if (!isGitRepo()) {
        console.error("autover: not inside a git repository");
        process.exit(1);
    }

    const repoRoot = gitTopDir();
    if (!repoRoot) {
        console.error("autover: unable to resolve repository root");
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
    let configOptions;
    try {
        configOptions = await loadConfig(repoRoot);
    } catch (error) {
        console.error(`autover: invalid .autoverrc.json: ${error.message}`);
        process.exitCode = 2;
        return;
    }

    const cfg = { ...defaultOptions, ...configOptions, ...args };

    // Global reentrancy guard (atomic: O_CREAT|O_EXCL)
    const lk = cfg.dryRun ? null : lockPath(cfg.lockPath, repoRoot);
    if (lk && !acquireLock(lk)) {
        if (!cfg.quiet && (cfg.short || cfg.verbose)) {
            console.log("autover: lock present; exiting.");
        }
        return;
    }
    try {
        // cfg already has CLI > config > defaults via spread order above;
        // normalize the values we need going forward.
        cfg.format = String(cfg.format).toLowerCase();
        if (cfg.format !== "build" && cfg.format !== "pre") {
            console.error(`autover: format must be "build" or "pre", got "${cfg.format}"`);
            process.exitCode = 2;
            return;
        }
        cfg.metadata = String(cfg.metadata).toLowerCase();
        if (cfg.metadata !== "timestamp" && cfg.metadata !== "timestamp-sha") {
            console.error(
                `autover: metadata must be "timestamp" or "timestamp-sha", got "${cfg.metadata}"`,
            );
            process.exitCode = 2;
            return;
        }
        const rootAlso = cfg.rootAlso;
        const skipOnCI = cfg.skipOnCI;
        const tagOnChange = cfg.tagOnChange;

        if (cfg.patch != null) {
            const n = Number(cfg.patch);
            if (!Number.isInteger(n) || n < 0) {
                console.error("autover: patch must be a non-negative integer");
                process.exitCode = 2;
                return;
            }
            cfg.patch = n;
        }
        if (cfg.file && cfg.workspaces) {
            console.error("autover: --file and --workspaces are mutually exclusive");
            process.exitCode = 2;
            return;
        }
        if (cfg.recursive && !cfg.workspaces) {
            console.error("autover: --recursive requires --workspaces");
            process.exitCode = 2;
            return;
        }
        if (cfg.noAmend && cfg.separateCommit) {
            console.error("autover: --no-amend and --separate-commit are mutually exclusive");
            process.exitCode = 2;
            return;
        }
        if (cfg.format === "pre" && cfg.patch != null) {
            console.error("autover: --patch is not supported with --format pre");
            process.exitCode = 2;
            return;
        }
        const shaBearing = cfg.format === "pre" || cfg.metadata === "timestamp-sha";
        if (shaBearing && !cfg.dryRun && !cfg.noAmend && !cfg.separateCommit) {
            console.error(
                "autover: SHA-bearing versions require --separate-commit or --no-amend; amend mode cannot preserve the embedded SHA",
            );
            process.exitCode = 2;
            return;
        }
        if (tagOnChange && cfg.noAmend && !cfg.dryRun) {
            console.error("autover: tagOnChange cannot be used with --no-amend");
            process.exitCode = 2;
            return;
        }
        if (skipOnCI && process.env.CI) {
            if (!cfg.quiet && (cfg.verbose || cfg.short)) {
                console.log("autover: CI detected and skipOnCI=true; exiting.");
            }
            return;
        }
        if (isAutoverCommit()) {
            if (!cfg.quiet && (cfg.verbose || cfg.short)) {
                console.log("autover: generated version commit detected; exiting.");
            }
            return;
        }

        // All repository-state checks happen before any generated file is written.
        if (!cfg.noAmend && !cfg.dryRun && !safeToAmend(repoRoot)) {
            console.error(
                "autover: unsafe Git state (detached HEAD or operation in progress); no files changed.",
            );
            process.exitCode = 1;
            return;
        }
        if (!cfg.noAmend && !cfg.dryRun && indexIsDirty(repoRoot)) {
            console.error("autover: index contains staged changes; no files changed.");
            process.exitCode = 1;
            return;
        }

        // targets
        let targets = [];
        if (cfg.workspaces) {
            let ws;
            try {
                ws = await detectWorkspaceFiles(repoRoot);
            } catch (error) {
                console.error(`autover: ${error.message}`);
                process.exitCode = 2;
                return;
            }
            if (ws === null) {
                targets = cfg.recursive
                    ? Array.from(recursivePackageJsons(repoRoot))
                    : [path.join(repoRoot, "package.json")];
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
        if (cfg.file && !fs.existsSync(targets[0])) {
            console.error(`autover: package manifest not found: ${targets[0]}`);
            process.exitCode = 2;
            return;
        }
        targets = Array.from(new Set(targets.filter((p) => fs.existsSync(p))));

        // Triggering-commit gating for workspaces.
        if (cfg.workspaces) {
            const committed = committedAbsSet(repoRoot);
            const committedArr = Array.from(committed);
            targets = targets.filter((pj) => subtreeHasStaged(pj, committedArr));
        }

        const commitid = shortCommitId();
        const gitTs = authorTS();
        if (!commitid || !gitTs) {
            console.error("autover: unable to resolve HEAD identity and author timestamp");
            process.exitCode = 1;
            return;
        }

        const changedFiles = [];
        const plans = [];
        let lastDate = null;
        let firstChangedVersion = null;

        for (const pj of targets) {
            let pkg;
            try {
                pkg = await readJSON(pj);
            } catch (e) {
                console.error(`autover: invalid package manifest ${pj}: ${e.message}`);
                process.exitCode = 2;
                return;
            }

            let newVer;
            let dt;
            try {
                [newVer, dt] =
                    cfg.format === "pre"
                        ? makeVersionPre(pkg, commitid, gitTs)
                        : makeVersionBuild(pkg, commitid, gitTs, cfg.patch, cfg.metadata);
            } catch (error) {
                console.error(`autover: ${pj}: ${error.message}`);
                process.exitCode = 2;
                return;
            }

            lastDate = dt;
            const oldVer = String(pkg.version ?? "");

            if (cfg.verbose) {
                const rel = path.relative(repoRoot, pj).replace(/\\/g, "/");
                console.log(`[${rel}] ${oldVer} -> ${newVer}`);
            }

            if (oldVer === newVer) {
                continue;
            }
            pkg.version = newVer;
            plans.push({ packageJsonPath: pj, pkg, version: newVer });
            if (!firstChangedVersion) {
                firstChangedVersion = newVer;
            }
        }

        const lockfilePlans = new Map();
        try {
            for (const plan of plans) {
                if (!cfg.dryRun && pathIsDirty(repoRoot, plan.packageJsonPath)) {
                    console.error(
                        `autover: generated target has uncommitted changes: ${plan.packageJsonPath}`,
                    );
                    process.exitCode = 1;
                    return;
                }
                const lockfile = await syncLockfileVersion(
                    repoRoot,
                    plan.packageJsonPath,
                    plan.version,
                    true,
                );
                if (lockfile) {
                    if (!cfg.dryRun && pathIsDirty(repoRoot, lockfile)) {
                        console.error(
                            `autover: generated target has uncommitted changes: ${lockfile}`,
                        );
                        process.exitCode = 1;
                        return;
                    }
                    lockfilePlans.set(lockfile, true);
                }
            }
        } catch (error) {
            console.error(`autover: invalid npm lockfile: ${error.message}`);
            process.exitCode = 2;
            return;
        }
        if (!cfg.dryRun && tagOnChange && firstChangedVersion) {
            try {
                assertTagAvailable(firstChangedVersion);
            } catch (error) {
                console.error(`autover: ${error.message}; no files changed.`);
                process.exitCode = 1;
                return;
            }
        }

        const snapshotPaths = Array.from(
            new Set([...plans.map((plan) => plan.packageJsonPath), ...lockfilePlans.keys()]),
        );
        const snapshots = new Map();
        for (const target of snapshotPaths) {
            const stat = await fsp.stat(target);
            snapshots.set(target, { content: await fsp.readFile(target), mode: stat.mode });
        }

        try {
            // Apply only after every target and lockfile has been read successfully.
            for (const plan of plans) {
                if (!cfg.dryRun) {
                    await atomicWriteJSON(plan.packageJsonPath, plan.pkg);
                }
                changedFiles.push(plan.packageJsonPath);
                const lockfile = await syncLockfileVersion(
                    repoRoot,
                    plan.packageJsonPath,
                    plan.version,
                    cfg.dryRun,
                );
                if (lockfile && !changedFiles.includes(lockfile)) {
                    changedFiles.push(lockfile);
                }
            }

            if (!cfg.noAmend && !cfg.dryRun) {
                if (cfg.separateCommit) {
                    await stageAndCommit(changedFiles, { verbose: cfg.verbose });
                } else {
                    await stageAndAmend(changedFiles, { verbose: cfg.verbose });
                }
            } else if (cfg.verbose) {
                console.log("autover: --no-amend or --dry-run; skipping amend.");
            }
        } catch (error) {
            for (const [target, snapshot] of snapshots) {
                await fsp.writeFile(target, snapshot.content);
                await fsp.chmod(target, snapshot.mode);
            }
            if (changedFiles.length) {
                spawnSync("git", ["reset", "-q", "HEAD", "--", ...changedFiles], {
                    cwd: repoRoot,
                    encoding: "utf8",
                });
            }
            console.error(`autover: ${error.message}; generated files restored.`);
            process.exitCode = 1;
            return;
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

        if (firstChangedVersion && !cfg.dryRun) {
            try {
                maybeTag(tagOnChange, firstChangedVersion, changedFiles.length > 0, cfg.verbose);
            } catch (error) {
                console.error(`autover: ${error.message}`);
                process.exitCode = 1;
                return;
            }
        }

        if (!cfg.quiet && cfg.short) {
            const ts = isoZ(lastDate || new Date());
            const v = firstChangedVersion || "unchanged";
            console.log(`autover: ${changedFiles.length} files updated | ${v} | ${ts}`);
            return;
        }

        if (!cfg.quiet && cfg.verbose) {
            const when = isoZ(lastDate || new Date());
            console.log(`${"git commit".padEnd(13)} = ${commitid}`);
            console.log(`${"author ts".padEnd(13)} = ${gitTs || "n/a"}`);
            console.log(`${"datetime".padEnd(13)} = ${when}`);
            console.log(`${"changed".padEnd(13)} = ${changedFiles.length} file(s)`);
        }
    } finally {
        if (lk) {
            await removeLock(lk);
        }
    }
}

if (_isDirectRun) {
    await main();
}
