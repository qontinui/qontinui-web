"use client";

/**
 * ReleaseRow — one observed runner release, on one line, with its detail
 * behind a click.
 *
 * Replaces `ReleaseCard` on `/admin/coord/releases`. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 2;
 * conventions from `frontend/docs/console-ui-style-guide.md` and from
 * `PlanRow.tsx` / `AlertRow.tsx`.
 *
 * What changed:
 *
 * 1. **R2** — the card was a `p-4` block of four stacked lines (tag + flags,
 *    asset badges + CI + lag, published/observed/coverage/credibility, and an
 *    assets drill-down button). It is now one `px-3 py-2` row.
 * 2. **R5** — the drill-down had its OWN toggle button nested inside the card
 *    (`coord-release-expand-btn`), so a release had two independent expansion
 *    affordances and neither was the row. There is now one: clicking the row
 *    opens a `<RecordDetail>` carrying everything, including the assets list.
 *    The button's testid is carried onto the row's own toggle region so the
 *    authored contract survives (D4a).
 * 3. **R3** — the drift ladder moved into `releaseStatus.ts` with an audited
 *    attention table (see its module doc for the one hue that changed and why).
 *
 * The two Windows hard-gate badges stay ON THE ROW. They are the reason this
 * surface exists — a release whose `-setup.exe` or `latest.json` never
 * published is the v1.0.0/v1.0.1 failure, and burying that behind a click
 * would be exactly the regression the page was built to prevent.
 */

import { Badge } from "@/components/ui/badge";
import { FileDown, FileJson, Tag } from "lucide-react";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
  rowAccentClass,
} from "@/components/console";
import {
  RELEASE_STATUS_PALETTE,
  deriveReleaseStatus,
  lagLabel,
  releaseIdentity,
} from "@/components/admin/coord/releaseStatus";
import type { ReleaseHistoryEntry } from "@/services/runner-releases-service";

/**
 * An asset-presence chip.
 *
 * THREE states, not two: present, absent, and **not observed**. `null` is what
 * a dark row (GitHub unreachable / token unset) carries, and rendering that as
 * "no setup.exe" would report a missing artefact on evidence we do not have.
 */
function AssetChip({
  present,
  label,
  icon,
  testId,
}: {
  present: boolean | null | undefined;
  label: string;
  icon: React.ReactNode;
  testId: string;
}) {
  const unknown = present === null || present === undefined;
  return (
    <Badge
      variant="outline"
      className={[
        "inline-flex items-center gap-1 text-[10px] shrink-0",
        // NOT the attention palette. §4 reserves red for the one thing on a
        // row that says who must act, and that is the status badge — which
        // reads coord's own drift verdict. A red chip here could sit on a row
        // whose verdict is `in_sync` (that state short-circuits on
        // `entry.in_sync` regardless of assets), leaving R4's left edge and the
        // chip contradicting each other. A missing hard-gate asset says so in
        // WORDS, and `deriveReleaseStatus` already puts it in the row's reason.
        unknown
          ? "border-dashed text-muted-foreground/70"
          : present
            ? "bg-green-500/15 text-green-200 border-green-500/30"
            : "bg-muted text-muted-foreground border-border font-semibold",
      ].join(" ")}
      title={
        unknown
          ? `${label}: not observed — this row's asset detail is dark, which is not the same as absent`
          : present
            ? `${label} published`
            : `${label} MISSING — the Windows hard gate is not satisfied`
      }
      data-testid={testId}
      data-asset-present={unknown ? "unknown" : present ? "true" : "false"}
    >
      {icon}
      {unknown ? `${label} ?` : present ? label : `no ${label}`}
    </Badge>
  );
}

export function ReleaseRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: ReleaseHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = deriveReleaseStatus(entry);
  const lag = lagLabel(entry.lag_seconds);
  const assets = entry.assets ?? [];

  return (
    <RecordRow
      // `coord-release-expand-btn` rides here rather than on a second button:
      // the row IS the expand affordance now, and the authored testid names
      // the thing that expands the release (D4a).
      data-testid="coord-release-card"
      rowKey={`${releaseIdentity(entry)}-${entry.observed_at ?? ""}`}
      expanded={expanded}
      onToggle={onToggle}
      accent={rowAccentClass(status)}
      attention={status.attention}
      identity={
        <span data-testid="coord-release-expand-btn">
          {releaseIdentity(entry)}
        </span>
      }
      label={
        <span className="inline-flex items-center gap-1.5">
          {entry.prerelease && (
            <Badge variant="outline" className="text-[10px] uppercase shrink-0">
              beta
            </Badge>
          )}
          {entry.draft_present && (
            <Badge variant="warning" className="text-[10px] uppercase shrink-0">
              draft
            </Badge>
          )}
          <AssetChip
            present={entry.has_setup_exe}
            label="setup.exe"
            icon={<FileDown className="h-3 w-3" />}
            testId="coord-release-setup-exe-badge"
          />
          <AssetChip
            present={entry.has_latest_json}
            label="latest.json"
            icon={<FileJson className="h-3 w-3" />}
            testId="coord-release-latest-json-badge"
          />
        </span>
      }
      status={
        <span
          className="inline-flex shrink-0"
          data-testid="coord-release-drift-badge"
        >
          <StatusBadge status={status} palette={RELEASE_STATUS_PALETTE} />
        </span>
      }
      reason={status.reason}
      time={
        <RowTime
          at={entry.observed_at ?? null}
          verb="Observed"
          absent={{
            label: "not observed",
            title: "coord has no observation timestamp for this release",
          }}
        />
      }
    >
      <RecordDetail
        why={
          <div className="text-xs">
            <span className="text-muted-foreground">State: </span>
            <span className="text-foreground/90">
              {status.label}
              {status.reason ? ` — ${status.reason}` : ""}
            </span>
          </div>
        }
        problems={
          <div className="space-y-1 text-xs">
            {entry.ci_state && (
              <p className="text-muted-foreground font-mono">
                CI {entry.ci_state}
              </p>
            )}
            {lag && (
              <p className="text-amber-300/90 tabular-nums">
                {lag} behind the tag
              </p>
            )}
            {entry.deploy_outcome_raw && (
              <pre className="overflow-x-auto rounded bg-muted p-2 text-[11px] text-muted-foreground">
                {entry.deploy_outcome_raw}
              </pre>
            )}
          </div>
        }
        actions={
          <div className="space-y-1" data-testid="coord-release-drilldown">
            <p className="text-xs text-muted-foreground">
              {/* A dark row has `assets: null` — "0 published assets" would be
                  a measurement we did not take, and the line below already
                  says so in words. */}
              {entry.assets == null
                ? "published assets: not observed"
                : assets.length + " published asset" + (assets.length === 1 ? "" : "s")}
            </p>
            {assets.length > 0 ? (
              <ul className="space-y-0.5">
                {assets.map((asset) => (
                  <li
                    key={asset}
                    className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground"
                  >
                    <Tag className="h-3 w-3 shrink-0" />
                    <span className="truncate">{asset}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                {entry.assets === null || entry.assets === undefined
                  ? "Assets not observed — this row's detail is dark, which is not the same as an empty release."
                  : "No published assets observed."}
              </p>
            )}
          </div>
        }
        history={
          <p className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
            <span>
              published{" "}
              <RowTime
                at={entry.published_at ?? null}
                verb="Published"
                className="inline"
                absent={{
                  label: "never",
                  title: "coord observed no publication for this tag",
                }}
              />
            </span>
            <span>
              observed{" "}
              <RowTime
                at={entry.observed_at ?? null}
                verb="Observed"
                className="inline"
              />
            </span>
            {typeof entry.coverage === "number" && (
              <span data-testid="coord-release-coverage">
                coverage {Math.round(entry.coverage * 100)}%
              </span>
            )}
            {typeof entry.credibility === "number" && (
              <span>credibility {Math.round(entry.credibility * 100)}%</span>
            )}
          </p>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            tag: {entry.tag ?? "—"} · version: {entry.version ?? "—"}
            {entry.published_tag ? ` · published tag: ${entry.published_tag}` : ""}
            {entry.repo ? ` · repo: ${entry.repo}` : ""}
            {entry.provenance ? ` · provenance: ${entry.provenance}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
