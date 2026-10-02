/**
 * Resolve the Vercel PRODUCTION deployment of one main commit, for the
 * post-deploy smoke.
 *
 * Invoked by the `validate` job of `.github/workflows/verify-frontend-run.yml`
 * on every push to main (and on a manual `workflow_dispatch` re-smoke). It
 * replaced the `deployment_status` trigger, which fired for only ~5 of 29
 * production deploys because Vercel does not reliably write the GitHub
 * deployment record (plan
 * 2026-10-02-frontend-post-deploy-smoke-misses-most-production-deploys).
 *
 * The decision is the pure `classify()` below — one call per poll, unit-tested
 * row by row against the plan's D3 table. `resolveDeployment()` is the polling
 * loop with injectable fetchers; the CLI at the bottom wires it to the Vercel
 * and GitHub REST APIs and to `$GITHUB_OUTPUT`.
 *
 * ZERO dependencies beyond Node built-ins (global `fetch`, `fs`), so the
 * workflow runs it with `npx tsx` and no `npm ci` — `validate` stays fast.
 *
 * Exit codes (read by the workflow):
 *   0 = resolved: `ok=true` (smoke it) or a NAMED skip (`ok=false` + notice)
 *   1 = red: failed production build, timeout, API error or missing token
 */
import { appendFileSync } from "node:fs";

/** One entry of `GET /v6/deployments` (only the fields read here). */
export interface VercelDeployment {
  uid: string;
  /** Deployment host WITHOUT a scheme, e.g. `qontinui-web-abc123.vercel.app`. */
  url: string;
  /** BUILDING | ERROR | INITIALIZING | QUEUED | READY | CANCELED */
  state?: string;
  /** Older spelling of `state`; read when `state` is absent. */
  readyState?: string;
  /**
   * PROMOTED once the production domains point at it; STAGED while READY but
   * not (yet) promoted. Absent on older deployments.
   */
  readySubstate?: string;
  created?: number;
  meta?: { githubCommitSha?: string };
}

export interface ClassifyInput {
  /** The main commit whose production deployment is wanted (40-hex). */
  sha: string;
  /** Production deployments of the project, any order. */
  deployments: VercelDeployment[];
  /** Current head of main. `!== sha` means main has moved past `sha`. */
  mainHeadSha: string;
  /** The wait budget has run out. Turns a `wait` into a red `fail`. */
  budgetElapsed: boolean;
}

export type Outcome =
  | {
      kind: "smoke";
      deploymentId: string;
      environmentUrl: string;
      sha: string;
    }
  | { kind: "skip_superseded"; supersededBy: string; reason: string }
  | { kind: "fail"; reason: string }
  | { kind: "wait"; reason: string };

const IN_PROGRESS = new Set(["BUILDING", "INITIALIZING", "QUEUED"]);
const HOST_RE = /^[A-Za-z0-9.-]+$/;
const UID_RE = /^[A-Za-z0-9_]+$/;

function stateOf(d: VercelDeployment): string {
  return String(d.state ?? d.readyState ?? "").toUpperCase();
}

/** READY and serving the production domains (not merely STAGED). */
function isLive(d: VercelDeployment): boolean {
  return stateOf(d) === "READY" && d.readySubstate?.toUpperCase() !== "STAGED";
}

function newestFirst(a: VercelDeployment, b: VercelDeployment): number {
  return (b.created ?? 0) - (a.created ?? 0);
}

/**
 * Map one observation onto the plan's D3 outcomes. Pure.
 *
 * Only a deployment whose `meta.githubCommitSha` equals `sha` is ever
 * considered: a READY deployment of ANOTHER commit is never taken, since
 * smoking it would report on code this run was not asked about.
 */
export function classify(input: ClassifyInput): Outcome {
  const { sha, deployments, mainHeadSha, budgetElapsed } = input;
  const mine = deployments
    .filter((d) => d.meta?.githubCommitSha === sha)
    .sort(newestFirst);
  const mainMoved = mainHeadSha !== sha;

  // Row 1: a READY (and promoted) production deployment of this sha.
  // Redeploys can give one sha several; the newest is what the alias got.
  const ready = mine.find(isLive);
  if (ready) {
    if (!UID_RE.test(ready.uid) || !HOST_RE.test(ready.url)) {
      return {
        kind: "fail",
        reason: `READY deployment for ${sha} carries an unusable uid/url from the Vercel API.`,
      };
    }
    return {
      kind: "smoke",
      deploymentId: ready.uid,
      environmentUrl: `https://${ready.url}`,
      sha,
    };
  }

  // Still building: keep polling (a redeploy after an ERROR lands here too).
  const building = mine.find((d) => IN_PROGRESS.has(stateOf(d)));
  if (building) {
    return waitOrTimeout(
      budgetElapsed,
      `production deployment ${building.uid} for ${sha} is ${stateOf(building)}.`
    );
  }

  // A failed production build of a main head is red.
  const errored = mine.find((d) => stateOf(d) === "ERROR");
  if (errored) {
    return {
      kind: "fail",
      reason: `production deployment ${errored.uid} for ${sha} is in ERROR state: a failed production build of a main head.`,
    };
  }

  // Nothing live for this sha: none at all, only CANCELED ones, or a READY one
  // still STAGED (built but not promoted to the production domains).
  // Superseded only once main has moved AND the newer head's production
  // deployment exists, so a deploy Vercel has merely not created yet is
  // waited for rather than skipped.
  if (mainMoved) {
    const successor = deployments.some(
      (d) => d.meta?.githubCommitSha === mainHeadSha
    );
    if (successor) {
      const why =
        mine.length === 0
          ? `Vercel created no production deployment for it`
          : mine.some((d) => stateOf(d) === "READY")
            ? `its production deployment was never promoted (STAGED)`
            : `its production deployment was CANCELED`;
      return {
        kind: "skip_superseded",
        supersededBy: mainHeadSha,
        reason: `${sha} was superseded by ${mainHeadSha}: ${why}, and the newer head's own run smokes production.`,
      };
    }
    return waitOrTimeout(
      budgetElapsed,
      `no deployable production deployment for ${sha}; main moved to ${mainHeadSha}, whose deployment has not appeared yet.`
    );
  }

  return waitOrTimeout(
    budgetElapsed,
    mine.length === 0
      ? `no production deployment for ${sha} yet.`
      : mine.some((d) => stateOf(d) === "READY")
        ? `production deployment for ${sha} is READY but STAGED, not yet promoted.`
        : `production deployment for ${sha} was CANCELED and main has not moved.`
  );
}

function waitOrTimeout(budgetElapsed: boolean, reason: string): Outcome {
  return budgetElapsed
    ? { kind: "fail", reason: `timed out waiting: ${reason}` }
    : { kind: "wait", reason };
}

/** A fetcher failure. `transient` errors are retried a bounded number of times. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly transient: boolean
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ResolveDeps {
  listDeployments(): Promise<VercelDeployment[]>;
  mainHead(): Promise<string>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log?(line: string): void;
}

export interface ResolveOptions {
  sha: string;
  budgetMs: number;
  pollMs: number;
  /** Consecutive transient API failures tolerated before failing red. */
  maxConsecutiveErrors: number;
}

/** Poll until `classify` returns anything but `wait`. Never throws. */
export async function resolveDeployment(
  deps: ResolveDeps,
  opts: ResolveOptions
): Promise<Outcome> {
  const start = deps.now();
  let errors = 0;
  for (;;) {
    let deployments: VercelDeployment[];
    let mainHeadSha: string;
    try {
      [deployments, mainHeadSha] = await Promise.all([
        deps.listDeployments(),
        deps.mainHead(),
      ]);
      errors = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const transient = err instanceof ApiError && err.transient;
      errors += 1;
      if (!transient || errors >= opts.maxConsecutiveErrors) {
        return { kind: "fail", reason: `API error: ${msg}` };
      }
      deps.log?.(`transient API error (${errors}), retrying: ${msg}`);
      await deps.sleep(opts.pollMs);
      continue;
    }
    const budgetElapsed = deps.now() - start >= opts.budgetMs;
    const outcome = classify({
      sha: opts.sha,
      deployments,
      mainHeadSha,
      budgetElapsed,
    });
    if (outcome.kind !== "wait") return outcome;
    deps.log?.(`waiting: ${outcome.reason}`);
    await deps.sleep(opts.pollMs);
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/**
 * Escape a string for the message part of a workflow command, so an
 * API-sourced string can never start a new command line.
 */
export function escapeCommandData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

const VERCEL_API = "https://api.vercel.com";
const GITHUB_API = "https://api.github.com";

async function getJson(url: string, headers: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(`${new URL(url).host} unreachable: ${msg}`, true);
  }
  if (!res.ok) {
    // 429 and 5xx are worth a retry; any other 4xx (bad token, wrong project)
    // will not fix itself.
    const transient = res.status === 429 || res.status >= 500;
    throw new ApiError(
      `${new URL(url).host}${new URL(url).pathname} answered HTTP ${res.status}`,
      transient
    );
  }
  return res.json();
}

async function cli(): Promise<number> {
  const env = process.env;
  const sha = env.RESOLVE_SHA ?? "";
  const token = env.VERCEL_TOKEN ?? "";
  const projectId = env.VERCEL_PROJECT_ID || "prj_HObFtTGU6kka7Gx7aUbaf0DzjEfI";
  const teamId = env.VERCEL_TEAM_ID || "team_QshrMW2BcfZGXlEiJFkP6hZj";
  const ghToken = env.GITHUB_TOKEN ?? "";
  const repo = env.GITHUB_REPOSITORY ?? "";
  const outputFile = env.GITHUB_OUTPUT;
  const budgetMs = Number(env.RESOLVE_BUDGET_SECONDS || 900) * 1000;
  const pollMs = Number(env.RESOLVE_POLL_SECONDS || 15) * 1000;

  const output = (pairs: Record<string, string>) => {
    const lines = Object.entries(pairs)
      .map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, " ")}\n`)
      .join("");
    if (outputFile) appendFileSync(outputFile, lines);
    else process.stdout.write(lines);
  };
  const fail = (reason: string) => {
    output({ ok: "false" });
    process.stdout.write(
      `::error title=verify-frontend-run could not resolve the production deployment::${escapeCommandData(reason)}\n`
    );
    return 1;
  };

  if (!/^[0-9a-f]{40}$/.test(sha))
    return fail(`RESOLVE_SHA '${sha}' is not a 40-hex sha.`);
  if (!token)
    return fail(
      "No Vercel token (SSM /qontinui/vercel/token or secrets.VERCEL_TOKEN)."
    );
  if (!ghToken || !repo) return fail("GITHUB_TOKEN / GITHUB_REPOSITORY unset.");

  const listUrl =
    `${VERCEL_API}/v6/deployments?projectId=${encodeURIComponent(projectId)}` +
    `&target=production&limit=20&teamId=${encodeURIComponent(teamId)}`;
  const deps: ResolveDeps = {
    async listDeployments() {
      const body = (await getJson(listUrl, {
        Authorization: `Bearer ${token}`,
      })) as { deployments?: unknown };
      if (!Array.isArray(body.deployments)) {
        throw new ApiError(
          "Vercel list response has no deployments array",
          false
        );
      }
      return body.deployments as VercelDeployment[];
    },
    async mainHead() {
      const body = (await getJson(`${GITHUB_API}/repos/${repo}/commits/main`, {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      })) as { sha?: unknown };
      if (typeof body.sha !== "string" || !/^[0-9a-f]{40}$/.test(body.sha)) {
        throw new ApiError("GitHub returned no sha for main", false);
      }
      return body.sha;
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    log: (line) =>
      process.stdout.write(`[resolve] ${line.replace(/[\r\n]/g, " ")}\n`),
  };

  const outcome = await resolveDeployment(deps, {
    sha,
    budgetMs,
    pollMs,
    maxConsecutiveErrors: 4,
  });
  switch (outcome.kind) {
    case "smoke":
      process.stdout.write(
        `Resolved production deployment ${outcome.deploymentId} (${outcome.environmentUrl}) for ${outcome.sha}\n`
      );
      output({
        ok: "true",
        deployment_id: outcome.deploymentId,
        environment_url: outcome.environmentUrl,
        sha: outcome.sha,
      });
      return 0;
    case "skip_superseded":
      output({ ok: "false" });
      process.stdout.write(
        `::notice title=verify-frontend-run skipped: superseded by ${outcome.supersededBy.slice(0, 9)}::${escapeCommandData(outcome.reason)} Nothing was smoked.\n`
      );
      return 0;
    case "fail":
    case "wait": // unreachable: resolveDeployment never returns `wait`
      return fail(outcome.reason);
  }
}

// Run only when executed directly (`npx tsx resolve-prod-deployment.ts`), never
// when imported by the unit tests.
if (/resolve-prod-deployment\.ts$/.test(process.argv[1] ?? "")) {
  cli()
    .then((code) => process.exit(code))
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `::error::resolver crashed: ${escapeCommandData(msg)}\n`
      );
      process.exit(1);
    });
}
