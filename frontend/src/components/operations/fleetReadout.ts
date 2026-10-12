/**
 * The Dev Ops health strip's two operations-ratchet readouts, derived.
 *
 * Plan `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8, exit criteria 2 and 4:
 *
 * * **Fault-to-visibility** — p90 of `visible_at − onset_at` over the trailing
 *   window, AND `onset_known_n / episodes_n` beside it. The share is not
 *   decoration: coord computes the percentile only over episodes with a known
 *   onset, so a p90 read without its coverage is a claim about an unstated
 *   minority.
 * * **Build resolvability** — the share of devices whose running build coord
 *   can name, from the fleet-health body the page already polls.
 *
 * Pure: each returns a ready `HealthBadge`, so the strip composes them like
 * every other badge and the words are unit-tested here. Every unknown renders
 * as "unknown — <reason>"; never `0`, never a dash.
 */

import type { HealthBadge } from "@/components/console";
import type { UseFaultToVisibilityResult } from "./useFaultToVisibility";
import type { FleetHealthPayload } from "@/lib/api/operations/coordFleet";

/** Seconds as the operator reads an interval: `45s`, `12m`, `1h 12m`, `2d 3h`. */
export function formatDurationSecs(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
}

/** The sentence a null p90 renders — fixed, so the spec can assert it. */
export const F2V_NO_KNOWN_ONSET = "unknown — no episode with a known onset";

/**
 * The fault-to-visibility badge.
 *
 * Label shapes:
 * * `fault→visible p90 1h 12m · onset known 12/40`
 * * `fault→visible p90 unknown — no episode with a known onset · onset known 0/40`
 * * `fault→visible unknown — <read failure>` (no body ever read)
 *
 * A failed LATEST read over a retained body keeps the numbers and says so in
 * the title — a retained verdict must not look re-confirmed.
 */
export function faultToVisibilityBadge(
  read: Pick<UseFaultToVisibilityResult, "data" | "loading" | "error">
): HealthBadge {
  const base = {
    key: "fault-to-visibility",
    "data-testid": "coord-devops-f2v-badge",
  };
  const { data, loading, error } = read;
  if (!data) {
    const reason = error ?? (loading ? "not read yet" : "no answer");
    return {
      ...base,
      label: `fault→visible unknown — ${reason}`,
      tone: "muted",
      title:
        "How long a fault existed before anyone who can act on it could see it (coord's fault-to-visibility read). Nothing has been read, so this is UNKNOWN — not zero.",
    };
  }
  const t = data.totals;
  const p90 =
    t.p90_secs === null ? F2V_NO_KNOWN_ONSET : formatDurationSecs(t.p90_secs);
  const p50 =
    t.p50_secs === null ? F2V_NO_KNOWN_ONSET : formatDurationSecs(t.p50_secs);
  // `typeof … === "number"`, not `!== null`: a row missing the field must
  // not be sorted or printed as `0s`.
  const worst = data.kinds
    .flatMap((k) =>
      typeof k.p90_secs === "number" ? [{ ...k, p90: k.p90_secs }] : []
    )
    .sort((a, b) => b.p90 - a.p90)
    .slice(0, 3)
    .map(
      (k) =>
        `${k.kind} p90 ${formatDurationSecs(k.p90)} (onset known ${k.onset_known_n}/${k.episodes_n})`
    );
  const title = [
    `Fault-to-visibility over ${data.window}: p50 ${p50}, p90 ${p90}.`,
    `Percentiles cover only the ${t.onset_known_n} of ${t.episodes_n} episodes whose onset is known; the rest have no onset evidence and are never counted as zero.`,
    worst.length > 0 ? `Slowest kinds: ${worst.join("; ")}.` : "",
    error
      ? `The latest read failed (${error}); these are the numbers from ${data.computed_at}.`
      : `Computed ${data.computed_at}.`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    ...base,
    label: `fault→visible p90 ${p90} · onset known ${t.onset_known_n}/${t.episodes_n}${error ? " (stale)" : ""}`,
    tone: t.p90_secs === null || error ? "muted" : "default",
    title,
  };
}

/**
 * The build-resolvability badge — the share of devices whose running build
 * coord can name.
 *
 * Label shapes:
 * * `builds nameable 88% (7/8)`
 * * `builds nameable unknown — <reason>` — reasons: the runner-report read
 *   failed, the roster is empty, this coord does not serve the field, or the
 *   fleet-health read itself has not answered.
 */
export function buildResolvabilityBadge(
  body: FleetHealthPayload | null,
  fleetError: string | null
): HealthBadge {
  const base = {
    key: "build-resolvability",
    "data-testid": "coord-devops-build-resolvability-badge",
  };
  const unknown = (reason: string, title: string): HealthBadge => ({
    ...base,
    label: `builds nameable unknown — ${reason}`,
    tone: "muted",
    title,
  });
  if (!body) {
    return unknown(
      fleetError ?? "not read yet",
      "Share of devices whose running build coord can name. The fleet-health read has not answered, so this is UNKNOWN."
    );
  }
  const br = body.build_resolvability;
  if (br === undefined) {
    return unknown(
      "coord does not serve it",
      "This coord predates the build-resolvability field."
    );
  }
  if (br === null) {
    return unknown(
      body.runner_reports_scrape_up === false
        ? "runner-report read failed"
        : "not served",
      "Coord served no build-resolvability figure on this poll. That is no measurement — not 'no builds'."
    );
  }
  if (br.value === null) {
    return unknown(
      "no devices on the roster",
      "0 of 0 is not a share: coord's roster held no devices to measure."
    );
  }
  return {
    ...base,
    label: `builds nameable ${Math.round(br.value * 100)}% (${br.coverage_n}/${br.population_n})`,
    tone: br.coverage_n < br.population_n ? "default" : "muted",
    title: `Devices whose running build coord can name: ${br.coverage_n} of ${br.population_n}. Basis: ${br.basis}.`,
  };
}
