#!/usr/bin/env node

/**
 * Packs the current project, validates the exact public artifact, installs it
 * into an offline temporary consumer, and exercises the installed CLI.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const EXPECTED_PACKED_FILES = new Set([
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "bin/autover.js",
    "package.json",
]);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

/**
 * Run a command without shell interpolation.
 *
 * @param {string} command Executable path or command name.
 * @param {string[]} arguments_ Structured command arguments.
 * @param {string} cwd Working directory.
 * @param {NodeJS.ProcessEnv} [env] Child environment.
 * @returns {string} Captured standard output.
 */
function run(command, arguments_, cwd, env = process.env) {
    const result = spawnSync(command, arguments_, {
        cwd,
        encoding: "utf8",
        env,
        maxBuffer: MAX_BUFFER_BYTES,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        const detail = result.stderr?.trim() || result.stdout?.trim() || "no diagnostic";
        throw new Error(`${command} exited with status ${result.status ?? 1}: ${detail}`);
    }
    return result.stdout ?? "";
}

/**
 * Verify the complete npm-reported artifact file list and CLI mode.
 *
 * @param {Array<{path?: unknown, mode?: unknown}>} files npm pack file records.
 * @returns {void}
 */
export function validatePackedFiles(files) {
    const packedPaths = new Set(
        files.map(({ path: packedPath }) =>
            typeof packedPath === "string" ? packedPath : "(invalid path)",
        ),
    );
    const missing = [...EXPECTED_PACKED_FILES].filter((packedPath) => !packedPaths.has(packedPath));
    const unexpected = [...packedPaths].filter(
        (packedPath) => !EXPECTED_PACKED_FILES.has(packedPath),
    );
    if (missing.length > 0 || unexpected.length > 0) {
        throw new Error(
            `unexpected npm artifact; missing: ${missing.join(", ") || "none"}; extra: ${unexpected.join(", ") || "none"}`,
        );
    }

    const cli = files.find(({ path: packedPath }) => packedPath === "bin/autover.js");
    if (typeof cli?.mode !== "number" || (cli.mode & 0o111) === 0) {
        throw new Error("packed bin/autover.js must be executable");
    }
}

/**
 * Run the clean-consumer package check.
 *
 * @returns {Promise<void>}
 */
async function main() {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autover-package-"));
    const npmEnvironment = {
        ...process.env,
        npm_config_cache: path.join(temporaryRoot, "npm-cache"),
    };

    try {
        const packDirectory = path.join(temporaryRoot, "pack");
        const consumerDirectory = path.join(temporaryRoot, "consumer");
        await fs.mkdir(packDirectory, { recursive: true });
        await fs.mkdir(consumerDirectory, { recursive: true });

        const packOutput = run(
            npmCommand,
            ["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory],
            repositoryRoot,
            npmEnvironment,
        );
        const packedResults = JSON.parse(packOutput);
        if (!Array.isArray(packedResults) || packedResults.length !== 1) {
            throw new Error("npm pack did not report exactly one artifact");
        }
        const [packed] = packedResults;
        if (!packed?.filename || !Array.isArray(packed.files)) {
            throw new Error("npm pack did not report an artifact filename and file list");
        }
        validatePackedFiles(packed.files);

        await fs.writeFile(
            path.join(consumerDirectory, "package.json"),
            `${JSON.stringify({ private: true }, null, 4)}\n`,
            "utf8",
        );
        const archivePath = path.join(packDirectory, packed.filename);
        run(
            npmCommand,
            ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--offline", archivePath],
            consumerDirectory,
            npmEnvironment,
        );

        const versionOutput = run(
            npxCommand,
            ["--no-install", "autover", "--version"],
            consumerDirectory,
            npmEnvironment,
        ).trim();
        if (versionOutput !== `autover ${packed.version}`) {
            throw new Error(
                `installed CLI reported ${versionOutput || "no version"}; expected autover ${packed.version}`,
            );
        }
        const helpOutput = run(
            npxCommand,
            ["--no-install", "autover", "--help"],
            consumerDirectory,
            npmEnvironment,
        );
        if (!helpOutput.includes("Usage:")) {
            throw new Error("installed CLI help did not contain its usage contract");
        }

        process.stdout.write(
            `Packed consumer check passed for ${packed.name} ${packed.version}.\n`,
        );
    } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
