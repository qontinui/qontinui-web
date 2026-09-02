"use client";

/**
 * PlanRow — one coord work-unit, on one line, with its detail behind a click.
 *
 * Replaces `PlanCard` on `/admin/coord/plans`. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 1;
 * conventions from `frontend/docs/console-ui-style-guide.md` and from
 * `AlertRow.tsx`, this wave's reference implementation.
 *
 * Two things changed and both are the point:
 *
 * 1. **R2 — the card was three stacked lines inside `p-4`; it is now one
 *    `px-3 py-2` row.** The fields that were stacked (title, the date cluster)
 *    moved into the detail panel, which costs a click only when the operator
 *    wants them.
 * 2. **D1 — the whole card was a `<Link>` to `/admin/coord/plans/[slug]`.**
 *    Clicking a row now expands it in place; the detail route survives and is
 *    reached by the explicit "Open full page ↗" action, which keeps the
 *    `coord-plan-card-link` testid it always had. Clicking a row no longer
 *    navigates you away from your filter and scroll position by accident.
 *
 * The `Spawn` button moved into the detail's actions slot for the same reason
 * a `<Link>` could not stay on the row: `<RecordRow>` renders the whole line as
 * ONE `<button>` (so the expand affordance is keyboard-reachable), and a
 * button or an anchor nested inside a button is invalid HTML that browsers
 * silently re-parent.
 *
 * Every `data-testid` `PlanCard` authored is carried across unchanged (D4a) —
 * `coord-plan-card`, `coord-plan-card-link`, `coord-plan-card-spawn-btn`,
 * `coord-plan-card-dates`, `coord-plan-status-tag`.
 *
 * ## The body signals (plan `2026-09-02-bodyless-work-units-…`)
 *
 * The row now says whether the thing this console calls a Plan actually HAS a
 * plan. Both markers are secondary by construction — muted classes, after the
 * status badge, and only in the detail on small viewports — because the
 * screening one is 27.6%-precise and must not read as a verdict, and because a
 * badge that shouts on a row nobody must act on is what trains the eye to
 * ignore badges. The copy, the tones and the honest tooltips are
 * `planBodySignal.ts`; the derivation is the backend's.
 *
 * Terminal units render neither marker (`showsBodySignal`). They still CARRY
 * both fields — suppression is a render decision, not a wire one.
 *
 * ## The spawn guard (Phase 3)
 *
 * The chips say what is true; the Spawn button is where it costs something.
 * On a row whose signals say the document is missing — or cannot be confirmed
 * — Spawn takes TWO clicks: the first states the cost inline and relabels the
 * button "Spawn anyway", the second navigates. Deliberately not a dialog: this
 * row's disclosure idiom is the detail panel it is already sitting in, and a
 * modal for a sentence is a modal for a sentence. Deliberately not a block
 * either — spawning a session to AUTHOR the plan from good metadata is a
 * legitimate move and is how the originating incident was resolved (§9).
 *
 * `deriveSpawnBodyConfirm` is shared with `SpawnModal`, so the two entry
 * points cannot disagree about which rows deserve the interruption. A row the
 * backend did not annotate gets no confirm at all: "not told" is silence about
 * a document, not evidence of one.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Rocket } from "lucide-react";
import { RecordDetail, RecordRow } from "@/components/console";
import { RowTime, StatusBadge } from "@/components/console";
import {
  PLAN_STATUS_PALETTE,
  describePlanStatus,
  derivePlanStatus,
  planIdentity,
  planRest,
  type CoordPlanRow,
} from "@/components/admin/coord/planStatus";
import {
  describeBodyProvenance,
  describeHasBody,
  deriveSpawnBodyConfirm,
  showsBodySignal,
  type BodyMarker,
} from "@/components/admin/coord/planBodySignal";

export type { CoordPlanRow };

/**
 * The timestamp the row reports: the semantically-right one for the plan's
 * state (a shipped plan reports when it shipped), never just "the newest
 * column we have".
 */
function rowTimeFor(plan: CoordPlanRow): { at: string | null; verb: string } {
  if (plan.shipped_at) return { at: plan.shipped_at, verb: "Shipped" };
  if (plan.updated_at) return { at: plan.updated_at, verb: "Updated" };
  return { at: plan.created_at ?? null, verb: "Created" };
}

/**
 * One body marker, as a chip.
 *
 * `title` carries the whole caveat — what the signal can and cannot prove —
 * rather than the label trying to. A label long enough to be honest would not
 * fit on a row; a short label with no tooltip is the thing that reads as a
 * verdict.
 */
function BodyChip({ marker }: { marker: BodyMarker }) {
  return (
    <span
      data-testid={marker.testId}
      title={marker.title}
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none ${marker.className}`}
    >
      {marker.label}
    </span>
  );
}

/** The row's markers, in order, or an empty list when suppressed. */
function bodyMarkers(plan: CoordPlanRow): BodyMarker[] {
  if (!showsBodySignal(plan)) return [];
  return [
    describeHasBody(plan.has_body, plan.body_unknown_reason),
    describeBodyProvenance(plan.body_provenance),
  ].filter((m): m is BodyMarker => m !== null);
}

export function PlanRow({
  plan,
  expanded,
  onToggle,
}: {
  plan: CoordPlanRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const status = derivePlanStatus(plan);
  const tag = describePlanStatus(plan.status);
  const { at, verb } = rowTimeFor(plan);
  const href = `/admin/coord/plans/${encodeURIComponent(plan.slug)}`;
  const markers = bodyMarkers(plan);
  /** Non-null on a row whose Spawn deserves a confirm first. */
  const spawnConfirm = deriveSpawnBodyConfirm(plan);
  /** Whether the operator has clicked Spawn once on such a row. Local to the
   *  row: the confirm is a step in one operator's action, not row state
   *  anything else reads. */
  const [confirmingSpawn, setConfirmingSpawn] = useState(false);

  // A collapsed row abandons its confirm rather than remembering it. The
  // detail unmounts on collapse, so a remembered one would re-appear armed —
  // a "Spawn anyway" button the operator did not ask for in the state they
  // are now in.
  useEffect(() => {
    if (!expanded) setConfirmingSpawn(false);
  }, [expanded]);

  return (
    <RecordRow
      data-testid="coord-plan-card"
      rowKey={plan.slug}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={planIdentity(plan.slug)}
      label={
        <span title={plan.title ? `${plan.slug} — ${plan.title}` : plan.slug}>
          <span className="font-mono">{planRest(plan.slug)}</span>
          {plan.title && (
            <span className="text-muted-foreground"> — {plan.title}</span>
          )}
        </span>
      }
      status={
        <>
          {/* The badge is wrapped rather than replaced: `coord-plan-status-tag`
              and its `data-tone` / `data-recognised` attributes are the frozen
              authored contract (D4a), and `<StatusBadge>` — correctly —
              exposes neither. Wrapping keeps the primitive AND the contract;
              forking a second badge implementation to add three attributes
              would not. */}
          <span
            className="inline-flex shrink-0"
            data-testid="coord-plan-status-tag"
            data-tone={tag.tone}
            data-recognised={tag.recognised ? "true" : "false"}
            title={tag.title}
          >
            <StatusBadge status={status} palette={PLAN_STATUS_PALETTE} />
          </span>
          {/* Dropped below `sm` like the row's own reason slot — §5's density
              budget. The detail panel below carries them unconditionally, so
              nothing is lost on a narrow viewport; it costs a click. */}
          {markers.length > 0 && (
            <span
              className="hidden sm:inline-flex items-center gap-1"
              data-testid="coord-plan-body-signal"
            >
              {markers.map((m) => (
                <BodyChip key={m.testId} marker={m} />
              ))}
            </span>
          )}
        </>
      }
      reason={plan.current_phase ? `phase ${plan.current_phase}` : undefined}
      time={<RowTime at={at} verb={verb} />}
    >
      <RecordDetail
        why={
          <div className="text-xs space-y-1">
            <div>
              <span className="text-muted-foreground">Status: </span>
              <span className="text-foreground/90">{tag.title}</span>
            </div>
            {/* Unconditional here, and spelled out rather than chipped: the
                row's chips are dropped below `sm` and their whole caveat lives
                in a `title`, which a touch device cannot hover. The detail is
                where the sentence actually gets read. Distinct testids from
                the row's, so a query for one never matches two elements. */}
            {markers.map((m) => (
              <div key={m.testId} data-testid={`${m.testId}-detail`}>
                <span className="text-muted-foreground">Document: </span>
                <span className="text-foreground/90">{m.label}</span>
                <span className="text-muted-foreground"> — {m.title}</span>
              </div>
            ))}
          </div>
        }
        problems={
          plan.title ? (
            <p className="text-sm text-foreground">{plan.title}</p>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              coord holds no title for this work unit.
            </p>
          )
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* First, on its own line, so the cost is READ before the button
                that spends it is reached. Present only AFTER the operator has
                asked to spawn: the chips above are already this row's
                unprompted signal, and this is the one attached to the
                action. */}
            {confirmingSpawn && spawnConfirm && (
              <p
                className="basis-full rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground"
                data-testid="coord-plan-spawn-body-confirm"
                data-risk={spawnConfirm.risk}
                role="status"
                aria-live="polite"
              >
                <span className="font-medium text-foreground">
                  {spawnConfirm.headline}
                </span>{" "}
                {spawnConfirm.detail}
              </p>
            )}
            <Link href={href} data-testid="coord-plan-card-link">
              <Button variant="outline" size="sm">
                Open full page
                <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </Link>
            {/* The SAME button, in two steps — not a second control. The
                relabel is what makes the second click deliberate; the testid
                is the frozen authored contract (D4a) and stays on it. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (spawnConfirm && !confirmingSpawn) {
                  setConfirmingSpawn(true);
                  return;
                }
                router.push("/admin/coord/spawn");
              }}
              data-testid="coord-plan-card-spawn-btn"
              data-confirming={confirmingSpawn ? "true" : undefined}
              title={
                spawnConfirm
                  ? `${spawnConfirm.headline} ${spawnConfirm.detail}`
                  : "Spawn an agent from this plan"
              }
            >
              <Rocket className="h-3 w-3 mr-1" />
              {confirmingSpawn ? "Spawn anyway" : "Spawn"}
            </Button>
            {confirmingSpawn && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingSpawn(false)}
                data-testid="coord-plan-card-spawn-cancel"
              >
                Cancel
              </Button>
            )}
            {plan.current_phase && (
              <Badge variant="outline" className="text-xs">
                phase: {plan.current_phase}
              </Badge>
            )}
          </div>
        }
        history={
          <p
            className="text-xs text-muted-foreground flex flex-wrap gap-x-3"
            data-testid="coord-plan-card-dates"
          >
            {/* An absent date is rendered as absent, never as a blank cell:
                "no creation date recorded" is a real, common state that the
                page's own sort has to reason about. */}
            <span title={plan.created_at ? `Created ${plan.created_at}` : undefined}>
              created{" "}
              {plan.created_at ? (
                <RowTime at={plan.created_at} verb="Created" className="inline" />
              ) : (
                <span className="italic">not recorded</span>
              )}
            </span>
            {plan.shipped_at ? (
              <span title={`Shipped ${plan.shipped_at}`}>
                shipped{" "}
                <RowTime at={plan.shipped_at} verb="Shipped" className="inline" />
              </span>
            ) : (
              plan.updated_at && (
                <span title={`Updated ${plan.updated_at}`}>
                  updated{" "}
                  <RowTime at={plan.updated_at} verb="Updated" className="inline" />
                </span>
              )
            )}
          </p>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            work_unit slug: {plan.slug}
            {plan.status ? ` · coord status: ${plan.status}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
