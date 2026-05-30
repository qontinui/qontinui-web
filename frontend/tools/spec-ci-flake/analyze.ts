/**
 * Spec CI flake backfill harness (Phase 0).
 *
 * Pulls the last N Spec CI run reports and diffs flake-PASS vs flake-FAIL
 * outcomes, surfacing the smallest set of features that distinguish them — so
 * the 0-vs-166 same-origin-5xx whipsaw can be attributed to a root cause
 * (H1 ci-bot collision / H2 backend blip / H4 waiver leak / …) with evidence,
 * not vibes.
 *
 * It keys FIRST on `diagnostics.crawlSessionLost` — the in-script classifier
 * that already labels the environmental shared-ci-bot-auth failure — then ranks
 * every other diagnostic feature by how cleanly it separates the two groups.
 *
 * Sources (one required):
 *   --dir <path>     Analyze every *.json Spec CI report already on disk.
 *   --gh <N>         Download the `spec-ci-report` artifact from the last N
 *                    Spec CI runs (via `gh`) into a cache dir, then analyze.
 *                    Requires an authenticated `gh` (GH_TOKEN / gh auth login).
 *
 * Options:
 *   --cache <path>   Where --gh stores downloaded reports (default ./.flake-cache).
 *   --json           Emit the analysis as JSON instead of the text table.
 *
 * Usage:
 *   npx tsx tools/spec-ci-flake/analyze.ts --gh 40
 *   npx tsx tools/spec-ci-flake/analyze.ts --dir ./.flake-cache
 *
 * See plan `2026-05-30-spec-ci-flake-stabilization.md`, Phase 0.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

// --- Structural subset of the Spec CI report we read (decoupled from the
// harness's internal FullReport type — the report is just JSON on disk). ---
interface SpecCiReport {
  evaluatedAt?: string;
  passed?: boolean;
  summary?: {
    minMatchRate?: number;
    transitionPassRate?: number;
    error?: number;
    consoleErrors?: { total?: number };
    serverErrors?: { total?: number };
    apiAssertionPassRate?: number;
  };
  crawl?: { gatingFindings?: number; sessionLost?: boolean };
  diagnostics?: {
    crawlSessionLost?: boolean;
    crawlSessionLostRoutes?: number;
    totalResponses?: number;
    durationMs?: number;
    auth?: {
      loginAttempts?: number;
      refreshRotations?: number;
      authEndpoint429s?: number;
    };
    concurrencyAtStart?: {
      available?: boolean;
      inProgressRuns?: unknown[];
    };
    notableResponses?: Array<{
      url?: string;
      status?: number;
      method?: string;
    }>;
    run?: { githubRunId?: string | null; githubRunAttempt?: string | null };
  };
}

interface Args {
  dir?: string;
  gh?: number;
  cache: string;
  json: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { cache: resolve(".flake-cache"), json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--dir":
        if (value !== undefined) {
          args.dir = resolve(value);
          i++;
        }
        break;
      case "--gh":
        if (value !== undefined) {
          args.gh = Number(value);
          i++;
        }
        break;
      case "--cache":
        if (value !== undefined) {
          args.cache = resolve(value);
          i++;
        }
        break;
      case "--json":
        args.json = true;
        break;
    }
  }
  return args;
}

/**
 * Re-derive the gate verdict from summary + crawl fields. Only used as a
 * fallback for reports written before `report.passed` was persisted; current
 * reports carry `passed` directly. Mirrors run-spec-ci.ts's `passed` formula.
 */
function derivePassed(r: SpecCiReport): boolean {
  if (typeof r.passed === "boolean") return r.passed;
  const s = r.summary ?? {};
  return (
    (s.error ?? 0) === 0 &&
    (s.minMatchRate ?? 0) >= 0.8 &&
    (s.transitionPassRate ?? 0) >= 0.999 &&
    (s.consoleErrors?.total ?? 0) === 0 &&
    (s.serverErrors?.total ?? 0) === 0 &&
    (s.apiAssertionPassRate ?? 1) >= 0.999 &&
    (r.crawl?.gatingFindings ?? 0) === 0
  );
}

interface FeatureRow {
  label: string;
  passed: boolean;
  sessionLost: boolean;
  notableCount: number;
  serverErrors: number;
  consoleErrors: number;
  refreshRotations: number;
  authEndpoint429s: number;
  concurrencyOverlap: number | null;
  minMatchRate: number;
  durationMs: number;
  /** routeTemplate(`host METHOD path status`) -> count, for concentration. */
  notableByRoute: Map<string, number>;
}

function templatize(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "/:uuid",
      )
      .replace(/\/\d+(?=\/|$)/g, "/:id");
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}

function toRow(label: string, r: SpecCiReport): FeatureRow {
  const d = r.diagnostics ?? {};
  const conc = d.concurrencyAtStart;
  const notableByRoute = new Map<string, number>();
  for (const n of d.notableResponses ?? []) {
    const key = `${n.method ?? "?"} ${templatize(n.url ?? "")} ${n.status ?? "?"}`;
    notableByRoute.set(key, (notableByRoute.get(key) ?? 0) + 1);
  }
  return {
    label,
    passed: derivePassed(r),
    sessionLost: d.crawlSessionLost ?? r.crawl?.sessionLost ?? false,
    notableCount: (d.notableResponses ?? []).length,
    serverErrors: r.summary?.serverErrors?.total ?? 0,
    consoleErrors: r.summary?.consoleErrors?.total ?? 0,
    refreshRotations: d.auth?.refreshRotations ?? 0,
    authEndpoint429s: d.auth?.authEndpoint429s ?? 0,
    concurrencyOverlap:
      conc?.available === true ? (conc.inProgressRuns ?? []).length : null,
    minMatchRate: r.summary?.minMatchRate ?? 1,
    durationMs: d.durationMs ?? 0,
    notableByRoute,
  };
}

// --- Source loaders ---

function loadFromDir(dir: string): FeatureRow[] {
  if (!existsSync(dir)) {
    throw new Error(`--dir not found: ${dir}`);
  }
  const rows: FeatureRow[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `gh run download` nests artifacts in per-run subdirs; recurse one level.
      rows.push(...loadFromDir(full));
      continue;
    }
    if (!entry.endsWith(".json")) continue;
    try {
      const r = JSON.parse(readFileSync(full, "utf-8")) as SpecCiReport;
      if (!r.summary) continue; // not a Spec CI report
      rows.push(toRow(entry, r));
    } catch {
      /* skip unparseable / unrelated json */
    }
  }
  return rows;
}

function loadFromGh(n: number, cache: string): FeatureRow[] {
  if (existsSync(cache)) rmSync(cache, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  const listOut = execFileSync(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      "Spec CI",
      "--json",
      "databaseId,conclusion,headSha,createdAt,event",
      "--limit",
      String(n),
    ],
    { encoding: "utf-8", timeout: 60_000 },
  );
  const runs = JSON.parse(listOut) as Array<{
    databaseId: number;
    conclusion: string;
    headSha: string;
    createdAt: string;
    event: string;
  }>;
  process.stderr.write(`[flake] ${runs.length} Spec CI runs listed\n`);
  for (const run of runs) {
    const dest = join(cache, `run-${run.databaseId}`);
    try {
      execFileSync(
        "gh",
        ["run", "download", String(run.databaseId), "-n", "spec-ci-report", "-D", dest],
        { encoding: "utf-8", timeout: 60_000, stdio: ["ignore", "ignore", "ignore"] },
      );
    } catch {
      // No spec-ci-report artifact on this run (e.g. it failed before upload,
      // or predates the artifact). Skip — a missing artifact is itself a weak
      // signal but not analyzable here.
      process.stderr.write(`[flake] run ${run.databaseId}: no spec-ci-report artifact\n`);
    }
  }
  return loadFromDir(cache);
}

// --- Analysis ---

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

interface Analysis {
  total: number;
  passes: number;
  fails: number;
  flakeRate: number;
  booleanFeatures: Array<{
    feature: string;
    passRate: number;
    failRate: number;
    separation: number;
  }>;
  numericFeatures: Array<{
    feature: string;
    passMedian: number;
    failMedian: number;
    passMean: number;
    failMean: number;
  }>;
  /** For FAIL rows: how concentrated are the notable 5xx/4xx across routes? */
  failNotableConcentration: Array<{ route: string; runs: number; total: number }>;
}

function analyze(rows: FeatureRow[]): Analysis {
  const passes = rows.filter((r) => r.passed);
  const fails = rows.filter((r) => !r.passed);
  const rate = (xs: FeatureRow[], pred: (r: FeatureRow) => boolean) =>
    xs.length === 0 ? 0 : xs.filter(pred).length / xs.length;

  const booleanFeatures = (
    [
      ["crawlSessionLost", (r: FeatureRow) => r.sessionLost],
      ["any429onAuth", (r: FeatureRow) => r.authEndpoint429s > 0],
      ["anyRefreshRotation", (r: FeatureRow) => r.refreshRotations > 0],
      ["anyConcurrentRun", (r: FeatureRow) => (r.concurrencyOverlap ?? 0) > 0],
      ["anyNotable5xx4xx", (r: FeatureRow) => r.notableCount > 0],
    ] as Array<[string, (r: FeatureRow) => boolean]>
  )
    .map(([feature, pred]) => {
      const passRate = rate(passes, pred);
      const failRate = rate(fails, pred);
      return { feature, passRate, failRate, separation: Math.abs(failRate - passRate) };
    })
    .sort((a, b) => b.separation - a.separation);

  const numericFeatures = (
    [
      ["notableCount", (r: FeatureRow) => r.notableCount],
      ["serverErrors", (r: FeatureRow) => r.serverErrors],
      ["consoleErrors", (r: FeatureRow) => r.consoleErrors],
      ["refreshRotations", (r: FeatureRow) => r.refreshRotations],
      ["authEndpoint429s", (r: FeatureRow) => r.authEndpoint429s],
      ["concurrencyOverlap", (r: FeatureRow) => r.concurrencyOverlap ?? 0],
      ["durationMs", (r: FeatureRow) => r.durationMs],
    ] as Array<[string, (r: FeatureRow) => number]>
  ).map(([feature, sel]) => ({
    feature,
    passMedian: median(passes.map(sel)),
    failMedian: median(fails.map(sel)),
    passMean: mean(passes.map(sel)),
    failMean: mean(fails.map(sel)),
  }));

  // Concentration: across FAIL rows, which route templates carry the notable
  // responses, and in how many distinct runs. One route in most fails => a
  // specific endpoint/upstream regression; spread across many => blanket
  // backend pressure (answers Phase 0's first must-answer question).
  const routeRuns = new Map<string, { runs: number; total: number }>();
  for (const r of fails) {
    for (const [route, count] of r.notableByRoute) {
      const e = routeRuns.get(route) ?? { runs: 0, total: 0 };
      e.runs += 1;
      e.total += count;
      routeRuns.set(route, e);
    }
  }
  const failNotableConcentration = [...routeRuns.entries()]
    .map(([route, v]) => ({ route, runs: v.runs, total: v.total }))
    .sort((a, b) => b.runs - a.runs || b.total - a.total)
    .slice(0, 15);

  return {
    total: rows.length,
    passes: passes.length,
    fails: fails.length,
    flakeRate: rows.length === 0 ? 0 : fails.length / rows.length,
    booleanFeatures,
    numericFeatures,
    failNotableConcentration,
  };
}

function printText(a: Analysis): void {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const lines: string[] = [];
  lines.push(`Spec CI flake analysis — ${a.total} runs, ${a.passes} pass / ${a.fails} fail (flake rate ${pct(a.flakeRate)})`);
  lines.push("");
  lines.push("Boolean features (sorted by how cleanly they separate pass vs fail):");
  for (const f of a.booleanFeatures) {
    lines.push(
      `  ${f.feature.padEnd(20)} fail=${pct(f.failRate).padStart(4)}  pass=${pct(f.passRate).padStart(4)}  separation=${pct(f.separation)}`,
    );
  }
  lines.push("");
  lines.push("Numeric features (median | mean, pass vs fail):");
  for (const f of a.numericFeatures) {
    lines.push(
      `  ${f.feature.padEnd(20)} fail=${f.failMedian.toFixed(1)}|${f.failMean.toFixed(1)}  pass=${f.passMedian.toFixed(1)}|${f.passMean.toFixed(1)}`,
    );
  }
  lines.push("");
  lines.push("Notable-response concentration across FAIL runs (route — #runs, #total):");
  if (a.failNotableConcentration.length === 0) {
    lines.push("  (no notable responses in any fail run)");
  } else {
    for (const c of a.failNotableConcentration) {
      lines.push(`  ${c.route}  —  ${c.runs} run(s), ${c.total} total`);
    }
  }
  lines.push("");
  lines.push("Read: a feature with high `separation` AND aligned numeric medians is the");
  lines.push("dominant flake driver. crawlSessionLost dominant => H1 (ci-bot collision).");
  lines.push("Notable 5xx concentrated on one route => endpoint/upstream regression;");
  lines.push("spread across many => blanket backend pressure (H2).");
  process.stdout.write(lines.join("\n") + "\n");
}

function main(): number {
  const args = parseArgs();
  let rows: FeatureRow[];
  if (args.gh !== undefined) {
    if (!Number.isFinite(args.gh) || args.gh <= 0) {
      process.stderr.write("[flake] --gh requires a positive integer\n");
      return 2;
    }
    rows = loadFromGh(args.gh, args.cache);
  } else if (args.dir) {
    rows = loadFromDir(args.dir);
  } else {
    process.stderr.write(
      "[flake] need a source: --gh <N> (download last N runs) or --dir <path>\n",
    );
    return 2;
  }

  if (rows.length === 0) {
    process.stderr.write("[flake] no Spec CI reports found to analyze\n");
    return 2;
  }

  const result = analyze(rows);
  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        { ...result, failNotableConcentration: result.failNotableConcentration },
        null,
        2,
      ) + "\n",
    );
  } else {
    printText(result);
  }
  return 0;
}

process.exit(main());
