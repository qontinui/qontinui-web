/**
 * Resolve the Vercel PRODUCTION deployment of one main commit, for the
 * post-deploy smoke.
 *
 * Invoked by the `validate` job of `.github/workflows/verify-frontend-run.yml`
 * on every push to main (and on a manual `workflow_dispatch` re-smoke). It
 * replaced the `deployment_status` trigger, which fired for only 5 of 29
 * production deploys in 48 h (coord finding `c4f43823`, 2026-10-02) because
 * Vercel does not reliably write the GitHub deployment record (plan
 * 2026-10-02-frontend-post-deploy-smoke-misses-most-production-deploys).
 *
 * The decision is the pure `classify()` below — one call per poll, unit-tested
 * row by row against the plan's D3 table. `resolveDeployment()` is the polling
 * loop with injectable fetchers; the CLI at the bottom wires it to the Vercel
 * and GitHub REST APIs and to `$GITHUB_OUTPUT`.
 *
 * The `verify` job uses two more modes of the same CLI, each backed by a pure
 * function:
 *   `prior`  -> `selectRollbackTarget()`: the last-known-good production
 *               deployment, i.e. the newest live one created before THIS one
 *               whose own smoke has not already failed.
 *   `alias <pre_smoke|pre_rollback>` -> `aliasDecision()`: whether the
 *               production alias still serves THIS deployment, so a run never
 *               smokes, or rolls back, a newer deployment than its own.
 *
 * ZERO dependencies beyond Node built-ins (global `fetch`, `fs`), so the
 * workflow runs it with `npx tsx` and no `npm ci` — `validate` stays fast.
 *
 * Exit codes (read by the workflow):
 *   default mode: 0 = resolved: `ok=true` (smoke it) or a NAMED skip
 *                     (`ok=false` + notice)
 *                 1 = red: failed production build, timeout, API error or
 *                     missing token
 *   `prior`:      0 always (HARNESS semantics: a failure is a warning and
 *                 `prior_found=0`, never a red run)
 *   `alias`:      0 = proceed, 3 = do not (skip the smokes / withhold the
 *                 promote); the reason is annotated by the CLI itself
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

  if (mine.length === 0) {
    return waitOrTimeout(
      budgetElapsed,
      `no production deployment for ${sha} yet.`
    );
  }
  if (mine.some((d) => stateOf(d) === "READY")) {
    // Vercel docs (/docs/instant-rollback, read 2026-10-02): "After a
    // rollback, Vercel turns off auto-assignment of production domains", and
    // `vercel promote` restores it. Whether this workflow's own
    // `vercel promote` rollback can leave it off is not documented, so the
    // message names it as the likely cause rather than asserting it.
    return waitOrTimeout(
      budgetElapsed,
      `production deployment for ${sha} is READY but STAGED, not promoted. Production auto-assignment may be paused after a rollback; promote a good deployment or undo the rollback in Vercel.`
    );
  }
  // Only CANCELED deployments of the head of main, and nothing newer to wait
  // for: no deployment of this commit will go live, so waiting is pointless.
  return {
    kind: "fail",
    reason: `production deployment for ${sha} was CANCELED and main has not moved past it, so the head of main will not go live.`,
  };
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
  /** Production deployments of exactly this commit (Vercel `sha=` filter). */
  listDeployments(sha: string): Promise<VercelDeployment[]>;
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
      mainHeadSha = await deps.mainHead();
      deployments = await deps.listDeployments(opts.sha);
      if (mainHeadSha !== opts.sha) {
        deployments = deployments.concat(
          await deps.listDeployments(mainHeadSha)
        );
      }
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

// ── Rollback target ─────────────────────────────────────────────────────────

export type RollbackTarget =
  | { found: true; uid: string; url: string }
  | { found: false; reason: string };

/**
 * The deployment to `vercel promote` when THIS deployment's smoke fails: the
 * newest production deployment that is READY and was promoted (not STAGED),
 * created strictly before this one, and not this one. A newer deployment is
 * never a rollback target, and neither is a failed, building or cancelled one.
 *
 * Nor is one in `failedUids`: a deployment whose own smoke already failed
 * stays READY and PROMOTED in Vercel after being rolled away from, so state
 * alone would offer it again. Those uids come from the durable record the
 * paging step writes into the `frontend-deploy-rollback` issues (see
 * `parseFailedDeploymentUids`). Residual limit: a failure whose record could
 * not be written (the paging step is best-effort), or one older than the
 * issues read, is not excluded.
 * Pure.
 */
export function selectRollbackTarget(
  deployments: VercelDeployment[],
  self: { uid: string; created: number },
  failedUids: readonly string[] = []
): RollbackTarget {
  const target = deployments
    .filter(
      (d) =>
        d.uid !== self.uid &&
        !failedUids.includes(d.uid) &&
        typeof d.created === "number" &&
        d.created < self.created &&
        isLive(d)
    )
    .sort(newestFirst)[0];
  if (!target) {
    return {
      found: false,
      reason: `no READY, promoted production deployment created before ${self.uid} in the listing.`,
    };
  }
  if (!UID_RE.test(target.uid) || !HOST_RE.test(target.url)) {
    return {
      found: false,
      reason: `rollback candidate ${target.uid} carries an unusable uid/url from the Vercel API.`,
    };
  }
  return { found: true, uid: target.uid, url: `https://${target.url}` };
}

/**
 * The marker the workflow's paging step writes into a `frontend-deploy-rollback`
 * issue body for every deployment whose smoke failed:
 *   <!-- verify-frontend-failed-deployment: dpl_xxx -->
 * Keep this regex and the workflow's literal in step.
 */
const FAILED_MARKER_RE =
  /<!-- verify-frontend-failed-deployment: ([A-Za-z0-9_]+) -->/g;

/** Every failed-deployment uid recorded in these issue bodies. Pure. */
export function parseFailedDeploymentUids(
  bodies: readonly (string | null | undefined)[]
): string[] {
  const uids = new Set<string>();
  for (const body of bodies) {
    for (const m of (body ?? "").matchAll(FAILED_MARKER_RE)) uids.add(m[1]);
  }
  return [...uids];
}

// ── Supersession guard ──────────────────────────────────────────────────────

export type AliasSite = "pre_smoke" | "pre_rollback";

export interface AliasDecision {
  /** pre_smoke: proceed | skip.  pre_rollback: proceed | block. */
  action: "proceed" | "skip" | "block";
  /** Annotation level the CLI emits the message at. */
  level: "info" | "notice" | "warning" | "error";
  message: string;
}

/**
 * Does the production alias still serve THIS deployment? `servingUid` is the
 * deployment the alias resolves to, or null when it could not be read. Pure.
 *
 * Before the smokes an unreadable alias proceeds (smoking is safe, and is the
 * old behaviour); before the rollback it blocks, because promoting on unknown
 * state is the dangerous direction.
 */
export function aliasDecision(
  site: AliasSite,
  servingUid: string | null,
  selfUid: string
): AliasDecision {
  if (servingUid === selfUid) {
    return {
      action: "proceed",
      level: "info",
      message: `production alias serves this deployment (${selfUid}).`,
    };
  }
  if (site === "pre_smoke") {
    if (servingUid === null) {
      return {
        action: "proceed",
        level: "warning",
        message: `could not read which deployment the production alias serves; smoking it anyway (it may not be ${selfUid}).`,
      };
    }
    return {
      action: "skip",
      level: "notice",
      message: `production alias now serves ${servingUid}, not this deployment ${selfUid}: a newer deployment superseded it. Smokes and rollback skipped; that deployment's own run judges prod. This is NOT a pass.`,
    };
  }
  return {
    action: "block",
    level: "error",
    message:
      servingUid === null
        ? `the smoke of ${selfUid} failed, but which deployment the production alias serves could not be read, so NO rollback was done (promoting on unknown state could revert a newer deploy). Check prod by hand.`
        : `the smoke of ${selfUid} failed, but prod is now serving a different deployment ${servingUid}, so NO rollback was done. That deployment's own run judges it.`,
  };
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

const env = process.env;
const token = env.VERCEL_TOKEN ?? "";
const projectId = env.VERCEL_PROJECT_ID || "prj_HObFtTGU6kka7Gx7aUbaf0DzjEfI";
const teamId = env.VERCEL_TEAM_ID || "team_QshrMW2BcfZGXlEiJFkP6hZj";

function output(pairs: Record<string, string>): void {
  const lines = Object.entries(pairs)
    .map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, " ")}\n`)
    .join("");
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines);
  else process.stdout.write(lines);
}

function annotate(level: string, title: string, message: string): void {
  if (level === "info") {
    process.stdout.write(`${message.replace(/[\r\n]/g, " ")}\n`);
    return;
  }
  process.stdout.write(
    `::${level} title=${title}::${escapeCommandData(message)}\n`
  );
}

function vercelGet(path: string): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  return getJson(
    `${VERCEL_API}${path}${sep}teamId=${encodeURIComponent(teamId)}`,
    { Authorization: `Bearer ${token}` }
  );
}

async function resolveCli(): Promise<number> {
  const sha = env.RESOLVE_SHA ?? "";
  const ghToken = env.GITHUB_TOKEN ?? "";
  const repo = env.GITHUB_REPOSITORY ?? "";
  const budgetMs = Number(env.RESOLVE_BUDGET_SECONDS || 900) * 1000;
  const pollMs = Number(env.RESOLVE_POLL_SECONDS || 15) * 1000;
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
      "No Vercel token (SSM /qontinui/vercel/token could not be read)."
    );
  if (!ghToken || !repo) return fail("GITHUB_TOKEN / GITHUB_REPOSITORY unset.");

  const deps: ResolveDeps = {
    listDeployments: async (forSha) =>
      (await listProduction(`sha=${forSha}&limit=20`)).deployments,
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

/**
 * One page of production deployments, newest first. `query` adds filters:
 * `sha=<commit>` (honoured: verified live 2026-10-02, it returns exactly that
 * commit's deployments) or `until=<ms>` (exclusive), plus `limit` (max 100).
 */
async function listProduction(
  query: string
): Promise<{ deployments: VercelDeployment[]; next: number | null }> {
  const body = (await vercelGet(
    `/v6/deployments?projectId=${encodeURIComponent(projectId)}` +
      `&target=production&${query}`
  )) as { deployments?: unknown; pagination?: { next?: unknown } };
  if (!Array.isArray(body.deployments)) {
    throw new ApiError("Vercel list response has no deployments array", false);
  }
  const next = body.pagination?.next;
  return {
    deployments: body.deployments as VercelDeployment[],
    next: typeof next === "number" ? next : null,
  };
}

/** Failed-deployment uids recorded in the rollback issues (any state). */
async function recordedFailedUids(): Promise<string[]> {
  const ghToken = env.GITHUB_TOKEN ?? "";
  const repo = env.GITHUB_REPOSITORY ?? "";
  if (!ghToken || !repo) {
    throw new ApiError("GITHUB_TOKEN / GITHUB_REPOSITORY unset", false);
  }
  const issues = (await getJson(
    `${GITHUB_API}/repos/${repo}/issues?labels=frontend-deploy-rollback&state=all&per_page=100`,
    {
      Authorization: `Bearer ${ghToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }
  )) as unknown;
  if (!Array.isArray(issues)) {
    throw new ApiError("GitHub issues response is not a list", false);
  }
  return parseFailedDeploymentUids(
    issues.map((i: { body?: string | null }) => i.body)
  );
}

/** `GET /v13/deployments/<uid or alias host>`, checked to be this project's. */
async function getDeployment(
  idOrHost: string
): Promise<{ id: string; created: number }> {
  const body = (await vercelGet(
    `/v13/deployments/${encodeURIComponent(idOrHost)}`
  )) as { id?: unknown; createdAt?: unknown; projectId?: unknown };
  if (typeof body.id !== "string" || !UID_RE.test(body.id)) {
    throw new ApiError(
      `Vercel returned no deployment id for ${idOrHost}`,
      false
    );
  }
  if (body.projectId !== projectId) {
    throw new ApiError(
      `${idOrHost} resolves to a deployment of another project`,
      false
    );
  }
  return {
    id: body.id,
    created: typeof body.createdAt === "number" ? body.createdAt : NaN,
  };
}

function selfUid(): string | null {
  const uid = env.DEPLOYMENT_ID ?? "";
  return UID_RE.test(uid) ? uid : null;
}

/** `prior` mode: the rollback target. HARNESS semantics: never red. */
async function priorCli(): Promise<number> {
  const TITLE = "no auto-rollback target";
  const notFound = (reason: string) => {
    annotate(
      "warning",
      TITLE,
      `${reason} Auto-rollback is impossible for this run (harness).`
    );
    output({ prior_found: "0" });
    return 0;
  };
  const uid = selfUid();
  if (!uid) return notFound("DEPLOYMENT_ID is not a Vercel deployment uid.");
  if (!token) return notFound("No Vercel token.");
  try {
    const self = await getDeployment(uid);
    if (!Number.isFinite(self.created)) {
      return notFound(`Vercel reported no creation time for ${uid}.`);
    }
    // Without the failure record a known-bad deployment could be promoted,
    // so an unreadable record means no rollback target (HARNESS), not "none".
    const failed = await recordedFailedUids();
    if (failed.length > 0) {
      process.stdout.write(
        `Excluding deployments whose smoke already failed: ${failed.join(", ")}\n`
      );
    }
    // Page back from this deployment's creation time until a target turns up.
    let until: number | null = self.created;
    let target: RollbackTarget = {
      found: false,
      reason: `no production deployment was created before ${uid}.`,
    };
    for (let page = 0; page < 5 && until !== null && !target.found; page++) {
      const listed = await listProduction(`until=${until}&limit=100`);
      target = selectRollbackTarget(
        listed.deployments,
        { uid, created: self.created },
        failed
      );
      until = listed.next;
    }
    if (!target.found) return notFound(target.reason);
    process.stdout.write(
      `Prior (last-known-good) Production deployment = ${target.uid} (${target.url})\n`
    );
    output({
      prior_found: "1",
      prior_deployment: target.url,
      prior_uid: target.uid,
    });
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return notFound(
      `Could not read the Vercel API or the GitHub failure record: ${msg}.`
    );
  }
}

/** `alias <site>` mode: does the production alias still serve this deploy? */
async function aliasCli(site: string | undefined): Promise<number> {
  if (site !== "pre_smoke" && site !== "pre_rollback") {
    process.stdout.write(
      `::error::alias mode needs pre_smoke or pre_rollback, got '${escapeCommandData(String(site))}'\n`
    );
    return 2;
  }
  const uid = selfUid() ?? "<unknown>";
  const host = new URL(env.PROD_PUBLIC_URL || "https://qontinui.io").host;
  let serving: string | null = null;
  if (token && uid !== "<unknown>") {
    try {
      serving = (await getDeployment(host)).id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `[alias] could not resolve ${host}: ${msg.replace(/[\r\n]/g, " ")}\n`
      );
    }
  }
  const decision = aliasDecision(site, serving, uid);
  const title =
    site === "pre_smoke"
      ? `verify-frontend-run: production alias check before the smokes`
      : `verify-frontend-run: auto-rollback withheld`;
  annotate(decision.level, title, decision.message);
  output({ alias_action: decision.action, serving_uid: serving ?? "" });
  return decision.action === "proceed" ? 0 : 3;
}

function cli(): Promise<number> {
  const [mode, arg] = process.argv.slice(2);
  if (mode === "prior") return priorCli();
  if (mode === "alias") return aliasCli(arg);
  return resolveCli();
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
