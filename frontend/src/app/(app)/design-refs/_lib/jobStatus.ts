/**
 * What a capture job's row says — status, tier reading and the strip.
 *
 * Plan `2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query`
 * Phase 1b-i. Pure: no fetching, no clock.
 *
 * ## What this surface will not say
 *
 * - **A tier before the pre-check ran.** `derived_tier` is `null` until the
 *   worker's `precheck` writes it, and that reads "not derived yet" — never
 *   `private` or `public`. The submitter does not pick a tier and the backend
 *   never derives one.
 * - **"No jobs" when the queue could not be read.** A failed first read is an
 *   amber strip saying the state is unknown.
 */

import {
  AUTHOR_RED,
  CI_YELLOW,
  INERT,
  type AttentionMap,
  type HealthBadge,
  type HealthStripLevel,
  type RowStatus,
  type StatusPalette,
} from "@/components/console";
import type { CaptureJob, CaptureJobState } from "@/lib/api/design-refs";

/** The worker writes a tier within seconds of claiming; poll a little faster than the dashboards. */
export const DESIGN_REFS_POLL_MS = 10_000;

export const JOB_STATES = [
  "proposed",
  "queued",
  "running",
  "failed",
  "done",
  "rejected",
  "cancelled",
] as const satisfies readonly CaptureJobState[];

/** Who must act: the operator, on a proposal to approve and a failure to retry. */
export const JOB_ATTENTION_BY_KIND = {
  proposed: "author",
  queued: "none",
  running: "none",
  failed: "author",
  done: "none",
  rejected: "none",
  cancelled: "none",
} satisfies AttentionMap<CaptureJobState>;

const JOB_BADGE_CLASS: Record<CaptureJobState, string> = {
  proposed: AUTHOR_RED,
  queued: INERT,
  running: CI_YELLOW,
  failed: AUTHOR_RED,
  done: INERT,
  rejected: INERT,
  cancelled: INERT,
};

export const JOB_PALETTE: StatusPalette<CaptureJobState> = {
  badgeClass: JOB_BADGE_CLASS,
  authorGlyphKinds: new Set<CaptureJobState>(["proposed", "failed"]),
  doneGlyphKinds: new Set<CaptureJobState>(["done"]),
};

const LABEL: Record<CaptureJobState, string> = {
  proposed: "awaiting approval",
  queued: "queued",
  running: "capturing",
  failed: "failed",
  done: "captured",
  rejected: "rejected",
  cancelled: "cancelled",
};

export function jobStatus(job: CaptureJob): RowStatus<CaptureJobState> {
  let reason: string | undefined;
  if (job.state === "failed") {
    reason = job.error ?? "The worker gave no reason.";
  } else if (job.state === "proposed") {
    reason =
      "A discovery agent proposed this URL; nothing is captured until you approve it.";
  } else if (job.state === "running" && job.claimed_by) {
    reason = `Claimed by ${job.claimed_by}.`;
  }
  return {
    kind: job.state,
    label: LABEL[job.state],
    reason,
    attention: JOB_ATTENTION_BY_KIND[job.state],
  };
}

export interface TierReading {
  /** `unknown` until the worker's pre-check has run. */
  kind: "private" | "public" | "unknown";
  label: string;
  /** The worker's recorded reason, flattened to one line. */
  reason: string;
}

function reasonText(reason: CaptureJob["tier_reason"]): string | null {
  if (!reason || Object.keys(reason).length === 0) return null;
  return Object.entries(reason)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("; ");
}

/** The tier as the job states it — never inferred from anything else. */
export function tierReading(job: CaptureJob): TierReading {
  const reason = reasonText(job.tier_reason);
  if (job.derived_tier === "public" || job.derived_tier === "private") {
    return {
      kind: job.derived_tier,
      label: job.derived_tier,
      reason: reason ?? "The worker recorded no reason.",
    };
  }
  return {
    kind: "unknown",
    label: "not derived yet",
    reason: reason ?? "The worker's pre-check has not run for this job.",
  };
}

export function countByState(
  jobs: readonly CaptureJob[]
): Record<CaptureJobState, number> {
  const out = Object.fromEntries(JOB_STATES.map((s) => [s, 0])) as Record<
    CaptureJobState,
    number
  >;
  for (const j of jobs) out[j.state] += 1;
  return out;
}

export interface JobsHealth {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
}

/** The strip. A failed read is amber and says so; it is never "no jobs". */
export function deriveJobsHealth(
  jobs: readonly CaptureJob[] | null,
  readFailed: boolean
): JobsHealth {
  if (jobs === null) {
    return {
      level: "amber",
      headline: readFailed
        ? "The capture queue could not be read — its state is unknown."
        : "Reading the capture queue…",
      detail: "",
      badges: [],
    };
  }
  const n = countByState(jobs);
  const badges: HealthBadge[] = [
    { key: "queued", label: `queued ${n.queued}` },
    { key: "running", label: `capturing ${n.running}` },
    {
      key: "failed",
      label: `failed ${n.failed}`,
      tone: n.failed > 0 ? "attention" : "muted",
    },
    {
      key: "proposed",
      label: `to approve ${n.proposed}`,
      tone: n.proposed > 0 ? "attention" : "muted",
    },
  ];
  const stale = readFailed
    ? " The last read failed; these counts are from the previous one."
    : "";
  if (n.failed > 0 || n.proposed > 0) {
    return {
      level: "red",
      headline: `${n.failed} failed, ${n.proposed} awaiting approval.${stale}`,
      detail: "Failed jobs can be retried; proposals wait for an operator.",
      badges,
    };
  }
  if (readFailed) {
    return {
      level: "amber",
      headline: "The last read failed; showing the previous queue.",
      detail: "",
      badges,
    };
  }
  return {
    level: "green",
    headline:
      n.queued + n.running > 0
        ? `${n.queued} queued, ${n.running} capturing.`
        : "Nothing is waiting to be captured.",
    detail: "",
    badges,
  };
}

/** One URL per line (commas tolerated); blanks and repeats collapse. */
export function parseUrlList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]+/)) {
    const url = raw.trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}
