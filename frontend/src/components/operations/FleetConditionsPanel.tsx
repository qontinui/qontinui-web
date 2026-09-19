"use client";

/**
 * FleetConditionsPanel — the Dev Ops Overview's answer to "is anything
 * degraded that no agent is handling, and is anything waiting on me?".
 *
 * Plan `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * Phase 8. It replaced three things on `/admin/coord/devops`: the
 * critical/warning/info alert-severity badges, the two links into the
 * (deleted) `/admin/coord/alerts` page, and the pageout-sink note. A raw
 * alert list and a severity count are agents' work surfaced to the operator;
 * this panel is the operator's rollup of that work.
 *
 * Composed from the console primitives only (`HealthStrip` for the verdict,
 * `StatCluster` for the two breakdowns), per
 * `frontend/docs/console-ui-style-guide.md` §6.4 — no new visual vocabulary.
 * The verdict is derived by the pure `summarizeFleetConditions`; this file
 * renders it and nothing else. It does not fetch: the page hands it the
 * fleet-health read it already polls (R1).
 *
 * It navigates through `onNavigate` rather than holding a router, so it stays
 * a presentation component the page wires up.
 */

import { useMemo } from "react";
import { HealthStrip, StatCluster } from "@/components/console";
import type { HealthBadge, Stat } from "@/components/console";
import { formatAgeSecs, summarizeFleetConditions } from "./fleetConditions";
import type { UseFleetHealthResult } from "./useFleetHealth";

export interface FleetConditionsPanelProps {
  /** The page's own fleet-health read — never a second fetch. */
  health: Pick<UseFleetHealthResult, "data" | "loading" | "error">;
  /** The page's clock, so a setting's age advances without a new read. */
  nowMs?: number;
  /** Where a badge click goes (the page passes `router.push`). */
  onNavigate: (href: string) => void;
}

/** States whose counts are all unmeasured — they render no count badges. */
const NO_COUNTS = new Set([
  "loading",
  "unknown-not-reported",
  "unknown-scrape-failed",
  "unknown-read-failed",
]);

function dash(n: number | null): string {
  return n === null ? "–" : String(n);
}

export function FleetConditionsPanel({
  health,
  nowMs,
  onNavigate,
}: FleetConditionsPanelProps) {
  const summary = useMemo(
    () =>
      summarizeFleetConditions({
        data: health.data,
        loading: health.loading,
        error: health.error,
        nowMs,
      }),
    [health.data, health.loading, health.error, nowMs]
  );

  const badges = useMemo<HealthBadge[]>(() => {
    if (NO_COUNTS.has(summary.state)) return [];
    const out: HealthBadge[] = [];
    const unclaimed = summary.unclaimed;
    out.push({
      key: "unclaimed",
      label: `unclaimed ${dash(unclaimed)}`,
      tone: unclaimed !== null && unclaimed > 0 ? "default" : "muted",
      title:
        unclaimed === null
          ? "Coord served no count of unclaimed conditions — unknown, not zero."
          : "Open conditions no agent has claimed.",
      "data-testid": "coord-devops-conditions-unclaimed-badge",
    });
    if (
      unclaimed !== null &&
      unclaimed > 0 &&
      summary.unclaimedOldestAgeSecs !== null
    ) {
      out.push({
        key: "oldest",
        label: `oldest ${formatAgeSecs(summary.unclaimedOldestAgeSecs)}`,
        tone: "muted",
        title: "How long the oldest unclaimed condition has been open.",
        "data-testid": "coord-devops-conditions-oldest-badge",
      });
    }
    const waiting = summary.awaitingOperator;
    out.push({
      key: "awaiting",
      label: `waiting on you ${dash(waiting)}`,
      // The one badge that borrows red: only a human can clear these.
      tone: waiting !== null && waiting > 0 ? "attention" : "muted",
      title:
        waiting === null
          ? "Coord served no count of questions waiting on you — unknown, not zero. Opens the question queue."
          : waiting === 1
            ? "One question only you can answer. Opens it."
            : "Questions only you can answer. Opens the question queue.",
      onClick: () => onNavigate(summary.questionsHref),
      "data-testid": "coord-devops-conditions-awaiting-badge",
    });
    // Operator alerts with no OPEN question. Coord's exact counts name the
    // cause; an older coord's difference does not, so its badge names none.
    const unasked = summary.operatorAlertsUnasked;
    if (unasked !== null && unasked > 0) {
      out.push({
        key: "unasked",
        label: `not yet asked ${unasked}`,
        tone: "default",
        title:
          "Open conditions only you can resolve that coord has not raised a question for yet. They are not in the question queue until it does.",
        "data-testid": "coord-devops-conditions-unasked-badge",
      });
    }
    const answered = summary.operatorAlertsAnsweredUncleared;
    if (answered !== null && answered > 0) {
      out.push({
        key: "answered-uncleared",
        label: `answered, not clear ${answered}`,
        tone: "muted",
        title:
          "You answered these; coord has not yet re-observed the condition clear. Nothing to do unless it stays open.",
        "data-testid": "coord-devops-conditions-answered-uncleared-badge",
      });
    }
    const beyond = summary.operatorAlertsBeyondQuestions;
    if (beyond !== null && beyond > 0) {
      out.push({
        key: "beyond-questions",
        label: `open beyond questions ${beyond}`,
        tone: "default",
        title:
          "Open operator alerts beyond the questions waiting on you. This coord does not say why each has no open question (not yet asked, or answered and not yet clear).",
        "data-testid": "coord-devops-conditions-beyond-questions-badge",
      });
    }
    out.push({
      key: "claimed",
      label: `claimed ${dash(summary.claimed)}`,
      tone: "muted",
      title: "Open conditions an agent holds a claim on.",
      "data-testid": "coord-devops-conditions-claimed-badge",
    });
    out.push({
      key: "open",
      label: `open ${dash(summary.open)}`,
      tone: "muted",
      title:
        "Every open condition agents own, claimed or not. Deliberate settings are listed separately and not counted here.",
      "data-testid": "coord-devops-conditions-open-badge",
    });
    return out;
  }, [summary, onNavigate]);

  const domainStats = useMemo<Stat[]>(
    () =>
      summary.byDomain.map((d) => ({
        key: d.domain,
        label: `${d.label} `,
        value: d.count,
        tone: "default",
        title: `Unclaimed conditions owned by the ${d.label} agents (${d.domain}).`,
        "data-testid": `coord-devops-conditions-domain-${d.domain}`,
      })),
    [summary.byDomain]
  );

  const settingStats = useMemo<Stat[]>(
    () =>
      (summary.settings ?? []).map((s, i) => ({
        // The alert row's id is the setting's identity: two machines drained
        // are two rows of one kind. The index fallback only serves a coord
        // that sends no id.
        key: s.alertId !== null ? `alert-${s.alertId}` : `${s.kind}-${i}`,
        label: `${s.label} · `,
        value: s.sinceLabel,
        tone: "muted",
        title: [
          s.summary,
          `${s.kind} — a deliberate setting coord is reflecting back, not a fault.`,
          s.since ? `In effect since ${s.since}.` : null,
        ]
          .filter(Boolean)
          .join(" "),
        // Keyed on the row's identity, like `key`: two drained machines are
        // two settings of one kind.
        "data-testid": `coord-devops-conditions-setting-${
          s.alertId !== null ? s.alertId : `${s.kind}-${i}`
        }`,
      })),
    [summary.settings]
  );

  return (
    <section
      className="space-y-2"
      aria-label="Conditions"
      data-testid="coord-devops-conditions-panel"
      data-conditions-state={summary.state}
    >
      <HealthStrip
        data-testid="coord-devops-conditions-strip"
        level={summary.level}
        headline={summary.headline}
        detail={summary.detail}
        badges={badges}
      />
      {domainStats.length > 0 && (
        <div
          className="flex items-center gap-2 flex-wrap text-xs"
          data-testid="coord-devops-conditions-domains"
        >
          <span className="text-muted-foreground">Unclaimed, by owner:</span>
          <StatCluster stats={domainStats} />
        </div>
      )}
      {summary.settings !== null &&
        (settingStats.length > 0 ? (
          <div
            className="flex items-center gap-2 flex-wrap text-xs"
            data-testid="coord-devops-conditions-settings"
          >
            <span className="text-muted-foreground">Settings in effect:</span>
            <StatCluster stats={settingStats} />
            {summary.settingsNotListed > 0 && (
              // Coord caps the list and counts exactly; the rest is named, not
              // silently dropped.
              <span
                className="text-muted-foreground"
                data-testid="coord-devops-conditions-settings-more"
              >
                +{summary.settingsNotListed} more
              </span>
            )}
            {summary.settingsCountUnknown && (
              // No exact total served: the list may be capped, and hiding
              // that would state a completeness nobody measured.
              <span
                className="text-muted-foreground"
                data-testid="coord-devops-conditions-settings-count-unknown"
              >
                (count unknown)
              </span>
            )}
          </div>
        ) : (
          <p
            className="text-xs text-muted-foreground"
            data-testid="coord-devops-conditions-no-settings"
          >
            No deliberate settings in effect.
          </p>
        ))}
    </section>
  );
}
