#!/usr/bin/env node
/**
 * Verifies that the browser-safe subpaths of @qontinui/ui-bridge-auto
 * (`./types` and `./drift`) do not contain Node-only `require()` calls
 * for `fs`, `path`, `jsdom`, or `canvas` in their built CJS or ESM
 * bundles.
 *
 * Notes:
 * - The check is conservative: only `require("X")` / `require('X')` /
 *   `require(\`X\`)` patterns are flagged. Lazy `await import("X")` is
 *   permitted because tree-shaking ESM consumers (Webpack 5, Next.js,
 *   esbuild) drop unreferenced dynamic imports along with their
 *   declaring functions when those functions are never called from the
 *   reachable surface.
 * - We walk only `./drift/` and `./types/` — those are the subpaths
 *   advertised as browser-safe in ui-bridge-auto's package.json.
 *
 * Exits non-zero on the first violation.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const FORBIDDEN_MODULES = ["fs", "path", "jsdom", "canvas"];
const SUBPATHS = ["types", "drift"];
const FILE_EXTS = [".js", ".mjs"];

const pkgRoot = path.join(
  repoRoot,
  "node_modules",
  "@qontinui",
  "ui-bridge-auto",
  "dist",
);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (FILE_EXTS.some((ext) => entry.name.endsWith(ext))) {
      yield full;
    }
  }
}

function buildForbiddenRegex() {
  // Match `require("MOD")`, `require('MOD')`, `require(\`MOD\`)` for any
  // MOD in FORBIDDEN_MODULES. The bundler emits these as static strings
  // for CJS callsites, so a literal regex is enough.
  const escaped = FORBIDDEN_MODULES.map((m) =>
    m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const alternation = escaped.join("|");
  return new RegExp(
    `require\\(\\s*['"\`](?:node:)?(${alternation})['"\`]\\s*\\)`,
    "g",
  );
}

const violations = [];
const forbiddenRegex = buildForbiddenRegex();

for (const subpath of SUBPATHS) {
  const dir = path.join(pkgRoot, subpath);
  if (!fs.existsSync(dir)) {
    console.error(
      `[check-browser-safe-imports] missing dist subpath: ${dir}`,
    );
    process.exit(2);
  }
  for (const file of walk(dir)) {
    const contents = fs.readFileSync(file, "utf8");
    forbiddenRegex.lastIndex = 0;
    let match;
    while ((match = forbiddenRegex.exec(contents)) !== null) {
      violations.push({
        file: path.relative(repoRoot, file),
        module: match[1],
        snippet: match[0],
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    "[check-browser-safe-imports] FAIL — Node-only require() calls found in browser-safe subpaths:",
  );
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.snippet}`);
  }
  console.error(
    "\nThese subpaths are advertised as browser-safe. Move Node-only code to a different subpath or guard it.",
  );
  process.exit(1);
}

console.log(
  `[check-browser-safe-imports] OK — scanned ${SUBPATHS.map((s) => `dist/${s}/`).join(", ")} for require() of ${FORBIDDEN_MODULES.join(", ")}.`,
);
