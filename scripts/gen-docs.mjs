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
 * Runs the locally installed JSDoc CLI to produce project documentation in
 * the `docs/` directory.
 *
 * @module gen-docs
 * @main gen-docs
 * @version 1.0.0
 * @since 1.0.0
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const jsdocCli = resolve("node_modules", "jsdoc", "jsdoc.js");
execFileSync(process.execPath, [jsdocCli, "bin/autover.js", "-d", "docs", "-R", "README.md"], {
    stdio: "inherit",
});
