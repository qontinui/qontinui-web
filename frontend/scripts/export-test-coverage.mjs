#!/usr/bin/env node
// @ts-check
/**
 * Per-test-FILE -> touched-file coverage producer for coord.
 *
 * vitest 4 + @vitest/coverage-v8 expose NO per-test-CASE coverage contexts
 * (unlike coverage.py's --cov-context=test on the backend), so the honest,
 * mechanically-exact granularity here is per-test-FILE. vitest's default
 * isolation is already one worker per test file, so running `vitest run
 * --coverage <one-file>` yields a coverage-final.json whose covered statements
 * are exactly the source files that ONE test file exercised. We loop over every
 * test file, attribute its covered source files to it, and emit one observation
 * per test file with `test_id` = the repo-relative test file path.
 *
 * Concurrency: files run COVERAGE_PRODUCER_CONCURRENCY at a time (default 1).
 * Each file is its own vitest process writing into its own temp dir, so the
 * runs share nothing but the read-only source tree; results are kept in
 * discovery order whatever order they finish in. The serial loop stopped
 * fitting its 45-min job cap once the suite passed ~800 files (2026-11-05:
 * five consecutive main runs cancelled at 741/812, each delivering nothing,
 * because every POST happens after the loop).
 *
 * Cadence: this is a main-only, NON-gating job. Per-file vitest startup is slow
 * (~5-15s each) and there are ~70+ test files, so a full run is many minutes —
 * unacceptable for a PR gate but fine for a push-to-main producer whose output
 * coord caches per (repo, head_sha). PR lanes consume the map; they never run
 * this.
 *
 * test_id alignment (LOAD-BEARING):
 *   - Coverage observations are per-test-FILE: test_id = "frontend/src/...test.tsx".
 *   - coord derives a per-test-CASE test_id from JUnit XML as `{classname}::{name}`.
 *     vitest's JUnit reporter sets classname = the test FILE path (frontend-cwd
 *     relative, e.g. "src/...test.tsx"). We rewrite those classnames to the SAME
 *     repo-relative form ("frontend/src/...test.tsx") before POSTing, so every
 *     per-case result test_id is `<coverage test_id>::<case name>`. The coverage
 *     test_id is therefore an exact prefix of the result test_ids from the same
 *     file — a clean documented join (results.test_id startsWith coverage.test_id)
 *     despite the deliberate file-vs-case granularity gap. Verified locally
 *     against vitest 4.1.5 JUnit + v8 coverage-final.json output.
 *
 * Best-effort: any POST failure prints a warning and exits 0 — never fails CI.
 * node stdlib only.
 */

import { spawn } from "node:child_process";
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep, posix } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "qontinui-web";
const DEFAULT_COORD_URL = "https://coord.qontinui.io";
const OBSERVE_PATH = "/coord/test-coverage/observe";
const RESULTS_PATH = "/coord/test-results/ingest";

// One test file's vitest run is killed after this long, so a hung file costs
// one worker this much instead of the whole job its cap. The slowest file in
// the 2026-11-05 nawa run took 167s; the median 2.4s.
const PER_FILE_TIMEOUT_MS =
  (parseInt(process.env.COVERAGE_PRODUCER_FILE_TIMEOUT_SECS || "", 10) || 600) * 1000;

const COORD_URL = (process.env.COORD_HTTP_URL || DEFAULT_COORD_URL).replace(/\/+$/, "");
const HEAD_SHA = process.env.GITHUB_SHA || "";

function warn(msg) {
  process.stderr.write(`[export-test-coverage] WARNING: ${msg}\n`);
}
function info(msg) {
  process.stdout.write(`[export-test-coverage] ${msg}\n`);
}

/** Parse simple CLI flags. */
function parseArgs(argv) {
  const args = { dryRun: false, limit: 0, concurrency: 1 };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--limit=")) args.limit = parseInt(a.slice("--limit=".length), 10) || 0;
  }
  // Env overrides (handy for CI matrix / local probing).
  if (process.env.COVERAGE_PRODUCER_LIMIT) {
    args.limit = parseInt(process.env.COVERAGE_PRODUCER_LIMIT, 10) || args.limit;
  }
  if (process.env.COVERAGE_PRODUCER_DRY_RUN === "1") args.dryRun = true;
  if (process.env.COVERAGE_PRODUCER_CONCURRENCY) {
    args.concurrency = parseInt(process.env.COVERAGE_PRODUCER_CONCURRENCY, 10) || args.concurrency;
  }
  args.concurrency = Math.max(1, args.concurrency);
  return args;
}

/**
 * Recursively enumerate test files under frontend/src.
 * Mirrors vitest.config.ts include globs: src/**\/*.{test,spec}.{ts,tsx}.
 * Returns paths relative to the frontend cwd, posix-separated, sorted.
 */
function enumerateTestFiles(root) {
  const out = [];
  const isTest = (name) => /\.(test|spec)\.(ts|tsx)$/.test(name);
  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "node_modules") continue;
        walk(full);
      } else if (isTest(entry)) {
        out.push(full);
      }
    }
  }
  walk(root);
  // Normalize to frontend-cwd-relative posix paths (e.g. "src/foo/bar.test.tsx").
  const cwd = process.cwd();
  return out
    .map((p) => p.startsWith(cwd) ? p.slice(cwd.length + 1) : p)
    .map((p) => p.split(sep).join(posix.sep))
    .sort();
}

/** "src/foo/bar.test.tsx" (frontend-relative) -> "frontend/src/foo/bar.test.tsx". */
function toRepoRelTestId(frontendRelPath) {
  const norm = frontendRelPath.split(sep).join(posix.sep).replace(/^\.\//, "");
  return norm.startsWith("frontend/") ? norm : `frontend/${norm}`;
}

/**
 * Normalize a coverage-final.json source path to a repo-relative forward-slash
 * path rooted at frontend/src. Drops anything outside frontend/src (node_modules,
 * test setup, etc.) and the test files themselves — only source attribution is
 * signal.
 * @returns {string|null}
 */
function normalizeSourcePath(absOrRel) {
  const p = absOrRel.split("\\").join("/");
  const marker = "/frontend/src/";
  let rel;
  const idx = p.indexOf(marker);
  if (idx !== -1) {
    rel = p.slice(idx + 1); // -> "frontend/src/..."
  } else if (p.startsWith("frontend/src/")) {
    rel = p;
  } else if (p.startsWith("src/")) {
    rel = `frontend/${p}`;
  } else {
    return null;
  }
  // Don't attribute a test file to itself.
  if (/\.(test|spec)\.(ts|tsx)$/.test(rel)) return null;
  if (!rel.startsWith("frontend/src/")) return null;
  return rel;
}

/**
 * How old a `covprod-*` dir must be before the startup sweep removes it. One
 * dir lives for one vitest run of one test file (seconds), so an hour-old one
 * belongs to no live producer.
 */
export const STALE_SCRATCH_DIR_MS = 60 * 60 * 1000;

/**
 * Remove `covprod-*` dirs under the OS tmpdir whose mtime is older than
 * `maxAgeMs`. withScratchDir's `finally` does not run when the job is
 * cancelled mid-file -- a superseded run (concurrency cancel-in-progress) or
 * one that hits its timeout gets SIGINT/SIGTERM and then SIGKILL, and node's
 * default signal handling exits without unwinding -- so each such run leaves
 * the in-flight dir behind (measured on nawa 2026-11-12: four cancelled post-fix runs, four
 * leftover dirs). The next run on the same runner removes them here, which
 * bounds the leftovers to the last killed run's one dir per runner unit.
 * Best-effort: any error is swallowed, the producer never fails on it.
 * @param {number} [maxAgeMs]
 * @param {number} [now]
 * @returns {number} how many dirs were removed
 */
export function sweepStaleScratchDirs(maxAgeMs = STALE_SCRATCH_DIR_MS, now = Date.now()) {
  let removed = 0;
  let names = [];
  try {
    names = readdirSync(tmpdir());
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.startsWith("covprod-")) continue;
    const p = join(tmpdir(), name);
    try {
      const st = statSync(p);
      if (!st.isDirectory() || now - st.mtimeMs < maxAgeMs) continue;
      rmSync(p, { recursive: true, force: true });
      removed++;
    } catch {
      // Raced with another remover, or not ours to remove -- skip it.
    }
  }
  return removed;
}

/**
 * Run `fn` with a fresh `covprod-*` dir under the OS tmpdir, and remove that
 * dir afterwards, also when `fn` throws. `fn` must read everything it needs out
 * of the dir before returning. Without the removal every test file leaves a
 * ~24 MB dir behind, and on a CI runner whose /tmp is a RAM-backed PrivateTmp
 * that is RAM held for the life of the runner unit (plan
 * 2026-11-10-devops-coverage-producer-leaves-a-covprod-dir-per-test-file-in-ram-tmp).
 * @template T
 * @param {(dir: string) => T} fn  sync or async; an async fn's dir is removed once it settles
 * @returns {T}
 */
export function withScratchDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "covprod-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  let result;
  try {
    result = fn(dir);
  } catch (e) {
    cleanup();
    throw e;
  }
  // An async `fn` keeps using the dir until it settles, so remove it then.
  if (result && typeof result.then === "function") {
    return result.finally(cleanup);
  }
  cleanup();
  return result;
}

/**
 * Run vitest once for a single test file, collecting v8 coverage JSON + JUnit.
 * @returns {Promise<{ filesTouched: string[], junitXml: string|null }>}
 */
async function runOneFile(testFileRel, outDir) {
  const junitPath = join(outDir, "junit.xml");
  // vitest 4 CLI: --coverage enables, --coverage.* configure the v8 provider.
  // --coverage.include is omitted on purpose: v8's default ("only files covered
  // by tests are included") is exactly the touched-file set we want.
  const cliArgs = [
    "vitest",
    "run",
    "--coverage",
    "--coverage.enabled=true",
    "--coverage.provider=v8",
    "--coverage.reporter=json",
    `--coverage.reportsDirectory=${outDir}`,
    "--reporter=junit",
    `--outputFile=${junitPath}`,
    testFileRel,
  ];
  /** @type {number|null} */
  const status = await new Promise((resolve) => {
    const child = spawn("npx", cliArgs, {
      shell: process.platform === "win32",
      // Its own process group, so a timeout kills npx AND the vitest it
      // started rather than orphaning the latter.
      detached: process.platform !== "win32",
      // Output is discarded, as before: the junit + coverage files are the
      // result. "ignore" rather than unread pipes, which would fill and stall
      // a chatty test file.
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      warn(`vitest for ${testFileRel} exceeded ${PER_FILE_TIMEOUT_MS / 1000}s -- killing it`);
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, PER_FILE_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      warn(`failed to spawn vitest for ${testFileRel}: ${e}`);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  if (status !== 0) {
    // A failing/erroring test file still produces coverage+junit for what ran;
    // warn but proceed so one bad file doesn't sink the whole producer.
    warn(`vitest exited ${status} for ${testFileRel} (continuing)`);
  }

  /** @type {string[]} */
  let filesTouched = [];
  const covPath = join(outDir, "coverage-final.json");
  if (existsSync(covPath)) {
    try {
      const cov = JSON.parse(readFileSync(covPath, "utf-8"));
      const touched = new Set();
      for (const key of Object.keys(cov)) {
        const entry = cov[key];
        const s = entry.s || {};
        const coveredStmts = Object.values(s).filter((n) => n > 0).length;
        if (coveredStmts <= 0) continue;
        const norm = normalizeSourcePath(entry.path || key);
        if (norm) touched.add(norm);
      }
      filesTouched = [...touched].sort();
    } catch (e) {
      warn(`failed to parse coverage json for ${testFileRel}: ${e}`);
    }
  } else {
    warn(`no coverage-final.json produced for ${testFileRel}`);
  }

  let junitXml = null;
  if (existsSync(junitPath)) {
    junitXml = readFileSync(junitPath, "utf-8");
  }
  return { filesTouched, junitXml };
}

/**
 * Rewrite vitest JUnit classnames from frontend-relative ("src/...test.tsx") to
 * repo-relative ("frontend/src/...test.tsx") so coord's derived per-case test_id
 * (`classname::name`) shares the exact `frontend/...` prefix the coverage
 * observation uses. Pure string rewrite on the classname attribute value.
 */
function rewriteJunitClassnames(xml) {
  return xml.replace(/classname="([^"]*)"/g, (m, cn) => {
    const repoRel = toRepoRelTestId(cn);
    return `classname="${repoRel}"`;
  });
}

/**
 * Print the response body (truncated ~300 chars) and warn on partial/unparseable
 * persists. Visibility is the point: a silently-empty or partially-persisted
 * batch hid for half a day because we only logged the status code. The observe
 * route returns `{accepted, persisted, failed?}` and the results ingest returns
 * a similar JSON body; surface it on EVERY POST and shout when
 * `persisted < accepted` or the body can't be parsed.
 */
function logResponseBody(url, status, body) {
  const snippet = body.length <= 300 ? body : body.slice(0, 300) + "...(truncated)";
  info(`POST ${url} -> ${status} body=${snippet}`);
  let parsed;
  try {
    parsed = body.trim() ? JSON.parse(body) : {};
  } catch {
    warn(`POST ${url} -> ${status}: response body is not valid JSON (see body above)`);
    return;
  }
  if (parsed && typeof parsed === "object" && "accepted" in parsed && "persisted" in parsed) {
    const { accepted, persisted, failed } = parsed;
    if (typeof accepted === "number" && typeof persisted === "number") {
      if (persisted < accepted) {
        warn(
          `POST ${url}: persisted (${persisted}) < accepted (${accepted}) ` +
            `-- batch partially dropped` +
            (failed !== undefined ? `, failed=${JSON.stringify(failed)}` : "")
        );
      }
    } else {
      warn(`POST ${url}: non-numeric accepted/persisted in body (see body above)`);
    }
  }
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body = "";
  try {
    body = await res.text();
  } catch (e) {
    warn(`POST ${url} -> ${res.status}: failed to read response body: ${e}`);
  }
  logResponseBody(url, res.status, body);
  if (!res.ok) {
    throw new Error(`non-2xx ${res.status} from ${url}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!HEAD_SHA && !args.dryRun) {
    warn("GITHUB_SHA not set; cannot key observations — exiting 0 (best-effort)");
    return 0;
  }
  const headSha = HEAD_SHA || "dryrun-sha";

  const srcRoot = join(process.cwd(), "src");
  if (!existsSync(srcRoot)) {
    warn(`src/ not found at ${srcRoot} (run from frontend/) — exiting 0`);
    return 0;
  }

  let testFiles = enumerateTestFiles(srcRoot);
  info(`discovered ${testFiles.length} test files`);
  if (args.limit > 0) {
    testFiles = testFiles.slice(0, args.limit);
    info(`limiting to first ${testFiles.length} test files`);
  }

  info(`running ${testFiles.length} test files, ${args.concurrency} at a time`);

  const swept = sweepStaleScratchDirs();
  if (swept > 0) info(`removed ${swept} stale covprod-* dir(s) left by a killed run`);

  /** @type {({ filesTouched: string[], junitXml: string|null } | undefined)[]} */
  const results = new Array(testFiles.length);
  let next = 0;
  async function worker() {
    while (next < testFiles.length) {
      const i = next++;
      const testFileRel = testFiles[i];
      info(`running [${i + 1}/${testFiles.length}] ${testFileRel}`);
      results[i] = await withScratchDir((outDir) => runOneFile(testFileRel, outDir));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, testFiles.length) }, () => worker())
  );

  /** @type {object[]} */
  const observations = [];
  /** @type {string[]} */
  const junitDocs = [];

  for (const [i, testFileRel] of testFiles.entries()) {
    const { filesTouched, junitXml } = results[i] ?? { filesTouched: [], junitXml: null };

    const testId = toRepoRelTestId(testFileRel);
    observations.push({
      repo: REPO,
      head_sha: headSha,
      test_id: testId,
      files_touched: filesTouched,
      // v8 reports per-file statement maps but we attribute at file granularity;
      // a single per-test line count isn't meaningful here, so null.
      lines_covered: null,
      coverage_kind: "line",
    });

    if (junitXml) {
      junitDocs.push(rewriteJunitClassnames(junitXml));
    }
  }

  const batch = { observations };

  if (args.dryRun) {
    info("--dry-run: printing batch JSON, skipping POSTs");
    process.stdout.write(JSON.stringify(batch, null, 2) + "\n");
    info(`(would also POST ${junitDocs.length} JUnit document(s) to ${RESULTS_PATH})`);
    return 0;
  }

  // Best-effort POSTs: a failure in one must not skip the other or fail the lane.
  try {
    if (observations.length > 0) {
      await postJson(COORD_URL + OBSERVE_PATH, batch);
    } else {
      info("no observations to post");
    }
  } catch (e) {
    warn(`coverage observe POST failed: ${e} — continuing (best-effort)`);
  }

  // Each per-file vitest run emits its own JUnit doc; POST each (coord parses
  // JUnit XML per call and upserts results keyed by repo/head_sha/test_id).
  for (const xml of junitDocs) {
    try {
      await postJson(COORD_URL + RESULTS_PATH, {
        repo: REPO,
        head_sha: headSha,
        source: "ci",
        format: "junit_xml",
        raw: xml,
      });
    } catch (e) {
      warn(`junit results POST failed: ${e} — continuing (best-effort)`);
    }
  }

  return 0;
}

// Run only when executed directly, so a test can import withScratchDir.
// import.meta.url names the real path, so compare against argv[1]'s real path.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      // Top-level guard: never fail the lane.
      warn(`unexpected error: ${e} — exiting 0 (best-effort)`);
      process.exit(0);
    });
}
