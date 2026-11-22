/**
 * Design-guide route sweep: `design-kit validate-guide` over every static
 * route of this app, recorded as one machine-readable report. A MEASUREMENT,
 * never a gate.
 *
 * Plan 2026-11-21-design-kit-compiler-gaps-and-the-unrequired-design-guide-check,
 * Phase 8 (and D5: the sweep runs on the hermetic authed CI stack's PRODUCTION
 * server, through e2e-playwright-stack.yml's `design_guide_sweep` dispatch
 * input). Runs ONLY under the `design-guide-sweep` Playwright project, which
 * depends on `setup` for the storage state every `(app)` route needs.
 *
 * Shape:
 *   - The routes are enumerated from `src/app/**\/page.tsx` when this file
 *     loads (./design-guide-sweep/routes.ts). Dynamic and intercepting routes
 *     are recorded `not_swept` with their file; private folders `not_a_route`.
 *   - One test() per static route, so no two routes share a timeout. Each
 *     spawns the kit's CLI with `--storage-state`, `--json` and the guide. The
 *     test does not open a page itself: the kit drives its own wrapper browser.
 *   - Exit 1 (rule failures) and exit 3 (UNKNOWN) are the measurement and
 *     PASS. A test fails only on a HARNESS error: the CLI is missing, it exited
 *     2 (refused/misused/crashed: the kit maps any thrown error that is not an
 *     `unknown(...)` to 2), it exited outside 0-3 or by signal, it ran past the
 *     per-route bound, or exit 0/1/3 came without a readable `--json` report.
 *   - Each test writes its own record to disk, and the LAST test of this file
 *     aggregates the records into `design-guide-sweep.json`.
 *
 * WHY A FINAL TEST AND NOT globalTeardown. globalTeardown is config-wide: it
 * runs for every project (chromium shards included), and it would need its own
 * "did the sweep run" detection. A project `teardown` hangs off a dependency
 * (`setup`), which every authed project shares. A dependent "report" project
 * is skipped when any test it depends on fails, so one harness error would
 * lose the whole report. The final test runs because this project is
 * `fullyParallel: false` with one worker: the file's tests run in declaration
 * order, and after a failed test Playwright starts a fresh worker and goes on
 * with the NEXT test, so the aggregator still runs last. Records live on disk,
 * not in memory, because that fresh worker re-imports this module.
 *
 * Env:
 *   DESIGN_KIT_BIN                 the CLI (default frontend/design/kit/node_modules/.bin/design-kit;
 *                                  a .js/.mjs path is run with this node)
 *   DESIGN_KIT_ROOT                the kit tool directory passed as --root, where validate-guide
 *                                  resolves its wrapper (default: the directory above node_modules/.bin)
 *   DESIGN_GUIDE_PATH              the guide (default src/config/qontinui-web.styleguide.uibridge.json)
 *   DESIGN_GUIDE_SWEEP_OUT         output dir (default frontend/test-results/design-guide-sweep)
 *   DESIGN_GUIDE_SWEEP_TIMEOUT_MS  per-route test timeout (default 120000)
 *   DESIGN_GUIDE_SWEEP_LIMIT       sweep only the first N static routes (the sizing sample)
 *   PLAYWRIGHT_BASE_URL            origin (default http://localhost:3001, as playwright.config.ts)
 *   DESIGN_KIT_PLAYWRIGHT_BROWSERS_PATH
 *                                  PLAYWRIGHT_BROWSERS_PATH for the kit's CLI only (set by CI when the
 *                                  kit's Chromium is installed apart from frontend's)
 */
import { test, type TestInfo } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  enumerate,
  listPageFiles,
  slugOf,
  type SweepRoute,
} from "./design-guide-sweep/routes";

const FRONTEND_DIR = path.resolve(__dirname, "../..");
const APP_DIR = path.join(FRONTEND_DIR, "src/app");

function intEnv(name: string, fallback: number | null): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(
      `${name} must be a positive integer; got ${JSON.stringify(raw)}`
    );
  return n;
}

const TIMEOUT_MS = intEnv("DESIGN_GUIDE_SWEEP_TIMEOUT_MS", 120_000) ?? 120_000;
const LIMIT = intEnv("DESIGN_GUIDE_SWEEP_LIMIT", null);
const ORIGIN = (
  process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001"
).replace(/\/+$/, "");
const OUT_DIR = path.resolve(
  FRONTEND_DIR,
  process.env.DESIGN_GUIDE_SWEEP_OUT || "test-results/design-guide-sweep"
);
const ROUTE_JSON_DIR = path.join(OUT_DIR, "routes");
const RECORD_DIR = path.join(OUT_DIR, "records");
const GUIDE = path.resolve(
  FRONTEND_DIR,
  process.env.DESIGN_GUIDE_PATH ||
    "src/config/qontinui-web.styleguide.uibridge.json"
);
const KIT_BIN = path.resolve(
  FRONTEND_DIR,
  process.env.DESIGN_KIT_BIN || "design/kit/node_modules/.bin/design-kit"
);
const KIT_ROOT = process.env.DESIGN_KIT_ROOT
  ? path.resolve(FRONTEND_DIR, process.env.DESIGN_KIT_ROOT)
  : path.basename(path.dirname(KIT_BIN)) === ".bin"
    ? path.resolve(path.dirname(KIT_BIN), "../..")
    : path.dirname(KIT_BIN);
/** Set once per run in playwright.config.ts; a record from an earlier run is never aggregated. */
const RUN_ID = process.env.DESIGN_GUIDE_SWEEP_RUN_ID ?? "unset";

const ENUM = enumerate(listPageFiles(APP_DIR));
const SWEPT: SweepRoute[] =
  LIMIT === null ? ENUM.static_routes : ENUM.static_routes.slice(0, LIMIT);

/** What one route's test leaves on disk for the aggregator. */
interface RouteRecord {
  run_id: string;
  route: string;
  files: string[];
  url: string;
  json: string;
  exit_code: number | null;
  signal: string | null;
  elements: number | null;
  rules: number | null;
  /** Rule id -> the element ids that failed it, as the kit's `failuresByRule`. */
  failures_by_rule: Record<string, string[]> | null;
  unmatchedRules: string[] | null;
  stylesheets: unknown;
  unknown_reason: string | null;
  instrument: string | null;
  duration_ms: number;
  harness_error: string | null;
  output_tail: string | null;
}

/** The command that runs the CLI. On Windows a `.bin` shim is a .cmd, so the package's JS entry is run with node instead. */
function kitCommand(): { cmd: string; pre: string[] } | null {
  if (/\.(c|m)?js$/.test(KIT_BIN))
    return fs.existsSync(KIT_BIN)
      ? { cmd: process.execPath, pre: [KIT_BIN] }
      : null;
  if (process.platform === "win32") {
    try {
      const pkgFile = path.join(
        KIT_ROOT,
        "node_modules/@qontinui/design-kit/package.json"
      );
      const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8")) as {
        bin?: string | Record<string, string>;
      };
      const rel =
        typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["design-kit"];
      if (!rel) return null;
      const js = path.resolve(path.dirname(pkgFile), rel);
      return fs.existsSync(js) ? { cmd: process.execPath, pre: [js] } : null;
    } catch {
      return null;
    }
  }
  return fs.existsSync(KIT_BIN) ? { cmd: KIT_BIN, pre: [] } : null;
}

function run(cmd: string, args: string[], timeoutMs: number) {
  return new Promise<{
    code: number | null;
    signal: string | null;
    output: string;
    timedOut: boolean;
  }>((resolve) => {
    // NODE_OPTIONS is dropped: a Playwright worker may carry its own TS/ESM
    // loader there, and the kit's CLI is plain built JS that must not inherit
    // it. The kit's Chromium cache is swapped in when CI installed it apart
    // from frontend's (e2e-playwright-stack.yml, the sweep's CDN step).
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.NODE_OPTIONS;
    if (process.env.DESIGN_KIT_PLAYWRIGHT_BROWSERS_PATH) {
      env.PLAYWRIGHT_BROWSERS_PATH =
        process.env.DESIGN_KIT_PLAYWRIGHT_BROWSERS_PATH;
    }
    const child = spawn(cmd, args, {
      cwd: FRONTEND_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const keep = (b: Buffer) => {
      output = (output + b.toString("utf8")).slice(-8000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        code: null,
        signal: null,
        output: `${output}\nspawn error: ${e.message}`,
        timedOut,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output, timedOut });
    });
  });
}

function storageStateOf(info: TestInfo): string | null {
  const s = info.project.use.storageState;
  if (typeof s !== "string") return null;
  const base = info.config.configFile
    ? path.dirname(info.config.configFile)
    : FRONTEND_DIR;
  return path.resolve(base, s);
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function writeJsonFile(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

for (const r of SWEPT) {
  test(`validate-guide ${r.route}`, async () => {
    const info = test.info();
    test.setTimeout(TIMEOUT_MS);
    const slug = slugOf(r.route);
    const recordFile = path.join(RECORD_DIR, `${slug}.json`);
    const jsonFile = path.join(ROUTE_JSON_DIR, `${slug}.json`);
    fs.rmSync(recordFile, { force: true });
    fs.rmSync(jsonFile, { force: true });
    const url = ORIGIN + r.route;
    const rec: RouteRecord = {
      run_id: RUN_ID,
      route: r.route,
      files: r.files,
      url,
      json: path.relative(OUT_DIR, jsonFile).split(path.sep).join("/"),
      exit_code: null,
      signal: null,
      elements: null,
      rules: null,
      failures_by_rule: null,
      unmatchedRules: null,
      stylesheets: null,
      unknown_reason: null,
      instrument: null,
      duration_ms: 0,
      harness_error: null,
      output_tail: null,
    };
    const started = Date.now();
    try {
      const kit = kitCommand();
      const state = storageStateOf(info);
      if (!kit)
        rec.harness_error = `design-kit CLI not found at ${KIT_BIN} (set DESIGN_KIT_BIN)`;
      else if (!state)
        rec.harness_error = "the project has no storageState path";
      else {
        const args = [
          ...kit.pre,
          "validate-guide",
          "--root",
          KIT_ROOT,
          "--storage-state",
          state,
          "--json",
          jsonFile,
          GUIDE,
          url,
        ];
        // Kill the CLI before Playwright's own timeout, so the record is written and names the cause.
        const res = await run(
          kit.cmd,
          args,
          Math.max(1_000, TIMEOUT_MS - 5_000)
        );
        rec.exit_code = res.code;
        rec.signal = res.signal;
        const report = readJson(jsonFile);
        if (res.timedOut)
          rec.harness_error = `validate-guide ran past ${TIMEOUT_MS - 5_000} ms and was killed`;
        else if (res.code === 0 || res.code === 1 || res.code === 3) {
          if (!report)
            rec.harness_error = `validate-guide exited ${res.code} but wrote no readable --json report at ${jsonFile}`;
          else if (report.exitCode !== res.code)
            rec.harness_error = `the --json report says exitCode ${String(report.exitCode)}, the process exited ${res.code}`;
        } else if (res.code === 2)
          rec.harness_error =
            "validate-guide exited 2 (refused, misused, or crashed): not a measurement";
        else
          rec.harness_error = `validate-guide exited ${res.code === null ? `by signal ${res.signal ?? "?"}` : res.code}, outside 0-3`;
        if (report) {
          rec.elements =
            typeof report.elements === "number" ? report.elements : null;
          rec.rules = typeof report.rules === "number" ? report.rules : null;
          rec.failures_by_rule =
            (report.failuresByRule as Record<string, string[]> | null) ?? null;
          rec.unmatchedRules =
            (report.unmatchedRules as string[] | null) ?? null;
          rec.stylesheets = report.stylesheets ?? null;
          rec.unknown_reason =
            typeof report.unknown === "string" ? report.unknown : null;
          rec.instrument =
            typeof report.instrument === "string" ? report.instrument : null;
        }
        if (rec.harness_error) rec.output_tail = res.output.slice(-2000);
      }
    } catch (e) {
      rec.harness_error = `harness threw: ${(e as Error).message}`;
    } finally {
      rec.duration_ms = Date.now() - started;
      writeJsonFile(recordFile, rec);
    }
    info.annotations.push({
      type: "validate-guide",
      description: `exit ${String(rec.exit_code)} in ${rec.duration_ms} ms`,
    });
    if (rec.harness_error)
      throw new Error(
        `${r.route}: ${rec.harness_error}\n${rec.output_tail ?? ""}`
      );
  });
}

function gitSha(): string | null {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: FRONTEND_DIR,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function kitVersion(): {
  version: string | null;
  resolved: string | null;
  root: string;
} {
  const pkg = readJson(
    path.join(KIT_ROOT, "node_modules/@qontinui/design-kit/package.json")
  );
  const lock = readJson(path.join(KIT_ROOT, "package-lock.json"));
  const pkgs = (lock?.packages ?? null) as Record<
    string,
    { resolved?: string }
  > | null;
  return {
    version: typeof pkg?.version === "string" ? pkg.version : null,
    resolved: pkgs?.["node_modules/@qontinui/design-kit"]?.resolved ?? null,
    root: KIT_ROOT,
  };
}

// Declared LAST: see "WHY A FINAL TEST" above. It fails only when it cannot
// write the report; harness errors were already reported by their own tests.
test("write design-guide-sweep.json", async () => {
  const routes: (
    | RouteRecord
    | { route: string; files: string[]; harness_error: string }
  )[] = SWEPT.map((r) => {
    const rec = readJson(
      path.join(RECORD_DIR, `${slugOf(r.route)}.json`)
    ) as RouteRecord | null;
    if (rec && rec.run_id === RUN_ID) return rec;
    return {
      route: r.route,
      files: r.files,
      harness_error: rec
        ? "only a record from an earlier run exists"
        : "no record: the route's test did not run",
    };
  });
  const byExit: Record<string, number> = {};
  const byRule: Record<string, { routes: number; elements: number }> = {};
  const byUnknown: Record<string, number> = {};
  for (const r of routes) {
    const key = r.harness_error
      ? "harness_error"
      : String((r as RouteRecord).exit_code);
    byExit[key] = (byExit[key] ?? 0) + 1;
    const full = r as Partial<RouteRecord>;
    for (const [rule, els] of Object.entries(full.failures_by_rule ?? {})) {
      const t = (byRule[rule] ??= { routes: 0, elements: 0 });
      t.routes += 1;
      t.elements += els.length;
    }
    if (full.unknown_reason) {
      const kind =
        /^unknown\([^)]*\)/.exec(full.unknown_reason)?.[0] ??
        full.unknown_reason;
      byUnknown[kind] = (byUnknown[kind] ?? 0) + 1;
    }
  }
  const report = {
    schema: 1,
    generated_at: new Date().toISOString(),
    sha: gitSha(),
    kit: kitVersion(),
    guide: path.relative(FRONTEND_DIR, GUIDE).split(path.sep).join("/"),
    origin: ORIGIN,
    per_route_timeout_ms: TIMEOUT_MS,
    page_count: ENUM.page_count,
    static_count: ENUM.static_routes.length,
    limited_to: LIMIT,
    swept_count: SWEPT.length,
    not_swept: ENUM.not_swept,
    not_a_route: ENUM.not_a_route,
    totals: {
      by_exit_code: byExit,
      by_rule: byRule,
      by_unknown_reason: byUnknown,
    },
    routes,
  };
  writeJsonFile(path.join(OUT_DIR, "design-guide-sweep.json"), report);
});
