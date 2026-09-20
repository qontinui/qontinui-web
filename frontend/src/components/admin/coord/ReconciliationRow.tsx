"use client";

/**
 * One plan stem on `/admin/coord/plans`, reconciled three ways.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 1.
 * Composes the console primitives (R2 — one record is one line; R5 — detail
 * expands in place; R8 — every reading comes from the pure
 * `planReconciliationStatus.ts`, nothing is derived in this file).
 *
 * The three axis cells are the row's substance, and each one is allowed to say
 * UNKNOWN. Two of the readings they render are the ones a naive renderer gets
 * backwards, and both live in the derivation module rather than here:
 *
 *   - **`axis_c.computed === false` renders "delivery not asked"** — never an
 *     absent-therefore-negative delivery. Axis C is page-scoped, so with the
 *     route's `limit` capped at 100 over ~1,991 stems this is the COMMON row.
 *   - **`evidence_complete` is read before `shipped`**, so "not delivered"
 *     cannot be rendered over an incomplete evidence read. `evidence_gaps`
 *     rides the detail panel verbatim as a list.
 *
 * `variant_count > 1` — a divergent document copy the route collapsed to the
 * newest — is surfaced as a marker rather than left silent, and since Phase 4b
 * there is somewhere to go: `/admin/coord/plan-forks`, the consumer for
 * `GET /plan-library/divergent`. It had nowhere to go before that page
 * existed, which made it a notice rather than a route to the answer.
 *
 * **That route is a link in the DETAIL panel, and the row's marker is a plain
 * `<span>`.** `RecordRow` renders the whole line as one `<button>`, and
 * interactive content nested inside a `<button>` is invalid HTML with
 * undefined browser behaviour — the anchor's accessible name is absorbed and
 * a keyboard user gets two ambiguous focus stops on one row. Stopping click
 * propagation fixes the mouse and nothing else, so the marker states the
 * fact and the detail panel carries the navigation.
 */

import Link from "next/link";
import { GitFork } from "lucide-react";
import {
  RecordDetail,
  RecordRow,
  StatusBadge,
  UNKNOWN_AMBER,
} from "@/components/console";
import {
  RECONCILIATION_ATTENTION_BY_VERDICT,
  RECONCILIATION_PALETTE,
  describeAxisA,
  describeAxisB,
  describeAxisC,
  describeVerdict,
  isDivergent,
  variantCount,
  type AxisReading,
  type ReconciliationRowData,
} from "./planReconciliationStatus";
import { planIdentity, planIdentityTitle, planRest } from "./planStatus";

/** One axis cell. Muted when the axis is stating ignorance rather than state. */
function AxisCell({
  axis,
  reading,
  testId,
}: {
  axis: "A" | "B" | "C";
  reading: AxisReading;
  testId: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap",
        reading.unknown
          ? "border-border bg-muted text-muted-foreground italic"
          : "border-border bg-card text-foreground/90",
      ].join(" ")}
      data-testid={testId}
      data-axis={axis}
      data-axis-kind={reading.kind}
      data-unknown={reading.unknown ? "true" : "false"}
      title={reading.detail}
    >
      <span className="text-muted-foreground/70">{axis}</span>
      {reading.label}
    </span>
  );
}

export function ReconciliationRow({
  row,
  expanded,
  onToggle,
}: {
  row: ReconciliationRowData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const verdict = describeVerdict(row);
  const a = describeAxisA(row.axis_a);
  const b = describeAxisB(row.axis_b);
  const c = describeAxisC(row.axis_c);
  const divergent = isDivergent(row);

  return (
    <RecordRow
      data-testid="coord-plan-reconciliation-row"
      rowKey={row.slug}
      expanded={expanded}
      onToggle={onToggle}
      attention={RECONCILIATION_ATTENTION_BY_VERDICT[verdict.kind]}
      identity={
        <span title={planIdentityTitle(row.slug)}>
          {planIdentity(row.slug)}
        </span>
      }
      label={
        <span title={row.title ? `${row.slug} — ${row.title}` : row.slug}>
          <span className="font-mono">{planRest(row.slug)}</span>
          {row.title && (
            <span className="text-muted-foreground"> — {row.title}</span>
          )}
        </span>
      }
      status={
        <>
          <span
            className="inline-flex shrink-0"
            data-testid="coord-plan-verdict"
            data-verdict={verdict.kind}
            data-classification={row.classification}
            title={`${verdict.label} — ${row.classification}`}
          >
            <StatusBadge status={verdict} palette={RECONCILIATION_PALETTE} />
          </span>
          {/* Dropped below `sm` — §5's density budget. The detail panel below
              carries all three unconditionally, so a narrow viewport costs a
              click, never a reading. */}
          <span
            className="hidden sm:inline-flex items-center gap-1"
            data-testid="coord-plan-axes"
          >
            <AxisCell axis="A" reading={a} testId="coord-plan-axis-a" />
            <AxisCell axis="B" reading={b} testId="coord-plan-axis-b" />
            <AxisCell axis="C" reading={c} testId="coord-plan-axis-c" />
          </span>
          {divergent && (
            // NON-INTERACTIVE, deliberately. `RecordRow` renders this whole
            // line as one `<button type="button">` and interpolates `status`
            // inside it, and interactive content inside a `<button>` is
            // forbidden: the anchor's accessible name is absorbed into the
            // button's, a keyboard user gets two ambiguous focus stops, and
            // the rendered behaviour is left to the browser.
            // `stopPropagation` would have fixed the mouse case only.
            //
            // The route to the fork list is not lost — the detail panel
            // below carries a real, valid `coord-plan-divergent-link`, one
            // click away — so the row keeps the MARKER and the `title` says
            // where to go.
            <span
              // R3/§4.1 — `statusRow.tsx` is the only module allowed to spell
              // an attention colour. This marker is the "we do not know which
              // copy is the plan" amber, so it interpolates UNKNOWN_AMBER
              // rather than re-typing a tint next to it.
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap ${UNKNOWN_AMBER}`}
              data-testid="coord-plan-divergent"
              data-variant-count={variantCount(row.axis_b)}
              title={
                `${variantCount(row.axis_b)} artifact rows share this stem — a divergent ` +
                "document copy. The newest is the one compared here; the " +
                "others are not shown, which is why this marker exists. " +
                "Open this row for a link to the fork list, which shows " +
                "every copy."
              }
            >
              <GitFork className="h-3 w-3" aria-hidden="true" />
              {variantCount(row.axis_b)} copies
            </span>
          )}
        </>
      }
      // The route's own sentence naming the values that decided the class —
      // so an operator never has to re-derive the verdict from three axes.
      reason={row.reason}
      reasonTestId="coord-plan-reason"
    >
      <RecordDetail
        data-testid="coord-plan-reconciliation-detail"
        why={
          <div className="text-xs space-y-1" data-testid="coord-plan-why">
            <div>
              <span className="text-muted-foreground">Why: </span>
              <span className="text-foreground/90">{row.reason}</span>
            </div>
          </div>
        }
        problems={
          <div className="text-xs space-y-1.5">
            {(
              [
                ["A — coord's stored status", a, "coord-plan-detail-axis-a"],
                ["B — the document's stamp", b, "coord-plan-detail-axis-b"],
                ["C — coord's delivery verdict", c, "coord-plan-detail-axis-c"],
              ] as const
            ).map(([heading, reading, testId]) => (
              <div key={testId} data-testid={testId}>
                <span
                  className="text-muted-foreground"
                  data-attention={reading.unknown ? "waiting" : "none"}
                >
                  {heading}:{" "}
                </span>
                <span
                  className={
                    reading.unknown
                      ? "text-muted-foreground italic"
                      : "text-foreground/90"
                  }
                >
                  {reading.label}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  — {reading.detail}
                </span>
              </div>
            ))}
            {/* VERBATIM, as a list. The schema forbids collapsing these to a
                count or a boolean, and two of coord's three modelled gaps are
                visible nowhere else in the product. */}
            {c.gaps.length > 0 && (
              <div data-testid="coord-plan-evidence-gaps">
                <span className="text-muted-foreground">
                  coord&apos;s evidence gaps, verbatim:
                </span>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {/* Keyed by INDEX: coord's own gap strings, verbatim and
                      with no uniqueness guarantee. */}
                  {c.gaps.map((gap, i) => (
                    <li key={i}>{gap}</li>
                  ))}
                </ul>
              </div>
            )}
            {divergent && (
              <div data-testid="coord-plan-detail-divergent">
                <span className="text-amber-200">
                  {variantCount(row.axis_b)} document copies share this stem.
                </span>{" "}
                <span className="text-muted-foreground">
                  The newest is the one compared above; the others were
                  collapsed, not reconciled.{" "}
                  <Link
                    href="/admin/coord/plan-forks"
                    className="underline"
                    data-testid="coord-plan-divergent-link"
                  >
                    See every copy, with its source and digest
                  </Link>
                  .
                </span>
              </div>
            )}
          </div>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 space-y-0.5">
            <div>class: {row.classification}</div>
            <div>stem: {row.slug}</div>
            {row.artifact_id && <div>artifact: {row.artifact_id}</div>}
            {row.source_repo && (
              <div>
                source: {row.source_repo}
                {row.source_path ? `/${row.source_path}` : ""}
              </div>
            )}
            <div>document_state: {row.document_state}</div>
          </div>
        }
      />
    </RecordRow>
  );
}
