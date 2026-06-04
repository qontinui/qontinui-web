#!/usr/bin/env node
// @ts-check
//
// refresh-baselines.mjs — regenerate the committed style-gate layout baselines
// (Phase 3 of the CI style-gating plan).
//
// For each route id in routes.json it runs the vision-audit bin's `baseline`
// mode against that route's captured snapshot artifact, writing
// baselines/<id>.json. Those baselines are the reference the
// `no_layout_shift_since` assertion compares against.
//
// Bin invocation (from rust-vision-core/src/bin/vision_audit.rs, run_baseline
// l.546-567; flags parsed l.547):
//
//     vision-audit baseline \
//       --snapshot   .artifacts/snapshots/<id>.json \
//       --name       <id> \
//       --baseline-dir baselines
//
// The bin reads the snapshot (unwrapping {data:...}/{elements:...}/bare-array
// envelopes), serializes its positioned elements' bboxes to
// <baseline-dir>/<id>.json, prints the JSON to stdout + a human summary to
// stderr, and exits 0 on success (1 on io/usage error). --name must be a simple
// stem (no path separators or dots — baseline_path, l.570-577); every route id
// in routes.json is already a filesystem-safe slug, so this holds.
//
// USAGE
//   node tests/e2e/style-gate/refresh-baselines.mjs [--bin <path>]
//
// Bin path resolution (first match wins):
//   1. --bin <path> CLI arg
//   2. $VISION_AUDIT_BIN
//   3. default ./vision-audit (on PATH / cwd; .exe auto-tried on win32)
//
// Run from the route of the captures: snapshots are resolved relative to THIS
// script's directory, so it works regardless of cwd.
//
// EXIT: 0 if every present route's baseline was (re)written; 1 if any bin call
// failed. Routes whose snapshot artifact is missing are SKIPPED (logged), not
// failed — a partial capture shouldn't blow up the refresh.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(HERE, ".artifacts", "snapshots");
const BASELINE_DIR = join(HERE, "baselines");
const ROUTES_JSON = join(HERE, "routes.json");

/** Resolve the vision-audit bin path: --bin arg > $VISION_AUDIT_BIN > default. */
function resolveBin() {
  const argv = process.argv.slice(2);
  const binIdx = argv.indexOf("--bin");
  if (binIdx !== -1) {
    const val = argv[binIdx + 1];
    if (!val) {
      console.error("error: --bin needs a path value");
      process.exit(1);
    }
    return val;
  }
  if (process.env.VISION_AUDIT_BIN) return process.env.VISION_AUDIT_BIN;
  // Default: a `vision-audit` resolvable on PATH or in cwd. On Windows, prefer
  // a local .exe if it exists next to cwd, else fall back to the bare name so
  // PATH lookup still works.
  if (process.platform === "win32") {
    const localExe = resolve("vision-audit.exe");
    if (existsSync(localExe)) return localExe;
  }
  return "vision-audit";
}

/** Load route ids from routes.json. */
function loadRouteIds() {
  let raw;
  try {
    raw = readFileSync(ROUTES_JSON, "utf8");
  } catch (e) {
    console.error(`error: cannot read ${ROUTES_JSON}: ${e.message}`);
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`error: ${ROUTES_JSON} is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  const routes = Array.isArray(parsed?.routes) ? parsed.routes : [];
  if (routes.length === 0) {
    console.error(`error: no routes found in ${ROUTES_JSON}`);
    process.exit(1);
  }
  return routes.map((r) => r.id).filter((id) => typeof id === "string");
}

function main() {
  const bin = resolveBin();
  const ids = loadRouteIds();

  console.error(`refresh-baselines: bin=${bin}`);
  console.error(`refresh-baselines: snapshot dir=${SNAPSHOT_DIR}`);
  console.error(`refresh-baselines: baseline dir=${BASELINE_DIR}`);
  console.error(`refresh-baselines: ${ids.length} route(s): ${ids.join(", ")}`);

  let wrote = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of ids) {
    const snapshot = join(SNAPSHOT_DIR, `${id}.json`);
    if (!existsSync(snapshot)) {
      console.error(
        `  SKIP ${id}: snapshot artifact missing (${snapshot}) — run the capture first`,
      );
      skipped++;
      continue;
    }

    const args = [
      "baseline",
      "--snapshot",
      snapshot,
      "--name",
      id,
      "--baseline-dir",
      BASELINE_DIR,
    ];
    const res = spawnSync(bin, args, { stdio: ["ignore", "ignore", "inherit"] });

    if (res.error) {
      console.error(
        `  FAIL ${id}: cannot run bin (${bin}): ${res.error.message}`,
      );
      failed++;
      continue;
    }
    if (res.status !== 0) {
      console.error(
        `  FAIL ${id}: vision-audit baseline exited ${res.status}` +
          (res.signal ? ` (signal ${res.signal})` : ""),
      );
      failed++;
      continue;
    }
    console.error(`  OK   ${id}: wrote ${join("baselines", `${id}.json`)}`);
    wrote++;
  }

  console.error(
    `refresh-baselines: ${wrote} written, ${skipped} skipped, ${failed} failed`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main();
