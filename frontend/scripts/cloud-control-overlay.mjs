#!/usr/bin/env node
/**
 * Composed cloud build — install / remove the `@qontinui/cloud-control` overlay.
 *
 *   node scripts/cloud-control-overlay.mjs install [--source <path>]
 *   node scripts/cloud-control-overlay.mjs remove
 *   node scripts/cloud-control-overlay.mjs status
 *
 * (or `npm run cloud:install` / `cloud:remove` / `cloud:status`)
 *
 * WHAT IT DOES
 *
 * Links a sibling checkout of `qontinui-cloud-control` into
 * `frontend/node_modules/@qontinui/cloud-control` — a directory junction on
 * Windows, a directory symlink elsewhere. That is the ONLY thing that turns
 * an OSS build of this app into the composed cloud build; everything else
 * (`transpilePackages`, the `@qontinui/cloud-control` → `@/cloud-absent`
 * fallback alias) keys off whether that path exists. See
 * `docs/composed-cloud-build.md`.
 *
 * WHY NOT A `file:` DEPENDENCY IN package.json
 *
 * Because OSS installs must stay clean, and a `file:` entry is not opt-in:
 * it would put an absolute-ish sibling path into the committed
 * `package.json` + `package-lock.json`, and every `npm ci` in every OSS
 * checkout, CI job and Vercel build would then fail on a directory that is
 * not there. A `package.cloud.json` overlay was the other candidate; it
 * needs a second lockfile to stay honest and drifts from the real one
 * silently. A link created by an explicit post-install step keeps exactly
 * one lockfile, leaves `npm ci` byte-identical for OSS, and matches how the
 * backend half of this same composition already works — `backend-ci.yml`
 * git-clones the sibling repo and `pip install -e`s it as a separate step
 * rather than declaring it a dependency.
 *
 * WHY A LINK AND NOT A COPY
 *
 * A link keeps one source of truth, so editing cloud-control is picked up
 * by the next build with no re-sync step and no stale-copy failure mode.
 * The concern that made this worth checking is recorded in
 * `next.config.mjs`: `@qontinui/ui-bridge` is linked the same way and its
 * comment warns that SWC cannot follow Windows junctions, which is why it
 * is kept out of `transpilePackages`. That does NOT apply here, and the
 * difference is measurable: ui-bridge ships pre-compiled `dist/` JavaScript
 * and needs no transpilation, while cloud-control ships raw `.ts`/`.tsx`
 * and needs it. Both webpack's resolver and Next's `transpilePackages`
 * lookup canonicalise through the junction to the same real path, so the
 * package's files land inside the SWC loader's `include` and do compile —
 * verified by a composed `next build` on Windows, and by
 * `cloud-extensions-boot.registration.test.tsx`, which fails if the
 * registration ever stops landing.
 *
 * `npm install` / `npm ci` prunes the link as extraneous, so re-run
 * `npm run cloud:install` after either. `npm run cloud:status` reports
 * which shape the tree is currently in.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, "..");
const PKG_NAME = "@qontinui/cloud-control";
const DEST = path.join(FRONTEND_DIR, "node_modules", "@qontinui", "cloud-control");

/** Workspace layout: <root>/qontinui-web/frontend/scripts → <root>/qontinui-cloud-control */
const DEFAULT_SOURCE = path.resolve(FRONTEND_DIR, "..", "..", "qontinui-cloud-control");

function fail(message) {
  console.error(`[cloud-control-overlay] ${message}`);
  process.exit(1);
}

function resolveSource(argv) {
  const flagIndex = argv.indexOf("--source");
  const fromFlag = flagIndex !== -1 ? argv[flagIndex + 1] : undefined;
  const raw = fromFlag ?? process.env.QONTINUI_CLOUD_CONTROL_PATH ?? DEFAULT_SOURCE;
  const source = path.resolve(raw);

  const manifestPath = path.join(source, "package.json");
  if (!fs.existsSync(manifestPath)) {
    fail(
      `no package.json at ${manifestPath}.\n` +
        `  Clone qontinui-cloud-control beside qontinui-web, or pass\n` +
        `  --source <path> / set QONTINUI_CLOUD_CONTROL_PATH.`
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.name !== PKG_NAME) {
    fail(`${manifestPath} declares "${manifest.name}", expected "${PKG_NAME}".`);
  }
  if (!fs.existsSync(path.join(source, "frontend", "src", "index.ts"))) {
    fail(`${source} has no frontend/src/index.ts — not a usable cloud-control checkout.`);
  }
  return source;
}

/** `lstat` that returns null instead of throwing on ENOENT. */
function lstat(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function removeOverlay({ quiet = false } = {}) {
  const stats = lstat(DEST);
  if (!stats) {
    if (!quiet) console.log(`[cloud-control-overlay] nothing to remove at ${DEST}`);
    return false;
  }
  // A junction reports as a symlink to lstat, so one branch covers both the
  // link this script creates and a real directory left by `npm install`.
  if (stats.isSymbolicLink()) {
    fs.unlinkSync(DEST);
  } else {
    fs.rmSync(DEST, { recursive: true, force: true });
  }
  if (!quiet) console.log(`[cloud-control-overlay] removed ${DEST}`);
  return true;
}

function install(argv) {
  const source = resolveSource(argv);
  removeOverlay({ quiet: true });
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  // "junction" is the only link type Windows creates without elevation or
  // Developer Mode; it is directory-only, which is all we need.
  fs.symlinkSync(source, DEST, process.platform === "win32" ? "junction" : "dir");
  console.log(`[cloud-control-overlay] linked ${DEST}\n  -> ${source}`);
  console.log("[cloud-control-overlay] composed cloud build is now active for `npm run build`.");
}

function status() {
  const stats = lstat(DEST);
  if (!stats) {
    console.log("[cloud-control-overlay] OSS-only build (no overlay installed).");
    console.log(`  @qontinui/cloud-control resolves to src/cloud-absent/index.ts (a no-op).`);
    return;
  }
  const kind = stats.isSymbolicLink() ? "link" : "directory";
  const realPath = fs.realpathSync(DEST);
  console.log(`[cloud-control-overlay] composed cloud build (${kind}).`);
  console.log(`  ${DEST}\n  -> ${realPath}`);
}

const [command, ...argv] = process.argv.slice(2);
switch (command) {
  case "install":
    install(argv);
    break;
  case "remove":
    removeOverlay();
    break;
  case "status":
  case undefined:
    status();
    break;
  default:
    fail(`unknown command "${command}" (expected install | remove | status).`);
}
