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
 *   --created <expr> Restrict --gh to runs created in a window, passed
 *                    straight through to `gh run list --created` (a date,
 *                    `>=2026-08-19`, or `2026-08-19..2026-08-20`).
 *   --json           Emit the analysis as JSON instead of the text table.
 *
 * WHY `--created` EXISTS, and why `--gh N` alone is not enough. `gh run list`
 * is newest-first, so `--gh N` addresses a COUNT, never a period -- and Spec CI
 * is busy enough that the last 100 runs covered barely 27 hours when this was
 * measured (2026-08-20T02:20Z .. 2026-08-21T05:43Z). The seven artifact-less
 * runs of 2026-08-19 that this whole category was built for -- six of them the
 * apt stall, one an external cancel -- had already aged out of `--gh 100` two
 * days later, so re-running the plan's own Phase 5 gate
 * returned `no_artifact = 0` -- the value that gate declares to be a FAILING
 * result -- for a reason that had nothing to do with the code. A
 * count-addressed window silently becoming an empty one is the same
 * silent-empty-is-unknown defect this section exists to remove, so the window
 * is now addressable directly and is ECHOED in the output rather than left for
 * the reader to infer.
 *
 * `--created` and `--gh N` are TWO limits, and the cap wins silently: a window
 * holding more runs than the cap is served only in part. So size `--gh` ABOVE
 * the window's run count. When the cap is reached the report says so
 * (`TRUNCATED`) and downgrades any clean verdict to a claim about the runs
 * EXAMINED rather than about the period -- but the warning is the backstop,
 * not the plan.
 *
 * Usage:
 *   npx tsx tools/spec-ci-flake/analyze.ts --gh 40
 *   npx tsx tools/spec-ci-flake/analyze.ts --gh 200 --created 2026-08-19
 *   npx tsx tools/spec-ci-flake/analyze.ts --dir ./.flake-cache
 *
 * It ALSO reports, in its own section and never averaged into the flake
 * statistics, the runs that produced no `spec-ci-report` artifact at all —
 * runs in which nothing under test ever executed (typically a stall in an
 * apt-dependent setup step). Those used to be dropped silently, which made
 * this harness structurally blind to that entire failure class. On `--dir`
 * the section reports UNKNOWN rather than zero, because a directory of files
 * carries no run-level information.
 *
 * Exit codes:
 *   0  Analysis produced, with at least one report to analyze.
 *   2  Usage error, or no reports found AND no run-level evidence that any
 *      run lost its artifact — i.e. "nothing to analyze", cause unknown.
 *   3  Zero reports to analyze, WITH run-level evidence that artifact loss is
 *      why: at least one listed run produced no `spec-ci-report`. Deliberately
 *      NOT "every listed run lost its artifact" — a run can produce an
 *      artifact that still yields no parseable report, so requiring
 *      `noArtifact.length === listed` would push that state into exit 2
 *      ("cause unknown") when the cause is in fact known and measured. The
 *      analysis is still printed (that loss is the most important thing this
 *      tool can say), but it is NOT a success: zero reports means zero flake
 *      signal, and exiting 0 would let a caller treat the most catastrophic
 *      window this tool can observe as a clean run. The stderr line names the
 *      exact `<noArtifact> of <completed>` split, so the caller can see
 *      whether the loss was total or partial. The denominator is COMPLETED
 *      runs, not listed runs: `noArtifact` excludes in-progress runs by
 *      construction, so dividing by `listed` would make a total loss print as
 *      "39 of 40" the moment one run is still running -- indistinguishable
 *      from a partial loss, which is the one distinction this line exists to
 *      draw. It matches `printText`'s denominator exactly.
 *   1  Any unexpected error. Not a contract: it is Node's default exit for an
 *      uncaught throw, and several are reachable -- `--dir <missing>` and an
 *      unreadable entry inside it, and on the `--gh` path the cache
 *      rmSync/mkdirSync, the `gh run list` subprocess, and JSON.parse of its
 *      output. Callers must treat 1 as "the harness itself failed", distinct
 *      from every measurement verdict above.
 *
 * See plan `2026-05-30-spec-ci-flake-stabilization.md`, Phase 0, and
 * `2026-08-19-ci-apt-hang-unbounded-steps-misreported-as-test-failure`,
 * Phase 5.
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
  /** Per-spec match outcomes — drives the failing-spec breakdown. */
  specs?: Array<{
    specId?: string;
    matchOutcome?: string;
    matchRate?: number;
  }>;
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
    run?: {
      githubRunId?: string | null;
      githubRunAttempt?: string | null;
      githubSha?: string | null;
    };
  };
}

interface Args {
  dir?: string;
  gh?: number;
  cache: string;
  /** Passed through to `gh run list --created`. Undefined = no window filter. */
  created?: string;
  /** A value-taking flag was given a missing, empty or flag-shaped value. */
  usageError?: boolean;
  json: boolean;
}

/**
 * A value-taking flag's argument, or `undefined` if it is missing, EMPTY, or
 * itself a flag.
 *
 * All three failure modes are one bug wearing three hats, and the empty one is
 * the nastiest because it is invisible. `--created ""` — which is what
 * `--created "$WINDOW"` produces whenever `WINDOW` is unset — is neither
 * undefined nor `--`-prefixed, so a naive guard admits it; `gh` then applies
 * NO filter and the report prints `window: --created  (40 run(s) listed)` over
 * an unfiltered newest-40 sample. That is the silently-narrowed window this
 * whole flag exists to prevent, re-entered through the check added to close
 * it. Whitespace is trimmed for the same reason: `--created " "` filters
 * nothing either.
 *
 * The `--`-prefix arm matters most for `--created`, whose natural values START
 * with `>` (`>=2026-08-19`) — an unquoted `>=` is a shell redirect, which
 * leaves the flag bare and lets it swallow the NEXT flag as its window. But
 * every value-taking flag here has the same shape, so all four share the
 * check: `--dir --created 2026-08-19` otherwise resolves a directory literally
 * named `--created` and dies in an explicit `throw` at exit 1, where this
 * file's contract reserves 2 for usage errors.
 *
 * No legal `gh --created` expression starts with `--`: the grammar is GitHub
 * date-search syntax (`2026-08-19`, `>=`/`>`/`<`/`<=`, `A..B`, `*..B`).
 */
function flagValue(flag: string, value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "" || value.startsWith("--")) {
    process.stderr.write(
      `[flake] ${flag} needs a value` +
        (flag === "--created"
          ? ", e.g. 2026-08-19 or '>=2026-08-19'. Quote it: an unquoted >= is a shell redirect."
          : ".") +
        "\n",
    );
    return undefined;
  }
  return value;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { cache: resolve(".flake-cache"), json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const raw = argv[i + 1];
    switch (flag) {
      case "--dir":
      case "--gh":
      case "--cache":
      case "--created": {
        const value = flagValue(flag, raw);
        // `usageError` short-circuits main() with exit 2. Abandoning the rest
        // of argv is deliberate and harmless: main() returns before reading
        // any other field, and every other exit-2 path is plain-stderr too.
        if (value === undefined) return { ...args, usageError: true };
        if (flag === "--dir") args.dir = resolve(value);
        else if (flag === "--gh") args.gh = Number(value);
        else if (flag === "--cache") args.cache = resolve(value);
        else args.created = value;
        i++;
        break;
      }
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
  /**
   * The commit SHA this run tested (`diagnostics.run.githubSha`). The axis that
   * SEPARATES a flake from a legitimate failure: a run that fails on a SHA whose
   * sibling runs pass is a flake; a run that fails on a SHA with no passing
   * sibling is Spec CI correctly catching a real code change. `null` off-CI.
   */
  sha: string | null;
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
  /** Specs that did NOT full_match this run (the per-spec failure breakdown). */
  failingSpecs: Array<{ specId: string; matchOutcome: string; matchRate: number }>;
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
  const failingSpecs = (r.specs ?? [])
    .filter((s) => s.matchOutcome !== undefined && s.matchOutcome !== "full_match")
    .map((s) => ({
      specId: s.specId ?? "(unknown)",
      matchOutcome: s.matchOutcome ?? "(unknown)",
      matchRate: s.matchRate ?? 0,
    }));
  return {
    label,
    passed: derivePassed(r),
    sha: d.run?.githubSha ?? null,
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
    failingSpecs,
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

// --- Run-level accounting: the runs this harness used to drop silently ---

/**
 * A Spec CI run that produced NO `spec-ci-report` artifact.
 *
 * Such a run is invisible to every feature table below, because the whole
 * dataset is built from downloaded reports — a run that never writes one is
 * simply absent. That is not a rare corner. A run that stalls in the
 * apt-dependent setup step (`Install Playwright Chromium system deps (apt)`
 * since plan 2026-08-19-…'s Phase 3 split it out of `--with-deps`; it was
 * `Install Playwright Chromium` when the 2026-08-19 runs below stalled) never
 * reaches `Run Spec CI`, so
 * `frontend/spec-ci-report.json` is never written; `Upload Spec CI report` is
 * `if: always()` and DOES still run and report success, but with no file on
 * disk and `if-no-files-found: warn` it creates no artifact, so
 * `gh run download -n spec-ci-report` fails and the run is skipped. Six such
 * runs happened on 2026-08-19 alone.
 *
 * These are counted as their OWN category and reported in their own section.
 * They are never merged into the spec-flake statistics: a stalled apt install
 * and a flaky spec are different defects with different owners, and averaging
 * them together hides both.
 *
 * See plan `2026-08-19-ci-apt-hang-unbounded-steps-misreported-as-test-failure`,
 * Phase 5.
 */
interface NoArtifactRun {
  databaseId: number;
  conclusion: string;
  headSha: string;
  createdAt: string;
  event: string;
  /** Job the run died in, when resolvable. */
  job?: string;
  /**
   * The step that was still running when the run ended — the fact that makes
   * this category actionable. `undefined` is NOT self-explaining: see
   * `deadStepUnknown` for WHY it is absent. Two very different causes hide
   * behind an absent value, and reporting both as "jobs API unavailable"
   * asserted a cause the tool did not know.
   */
  deadStep?: string;
  /**
   * Present exactly when `deadStep` is absent, and it says which of the two
   * causes applies:
   *   `lookup-failed`       — we learned nothing (API down/unauthorized/
   *                           unparseable). UNKNOWN.
   *   `no-interrupted-step` — we DID read the jobs, and none of them shows a
   *                           step that was cut off. A positive finding: the
   *                           artifact was lost some other way.
   */
  deadStepUnknown?: "lookup-failed" | "no-interrupted-step";
  /** Human-readable detail for `deadStepUnknown: "lookup-failed"`. */
  deadStepUnknownReason?: string;
  /** `cancelled` (interrupted mid-step) or `failure`. */
  deadStepConclusion?: string;
  /** How long that step had been running, in seconds. */
  deadStepSeconds?: number;
}

/** Discriminated result of {@link resolveDeadStep}. */
type DeadStepLookup =
  | {
      kind: "resolved";
      job?: string;
      deadStep: string;
      deadStepConclusion?: string;
      deadStepSeconds?: number;
    }
  | { kind: "lookup-failed"; reason: string }
  | { kind: "no-interrupted-step" };

interface RunLevelTally {
  /**
   * The `--created` window this tally was measured over, echoed back verbatim.
   * `undefined` means no window filter -- the last `--gh N` runs, whatever
   * period those happen to span. Carried because `noArtifact: 0` is only
   * readable against the window it was measured in: over a window that
   * predates the runs of interest it says nothing at all.
   */
  created?: string;
  /**
   * The `--gh N` cap this run used. Carried with `truncated` because a window
   * and a cap interact: `gh run list` is newest-first, so a `--created` window
   * holding more runs than the cap is served only in part.
   */
  limit: number;
  /**
   * `listed >= limit` — the cap was REACHED, so the window may hold runs this
   * measurement never examined. (`gh run list` cannot exceed `--limit`, so
   * this is `===` in practice; `>=` is written for the property it means.)
   *
   * Without this the tool re-created its own defect one level up. `--gh 60
   * --created 2026-08-19` prints "window: --created 2026-08-19" and, on a
   * clean result, "every completed run reported ... in this window" -- while
   * that day actually held 61 runs. A period reported as fully measured when
   * the cap silently cut it is the same silent-narrowing this flag was added
   * to remove, relocated from `--gh N` to `--created`.
   *
   * It is deliberately a MAY, not a DID: an exactly-N window is truncated in
   * neither fact nor consequence, and claiming otherwise would be its own
   * false statement. UNKNOWN is the honest reading, and it costs one re-run
   * at a higher `--gh` to settle.
   */
  truncated: boolean;
  /** Runs `gh run list` returned. */
  listed: number;
  /** Runs whose `spec-ci-report` artifact downloaded successfully. */
  withArtifact: number;
  /** Completed runs with no artifact at all. */
  noArtifact: NoArtifactRun[];
  /**
   * Runs still in progress when we listed them. They have no artifact YET,
   * which is not the same as having lost one, so they are excluded from
   * `noArtifact` entirely — counting a live run as a loss would be the same
   * cry-wolf defect this section exists to avoid. Counted so the numbers add
   * up to `listed`.
   */
  inProgress: number;
  /**
   * How many artifact-less runs the jobs-API LOOKUP failed for (unreachable,
   * unauthorized, or an unparseable response). Non-zero means those rows say
   * UNKNOWN, not "nothing was running".
   */
  stepLookupFailures: number;
  /**
   * How many artifact-less runs the jobs API answered for, but in which no
   * step looked interrupted. A DIFFERENT fact from `stepLookupFailures`: here
   * we have the data and it does not name a dead step, so the artifact was
   * lost some other way (upload failure, retention, an early `exit 1`).
   * Collapsing the two into one "jobs API unavailable" line asserted a cause
   * the tool did not know.
   */
  noInterruptedStep: number;
}

/**
 * The `--dir` stand-in for `RunLevelTally`. A directory of report files
 * carries no run-level information at all, so every tally field would be a
 * fabrication. Emitted as an explicit marker so a `--json` consumer sees
 * UNKNOWN instead of an absent key it will coerce to zero.
 */
interface RunLevelUnknown {
  unknown: true;
  reason: string;
}

interface GhStep {
  name?: string;
  number?: number;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

/**
 * Find the step a run died in, via the jobs API.
 *
 * NOTE on the predicate. It is tempting to look for `status !== "completed"`,
 * but that only holds while the run is still live. Once a cancelled run
 * finishes, GitHub marks the interrupted step `status: "completed"` with
 * `conclusion: "cancelled"`, and every step after it `skipped` — verified
 * against runs 32216356070 and 32294962345, where step #14
 * `Install Playwright Chromium` reads exactly that after a 32m43s / 33m00s
 * stall. So the real signal is the conclusion, not the status.
 *
 * Issued only for runs that actually missed the artifact, so the cost is bound
 * by the failure count rather than by `--gh N`.
 */
function resolveDeadStep(databaseId: number): DeadStepLookup {
  let raw: string;
  try {
    raw = execFileSync(
      "gh",
      ["api", `/repos/{owner}/{repo}/actions/runs/${databaseId}/jobs?per_page=100`],
      { encoding: "utf-8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    // API unreachable / not authorized / timed out — we learned NOTHING.
    return { kind: "lookup-failed", reason: "jobs API call failed (unreachable, unauthorized, or timed out)" };
  }
  let jobs: Array<{ name?: string; steps?: GhStep[] }>;
  try {
    jobs = (JSON.parse(raw) as { jobs?: Array<{ name?: string; steps?: GhStep[] }> }).jobs ?? [];
  } catch {
    return { kind: "lookup-failed", reason: "jobs API returned a response that did not parse as JSON" };
  }
  for (const job of jobs) {
    const steps = job.steps ?? [];
    // Still-live run first, then the finished-run shape described above.
    const dead =
      steps.find((s) => s.status !== undefined && s.status !== "completed") ??
      steps.find((s) => s.conclusion === "cancelled" || s.conclusion === "failure");
    if (!dead?.name) continue;
    let seconds: number | undefined;
    if (dead.started_at) {
      const start = Date.parse(dead.started_at);
      const end = dead.completed_at ? Date.parse(dead.completed_at) : Date.now();
      if (Number.isFinite(start) && Number.isFinite(end)) {
        seconds = Math.round((end - start) / 1000);
      }
    }
    return {
      kind: "resolved",
      job: job.name,
      deadStep: dead.name,
      deadStepConclusion: dead.conclusion ?? dead.status ?? undefined,
      deadStepSeconds: seconds,
    };
  }
  // The API answered and we read its job data; none of it names a step that
  // was cut off. That is a POSITIVE finding, not a failed lookup: the artifact
  // was lost some other way. Reporting it as "jobs API unavailable" would
  // assert a cause we just disproved.
  return { kind: "no-interrupted-step" };
}

function loadFromGh(
  n: number,
  cache: string,
  created?: string,
): { rows: FeatureRow[]; runLevel: RunLevelTally } {
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
      // `status` is load-bearing: without it an in-progress run is
      // indistinguishable from one that lost its artifact.
      "databaseId,conclusion,status,headSha,createdAt,event",
      "--limit",
      String(n),
      // Window filter, when asked for. `gh` owns the expression grammar
      // (`2026-08-19`, `>=2026-08-19`, `2026-08-19..2026-08-20`), so it is
      // passed through untouched rather than re-parsed here -- a second,
      // divergent grammar would be pure liability.
      ...(created !== undefined ? ["--created", created] : []),
    ],
    { encoding: "utf-8", timeout: 60_000 },
  );
  const runs = JSON.parse(listOut) as Array<{
    databaseId: number;
    conclusion: string;
    status: string;
    headSha: string;
    createdAt: string;
    event: string;
  }>;
  process.stderr.write(
    `[flake] ${runs.length} Spec CI runs listed${created !== undefined ? ` (--created ${created})` : ""}\n`,
  );
  const noArtifact: NoArtifactRun[] = [];
  let inProgress = 0;
  let stepLookupFailures = 0;
  let noInterruptedStep = 0;
  for (const run of runs) {
    if (run.status !== "completed") {
      // Still running. It has no artifact yet, which is not a loss — skip it
      // rather than reporting a live run as a failure.
      inProgress++;
      process.stderr.write(`[flake] run ${run.databaseId}: still ${run.status} — skipped\n`);
      continue;
    }
    const dest = join(cache, `run-${run.databaseId}`);
    try {
      execFileSync(
        "gh",
        ["run", "download", String(run.databaseId), "-n", "spec-ci-report", "-D", dest],
        { encoding: "utf-8", timeout: 60_000, stdio: ["ignore", "ignore", "ignore"] },
      );
    } catch {
      // No spec-ci-report artifact on this run. This is NOT nothing: it is its
      // own failure category, so record it and go find out what was running.
      const dead = resolveDeadStep(run.databaseId);
      let note: string;
      if (dead.kind === "resolved") {
        const { kind: _kind, ...fields } = dead;
        noArtifact.push({ ...run, ...fields });
        note = `died in "${dead.deadStep}"`;
      } else if (dead.kind === "lookup-failed") {
        stepLookupFailures++;
        noArtifact.push({
          ...run,
          deadStepUnknown: "lookup-failed",
          deadStepUnknownReason: dead.reason,
        });
        note = `dead step UNKNOWN — ${dead.reason}`;
      } else {
        noInterruptedStep++;
        noArtifact.push({ ...run, deadStepUnknown: "no-interrupted-step" });
        note = "no interrupted step in the jobs API — artifact lost some other way";
      }
      process.stderr.write(
        `[flake] run ${run.databaseId}: no spec-ci-report artifact (${note})\n`,
      );
    }
  }
  const rows = loadFromDir(cache);
  return {
    rows,
    runLevel: {
      created,
      limit: n,
      truncated: runs.length >= n,
      listed: runs.length,
      withArtifact: runs.length - noArtifact.length - inProgress,
      noArtifact,
      inProgress,
      stepLookupFailures,
      noInterruptedStep,
    },
  };
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
  /**
   * Run-level accounting, reported SEPARATELY from everything else in this
   * object. Every other field describes runs that produced a report;
   * `runLevel.noArtifact` describes runs that produced none, which is a
   * different defect class (CI infrastructure, not spec flake) and must not be
   * averaged into the flake statistics.
   *
   * ALWAYS present, and on the `--dir` path it is the explicit
   * `{ unknown: true, reason }` marker rather than being omitted. Omitting the
   * key made `--json` consumers doing `result.runLevel?.noArtifact.length ?? 0`
   * read UNKNOWN as 0 — the same silent-empty-is-unknown defect this section
   * exists to remove, reintroduced on the machine-readable surface. Narrow it
   * with `"unknown" in result.runLevel` before touching any tally field.
   */
  runLevel: RunLevelTally | RunLevelUnknown;
  /** Raw fail fraction (fails/total) — NOT the flake rate. See `trueFlakeShas`. */
  failRate: number;
  /** Runs whose report carried no `diagnostics.run.githubSha` (can't group). */
  rowsWithoutSha: number;
  /**
   * THE flake metric: SHAs that produced BOTH a pass and a fail. A fail on a
   * SHA with a passing sibling is a genuine same-code flake. The plan's
   * reactivate criterion is `trueFlakeShas.length >= 3`.
   */
  trueFlakeShas: Array<{ sha: string; passes: number; fails: number }>;
  /**
   * SHAs that ONLY failed (no passing sibling). These are most likely Spec CI
   * correctly catching a real code change — NOT flakes — though an un-rerun
   * single failure could hide a flake. The failing-spec breakdown disambiguates.
   */
  failOnlyShas: Array<{ sha: string; fails: number }>;
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
  /**
   * Across FAIL runs: which specs did not full_match, in how many fail runs,
   * and their worst match rate. A spec failing across runs of DIFFERENT SHAs
   * with a clear before/after is a real change; one spec flickering on the SAME
   * SHA is the flake to chase.
   */
  failingSpecBreakdown: Array<{
    specId: string;
    failRuns: number;
    outcomes: string;
    minMatchRate: number;
  }>;
}

function analyze(rows: FeatureRow[], runLevel?: RunLevelTally): Analysis {
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

  // Same-SHA flake detection — the metric that distinguishes a flake from a
  // legitimate failure. Group runs by the SHA they tested; a SHA with both a
  // pass and a fail is a genuine same-code flake.
  const bySha = new Map<string, { passes: number; fails: number }>();
  let rowsWithoutSha = 0;
  for (const r of rows) {
    if (!r.sha) {
      rowsWithoutSha++;
      continue;
    }
    const e = bySha.get(r.sha) ?? { passes: 0, fails: 0 };
    if (r.passed) e.passes++;
    else e.fails++;
    bySha.set(r.sha, e);
  }
  const trueFlakeShas = [...bySha.entries()]
    .filter(([, v]) => v.passes > 0 && v.fails > 0)
    .map(([sha, v]) => ({ sha, passes: v.passes, fails: v.fails }))
    .sort((a, b) => b.fails - a.fails);
  const failOnlyShas = [...bySha.entries()]
    .filter(([, v]) => v.fails > 0 && v.passes === 0)
    .map(([sha, v]) => ({ sha, fails: v.fails }))
    .sort((a, b) => b.fails - a.fails);

  // Per-spec failure breakdown across FAIL runs — which specs are the ones that
  // actually red the gate, so "is it one auth refactor or a real flake?" is
  // answerable at a glance.
  const specAgg = new Map<
    string,
    { failRuns: number; outcomes: Set<string>; minMatchRate: number }
  >();
  for (const r of fails) {
    for (const s of r.failingSpecs) {
      const e =
        specAgg.get(s.specId) ?? { failRuns: 0, outcomes: new Set(), minMatchRate: 1 };
      e.failRuns++;
      e.outcomes.add(s.matchOutcome);
      e.minMatchRate = Math.min(e.minMatchRate, s.matchRate);
      specAgg.set(s.specId, e);
    }
  }
  const failingSpecBreakdown = [...specAgg.entries()]
    .map(([specId, v]) => ({
      specId,
      failRuns: v.failRuns,
      outcomes: [...v.outcomes].sort().join(","),
      minMatchRate: v.minMatchRate,
    }))
    .sort((a, b) => b.failRuns - a.failRuns)
    .slice(0, 20);

  return {
    total: rows.length,
    passes: passes.length,
    fails: fails.length,
    // Never omitted. `--dir` gets the explicit UNKNOWN marker instead, so a
    // `--json` consumer cannot silently coerce "not measured" into 0.
    runLevel: runLevel ?? {
      unknown: true,
      reason:
        "--dir: a directory of report files carries no run-level information. " +
        "Re-run with --gh <N> to measure runs that produced no artifact. UNKNOWN, not zero.",
    },
    failRate: rows.length === 0 ? 0 : fails.length / rows.length,
    rowsWithoutSha,
    trueFlakeShas,
    failOnlyShas,
    booleanFeatures,
    numericFeatures,
    failNotableConcentration,
    failingSpecBreakdown,
  };
}

function fmtDur(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m < 60 ? `${m}m${String(s).padStart(2, "0")}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

function printText(a: Analysis): void {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const short = (sha: string) => (sha ? sha.slice(0, 8) : "(no sha)");
  const lines: string[] = [];
  lines.push(`Spec CI flake analysis — ${a.total} runs, ${a.passes} pass / ${a.fails} fail (raw fail rate ${pct(a.failRate)})`);
  lines.push("");

  // Run-level accounting FIRST, and kept apart from every flake number below.
  // A run with no report is not a flaky spec; it is a run in which nothing
  // under test ever executed. Merging the two would understate both.
  if ("unknown" in a.runLevel) {
    lines.push("RUNS WITHOUT A REPORT — unknown (source is --dir: files on disk, not runs).");
    lines.push("  Re-run with --gh <N> to measure this. This is UNKNOWN, not zero.");
  } else {
    const rl = a.runLevel;
    const completed = rl.listed - rl.inProgress;
    // The window is part of the finding, not decoration. `0 of 99` is only
    // meaningful against the period those 99 runs covered, and `--gh N`
    // addresses a count rather than a period -- on a busy workflow the last 100
    // runs can span a single day. Printing the window (or saying plainly that
    // there was none) keeps a reader from taking a 0 measured over the wrong
    // days as evidence about the days they care about.
    lines.push(
      `RUNS WITHOUT A REPORT — ${rl.noArtifact.length} of ${completed} completed run(s) produced no spec-ci-report artifact.`,
    );
    lines.push(
      rl.created !== undefined
        ? `  window: --created ${rl.created} (${rl.listed} run(s) listed)`
        : `  window: the last ${rl.listed} run(s), whatever period those span - NOT a date range. Use --created to pin one.`,
    );
    // A `--created` window and a `--gh N` cap are two different limits, and the
    // cap wins silently. Say so where it can change the reading, rather than
    // letting the window line imply a completeness the cap may have removed.
    if (rl.truncated) {
      // BOTH arms say MAY. `truncated` is `listed >= limit`, which is also
      // true when the workflow's entire history is exactly `limit` runs -- so
      // "there ARE older runs beyond this sample" would be a flat falsehood in
      // precisely the boundary case the JSDoc above reserves as UNKNOWN. One
      // arm asserting what the other declines to assert is the same defect
      // this section exists to remove, at the width of a single word.
      lines.push(
        rl.created !== undefined
          ? `  ⚠ TRUNCATED — the --gh ${rl.limit} cap was reached, so this window MAY hold runs not examined here. Re-run with a higher --gh to settle it.`
          : `  ⚠ TRUNCATED — the --gh ${rl.limit} cap was reached, so there MAY be older runs beyond this sample. Re-run with a higher --gh to settle it.`,
      );
    }
    if (rl.inProgress > 0) {
      lines.push(
        `  (${rl.inProgress} of the ${rl.listed} listed run(s) were still in progress — excluded, not counted as losses)`,
      );
    }
    if (rl.noArtifact.length === 0) {
      // "in this window" is only true when the whole window was READ and every
      // run in it has RESOLVED. Two different things can break that, and both
      // have to qualify this line or it over-claims:
      //   * the `--gh` cap cut the window short (`truncated`);
      //   * runs inside the window are still in progress -- excluded from
      //     `noArtifact` by construction (correctly: a live run has not lost
      //     an artifact, it has not produced one YET), so a window of 30 runs
      //     of which 25 are live would otherwise print a window-level clean
      //     bill derived from 5 resolved ones.
      // Only when neither applies is the flat claim about the window true.
      const caveats = [
        rl.truncated ? `the --gh ${rl.limit} cap was reached` : "",
        rl.inProgress > 0 ? `${rl.inProgress} run(s) are still in progress` : "",
      ].filter(Boolean);
      lines.push(
        caveats.length === 0
          ? "  → every completed run reported. No CI-infrastructure losses in this window."
          : `  → no losses among the ${completed} resolved run(s) examined - but ${caveats.join(" and ")}, so this is NOT a clean bill for the whole window.`,
      );
    } else {
      lines.push(
        "  These are NOT spec flakes and are excluded from every number below: nothing",
      );
      lines.push(
        "  under test ran. A run that stalls in an apt-dependent setup step (e.g.",
      );
      lines.push(
        "  `Install Playwright Chromium system deps (apt)`) never reaches `Run Spec CI`,",
      );
      lines.push(
        "  so no report is written. The step named per run below is read live from the",
      );
      lines.push(
        "  jobs API, so it stays correct across step renames.",
      );
      for (const r of rl.noArtifact) {
        // Three distinct states, rendered as three distinct sentences. The
        // last two used to collapse into "jobs API unavailable", which
        // asserted an API failure even when the API had answered fine and
        // simply showed no interrupted step.
        let where: string;
        if (r.deadStep) {
          where =
            `died in "${r.deadStep}"` +
            (r.deadStepSeconds !== undefined ? ` after ${fmtDur(r.deadStepSeconds)}` : "") +
            (r.deadStepConclusion ? ` [${r.deadStepConclusion}]` : "");
        } else if (r.deadStepUnknown === "no-interrupted-step") {
          where = "no interrupted step (jobs API answered; artifact lost some other way)";
        } else {
          where = `dead step UNKNOWN (${r.deadStepUnknownReason ?? "jobs API lookup failed"})`;
        }
        lines.push(
          `    run ${r.databaseId} ${short(r.headSha)} ${r.conclusion.padEnd(9)} ${r.createdAt}  ${where}`,
        );
      }
      if (rl.stepLookupFailures > 0) {
        lines.push(
          `  (${rl.stepLookupFailures} run(s) above: the jobs API lookup FAILED — UNKNOWN, not "none")`,
        );
      }
      if (rl.noInterruptedStep > 0) {
        lines.push(
          `  (${rl.noInterruptedStep} run(s) above: the jobs API answered and showed NO interrupted step —`,
        );
        lines.push(
          `   a different fact from a failed lookup. Those artifacts were lost some other way`,
        );
        lines.push(
          `   (upload failure, retention, an early exit), not to a stalled setup step.)`,
        );
      }
    }
  }
  lines.push("");

  // The headline verdict: true flakes vs legitimate failures.
  lines.push(`VERDICT — true same-SHA flakes: ${a.trueFlakeShas.length} SHA(s) that both passed AND failed.`);
  if (a.trueFlakeShas.length > 0) {
    for (const f of a.trueFlakeShas) {
      lines.push(`  FLAKE ${short(f.sha)}: ${f.passes} pass / ${f.fails} fail on the same commit`);
    }
  } else {
    lines.push("  → 0 same-code flakes. Every failure is on a SHA with no passing sibling (below):");
  }
  if (a.failOnlyShas.length > 0) {
    lines.push(`  fail-only SHAs (likely real code changes Spec CI caught, NOT flakes): ${a.failOnlyShas.length}`);
    for (const f of a.failOnlyShas.slice(0, 10)) {
      lines.push(`    ${short(f.sha)}: ${f.fails} fail, 0 pass`);
    }
  }
  if (a.rowsWithoutSha > 0) {
    lines.push(`  (${a.rowsWithoutSha} run(s) had no githubSha in the report — pre-diagnostics or off-CI — excluded from SHA grouping)`);
  }
  lines.push("");
  lines.push("Failing specs across FAIL runs (specId — #fail-runs, outcomes, worst matchRate):");
  if (a.failingSpecBreakdown.length === 0) {
    lines.push("  (no per-spec failures recorded — fails were crawl/console/server-only)");
  } else {
    for (const s of a.failingSpecBreakdown) {
      lines.push(`  ${s.specId.padEnd(28)} — ${s.failRuns} run(s), [${s.outcomes}], minMatchRate=${s.minMatchRate.toFixed(2)}`);
    }
  }
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
  lines.push("Read: START with the VERDICT. `trueFlakeShas` is the only true flake count —");
  lines.push("a fail on a SHA whose sibling passed. `failOnlyShas` + the failing-spec list");
  lines.push("are almost always Spec CI correctly catching real code changes (look up the");
  lines.push("PR for that SHA; if the failing specs are the pages it changed, it's not a");
  lines.push("flake). Only THEN read the feature tables to attribute a confirmed flake:");
  lines.push("crawlSessionLost dominant => H1 (ci-bot collision); notable 5xx concentrated");
  lines.push("on one route => endpoint/upstream regression; spread across many => H2.");
  process.stdout.write(lines.join("\n") + "\n");
}

function main(): number {
  const args = parseArgs();
  if (args.usageError) return 2;
  let rows: FeatureRow[];
  let runLevel: RunLevelTally | undefined;
  if (args.gh !== undefined) {
    if (!Number.isFinite(args.gh) || args.gh <= 0) {
      process.stderr.write("[flake] --gh requires a positive integer\n");
      return 2;
    }
    ({ rows, runLevel } = loadFromGh(args.gh, args.cache, args.created));
  } else if (args.dir) {
    // `--created` filters `gh run list`; on the --dir path there is no run list
    // to filter. Accepting and ignoring it would report a WIDER window than the
    // caller asked for under a heading that claims their window -- the exact
    // misread this flag was added to stop -- so it is a usage error, not a
    // no-op.
    if (args.created !== undefined) {
      process.stderr.write(
        "[flake] --created applies to --gh only; --dir reads files on disk, which carry no run dates\n",
      );
      return 2;
    }
    // --dir sees files on disk, not runs, so it has no run-level data at all.
    // `runLevel` stays undefined rather than becoming an empty tally: absence
    // of the measurement must not read as a measurement of zero.
    rows = loadFromDir(args.dir);
  } else {
    process.stderr.write(
      "[flake] need a source: --gh <N> (download last N runs) or --dir <path>\n",
    );
    return 2;
  }

  // Zero reports used to be an unconditional `return 2`. But if runs were
  // listed and at least one of them lost its artifact, that is not "nothing to
  // analyze" — it is the single most important thing this tool can report,
  // and bailing before printing is exactly how the failure mode stayed
  // invisible. It is still not a SUCCESS, though: zero reports means zero
  // flake signal, so it gets its own non-zero code (3) rather than 0. An
  // earlier revision returned 0 here, which made the most catastrophic window
  // this tool can see the only one it called clean.
  //
  // The test is `noArtifact.length > 0`, NOT `noArtifact.length === listed`:
  // a run can produce an artifact that still yields no parseable report, so
  // demanding total loss would route "0 reports, artifact loss measured on
  // some runs" to exit 2 — whose contract is "cause UNKNOWN" — while the cause
  // is right there in `runLevel`. The stderr line below prints the exact
  // `<noArtifact> of <completed>` split so total and partial loss stay
  // distinguishable to the caller -- over COMPLETED runs, matching
  // `printText`. `listed` would be the wrong denominator: `noArtifact` never
  // contains an in-progress run (they are `continue`d above), so `x of listed`
  // understates the ratio by exactly the in-progress count and prints a TOTAL
  // loss as a partial one ("39 of 40") whenever a single run is still going.
  let zeroReportsFromArtifactLoss = false;
  if (rows.length === 0) {
    if (runLevel !== undefined && runLevel.noArtifact.length > 0) {
      zeroReportsFromArtifactLoss = true;
      const completedRuns = runLevel.listed - runLevel.inProgress;
      process.stderr.write(
        `[flake] 0 reports, but ${runLevel.noArtifact.length} of ${completedRuns} completed runs produced no artifact — reporting that (exit 3)\n`,
      );
    } else {
      process.stderr.write("[flake] no Spec CI reports found to analyze\n");
      return 2;
    }
  }

  const result = analyze(rows, runLevel);
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printText(result);
  }
  return zeroReportsFromArtifactLoss ? 3 : 0;
}

process.exit(main());
