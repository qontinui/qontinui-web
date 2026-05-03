#!/usr/bin/env node
/**
 * Verifies that the browser-safe subpaths of @qontinui/ui-bridge-auto
 * (`./types` and `./drift`) do not contain Node-only references for
 * `fs`, `path`, `jsdom`, `canvas`, or `child_process` in their built CJS
 * or ESM bundles.
 *
 * Notes:
 * - Flags both static `require("X")` AND dynamic `await import("X")` /
 *   `import("X")`. The dynamic-import escape hatch was removed when
 *   `defaultRunGit` moved to the dedicated `./drift/node` subpath, so
 *   the browser-safe `./drift` subpath should now have zero Node-only
 *   references of either kind. (Before the split, the check tolerated
 *   dynamic imports because tree-shaking dropped them; now we get the
 *   strong static guarantee.)
 * - We walk `./drift/` and `./types/` recursively but skip the
 *   `./drift/node.*` files: that subpath is explicitly Node-only and
 *   advertised as such in ui-bridge-auto's package.json (`./drift/node`).
 *
 * Exits non-zero on the first violation.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const FORBIDDEN_MODULES = ["fs", "path", "jsdom", "canvas", "child_process"];
const SUBPATHS = ["types", "drift"];
const FILE_EXTS = [".js", ".mjs"];

/**
 * Files inside a SUBPATH that are explicitly Node-only and not part of the
 * browser-safe contract. These are advertised as their own non-browser
 * subpath in ui-bridge-auto's package.json (e.g. `./drift/node`).
 */
const EXPLICIT_NODE_FILES = new Set([
  // dist/drift/node.{js,mjs} — the Node-only `defaultRunGit` subpath.
  "drift/node.js",
  "drift/node.mjs",
]);

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
  // Match `require("MOD")` AND `import("MOD")` — both static and dynamic
  // forms — for any MOD in FORBIDDEN_MODULES. The bundler emits these as
  // string-literal callsites, so a literal regex is enough. We catch the
  // `node:` URL prefix too since Node 16+ emits both forms.
  const escaped = FORBIDDEN_MODULES.map((m) =>
    m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const alternation = escaped.join("|");
  return new RegExp(
    `(?:require|import)\\(\\s*['"\`](?:node:)?(${alternation})['"\`]\\s*\\)`,
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
    const relFromDist = path
      .relative(pkgRoot, file)
      .replaceAll(path.sep, "/");
    if (EXPLICIT_NODE_FILES.has(relFromDist)) {
      continue;
    }
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
  `[check-browser-safe-imports] OK — scanned ${SUBPATHS.map((s) => `dist/${s}/`).join(", ")} for require()/import() of ${FORBIDDEN_MODULES.join(", ")} (skipped explicit Node files: ${[...EXPLICIT_NODE_FILES].join(", ")}).`,
);
