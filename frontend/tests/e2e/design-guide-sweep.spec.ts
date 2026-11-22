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
 *   - Each test writes its own record to disk and then REWRITES
 *     `design-guide-sweep.json` from every record of this run, so a run
 *     cancelled or timed out mid-sweep still leaves a report covering every
 *     route that finished. The LAST test of this file writes it once more.
 *     Two separate fields say how far it got: `reached_end` (the final test
 *     ran) and `complete` (every swept route has a record of this run, i.e.
 *     `recorded_count === swept_count`). A run can reach the end incomplete
 *     (a `--grep`, a worker crash before a record), and a run cut short
 *     after its last route is complete without reaching the end.
 *   - On a per-route timeout the kit's WHOLE process tree is killed: the CLI,
 *     the wrapper's inject-cli and the Chromium it launched (see killTree).
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
 * not in memory, because that fresh worker re-imports this module. The
 * per-route rewrite is what covers the case the final test cannot: a run that
 * never reaches it.
 *
 * TIMEOUT CEILING. The kit's own door kills its wrapper at 180 s
 * (src/door/inject.ts `timeoutMs ?? 180_000` in design-kit v0.2.0), after which
 * the CLI answers exit 3 `unknown(instrument-cannot-read)`. A per-route timeout
 * much above ~185 s therefore buys nothing; this harness kills the tree 5 s
 * before Playwright's own timeout (the "kill bound", printed per route).
 *
 * The project exists only when DESIGN_GUIDE_SWEEP=1 (playwright.config.ts), so
 * a bare `playwright test` never runs it.
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

/** Rule id -> its severity and the element ids that failed it. */
type FailuresByRule = Record<string, { severity: string; elements: string[] }>;

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
  /** Built from the kit's `failures` (each carries its rule's severity); null when the kit evaluated nothing. */
  failures_by_rule: FailuresByRule | null;
  /** Failure count per severity (`error` fails a page under the kit, `warning`/`info` do not); null as above. */
  failures_by_severity: Record<string, number> | null;
  unmatchedRules: string[] | null;
  stylesheets: unknown;
  unknown_reason: string | null;
  instrument: string | null;
  duration_ms: number;
  kill_bound_ms: number;
  harness_error: string | null;
  output_tail: string | null;
}

/** Per-route test bound minus a margin, so the record is written before Playwright gives up. */
const KILL_BOUND_MS = Math.max(1_000, TIMEOUT_MS - 5_000);

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

/**
 * Kill a process and everything under it. The kit's door spawns
 * `ui-bridge-inject`, which launches Chromium through Playwright, and
 * Playwright starts the browser in a process group of its own on POSIX, so a
 * group kill alone can miss it: the descendants are therefore read from `ps`
 * FIRST (before the kill reparents them), then the group and each pid get
 * SIGKILL. On Windows `taskkill /T` walks the tree from that one pid.
 */
function killTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      // Already gone, or nothing left to kill.
    }
    return;
  }
  const pids = [pid];
  try {
    const table = execFileSync("ps", ["-A", "-o", "pid=,ppid="], {
      encoding: "utf8",
    });
    const children = new Map<number, number[]>();
    for (const line of table.split("\n")) {
      const [c, p] = line.trim().split(/\s+/).map(Number);
      if (
        c === undefined ||
        p === undefined ||
        Number.isNaN(c) ||
        Number.isNaN(p)
      )
        continue;
      children.set(p, [...(children.get(p) ?? []), c]);
    }
    for (let i = 0; i < pids.length; i++)
      pids.push(...(children.get(pids[i]!) ?? []));
  } catch {
    // No `ps`: the group kill below still reaches everything that kept the group.
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
  for (const p of pids) {
    try {
      process.kill(p, "SIGKILL");
    } catch {
      // Already exited.
    }
  }
}

/**
 * The kit trees this worker has running. `detached` puts each in a process
 * group (a session, on Linux) of its own, so a Ctrl+C or a job cancellation
 * that signals Playwright's group never reaches it. These handlers carry the
 * signal on: SIGTERM/SIGINT reap every live tree and then re-raise the signal
 * with the default action, so the worker still dies the way it was told to;
 * `exit` reaps whatever is left on any other way out of the worker.
 */
const LIVE = new Set<number>();
let reapersInstalled = false;

function reapLive(): void {
  for (const pid of LIVE) killTree(pid);
  LIVE.clear();
}

function installReapers(): void {
  if (reapersInstalled) return;
  reapersInstalled = true;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      reapLive();
      process.kill(process.pid, sig);
    });
  }
  process.once("exit", reapLive);
}

function run(cmd: string, args: string[], timeoutMs: number) {
  installReapers();
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
    // `detached` on POSIX makes the CLI a process-group leader, so killTree
    // can signal the whole group; on Windows it would open a console instead.
    const child = spawn(cmd, args, {
      cwd: FRONTEND_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const pid = child.pid;
    if (pid !== undefined) LIVE.add(pid);
    let output = "";
    let timedOut = false;
    const keep = (b: Buffer) => {
      output = (output + b.toString("utf8")).slice(-8000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      if (pid !== undefined) {
        killTree(pid);
        LIVE.delete(pid);
      } else child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      if (pid !== undefined) LIVE.delete(pid);
      resolve({
        code: null,
        signal: null,
        output: `${output}\nspawn error: ${e.message}`,
        timedOut,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      // The CLI exited; its tree goes with it unless something outlived it,
      // which the door's own 180 s bound covers.
      if (pid !== undefined) LIVE.delete(pid);
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

/** Write via a temp file and rename, so a run killed mid-write never leaves a torn report. */
function writeJsonFile(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** The kit's `failures` grouped by rule, keeping each rule's severity. */
function groupFailures(failures: unknown): {
  byRule: FailuresByRule;
  bySeverity: Record<string, number>;
} | null {
  if (!Array.isArray(failures)) return null;
  const byRule: FailuresByRule = {};
  const bySeverity: Record<string, number> = {};
  for (const f of failures as {
    ruleId?: unknown;
    elementId?: unknown;
    severity?: unknown;
  }[]) {
    const rule = String(f.ruleId);
    const severity = typeof f.severity === "string" ? f.severity : "unknown";
    const entry = (byRule[rule] ??= { severity, elements: [] });
    if (entry.severity !== severity) entry.severity = "mixed";
    const el = String(f.elementId);
    if (!entry.elements.includes(el)) entry.elements.push(el);
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
  }
  return { byRule, bySeverity };
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
      failures_by_severity: null,
      unmatchedRules: null,
      stylesheets: null,
      unknown_reason: null,
      instrument: null,
      duration_ms: 0,
      kill_bound_ms: KILL_BOUND_MS,
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
        // Kill the CLI's tree before Playwright's own timeout, so the record is written and names the cause.
        process.stdout.write(
          `design-guide-sweep ${r.route}: per-route timeout ${TIMEOUT_MS} ms, kill bound ${KILL_BOUND_MS} ms\n`
        );
        const res = await run(kit.cmd, args, KILL_BOUND_MS);
        rec.exit_code = res.code;
        rec.signal = res.signal;
        const report = readJson(jsonFile);
        if (res.timedOut)
          rec.harness_error = `validate-guide ran past the ${KILL_BOUND_MS} ms kill bound and its process tree was killed`;
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
          const grouped = groupFailures(report.failures);
          rec.failures_by_rule = grouped?.byRule ?? null;
          rec.failures_by_severity = grouped?.bySeverity ?? null;
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
      // Best effort: a report that cannot be rewritten here is rewritten by the
      // next route and by the final test, which DOES fail on it.
      try {
        writeReport(false);
      } catch (e) {
        console.warn(
          `design-guide-sweep: interim report not written: ${(e as Error).message}`
        );
      }
    }
    info.annotations.push({
      type: "validate-guide",
      description: `exit ${String(rec.exit_code)} in ${rec.duration_ms} ms (kill bound ${KILL_BOUND_MS} ms)`,
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

type ReportRoute =
  | RouteRecord
  | { route: string; files: string[]; status: "not_run" | "stale_record_only" };

/**
 * design-guide-sweep.json from every record of THIS run. `reachedEnd` is true
 * only from the final test; `complete` is computed: every swept route has a
 * record of this run. A route with no record of this run is listed with its
 * status, never dropped and never counted as a measurement.
 */
function writeReport(reachedEnd: boolean): void {
  const routes: ReportRoute[] = SWEPT.map((r) => {
    const rec = readJson(
      path.join(RECORD_DIR, `${slugOf(r.route)}.json`)
    ) as RouteRecord | null;
    if (rec && rec.run_id === RUN_ID) return rec;
    return {
      route: r.route,
      files: r.files,
      status: rec ? "stale_record_only" : "not_run",
    };
  });
  const byExit: Record<string, number> = {};
  const byRule: Record<
    string,
    { severity: string; routes: number; elements: number }
  > = {};
  const bySeverity: Record<string, { routes: number; failures: number }> = {};
  const byUnknown: Record<string, number> = {};
  let recorded = 0;
  for (const r of routes) {
    if ("status" in r) {
      byExit[r.status] = (byExit[r.status] ?? 0) + 1;
      continue;
    }
    recorded += 1;
    const key = r.harness_error ? "harness_error" : String(r.exit_code);
    byExit[key] = (byExit[key] ?? 0) + 1;
    for (const [rule, f] of Object.entries(r.failures_by_rule ?? {})) {
      const t = (byRule[rule] ??= {
        severity: f.severity,
        routes: 0,
        elements: 0,
      });
      if (t.severity !== f.severity) t.severity = "mixed";
      t.routes += 1;
      t.elements += f.elements.length;
    }
    for (const [sev, n] of Object.entries(r.failures_by_severity ?? {})) {
      const t = (bySeverity[sev] ??= { routes: 0, failures: 0 });
      t.routes += 1;
      t.failures += n;
    }
    if (r.unknown_reason) {
      const kind =
        /^unknown\([^)]*\)/.exec(r.unknown_reason)?.[0] ?? r.unknown_reason;
      byUnknown[kind] = (byUnknown[kind] ?? 0) + 1;
    }
  }
  writeJsonFile(path.join(OUT_DIR, "design-guide-sweep.json"), {
    schema: 2,
    reached_end: reachedEnd,
    complete: recorded === SWEPT.length,
    generated_at: new Date().toISOString(),
    run_id: RUN_ID,
    sha: gitSha(),
    kit: kitVersion(),
    guide: path.relative(FRONTEND_DIR, GUIDE).split(path.sep).join("/"),
    origin: ORIGIN,
    per_route_timeout_ms: TIMEOUT_MS,
    kill_bound_ms: KILL_BOUND_MS,
    page_count: ENUM.page_count,
    static_count: ENUM.static_routes.length,
    limited_to: LIMIT,
    swept_count: SWEPT.length,
    recorded_count: recorded,
    not_swept: ENUM.not_swept,
    not_a_route: ENUM.not_a_route,
    totals: {
      by_exit_code: byExit,
      by_rule: byRule,
      by_severity: bySeverity,
      by_unknown_reason: byUnknown,
    },
    routes,
  });
}

// Declared LAST: see "WHY A FINAL TEST" above. It fails only when it cannot
// write the report; harness errors were already reported by their own tests.
test("write design-guide-sweep.json", async () => {
  writeReport(true);
});
