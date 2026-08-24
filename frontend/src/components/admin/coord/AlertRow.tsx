"use client";

/**
 * AlertRow — one `coord.alerts` row, rendered to the fleet page's conventions.
 *
 * Plan `2026-08-05-coord-alerts-surface-and-fleet-style-ui.md` (SHARED UI
 * CONVENTIONS). Replaces `AlertCard`, which printed the machine payload: the
 * `alert_key` verbatim in mono, a device UUID sliced to 8 characters (a
 * truncated UUID is still a UUID) and two raw ISO-8601 timestamps.
 *
 * The shape here instead:
 *   - ONE plain-language status per row, derived by the pure `alertStatus`
 *     module, with the left-edge accent and badge palette shared with
 *     MergePipeline via `components/console/statusRow`;
 *   - the row identified by what a human recognises — repo, branch, worktree
 *     name, drive — never by `alert_key`, which is a dedup identity;
 *   - timestamps through the `RowTime` idiom, never a raw ISO string;
 *   - why / what to do / links behind the click, in a `CollapsiblePanel` whose
 *     content UNMOUNTS when collapsed (Radix `Presence`; do not add
 *     `forceMount`), so a routine visit costs one status, not a field dump.
 *
 * The device UUID appears in exactly one place: the expanded panel, labelled,
 * because it is the value an operator pastes into a coord tool. That is the
 * "only where it is genuinely actionable" carve-out, not a loophole.
 */

import { Badge } from "@/components/ui/badge";
import { CollapsiblePanel } from "@/components/console/CollapsiblePanel";
import {
  AUTHOR_RED,
  INERT,
  RowTime,
  StatusBadge,
  WAITING_AMBER,
  rowAccentClass,
  type StatusPalette,
} from "@/components/console/statusRow";
import { ExternalLink } from "lucide-react";
import {
  ATTENTION_BY_KIND,
  alertGuidance,
  alertSubject,
  deriveAlertStatus,
  detailEntries,
  type AlertKind,
  type AlertStatus,
  type Attention,
  type CoordAlertRow,
} from "./alertStatus";

export type { CoordAlertRow };

/**
 * The alerts palette. Built from the SAME colour families MergePipeline uses,
 * and keyed off `ATTENTION_BY_KIND` semantics: red iff someone must act now,
 * amber iff something else will clear it. `alertStatus.test.ts` asserts the
 * agreement, so the table and the palette cannot drift.
 */
export const ALERT_BADGE_CLASS: Record<AlertKind, string> = {
  "stale-tree": AUTHOR_RED,
  "stale-wip": AUTHOR_RED,
  "git-invariant": AUTHOR_RED,
  "disk-danger": AUTHOR_RED,
  "red-main": AUTHOR_RED,
  "auth-config": AUTHOR_RED,
  "merge-stuck": AUTHOR_RED,
  "worktree-waste": WAITING_AMBER,
  "machine-health": WAITING_AMBER,
  resolved: "bg-green-500/5 text-green-300 border-green-500/25",
  // The FLOOR for an unclassified row. `unknown`'s real attention is computed
  // per row from severity, so `alertPaletteFor` replaces this — it is what an
  // unknown row renders when severity says nothing is urgent either.
  unknown: INERT,
};

/** Red ⇔ ✕: exactly the kinds whose DECLARED attention is `author`. */
export const ALERT_AUTHOR_GLYPH_KINDS: ReadonlySet<AlertKind> = new Set(
  (Object.keys(ATTENTION_BY_KIND) as AlertKind[]).filter(
    (k) => ATTENTION_BY_KIND[k] === "author"
  )
);

export const ALERT_STATUS_PALETTE: StatusPalette<AlertKind> = {
  badgeClass: ALERT_BADGE_CLASS,
  authorGlyphKinds: ALERT_AUTHOR_GLYPH_KINDS,
  doneGlyphKinds: new Set<AlertKind>(["resolved"]),
};

/** The colour family an attention earns, whatever kind carries it. */
const FAMILY_BY_ATTENTION: Record<Attention, string> = {
  author: AUTHOR_RED,
  waiting: WAITING_AMBER,
  none: INERT,
};

/**
 * The palette for ONE row, keyed off its COMPUTED attention rather than its
 * kind's declared one.
 *
 * `deriveAlertStatus` lets a coord `severity` escalate a row above its kind's
 * floor (a `critical` `machine_degraded`, any `unknown` row). Reading the
 * badge class straight off the static table would then paint an escalated row
 * amber — or, for `unknown`, neutral grey — with only the thin left-edge
 * accent carrying the red. The whole palette rule is that COLOUR encodes who
 * must act, so the badge has to follow the attention that was actually
 * computed, and pick up the colourblind-safe `✕` with it.
 *
 * Returns the shared constant unchanged in the common case, so an unescalated
 * row costs no allocation and the identity stays stable across renders.
 */
export function alertPaletteFor(status: AlertStatus): StatusPalette<AlertKind> {
  // A cleared row keeps its bespoke green whatever severity it once carried.
  if (status.kind === "resolved") return ALERT_STATUS_PALETTE;
  const cls = FAMILY_BY_ATTENTION[status.attention];
  if (cls === ALERT_BADGE_CLASS[status.kind]) return ALERT_STATUS_PALETTE;
  return {
    ...ALERT_STATUS_PALETTE,
    badgeClass: { ...ALERT_BADGE_CLASS, [status.kind]: cls },
    authorGlyphKinds:
      status.attention === "author"
        ? new Set<AlertKind>([...ALERT_AUTHOR_GLYPH_KINDS, status.kind])
        : ALERT_AUTHOR_GLYPH_KINDS,
  };
}

/** `owner/name` → the repo's GitHub page; null when the string isn't one. */
function repoHref(repo: string | undefined): string | null {
  if (!repo) return null;
  const slash = repo.indexOf("/");
  if (slash <= 0 || slash >= repo.length - 1) return null;
  return `https://github.com/${repo}`;
}

export function AlertRow({ alert }: { alert: CoordAlertRow }) {
  const status = deriveAlertStatus(alert);
  const subject = alertSubject(alert);
  const repo =
    typeof alert.detail?.repo === "string" ? alert.detail.repo : undefined;
  const prNumber =
    typeof alert.detail?.pr_number === "number"
      ? alert.detail.pr_number
      : null;
  const href = repoHref(repo);
  const prHref = href && prNumber !== null ? `${href}/pull/${prNumber}` : null;
  const entries = detailEntries(alert);

  return (
    <CollapsiblePanel
      data-testid="coord-alert-row"
      defaultOpen={false}
      // A ROW, not a section: up to 100 of these render under the page's own
      // "Alerts" heading, and 100 sibling <h2>s wreck the document outline.
      titleAs="div"
      className={[
        "p-2.5",
        rowAccentClass(status),
        alert.resolved_at ? "opacity-60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // `title` sits inside an uppercase heading; `normal-case` restores the
      // real spelling of a repo / branch / worktree name.
      title={
        <span
          className="inline-block align-bottom normal-case tracking-normal font-medium text-foreground/90 truncate max-w-[28ch] sm:max-w-[44ch]"
          data-testid="coord-alert-subject"
          title={subject || status.label}
        >
          {subject || status.label}
        </span>
      }
      summary={
        <span className="flex items-center gap-2 min-w-0">
          <StatusBadge status={status} palette={alertPaletteFor(status)} />
          {status.reason && (
            <span
              className="hidden sm:inline text-xs text-muted-foreground normal-case tracking-normal truncate max-w-[24ch] lg:max-w-[48ch]"
              title={status.reason}
              data-testid="coord-alert-reason"
            >
              {status.reason}
            </span>
          )}
          {alert.occurrences != null && alert.occurrences > 1 && (
            <Badge
              variant="outline"
              className="text-[10px] shrink-0"
              title="times coord has re-fired this same alert"
            >
              ×{alert.occurrences}
            </Badge>
          )}
        </span>
      }
      headerActions={
        <RowTime at={alert.last_seen_at ?? null} verb="Last seen" />
      }
      contentClassName="space-y-2 text-xs"
    >
      <div>
        <span className="text-muted-foreground">Why: </span>
        {/* `status.reason` already falls back to coord's own (UUID-stripped)
            summary, so an empty one means the payload genuinely carried
            nothing — say so rather than rendering a blank. */}
        <span className="text-foreground/90" data-testid="coord-alert-why">
          {status.reason || "coord reported no detail beyond the status."}
        </span>
      </div>

      <div>
        <span className="text-muted-foreground">What to do: </span>
        <span className="text-foreground/90" data-testid="coord-alert-guidance">
          {alertGuidance(status.kind)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
        <span>
          first seen <RowTime at={alert.first_seen_at ?? null} verb="First seen" />
        </span>
        {alert.resolved_at && (
          <span>
            resolved <RowTime at={alert.resolved_at} verb="Resolved" />
          </span>
        )}
        {prHref && (
          <a
            href={prHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            PR #{prNumber} <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {href && prHref === null && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            {repo} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {entries.length > 0 && (
        <dl
          className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5"
          data-testid="coord-alert-detail"
        >
          {entries.map((e) => (
            <div key={e.key} className="contents">
              <dt className="text-muted-foreground">{e.key}</dt>
              <dd className="text-foreground/90 break-all">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {alert.device_id && (
        // The one admissible UUID: expanded only, labelled, and here because
        // it is what an operator pastes into a coord device query.
        <div className="text-muted-foreground">
          device id (for coord lookups):{" "}
          <span className="font-mono break-all" data-testid="coord-alert-device-id">
            {alert.device_id}
          </span>
        </div>
      )}
    </CollapsiblePanel>
  );
}
